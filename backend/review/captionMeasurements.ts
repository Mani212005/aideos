/**
 * File Description: Measures caption words with the render's pinned font and layout utility for exact review phrase boundaries.
 * Inputs and outputs: words and font size -> measured widths, using one bounded Chrome batch when needed.
 * Used by: prepareCaptionReview for films with owner caption placement.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { z } from "zod";
import { getInfo } from "@remotion/google-fonts/Geist";
import { findChromeBinary } from "../scene/renderStill";
const requirePackage = createRequire(
  path.resolve(__dirname, "../../package.json"),
);
const widthsSchema = z.record(z.string(), z.number().finite().nonnegative());
const cache = new Map<number, Record<string, number>>();

type MeasurementPlan =
  | { kind: "cached"; widths: Record<string, number> }
  | {
      kind: "pending";
      fontSize: number;
      known: Record<string, number>;
      missing: string[];
      chrome: string;
      directory: string;
      file: string;
    };

// Creates the common page for the pinned Geist measurement utility.
function prepareMeasurement(words: string[], fontSize: number): MeasurementPlan {
  const known = cache.get(fontSize) ?? {};
  const missing = [...new Set(words)].filter(
    (word) => !Object.prototype.hasOwnProperty.call(known, word),
  );
  if (!missing.length) return { kind: "cached", widths: known };
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
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "aideos-caption-measure-"),
  );
  const file = path.join(directory, "measure.html");
  const payload = JSON.stringify(missing).replace(/</g, "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><pre id="out">pending</pre><script>const exports={};${utility}\n(async()=>{const words=${payload}; await document.fonts.load('700 ${fontSize}px Geist',words.join(' ')); await document.fonts.ready; const result=Object.create(null); for(const text of words)result[text]=exports.measureText({text,fontFamily:'Geist',fontSize:${fontSize},fontWeight:700,validateFontIsLoaded:true}).width;document.getElementById('out').textContent='RESULT'+btoa(unescape(encodeURIComponent(JSON.stringify(result))))+'END';})().catch(e=>document.getElementById('out').textContent=String(e));</script>`;
  try {
    fs.writeFileSync(file, html);
    return { kind: "pending", fontSize, known, missing, chrome, directory, file };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

// Parses, validates and caches a completed measurement page for either runner.
function collectMeasurements(
  output: string,
  plan: Extract<MeasurementPlan, { kind: "pending" }>,
  diagnostic?: string,
): Record<string, number> {
  const result = output.match(/RESULT([A-Za-z0-9+/=]+)END/);
  if (!result)
    throw new Error(
      `Could not measure caption words: ${diagnostic ?? "font load failed"}`,
    );
  const measured = widthsSchema.parse(
    JSON.parse(Buffer.from(result[1], "base64").toString("utf8")),
  );
  for (const word of plan.missing)
    if (!Object.prototype.hasOwnProperty.call(measured, word))
      throw new Error(`Missing caption word measurement: ${word}`);
  const merged = { ...plan.known, ...measured };
  cache.set(plan.fontSize, merged);
  return merged;
}

// Executes Chrome synchronously for blocking review and design-check callers.
function runChromeSync(chrome: string, file: string) {
  return spawnSync(
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
}

// Executes Chrome asynchronously for editor requests that must not block.
function runChromeAsync(chrome: string, file: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      ...(process.env.CI === "true"
        ? ["--no-sandbox", "--disable-dev-shm-usage"]
        : []),
      "--virtual-time-budget=15000",
      "--dump-dom",
      `file://${file}`,
    ]);
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 25000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0)
        reject(new Error(stderr.slice(-300) || `Chrome exited with ${code}`));
      else resolve(stdout);
    });
  });
}

// Measures words with the render's font weight and layout utility for exact phrase planning.
export function measureCaptionWords(
  words: string[],
  fontSize: number,
): Record<string, number> {
  const plan = prepareMeasurement(words, fontSize);
  if (plan.kind === "cached") return plan.widths;
  try {
    const run = runChromeSync(plan.chrome, plan.file);
    return collectMeasurements(
      run.stdout ?? "",
      plan,
      run.error?.message ?? run.stderr?.slice(-300),
    );
  } finally {
    fs.rmSync(plan.directory, { recursive: true, force: true });
  }
}

// Measures uncached words without blocking the editor's request loop.
export async function measureCaptionWordsAsync(
  words: string[],
  fontSize: number,
): Promise<Record<string, number>> {
  const plan = prepareMeasurement(words, fontSize);
  if (plan.kind === "cached") return plan.widths;
  try {
    const output = await runChromeAsync(plan.chrome, plan.file);
    return collectMeasurements(output, plan);
  } finally {
    fs.rmSync(plan.directory, { recursive: true, force: true });
  }
}
