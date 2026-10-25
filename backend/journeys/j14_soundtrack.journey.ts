/**
 * File Description: Journey covering studio soundtrack scenarios under decision D6 (add music while narration exists, insert audio asset lane routing, music lane ducking through end card, and multi-music persistence) measured by the bandpass RMS tone method.
 * Inputs and outputs: Tone narration and music fixtures -> Remotion rendered audio measurements and assertions.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { journey, REPO_ROOT } from "./harness";
import { writeFilm, setActiveFilm, ensureGenerated, packageDir } from "../pipeline/filmStore";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../src/dl/convertFilm";
import { importMediaAssetToLayeredFilm } from "../timeline/layer_engine";
import type { Film } from "../../src/dl/schema";

// Generates a mono 16-bit PCM WAV tone at the requested frequency.
function generateSineTone(filePath: string, freq: number, durationSec: number = 20): void {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    execSync(
      `ffmpeg -y -f lavfi -i "sine=frequency=${freq}:sample_rate=48000:duration=${durationSec}" -c:a pcm_s16le "${filePath}"`,
      { stdio: "ignore" }
    );
  }
}

// Measures bandpass RMS in decibels within a given time window for a target center frequency.
function measureBandpassRms(wavPath: string, startSec: number, endSec: number, freq: number): number {
  const cmd = `ffmpeg -ss ${startSec} -to ${endSec} -i "${wavPath}" -af "bandpass=f=${freq}:width_type=q:w=20,astats" -f null - 2>&1`;
  const out = execSync(cmd).toString();
  const match = /RMS level dB:\s*([-\d.inf]+)/.exec(out);
  if (!match) return -999;
  return match[1] === "-inf" ? -Infinity : parseFloat(match[1]);
}

// Renders the active film's Long composition to a WAV file using Remotion CLI.
function renderAudioWav(outWav: string): void {
  try {
    execSync(`npx remotion render src/index.ts Long "${outWav}" --codec=wav`, {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch (err: any) {
    console.error("remotion render failed. stderr:", err.stderr?.toString());
    console.error("stdout:", err.stdout?.toString());
    throw err;
  }
}

journey("decision D6: studio soundtrack journey covers narration retention, asset insertion lane, music ducking through end card, and multi-music persistence", async (ctx) => {
  const slug = "journey-soundtrack-d6";
  const pkgDir = packageDir(slug);
  const repoVideosDir = path.join(REPO_ROOT, "videos", slug);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.mkdirSync(repoVideosDir, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, "examples/hello-scene/visuals"), path.join(pkgDir, "visuals"), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, "examples/hello-scene/visuals"), path.join(repoVideosDir, "visuals"), { recursive: true });

  const tonesDir = path.join(ctx.workDir, "tones");
  const t440 = path.join(tonesDir, "narration_440.wav");
  const t1000 = path.join(tonesDir, "music_a_1000.wav");
  const t2000 = path.join(tonesDir, "music_b_2000.wav");
  generateSineTone(t440, 440, 20);
  generateSineTone(t1000, 1000, 20);
  generateSineTone(t2000, 2000, 20);

  fs.copyFileSync(t440, path.join(pkgDir, "voiceover.wav"));
  fs.copyFileSync(t1000, path.join(pkgDir, "music-a.wav"));
  fs.copyFileSync(t2000, path.join(pkgDir, "music-b.wav"));
  fs.copyFileSync(t440, path.join(repoVideosDir, "voiceover.wav"));
  fs.copyFileSync(t1000, path.join(repoVideosDir, "music-a.wav"));
  fs.copyFileSync(t2000, path.join(repoVideosDir, "music-b.wav"));

  const helloScenePath = path.join(REPO_ROOT, "examples/hello-scene/film.json");
  const baseFilm: Film = JSON.parse(fs.readFileSync(helloScenePath, "utf8"));
  baseFilm.id = slug;

  try {
    // Scenario 1: Add music while narration exists and confirm narration remains.
    // Decision D6 standard: narration remains present at its original level.
    const filmS1: Film = JSON.parse(JSON.stringify(baseFilm));
    filmS1.voiceover = { src: `videos/${slug}/voiceover.wav`, volume: 1.0 };
    filmS1.music = { src: `videos/${slug}/music-a.wav`, volume: 0.5, duckUnderVoiceover: true };
    delete filmS1.audioClips;

    writeFilm(slug, filmS1);
    setActiveFilm(slug);
    const wavS1 = path.join(ctx.workDir, "out-s1.wav");
    renderAudioWav(wavS1);
    ctx.keep(wavS1);

    const s1Narration = measureBandpassRms(wavS1, 1, 4, 440);
    const s1MusicA = measureBandpassRms(wavS1, 1, 4, 1000);
    assert.ok(
      Math.abs(s1Narration - (-24.12)) < 1.0,
      `Scenario 1 (D6): narration must remain present (expected ~ -24.12 dB, got ${s1Narration.toFixed(2)} dB)`
    );
    assert.ok(
      Math.abs(s1MusicA - (-42.05)) < 1.0,
      `Scenario 1 (D6): music A must be ducked under narration (expected ~ -42.05 dB, got ${s1MusicA.toFixed(2)} dB)`
    );
    fs.rmSync(wavS1, { force: true });

    // Scenario 2: Insert an audio file and confirm narration stays at its original position.
    // Decision D6 standard: studio import routes audio to layer-audio-music, not the voiceover spine.
    const layeredBefore = convertFilmToLayeredFilm(filmS1);
    const voBefore = layeredBefore.clips.find((c) => c.kind === "audio" && c.layerId === "layer-audio-spine");
    assert.ok(voBefore, "Scenario 2 (D6): narration spine clip must exist");
    assert.equal(voBefore.position, 0, "Scenario 2 (D6): narration spine starts at 0s");

    const importResult = importMediaAssetToLayeredFilm(layeredBefore, {
      filename: "music-a.wav",
      src: `videos/${slug}/music-a.wav`,
      type: "audio",
      duration: 10,
    }, 0); // No target lane passed (insert at playhead)

    const insertedClip = importResult.film.clips.find((c) => c.id === importResult.audioClipId);
    const voAfter = importResult.film.clips.find((c) => c.id === voBefore.id);
    assert.equal(
      insertedClip?.layerId,
      "layer-audio-music",
      "Scenario 2 (D6): inserted audio must route to layer-audio-music"
    );
    assert.equal(
      voAfter?.position,
      0,
      "Scenario 2 (D6): narration must not be pushed by inserted audio"
    );

    // Scenario 3: Music on the Music lane is ducked under narration and continues through the end card.
    // Decision D6 standard: Music lane audio uses channel music with ducking and end card continuation.
    const filmS3: Film = JSON.parse(JSON.stringify(baseFilm));
    filmS3.voiceover = { src: `videos/${slug}/voiceover.wav`, volume: 1.0 };
    delete filmS3.music;
    filmS3.audioClips = [
      {
        id: "clip-audio-bed",
        src: `videos/${slug}/music-a.wav`,
        position: 0,
        start: 0,
        end: 10,
        volume: 0.5,
        channel: "music",
      },
    ];

    writeFilm(slug, filmS3);
    setActiveFilm(slug);
    const wavS3 = path.join(ctx.workDir, "out-s3.wav");
    renderAudioWav(wavS3);
    ctx.keep(wavS3);

    const s3MusicDucked = measureBandpassRms(wavS3, 1, 4, 1000);
    const s3MusicEndCard = measureBandpassRms(wavS3, 12, 15, 1000);
    assert.ok(
      Math.abs(s3MusicDucked - (-42.05)) < 1.0,
      `Scenario 3 (D6): music on Music lane must be ducked under narration (expected ~ -42.05 dB, got ${s3MusicDucked.toFixed(2)} dB)`
    );
    assert.ok(
      Math.abs(s3MusicEndCard - (-30.22)) < 1.0,
      `Scenario 3 (D6): music on Music lane must continue through end card and rise (expected ~ -30.22 dB, got ${s3MusicEndCard.toFixed(2)} dB)`
    );
    fs.rmSync(wavS3, { force: true });

    // Scenario 4: A second music clip survives save and reload.
    // Decision D6 standard: multiple music clips persist through film conversion and both play ducked.
    const filmS4: Film = JSON.parse(JSON.stringify(baseFilm));
    filmS4.voiceover = { src: `videos/${slug}/voiceover.wav`, volume: 1.0 };
    filmS4.music = { src: `videos/${slug}/music-a.wav`, volume: 0.5, duckUnderVoiceover: true };
    filmS4.audioClips = [
      {
        id: "clip-music-b",
        src: `videos/${slug}/music-b.wav`,
        position: 6,
        start: 0,
        end: 3,
        volume: 0.5,
        channel: "music",
      },
    ];

    // Simulate studio save and reload roundtrip
    const layeredS4 = convertFilmToLayeredFilm(filmS4);
    const savedFilmS4 = convertLayeredFilmToFilm(layeredS4, filmS4);
    assert.ok(savedFilmS4.music, "Scenario 4 (D6): primary music must be preserved");
    assert.ok(
      savedFilmS4.audioClips?.some((c) => c.id === "clip-music-b" && c.channel === "music"),
      "Scenario 4 (D6): second music clip must survive save and reload"
    );

    writeFilm(slug, savedFilmS4);
    setActiveFilm(slug);
    const wavS4 = path.join(ctx.workDir, "out-s4.wav");
    renderAudioWav(wavS4);
    ctx.keep(wavS4);

    const s4MusicA = measureBandpassRms(wavS4, 1, 4, 1000);
    const s4MusicB = measureBandpassRms(wavS4, 6, 9, 2000);
    assert.ok(
      Math.abs(s4MusicA - (-42.05)) < 1.0,
      `Scenario 4 (D6): music A must play ducked (expected ~ -42.05 dB, got ${s4MusicA.toFixed(2)} dB)`
    );
    assert.ok(
      Math.abs(s4MusicB - (-48.05)) < 1.0,
      `Scenario 4 (D6): second music clip B must play ducked (expected ~ -48.05 dB, got ${s4MusicB.toFixed(2)} dB)`
    );
    fs.rmSync(wavS4, { force: true });
  } finally {
    // Teardown
    fs.rmSync(pkgDir, { recursive: true, force: true });
    fs.rmSync(repoVideosDir, { recursive: true, force: true });
    fs.rmSync(path.join(REPO_ROOT, "src/dl/films", `${slug}.ts`), { force: true });
    ensureGenerated();
  }
});
