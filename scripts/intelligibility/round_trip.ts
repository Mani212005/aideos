/**
 * File Description: Repeatable speech-to-text round trip that checks the house narration time-stretch does not hurt
 * clarity. It narrates the committed sample-explainer fixture script through the real produceAudioPipeline twice
 * with one voice (as the synthesizer spoke it, and re-paced by the pitch-preserving timeStretch at the house rate),
 * transcribes both takes with local openai-whisper (scripts/intelligibility/transcribe_wer.py) and compares how
 * many script words each take has misheard. Run it again whenever the voice, a synthesizer's default speed, the house
 * narration rate (backend/pacingProfile.ts) or timeStretch (backend/pcm.ts) changes. The audio goes to a temporary
 * directory outside the repo and is deleted afterwards unless --keep is given; nothing is uploaded.
 * Exit codes: 0 when the stretched take is no less clear than the spoken one within MAX_STRETCH_MISHEARD_LOSS, 1 when it
 * is not, 2 when the round trip cannot run (no synthesizer, no python, no speech-to-text engine).
 * Inputs and outputs: CLI flags (--backend, --voice, --speed, --rate, --python, --json, --keep) ->
 * prints a table and writes an optional JSON report.
 * Used by: npm run intelligibility (by hand, when the voice or the stretch changes); docs/verify/FEATURE_MAP.md
 * row "Voiceover & Narration"; docs/GOOD_VIDEO.md "House pace".
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { produceAudioPipeline, type ProduceAudioResult } from "../../backend/audio";
import { createTtsBackend, type TtsBackend, type TtsBackendName } from "../../backend/tts";
import { HOUSE_PACE } from "../../backend/pacingProfile";
import { wordsPerMinute } from "../../backend/review/speech";

/** The committed fixture whose shot lines are the round-trip script (the one the 2026-11-21 evidence measured). */
const FIXTURE_FILM = path.resolve(__dirname, "../../test_fixtures/packages/sample-explainer/film.json");
const SCORER = path.resolve(__dirname, "transcribe_wer.py");
const BACKENDS: readonly TtsBackendName[] = ["vcd", "kokoro", "google", "say", "tone"];

/**
 * Most the stretched take's misheard rate (word errors left once spelling choices are forgiven) may exceed the
 * spoken take's, as a fraction: 0.02 is 2 points, about five words of the 234-word fixture. Calibrated with
 * openai-whisper small on this fixture with Kokoro af_heart: the stretch moved the misheard rate by +1.3 points
 * (speed 1), +0.0 (speed 0.75) and -0.9 (speed 1.05 stretched to 176 wpm), so 2 points sits above the largest
 * take-to-take change seen. It guards against a stretch that makes words misheard; it is not proof of a pace limit,
 * because the 2x control (280 wpm) moved the rate by -0.4 points and is not caught (openai-whisper small
 * transcribes fast clean speech about as well as normal speech, and mishears "U-Net" as "unit" at every pace).
 * Plain WER is reported but not judged, because the speech-to-text spells a compound one way in one take and the
 * other way in the next ("downsampling" against "down sampling").
 */
const MAX_STRETCH_MISHEARD_LOSS = 0.02;

/**
 * Above this misheard rate the spoken take itself is not speech the engine understands (the tone placeholder, a
 * broken voice, a missing model), so comparing the stretch against it would prove nothing: the run cannot judge.
 */
const MAX_SPOKEN_MISHEARD = 0.25;

/** One narration take as the speech-to-text scorer reported it. */
interface ScoredTake {
  wav: string;
  words: number;
  /** Plain word error rate, as jiwer counts it (comparable with the 2026-11-21 evidence numbers). */
  wer: number;
  /** Errors left once spelling choices ("down sampling", "unet", "4") are forgiven, per script word. */
  misheard_rate: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  misheard: Array<{ said: string; heard: string; errors: number }>;
  heard: string;
}

/** The scorer's report. */
interface ScorerReport {
  engine: string;
  model: string;
  takes: ScoredTake[];
}

