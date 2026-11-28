/**
 * File Description: Standing pronunciation lexicon and speech-recognition verification for brand and
 * technical names in the narration pipeline. Converts written script text to spoken-form text for TTS
 * (leaving captions, word timings and film script text in their original written spelling) and verifies
 * produced narration audio against the lexicon using offline local speech recognition (Whisper), because
 * headless build machines have no audio output for manual listening.
 * Inputs and outputs: written narration text, optional custom lexicon, WAV path or injected transcriber ->
 * spoken-form text, cache key digest, and PronunciationCheckReport pass/fail/skipped verdict.
 * Used by: backend/audio.ts, backend/pipeline/run.ts, backend/narrationPronunciation.test.ts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { environment } from "./env";
import { isProcTimeout, spawnSyncBounded } from "./proc";

/** One entry in the brand and technical-name pronunciation lexicon. */
export interface PronunciationEntry {
  /** Written form as it appears in the script and burned-in captions (for example "OpenAI"). */
  written: string;
  /** Spoken form passed to the TTS synthesizer so it pronounces the term naturally (for example "Open A.I."). */
  spoken: string;
  /** Normalized transcript forms Whisper hears when the term is pronounced as intended. */
  acceptedHeard: readonly string[];
  /** Normalized transcript forms that indicate a known mispronunciation (for example "openeye" for "OpenAI"). */
  rejectedHeard?: readonly string[];
  /** Short note on why this entry is in the lexicon. */
  note?: string;
}

/** Verification outcome for one lexicon term present in a narration script. */
export interface PronunciationTermResult {
  written: string;
  spoken: string;
  expectedCount: number;
  heardCount: number;
  rejectedHits: string[];
  passed: boolean;
}

/** Result of checking produced narration against the pronunciation lexicon. */
export interface PronunciationCheckReport {
  status: "passed" | "failed" | "disabled" | "not_applicable";
  /** Plain description of how the check ran (speech recognition because no audio output exists on headless hosts). */
  method: string;
  /** Transcript returned by speech recognition, or null when the check did not run or no lexicon terms appeared. */
  transcript: string | null;
  terms: PronunciationTermResult[];
  failures: string[];
  /** Present when status is "disabled" or "not_applicable", plainly naming why no speech recognition ran. */
  reason?: string;
}

/** Result returned by an offline ASR transcriber (or a test double). */
export interface PronunciationTranscription {
  engine: string;
  model: string;
  transcript: string;
}

/** Injectable transcriber function so unit tests never run a real ASR model or touch the network. */
export type PronunciationTranscriber = (wavPath: string) => PronunciationTranscription | Promise<PronunciationTranscription>;

/** Error thrown when the standing pronunciation check fails on a produced narration. */
export class PronunciationCheckError extends Error {
  report: PronunciationCheckReport;

  // Attaches the structured pronunciation report to the thrown error for callers and logs.
  constructor(report: PronunciationCheckReport) {
    super(`Pronunciation check failed: ${report.failures.join("; ")}`);
    this.name = "PronunciationCheckError";
    this.report = report;
  }
}

/** Environment variable that turns the standing pronunciation check "off" (default "on"). */
export const PRONUNCIATION_CHECK_ENV = "AIDEOS_PRONUNCIATION_CHECK";

/** Error raised when no local speech-to-text engine is available to run the pronunciation check. */
export class PronunciationAsrUnavailableError extends Error {
  // Carries the plain message naming the missing engine and the setting that turns the check off.
  constructor(message: string) {
    super(message);
    this.name = "PronunciationAsrUnavailableError";
  }
}

/**
 * Standing pronunciation lexicon for brand, AI, hardware and mathematical names.
 * Seeded from the 2026-11-28 distillation script (OpenAI, Anthropic, DeepSeek, Llama, Codex, Epoch AI,
 * GPUs, H100, H800, 405B, DeepSeek-R1, DeepSeek-V3) and Riemann facts (Riemann, Euler, Dirichlet, Gauss, zeta).
 */
