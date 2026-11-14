/**
 * File Description: Behavioural tests for resuming a release from the failed gate. Slow gates are stubs; the record, keys, hashing, evidence checks and reuse decisions are the real code.
 * Inputs and outputs: synthetic film packages and stubbed gates -> assertions on which gates are reused or re-run, and on the record.
 * Used by: npm test (task: captain asked for resume-from-failed-gate with tests for a-g and a dry-run style end-to-end case).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileEvidence, dirEvidence, GateLedger, hashTree, loadGateRecord, RECORD_FILE, runReleaseGates, sha256, type GateDecision, type GateId, type ReleaseSteps } from "./releaseGates";
import { adoptProduction, ciInputs, geminiInputs, productionInputs, reviewInputs, SOURCE_EXCLUDED, type GateEnvironment, type ProducedOutput } from "./releaseGateInputs";

const ENV: GateEnvironment = {
  platform: "linux", arch: "x64", node: "v20.0.0", browser: null, ttsBackend: "kokoro", renderConcurrency: 2, aideosConfig: sha256("config-1"),
  thresholds: { persistence: 0.65 }, reviewer: { agent: "agy", model: "gemini-test" }, verdictPolicy: { bar: 9, band: 0.5, maxDraws: 2, failedGateCap: 8.5 },
};
const ALL: GateId[] = ["ci", "production", "review", "gemini-long", "gemini-reel"];

/** A throwaway world: a short synthetic film package and a directory for release evidence. */
interface World { root: string; source: string }

/** Creates a world with a tiny package (film, script, narration, a nested design file and an old render that must be ignored). */
function makeWorld(): World {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aideos-resume-test-")));
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "design"), { recursive: true });
  fs.mkdirSync(path.join(source, "renders"), { recursive: true });
  fs.writeFileSync(path.join(source, "film.json"), JSON.stringify({ id: "tiny", title: "Tiny" }));
  fs.writeFileSync(path.join(source, "script.md"), "One short line.\n");
  fs.writeFileSync(path.join(source, "voiceover.wav"), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  fs.writeFileSync(path.join(source, "design", "design.json"), "{\"accent\":\"#112233\"}\n");
  fs.writeFileSync(path.join(source, "renders", "stale.mp4"), "old render, never copied");
  return { root, source };
}

/** What one stubbed release attempt did. */
interface Attempt {
  evidence: string;
  calls: string[];
  log: string[];
  warnings: string[];
  approvals: number;
  decisions: GateDecision[];
  error: Error | null;
  /** The produced package directory in use for the review gates. */
  pkg: string;
}

/** The switches of one stubbed attempt. */
interface AttemptOptions {
  commit?: string;
  resumeFrom?: string;
  env?: Partial<GateEnvironment>;
  /** The gate whose stub throws, as a failing gate does. */
  failAt?: GateId;
  version?: string;
  /** Records resume mode on or off independently of resumeFrom (the flag absent keeps it off). */
  resume?: boolean;
}

