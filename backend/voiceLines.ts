/**
 * File Description: Line-by-line voice-over storage. Each narration line is recorded once and kept under
 * videos/<slug>/voiceover_lines/ keyed by a content fingerprint (its words plus the voice that spoke them and the
 * rate any pitch-preserving stretch re-paced it to),
 * so regenerating the voice-over re-records only the lines whose fingerprint changed and reuses every other
 * recording untouched. Synthesis is injected, so the logic is tested without any speech engine.
 * Inputs and outputs: narration lines, a voice key and a one-line synthesizer -> per-line audio (reused or fresh) and counts.
 * Used by: backend/audio.ts, editor/vite.config.ts (api/generate-voiceover, api/narration), backend/voiceLines.test.ts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** One recorded chunk of a line: the text it spoke and its samples. */
export interface LineChunk {
  text: string;
  samples: Float32Array;
}

/** The recording of one narration line (a long line may be several chunks). */
export interface LineAudio {
  sampleRate: number;
  chunks: LineChunk[];
}

/**
 * A fresh recording together with the voice key of the voice that actually spoke it, for a synthesizer whose
 * provider can fall through to another voice than the one requested.
 */
export interface SpokenLine {
  audio: LineAudio;
  voiceKey: string;
}

/** What `synthesizeLines` did for one line. */
export interface LineOutcome {
  text: string;
  fingerprint: string;
  /** True when the stored recording was used and nothing was synthesized. */
  reused: boolean;
  /** The voice key of the voice that spoke this recording. */
  voiceKey: string;
  audio: LineAudio;
}

/** The result of one voice-over pass over every line. */
export interface LineSynthesisResult {
  lines: LineOutcome[];
  /** Lines recorded in this pass. */
  recorded: number;
  /** Lines whose stored recording was reused. */
  reused: number;
}

/** Bump to invalidate every stored recording when the stored format changes. */
const STORE_VERSION = 1;

/** The directory a package keeps its per-line recordings in. */
export function voiceLinesDir(pkgDir: string): string {
  return path.join(pkgDir, "voiceover_lines");
}

/** The suffix a re-paced line's voice key carries: a line stretched to another rate is another recording. */
const STRETCH_KEY_MARK = "|stretch=";

/**
 * The voice key of lines re-paced by a pitch-preserving time-stretch. Rate 1 keeps the plain key, so an
 * unstretched line keeps the recording it had before stretching existed.
 */
export function pacedVoiceKey(voiceKey: string, stretch: number): string {
  if (!Number.isFinite(stretch) || stretch <= 0) throw new Error(`pacedVoiceKey: stretch must be a positive number, got ${stretch}`);
  return Math.abs(stretch - 1) < 1e-6 ? voiceKey : `${voiceKey}${STRETCH_KEY_MARK}${stretch}`;
}

/** The voice key a line was recorded with, without any re-pacing suffix (to recognise the voice itself). */
export function unpacedVoiceKey(voiceKey: string): string {
  const at = voiceKey.lastIndexOf(STRETCH_KEY_MARK);
  return at < 0 ? voiceKey : voiceKey.slice(0, at);
}

/**
 * The one voice key a recording is recorded as narrated by (narration.json `ttsBackend`), from the voice that actually
 * spoke each line (re-pacing suffixes ignored). One voice for every line: that voice. Mixed voices: the requested voice
 * if it spoke at least one line, otherwise the voice that spoke the most lines (a tie goes to the one that spoke first).
 * Per-line truth stays in the line cache; this is only the single value a file with one narrator field can hold.
 */
export function narratingVoiceKey(lines: ReadonlyArray<{ voiceKey: string }>, requestedVoiceKey: string): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const voice = unpacedVoiceKey(line.voiceKey);
    counts.set(voice, (counts.get(voice) ?? 0) + 1);
  }
  if (counts.size === 0) return requestedVoiceKey;
  const requested = unpacedVoiceKey(requestedVoiceKey);
  if (counts.has(requested)) return requested;
  let best = "";
  let bestCount = 0;
  for (const [voice, count] of counts) {
    if (count > bestCount) {
      best = voice;
      bestCount = count;
    }
  }
  return best;
}

/** The content fingerprint of one line: its words plus the voice key that speaks them. */
export function lineFingerprint(text: string, voiceKey: string): string {
  return createHash("sha256").update(JSON.stringify([STORE_VERSION, voiceKey, text])).digest("hex").slice(0, 24);
}

/** Reads a stored recording, or null when it is absent or unreadable (an unreadable one is simply re-recorded). */
export function readLine(pkgDir: string, fingerprint: string): LineAudio | null {
  try {
    const dir = voiceLinesDir(pkgDir);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, `${fingerprint}.json`), "utf8")) as {
      version: number;
      sampleRate: number;
      chunks: Array<{ text: string; length: number }>;
    };
    if (meta.version !== STORE_VERSION) return null;
    const bytes = fs.readFileSync(path.join(dir, `${fingerprint}.f32`));
    // Copy out of the buffer first: a small read can sit at an offset that is not 4-byte aligned.
    const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 4)));
    const chunks: LineChunk[] = [];
    let offset = 0;
    for (const chunk of meta.chunks) {
      if (offset + chunk.length > all.length) return null;
      chunks.push({ text: chunk.text, samples: all.slice(offset, offset + chunk.length) });
      offset += chunk.length;
    }
    return { sampleRate: meta.sampleRate, chunks };
  } catch {
    return null;
  }
}