// Prints the usage line.
function usage(): string {
  return [
    "usage: npm run intelligibility -- [--backend vcd|kokoro|google|say|tone] [--voice <id>] [--speed <n>]",
    "         [--rate <n>] [--python <path>] [--json <report.json>] [--keep]",
    "  --backend/--voice          the narrator, as for produceAudioPipeline (default: the pipeline's own choice)",
    "  --speed                    a pace-controlled synthesizer's (Kokoro's) speed, standing in for a natural rate (default 1)",
    `  --rate                     the stretch to test (default: the house narration rate, ${HOUSE_PACE.narrationRate})`,
    "  --python                   python with openai-whisper (default: $AIDEOS_STT_PYTHON or python3)",
  ].join("\n");
}

// Parses and validates the command line.
function readOptions(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      backend: { type: "string" },
      voice: { type: "string" },
      speed: { type: "string" },
      rate: { type: "string" },
      python: { type: "string" },
      json: { type: "string" },
      keep: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(usage());
    process.exit(0);
  }
  const backend = values.backend as TtsBackendName | undefined;
  if (backend !== undefined && !BACKENDS.includes(backend)) throw new Error(`--backend must be one of ${BACKENDS.join(", ")}`);
  const speed = values.speed === undefined ? undefined : Number(values.speed);
  if (speed !== undefined && !(Number.isFinite(speed) && speed >= 0.5 && speed <= 2)) throw new Error("--speed must be a number from 0.5 to 2");
  const rate = values.rate === undefined ? HOUSE_PACE.narrationRate : Number(values.rate);
  if (!(Number.isFinite(rate) && rate >= 0.5 && rate <= 2) || Math.abs(rate - 1) < 1e-6) throw new Error("--rate must be a number from 0.5 to 2 other than 1");
  return {
    backend,
    voice: values.voice,
    speed,
    rate,
    python: values.python ?? process.env.AIDEOS_STT_PYTHON ?? "python3",
    json: values.json ? path.resolve(values.json) : undefined,
    keep: values.keep,
  };
}

// Reads the fixture's narration lines, one per shot.
function readFixtureLines(): string[] {
  const film = JSON.parse(fs.readFileSync(FIXTURE_FILM, "utf8")) as { shots?: Array<{ scriptText?: unknown }> };
  const lines = (film.shots ?? []).map((s) => (typeof s.scriptText === "string" ? s.scriptText.trim() : ""));
  if (lines.length === 0 || lines.some((l) => l.length === 0)) throw new Error(`${FIXTURE_FILM}: every shot needs scriptText`);
  return lines;
}

/**
 * Wraps a synthesizer so the pipeline treats it as one with no pace control of its own (so it applies the stretch),
 * and remembers each line's raw audio so both takes re-pace the very same recording.
 */
function paceFixedMemo(inner: TtsBackend): TtsBackend {
  const memo = new Map<string, Promise<Float32Array>>();
  return {
    name: `${inner.name}${inner.speed !== undefined ? `@${inner.speed}` : ""}`,
    voice: inner.voice,
    language: inner.language,
    maxChars: inner.maxChars,
    synthesize(text: string) {
      let pending = memo.get(text);
      if (!pending) {
        pending = inner.synthesize(text);
        memo.set(text, pending);
      }
      return pending;
    },
    close: () => inner.close?.() ?? Promise.resolve(),
  };
}

// Narrates the lines into a directory at one stretch rate through the real narration pipeline.
async function narrate(lines: string[], dir: string, backend: TtsBackend, rate: number): Promise<ProduceAudioResult> {
  fs.mkdirSync(dir, { recursive: true });
  return produceAudioPipeline(lines, dir, { ttsBackendInstance: backend, narrationRate: rate });
}

// Runs the Python scorer over the takes and returns its report.
function score(python: string, scriptPath: string, wavs: string[], outPath: string): ScorerReport {
  const run = spawnSync(python, [SCORER, scriptPath, outPath, ...wavs], { stdio: ["ignore", "inherit", "inherit"] });
  if (run.error) throw new Error(`cannot start ${python}: ${run.error.message}`);
  if (run.status === 2) throw new Error("no speech-to-text engine (see the message above)");
  if (run.status !== 0) throw new Error(`speech-to-text scorer exited ${run.status ?? run.signal}`);
  const report = JSON.parse(fs.readFileSync(outPath, "utf8")) as ScorerReport;
  if (!Array.isArray(report.takes) || report.takes.length !== wavs.length) throw new Error("speech-to-text scorer returned the wrong number of takes");
  return report;
}

