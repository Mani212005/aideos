/**
 * File Description: Builds the small isolated Iona comparison filmstrip using already installed tools.
 * Inputs and outputs: evaluator and approved source fixtures -> static HTTP-reviewable .frames directory.
 * Used by: npm run performance:filmstrip; no production film, server or model generation.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Builds the isolated static artifact and reports its direct local serving command.
async function main(): Promise<void> {
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, ".frames/iona-performance");
  const disk = await fs.statfs(root);
  if (disk.bavail * disk.bsize < 3_000_000_000)
    throw new Error(
      "needs-decision: less than 3 GB free; filmstrip not built.",
    );
  await fs.mkdir(output, { recursive: true });
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--reference-clip"))
    throw new Error(
      "Usage: npm run performance:filmstrip -- [--reference-clip path]",
    );
  const approvedFrames: Record<number, string> = {};
  if (args.length) {
    const clip = path.resolve(args[1]);
    const hash = createHash("sha256")
      .update(await fs.readFile(clip))
      .digest("hex")
      .slice(0, 12);
    for (const frame of [0, 21, 45, 57, 69, 80, 99, 111]) {
      const name = `approved-${hash}-${frame}.png`,
        file = path.join(output, name);
      approvedFrames[frame] = name;
      // Preserve any already captured frame of these exact clip bytes.
      const exists = await fs.access(file, constants.F_OK).then(
        () => true,
        () => false,
      );
      if (!exists)
        execFileSync("ffmpeg", [
          "-v",
          "error",
          "-i",
          clip,
          "-vf",
          `select=eq(n\\,${frame})`,
          "-frames:v",
          "1",
          "-n",
          file,
        ]);
    }
  }
  for (const name of [
    "character.mjs",
    "performance.mjs",
    "dots.mjs",
    "three.core.min.js",
    "three.module.min.js",
    "three-LICENSE.txt",
    "NOTICE.md",
    "filmstrip.mjs",
  ]) {
    await fs.copyFile(
      path.join(root, "test_fixtures/performance/iona", name),
      path.join(output, name),
    );
  }
  await build({
    entryPoints: [
      path.join(root, "test_fixtures/performance/preview-entry.ts"),
    ],
    outfile: path.join(output, "evaluate.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
  });
  await fs.writeFile(
    path.join(output, "index.html"),
    `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Iona receive filmstrip</title><link rel="icon" href="data:,">
<style>body{font:16px system-ui;margin:24px;background:#e9e2d2;color:#101826}main{max-width:1280px}section{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}h2{grid-column:1/-1;margin:0;font-size:18px}figure{margin:0;min-width:0}img{width:100%;display:block}figcaption{margin:4px 0}pre{white-space:pre-wrap}</style>
<h1>Iona receive: fixed-camera comparison</h1><p>Recovered approved source at left, cue-bound constrained action at right. Numerical results do not score art quality.</p>
<script>globalThis.approvedFrames=${JSON.stringify(approvedFrames)};</script><main></main><details><summary>Frame evidence</summary><pre id="evidence">Loading</pre></details><script type="module" src="./filmstrip.mjs"></script></html>`,
  );
  console.log(
    `Filmstrip: ${output}/index.html\nServe with: python3 -m http.server 8781 --directory .frames/iona-performance`,
  );
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
