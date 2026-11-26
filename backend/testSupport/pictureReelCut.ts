/**
 * File Description: Test fixture for a picture film whose reel must be cut: copies the synthetic pictures-stage package (tiny generated PNGs, pinned in its design.json, never real art) into a fresh package, builds its design, stretches it past the reel cap and writes a checked cut with measured-style narration stubs. Also holds the shared narration stub that gives exact shot boundaries and word times.
 * Inputs and outputs: a new slug -> a built long film, a reel cut file and a narrator stub that needs no TTS or network.
 * Used by: backend/reelCut/build.test.ts and backend/journeys/pictures_stage.journey.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../videoPackageLoader";
import type { Film } from "../../src/dl/schema";
import { buildCaptionsVtt, type ProduceAudioResult } from "../audio";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { createReelContext } from "../reelCut/constraints";
import type { ReelCut } from "../reelCut/schema";
import { FAKE_OWNER_BACKEND_NAME, FAKE_OWNER_VOICE_ID } from "./fakeVcd";

const FIXTURE = path.resolve(__dirname, "../../test_fixtures/packages/pictures-stage");
/** How many times the fixture's 10 s story is stretched, so its reel (story plus end card) is over the 179 s cap and must be cut. */
const STRETCH = 20;
/** The reel's narration per shot: tighter than the long's, still speaking every phrase the design's clips are cued to. */
const TIGHT_NARRATION: Record<string, string> = { plate: "One dark stage holds every piece.", orb: "An orb arrives and settles.", chip: "Then a chip joins the orb on the stage." };
/** The measured length of each reel shot, in seconds. */
const REEL_SHOT_SECONDS = [3, 3, 4];

/** Makes a narration result with exact shot boundaries and evenly spaced words for the real cue matcher. */
export function narration(texts: string[], durations: number[], dir = ""): ProduceAudioResult {
  let cursor = 0;
  const segments = texts.map((text, index) => {
    const startOffset = cursor, duration = durations[index];
    const tokens = text.split(/\s+/);
    const words = tokens.map((word, k) => ({ word, punctuated_word: word, start: k * duration / tokens.length, end: (k + 1) * duration / tokens.length }));
    cursor += duration;
    return { text, duration, startOffset, words, utterances: [] };
  });
  const words = segments.flatMap((s) => s.words.map((w) => ({ ...w, start: s.startOffset + w.start, end: s.startOffset + w.end })));
  return { segments, words, shotDurations: durations, totalAudioDuration: cursor,
    captionsVttContent: buildCaptionsVtt(words), ttsBackend: FAKE_OWNER_BACKEND_NAME, voice: FAKE_OWNER_VOICE_ID, speed: 0.75,
    voiceoverPath: path.join(dir, "voiceover.wav"), wordsPath: path.join(dir, "voiceover_words.json"), captionsPath: path.join(dir, "captions.vtt") };
}

/** Copies the picture fixture into a fresh package named `slug` and builds its design through the real picture cache, pins and rules. */
export function picturePackage(slug: string): { pkg: string; long: Film } {
  const pkg = resolvePackageDir(slug);
  fs.rmSync(pkg, { recursive: true, force: true });
  fs.cpSync(FIXTURE, pkg, { recursive: true });
  const filmFile = path.join(pkg, "film.json");
  fs.writeFileSync(filmFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(filmFile, "utf8")), id: slug }));
  const built = buildDesign(slug, "hand-built");
  if (built.state !== "passed") throw new Error(`the picture fixture "${slug}" does not build: ${built.errors.join("; ")}`);
  const long = readFilm(slug);
  if (!long) throw new Error(`the picture fixture "${slug}" wrote no film`);
  return { pkg, long };
}

/** Stretches a built picture film past the reel cap (each shot, the scene and the narration length) and records the long voice the reel narrates in. */
export function stretchPastReelCap(slug: string, long: Film): Film {
  const stretched: Film = { ...long, shots: long.shots.map((s) => ({ ...s, dur: s.dur * STRETCH })),
    scene: long.scene && { ...long.scene, durationFrames: long.scene.durationFrames * STRETCH, audioDurationMs: long.scene.audioDurationMs * STRETCH },
    voiceover: long.voiceover && { ...long.voiceover, durationSec: (long.voiceover.durationSec ?? 10) * STRETCH } };
  const pkg = resolvePackageDir(slug);
  fs.writeFileSync(path.join(pkg, "film.json"), JSON.stringify(stretched));
  fs.writeFileSync(path.join(pkg, "narration.json"), JSON.stringify({ ttsBackend: FAKE_OWNER_BACKEND_NAME, voice: FAKE_OWNER_VOICE_ID, speed: 0.75 }));
  return stretched;
}

/** Writes the checked reel cut (every shot kept, tightened narration) and returns the narrator stub that measures it. */
export function writePictureCut(slug: string, long: Film): (script: string, dir: string) => Promise<ProduceAudioResult> {
  const context = createReelContext({ film: long });
  const cut: ReelCut = { schema: "aideos.reelcut/1", source: "agent", long: { shots: Object.fromEntries(context.shots.map((s) => [s.id, s.hash])) },
    shots: long.shots.map((s) => ({ id: s.id, narration: TIGHT_NARRATION[s.id] })) };
  fs.mkdirSync(path.join(resolvePackageDir(slug), "reel"), { recursive: true });
  fs.writeFileSync(path.join(resolvePackageDir(slug), "reel/cut.json"), JSON.stringify(cut));
  return async (script, dir) => narration(script.split("\n").filter((line) => Object.values(TIGHT_NARRATION).includes(line)), REEL_SHOT_SECONDS, dir);
}