export const DEFAULT_PRONUNCIATION_LEXICON: readonly PronunciationEntry[] = [
  {
    written: "OpenAI",
    spoken: "Open A.I.",
    acceptedHeard: ["openai", "open ai", "open a i"],
    rejectedHeard: ["openeye", "open eye", "open eyes"],
    note: "Prevents TTS from reading AI as the word 'eye' ('OpenEye').",
  },
  {
    written: "Epoch AI",
    spoken: "Epoch A.I.",
    acceptedHeard: ["epoch ai", "epoch a i"],
    rejectedHeard: ["apoc ai", "apoch ai", "epoch eye"],
    note: "Keeps 'Epoch' distinct from 'APOC' and 'AI' as letters.",
  },
  {
    written: "Anthropic",
    spoken: "Anthropic",
    acceptedHeard: ["anthropic"],
    rejectedHeard: ["entropic", "antropic"],
    note: "Guards against 'Entropic' mispronunciation.",
  },
  {
    written: "DeepSeek-R1",
    spoken: "DeepSeek R 1",
    acceptedHeard: ["deepseek r1", "deepseek r 1", "deepseek r one", "deep seek r1", "deep seek r 1", "deep seek r one"],
    rejectedHeard: ["deepseek are one", "deep seek are one"],
    note: "Separates R and 1 so TTS does not slur 'R1' into 'are one'.",
  },
  {
    written: "DeepSeek-V3",
    spoken: "DeepSeek V 3",
    acceptedHeard: ["deepseek v3", "deepseek v 3", "deepseek v three", "deep seek v3", "deep seek v 3", "deepseek version 3", "deep seek version 3"],
    note: "Keeps V3 spoken cleanly after DeepSeek.",
  },
  {
    written: "DeepSeek",
    spoken: "DeepSeek",
    acceptedHeard: ["deepseek", "deep seek"],
    note: "Verifies the lab name is heard intact.",
  },
  {
    written: "Llama",
    spoken: "Llama",
    acceptedHeard: ["llama", "lama"],
    note: "English homophone 'lama' is accepted from Whisper alongside 'llama'.",
  },
  {
    written: "Codex",
    spoken: "Codex",
    acceptedHeard: ["codex", "codecs", "code x"],
    rejectedHeard: ["kodak"],
    note: "English homophone 'codecs' is accepted from Whisper alongside 'codex'; guards against 'Kodak'.",
  },
  {
    written: "Claude",
    spoken: "Claude",
    acceptedHeard: ["claude", "claud"],
    rejectedHeard: ["cloud", "clod"],
    note: "Guards against 'cloud'.",
  },
  {
    written: "Gemini",
    spoken: "Gemini",
    acceptedHeard: ["gemini"],
    rejectedHeard: ["jiminy"],
    note: "Guards against garbled brand name.",
  },
  {
    written: "ChatGPT",
    spoken: "Chat G.P.T.",
    acceptedHeard: ["chatgpt", "chat gpt", "chat g p t"],
    note: "Spells GPT as letters.",
  },
  {
    written: "GPT",
    spoken: "G.P.T.",
    acceptedHeard: ["gpt", "g p t"],
    note: "Spells GPT as letters.",
  },
  {
    written: "GPUs",
    spoken: "G.P.U.s",
    acceptedHeard: ["gpus", "gpu s", "g p u s", "g p us"],
    note: "Prevents slurring or splitting GPUs across a pause.",
  },
  {
    written: "GPU",
    spoken: "G.P.U.",
    acceptedHeard: ["gpu", "g p u"],
    note: "Spells GPU cleanly as letters.",
  },
  {
    written: "H100",
    spoken: "H 100",
    acceptedHeard: ["h100", "h 100", "h one hundred"],
    note: "Separates the H prefix from 100.",
  },
  {
    written: "H800",
    spoken: "H 800",
    acceptedHeard: ["h800", "h 800", "h eight hundred"],
    note: "Separates the H prefix from 800 so H800 GPU does not merge.",
  },
  {
    written: "A100",
    spoken: "A 100",
    acceptedHeard: ["a100", "a 100", "a one hundred"],
    note: "Separates the A prefix from 100.",
  },
  {
    written: "B200",
    spoken: "B 200",
    acceptedHeard: ["b200", "b 200", "b two hundred"],
    note: "Separates the B prefix from 200.",
  },
  {
    written: "405B",
    spoken: "405 B",
    acceptedHeard: ["405b", "405 b", "405 billion"],
    note: "Prevents 3.1 405B from running together.",
  },
  {
    written: "LLMs",
    spoken: "L.L.M.s",
    acceptedHeard: ["llms", "llm s", "l l m s", "l l ms"],
    note: "Spells LLMs as letters.",
  },
  {
    written: "LLM",
    spoken: "L.L.M.",
    acceptedHeard: ["llm", "l l m"],
    note: "Spells LLM as letters.",
  },
  {
    written: "APIs",
    spoken: "A.P.I.s",
    acceptedHeard: ["apis", "api s", "a p i s"],
    note: "Spells APIs as letters.",
  },
  {
    written: "API",
    spoken: "A.P.I.",
    acceptedHeard: ["api", "a p i"],
    note: "Spells API as letters.",
  },
  {
    written: "TPUs",
    spoken: "T.P.U.s",
    acceptedHeard: ["tpus", "tpu s", "t p u s"],
    note: "Spells TPUs as letters.",
  },
  {
    written: "TPU",
    spoken: "T.P.U.",
    acceptedHeard: ["tpu", "t p u"],
    note: "Spells TPU as letters.",
  },
  {
    written: "CPUs",
    spoken: "C.P.U.s",
    acceptedHeard: ["cpus", "cpu s", "c p u s"],
    note: "Spells CPUs as letters.",
  },
  {
    written: "CPU",
    spoken: "C.P.U.",
    acceptedHeard: ["cpu", "c p u"],
    note: "Spells CPU as letters.",
  },
  {
    written: "Mistral",
    spoken: "Mistral",
    acceptedHeard: ["mistral"],
    note: "Verifies the model family name.",
  },
  {
    written: "Qwen",
    spoken: "Chwen",
    acceptedHeard: ["qwen", "chwen", "quen", "kwen"],
    note: "Pronounced roughly like 'chwen' rather than spelled out.",
  },
  {
    written: "Riemann",
    spoken: "Riemann",
    acceptedHeard: ["riemann", "reeman", "reemann", "reman"],
    rejectedHeard: ["ryeman", "rye man", "rayman"],
    note: "Riemann hypothesis: pronounced REE-mahn, not RYE-man.",
  },
  {
    written: "Euler",
    spoken: "Oiler",
    acceptedHeard: ["euler", "oiler", "oyler"],
    rejectedHeard: ["yuler", "yooler", "youler"],
    note: "Pronounced OIL-er, not YOO-ler.",
  },
  {
    written: "Dirichlet",
    spoken: "Deer-ish-lay",
    acceptedHeard: ["dirichlet", "deerishlay", "dirishlay"],
    note: "Riemann and number theory: French pronunciation.",
  },
  {
    written: "Gauss",
    spoken: "Gauss",
    acceptedHeard: ["gauss", "gows"],
    note: "Riemann and prime number theorem.",
  },
  {
    written: "zeta",
    spoken: "zeta",
    acceptedHeard: ["zeta", "zayta", "zita"],
    note: "Riemann zeta function.",
  },
];