/** Writes one recording atomically (temp file then rename), tagged with the voice key it was made with. */
export function writeLine(pkgDir: string, fingerprint: string, voiceKey: string, audio: LineAudio): void {
  const dir = voiceLinesDir(pkgDir);
  fs.mkdirSync(dir, { recursive: true });
  const total = audio.chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of audio.chunks) {
    merged.set(chunk.samples, offset);
    offset += chunk.samples.length;
  }
  const meta = {
    version: STORE_VERSION,
    voiceKey,
    sampleRate: audio.sampleRate,
    chunks: audio.chunks.map((chunk) => ({ text: chunk.text, length: chunk.samples.length })),
  };
  const write = (name: string, data: string | Buffer) => {
    const target = path.join(dir, name);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  };
  write(`${fingerprint}.f32`, Buffer.from(merged.buffer, merged.byteOffset, merged.byteLength));
  write(`${fingerprint}.json`, JSON.stringify(meta));
}

/**
 * Deletes this voice's recordings that no current line uses, so edited-away lines and re-paced leftovers do not pile up on disk.
 * "This voice" means the same voice whatever stretch rate it was recorded at (unpacedVoiceKey equality), so switching the
 * stretch rate retires the recordings made at the other rate, including the plain-key ones made before stretching existed.
 * The cost: flipping back and forth between rates re-records the lines each time. Another voice, or the same voice under
 * another take selection, has another unpaced key and is never touched.
 */
function pruneUnused(pkgDir: string, voiceKey: string, keep: Set<string>): void {
  const dir = voiceLinesDir(pkgDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const voice = unpacedVoiceKey(voiceKey);
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const fingerprint = name.slice(0, -".json".length);
    if (keep.has(fingerprint)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { voiceKey?: unknown };
      if (typeof meta.voiceKey !== "string" || unpacedVoiceKey(meta.voiceKey) !== voice) continue;
    } catch {
      // an unreadable entry is garbage too
    }
    fs.rmSync(path.join(dir, name), { force: true });
    fs.rmSync(path.join(dir, `${fingerprint}.f32`), { force: true });
  }
}

/**
 * Records every line, reusing the stored recording for each line whose fingerprint is unchanged and
 * calling `synthesize` only for the rest. A line is stored the moment it is recorded, so a run that
 * fails part way keeps what it finished and the retry continues from there.
 *
 * When `synthesize` reports that another voice spoke a line (a SpokenLine whose voiceKey differs), the
 * line is stored under that voice, never under the requested one: the next run looks the requested
 * voice up again and records the line afresh. Only the requested voice's unused recordings are pruned.
 */
export async function synthesizeLines(options: {
  pkgDir: string;
  texts: string[];
  voiceKey: string;
  synthesize: (text: string) => Promise<LineAudio | SpokenLine>;
  onLine?: (done: number, total: number, text: string, reused: boolean) => void;
}): Promise<LineSynthesisResult> {
  const { pkgDir, texts, voiceKey, synthesize, onLine } = options;
  const lines: LineOutcome[] = [];
  let recorded = 0;
  let reused = 0;

  for (const text of texts) {
    const fingerprint = lineFingerprint(text, voiceKey);
    const stored = readLine(pkgDir, fingerprint);
    if (stored) {
      reused += 1;
      lines.push({ text, fingerprint, reused: true, voiceKey, audio: stored });
    } else {
      const fresh = await synthesize(text);
      const spoken: SpokenLine = "audio" in fresh ? fresh : { audio: fresh, voiceKey };
      const spokenFingerprint = spoken.voiceKey === voiceKey ? fingerprint : lineFingerprint(text, spoken.voiceKey);
      writeLine(pkgDir, spokenFingerprint, spoken.voiceKey, spoken.audio);
      recorded += 1;
      lines.push({ text, fingerprint: spokenFingerprint, reused: false, voiceKey: spoken.voiceKey, audio: spoken.audio });
    }
    onLine?.(lines.length, texts.length, text, lines[lines.length - 1].reused);
  }

  pruneUnused(pkgDir, voiceKey, new Set(lines.map((line) => line.fingerprint)));
  return { lines, recorded, reused };
}

/** For each narration line, whether a recording for the current voice is already stored. */
export function recordedStatus(pkgDir: string, texts: string[], voiceKey: string): boolean[] {
  return texts.map((text) => fs.existsSync(path.join(voiceLinesDir(pkgDir), `${lineFingerprint(text, voiceKey)}.json`)));
}

/** Linearly resamples mono samples to a new rate (used when one voice answers a line at another rate). */
export function resampleLinear(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const length = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(samples.length - 1, index + 1);
    const fraction = position - index;
    out[i] = samples[Math.min(index, samples.length - 1)] * (1 - fraction) + samples[next] * fraction;
  }
  return out;
}
