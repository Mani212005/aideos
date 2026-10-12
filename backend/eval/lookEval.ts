/**
 * File Description: Offline evaluator for look-plan treatment choices against labelled beats.
 * Inputs and outputs: look_cases.json plus one or more look.json plans -> per-case agreement report.
 * Used by: npm run eval:look and backend/eval/lookEval.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { checkLookPlan } from "../lookPlan/check";
import { safeParseLookPlan, type LookTreatment } from "../lookPlan/schema";

/** A labelled treatment error with its evidence-based reason. */
export interface LookEvalWrongLabel {
  treatment: LookTreatment;
  reason: string;
}

/** One beat and the treatments supported or rejected by its evidence source. */
export interface LookEvalCase {
  id: string;
  source: string;
  beat: {
    narration: string;
    mechanism: boolean;
    spokenNumber: boolean;
    carriesOver: boolean;
  };
  right: LookTreatment[];
  wrong: LookEvalWrongLabel[];
}

/** One scored case, including missing plans as explicit disagreements. */
export interface LookEvalRow {
  id: string;
  chosen: LookTreatment | null;
  hit: boolean;
  result: "right" | "wrong" | "missing";
}

/** Reads and validates the checked-in labelled beat set. */
export function loadLookEvalCases(): LookEvalCase[] {
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, "look_cases.json"), "utf8"));
  if (!Array.isArray(raw)) throw new Error("look_cases.json must contain an array");
  const ids = new Set<string>();
  for (const value of raw) {
    if (!isLookEvalCase(value)) throw new Error("look_cases.json contains an invalid labelled case");
    if (ids.has(value.id)) throw new Error(`look_cases.json contains duplicate case id ${value.id}`);
    ids.add(value.id);
    if (value.right.length === 0) throw new Error(`case ${value.id} needs at least one right treatment`);
    const right = new Set(value.right);
    if (value.wrong.some((label) => right.has(label.treatment))) {
      throw new Error(`case ${value.id} labels a treatment both right and wrong`);
    }
  }
  return raw;
}

/** Checks the plain JSON shape of one labelled case before evaluation. */
function isLookEvalCase(value: unknown): value is LookEvalCase {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LookEvalCase>;
  const treatments = ["scene", "scene+card", "device", "footage"];
  return typeof candidate.id === "string" && typeof candidate.source === "string" &&
    !!candidate.beat && typeof candidate.beat.narration === "string" &&
    typeof candidate.beat.mechanism === "boolean" && typeof candidate.beat.spokenNumber === "boolean" &&
    typeof candidate.beat.carriesOver === "boolean" && Array.isArray(candidate.right) &&
    candidate.right.every((label) => treatments.includes(label)) && Array.isArray(candidate.wrong) &&
    candidate.wrong.every((label) => !!label && treatments.includes(label.treatment) && typeof label.reason === "string" && label.reason.length > 0);
}

/** Scores one look plan by matching its shot id to one labelled beat id. */
export function scoreLookEvalCase(evalCase: LookEvalCase, rawPlan: unknown): LookEvalRow {
  if (rawPlan === undefined) return { id: evalCase.id, chosen: null, hit: false, result: "missing" };
  const parsed = safeParseLookPlan(rawPlan);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`invalid look plan for ${evalCase.id}: ${detail}`);
  }
  const shot = parsed.data.shots.find((candidate) => candidate.id === evalCase.id);
  if (!shot) return { id: evalCase.id, chosen: null, hit: false, result: "missing" };
  const right = evalCase.right.includes(shot.treatment);
  const wrong = evalCase.wrong.some((label) => label.treatment === shot.treatment);
  const hit = right && !wrong;
  return { id: evalCase.id, chosen: shot.treatment, hit, result: hit ? "right" : "wrong" };
}

/** Scores each labelled case against an optional map of plans keyed by case id. */
export function scoreLookPlans(cases: LookEvalCase[], plans: ReadonlyMap<string, unknown>): LookEvalRow[] {
  return cases.map((evalCase) => scoreLookEvalCase(evalCase, plans.get(evalCase.id)));
}