/** Runs the same sequence release.ts runs, with stub gates and the real key, record and reuse code. */
async function runAttempt(world: World, options: AttemptOptions = {}): Promise<Attempt> {
  const version = options.version ?? "0.5.1";
  const evidence = fs.mkdtempSync(path.join(world.root, "evidence-"));
  const env: GateEnvironment = { ...ENV, ...options.env };
  const out: Attempt = { evidence, calls: [], log: [], warnings: [], approvals: 0, decisions: [], error: null, pkg: "" };
  const resume = options.resume ?? Boolean(options.resumeFrom);
  const ledger = new GateLedger({
    version, commit: options.commit ?? "c".repeat(40), recordFile: path.join(evidence, RECORD_FILE), resume,
    previous: options.resumeFrom ? loadGateRecord(path.join(options.resumeFrom, RECORD_FILE), version) : null,
    log: (line) => out.log.push(line), warn: (line) => out.warnings.push(line),
  });
  /** One stub gate: counts the call and throws when it is the gate to fail. */
  const stub = (id: GateId): void => { out.calls.push(id); if (options.failAt === id) throw new Error(`${id} failed on purpose`); };
  let pkg = "";
  let outputs: ProducedOutput[] = [];
  const steps: ReleaseSteps = {
    ci: { inputs: () => ciInputs(env), run: () => stub("ci"), evidence: () => [dirEvidence(evidence)] },
    production: {
      inputs: () => productionInputs(world.source, env),
      run: () => {
        stub("production");
        pkg = path.join(evidence, "videos", "tiny");
        fs.cpSync(world.source, pkg, { recursive: true, filter: (file) => !SOURCE_EXCLUDED.includes(path.basename(file)) });
        fs.mkdirSync(path.join(pkg, "renders"), { recursive: true });
        outputs = (["long", "reel"] as const).map((format) => ({ format, path: path.join(pkg, "renders", `${format}.mp4`), durationSec: 12 }));
        for (const output of outputs) fs.writeFileSync(output.path, `${output.format} bytes of ${fs.readFileSync(path.join(world.source, "film.json"), "utf8")}`);
        fs.writeFileSync(path.join(evidence, "production.json"), JSON.stringify({ status: "completed", outputs, warnings: [] }));
      },
      evidence: () => [dirEvidence(pkg), fileEvidence(path.join(evidence, "production.json")), ...outputs.map((output) => fileEvidence(output.path))],
      adopt: (entry) => { ({ pkg, outputs } = adoptProduction(entry)); },
    },
    review: {
      inputs: () => reviewInputs(pkg, env),
      run: () => { stub("review"); for (const name of ["review.json", "review.reel.json"]) fs.writeFileSync(path.join(pkg, name), `{"passed":true,"at":"${out.calls.length}"}`); },
      evidence: () => ["review.json", "review.reel.json"].map((name) => fileEvidence(path.join(pkg, name))),
    },
    outputs: () => outputs,
    gemini: (output) => ({
      inputs: () => geminiInputs(pkg, output, env),
      run: () => stub(output.format === "long" ? "gemini-long" : "gemini-reel"),
      evidence: () => [fileEvidence(output.path)],
    }),
    approve: async () => { out.approvals += 1; },
  };
  try {
    await runReleaseGates(ledger, steps);
  } catch (error) {
    out.error = error as Error;
  }
  out.decisions = ledger.decisions;
  out.pkg = pkg;
  return out;
}

/** The gate ids a decision list reused, in order. */
function reused(attempt: Attempt): GateId[] {
  return attempt.decisions.filter((decision) => decision.action === "reused").map((decision) => decision.id);
}

/** The gate ids a decision list ran, in order. */
function ran(attempt: Attempt): GateId[] {
  return attempt.decisions.filter((decision) => decision.action === "ran").map((decision) => decision.id);
}

/** Flips one byte of a file in place. */
function flipByte(file: string): void {
  const bytes = fs.readFileSync(file);
  bytes[0] ^= 0xff;
  fs.writeFileSync(file, bytes);
}

/** Reads a record file as editable JSON. */
function readRecord(attempt: Attempt): { entries: Record<string, unknown>[] } & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(attempt.evidence, RECORD_FILE), "utf8"));
}

/** Writes edited JSON back as the record. */
function writeRecord(attempt: Attempt, record: unknown): void {
  fs.writeFileSync(path.join(attempt.evidence, RECORD_FILE), JSON.stringify(record, null, 2));
}

test("(a) a changed commit re-runs every gate", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  assert.deepEqual(ran(first), ALL);
  const second = await runAttempt(world, { resumeFrom: first.evidence, commit: "d".repeat(40) });
  assert.deepEqual(reused(second), []);
  assert.deepEqual(ran(second), ALL);
  assert.match(second.log.join("\n"), /RUN ci: inputs changed: commit/);
});

test("(b) one changed byte in one film file re-runs every gate that reads the film, and everything after", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  flipByte(path.join(world.source, "design", "design.json"));
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci"], "CI reads no film bytes, so it is the only gate whose key still holds");
  assert.deepEqual(ran(second), ["production", "review", "gemini-long", "gemini-reel"]);
  assert.match(second.log.join("\n"), /RUN production: inputs changed: film bytes/);
  assert.match(second.log.join("\n"), /RUN review: earlier gate production ran/);
});

test("(b) an old render in the source package, which is never copied, does not change any key", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  fs.writeFileSync(path.join(world.source, "renders", "stale.mp4"), "a different stale render");
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ALL);
});

test("(b) a rendered output changed on disk after production passed makes production run again", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  flipByte(path.join(first.pkg, "renders", "long.mp4"));
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci"]);
  assert.match(second.log.join("\n"), /RUN production: evidence changed: .*long\.mp4 differs from what was recorded/);
});

