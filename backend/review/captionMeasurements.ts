/**
 * File Description: Measures caption words with the render's pinned font and layout utility for exact review phrase boundaries.
 * Inputs and outputs: words and font size -> measured widths, using one bounded Chrome batch when needed.
 * Used by: prepareCaptionReview for films with owner caption placement.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { getInfo } from "@remotion/google-fonts/Geist";
import { findChromeBinary } from "../scene/renderStill";
const requirePackage = createRequire(
  path.resolve(__dirname, "../../package.json"),
);
const widthsSchema = z.record(z.string(), z.number().finite().nonnegative());
const cache = new Map<number, Record<string, number>>();
// Shares the exact browser measurement utility instead of approximating 700-weight glyphs with another weight.
export function measureCaptionWords(
  words: string[],
  fontSize: number,
): Record<string, number> {
  const known = cache.get(fontSize) ?? {};
  const missing = [...new Set(words)].filter(
    (word) => !Object.prototype.hasOwnProperty.call(known, word),
  );
  if (!missing.length) return known;
  const chrome = findChromeBinary();
  if (!chrome)
    throw new Error(
      "Chrome is required to measure owner-placed caption phrases for review.",
    );
  const info = getInfo();
  const css = Object.entries(info.fonts.normal["700"])
    .map(
      ([subset, url]) =>
        `@font-face{font-family:Geist;font-style:normal;font-weight:700;src:url(${JSON.stringify(url)});unicode-range:${info.unicodeRanges[subset as keyof typeof info.unicodeRanges]}}`,
    )
    .join("");
  const utility = fs.readFileSync(
    path.join(
      path.dirname(requirePackage.resolve("@remotion/layout-utils")),
      "layouts/measure-text.js",
    ),
    "utf8",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-caption-measure-"));
  try {
    const file = path.join(dir, "measure.html");
    const payload = JSON.stringify(missing).replace(/</g, "\\u003c");
    fs.writeFileSync(
      file,
      `<!doctype html><meta charset="utf-8"><style>${css}</style><pre id="out">pending</pre><script>const exports={};${utility}\n(async()=>{const words=${payload}; await document.fonts.load('700 ${fontSize}px Geist',words.join(' ')); await document.fonts.ready; const result=Object.create(null); for(const text of words)result[text]=exports.measureText({text,fontFamily:'Geist',fontSize:${fontSize},fontWeight:700,validateFontIsLoaded:true}).width;document.getElementById('out').textContent='RESULT'+btoa(unescape(encodeURIComponent(JSON.stringify(result))))+'END';})().catch(e=>document.getElementById('out').textContent=String(e));</script>`,
    );
    const run = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        ...(process.env.CI === "true"
          ? ["--no-sandbox", "--disable-dev-shm-usage"]
          : []),
        "--virtual-time-budget=15000",
        "--dump-dom",
        `file://${file}`,
      ],
      { encoding: "utf8", timeout: 25000, maxBuffer: 16 * 1024 * 1024 },
    );
    const result = run.stdout?.match(/RESULT([A-Za-z0-9+/=]+)END/);
    if (!result)
      throw new Error(
        `Could not measure caption words: ${run.error?.message ?? run.stderr?.slice(-300) ?? "font load failed"}`,
      );
    const measured = widthsSchema.parse(
      JSON.parse(Buffer.from(result[1], "base64").toString("utf8")),
    );
    for (const word of missing)
      if (!Object.prototype.hasOwnProperty.call(measured, word))
        throw new Error(`Missing caption word measurement: ${word}`);
    const merged = { ...known, ...measured };
    cache.set(fontSize, merged);
    return merged;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
