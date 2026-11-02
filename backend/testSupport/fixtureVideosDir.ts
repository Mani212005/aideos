/**
 * File Description: Test preload that gives every test process its own throwaway videos directory,
 * seeded from test_fixtures/packages, with a tiny synthetic audio library cached in it (no network,
 * no real tracks) so the compulsory music and sound effects can be assigned. Personal videos are gitignored and absent on a fresh clone, so
 * tests must never read them, and a test that writes a package must never touch the owner's real
 * videos/ folder. Loaded with `node --import` by `npm test` and, idempotently, by any test file that
 * needs a fixture package when run on its own: it sets AIDEOS_VIDEOS_DIR before anything resolves it.
 * Inputs and outputs: test_fixtures/packages/ and audio/library.json -> isolated temporary video packages directory with a hash-locked synthetic audio cache, AIDEOS_VIDEOS_DIR and AIDEOS_AUDIO_LIBRARY set for the test process.
 * Used by: npm test (Node test preload module).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FIXTURES = path.resolve(__dirname, "../../test_fixtures/packages");
const REAL_LIBRARY = path.resolve(__dirname, "../../audio/library.json");

/** Bump when the synthetic tracks or items below change, so a stale shared copy is rebuilt. */
const SYNTHETIC_LIBRARY_VERSION = "1";
const SAMPLE_RATE = 8000;
/** Long enough for any fixture film's story plus its end card; never looped. */
const MUSIC_SEC = 360;

/** The synthetic items: every music role on three tracks, and one effect per role the default scorer lays on a visual event. */
const SYNTHETIC_ITEMS = [
  ...["a", "b", "c"].map((letter, index) => ({ id: `test-music-${letter}`, kind: "music", roles: ["hook", "explain", "payoff", "outro", "reel"], durationSec: MUSIC_SEC, hz: 110 * (index + 1) })),
  { id: "test-sfx-endcard", kind: "sfx", roles: ["arrival", "endcard"], durationSec: 0.6, hz: 880 },
  { id: "test-sfx-transition", kind: "sfx", roles: ["transition"], durationSec: 0.8, hz: 660 },
  { id: "test-sfx-counter", kind: "sfx", roles: ["counter-finish"], durationSec: 0.4, hz: 990 },
  { id: "test-sfx-card", kind: "sfx", roles: ["card-enter"], durationSec: 0.3, hz: 770 },
] as const;

// Encodes a quiet 8-bit mono sine as a WAV file body.
function syntheticWav(durationSec: number, hz: number): Buffer {
  const samples = Math.round(durationSec * SAMPLE_RATE);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  const data = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) data[i] = 128 + Math.round(12 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
  return Buffer.concat([header, data]);
}

/** Builds (once per machine and library version) a manifest of the real library plus the synthetic items, and their audio files; returns where they live. */
function ensureSyntheticLibrary(): { manifest: string; filesDir: string } {
  const realBytes = fs.readFileSync(REAL_LIBRARY);
  const key = crypto.createHash("sha256").update(realBytes).update(SYNTHETIC_LIBRARY_VERSION).digest("hex").slice(0, 16);
  const root = path.join(os.tmpdir(), `aideos-test-audio-library-${key}`);
  if (fs.existsSync(path.join(root, "library.json"))) return { manifest: path.join(root, "library.json"), filesDir: path.join(root, "files") };

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-test-audio-staging-"));
  fs.mkdirSync(path.join(staging, "files"));
  const real = JSON.parse(realBytes.toString("utf8")) as { items: unknown[] };
  const items = SYNTHETIC_ITEMS.map((item) => {
    const wav = syntheticWav(item.durationSec, item.hz);
    fs.writeFileSync(path.join(staging, "files", `${item.id}.wav`), wav);
    return {
      id: item.id, kind: item.kind, title: item.id, artist: "aideos test fixture", source: "synthetic",
      url: `https://example.com/aideos-test/${item.id}.wav`,
      licence: { id: "test-synthetic", url: "https://example.com/", attribution: null, checkedAt: "2026-11-01" },
      sha256: crypto.createHash("sha256").update(wav).digest("hex"), bytes: wav.length, durationSec: item.durationSec,
      loudness: { integratedLufs: -16, truePeakDb: -3, lra: 0 }, roles: [...item.roles], moods: ["test"], energy: 1, contentIdRisk: "none",
    };
  });
  fs.writeFileSync(path.join(staging, "library.json"), JSON.stringify({ ...real, items: [...real.items, ...items] }, null, 2));
  try {
    fs.renameSync(staging, root);
  } catch {
    // Another test process finished first; its copy is identical.
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return { manifest: path.join(root, "library.json"), filesDir: path.join(root, "files") };
}

/** Caches the synthetic audio inside a videos directory, hard-linked so each test process pays no copy. */
function cacheSyntheticAudio(videosDir: string): void {
  const { manifest, filesDir } = ensureSyntheticLibrary();
  const cache = path.join(videosDir, ".audio-library");
  fs.mkdirSync(cache, { recursive: true });
  for (const file of fs.readdirSync(filesDir)) {
    try {
      fs.linkSync(path.join(filesDir, file), path.join(cache, file));
    } catch {
      fs.copyFileSync(path.join(filesDir, file), path.join(cache, file));
    }
  }
  process.env.AIDEOS_AUDIO_LIBRARY = manifest;
}

/** Creates the per-process videos directory, seeds it with the fixture packages and points the loader at it. */
function installFixtureVideosDir(): string {
  // A child test process inherits the parent's env, so ownership is keyed on the pid: each process
  // seeds its own directory, and a second load inside the same process reuses the first.
  const existing = process.env.AIDEOS_TEST_VIDEOS_DIR;
  if (existing && process.env.AIDEOS_TEST_VIDEOS_PID === String(process.pid) && fs.existsSync(existing)) return existing;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-test-videos-"));
  if (fs.existsSync(FIXTURES)) fs.cpSync(FIXTURES, dir, { recursive: true });
  cacheSyntheticAudio(dir);
  process.env.AIDEOS_VIDEOS_DIR = dir;
  process.env.AIDEOS_TEST_VIDEOS_DIR = dir;
  process.env.AIDEOS_TEST_VIDEOS_PID = String(process.pid);
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const TEST_VIDEOS_DIR = installFixtureVideosDir();