test("(c) a failed gate re-runs on resume while earlier passed gates with matching keys are reused", async () => {
  const world = makeWorld();
  const first = await runAttempt(world, { failAt: "gemini-reel" });
  assert.deepEqual(first.calls, ["ci", "production", "review", "gemini-long", "gemini-reel"]);
  assert.equal(first.error?.message, "gemini-reel failed on purpose");
  assert.equal(first.approvals, 0, "a failed gate stops the release before approval");
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci", "production", "review", "gemini-long"]);
  assert.deepEqual(second.calls, ["gemini-reel"]);
  assert.equal(second.error, null);
  assert.equal(second.approvals, 1);
});

test("(c) a gate that failed re-runs even when its key matches, and every later gate runs after it", async () => {
  const world = makeWorld();
  const first = await runAttempt(world, { failAt: "production" });
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci"]);
  assert.deepEqual(ran(second), ["production", "review", "gemini-long", "gemini-reel"]);
  assert.match(second.log.join("\n"), /RUN production: it did not pass last time/);
  const third = await runAttempt(world, { failAt: "ci" });
  assert.deepEqual(ran(third), ["ci"], "the release stops at the failing gate");
  const fourth = await runAttempt(world, { resumeFrom: third.evidence });
  assert.deepEqual(ran(fourth), ALL, "a failed CI means nothing after it can be reused");
});

test("(c) review reruns inside the reused production package, so the measured review sees the same bytes", async () => {
  const world = makeWorld();
  const first = await runAttempt(world, { failAt: "review" });
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci", "production"]);
  assert.equal(second.pkg, first.pkg, "the reused production package is the earlier attempt's, and review ran in it");
});

test("(d) a record that is not JSON is rejected and every gate re-runs", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  fs.writeFileSync(path.join(first.evidence, RECORD_FILE), "{ not json");
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(ran(second), ALL);
  assert.match(second.log.join("\n"), /gate record is not valid JSON/);
});

test("(d) a record that fails its schema is rejected and every gate re-runs", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const record = readRecord(first);
  record.entries[0].result = "maybe";
  writeRecord(first, record);
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(ran(second), ALL);
  assert.match(second.log.join("\n"), /gate record fails its schema/);
});

test("(d) hand-editing a failed gate to read as passed is caught by the digest chain and the gate re-runs", async () => {
  const world = makeWorld();
  const first = await runAttempt(world, { failAt: "review" });
  const record = readRecord(first);
  const review = record.entries.find((entry) => entry.id === "review") as Record<string, unknown>;
  review.result = "passed";
  writeRecord(first, record);
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci", "production"]);
  assert.deepEqual(ran(second), ["review", "gemini-long", "gemini-reel"]);
  assert.match(second.log.join("\n"), /entry review fails its digest/);
});

test("(d) hand-editing a recorded key drops that entry and everything after it", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const record = readRecord(first);
  (record.entries[1] as Record<string, unknown>).key = "f".repeat(64);
  writeRecord(first, record);
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci"]);
  assert.deepEqual(ran(second), ["production", "review", "gemini-long", "gemini-reel"]);
});

test("(d) dropping or reordering entries breaks the chain", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const record = readRecord(first);
  record.entries.splice(1, 1);
  writeRecord(first, record);
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci"]);
  assert.match(second.log.join("\n"), /entry review fails its digest/);
});

test("(d) a record for another version is rejected", async () => {
  const world = makeWorld();
  const first = await runAttempt(world, { version: "0.5.0" });
  const second = await runAttempt(world, { resumeFrom: first.evidence, version: "0.5.1" });
  assert.deepEqual(ran(second), ALL);
  assert.match(second.log.join("\n"), /gate record is for release 0\.5\.0, not 0\.5\.1/);
});

test("(d) a missing record runs everything and says so", async () => {
  const world = makeWorld();
  const empty = fs.mkdtempSync(path.join(world.root, "empty-"));
  const second = await runAttempt(world, { resumeFrom: empty });
  assert.deepEqual(ran(second), ALL);
  assert.match(second.log.join("\n"), /no gate record at/);
});

test("(e) a changed measured-review threshold re-runs the review and the Gemini reviews, not CI or production", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const second = await runAttempt(world, { resumeFrom: first.evidence, env: { thresholds: { persistence: 0.7 } } });
  assert.deepEqual(reused(second), ["ci", "production"]);
  assert.deepEqual(ran(second), ["review", "gemini-long", "gemini-reel"]);
  assert.match(second.log.join("\n"), /RUN review: inputs changed: gate configuration/);
});