// Formats a fraction as a percentage with one decimal.
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// Narrates, transcribes and judges both takes; returns the process exit code.
async function main(): Promise<number> {
  const opts = readOptions(process.argv.slice(2));
  const lines = readFixtureLines();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-intelligibility-"));
  try {
    let inner: TtsBackend;
    try {
      // A synthesizer with its own pace control (Kokoro) is never stretched in production, so it stands in for a
      // voice without one at its natural rate (speed 1) unless --speed says otherwise.
      inner = await createTtsBackend({ backend: opts.backend, voice: opts.voice, speed: opts.speed ?? 1 });
    } catch (err) {
      throw new Error(`no synthesizer: ${err instanceof Error ? err.message : String(err)}`);
    }
    const backend = paceFixedMemo(inner);
    let spoken: ProduceAudioResult;
    let stretched: ProduceAudioResult;
    try {
      spoken = await narrate(lines, path.join(work, "spoken"), backend, 1);
      stretched = await narrate(lines, path.join(work, "stretched"), backend, opts.rate);
    } finally {
      await backend.close?.();
    }
    const scriptPath = path.join(work, "script.txt");
    fs.writeFileSync(scriptPath, `${lines.join("\n")}\n`);
    const report = score(opts.python, scriptPath, [spoken.voiceoverPath, stretched.voiceoverPath], path.join(work, "stt.json"));

    const takes = [
      { name: "spoken", rate: 1, audio: spoken, stt: report.takes[0] },
      { name: "stretched", rate: opts.rate, audio: stretched, stt: report.takes[1] },
    ].map((t) => ({
      take: t.name,
      stretch: t.rate,
      durationSec: Number(t.audio.totalAudioDuration.toFixed(2)),
      wpm: Math.round(wordsPerMinute(t.audio.words) ?? 0),
      wer: t.stt.wer,
      misheardRate: t.stt.misheard_rate,
      substitutions: t.stt.substitutions,
      deletions: t.stt.deletions,
      insertions: t.stt.insertions,
      misheard: t.stt.misheard.map((m) => `${m.said || "-"} -> ${m.heard || "-"}`),
      heard: t.stt.heard,
    }));
    if (takes[0].misheardRate > MAX_SPOKEN_MISHEARD) {
      throw new Error(`the spoken take is ${pct(takes[0].misheardRate)} misheard (over ${pct(MAX_SPOKEN_MISHEARD)}), so it cannot judge the stretch; heard: "${takes[0].heard.slice(0, 120)}"`);
    }
    const loss = takes[1].misheardRate - takes[0].misheardRate;
    const pass = loss <= MAX_STRETCH_MISHEARD_LOSS + 1e-9;
    const result = {
      fixture: path.relative(path.resolve(__dirname, "../.."), FIXTURE_FILM),
      synthesizer: inner.name,
      voice: inner.voice ?? null,
      nativeSpeed: inner.speed ?? null,
      stt: { engine: report.engine, model: report.model },
      words: report.takes[0].words,
      maxStretchMisheardLoss: MAX_STRETCH_MISHEARD_LOSS,
      misheardLoss: Number(loss.toFixed(4)),
      verdict: pass ? "pass" : "fail",
      takes,
    };

    console.log(`\nIntelligibility round trip: ${result.synthesizer}${result.voice ? ` (${result.voice})` : ""}, ${result.words} script words, ${report.engine} ${report.model}`);
    for (const t of takes) {
      console.log(`  ${t.take.padEnd(9)} x${t.stretch.toFixed(2)}  ${t.durationSec.toFixed(1).padStart(6)} s  ${String(t.wpm).padStart(3)} wpm  misheard ${pct(t.misheardRate).padStart(6)}  WER ${pct(t.wer).padStart(6)}`);
      console.log(`    misheard: ${t.misheard.join(", ") || "none"}`);
    }
    console.log(`  ${pass ? "PASS" : "FAIL"}: the stretch changes the misheard rate by ${loss >= 0 ? "+" : ""}${pct(loss)} (allowed +${pct(MAX_STRETCH_MISHEARD_LOSS)})`);
    if (opts.json) {
      fs.mkdirSync(path.dirname(opts.json), { recursive: true });
      fs.writeFileSync(opts.json, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`  report: ${opts.json}`);
    }
    if (opts.keep) console.log(`  audio kept in ${work}`);
    return pass ? 0 : 1;
  } finally {
    if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main().then(
    (code) => process.exit(code),
    // Any failure means the round trip could not run, which is exit 2, never a clarity verdict.
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    },
  );
}
