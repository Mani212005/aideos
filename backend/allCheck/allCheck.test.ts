/**
 * File Description: Tests of `aideos all-check`: command-line parsing, agent choice, preflight, the
 * one-run-per-video lock, starting a run (with a fake tmux), the round records and pass rules, the
 * verdict and finish side effects, waiting for a result, and the argv rewrite. No model, render or
 * tmux window is ever touched: every outside effect is injected.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import type { GeminiReviewReport, PairwiseRunReport } from "../geminiReview";
import type { ReviewReport } from "../review/types";
import { agentPrompt, buildAgentCommand, resolveAgent } from "./agent";
import { forbiddenGenerationMatch, loadAideosConfig, reviewerModel, type AideosConfig } from "../aideosConfig";
import { buildBrief } from "./brief";
import { ALL_CHECK_SUBCOMMANDS, rewriteAllCheckArgv } from "./cli";
import { betterEarlierRound, dirtyRepoPaths, rankRecord, rollbackFilm, settleRound, strayFiles, writeRepoBaseline } from "./best";
import { decideVerdict, finishRun, type FinishDeps } from "./finish";
import { startAllCheck, runStatus, waitForResult, type IdleWatchdog, type StartDeps } from "./index";
import { writeLaunchScript } from "./launch";
import { acquireLock, lockIsLive, lockPath, readLock, releaseLock, type LockDeps, type LockRecord } from "./lock";
import { parseAllCheckOptions } from "./options";
import { formatPreflight, packageProblems, runPreflight, type PreflightDeps, type ProcResult } from "./preflight";
import { evaluateRecord, readRecords, recordFrameCheck, runRound, type RoundDeps } from "./round";
import { allCheckDir, AllCheckError, recordPath, type AllCheckConfig, type FormatRoundRecord } from "./types";

// Makes a throwaway video package (film.json plus a voiceover) in the test videos folder.
function makePackage(slug: string, opts: { voiceover?: boolean } = {}): string {
  const dir = path.join(getVideosDir(), slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify({ id: slug, shots: [{ id: "a" }], voiceover: { src: `videos/${slug}/voiceover.wav` } }));
  if (opts.voiceover !== false) fs.writeFileSync(path.join(dir, "voiceover.wav"), "RIFF");
  return dir;
}

// Removes a throwaway package.
function dropPackage(slug: string): void {
  fs.rmSync(path.join(getVideosDir(), slug), { recursive: true, force: true });
}

// Preflight dependencies where every tool is installed and agy is signed in, with overrides.
function fakePreflight(over: { missing?: string[]; agy?: Partial<ProcResult> } = {}): PreflightDeps {
  return {
    which: (c) => (over.missing?.includes(c) ? null : `/usr/bin/${c}`),
    run: () => ({ status: 0, stdout: "gemini-3.8-flash-high\n", stderr: "", ...over.agy }),
  };
}

// Lock dependencies with controllable liveness.
function fakeLock(state: { windows: Set<string>; pids?: Set<number>; now?: number }): LockDeps {
  return {
    windowAlive: (id) => state.windows.has(id),
    pidAlive: (pid) => state.pids?.has(pid) ?? false,
    now: () => state.now ?? Date.now(),
  };
}

const NO_DASH = /[\u2013\u2014]/;

test("options: defaults, validation and aliases", () => {
  const ok = parseAllCheckOptions("hnsw");
  assert.deepEqual({ rounds: ok.rounds, target: ok.target, agent: ok.agent, reference: ok.reference }, { rounds: 6, target: 9, agent: undefined, reference: undefined });

  assert.throws(() => parseAllCheckOptions("Bad Slug"), /not a film slug/);
  assert.throws(() => parseAllCheckOptions(""), /not a film slug/);
  for (const rounds of ["0", "31", "1.5", "abc"]) assert.throws(() => parseAllCheckOptions("hnsw", { rounds }), /--rounds/);
  for (const target of ["0", "11", "x"]) assert.throws(() => parseAllCheckOptions("hnsw", { target }), /--target/);
  assert.throws(() => parseAllCheckOptions("hnsw", { agent: "gpt" }), /--agent/);
  assert.equal(parseAllCheckOptions("hnsw", { agent: "Antigravity" }).agent, "agy");
  assert.equal(parseAllCheckOptions("hnsw", { rounds: "3", target: "8.5" }).rounds, 3);
  assert.equal(parseAllCheckOptions("hnsw", { rounds: 3, target: 8.5 }).target, 8.5);

  assert.throws(() => parseAllCheckOptions("hnsw", { reference: "/nope/ref.mp4" }), /--reference/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "allcheck-ref-"));
  const ref = path.join(tmp, "ref.mp4");
  fs.writeFileSync(ref, "x");
  assert.equal(parseAllCheckOptions("hnsw", { reference: ref }).reference, ref);
  fs.writeFileSync(path.join(tmp, "ref.txt"), "x");
  assert.throws(() => parseAllCheckOptions("hnsw", { reference: path.join(tmp, "ref.txt") }), /--reference/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const POLICY: AideosConfig = {
  schema: "aideos.config/1",
  videoModels: {
    generation: { agent: "claude", model: "claude-sonnet-5-5" },
    reviewer: { agent: "agy", model: "gemini-3.8-flash-high" },
    forbiddenGenerationModels: ["gemini-3.1-pro"],
  },
};

test("config: the committed aideos.config.json holds the video model policy", () => {
  const cfg = loadAideosConfig();
  assert.deepEqual(cfg.videoModels.generation, { agent: "claude", model: "claude-sonnet-5-5" });
  assert.deepEqual(cfg.videoModels.reviewer, { agent: "agy", model: "gemini-3.8-flash-high" });
  assert.ok(forbiddenGenerationMatch("gemini-3.1-pro-high", cfg.videoModels));
  assert.ok(forbiddenGenerationMatch("Gemini-3-1-Pro", cfg.videoModels));
  assert.equal(forbiddenGenerationMatch("gemini-3.8-flash-high", cfg.videoModels), undefined);
});

test("config: a missing, malformed or incomplete file is an error, not a default", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-config-"));
  const file = path.join(tmp, "c.json");
  assert.throws(() => loadAideosConfig(file), /cannot read/);
  fs.writeFileSync(file, "{ nope");
  assert.throws(() => loadAideosConfig(file), /cannot read/);
  fs.writeFileSync(file, JSON.stringify({ videoModels: { generation: { agent: "codex", model: "x" } } }));
  assert.throws(() => loadAideosConfig(file), /generation must be/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("config: the reviewer model is explicit, then env, then the config", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-config-"));
  const file = path.join(tmp, "c.json");
  fs.writeFileSync(file, JSON.stringify(POLICY));
  assert.equal(reviewerModel(undefined, {}, file), "gemini-3.8-flash-high");
  assert.equal(reviewerModel(undefined, { AIDEOS_GEMINI_REVIEW_MODEL: "m-env" }, file), "m-env");
  assert.equal(reviewerModel("m-explicit", { AIDEOS_GEMINI_REVIEW_MODEL: "m-env" }, file), "m-explicit");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("agent: the configured generation agent and model win, whoever invoked all-check", () => {
  assert.deepEqual(resolveAgent({ config: POLICY }), { agent: "claude", model: "claude-sonnet-5-5", source: "config", note: undefined });
  // An explicit agent without a model gets that agent's configured model, never its own default.
  assert.equal(resolveAgent({ flag: "agy", config: POLICY }).model, "gemini-3.8-flash-high");
  assert.deepEqual(
    (({ agent, model, source }) => ({ agent, model, source }))(resolveAgent({ flag: "claude", modelFlag: "claude-opus-5-5", config: POLICY })),
    { agent: "claude", model: "claude-opus-5-5", source: "flag" },
  );
});

test("agent: gemini-3.1-pro is refused for generation unless explicitly allowed", () => {
  assert.throws(() => resolveAgent({ flag: "agy", modelFlag: "gemini-3.1-pro-high", config: POLICY }), (e: unknown) => {
    assert.ok(e instanceof AllCheckError);
    assert.match(e.message, /not allowed for video generation/);
    assert.match(e.message, /--allow-forbidden-model/);
    return true;
  });
  const allowed = resolveAgent({ flag: "agy", modelFlag: "gemini-3.1-pro-high", allowForbiddenModel: true, config: POLICY });
  assert.equal(allowed.model, "gemini-3.1-pro-high");
  assert.match(allowed.note ?? "", /allowed by --allow-forbidden-model/);
});

test("agent: the launch command names the model for each agent", () => {
  const claude = buildAgentCommand("claude", "/b/brief.md", "hnsw", "claude-sonnet-5-5");
  assert.equal(claude.command, "claude");
  assert.deepEqual(claude.args, ["--model", "claude-sonnet-5-5", "--dangerously-skip-permissions", agentPrompt("/b/brief.md", "hnsw")]);
  const agy = buildAgentCommand("agy", "/b/brief.md", "hnsw", "gemini-3.8-flash-high");
  assert.deepEqual(agy.args, ["--model", "gemini-3.8-flash-high", "--prompt-interactive", agentPrompt("/b/brief.md", "hnsw"), "--dangerously-skip-permissions"]);
});

test("preflight: a ready machine has no problems, each failure names its fix", () => {
  const slug = "ac-preflight";
  makePackage(slug);
  try {
    assert.deepEqual(runPreflight({ slug, agent: "agy" }, fakePreflight()), []);

    for (const [tool, check] of [["ffmpeg", "ffmpeg"], ["ffprobe", "ffmpeg"], ["tesseract", "tesseract"], ["tmux", "tmux"]] as const) {
      const problems = runPreflight({ slug, agent: "agy" }, fakePreflight({ missing: [tool] }));
      assert.deepEqual(problems.map((p) => p.check), [check]);
      assert.match(problems[0].fix, /brew install/);
    }
    assert.deepEqual(runPreflight({ slug, agent: "claude" }, fakePreflight({ missing: ["claude"] })).map((p) => p.check), ["agent"]);

    // Signed-out agy prints a sign-in message; a nonzero exit counts too; a missing agy is its own message.
    const signedOut = runPreflight({ slug, agent: "agy" }, fakePreflight({ agy: { status: 1, stderr: "Error: Please sign in to view available models." } }));
    assert.equal(signedOut.length, 1);
    assert.equal(signedOut[0].check, "agy-login");
    assert.match(signedOut[0].fix, /agy/);
    assert.match(runPreflight({ slug, agent: "claude" }, fakePreflight({ missing: ["agy"] })).find((p) => p.check === "agy-login")?.message ?? "", /not on PATH/);
    const timedOut = runPreflight({ slug, agent: "agy" }, fakePreflight({ agy: { status: null, error: "spawnSync agy ETIMEDOUT" } }));
    assert.match(timedOut[0].message, /did not answer/);

    const message = formatPreflight(slug, runPreflight({ slug, agent: "agy" }, fakePreflight({ missing: ["ffmpeg", "tmux"] })));
    assert.match(message, /2 things to fix/);
    assert.equal((message.match(/fix:/g) ?? []).length, 2);
    assert.ok(!NO_DASH.test(message));
  } finally {
    dropPackage(slug);
  }
});

test("preflight: missing package and missing voiceover", () => {
  assert.equal(packageProblems("ac-does-not-exist")[0].check, "package");
  assert.match(packageProblems("ac-does-not-exist")[0].message, /no video package/);

  const slug = "ac-novoice";
  makePackage(slug, { voiceover: false });
  try {
    const problems = runPreflight({ slug, agent: "agy" }, fakePreflight());
    assert.deepEqual(problems.map((p) => p.check), ["voiceover"]);
    assert.match(problems[0].fix, /aideos produce/);
  } finally {
    dropPackage(slug);
  }

  const bad = "ac-badfilm";
  const dir = makePackage(bad);
  fs.writeFileSync(path.join(dir, "film.json"), "{not json");
  try {
    assert.equal(packageProblems(bad)[0].check, "package");
    assert.match(packageProblems(bad)[0].message, /not a usable film/);
  } finally {
    dropPackage(bad);
  }
});

test("lock: one run per video, a live run is named, a stale lock is replaced", () => {
  const slug = "ac-lock";
  makePackage(slug);
  try {
    const record = (over: Partial<LockRecord> = {}): LockRecord => ({ slug, agent: "agy", startedAt: new Date().toISOString(), launcherPid: 111, ...over });
    const state: { windows: Set<string>; pids: Set<number>; now?: number } = { windows: new Set<string>(["@9"]), pids: new Set<number>([111]) };
    const deps = fakeLock(state);

    assert.equal(acquireLock(record({ tmuxWindowId: "@9", tmuxSession: "aideos" }), deps).tookOverStale, false);
    assert.ok(fs.existsSync(lockPath(slug)));

    // A second run is refused and told where the first one is.
    assert.throws(() => acquireLock(record(), deps), (err: Error) => err instanceof AllCheckError && /already running/.test(err.message) && /@9/.test(err.message) && /aideos all-check wait ac-lock/.test(err.message));
    assert.equal(readLock(slug)?.tmuxWindowId, "@9");

    // The window closes: the lock is stale and the next run takes it over.
    state.windows.clear();
    assert.equal(lockIsLive(readLock(slug)!, deps), false);
    assert.equal(acquireLock(record({ launcherPid: 222 }), deps).tookOverStale, true);
    assert.equal(readLock(slug)?.launcherPid, 222);

    // A lock with no window yet is the launcher starting: live while its process lives and the grace lasts, stale after.
    state.pids.add(222);
    assert.equal(lockIsLive(readLock(slug)!, deps), true);
    state.pids.clear();
    assert.equal(lockIsLive(readLock(slug)!, deps), false);
    state.pids.add(222);
    state.now = Date.now() + 10 * 60_000;
    assert.equal(lockIsLive(readLock(slug)!, deps), false);

    releaseLock(slug);
    assert.equal(readLock(slug), null);
  } finally {
    dropPackage(slug);
  }
});

// A start's dependencies with a fake tmux window.
function fakeStart(over: Partial<StartDeps> & { windows?: Set<string> } = {}): StartDeps & { launched: string[] } {
  const windows = over.windows ?? new Set<string>();
  const launched: string[] = [];
  return {
    env: {},
    preflight: fakePreflight(),
    lock: fakeLock({ windows, pids: new Set() }),
    tmux: () => ({ status: 0, stdout: "", stderr: "" }),
    studioRunning: () => false,
    now: () => new Date("2026-10-02T10:00:00.000Z"),
    launch: (slug) => {
      launched.push(slug);
      windows.add("@7");
      return { windowId: "@7", session: "aideos", attachCommand: "tmux attach -t aideos" };
    },
    ...over,
    launched,
  } as StartDeps & { launched: string[] };
}

test("start: writes config, brief and launch script, opens one window, refuses a second run", () => {
  const slug = "ac-start";
  makePackage(slug);
  try {
    const windows = new Set<string>();
    const deps = fakeStart({ windows });
    const options = parseAllCheckOptions(slug, { rounds: "4", target: "9.2", agent: "claude" });
    const started = startAllCheck(options, deps);

    assert.equal(started.agent.agent, "claude");
    assert.equal(started.window.windowId, "@7");
    const dir = allCheckDir(slug);
    const config = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8")) as AllCheckConfig;
    assert.deepEqual({ rounds: config.rounds, target: config.target, agent: config.agent, studioWasRunning: config.studioWasRunning }, { rounds: 4, target: 9.2, agent: "claude", studioWasRunning: false });
    const brief = fs.readFileSync(started.briefPath, "utf8");
    assert.match(brief, new RegExp(`Only touch \`videos/${slug}/\``));
    assert.match(brief, /never score your own work|You never score your own work/);
    assert.match(brief, /Round budget: 4 rounds/);
    assert.match(brief, /treehouse/);
    assert.ok(!NO_DASH.test(brief));
    const script = fs.readFileSync(path.join(dir, "launch.sh"), "utf8");
    assert.match(script, /--dangerously-skip-permissions/);
    assert.match(script, /exec "\$\{SHELL:-bash\}"/);
    assert.equal(readLock(slug)?.tmuxWindowId, "@7");

    // The second start is refused before anything new is opened or written.
    assert.throws(() => startAllCheck(options, deps), /already running/);
    assert.equal(deps.launched.length, 1);
    assert.equal(runStatus(slug, deps.lock).state, "running");
  } finally {
    dropPackage(slug);
  }
});

test("start: a failing preflight starts nothing and leaves no lock; an unknown video is refused early", () => {
  const slug = "ac-start-fail";
  makePackage(slug);
  try {
    const deps = fakeStart({ preflight: fakePreflight({ agy: { status: 1, stderr: "Please sign in" } }) });
    assert.throws(() => startAllCheck(parseAllCheckOptions(slug, { agent: "agy" }), deps), /agy is not signed in/);
    assert.equal(deps.launched.length, 0);
    assert.equal(readLock(slug), null);
    assert.ok(!fs.existsSync(path.join(allCheckDir(slug), "config.json")));
  } finally {
    dropPackage(slug);
  }
  const deps = fakeStart();
  assert.throws(() => startAllCheck(parseAllCheckOptions("ac-ghost", { agent: "agy" }), deps), /no video package/);
  assert.ok(!fs.existsSync(path.join(getVideosDir(), "ac-ghost")));
});

test("start: an earlier run's files are archived, a stale lock is replaced", () => {
  const slug = "ac-restart";
  makePackage(slug);
  try {
    const deps = fakeStart();
    startAllCheck(parseAllCheckOptions(slug, { agent: "agy" }), deps);
    fs.mkdirSync(path.join(allCheckDir(slug), "round-1"));
    fs.writeFileSync(path.join(allCheckDir(slug), "round-1", "long.json"), "{}");
    fs.writeFileSync(path.join(allCheckDir(slug), "result.json"), "{}");

    // The agent window disappears without finishing: the next run takes over and starts from a clean folder.
    (deps.lock as unknown as { windowAlive: (id: string) => boolean }).windowAlive = () => false;
    const second = startAllCheck(parseAllCheckOptions(slug, { agent: "agy" }), deps);
    assert.equal(second.tookOverStaleLock, true);
    assert.ok(!fs.existsSync(path.join(allCheckDir(slug), "round-1")));
    assert.ok(!fs.existsSync(path.join(allCheckDir(slug), "result.json")));
    const archived = fs.readdirSync(path.join(allCheckDir(slug), "archive"));
    assert.equal(archived.length, 1);
    assert.ok(fs.existsSync(path.join(allCheckDir(slug), "archive", archived[0], "round-1", "long.json")));
  } finally {
    dropPackage(slug);
  }
});

test("launch script quotes a hostile slug-free path and keeps the window open", () => {
  const slug = "ac-script";
  makePackage(slug);
  try {
    fs.mkdirSync(allCheckDir(slug), { recursive: true });
    const script = writeLaunchScript(slug, "agy", "/tmp/it's a brief.md", "gemini-3.8-flash-high");
    const text = fs.readFileSync(script, "utf8");
    assert.match(text, /'agy' '--model' 'gemini-3.8-flash-high' '--prompt-interactive'/);
    assert.ok(text.includes(`'\\''`), "single quotes in a path are escaped");
    assert.equal(fs.statSync(script).mode & 0o111, 0o111);
  } finally {
    dropPackage(slug);
  }
});

// Minimal reviewer report with the given score and gate state.
function geminiReport(score: number, gateOk = true): GeminiReviewReport {
  return {
    overallScore: score,
    verdict: score >= 9 && gateOk ? "ACCEPT" : "REVISE",
    summary: "s",
    criteria: [{ name: "persistent_stage", title: "Persistent stage", isGate: true, score: gateOk ? 9 : 4, passed: gateOk, evidenceTimestamps: ["0:10"], reason: "r" }],
    feedback: [{ priority: "high", timestamp: "0:12", issue: "clipped", recommendation: "move it" }],
    model: "m",
    evaluatedAt: "t",
    videoHash: "h",
    videoPath: "p",
  } as unknown as GeminiReviewReport;
}

// Minimal measured report.
function measuredReport(passed: boolean): ReviewReport {
  return { passed, gateFailures: passed ? [] : ["overlap"], softFailures: ["pacing"], recommendations: passed ? [] : ["[gate] overlap: fix it"] } as unknown as ReviewReport;
}

// Round dependencies that render a stub file and return the given reports.
function fakeRound(over: { score?: number; gateOk?: boolean; measuredOk?: boolean; pairwise?: "Video A" | "Video B" | "Tie"; geminiError?: string } = {}): RoundDeps & { renders: string[] } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "allcheck-render-"));
  const renders: string[] = [];
  return {
    renders,
    render: async (slug, format) => {
      renders.push(format);
      const file = path.join(tmp, `${slug}-${format}.mp4`);
      fs.writeFileSync(file, `video-${format}`);
      return file;
    },
    measure: async (req) => {
      fs.mkdirSync(req.outDir, { recursive: true });
      fs.writeFileSync(path.join(req.outDir, "review.json"), "{}");
      return measuredReport(over.measuredOk ?? true);
    },
    gemini: async () => {
      if (over.geminiError) throw new Error(over.geminiError);
      return geminiReport(over.score ?? 9.3, over.gateOk ?? true);
    },
    pairwise: async () => ({ winner: over.pairwise ?? "Video A", videoA: { finalRating: 9.1 }, videoB: { finalRating: 8.8 } }) as unknown as PairwiseRunReport,
    durationOf: () => 10,
    still: (_v, _t, out) => {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, "jpg");
      return out;
    },
    onProgress: () => {},
  };
}

// Writes a run config for a package without going through a start.
function writeConfig(slug: string, over: Partial<AllCheckConfig> = {}): AllCheckConfig {
  const config: AllCheckConfig = { schema: "aideos.all-check.config/1", slug, rounds: 3, target: 9, agent: "agy", startedAt: "2026-10-02T10:00:00.000Z", studioWasRunning: false, ...over };
  fs.mkdirSync(allCheckDir(slug), { recursive: true });
  fs.writeFileSync(path.join(allCheckDir(slug), "config.json"), JSON.stringify(config));
  return config;
}

test("evaluateRecord: every part must pass, and each failure says what to do", () => {
  const base: Omit<FormatRoundRecord, "passed" | "failing"> = {
    schema: "aideos.all-check.round/1", round: 1, format: "long", videoPath: "v.mp4", filmHash: "h", createdAt: "t",
    review: { score: 9.3, verdict: "ACCEPT", gatesPassed: true, summary: "", failedCriteria: [], feedback: [], reportPath: null },
    measured: { passed: true, gateFailures: [], softFailures: [], recommendations: [], reportPath: null },
    frameCheck: { status: "clean", issues: [], stillsDir: "/frames", stills: [] },
  };
  assert.deepEqual(evaluateRecord(base, 9), { passed: true, failing: [] });
  assert.equal(evaluateRecord({ ...base, review: { ...base.review, score: 8.9 } }, 9).passed, false);
  assert.equal(evaluateRecord({ ...base, review: { ...base.review, score: 8.9 } }, 8.5).passed, true);
  assert.match(evaluateRecord({ ...base, review: { ...base.review, gatesPassed: false, failedCriteria: ["No overlap [gate]"] } }, 9).failing.join(" "), /hard gate/);
  const gated = evaluateRecord({ ...base, review: { ...base.review, gatesPassed: false, failedCriteria: ["Storyline 8.2/10: ok", "No overlap 2.2/10 [gate]: clipped"], failedGates: ["No overlap 2.2/10 [gate]: clipped"] } }, 9).failing.join(" ");
  assert.match(gated, /No overlap 2\.2/);
  assert.doesNotMatch(gated, /Storyline/, "only the gates that block a pass are listed, not every criterion under 9");
  assert.match(evaluateRecord({ ...base, review: { ...base.review, error: "not signed in" } }, 9).failing.join(" "), /could not run: not signed in/);
  assert.match(evaluateRecord({ ...base, measured: { ...base.measured, passed: false, gateFailures: ["captions"] } }, 9).failing.join(" "), /measured gates failed: captions/);
  assert.match(evaluateRecord({ ...base, frameCheck: { ...base.frameCheck, status: "pending" } }, 9).failing.join(" "), /frame check not recorded/);
  assert.match(evaluateRecord({ ...base, frameCheck: { ...base.frameCheck, status: "issues", issues: ["12s: clipped"] } }, 9).failing.join(" "), /12s: clipped/);
  const lost = evaluateRecord({ ...base, pairwise: { reference: "r.mp4", winner: "Video B", candidateScore: 8, referenceScore: 9, passed: false, reportPath: null } }, 9);
  assert.match(lost.failing.join(" "), /lost the cross-review/);
  assert.equal(evaluateRecord({ ...base, pairwise: { reference: "r.mp4", winner: "Tie", candidateScore: 9, referenceScore: 9, passed: true, reportPath: null } }, 9).passed, true);
});

test("round: records, backups, budget, pairwise on long only, frame check decides the pass", async () => {
  const slug = "ac-round";
  makePackage(slug);
  try {
    const reference = path.join(os.tmpdir(), "ac-ref.mp4");
    writeConfig(slug, { rounds: 2, reference });
    const deps = fakeRound();

    const [long] = await runRound({ slug, format: "long" }, deps);
    assert.equal(long.round, 1);
    assert.equal(long.review.score, 9.3);
    assert.equal(long.pairwise?.passed, true);
    assert.equal(long.passed, false, "a round never passes before the agent's frame check is recorded");
    assert.match(long.failing[0], /frame check not recorded/);
    assert.equal(long.frameCheck.stills.length, 2, "a 10 s video with stills every 4 s: 2 s and 6 s");
    assert.ok(fs.existsSync(path.join(allCheckDir(slug), "backups", "film.round-1.json")));
    assert.ok(fs.existsSync(recordPath(slug, 1, "long").replace(/\.json$/, ".md")));

    const clean = recordFrameCheck({ slug, round: 1, format: "long", issues: [] });
    assert.equal(clean.passed, true);
    const dirty = recordFrameCheck({ slug, round: 1, format: "long", issues: ["14s: label clipped by the edge"] });
    assert.equal(dirty.passed, false);
    assert.match(dirty.failing.join(" "), /label clipped/);
    assert.equal(readRecords(slug).length, 1);

    // "both" measures both formats in one round; the cross-review is for the long cut only.
    const both = await runRound({ slug, format: "both" }, deps);
    assert.deepEqual(both.map((r) => [r.round, r.format, r.pairwise === undefined]), [[2, "long", false], [2, "reel", true]]);
    assert.deepEqual(deps.renders, ["long", "long", "reel"]);

    // The budget is two rounds.
    await assert.rejects(() => runRound({ slug, format: "long" }, deps), /round budget is spent/);
    assert.throws(() => recordFrameCheck({ slug, round: 9, format: "long", issues: [] }), /no long record/);
  } finally {
    dropPackage(slug);
  }
});

test("round: a reviewer that cannot run is an error, never a pass", async () => {
  const slug = "ac-round-err";
  makePackage(slug);
  try {
    writeConfig(slug);
    const [rec] = await runRound({ slug, format: "reel" }, fakeRound({ geminiError: "agy is not signed in" }));
    assert.equal(rec.review.error, "agy is not signed in");
    assert.equal(rec.review.score, null);
    assert.equal(rec.passed, false);
    // Even a clean frame check cannot rescue it.
    assert.equal(recordFrameCheck({ slug, round: 1, format: "reel", issues: [] }).passed, false);

    const [low] = await runRound({ slug, format: "reel" }, fakeRound({ score: 8.2, gateOk: false, measuredOk: false }));
    assert.equal(recordFrameCheck({ slug, round: low.round, format: "reel", issues: [] }).passed, false);
    assert.match(low.failing.join("\n"), /under the 9.0 target/);
  } finally {
    dropPackage(slug);
  }
});

// Records a clean frame check for the given formats of a round.
function checkFrames(slug: string, round: number, formats: Array<"long" | "reel">): void {
  for (const format of formats) recordFrameCheck({ slug, round, format, issues: [] });
}

// Runs both formats of a round and records their frame checks, returning the records.
async function passingRound(slug: string, deps: RoundDeps, round?: number): Promise<FormatRoundRecord[]> {
  const records = await runRound({ slug, format: "both", round }, deps);
  return records.map((r) => recordFrameCheck({ slug, round: r.round, format: r.format, issues: [] }));
}

test("verdict: all good needs a passing long and reel from one round and the film unchanged", async () => {
  const slug = "ac-verdict";
  const dir = makePackage(slug);
  try {
    writeConfig(slug, { rounds: 5 });
    const filmHash = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(path.join(dir, "film.json"))).digest("hex");
    const good = await passingRound(slug, fakeRound());
    assert.ok(good.every((r) => r.passed));

    const ok = decideVerdict(readRecords(slug), filmHash);
    assert.equal(ok.passed, true);
    assert.equal(ok.round, 1);

    // The film changed after the final re-check: not all good, and it says why.
    const changed = decideVerdict(readRecords(slug), "different");
    assert.equal(changed.passed, false);
    assert.match(changed.stillFailing.join(" "), /film.json changed after the last check/);

    // A passing long from an earlier round plus a passing reel from a later one is not a re-check of both.
    fs.rmSync(path.join(allCheckDir(slug), "round-1", "reel.json"));
    const lone = decideVerdict(readRecords(slug), filmHash);
    assert.equal(lone.passed, false);
    assert.match(lone.stillFailing.join(" "), /reel was never measured/);
  } finally {
    dropPackage(slug);
  }
});

test("verdict: when nothing passes the best complete round is reported with what still fails", async () => {
  const slug = "ac-best";
  makePackage(slug);
  try {
    writeConfig(slug, { rounds: 5 });
    await runRound({ slug, format: "both" }, fakeRound({ score: 7.5, measuredOk: false })); // round 1
    checkFrames(slug, 1, ["long", "reel"]);
    await runRound({ slug, format: "both" }, fakeRound({ score: 8.6 })); // round 2 is closer
    checkFrames(slug, 2, ["long", "reel"]);
    await runRound({ slug, format: "long" }, fakeRound({ score: 9.5 })); // round 3 has no reel
    const verdict = decideVerdict(readRecords(slug), null);
    assert.equal(verdict.passed, false);
    assert.equal(verdict.round, 2);
    assert.match(verdict.stillFailing.join("\n"), /long: reviewer score 8.6 is under the 9.0 target/);
    assert.match(verdict.stillFailing.join("\n"), /reel: reviewer score 8.6/);
  } finally {
    dropPackage(slug);
  }
});

test("finish: a pass copies the final videos, writes the report and result, opens them, releases the lock", async () => {
  const slug = "ac-finish-pass";
  makePackage(slug);
  try {
    writeConfig(slug, { rounds: 4 });
    fs.writeFileSync(lockPath(slug), JSON.stringify({ slug, agent: "agy", startedAt: "x", launcherPid: 1 }));
    await passingRound(slug, fakeRound());

    const calls = { notes: [] as string[], opened: [] as string[], stopped: 0 };
    const deps: FinishDeps = {
      now: () => new Date("2026-10-02T12:00:00.000Z"),
      notify: (t, m) => calls.notes.push(`${t}|${m}`),
      openFiles: (f) => calls.opened.push(...f),
      studioRunning: () => false,
      stopStudio: () => calls.stopped++,
    };
    const result = finishRun(slug, deps);

    assert.equal(result.status, "passed");
    assert.equal(result.long?.score, 9.3);
    assert.ok(fs.readFileSync(result.long!.finalPath!, "utf8").startsWith("video-long"));
    assert.ok(fs.readFileSync(result.reel!.finalPath!, "utf8").startsWith("video-reel"));
    const report = fs.readFileSync(result.reportPath, "utf8");
    assert.match(report, /ALL GOOD/);
    assert.match(report, /\| 1 \| long \| 9\.3 ACCEPT \| pass/);
    assert.ok(!NO_DASH.test(report));
    assert.equal(JSON.parse(fs.readFileSync(path.join(allCheckDir(slug), "result.json"), "utf8")).status, "passed");
    assert.equal(readLock(slug), null);
    assert.deepEqual(calls.opened.map((f) => path.basename(f)), ["final-long.mp4", "final-reel.mp4"]);
    assert.match(calls.notes[0], /all good\|ac-finish-pass: long 9.3, reel 9.3/);
    assert.equal(calls.stopped, 0);
  } finally {
    dropPackage(slug);
  }
});

test("finish: a failure opens nothing and says what still fails; the studio stops only if all-check started it", async () => {
  const slug = "ac-finish-fail";
  makePackage(slug);
  try {
    writeConfig(slug, { rounds: 4, studioWasRunning: false });
    await runRound({ slug, format: "both" }, fakeRound({ score: 8.1 }));
    const opened: string[] = [];
    let stopped = 0;
    let studio = true;
    const deps: FinishDeps = {
      now: () => new Date(),
      notify: () => {},
      openFiles: (f) => opened.push(...f),
      studioRunning: () => studio,
      stopStudio: () => {
        stopped++;
        studio = false;
      },
    };
    const result = finishRun(slug, deps);
    assert.equal(result.status, "failed");
    assert.ok(result.stillFailing.some((f) => /8.1/.test(f)));
    assert.deepEqual(opened, []);
    assert.equal(stopped, 1, "all-check's own studio is stopped");

    // A studio the user already had running is left alone.
    writeConfig(slug, { rounds: 4, studioWasRunning: true });
    studio = true;
    finishRun(slug, deps);
    assert.equal(stopped, 1);
  } finally {
    dropPackage(slug);
  }
});

test("wait: returns the result once written, reports a vanished agent, and times out", async () => {
  const slug = "ac-wait";
  makePackage(slug);
  try {
    const config = writeConfig(slug);
    const windows = new Set<string>(["@3"]);
    const lockDeps = fakeLock({ windows });
    fs.writeFileSync(lockPath(slug), JSON.stringify({ slug, agent: "agy", startedAt: config.startedAt, launcherPid: 1, tmuxWindowId: "@3", tmuxSession: "aideos" }));

    // Still running: times out.
    const timedOut = await waitForResult(slug, { timeoutMs: 0, pollMs: 1, lockDeps });
    assert.equal(timedOut.outcome, "timeout");

    // The result file of this run arrives while waiting.
    const seen: string[] = [];
    let polls = 0;
    const waited = await waitForResult(slug, {
      timeoutMs: 5000,
      pollMs: 1,
      lockDeps,
      onProgress: (l) => seen.push(l),
      sleep: async () => {
        if (++polls === 2) {
          const result = { schema: "aideos.all-check.result/1", slug, status: "passed", startedAt: config.startedAt, reportPath: "r.md" };
          fs.writeFileSync(path.join(allCheckDir(slug), "result.json"), JSON.stringify(result));
        }
      },
    });
    assert.equal(waited.outcome, "result");
    assert.equal(waited.result?.status, "passed");

    // A result left by an earlier run (different startedAt) is not this run's.
    fs.writeFileSync(path.join(allCheckDir(slug), "result.json"), JSON.stringify({ startedAt: "older", status: "passed" }));
    assert.equal(runStatus(slug, lockDeps).state, "running");

    // The window disappears without a result.
    fs.rmSync(path.join(allCheckDir(slug), "result.json"));
    windows.clear();
    assert.equal((await waitForResult(slug, { timeoutMs: 1000, pollMs: 1, lockDeps })).outcome, "stopped");
  } finally {
    dropPackage(slug);
  }
});

test("cli: `all-check <sub>` is rewritten to the hyphenated command, the launch form is untouched", () => {
  for (const sub of ALL_CHECK_SUBCOMMANDS) {
    assert.deepEqual(rewriteAllCheckArgv(["node", "cli.ts", "all-check", sub, "hnsw", "--round", "2"]), ["node", "cli.ts", `all-check-${sub}`, "hnsw", "--round", "2"]);
  }
  const launch = ["node", "cli.ts", "all-check", "hnsw", "--rounds", "3"];
  assert.deepEqual(rewriteAllCheckArgv(launch), launch);
  const other = ["node", "cli.ts", "review", "all-check", "round"];
  assert.deepEqual(rewriteAllCheckArgv(other), other);
});

test("brief: states the hard rules, the settings and the long-reel-final order", () => {
  const config: AllCheckConfig = { schema: "aideos.all-check.config/1", slug: "hnsw", rounds: 6, target: 9, agent: "agy", startedAt: "t", studioWasRunning: false, reference: "/refs/a.mp4" };
  const brief = buildBrief(config, "/repo");
  assert.match(brief, /Reference video: \/refs\/a\.mp4/);
  assert.match(brief, /Long\.\*\* Run/);
  assert.match(brief, /Reel\.\*\*/);
  assert.match(brief, /Final re-check/);
  assert.match(brief, /honest failure is a\s+correct result/);
  assert.match(brief, /not done until `finish` has written result\.json/);
  assert.match(brief, /all-check\/scratch\//, "scratch files have one allowed home inside the package");
  assert.match(brief, /ROLLED BACK/);
  assert.ok(!NO_DASH.test(brief));
  assert.doesNotMatch(buildBrief({ ...config, reference: undefined }, "/repo"), /cross-review against the reference/);
});