test("(e) a changed reviewer model or verdict policy re-runs only the Gemini reviews", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const model = await runAttempt(world, { resumeFrom: first.evidence, env: { reviewer: { agent: "agy", model: "another-model" } } });
  assert.deepEqual(reused(model), ["ci", "production", "review"]);
  assert.deepEqual(ran(model), ["gemini-long", "gemini-reel"]);
  const policy = await runAttempt(world, { resumeFrom: first.evidence, env: { verdictPolicy: { bar: 9, band: 0.4, maxDraws: 2, failedGateCap: 8.5 } } });
  assert.deepEqual(ran(policy), ["gemini-long", "gemini-reel"]);
});

test("(e) a changed platform or tool version re-runs CI and so everything", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const second = await runAttempt(world, { resumeFrom: first.evidence, env: { node: "v22.0.0" } });
  assert.deepEqual(ran(second), ALL);
});

test("(e) a changed committed model policy file re-runs the gates that read it", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const second = await runAttempt(world, { resumeFrom: first.evidence, env: { aideosConfig: sha256("config-2") } });
  assert.deepEqual(reused(second), ["ci"]);
});

test("(f) the approval step runs on every attempt, including one that reuses every gate, and is never in the record", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  assert.equal(first.approvals, 1);
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ALL);
  assert.deepEqual(second.calls, []);
  assert.equal(second.approvals, 1, "approval is asked again even though every gate was reused");
  const ids = readRecord(second).entries.map((entry) => entry.id);
  assert.deepEqual(ids, ALL);
});

test("(f) a hand-added approval entry makes the record invalid, so nothing is reused and approval still runs", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const record = readRecord(first);
  record.entries.push({ ...record.entries[0], id: "approval" });
  writeRecord(first, record);
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(ran(second), ALL);
  assert.equal(second.approvals, 1);
});

test("(g) without the resume switch every gate runs in order and prints nothing new, even beside a perfectly good record", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  const second = await runAttempt(world, { resume: false });
  assert.deepEqual(second.calls, ALL);
  assert.deepEqual(ran(second), ALL);
  assert.deepEqual(second.log, []);
  assert.deepEqual(second.warnings, []);
  assert.equal(second.approvals, 1);
  assert.equal(fs.existsSync(path.join(second.evidence, RECORD_FILE)), true, "the record is still written for a later resume");
  assert.ok(first.evidence !== second.evidence);
});

test("(g) the record is never read without the switch: a failing gate in a prior record changes nothing", async () => {
  const world = makeWorld();
  const first = await runAttempt(world, { failAt: "ci" });
  const second = await runAttempt(world, { resume: false });
  assert.deepEqual(second.calls, ALL);
  assert.equal(second.error, null);
  assert.ok(first.error);
});

test("a record that cannot be written only warns and never stops the release", async () => {
  const world = makeWorld();
  const evidence = path.join(world.root, "evidence-blocked");
  fs.writeFileSync(evidence, "a file where the evidence directory should be");
  const warnings: string[] = [];
  const ledger = new GateLedger({ version: "0.5.1", commit: "c".repeat(40), recordFile: path.join(evidence, RECORD_FILE), resume: false, log: () => {}, warn: (line) => warnings.push(line) });
  const result = await ledger.gate({ id: "ci", inputs: () => ({ film: "none", config: {} }), run: () => {}, evidence: () => [] });
  assert.equal(result, "ran");
  assert.match(warnings[0], /Gate record not written/);
});

test("a gate whose inputs cannot be hashed has no key and always runs", async () => {
  const world = makeWorld();
  const evidence = fs.mkdtempSync(path.join(world.root, "evidence-"));
  const first = new GateLedger({ version: "0.5.1", commit: "c".repeat(40), recordFile: path.join(evidence, RECORD_FILE), resume: false, log: () => {}, warn: () => {} });
  await first.gate({ id: "ci", inputs: () => { throw new Error("unreadable"); }, run: () => {}, evidence: () => [] });
  const next = fs.mkdtempSync(path.join(world.root, "evidence-"));
  const lines: string[] = [];
  const second = new GateLedger({ version: "0.5.1", commit: "c".repeat(40), recordFile: path.join(next, RECORD_FILE), resume: true, previous: loadGateRecord(path.join(evidence, RECORD_FILE), "0.5.1"), log: (line) => lines.push(line), warn: () => {} });
  assert.equal(await second.gate({ id: "ci", inputs: () => ({ film: "none", config: {} }), run: () => {}, evidence: () => [] }), "ran");
  assert.match(lines.join("\n"), /RUN ci: the earlier record has no key/);
});

