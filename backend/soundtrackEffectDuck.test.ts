/**
 * File Description: Behavioural check that a library sound effect running into narration ducks under the measured speech, through the real Remotion soundtrack mixer.
 * Inputs and outputs: Synthetic tone stems (speech-like gated tone, effect tones, music tone) -> measured effect levels in gaps and under speech, and the speech-to-effect ratio.
 * Used by: npm test (owner feedback 2026-11-22 item 2b: the narration must stay clear over the soundtrack).
 */
import "./testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import { prepareSoundtrack } from "./soundtrack";
import { THRESHOLDS as T } from "./review/thresholds";
import { normalizeFilmSoundtrack, parseFilm } from "../src/dl/schema";
import { effectGain, soundtrackItem } from "../src/dl/audio/sectionMixer";
import { resolvePackageDir } from "../src/dl/videoPackageLoader";

// Writes a mono 48 kHz tone, optionally gated by an ffmpeg expression and normalized to a loudness.
function tone(file: string, frequency: number, duration: number, options: { gate?: string; lufs?: number; amplitude?: number } = {}): void {
  const amplitude = options.amplitude ?? 0.1;
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i",
    `aevalsrc='${amplitude}*sin(2*PI*${frequency}*t)${options.gate ? `*(${options.gate})` : ""}':s=48000:d=${duration}`,
    ...(options.lufs === undefined ? [] : ["-af", `loudnorm=I=${options.lufs}:TP=-1:LRA=11`]),
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", file,
  ]);
}

// Measures one tone's RMS through two narrow bandpasses so the other stems do not leak into the reading.
function rms(file: string, from: number, to: number, frequency: number): number {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-ss", String(from), "-t", String(to - from), "-i", file,
    "-af", `aformat=channel_layouts=stereo,bandpass=f=${frequency}:width_type=q:w=20,bandpass=f=${frequency}:width_type=q:w=20,astats`, "-f", "null", "-",
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  const value = /RMS level dB:\s*([^\s]+)/.exec(result.stderr)?.[1];
  if (!value) throw new Error(`Missing effect duck RMS result: ${result.stderr}`);
  return Number(value);
}

// Requires a measured level within a tolerance, printing the measured value on failure.
function near(actual: number, expected: number, tolerance: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual.toFixed(2)}, expected ${expected} +/- ${tolerance}`);
}

test("a chapter-cut effect that runs into narration ducks under the speech and keeps its level in the gap", { timeout: 180000 }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-effect-duck-"));
  const slug = "soundtrack-effect-duck";
  const pkg = resolvePackageDir(slug);
  const publicDir = path.join(work, "public");
  const assets = path.join(publicDir, "videos", slug);
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(pkg, { recursive: true });
  try {
    const bed = soundtrackItem("mk-1167");
    // sweep-tech is the transition that masked the narration in the 2026-11-22 test-quality delivery.
    const sweep = soundtrackItem("sweep-tech");
    tone(path.join(assets, "bed.wav"), 1000, bed.durationSec, { lufs: bed.loudness.integratedLufs });
    // Speech 0.5-4.0 s, a 0.3 s pause inside the phrase, speech 4.3-6.0 s, a 1.5 s gap, speech 7.5-11.5 s. The
    // six-syllables-a-second envelope gives the tone a speech-like crest factor (about 13 dB), so the effect's
    // narration-peak cap admits it as loud as it does under real speech.
    tone(path.join(assets, "voice.wav"), 440, 12, { lufs: -16,
      gate: "gte(t,0.5)*lt(t,11.5)*(1-between(t,4.0,4.3))*(1-between(t,6.0,7.5))*pow(abs(sin(2*PI*3*t)),8)" });
    // Two copies of the effect at distinct frequencies, peaking just under full scale (the manifest peak is +0.1 dBTP):
    // one cut lands inside a phrase, one in a gap before the next line.
    tone(path.join(assets, "cut-in-phrase.wav"), 3000, sweep.durationSec, { amplitude: 0.98 });
    tone(path.join(assets, "cut-in-gap.wav"), 5000, sweep.durationSec, { amplitude: 0.98 });
    for (const file of ["voice.wav", "bed.wav"]) fs.copyFileSync(path.join(assets, file), path.join(pkg, file));
    const base = loadFixtureFilm("fixture-canvas-a");
    const film = prepareSoundtrack(parseFilm({
      ...base, id: slug, voiceover: { src: `videos/${slug}/voice.wav`, volume: 1 },
      shots: base.shots.slice(0, 2).map((shot) => ({ ...shot, dur: 6 })),
      soundtrack: {
        sections: [{ item: bed.id, src: `videos/${slug}/bed.wav`, from: 0, to: 12 }],
        sfx: [
          { item: sweep.id, src: `videos/${slug}/cut-in-phrase.wav`, timeSec: 3.9, gainDb: 0, event: "chapter-cut" },
          { item: sweep.id, src: `videos/${slug}/cut-in-gap.wav`, timeSec: 6.4, gainDb: 0, event: "chapter-cut" },
        ],
      },
    }));
    const soundtrack = normalizeFilmSoundtrack(film);
    assert.ok(soundtrack.speech.some((s) => s.startSec < 4.0 && s.endSec > 4.3), "the 0.3 s pause stays inside the phrase");
    assert.ok(!soundtrack.speech.some((s) => s.startSec < 7 && s.endSec > 7), "the 1.5 s silence is a gap");
    const serveUrl = await bundle({ entryPoint: path.resolve(__dirname, "../test_fixtures/soundtrack/index.tsx"),
      outDir: path.join(work, "bundle"), publicDir });
    const inputProps = { film, format: "long" };
    const composition = await selectComposition({ serveUrl, id: "Soundtrack", inputProps });
    const wav = path.join(work, "long.wav");
    await renderMedia({ serveUrl, composition, inputProps, outputLocation: wav, codec: "wav", concurrency: 2 });

    const capDb = 20 * Math.log10(effectGain(film.soundtrack!.sfx[1], soundtrack.mix, soundtrack.narrationPeakDb ?? -1));
    const reference = rms(path.join(assets, "cut-in-gap.wav"), 0.3, 0.75, 5000) + capDb;
    const voice = rms(wav, 7.6, 8.6, 440);
    const inGap = rms(wav, 6.7, 7.15, 5000);
    const underSpeech = rms(wav, 7.6, 8.6, 5000);
    const inPhrase = rms(wav, 4.5, 5.5, 3000) - (rms(path.join(assets, "cut-in-phrase.wav"), 0.3, 0.75, 3000) -
      rms(path.join(assets, "cut-in-gap.wav"), 0.3, 0.75, 5000));
    console.log(`effect duck measurements: ${JSON.stringify({ voice, reference, inGap, underSpeech, inPhrase,
      speechToEffectWithoutDuckDb: voice - inGap, speechToEffectDb: voice - underSpeech })}`);

    near(inGap - reference, 0, 1, "in a gap the effect plays at its capped library level");
    near(inGap - underSpeech, -soundtrack.mix.duckDb, 1, "once the next line starts the effect sits at the music's speech duck");
    near(inGap - inPhrase, -soundtrack.mix.duckDb, 1, "an effect that starts inside a phrase is ducked from its first frame");
    assert.ok(voice - inGap < T.loudness.musicUnderVoiceMinDb,
      `the fixture effect would mask the speech without the duck (${(voice - inGap).toFixed(1)} dB)`);
    assert.ok(voice - underSpeech >= T.loudness.musicUnderVoiceMinDb,
      `under speech the effect sits at least the review minimum below the narration (${(voice - underSpeech).toFixed(1)} dB)`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});
