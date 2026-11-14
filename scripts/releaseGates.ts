/**
 * File Description: The release gate record and resume engine. Each acceptance gate (CI, full renders, measured review,
 * Gemini review of each format) leaves a verified record next to the release evidence, and an explicit resume may reuse a
 * PASSED gate only when its key (candidate commit, content hash of the film bytes it reads, gate configuration and the
 * key of the gate before it) is recomputed from the current inputs and matches exactly. A failed gate, a gate with no
 * key, a changed input, a record that fails its schema or digest chain, evidence that changed on disk, and every gate
 * after a gate that re-ran, all run again. The captain's approval is never a gate here: it is called directly and
 * is never recorded or reused.
 * Inputs and outputs: gate specs (inputs, run, evidence), a prior record file and a resume switch -> decisions to reuse or run, and a hash-chained record file.
 * Used by: scripts/release.ts, scripts/releaseGateInputs.ts and scripts/release_resume.test.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** The record schema id; bump it when the record shape changes so older files are rejected, never guessed at. */
export const RECORD_SCHEMA = "aideos.release-gates/1";
/** The record's file name inside a release evidence directory (never inside a film package). */
export const RECORD_FILE = "release-gates.json";
/** Every gate that can be recorded. The approval step is deliberately absent: it can never be reused. */
export const GATE_IDS = ["ci", "production", "review", "gemini-long", "gemini-reel"] as const;
/** One recordable gate. */
export type GateId = (typeof GATE_IDS)[number];

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const evidenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1), sha256: sha256Schema }).strict(),
  z.object({ kind: z.literal("dir"), path: z.string().min(1) }).strict(),
]);
const inputsSchema = z.object({
  commit: z.string().min(1), version: z.string().min(1), film: z.string().min(1), config: sha256Schema, upstream: z.string(),
}).strict();
const entrySchema = z.object({
  id: z.enum(GATE_IDS), result: z.enum(["passed", "failed"]), key: sha256Schema.nullable(), inputs: inputsSchema.nullable(),
  at: z.string().min(1), attempt: z.number().int().positive(), evidence: z.array(evidenceSchema), note: z.string().optional(), digest: sha256Schema,
}).strict();
const recordSchema = z.object({
  schema: z.literal(RECORD_SCHEMA), version: z.string().min(1), attempt: z.number().int().positive(), updatedAt: z.string().min(1), entries: z.array(entrySchema),
}).strict();

/** A file or directory a gate left behind; files carry the hash they had when the gate finished. */
export type Evidence = z.infer<typeof evidenceSchema>;
/** What a gate's key is made of (the config is stored as a digest, the film as the hash of the bytes the gate reads). */
export type GateInputs = z.infer<typeof inputsSchema>;
/** One gate's recorded outcome. */
export type GateEntry = z.infer<typeof entrySchema>;

/** Hex sha256 of text or bytes. */
export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Serializes any JSON value with sorted object keys so equal data always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value) ?? "null";
}

/** Hex sha256 of one regular file's bytes, streamed in blocks. */
export function hashFile(file: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    for (let read = fs.readSync(fd, buffer, 0, buffer.length, null); read > 0; read = fs.readSync(fd, buffer, 0, buffer.length, null)) hash.update(buffer.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Content hash of a directory tree: every file's relative path and bytes in byte order, so renames, edits and additions all change it. Links and special files throw. */
export function hashTree(root: string, excludeName: (name: string) => boolean = () => false): string {
  const lines: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    const names = fs.readdirSync(dir).filter((name) => !excludeName(name)).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const name of names) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink() || !(stat.isDirectory() || stat.isFile())) throw new Error(`Cannot hash a link or special file: ${full}`);
      if (stat.isDirectory()) walk(full, `${prefix}${name}/`);
      else lines.push(`${prefix}${name}\0${stat.size}\0${hashFile(full)}`);
    }
  };
  walk(root, "");
  return sha256(lines.join("\n"));
}

/** Evidence item for a file that exists now. */
export function fileEvidence(file: string): Evidence {
  return { kind: "file", path: path.resolve(file), sha256: hashFile(file) };
}