// A rollback that only copies the backup (the real one also regenerates the render shadows).
function plainRestore(slug: string, round: number): string {
  const backup = path.join(allCheckDir(slug), "backups", `film.round-${round}.json`);
  fs.copyFileSync(backup, path.join(getVideosDir(), slug, "film.json"));
  return backup;
}

// Rewrites a package's film.json with a marker so each version has its own hash.
function writeFilmVersion(slug: string, version: string): void {
  fs.writeFileSync(path.join(getVideosDir(), slug, "film.json"), JSON.stringify({ id: slug, version }));
}

// Finish dependencies that touch nothing outside the test package.
function quietFinish(over: Partial<FinishDeps> = {}): FinishDeps {
  return { now: () => new Date(), notify: () => {}, openFiles: () => {}, studioRunning: () => false, stopStudio: () => {}, restoreFilm: plainRestore, strays: () => [], ...over };
}

test("round: a new round is refused until the previous round's frame check is recorded", async () => {
  const slug = "ac-pending-frames";
  makePackage(slug);
  try {
    writeConfig(slug, { rounds: 4 });
    const deps = fakeRound();
    await runRound({ slug, format: "long" }, deps);
    await assert.rejects(() => runRound({ slug, format: "long" }, deps), /round 1 has no frame check yet/);
    checkFrames(slug, 1, ["long"]);
    assert.equal((await runRound({ slug, format: "long" }, deps))[0].round, 2);
  } finally {
    dropPackage(slug);
  }
});