/** Maximum time (ms) allowed for offline Whisper transcription of a narration WAV. */
const TRANSCRIBE_TIMEOUT_MS = 30 * 60_000;

/** Inline pronunciation markup `{written|spoken}` shared with backend/review/speech.ts. */
const INLINE_SPOKEN_RE = /\{([^|}]*)\|([^}]*)\}/g;

// Escapes regex metacharacters in a literal lexicon entry.
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normalizes text for transcript comparison: lowercase, collapse punctuation/hyphens to single spaces, keep apostrophes folded.
export function normalizeForPronunciation(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Removes inline `{written|spoken}` annotations, returning the clean written spelling for captions and timings.
export function stripSpokenMarkup(text: string): string {
  return text.replace(INLINE_SPOKEN_RE, "$1");
}

// Merges custom lexicon entries over the default lexicon (custom entries with the same written form replace defaults).
export function mergePronunciationLexicon(
  custom?: readonly PronunciationEntry[],
): readonly PronunciationEntry[] {
  if (!custom || custom.length === 0) return DEFAULT_PRONUNCIATION_LEXICON;
  const byKey = new Map<string, PronunciationEntry>();
  for (const entry of DEFAULT_PRONUNCIATION_LEXICON) byKey.set(entry.written.toLowerCase(), entry);
  for (const entry of custom) byKey.set(entry.written.toLowerCase(), entry);
  return [...byKey.values()];
}

// Builds a single-pass longest-first alternation matcher over a lexicon so no term is rewritten twice.
function compileLexiconMatcher(lexicon: readonly PronunciationEntry[]): {
  regex: RegExp | null;
  byLower: Map<string, PronunciationEntry>;
} {
  const sorted = [...lexicon]
    .filter((entry) => entry.written.trim().length > 0)
    .sort((a, b) => b.written.length - a.written.length);
  const byLower = new Map<string, PronunciationEntry>();
  for (const entry of sorted) {
    byLower.set(entry.written.toLowerCase(), entry);
  }
  if (sorted.length === 0) return { regex: null, byLower };
  const body = sorted.map((entry) => escapeRegex(entry.written)).join("|");
  // Match whole terms, optionally carrying an English possessive ('s), without matching inside larger words.
  const regex = new RegExp(`(?<![A-Za-z0-9])(${body})((?:['\u2019]s)?)(?![A-Za-z0-9])`, "gi");
  return { regex, byLower };
}

// Converts written narration text into spoken-form text for TTS while leaving non-lexicon words untouched.
export function toSpokenForm(
  text: string,
  lexicon: readonly PronunciationEntry[] = DEFAULT_PRONUNCIATION_LEXICON,
): string {
  const { regex, byLower } = compileLexiconMatcher(lexicon);
  // Process segments outside explicit `{written|spoken}` overrides so author overrides always win.
  const applyLexicon = (plain: string): string => {
    if (!regex) return plain;
    return plain.replace(regex, (full, matched: string, possessive: string) => {
      const entry = byLower.get(matched.toLowerCase());
      if (!entry) return full;
      return `${entry.spoken}${possessive ?? ""}`;
    });
  };

  let out = "";
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_SPOKEN_RE)) {
    const idx = match.index ?? 0;
    out += applyLexicon(text.slice(lastIndex, idx));
    out += match[2].trim();
    lastIndex = idx + match[0].length;
  }
  out += applyLexicon(text.slice(lastIndex));
  return out;
}

