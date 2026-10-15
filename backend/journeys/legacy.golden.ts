/**
 * File Description: Journey J9 at pixel level: golden frames of the films that existed before the 3D character work (a plain scene film, a template node-graph film, a scene film with a device inset, and a kinetic type film), rendered at quarter size and compared with committed PNGs. Goldens are made only on the CI platform (Linux, software GL) by the update-goldens workflow; a golden made on a Mac is not comparable and is never committed. Until the first CI-made set exists (no MANIFEST.json) the outcome is NOT COVERED: the test exits 0 so the first PR can merge, but it records that outcome (scripts/ci.ts prints it as NOT COVERED, never as a pass) and uploads the frames it rendered as candidates. Once a manifest exists, any missing or changed golden fails.
 * Inputs and outputs: committed example and fixture films, backend/journeys/goldens/*.png and MANIFEST.json -> pass, or a failure naming the film, composition and frame, with golden, actual and difference images saved under .ci-artifacts/.
 * Used by: npm run test:legacy (the CI legacy job), npm run goldens:update (the update-goldens workflow).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_DIR, assertDiskHeadroom, decodeFrame, frameDiff, holdActiveFilm } from "./harness";
import { compareGoldens } from "./goldenCompare";
import { writeGoldenOutcome } from "./goldenResult";
import { openFilm, type CompositionId } from "./remotionFrames";
import { glFlag } from "../pipeline/render";

const GOLDEN_DIR = path.join(__dirname, "goldens");
const MANIFEST = path.join(GOLDEN_DIR, "MANIFEST.json");
const UPDATE = process.env.AIDEOS_GOLDEN_UPDATE === "1";
/** Quarter size keeps each PNG in the tens of kilobytes while still showing layout, type and colour. */
const SCALE = 0.25;

/** One film and the frames (as fractions of its length) kept as goldens per composition. */
interface GoldenSpec {
  slug: string;
  why: string;
  frames: Record<CompositionId, number[]>;
}

export const SPECS: GoldenSpec[] = [
  { slug: "hello-scene", why: "the committed plain scene film", frames: { Long: [0.1, 0.5, 0.9], Reel: [0.5] } },
  { slug: "sample-explainer", why: "a template node-graph film with no scene", frames: { Long: [0.1, 0.5, 0.9], Reel: [0.5] } },
  { slug: "inset-stage", why: "a scene film with a device inset", frames: { Long: [0.3, 0.7], Reel: [0.5] } },
  { slug: "still-talking", why: "a long kinetic type scene film", frames: { Long: [0.2, 0.6], Reel: [0.4] } },
];

/** File name of one golden. */
const goldenName = (slug: string, composition: CompositionId, frame: number) => `${slug}/${composition.toLowerCase()}-${frame}.png`;

/** Writes a visual difference of two PNGs for the failure artifact. */
function writeDiff(a: string, b: string, out: string): void {
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", a, "-i", b, "-filter_complex", "blend=all_mode=difference,eq=brightness=0.3", "-frames:v", "1", out]);
  } catch {
    // The diff image is a courtesy; the failure message already says what differed.
  }
}

/** Renders every golden frame of every spec into `outDir` and returns the files written, keyed by golden name. */
async function renderAll(outDir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const spec of SPECS) {
    const film = await openFilm(spec.slug);
    try {
      for (const composition of ["Long", "Reel"] as const) {
        for (const fraction of spec.frames[composition]) {
          const frame = Math.min(film.durationInFrames - 1, Math.round(fraction * film.durationInFrames));
          const name = goldenName(spec.slug, composition, frame);
          await film.still(composition, frame, path.join(outDir, name), SCALE);
          out.set(name, path.join(outDir, name));
        }
      }
    } finally {
      await film.close();
    }
  }
  return out;
}

test("J9 legacy films render the same frames as the committed goldens", { timeout: 15 * 60 * 1000 }, async (t) => {
  if (process.platform !== "linux") {
    t.skip("golden frames are verified on the Linux CI platform only");
    return;
  }
  assertDiskHeadroom();
  const restore = holdActiveFilm();
  const work = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "aideos-golden-"));
  try {
    const rendered = await renderAll(path.join(work, "a"));
    if (UPDATE) {
      // A golden is only trustworthy if the platform reproduces it: render again and require identical pixels.
      const again = await renderAll(path.join(work, "b"));
      for (const [name, file] of rendered) {
        const diff = frameDiff(decodeFrame(file), decodeFrame(again.get(name)!), 0);
        assert.equal(diff.changedShare, 0, `${name} differs between two renders on this machine (${(diff.changedShare * 100).toFixed(4)}%), so it cannot be a golden`);
      }
      fs.rmSync(GOLDEN_DIR, { recursive: true, force: true });
      for (const [name, file] of rendered) {
        fs.mkdirSync(path.dirname(path.join(GOLDEN_DIR, name)), { recursive: true });
        fs.copyFileSync(file, path.join(GOLDEN_DIR, name));
      }
      const manifest = {
        platform: `${process.platform}-${process.arch}`,
        gl: glFlag().replace("--gl=", ""),
        scale: SCALE,
        frames: [...rendered].map(([name, file]) => ({ name, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") })),
      };
      fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }

    const outcome = compareGoldens({
      manifestPath: MANIFEST,
      goldenDir: GOLDEN_DIR,
      rendered,
      platform: `${process.platform}-${process.arch}`,
      onChanged: (name, golden, actual) => {
        const keep = path.join(ARTIFACT_DIR, "legacy", name.replace("/", "-").replace(".png", ""));
        fs.mkdirSync(keep, { recursive: true });
        fs.copyFileSync(golden, path.join(keep, "golden.png"));
        fs.copyFileSync(actual, path.join(keep, "actual.png"));
        writeDiff(golden, actual, path.join(keep, "diff.png"));
      },
    });
    writeGoldenOutcome(outcome);
    if (outcome.status === "not-covered") {
      // Keep what was rendered so the first set can be reviewed; the run itself still exits 0.
      const candidates = path.join(ARTIFACT_DIR, "candidate-goldens");
      fs.mkdirSync(candidates, { recursive: true });
      fs.cpSync(path.join(work, "a"), candidates, { recursive: true });
      return;
    }
    assert.deepEqual(outcome.status === "failed" ? outcome.failures : [], [], "legacy films no longer render as they did (changed frames are saved under .ci-artifacts/legacy/)");
  } finally {
    restore();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