test("rollback: a round that scores lower than the best so far puts the best film back", async () => {
  const slug = "ac-autorollback";
  makePackage(slug);
  try {
    writeConfig(slug, { rounds: 6 });
    writeFilmVersion(slug, "v1");
    await runRound({ slug, format: "long" }, fakeRound({ score: 8.6 })); // round 1
    assert.equal(settleRound(slug, 1, readRecords(slug), plainRestore), null, "nothing to compare with yet");
    checkFrames(slug, 1, ["long"]);

    writeFilmVersion(slug, "v2");
    await runRound({ slug, format: "long" }, fakeRound({ score: 7.9 })); // round 2 is worse
    const note = settleRound(slug, 2, readRecords(slug), plainRestore);
    assert.equal(note?.restoredRound, 1);
    assert.match(note?.message ?? "", /ROLLED BACK: round 2 scored lower/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(getVideosDir(), slug, "film.json"), "utf8")).version, "v1");
    assert.equal(JSON.parse(fs.readFileSync(path.join(allCheckDir(slug), "backups", "film.round-2.json"), "utf8")).version, "v2", "the worse film stays inspectable");
    checkFrames(slug, 2, ["long"]);

    // An equal or better round keeps its film.
    writeFilmVersion(slug, "v3");
    await runRound({ slug, format: "long" }, fakeRound({ score: 8.7 })); // round 3
    assert.equal(settleRound(slug, 3, readRecords(slug), plainRestore), null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(getVideosDir(), slug, "film.json"), "utf8")).version, "v3");
  } finally {
    dropPackage(slug);
  }
});