// Computes a short deterministic digest of the active lexicon's spoken rules for line-cache invalidation.
export function lexiconFingerprint(
  lexicon: readonly PronunciationEntry[] = DEFAULT_PRONUNCIATION_LEXICON,
): string {
  const pairs = [...lexicon]
    .map((entry) => [entry.written.toLowerCase(), entry.spoken])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex").slice(0, 8);
}

// Counts occurrences of each lexicon entry present in the script, matching longest-first in a single pass.
export function countLexiconTermsInScript(
  scriptText: string,
  lexicon: readonly PronunciationEntry[] = DEFAULT_PRONUNCIATION_LEXICON,
): Array<{ entry: PronunciationEntry; count: number }> {
  const clean = stripSpokenMarkup(scriptText);
  const { regex, byLower } = compileLexiconMatcher(lexicon);
  if (!regex) return [];
  const counts = new Map<string, { entry: PronunciationEntry; count: number }>();
  for (const match of clean.matchAll(regex)) {
    const key = match[1].toLowerCase();
    const entry = byLower.get(key);
    if (!entry) continue;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { entry, count: 1 });
  }
  return [...counts.values()];
}

// Counts non-overlapping whole-phrase matches of every lexicon entry's accepted forms in one longest-first pass, so a phrase owned by a longer entry is never counted again by a shorter one.
function countHeardByEntry(
  normalizedTranscript: string,
  lexicon: readonly PronunciationEntry[],
): Map<PronunciationEntry, number> {
  const owners = new Map<string, PronunciationEntry>();
  const ordered = [...lexicon].sort((a, b) => b.written.length - a.written.length);
  for (const entry of ordered) {
    for (const variant of entry.acceptedHeard) {
      const norm = normalizeForPronunciation(variant);
      if (norm && !owners.has(norm)) owners.set(norm, entry);
    }
  }
  const counts = new Map<PronunciationEntry, number>();
  if (!normalizedTranscript || owners.size === 0) return counts;
  const phrases = [...owners.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![a-z0-9])(?:${phrases.map(escapeRegex).join("|")})(?![a-z0-9])`, "g");
  for (const match of normalizedTranscript.matchAll(pattern)) {
    const entry = owners.get(match[0]);
    if (entry) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  return counts;
}

// Lists rejected mispronunciation phrases present in the transcript, ignoring any phrase the script itself legitimately contains.
function findRejectedHits(normalizedTranscript: string, normalizedScript: string, rejected?: readonly string[]): string[] {
  if (!normalizedTranscript || !rejected || rejected.length === 0) return [];
  const hits: string[] = [];
  for (const bad of rejected) {
    const norm = normalizeForPronunciation(bad);
    if (!norm) continue;
    const pattern = new RegExp(`(?<![a-z0-9])${escapeRegex(norm)}(?![a-z0-9])`);
    if (pattern.test(normalizedScript)) continue;
    if (pattern.test(normalizedTranscript)) hits.push(bad);
  }
  return hits;
}

// Verifies an ASR transcript against every lexicon term that appears in the script (pure, no I/O).
export function verifyPronunciationTranscript(
  scriptText: string,
  transcriptText: string,
  lexicon: readonly PronunciationEntry[] = DEFAULT_PRONUNCIATION_LEXICON,
  method = "local offline speech recognition (no audio output on headless host)",
): PronunciationCheckReport {
  const expected = countLexiconTermsInScript(scriptText, lexicon);
  if (expected.length === 0) {
    return {
      status: "passed",
      method,
      transcript: transcriptText,
      terms: [],
      failures: [],
    };
  }

  const normalizedTranscript = normalizeForPronunciation(transcriptText);
  const normalizedScript = normalizeForPronunciation(stripSpokenMarkup(scriptText));
  const heardByEntry = countHeardByEntry(normalizedTranscript, lexicon);
  const terms: PronunciationTermResult[] = [];
  const failures: string[] = [];

  for (const { entry, count } of expected) {
    const heardCount = heardByEntry.get(entry) ?? 0;
    const rejectedHits = findRejectedHits(normalizedTranscript, normalizedScript, entry.rejectedHeard);
    const passed = rejectedHits.length === 0 && heardCount >= count;
    terms.push({
      written: entry.written,
      spoken: entry.spoken,
      expectedCount: count,
      heardCount,
      rejectedHits,
      passed,
    });
    if (!passed) {
      const reasons: string[] = [];
      if (rejectedHits.length > 0) reasons.push(`heard mispronunciation ${rejectedHits.map((h) => `"${h}"`).join(", ")}`);
      if (heardCount < count) reasons.push(`heard ${heardCount} of ${count} expected occurrence(s)`);
      failures.push(`"${entry.written}" (spoken as "${entry.spoken}"): ${reasons.join(" and ")}`);
    }
  }

  return {
    status: failures.length === 0 ? "passed" : "failed",
    method,
    transcript: transcriptText,
    terms,
    failures,
  };
}

// Runs the repo's offline Whisper helper script on a WAV file using $AIDEOS_STT_PYTHON or python3.
export function transcribeWavOffline(
  wavPath: string,
  pythonBin: string = environment.AIDEOS_STT_PYTHON || "python3",
): PronunciationTranscription {
  const script = path.resolve(__dirname, "narrationTranscribe.py");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pron-stt-"));
  const outPath = path.join(tmpDir, "transcript.json");
  try {
    const run = spawnSyncBounded(pythonBin, [script, wavPath, outPath], {
      encoding: "utf8",
      env: { ...environment, KMP_DUPLICATE_LIB_OK: "TRUE" },
      maxBuffer: 32 * 1024 * 1024,
      timeout: TRANSCRIBE_TIMEOUT_MS,
    });
    if (isProcTimeout(run)) {
      throw new Error(`speech recognition timed out on ${path.basename(wavPath)}`);
    }
    if (run.error) {
      throw new PronunciationAsrUnavailableError(`could not start ${pythonBin}: ${run.error.message}`);
    }
    if (run.status === 2) {
      throw new PronunciationAsrUnavailableError((run.stderr || "").trim() || `no local speech-to-text engine installed for ${pythonBin}`);
    }
    if (run.status !== 0) {
      throw new Error(`speech recognition failed: ${(run.stderr || "").trim() || `exit ${run.status}`}`);
    }
    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8")) as Partial<PronunciationTranscription>;
    return {
      engine: String(parsed.engine ?? "whisper"),
      model: String(parsed.model ?? "small"),
      transcript: String(parsed.transcript ?? ""),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Options for running the standing pronunciation verification check on a narration WAV. */
export interface CheckPronunciationOptions {
  lexicon?: readonly PronunciationEntry[];
  /** Custom transcriber (tests inject a deterministic stub; production uses transcribeWavOffline). An injected transcriber always runs, whatever the off switch says. */
  transcriber?: PronunciationTranscriber;
  /** Python binary with openai-whisper or faster-whisper installed (defaults to $AIDEOS_STT_PYTHON or python3). */
  pythonBin?: string;
  /** Environment to read the off switch from (defaults to the process environment). */
  env?: NodeJS.ProcessEnv;
  /** True when the synthesizer carries no speech (the tone placeholder), so there is nothing to recognise. */
  speechless?: boolean;
}

// Reads the AIDEOS_PRONUNCIATION_CHECK toggle: true when the check is turned off, throwing on an unrecognised value.
function pronunciationCheckIsOff(env: NodeJS.ProcessEnv): boolean {
  const raw = env[PRONUNCIATION_CHECK_ENV];
  if (raw === undefined || raw.trim() === "") return false;
  const norm = raw.trim().toLowerCase();
  if (norm === "off" || norm === "0" || norm === "false" || norm === "no") return true;
  if (norm === "on" || norm === "1" || norm === "true" || norm === "yes") return false;
  throw new Error(`${PRONUNCIATION_CHECK_ENV}="${raw}" is not valid. Use "on" or "off" (default "on").`);
}

// Runs the standing pronunciation verification check on produced narration audio and returns its structured report.
export async function checkNarrationPronunciation(
  scriptText: string,
  wavPath: string,
  options: CheckPronunciationOptions = {},
): Promise<PronunciationCheckReport> {
  const lexicon = options.lexicon ?? DEFAULT_PRONUNCIATION_LEXICON;

  if (options.speechless && !options.transcriber) {
    return {
      status: "not_applicable",
      method: "pronunciation check not applicable",
      transcript: null,
      terms: [],
      failures: [],
      reason: "the synthesizer carries no speech (tone placeholder), so there is nothing to recognise",
    };
  }

  if (!options.transcriber && pronunciationCheckIsOff(options.env ?? environment)) {
    return {
      status: "disabled",
      method: "pronunciation check turned off",
      transcript: null,
      terms: [],
      failures: [],
      reason: `pronunciation check disabled (${PRONUNCIATION_CHECK_ENV}=off): no lexicon word was verified`,
    };
  }
  const expected = countLexiconTermsInScript(scriptText, lexicon);
  if (expected.length === 0) {
    return {
      status: "passed",
      method: "lexicon scan (no lexicon terms present in script)",
      transcript: null,
      terms: [],
      failures: [],
    };
  }

  const pythonBin = options.pythonBin ?? (environment.AIDEOS_STT_PYTHON || "python3");
  const runTranscriber: PronunciationTranscriber = options.transcriber ?? ((file) => transcribeWavOffline(file, pythonBin));

  try {
    const heard = await runTranscriber(wavPath);
    const method = `${heard.engine} (${heard.model}) offline transcription (no audio output on headless host)`;
    return verifyPronunciationTranscript(scriptText, heard.transcript, lexicon, method);
  } catch (err) {
    if (err instanceof PronunciationAsrUnavailableError) {
      throw new PronunciationAsrUnavailableError(
        `Pronunciation check needs a local speech-to-text engine but none is available (${err.message}). ` +
          `Point AIDEOS_STT_PYTHON at a Python with openai-whisper or faster-whisper, or turn the check off explicitly with ${PRONUNCIATION_CHECK_ENV}=off.`,
      );
    }
    throw err;
  }
}