/** Loads plans from one look.json file or a directory keyed by case id. */
export function loadLookPlans(inputPath: string, cases: LookEvalCase[]): Map<string, unknown> {
  const resolved = path.resolve(inputPath);
  const plans = new Map<string, unknown>();
  if (!fs.existsSync(resolved)) throw new Error(`plan path does not exist: ${resolved}`);
  if (fs.statSync(resolved).isDirectory()) {
    for (const evalCase of cases) {
      const candidates = [
        path.join(resolved, `${evalCase.id}.json`),
        path.join(resolved, evalCase.id, "design", "look.json"),
        path.join(resolved, evalCase.id, "look.json"),
      ];
      const file = candidates.find((candidate) => fs.existsSync(candidate));
      if (file) plans.set(evalCase.id, readPlan(file));
    }
    return plans;
  }

  const plan = readPlan(resolved);
  const parsed = safeParseLookPlan(plan);
  if (!parsed.success) throw new Error(`invalid look plan at ${resolved}`);
  for (const evalCase of cases) {
    if (parsed.data.shots.some((shot) => shot.id === evalCase.id)) plans.set(evalCase.id, parsed.data);
  }
  return plans;
}

/** Reads one JSON plan from disk. */
function readPlan(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`cannot read look plan ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Formats the per-case table and overall agreement as plain terminal text. */
export function formatLookEval(rows: LookEvalRow[]): string {
  const idWidth = Math.max(4, ...rows.map((row) => row.id.length));
  const chosenWidth = 12;
  const lines = [`${"case".padEnd(idWidth)}  ${"chosen".padEnd(chosenWidth)}  result`, `${"-".repeat(idWidth)}  ${"-".repeat(chosenWidth)}  ------`];
  for (const row of rows) lines.push(`${row.id.padEnd(idWidth)}  ${(row.chosen ?? "-").padEnd(chosenWidth)}  ${row.result}`);
  const hits = rows.filter((row) => row.hit).length;
  lines.push(`\noverall agreement: ${Math.round((100 * hits) / Math.max(1, rows.length))}% (${hits}/${rows.length})`);
  return lines.join("\n");
}

/** Evaluates loaded plans against labelled cases, checking plans and enforcing any opt-in minimum threshold. */
export function evaluateLookPlans(
  cases: LookEvalCase[],
  plans: ReadonlyMap<string, unknown>,
  options: { minimum?: number } = {},
): { rows: LookEvalRow[]; agreement: number; passed: boolean } {
  if (options.minimum !== undefined && (!Number.isFinite(options.minimum) || options.minimum < 0 || options.minimum > 100)) {
    throw new Error("--min must be a number from 0 to 100");
  }
  for (const [id, plan] of plans) {
    const report = checkLookPlan(plan, id);
    if (!report.ok) throw new Error(`look plan for ${id} fails aideos look check: ${report.findings.map((finding) => finding.message).join("; ")}`);
  }
  const rows = scoreLookPlans(cases, plans);
  const agreement = (100 * rows.filter((row) => row.hit).length) / Math.max(1, rows.length);
  const passed = options.minimum === undefined || agreement >= options.minimum;
  return { rows, agreement, passed };
}

/** Parses command-line arguments for look plan evaluation. */
export function parseLookEvalArgs(args: string[]): { planPath: string; minimum?: number } {
  let planPath: string | undefined;
  let minimum: number | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--plans") planPath = args[++index];
    else if (arg === "--min") minimum = Number(args[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!planPath) throw new Error("usage: npm run eval:look -- --plans <look.json|directory> [--min percent]");
  if (minimum !== undefined && (!Number.isFinite(minimum) || minimum < 0 || minimum > 100)) {
    throw new Error("--min must be a number from 0 to 100");
  }
  return { planPath, minimum };
}

/** Runs look plan evaluation from CLI arguments. */
function main(): void {
  const { planPath, minimum } = parseLookEvalArgs(process.argv.slice(2));
  const cases = loadLookEvalCases();
  const plans = loadLookPlans(planPath, cases);
  const result = evaluateLookPlans(cases, plans, { minimum });
  console.log(formatLookEval(result.rows));
  if (!result.passed) process.exitCode = 1;
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
