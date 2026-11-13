/**
 * File Description: Behavioural tests of the native renderer adapter through the public RenderJob lifecycle, with a stand-in `aideos-render` executable: the job emits a valid Render IR, stages its artwork, fonts and narration beside the output, passes the request's format, profile, frame range and threads to the binary, reports progress, records the CRF as applied only when x264 encoded, removes the staged package, and refuses an unbuilt binary, a failing render and a full disk with the cause named.
 * Inputs and outputs: the synthetic scene film written into the test's throwaway videos directory, a stub executable and stubbed delivery services -> asserted job states, files, arguments and errors.
 * Used by: npm test (Node test runner).
 */

import "./testSupport/fixtureVideosDir";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getVideosDir } from "../src/dl/videoPackageLoader";
import { createRenderJob, type RenderServices, type RenderState } from "./renderJob";
import { createNativeRenderer } from "./nativeRenderer";
import { parseRenderIr } from "./renderIr/validate";
import { nativeSceneFilm, PROBE_SVG } from "./testSupport/nativeSceneFilm";

/** The stand-in binary: answers `measure` like the fake measurer and `video` by recording what it saw. */
const STUB = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
if (args[0] === "measure") {
  const req = JSON.parse(fs.readFileSync(args[1], "utf8"));
  process.stdout.write(JSON.stringify({
    widths: req.runs.map((r) => [...r.text].length * (0.5 * r.size + (r.letterSpacing || 0))),
    metrics: (req.metrics || []).map((m) => ({ baseline: m.size, height: 1.3 * m.size, ascent: m.size, descent: 0.3 * m.size })),
  }));
  process.exit(0);
}
const opt = (name) => args[args.indexOf(name) + 1];
const pkg = opt("--package");
const listing = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else listing.push(path.relative(pkg, p)); } };
walk(pkg);
fs.writeFileSync(process.env.STUB_LOG, JSON.stringify({ args, listing: listing.sort(), ir: fs.readFileSync(args[1], "utf8") }));
if (process.env.STUB_FAIL) { process.stderr.write("aideos-render: " + process.env.STUB_FAIL + "\\n"); process.exit(1); }
fs.writeFileSync(opt("--out"), "encoded");
process.stdout.write("frames 30/60\\nframes 60/60\\n");
process.stdout.write(JSON.stringify({ encoder: process.env.STUB_ENCODER || "libx264", frames: 60, elapsedSec: 0.5, framesPerSecond: 120, fallbackReason: null }, null, 2) + "\\n");
`;

/** A one-second mono 8-bit WAV. */
function wav(): Buffer {
  const n = 8000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + n, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(n, 40);
  return Buffer.concat([header, Buffer.alloc(n, 128)]);
}

/** Writes the film's package into the throwaway videos dir and the stub into a temp dir. */
function setup(t: test.TestContext, env: Record<string, string> = {}) {
  const pkg = path.join(getVideosDir(), "native-probe");
  fs.mkdirSync(path.join(pkg, "visuals"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "visuals", "probe.svg"), PROBE_SVG);
  fs.writeFileSync(path.join(pkg, "voiceover.wav"), wav());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-native-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const binary = path.join(dir, "aideos-render");
  fs.writeFileSync(binary, STUB, { mode: 0o755 });
  const log = path.join(dir, "stub.json");
  const saved = { ...process.env };
  Object.assign(process.env, { STUB_LOG: log, ...env });
  t.after(() => {
    for (const key of ["STUB_LOG", "STUB_FAIL", "STUB_ENCODER"]) if (!(key in saved)) delete process.env[key];
  });
  const film = nativeSceneFilm({ voiceover: { src: "videos/native-probe/voiceover.wav", volume: 1 } });
  const outPath = path.join(dir, "renders", "long.mp4");
  const services: RenderServices = {
    checkDeliverable: () => {},
    checkBroll: () => {},
    retimeAudio: () => {},
    master: () => ({ status: "skipped", reason: "stub" }),
    probe: (format, file) => ({ format, path: file, width: 1920, height: 1080, fps: 30, durationSec: 2, sizeBytes: fs.statSync(file).size }),
  };
  const read = () => JSON.parse(fs.readFileSync(log, "utf8")) as { args: string[]; listing: string[]; ir: string };
  return { binary, film, outPath, services, read, dir };
}

test("a native job emits, stages and encodes the film through the RenderJob lifecycle", async (t) => {
  const s = setup(t);
  const logs: Array<[string, number | undefined]> = [];
  const states: RenderState[] = [];
  const job = createRenderJob(
    { film: s.film, format: "long", outPath: s.outPath, profile: "final" },
    createNativeRenderer({ binary: s.binary, threads: 2, onLog: (m, p) => logs.push([m, p]) }),
    { services: s.services, onState: (state) => states.push(state) },
  );
  await job.run();
  assert.deepEqual(states, ["preparing", "rendering", "mastering", "probed", "done"]);
  assert.equal(fs.readFileSync(s.outPath, "utf8"), "encoded");
  const seen = s.read();
  const at = (flag: string) => seen.args[seen.args.indexOf(flag) + 1];
  assert.equal(seen.args[0], "video");
  assert.deepEqual([at("--format"), at("--profile"), at("--threads")], ["long", "final", "2"]);
  assert.ok(!seen.args.includes("--frames"), "a whole-film request passes no range");
  for (const file of ["render.json", "fonts/Geist-latin.ttf", "fonts/JetBrainsMono-latin.ttf", "visuals/probe.svg", "visuals/probe-bg.svg", "audio/voiceover.wav"]) {
    assert.ok(seen.listing.includes(file), `${file} is staged for the binary: ${seen.listing.join(", ")}`);
  }
  const parsed = parseRenderIr(seen.ir);
  assert.ok(parsed.ok, "the staged IR is a valid aideos.render/1 document");
  assert.deepEqual(logs[logs.length - 1], ["long: 60/60 frames (native)", 0.99]);
  const sidecar = JSON.parse(fs.readFileSync(`${s.outPath}.render.json`, "utf8"));
  assert.equal(sidecar.profileSettingsApplied.crf, true, "x264 applied the CRF");
  assert.equal(sidecar.profileSettingsApplied.codec, true);
  assert.ok(!fs.existsSync(path.join(at("--package"))), "the staged package is removed with the attempt");
});

test("a hardware draft records that no CRF was applied and passes the frame range", async (t) => {
  const s = setup(t, { STUB_ENCODER: "h264_vaapi" });
  await createRenderJob(
    { film: s.film, format: "reel", outPath: s.outPath, profile: "draft", frames: [10, 69] },
    createNativeRenderer({ binary: s.binary }),
    { services: s.services },
  ).run();
  const seen = s.read();
  assert.equal(seen.args[seen.args.indexOf("--frames") + 1], "10-69");
  assert.equal(seen.args[seen.args.indexOf("--profile") + 1], "draft");
  const sidecar = JSON.parse(fs.readFileSync(`${s.outPath}.render.json`, "utf8"));
  assert.equal(sidecar.profileSettingsApplied.crf, false);
});

test("a failing native render fails the job with the binary's message and leaves no output", async (t) => {
  const s = setup(t, { STUB_FAIL: "svg asset \"svg-probe\": unsupported element <filter>" });
  const job = createRenderJob({ film: s.film, format: "long", outPath: s.outPath, profile: "final" }, createNativeRenderer({ binary: s.binary }), { services: s.services });
  await assert.rejects(job.run(), /unsupported element <filter>/);
  assert.equal(job.state, "failed");
  assert.ok(!fs.existsSync(s.outPath));
});

test("an unbuilt binary and a full disk are refused with their cause", async (t) => {
  const s = setup(t);
  const missing = createRenderJob(
    { film: s.film, format: "long", outPath: s.outPath, profile: "final" },
    createNativeRenderer({ binary: path.join(s.dir, "not-built") }),
    { services: s.services },
  );
  await assert.rejects(missing.run(), /cargo build --locked --release --manifest-path native\/Cargo.toml -p aideos-render/);
  const full = createRenderJob(
    { film: s.film, format: "long", outPath: s.outPath, profile: "final" },
    createNativeRenderer({ binary: s.binary }, { statfs: () => ({ bavail: 1024, bsize: 4096 }) }),
    { services: s.services },
  );
  await assert.rejects(full.run(), /RENDER_DISK_LOW/);
  assert.ok(!fs.existsSync(s.outPath));
});
