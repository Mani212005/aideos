/**
 * File Description: The end card's spoken line ("If this helped, like and subscribe.") in each film's
 * own narration voice. Reads the voice a package was narrated with from narration.json, synthesizes
 * the line once through the same sample-domain narration path into videos/<slug>/endcard/ (cached by
 * a fingerprint of the line and the voice), and attaches it to the film as `endCardVoice`. A package
 * narrated before its voice was recorded keeps a silent card and gets a notice instead of a guessed
 * voice that would not match.
 * Inputs and outputs: package slug, film and narration.json -> endcard/ audio, words and line.json, and a film carrying `endCardVoice`.
 * Used by: backend/pipeline/run.ts (narrate and render stages), editor/vite.config.ts (/api/export).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { produceAudioPipeline, type ProduceAudioOptions, type ProduceAudioResult } from "../audio";
import type { TtsBackendName } from "../tts";
import { DELIVERY_CONFIG, endCardEnabledFor, type DeliveryConfig } from "../../src/dl/delivery";
import type { Film } from "../../src/dl/schema";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { readFilm, writeFilm } from "../pipeline/filmStore";

/** Folder inside a package holding the spoken line. */
export const END_CARD_DIR = "endcard";
const RECORD_FILE = "line.json";
const TTS_BACKENDS: TtsBackendName[] = ["kokoro", "google", "say", "tone"];

/** The voice a film was narrated with, enough to synthesize another line that matches it. */
export interface NarrationVoice {
  backend: TtsBackendName;
  voice: string | null;
  speed: number | null;
}

/** What line.json records about a synthesized line. */
export interface EndCardLineRecord {
  schema: "aideos.endcard-line/1";
  fingerprint: string;
  text: string;
  ttsBackend: string;
  durationSec: number;
  /** Word timings relative to the start of the line. */
  words: Array<{ word: string; start: number; end: number }>;
}

/** Synthesizes narration audio; produceAudioPipeline in production, a stub in tests. */
export type LineSynthesizer = (text: string, outDir: string, options: ProduceAudioOptions) => Promise<ProduceAudioResult>;

// The voice of a finished narration, from its backend name ("kokoro:af_heart") and recorded settings.
export function narrationVoiceOf(result: Pick<ProduceAudioResult, "ttsBackend" | "voice" | "speed">): NarrationVoice | null {
  const kind = String(result.ttsBackend ?? "").split(":")[0] as TtsBackendName;
  if (!TTS_BACKENDS.includes(kind)) return null;
  return { backend: kind, voice: result.voice ?? null, speed: result.speed ?? null };
}

// Reads the narration voice recorded in a package's narration.json; null when it was never recorded.
export function readNarrationVoice(pkgDir: string): NarrationVoice | null {
  const file = path.join(pkgDir, "narration.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ProduceAudioResult>;
    // Packages narrated before voice and speed were recorded have neither key: their voice is unknown.
    if (!("voice" in raw) || !("speed" in raw) || typeof raw.ttsBackend !== "string") return null;
    return narrationVoiceOf({ ttsBackend: raw.ttsBackend, voice: raw.voice ?? null, speed: raw.speed ?? null });
  } catch {
    return null;
  }
}

// Short stable hash of the line and the voice it is spoken in.
export function endCardLineFingerprint(text: string, voice: NarrationVoice): string {
  return crypto.createHash("sha256").update(JSON.stringify([text, voice.backend, voice.voice, voice.speed])).digest("hex").slice(0, 16);
}

// Reads a package's line.json when it matches the fingerprint and its audio is still there.
function readMatchingRecord(dir: string, fingerprint: string): EndCardLineRecord | null {
  const file = path.join(dir, RECORD_FILE);
  if (!fs.existsSync(file) || !fs.existsSync(path.join(dir, "voiceover.wav"))) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as EndCardLineRecord;
    return record.fingerprint === fingerprint && record.durationSec > 0 && Array.isArray(record.words) ? record : null;
  } catch {
    return null;
  }
}

/**
 * Synthesizes the line into <pkg>/endcard/ in the given voice, or reuses the one already there for
 * the same line and voice. It goes through the narration's own assembly (trim, fade, loudness), so
 * the line sits at the same level as the story narration.
 */