/** Evidence item for a directory that exists now. */
export function dirEvidence(dir: string): Evidence {
  requireDir(dir);
  return { kind: "dir", path: path.resolve(dir) };
}

/** Throws unless the path is an existing directory. */
function requireDir(dir: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Not a directory: ${dir}`);
}

/** The digest of the (empty) start of a record's chain, bound to its version. */
function genesisDigest(version: string): string {
  return sha256(`${RECORD_SCHEMA}\n${version}`);
}

/** The digest of one entry, chained to the digest before it so no entry can be edited, dropped or reordered unnoticed. */
function entryDigest(previous: string, entry: Omit<GateEntry, "digest">): string {
  return sha256(`${previous}\n${canonicalJson(entry)}`);
}

/** The key of one gate: the hash of its full set of inputs. */
export function gateKey(inputs: GateInputs): string {
  return sha256(canonicalJson(inputs));
}

/** A prior record that passed schema and digest checks, with every reason part of it was refused. */
export interface LoadedRecord {
  file: string;
  attempt: number;
  entries: GateEntry[];
  problems: string[];
}

/** Reads a prior record and verifies it: JSON, schema, version, and the digest chain. Anything wrong keeps that entry and every entry after it out. */
export function loadGateRecord(file: string, version: string): LoadedRecord {
  const empty = (problem: string): LoadedRecord => ({ file, attempt: 0, entries: [], problems: [problem] });
  if (!fs.existsSync(file)) return empty(`no gate record at ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return empty(`gate record is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) return empty(`gate record fails its schema: ${parsed.error.issues[0]?.path.join(".") || "(root)"}: ${parsed.error.issues[0]?.message}`);
  if (parsed.data.version !== version) return empty(`gate record is for release ${parsed.data.version}, not ${version}`);
  const entries: GateEntry[] = [];
  const problems: string[] = [];
  let previous = genesisDigest(version);
  for (const entry of parsed.data.entries) {
    const { digest, ...body } = entry;
    if (digest !== entryDigest(previous, body)) { problems.push(`gate record entry ${entry.id} fails its digest (edited, dropped or reordered); it and everything after it are ignored`); break; }
    if (entries.some((seen) => seen.id === entry.id)) { problems.push(`gate record lists ${entry.id} twice; the repeat and everything after it are ignored`); break; }
    entries.push(entry);
    previous = digest;
  }
  return { file, attempt: parsed.data.attempt, entries, problems };
}

/** What the ledger decided for one gate. */
export interface GateDecision {
  id: GateId;
  action: "reused" | "ran";
  reason: string;
  key: string | null;
  /** For a gate that ran, how it ended. */
  result?: "passed" | "failed";
}

/** One gate: how to key it, how to run it, what it leaves behind, and how to take over from an earlier pass. */
export interface GateSpec {
  id: GateId;
  /** Hashes of what this gate reads, taken as it is about to start. Throws when they cannot be computed (the gate then simply runs, with no key). */
  inputs: () => { film: string; config: unknown };
  /** Runs the gate. Must throw when the gate fails. */
  run: () => Promise<void> | void;
  /** The files and directories the gate left behind, listed right after it passed. */
  evidence: () => Evidence[];
  /** Restores in-memory state from a verified earlier pass (its evidence is already verified). Throwing makes the gate run instead. */
  adopt?: (entry: GateEntry) => Promise<void> | void;
}

/** How a ledger behaves; the record is always written, and read only when `resume` is set. */
export interface LedgerOptions {
  version: string;
  commit: string;
  /** Where this attempt's record is written (next to the release evidence). */
  recordFile: string;
  /** The verified prior record; consulted only when `resume` is true. */
  previous?: LoadedRecord | null;
  resume: boolean;
  /** Visible resume output (reuse and re-run decisions); not called without `resume`. */
  log: (line: string) => void;
  /** Warnings about a record that could not be written; never fatal. */
  warn: (line: string) => void;
  now?: () => Date;
}

/** Decides, per gate and in order, whether to reuse a verified earlier pass or run, and records every outcome. */
export class GateLedger {
  readonly decisions: GateDecision[] = [];
  private readonly entries: GateEntry[] = [];
  private forcedBy: GateId | null = null;
  private lastKey = "";
  private readonly attempt: number;
  private readonly options: LedgerOptions;

  /** Starts an attempt that follows the prior record's attempt number (1 when none was read). */
  constructor(options: LedgerOptions) {
    this.options = options;
    this.attempt = (options.resume && options.previous ? options.previous.attempt : 0) + 1;
    if (options.resume && options.previous) {
      options.log(`Resume: reading gate record ${options.previous.file} (attempt ${options.previous.attempt}, ${options.previous.entries.length} usable entries).`);
      for (const problem of options.previous.problems) options.log(`Resume: ${problem}.`);
    }
  }

  /** Runs one gate or takes over its verified earlier pass; rethrows the gate's own failure after recording it. */
  async gate(spec: GateSpec): Promise<"reused" | "ran"> {
    let inputs: GateInputs | null = null;
    let key: string | null = null;
    let unkeyed = "";
    try {
      const own = spec.inputs();
      inputs = { commit: this.options.commit, version: this.options.version, film: own.film, config: sha256(canonicalJson(own.config)), upstream: this.lastKey };
      key = gateKey(inputs);
    } catch (error) {
      unkeyed = `inputs could not be hashed: ${error instanceof Error ? error.message : String(error)}`;
    }
    const reuse = await this.tryReuse(spec, inputs, key, unkeyed);
    if (reuse.entry) {
      const { digest: _old, ...body } = reuse.entry;
      this.append({ ...body, digest: entryDigest(this.lastDigest(), body) });
      this.lastKey = reuse.entry.key as string;
      this.decide({ id: spec.id, action: "reused", reason: reuse.reason, key });
      return "reused";
    }
    this.forcedBy ??= spec.id;
    this.decide({ id: spec.id, action: "ran", reason: reuse.reason, key });
    return this.execute(spec, inputs, key);
  }

  /** Returns the verified earlier entry to reuse, or the plain reason the gate must run. */
  private async tryReuse(spec: GateSpec, inputs: GateInputs | null, key: string | null, unkeyed: string): Promise<{ entry: GateEntry | null; reason: string }> {
    const { resume, previous } = this.options;
    if (!resume) return { entry: null, reason: "resume not requested" };
    if (this.forcedBy) return { entry: null, reason: `earlier gate ${this.forcedBy} ran` };
    const prior = previous?.entries.find((entry) => entry.id === spec.id);
    if (!prior) return { entry: null, reason: "no usable earlier record" };
    if (prior.result !== "passed") return { entry: null, reason: "it did not pass last time" };
    if (!prior.key || !prior.inputs) return { entry: null, reason: "the earlier record has no key" };
    if (!inputs || !key) return { entry: null, reason: unkeyed || "no key could be computed now" };
    if (gateKey(prior.inputs) !== prior.key) return { entry: null, reason: "the recorded key does not match its recorded inputs" };
    if (prior.key !== key) return { entry: null, reason: `inputs changed: ${changedParts(prior.inputs, inputs).join(", ") || "key differs"}` };
    const bad = firstBadEvidence(prior.evidence);
    if (bad) return { entry: null, reason: `evidence changed: ${bad}` };
    try {
      await spec.adopt?.(prior);
    } catch (error) {
      return { entry: null, reason: `could not take over the earlier result: ${error instanceof Error ? error.message : String(error)}` };
    }
    const where = prior.evidence.find((item) => item.kind === "file")?.path ?? prior.evidence[0]?.path ?? "(no evidence files)";
    return { entry: prior, reason: `passed earlier (attempt ${prior.attempt}, ${prior.at}); key ${key.slice(0, 12)}; evidence ${where}` };
  }

  /** Runs the gate, then records it as passed (with its evidence) or failed. */
  private async execute(spec: GateSpec, inputs: GateInputs | null, key: string | null): Promise<"ran"> {
    try {
      await spec.run();
    } catch (error) {
      this.append(this.entry(spec.id, "failed", key, inputs, [], error instanceof Error ? error.message.split("\n")[0] : String(error)));
      this.finish(spec.id, "failed");
      throw error;
    }
    let evidence: Evidence[] = [];
    let note: string | undefined;
    try {
      evidence = spec.evidence();
    } catch (error) {
      key = null;
      note = `evidence could not be collected, so this pass is never reused: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.append(this.entry(spec.id, "passed", key, key ? inputs : null, evidence, note));
    this.lastKey = key ?? "";
    this.finish(spec.id, "passed");
    return "ran";
  }

  /** The digest the next entry chains to. */
  private lastDigest(): string {
    return this.entries.length ? this.entries[this.entries.length - 1].digest : genesisDigest(this.options.version);
  }

  /** Builds one chained entry for this attempt. */
  private entry(id: GateId, result: "passed" | "failed", key: string | null, inputs: GateInputs | null, evidence: Evidence[], note?: string): GateEntry {
    const body = { id, result, key, inputs, at: (this.options.now?.() ?? new Date()).toISOString(), attempt: this.attempt, evidence, ...(note ? { note } : {}) };
    const previous = this.lastDigest();
    return { ...body, digest: entryDigest(previous, body) };
  }

  /** Adds an entry to this attempt's record and writes it. */
  private append(entry: GateEntry): void {
    this.entries.push(entry);
    this.persist();
  }

  /** Writes the record atomically; a failure only warns, so recording can never stop a release. */
  private persist(): void {
    const record = { schema: RECORD_SCHEMA, version: this.options.version, attempt: this.attempt, updatedAt: (this.options.now?.() ?? new Date()).toISOString(), entries: this.entries };
    const temp = `${this.options.recordFile}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(this.options.recordFile), { recursive: true });
      fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
      fs.renameSync(temp, this.options.recordFile);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch { /* best effort: the warning below is what matters */ }
      this.options.warn(`Gate record not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Records and, in resume mode, prints one decision. */
  private decide(decision: GateDecision): void {
    this.decisions.push(decision);
    if (this.options.resume) this.options.log(`Resume: ${decision.action === "reused" ? "REUSE" : "RUN"} ${decision.id}: ${decision.reason}.`);
  }

  /** Notes how a gate that ran ended. */
  private finish(id: GateId, result: "passed" | "failed"): void {
    const decision = [...this.decisions].reverse().find((item) => item.id === id);
    if (decision) decision.result = result;
  }
}

/** Names the parts of a key that differ, in plain words. */
function changedParts(prior: GateInputs, now: GateInputs): string[] {
  const names: [keyof GateInputs, string][] = [["commit", "commit"], ["version", "version"], ["film", "film bytes"], ["config", "gate configuration"], ["upstream", "an earlier gate's result"]];
  return names.filter(([field]) => prior[field] !== now[field]).map(([, label]) => label);
}

/** The first recorded file or directory that no longer matches, or null when all still do. */
function firstBadEvidence(evidence: Evidence[]): string | null {
  for (const item of evidence) {
    try {
      if (item.kind === "dir") requireDir(item.path);
      else if (!fs.statSync(item.path).isFile() || hashFile(item.path) !== item.sha256) return `${item.path} differs from what was recorded`;
    } catch {
      return `${item.path} is missing`;
    }
  }
  return null;
}

/** A gate without its id; the runner assigns the id by order. */
export type GateStep = Omit<GateSpec, "id">;

/** Everything the acceptance sequence needs, so a test can stub every slow gate. */
export interface ReleaseSteps {
  ci: GateStep;
  production: GateStep;
  review: GateStep;
  /** The rendered outputs, valid once the production gate has run or been taken over. */
  outputs: () => ReadonlyArray<{ format: "long" | "reel"; path: string }>;
  /** The Gemini review of one output. */
  gemini: (output: { format: "long" | "reel"; path: string }) => GateStep;
  /** The captain's typed approval. Always called, never recorded and never reused. */
  approve: () => Promise<void>;
}

/** Runs the acceptance gates in their fixed order through the ledger, then the approval step directly. */
export async function runReleaseGates(ledger: GateLedger, steps: ReleaseSteps): Promise<void> {
  await ledger.gate({ id: "ci", ...steps.ci });
  await ledger.gate({ id: "production", ...steps.production });
  await ledger.gate({ id: "review", ...steps.review });
  for (const output of steps.outputs()) await ledger.gate({ id: output.format === "long" ? "gemini-long" : "gemini-reel", ...steps.gemini(output) });
  await steps.approve();
}