test("rollback: rounds are only compared on the formats both measured, and rollbackFilm refuses a missing backup", async () => {
  const slug = "ac-rank";
  makePackage(slug);
  try {
    writeConfig(slug, { rounds: 6 });
    await runRound({ slug, format: "long" }, fakeRound({ score: 9.2 })); // round 1: long only
    checkFrames(slug, 1, ["long"]);
    await runRound({ slug, format: "reel" }, fakeRound({ score: 6.0 })); // round 2: reel only, nothing to compare
    const records = readRecords(slug);
    assert.equal(betterEarlierRound(records, 2), null, "a reel round is not judged against a long round");
    assert.ok(rankRecord(records[0]) > rankRecord(records[1]));
    assert.equal(rankRecord(undefined), -100);
    assert.throws(() => rollbackFilm(slug, 9), /no backup for round 9/);
  } finally {
    dropPackage(slug);
  }
});

test("finish: a run that does not pass restores the best round's film and keeps its renders", async () => {
  const slug = "ac-finish-best";
  makePackage(slug);
  try {
    writeConfig(slug, { rounds: 4 });
    writeFilmVersion(slug, "v1");
    await runRound({ slug, format: "both" }, fakeRound({ score: 8.5 })); // round 1: the best
    checkFrames(slug, 1, ["long", "reel"]);
    writeFilmVersion(slug, "v2");
    await runRound({ slug, format: "both" }, fakeRound({ score: 7.0 })); // round 2: worse, film v2 left on disk

    const result = finishRun(slug, quietFinish());
    assert.equal(result.status, "failed");
    assert.equal(result.bestRound, 1);
    assert.equal(result.restoredFilmFromRound, 1);
    assert.equal(result.long?.round, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(getVideosDir(), slug, "film.json"), "utf8")).version, "v1");
    assert.equal(JSON.parse(fs.readFileSync(path.join(allCheckDir(slug), "backups", "film.before-finish.json"), "utf8")).version, "v2");
    assert.ok(fs.existsSync(path.join(allCheckDir(slug), "final-long.mp4")));
    assert.match(fs.readFileSync(result.reportPath, "utf8"), /film.json was put back to the film of round 1/);
  } finally {
    dropPackage(slug);
  }
});