export async function synthesizeEndCardLine(
  pkgDir: string,
  text: string,
  voice: NarrationVoice,
  synthesize: LineSynthesizer = produceAudioPipeline,
): Promise<EndCardLineRecord> {
  const dir = path.join(pkgDir, END_CARD_DIR);
  const fingerprint = endCardLineFingerprint(text, voice);
  const cached = readMatchingRecord(dir, fingerprint);
  if (cached) return cached;

  const result = await synthesize(text, dir, {
    backend: voice.backend,
    ...(voice.voice ? { voice: voice.voice } : {}),
    ...(voice.speed ? { speed: voice.speed } : {}),
  });
  const record: EndCardLineRecord = {
    schema: "aideos.endcard-line/1",
    fingerprint,
    text,
    ttsBackend: result.ttsBackend,
    durationSec: result.totalAudioDuration,
    words: result.words.map((w) => ({ word: w.punctuated_word ?? w.word, start: w.start, end: w.end })),
  };
  fs.writeFileSync(path.join(dir, RECORD_FILE), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

/** The outcome of making sure a film carries its spoken end card line. */
export interface EnsureEndCardVoiceResult {
  film: Film;
  /** "spoken": the film carries a current line. "silent": the card plays without one (see notice). */
  state: "spoken" | "silent";
  /** Why the card is silent, or a warning about the line, for the studio and the pipeline log. */
  notice?: string;
  /** Whether the film differs from the one passed in. */
  changed: boolean;
}

// Returns the film without a spoken line, noting whether that changed it.
function silent(film: Film, notice?: string): EnsureEndCardVoiceResult {
  if (!film.endCardVoice) return { film, state: "silent", notice, changed: false };
  const rest = { ...film };
  delete rest.endCardVoice;
  return { film: rest, state: "silent", notice, changed: true };
}

/**
 * Makes sure a film carries its spoken end card line, the way ensureRetimedAudio makes sure retimed
 * audio exists before a render: the line is synthesized when missing or stale (only when the
 * narration voice is known), attached to the film, and the film is written when it changed and
 * `write` is not false. A design rebuild or an older package therefore heals on its next render.
 */
export async function ensureEndCardVoice(
  slug: string,
  options: { film?: Film; write?: boolean; config?: DeliveryConfig; synthesize?: LineSynthesizer } = {},
): Promise<EnsureEndCardVoiceResult> {
  const film = options.film ?? readFilm(slug);
  if (!film) throw new Error(`no film for "${slug}": run the pipeline through design first`);
  const config = options.config ?? DELIVERY_CONFIG;
  const text = config.endCard.spokenLine.trim();

  let outcome: EnsureEndCardVoiceResult;
  if (!endCardEnabledFor(film, config) || !text) {
    outcome = silent(film);
  } else if (!film.voiceover?.src) {
    outcome = silent(film, "the film has no narration, so its end card has no spoken line");
  } else {
    const pkgDir = resolvePackageDir(slug);
    const voice = readNarrationVoice(pkgDir);
    if (!voice) {
      outcome = film.endCardVoice
        ? { film, state: "spoken", changed: false }
        : silent(film, `Generate end card line: videos/${slug} was narrated before its voice was recorded, so the end card stays silent rather than use a voice that does not match. Re-run the narrate stage to give it the spoken line.`);
    } else {
      const fingerprint = endCardLineFingerprint(text, voice);
      const current = film.endCardVoice;
      const wav = path.join(pkgDir, END_CARD_DIR, "voiceover.wav");
      if (current?.fingerprint === fingerprint && fs.existsSync(wav)) {
        outcome = { film, state: "spoken", changed: false };
      } else {
        const record = await synthesizeEndCardLine(pkgDir, text, voice, options.synthesize);
        const next: Film = {
          ...film,
          endCardVoice: {
            src: `videos/${slug}/${END_CARD_DIR}/voiceover.wav`,
            text: record.text,
            durationSec: record.durationSec,
            fingerprint: record.fingerprint,
            words: record.words,
          },
        };
        outcome = { film: next, state: "spoken", changed: true };
      }
    }
  }

  const shortest = Math.min(config.endCard.durationSec.long, config.endCard.durationSec.reel);
  const spoken = outcome.film.endCardVoice;
  if (spoken && shortest > 0 && spoken.durationSec > shortest) {
    outcome = { ...outcome, notice: `the end card line runs ${spoken.durationSec.toFixed(2)} s, longer than the ${shortest.toFixed(1)} s card, so its end is cut; shorten endCard.spokenLine in aideos.config.json` };
  }
  if (outcome.changed && options.write !== false) outcome = { ...outcome, film: writeFilm(slug, outcome.film) };
  return outcome;
}
