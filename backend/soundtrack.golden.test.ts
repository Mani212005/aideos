/**
 * File Description: The captain-approved D6 golden soundtrack check using identifiable tone stems and the real shared mixer.
 * Inputs and outputs: Generated tone fixture -> measured normalization, ducking, chapter crossfades and end-card audio assertions.
 * Used by: npm test (decision D6, report step 5).
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
import { parseFilm } from "../src/dl/schema";
import { deliveryTimeline, type DeliveryFormat } from "../src/dl/delivery";
import { soundtrackItem } from "../src/dl/audio/sectionMixer";
import { resolvePackageDir } from "../src/dl/videoPackageLoader";

// Produces mono tone assets at the library item's recorded loudness, with an identifiable real ending.
function tone(file: string, frequency: number, duration: number, lufs: number, gate?: string): void {
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i",
    `aevalsrc='0.1*sin(2*PI*${frequency}*t)${gate ? `*(${gate})` : ""}':s=48000:d=${duration}`,
    "-af", `loudnorm=I=${lufs}:TP=-1:LRA=11`, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", file,
  ]);
}

// Measures tone RMS with two bandpasses to reject loud narration leakage into the -18 dB music stem.
function rms(file: string, from: number, to: number, frequency: number): number {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-ss", String(from), "-t", String(to - from), "-i", file,
    "-af", `aformat=channel_layouts=stereo,bandpass=f=${frequency}:width_type=q:w=20,bandpass=f=${frequency}:width_type=q:w=20,astats`, "-f", "null", "-",
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  const value = /RMS level dB:\s*([^\s]+)/.exec(result.stderr)?.[1];
  if (!value) throw new Error(`Missing D6 RMS result: ${result.stderr}`);
  return Number(value);
}

// Reads integrated loudness from ffmpeg's final EBU R128 summary.
function integrated(file: string): number {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  const summaries = [...result.stderr.matchAll(/I:\s*(-?[\d.]+) LUFS/g)];
  return Number(summaries[summaries.length - 1]?.[1]);
}

// Requires the captain's stated measurement tolerance, naming D6 in every golden failure.
function near(actual: number, expected: number, tolerance: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `D6 ${message}: ${actual.toFixed(2)}, expected ${expected} +/- ${tolerance}`);
}

test("D6 golden soundtrack: normalized sections, 18 dB duck, centered crossfade and end-card resolve", { timeout: 180000 }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-soundtrack-d6-"));
  const slug = "soundtrack-golden-d6";
  const pkg = resolvePackageDir(slug);
  const publicDir = path.join(work, "public");
  const assets = path.join(publicDir, "videos", slug);
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(pkg, { recursive: true });
  try {
    const a = soundtrackItem("mk-1167");
    const b = soundtrackItem("mk-1023");
    tone(path.join(assets, "a.wav"), 1000, a.durationSec, a.loudness.integratedLufs);
    // A different frequency in the source's last second proves the final section is actually back-timed.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
      `aevalsrc='0.1*sin(2*PI*if(lt(t,${b.durationSec - 1}),2000,2500)*t)':s=48000:d=${b.durationSec}`,
      "-af", `loudnorm=I=${b.loudness.integratedLufs}:TP=-1:LRA=11`, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path.join(assets, "b.wav")]);
    // The 0.3 s word gap must stay ducked; the 0.9 s chapter breath must release, with its cut at 30 s.
    tone(path.join(assets, "voice.wav"), 440, 60, -16,
      "gte(t,0.5)*lt(t,59.5)*(1-between(t,2.5,2.8))*(1-between(t,29.55,30.45))*(1-between(t,45,46.2))");
    tone(path.join(assets, "card.wav"), 440, 1.2, -16);
    fs.copyFileSync(path.join(assets, "voice.wav"), path.join(pkg, "voice.wav"));
    fs.copyFileSync(path.join(assets, "a.wav"), path.join(pkg, "a.wav"));
    fs.copyFileSync(path.join(assets, "b.wav"), path.join(pkg, "b.wav"));
    // The effect's fixture peak matches the manifest, allowing its narration-relative peak cap to be measured.
    const effect = soundtrackItem("card-arrive");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
      `aevalsrc=${10 ** (effect.loudness.truePeakDb / 20)}*sin(2*PI*3000*t):s=48000:d=${effect.durationSec}`,
      "-c:a", "pcm_s16le", path.join(assets, "arrival.wav")]);
    const base = loadFixtureFilm("fixture-canvas-a");
    const film = prepareSoundtrack(parseFilm({
      ...base, id: slug, voiceover: { src: `videos/${slug}/voice.wav`, volume: 1 },
      shots: base.shots.slice(0, 4).map((shot) => ({ ...shot, dur: 15 })),
      endCardVoice: { src: `videos/${slug}/card.wav`, durationSec: 1.2, words: [], text: "D6 tone line", fingerprint: "d6-tone" },
      soundtrack: { sections: [
        { item: a.id, src: `videos/${slug}/a.wav`, from: 0, to: 30 },
        { item: b.id, src: `videos/${slug}/b.wav`, from: 30, to: 60, role: "outro" },
      ], sfx: [{ item: effect.id, src: `videos/${slug}/arrival.wav`, timeSec: 60, gainDb: 0, event: "end-card" }] },
    }));
    assert.equal(prepareSoundtrack(film), film, "D6 unchanged narration reuses the measured intervals");
    assert.ok(film.soundtrack?.speech.some((s) => s.startSec < 2.5 && s.endSec > 2.8), "D6 word gaps are merged");
    assert.ok(!film.soundtrack?.speech.some((s) => s.startSec < 30 && s.endSec > 30), "D6 chapter breath remains a real pause");
    const serveUrl = await bundle({ entryPoint: path.resolve(__dirname, "../test_fixtures/soundtrack/index.tsx"),
      outDir: path.join(work, "bundle"), publicDir });
    const refA = rms(path.join(assets, "a.wav"), 1, 2, 1000);
    const refB = rms(path.join(assets, "b.wav"), 1, 2, 2000) + (-16 - b.loudness.integratedLufs);
    const refEnding = rms(path.join(assets, "b.wav"), b.durationSec - 0.7, b.durationSec - 0.3, 2500) +
      (-16 - b.loudness.integratedLufs);
    const metrics = [];
    for (const format of ["long", "reel"] satisfies DeliveryFormat[]) {
      const inputProps = { film, format };
      const composition = await selectComposition({ serveUrl, id: "Soundtrack", inputProps });
      const wav = path.join(work, `${format}.wav`);
      await renderMedia({ serveUrl, composition, inputProps, outputLocation: wav, codec: "wav", concurrency: 2 });
      const voice = rms(wav, 1, 2, 440);
      const bedA = rms(wav, 1, 2, 1000);
      const bedB = rms(wav, 33, 34, 2000);
      near(bedA - refA, -18, 1, `${format} speech duck depth`);
      near(bedB - refB, -18, 1, `${format} second section normalization`);
      near(rms(wav, 2.55, 2.75, 1000) - bedA, 0, 1, `${format} no pumping between words`);
      near(rms(wav, 45.7, 45.9, 2000) - refB, -10, 1, `${format} long pause gain`);
      const fade = format === "long" ? 3 : 1.5;
      const pre = 30 - fade / 2 - 0.15;
      const post = 30 + fade / 2 + 0.15;
      console.log(`D6 ${format} boundary measurements: ${JSON.stringify({ refA, refB, voice, bedA, bedB,
        beforeIncoming: rms(wav, pre, pre + 0.1, 2000), afterOutgoing: rms(wav, post, post + 0.1, 1000) })}`);
      assert.ok(rms(wav, pre, pre + 0.1, 2000) < bedB - 20, `D6 ${format} crossfade has not started early`);
      assert.ok(rms(wav, post, post + 0.1, 1000) < bedA - 20, `D6 ${format} crossfade has ended at the chapter`);
      const centerA = rms(wav, 29.95, 30.05, 1000) - refA;
      const centerB = rms(wav, 29.95, 30.05, 2000) - refB;
      near(centerA - centerB, 0, 1, `${format} equal-power center lands in chapter breath`);
      const shoulder = 30 - fade / 4;
      near((rms(wav, shoulder - 0.05, shoulder + 0.05, 1000) - refA) -
        (rms(wav, shoulder - 0.05, shoulder + 0.05, 2000) - refB), 7.66, 1.2, `${format} equal-power crossfade shape`);
      near(rms(wav, 60.6, 61.0, 2000) - refB, -18, 1, `${format} end-card spoken line ducks music`);
      const end = deliveryTimeline(film, format).totalFrames / film.fps;
      // The reel line ends at 61.5 s and releases until 62.1 s; measure its ending after that release.
      near(rms(wav, end - 0.7, end - 0.3, 2500) - refEnding, -8, 1, `${format} end-card music-only gain`);
      assert.ok(rms(wav, end - 0.7, end - 0.3, 2500) > refB - 12, `D6 ${format} real track ending lands on the end card`);
      // Equal-frequency fixtures have the same crest factor, so a stem RMS difference also measures their peak gap.
      assert.ok(rms(wav, 60.1, 60.2, 3000) <= voice - 8 + 0.5, `D6 ${format} arrival effect is at least 8 dB under narration peaks`);
      const lufs = integrated(wav);
      near(lufs, -16, 0.5, `${format} tone-fixture integrated loudness`);
      metrics.push({ format, duckDb: bedA - refA, sectionDb: bedB - refB, crossfadeCenterDb: centerA - centerB,
        endCardDb: rms(wav, end - 0.7, end - 0.3, 2500) - refEnding, integratedLufs: lufs });
      fs.rmSync(wav);
    }
    console.log(`D6 soundtrack golden measurements: ${JSON.stringify(metrics)}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});