test("finish: restoring the film that was checked turns an edit after the final check back into a pass", async () => {
  const slug = "ac-finish-restore-pass";
  makePackage(slug);
  try {
    writeConfig(slug, { rounds: 4 });
    writeFilmVersion(slug, "checked");
    await passingRound(slug, fakeRound());
    writeFilmVersion(slug, "edited after the final check");
    const result = finishRun(slug, quietFinish());
    assert.equal(result.status, "passed");
    assert.equal(result.restoredFilmFromRound, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(getVideosDir(), slug, "film.json"), "utf8")).version, "checked");
  } finally {
    dropPackage(slug);
  }
});

test("finish: files created outside the package are reported as a rule violation", async () => {
  const slug = "ac-finish-strays";
  makePackage(slug);
  try {
    writeConfig(slug);
    await passingRound(slug, fakeRound());
    const result = finishRun(slug, quietFinish({ strays: () => ["patch.js", "x/.npm/_cacache"] }));
    assert.deepEqual(result.strayFiles, ["patch.js", "x/.npm/_cacache"]);
    assert.match(fs.readFileSync(result.reportPath, "utf8"), /Rule violation: files outside videos\/ac-finish-strays\/[\s\S]*- patch\.js/);
  } finally {
    dropPackage(slug);
  }
});

