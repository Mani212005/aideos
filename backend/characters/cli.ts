/**
 * File Description: `aideos character check|sheet`: validates, stamps and draws aideos.character/1 specs for agents and people.
 * Inputs and outputs: spec files or library ids -> per-field findings, stamped hash, rig/receive summary and sheet PNGs; exit 1 on any error.
 * Used by: backend/cli.ts (registerCharacterCommands) and the character journey tests (checkCharacterFile).
 */
import fs from "node:fs";
import path from "node:path";
import { Box3 } from "three";
import type { Command } from "commander";
import { actionCompatibility, formatIssues, parseCharacter } from "../../src/dl/characters/validate";
import { characterHash, characterRigId } from "../../src/dl/characters/hash";
import { triangleCount } from "../../src/dl/characters/expand";
import { buildCharacter } from "../../src/dl/scene/characters/build";
import { RECEIVE_NEEDS } from "../../src/dl/scene/validateStage";
import { fitReceiveSpan } from "../performance/bindReceive";
import { formatSpecJson, withHash } from "./format";
import { renderCharacterSheet, resolveSpecArgument } from "./sheet";

/** Everything `aideos character check` learns about one spec. */
export interface CharacterReport {
  file: string;
  ok: boolean;
  stamped: boolean;
  errors: string[];
  warnings: string[];
  summary?: { id: string; rig: string; hash: string; joints: number; meshes: number; triangles: number; drawCalls: number; heightUnits: number; headsTall: number; expressions: string[] };
  receive?: { ok: boolean; warnings: string[]; error?: string };
}

