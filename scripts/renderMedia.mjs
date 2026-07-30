import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, copyFile } from "node:fs/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");

await mkdir(OUT, { recursive: true });

console.log("Bundling Remotion project...");
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.ts") });

// Copy static assets into the Webpack bundle output directory so Remotion HTTP server can serve /voiceover.wav
const bundleDir = serveUrl.replace("file://", "");
console.log(`Copying public assets to Webpack bundle: ${bundleDir}`);
await copyFile(path.join(ROOT, "public/voiceover.wav"), path.join(bundleDir, "voiceover.wav")).catch(() => {});
await copyFile(path.join(ROOT, "public/captions.vtt"), path.join(bundleDir, "captions.vtt")).catch(() => {});

console.log("Rendering Long (1920x1080)...");
const compLong = await selectComposition({ serveUrl, id: "Long" });
await renderMedia({
  composition: compLong,
  serveUrl,
  outputLocation: path.join(OUT, "long.mp4"),
  codec: "h264",
});
console.log("✓ Long rendered to out/long.mp4");

console.log("Rendering Reel (1080x1920)...");
const compReel = await selectComposition({ serveUrl, id: "Reel" });
await renderMedia({
  composition: compReel,
  serveUrl,
  outputLocation: path.join(OUT, "reel.mp4"),
  codec: "h264",
});
console.log("✓ Reel rendered to out/reel.mp4");