test("strays: only paths that appeared after the baseline count; the baseline reads a real git repo", () => {
  const slug = "ac-strays";
  makePackage(slug);
  try {
    fs.mkdirSync(allCheckDir(slug), { recursive: true });
    assert.deepEqual(strayFiles(slug, "/repo", () => ["a.ts", "patch.js"]), [], "no baseline, nothing to compare");
    writeRepoBaseline(slug, "/repo", () => ["a.ts"]);
    assert.deepEqual(strayFiles(slug, "/repo", () => ["a.ts", "patch.js", "x/.npm/f"]), ["patch.js", "x/.npm/f"]);

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "allcheck-git-"));
    spawnSync("git", ["init", "-q"], { cwd: repo });
    fs.mkdirSync(path.join(repo, "x"));
    fs.writeFileSync(path.join(repo, "x", "scratch.js"), "1");
    fs.writeFileSync(path.join(repo, "patch.js"), "1");
    assert.deepEqual(dirtyRepoPaths(repo).sort(), ["patch.js", "x/scratch.js"]);
    fs.rmSync(repo, { recursive: true, force: true });
  } finally {
    dropPackage(slug);
  }
});

test("wait: an agent that goes quiet without finishing gets its run closed from the records, a busy one does not", async () => {
  const slug = "ac-wait-idle";
  makePackage(slug);
  try {
    const config = writeConfig(slug);
    const windows = new Set<string>(["@5"]);
    const lockDeps = fakeLock({ windows });
    fs.writeFileSync(lockPath(slug), JSON.stringify({ slug, agent: "agy", startedAt: config.startedAt, launcherPid: 1, tmuxWindowId: "@5", tmuxSession: "aideos" }));

    let clock = 0;
    let screen = "agent working 1";
    let busy = false;
    let finished = 0;
    const idle: IdleWatchdog = {
      thresholdMs: 10_000,
      now: () => clock,
      paneText: () => screen,
      roundInFlight: () => busy,
      finish: (s) => {
        finished++;
        const result = { schema: "aideos.all-check.result/1", slug: s, status: "failed", startedAt: config.startedAt, reportPath: "r.md" };
        fs.writeFileSync(path.join(allCheckDir(s), "result.json"), JSON.stringify(result));
        return result as never;
      },
    };
    const tick = async (ms: number) => {
      clock += ms;
    };

    // A screen that keeps changing is an agent that is working.
    let n = 0;
    const working = await waitForResult(slug, { timeoutMs: 30_000, pollMs: 4000, lockDeps, idle, sleep: async (ms) => { screen = `agent working ${++n}`; await tick(ms); } });
    assert.equal(working.outcome, "timeout");
    assert.equal(finished, 0);

    // A silent screen while a round is running is a long render, not a stopped agent.
    busy = true;
    const rendering = await waitForResult(slug, { timeoutMs: 30_000, pollMs: 4000, lockDeps, idle, sleep: tick });
    assert.equal(rendering.outcome, "timeout");
    assert.equal(finished, 0);

    // A silent screen with nothing running: the wait closes the run itself.
    busy = false;
    const lines: string[] = [];
    const closed = await waitForResult(slug, { timeoutMs: 300_000, pollMs: 4000, lockDeps, idle, sleep: tick, onProgress: (l) => lines.push(l) });
    assert.equal(closed.outcome, "result");
    assert.equal(closed.finishedByWatchdog, true);
    assert.equal(finished, 1);
    assert.ok(lines.some((l) => /gone quiet without finishing/.test(l)));
  } finally {
    dropPackage(slug);
  }
});

test("launch script: an agent that exits without a result still gets a verdict from the records", () => {
  const slug = "ac-script-finish";
  makePackage(slug);
  try {
    fs.mkdirSync(allCheckDir(slug), { recursive: true });
    const text = fs.readFileSync(writeLaunchScript(slug, "claude", "/tmp/brief.md", "claude-sonnet-5-5"), "utf8");
    assert.match(text, /\[ -f '[^']*result\.json' \] \|\| npx tsx backend\/cli\.ts all-check finish 'ac-script-finish'/);
    assert.ok(text.indexOf("all-check finish") < text.indexOf("exec "), "the verdict is written before the window is kept open");
  } finally {
    dropPackage(slug);
  }
});