test("a gate whose evidence cannot be collected is recorded without a key and never reused", async () => {
  const world = makeWorld();
  const evidence = fs.mkdtempSync(path.join(world.root, "evidence-"));
  const first = new GateLedger({ version: "0.5.1", commit: "c".repeat(40), recordFile: path.join(evidence, RECORD_FILE), resume: false, log: () => {}, warn: () => {} });
  await first.gate({ id: "ci", inputs: () => ({ film: "none", config: {} }), run: () => {}, evidence: () => { throw new Error("no report written"); } });
  const loaded = loadGateRecord(path.join(evidence, RECORD_FILE), "0.5.1");
  assert.equal(loaded.entries[0].key, null);
  assert.match(loaded.entries[0].note ?? "", /never reused/);
});

test("a production pass whose recorded outputs are not clean is not taken over", async () => {
  const world = makeWorld();
  const first = await runAttempt(world);
  fs.writeFileSync(path.join(first.evidence, "production.json"), JSON.stringify({ status: "completed", outputs: [], warnings: [] }));
  const second = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(reused(second), ["ci"]);
});

test("hashTree changes with one byte, one rename or one added file, ignores excluded names, and refuses links", () => {
  const world = makeWorld();
  const base = hashTree(world.source);
  assert.equal(hashTree(world.source), base, "stable across calls");
  assert.equal(hashTree(world.source, (name) => name === "renders"), hashTree(world.source, (name) => name === "renders"));
  assert.notEqual(hashTree(world.source, (name) => name === "renders"), base);
  flipByte(path.join(world.source, "script.md"));
  assert.notEqual(hashTree(world.source), base);
  flipByte(path.join(world.source, "script.md"));
  assert.equal(hashTree(world.source), base);
  fs.renameSync(path.join(world.source, "script.md"), path.join(world.source, "script2.md"));
  assert.notEqual(hashTree(world.source), base);
  fs.renameSync(path.join(world.source, "script2.md"), path.join(world.source, "script.md"));
  fs.symlinkSync(path.join(world.source, "film.json"), path.join(world.source, "link.json"));
  assert.throws(() => hashTree(world.source), /link or special file/);
});

test("dry-run style end to end: attempt 1 fails at the last gate, attempt 2 resumes and shows each reuse and re-run decision", async () => {
  const world = makeWorld();
  const first = await runAttempt(world, { failAt: "gemini-reel" });
  assert.deepEqual(first.log, [], "an ordinary run prints no resume lines");

  flipByte(path.join(world.source, "script.md"));
  const edited = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(edited.decisions.map((d) => `${d.id}:${d.action}`), ["ci:reused", "production:ran", "review:ran", "gemini-long:ran", "gemini-reel:ran"]);
  flipByte(path.join(world.source, "script.md"));

  const third = await runAttempt(world, { resumeFrom: first.evidence });
  assert.deepEqual(third.decisions.map((d) => `${d.id}:${d.action}`), ["ci:reused", "production:reused", "review:reused", "gemini-long:reused", "gemini-reel:ran"]);
  const lines = third.log.join("\n");
  assert.match(lines, /Resume: reading gate record .* \(attempt 1, 5 usable entries\)/);
  assert.match(lines, /REUSE production: passed earlier \(attempt 1, [^)]*\); key [0-9a-f]{12}; evidence /);
  assert.match(lines, /RUN gemini-reel: it did not pass last time/);
  assert.equal(third.decisions[third.decisions.length - 1].result, "passed");
  assert.equal(third.approvals, 1);
  assert.deepEqual(third.calls, ["gemini-reel"]);
  const record = readRecord(third);
  assert.equal(record.attempt, 2);
  assert.deepEqual((record.entries as { attempt: number }[]).map((entry) => entry.attempt), [1, 1, 1, 1, 2]);
  assert.equal(loadGateRecord(path.join(third.evidence, RECORD_FILE), "0.5.1").entries.length, 5, "the new record verifies on its own, carried entries included");

  const fourth = await runAttempt(world, { resumeFrom: third.evidence });
  assert.deepEqual(reused(fourth), ALL, "a later resume from the new record reuses everything that now passed");
});
