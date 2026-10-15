/**
 * File Description: The golden-frame decision, separated from rendering so it can be tested with real files: no manifest means NOT COVERED (nothing was compared, and that is never reported as a pass); once a manifest exists, a platform mismatch, a frame set that differs from the manifest, a listed golden missing on disk or a frame that changed beyond tolerance is a failure.
 * Inputs and outputs: rendered frame files, the committed manifest and golden folder -> a GoldenOutcome, with failing frames reported through a callback so the caller can keep evidence.
 * Used by: backend/journeys/legacy.golden.ts, backend/journeys/goldenCompare.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { decodeFrame, frameDiff } from "./harness";
import type { GoldenOutcome } from "./goldenResult";

/** Anti-aliasing may differ by a pixel between Chrome builds; a changed layout moves far more than this. */
export const TOLERANCE = { meanAbs: 0.05, changedShare: 0.001 };

/** Everything the comparison needs, so a test can point it at a temp folder. */
export interface CompareInputs {
  manifestPath: string;
  goldenDir: string;
  /** Rendered frames by golden name (for example `hello-scene/long-150.png`). */
  rendered: Map<string, string>;
  /** `<platform>-<arch>` of this machine. */
  platform: string;
  /** Called for each frame that changed, so the caller can save golden, actual and difference images. */
  onChanged?: (name: string, golden: string, actual: string) => void;
}

/** Compares rendered frames with the committed goldens and says whether the films still render as they did. */
export function compareGoldens(inputs: CompareInputs): GoldenOutcome {
  if (!fs.existsSync(inputs.manifestPath)) {
    return { status: "not-covered", reason: `no CI-made goldens are committed (${path.basename(inputs.manifestPath)} is absent), so no legacy frame was compared` };
  }
  const manifest = JSON.parse(fs.readFileSync(inputs.manifestPath, "utf8")) as { platform: string; frames: Array<{ name: string; sha256: string }> };
  const failures: string[] = [];
  if (manifest.platform !== inputs.platform) {
    return { status: "failed", failures: [`goldens were made on ${manifest.platform} but this is ${inputs.platform}; regenerate them with the update-goldens workflow on this platform`] };
  }
  const listed = manifest.frames.map((f) => f.name).sort();
  const rendered = [...inputs.rendered.keys()].sort();
  if (JSON.stringify(listed) !== JSON.stringify(rendered)) {
    return { status: "failed", failures: [`the golden set no longer matches the frames this test renders (manifest ${listed.length}, rendered ${rendered.length}); run the update-goldens workflow`] };
  }
  for (const name of listed) {
    const golden = path.join(inputs.goldenDir, name);
    if (!fs.existsSync(golden)) {
      failures.push(`${name}: listed in the manifest but missing on disk`);
      continue;
    }
    const expectedHash = manifest.frames.find((frame) => frame.name === name)?.sha256;
    const actualHash = createHash("sha256").update(fs.readFileSync(golden)).digest("hex");
    if (actualHash !== expectedHash) {
      failures.push(`${name}: SHA-256 does not match manifest`);
      continue;
    }
    const actual = inputs.rendered.get(name)!;
    const diff = frameDiff(decodeFrame(golden), decodeFrame(actual), 8);
    if (diff.meanAbs > TOLERANCE.meanAbs || diff.changedShare > TOLERANCE.changedShare) {
      inputs.onChanged?.(name, golden, actual);
      failures.push(`${name}: ${(diff.changedShare * 100).toFixed(3)}% of pixels changed, mean difference ${diff.meanAbs.toFixed(3)}`);
    }
  }
  return failures.length ? { status: "failed", failures } : { status: "passed", frames: listed.length };
}