// Validates one spec file (stamping its hash when asked), measures its geometry and tries the receive under the fail policy.
export function checkCharacterFile(file: string, options: { stamp?: boolean } = {}): CharacterReport {
  const report: CharacterReport = { file, ok: false, stamped: false, errors: [], warnings: [] };
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { report.errors.push(`(file): ${fs.existsSync(file) ? `not valid JSON: ${err instanceof Error ? err.message : String(err)}` : "missing or unreadable"}`); return report; }
  let parsed = parseCharacter(raw, { requireHash: true });
  if (options.stamp && parsed.spec && parsed.errors.every((e) => e.path === "hash")) {
    fs.writeFileSync(file, `${formatSpecJson(withHash(raw, characterHash(parsed.spec)))}\n`);
    report.stamped = true;
    parsed = parseCharacter(JSON.parse(fs.readFileSync(file, "utf8")), { requireHash: true });
  }
  report.errors.push(...formatIssues(parsed.errors));
  if (!parsed.spec || !parsed.rig || !parsed.parts) return report;
  const spec = parsed.spec;
  report.errors.push(...formatIssues(actionCompatibility(spec, RECEIVE_NEEDS)));
  const art = buildCharacter(spec);
  try {
    const box = new Box3().setFromObject(art.rig.root);
    const head = parsed.parts.find((p) => p.geometry.kind === "head");
    const headBox = head ? new Box3().setFromObject(art.parts.meshes[head.id]) : null;
    const height = box.max.y - Math.min(0, box.min.y), headHeight = headBox ? headBox.max.y - headBox.min.y : 1;
    report.summary = {
      id: spec.id, rig: characterRigId(spec), hash: characterHash(spec), joints: parsed.rig.joints.length, meshes: parsed.parts.length,
      triangles: parsed.parts.reduce((sum, part) => sum + triangleCount(part), 0), drawCalls: parsed.parts.length + art.parts.inks.length,
      heightUnits: Number(height.toFixed(3)), headsTall: Number((height / headHeight).toFixed(2)), expressions: Object.keys(spec.expressions),
    };
  } finally { art.dispose(); }
  try {
    const fitted = fitReceiveSpan(69, 0, 160, 30, [0, 0, 0], { rig: parsed.rig, policy: "fail" });
    report.receive = { ok: true, warnings: fitted.warnings.map((w) => `${w.field}: ${w.message}`) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.receive = { ok: false, warnings: [], error: message };
    report.warnings.push(`receive-v1 cannot run within this character's limits (${message}); a design may still use it with "limits": "clamp" on the performance, which pulls the grip in and reports it`);
  }
  report.ok = report.errors.length === 0;
  return report;
}

// Renders one report for a terminal or an agent to act on.
export function formatCharacterReport(report: CharacterReport): string {
  const lines = [`${report.ok ? "PASS" : "FAIL"} character ${path.relative(process.cwd(), report.file) || report.file}${report.stamped ? " (hash stamped)" : ""}`];
  for (const e of report.errors) lines.push(`  error ${e}`);
  for (const w of report.warnings) lines.push(`  warn  ${w}`);
  const s = report.summary;
  if (s) lines.push(`  ${s.rig}  hash ${s.hash.slice(0, 16)}  ${s.joints} joints  ${s.meshes} meshes  ${s.triangles} triangles  ${s.drawCalls} draw calls  ${s.heightUnits} units tall (${s.headsTall} heads)`, `  expressions: ${s.expressions.join(", ")}`);
  if (report.receive?.ok) lines.push(`  receive-v1: retargets within limits${report.receive.warnings.length ? ` (${report.receive.warnings.join("; ")})` : ""}`);
  return lines.join("\n");
}

// Parses "x,y,units" into a stage placement.
function placementOption(value: string): { position: [number, number]; unitsToStage: number } {
  const [x, y, units] = value.split(",").map(Number);
  if (![x, y, units].every(Number.isFinite) || units <= 0) throw new Error(`--placement needs x,y,units (for example 940,1210,85), got "${value}"`);
  return { position: [x, y], unitsToStage: units };
}

// Registers the character command group on the aideos CLI.
export function registerCharacterCommands(program: Command): void {
  const character = program.command("character").description("Check, stamp and draw aideos.character/1 specs (characters are data; see characters/README.md)");
  character
    .command("check")
    .description("Validate character specs, naming every bad field; --stamp writes the content hash")
    .argument("<specs...>", "spec files or library character ids")
    .option("--stamp", "write the current content hash into each spec that is otherwise valid")
    .option("--json", "print the reports as JSON")
    .action((specs: string[], options: { stamp?: boolean; json?: boolean }) => {
      const reports = specs.map((arg) => {
        try { return checkCharacterFile(resolveSpecArgument(arg), options); } catch (err) { return { file: arg, ok: false, stamped: false, errors: [err instanceof Error ? err.message : String(err)], warnings: [] } satisfies CharacterReport; }
      });
      console.log(options.json ? JSON.stringify(reports, null, 2) : reports.map(formatCharacterReport).join("\n\n"));
      if (reports.some((r) => !r.ok)) process.exitCode = 1;
    });
  character
    .command("sheet")
    .description("Render the model sheet, expression sheet and receive stills (wide, reel, phase strip) in headless Chrome")
    .argument("<spec>", "spec file or library character id")
    .option("--out <dir>", "output directory (default .frames/characters/<id>)")
    .option("--placement <x,y,units>", "stage placement for the receive stills", placementOption)
    .option("--clamp", "clamp the receive to the character's limits instead of refusing it")
    .option("--gpu", "use the GPU instead of software GL (faster, not reproducible across machines)")
    .action(async (spec: string, options: { out?: string; placement?: { position: [number, number]; unitsToStage: number }; clamp?: boolean; gpu?: boolean }) => {
      const result = await renderCharacterSheet(resolveSpecArgument(spec), { outDir: options.out, placement: options.placement, policy: options.clamp ? "clamp" : "fail", gpu: options.gpu });
      console.log(`${result.hashStatus}`);
      if (!result.retarget.ok) console.log(`receive-v1 not drawn: ${result.retarget.error}`);
      for (const w of result.retarget.warnings) console.log(`warn  ${w}`);
      for (const file of result.files) console.log(`wrote ${path.relative(process.cwd(), file)}`);
    });
}
