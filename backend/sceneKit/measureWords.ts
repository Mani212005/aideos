/**
 * File Description: Measures the width of display words in Geist, with the font's own kerning, by
 * asking headless Chrome, and merges them into the shared wordWidths.json table. Per-glyph advances
 * are close but drift by a few pixels per word once kerning pairs ("kn", "ow", "Th") apply, and words
 * are laid out one element at a time, so the error would show as uneven gaps. The table is a cache
 * keyed by exact word and weight (em per word, weights 500 and 800): words already in it are kept,
 * so each film only measures what it adds.
 * Usage from a film: await measureWords(displayWords(narrationLines)); then re-run its build.
 * Inputs and outputs: word strings -> measured pixel widths via headless Chrome merged into wordWidths.json.
 * Used by: backend/sceneKit/typeMetrics.ts.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { findChromeBinary } from "../scene/renderStill";

/** Output file, read by typeMetrics at layout time. */
export const WORD_WIDTHS_PATH = path.resolve(__dirname, "wordWidths.json");

/** Every distinct display word of some narration lines, in the case it may be set in (as written and upper-cased). */
export function displayWords(lines: string[], extra: string[] = []): string[] {
  const set = new Set<string>(extra);
  for (const line of lines) {
    for (const raw of line.split(/\s+/)) {
      const bare = raw.replace(/\{\d+\}$/, "").replace(/[.,:;?!*]/g, "");
      if (!bare) continue;
      set.add(bare);
      set.add(bare.toUpperCase());
    }
  }
  return [...set].sort();
}

/** Reads the current table, or an empty one when the file is missing. */
function readTable(file: string): Record<"500" | "800", Record<string, number>> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { "500": parsed["500"] ?? {}, "800": parsed["800"] ?? {} };
  } catch {
    return { "500": {}, "800": {} };
  }
}

/** The words a table does not have yet at both weights. */
export function unmeasuredWords(words: string[], table = readTable(WORD_WIDTHS_PATH)): string[] {
  return words.filter((w) => table["500"][w] === undefined || table["800"][w] === undefined);
}

/** Measures the words the table lacks in headless Chrome and merges them in; returns how many were added. */
export function measureWords(words: string[], file: string = WORD_WIDTHS_PATH): number {
  const table = readTable(file);
  const missing = unmeasuredWords(words, table);
  if (missing.length === 0) return 0;
  const chrome = findChromeBinary();
  if (!chrome) throw new Error("Chrome is required to measure words.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-measure-"));
  const page = path.join(dir, "m.html");
  fs.writeFileSync(
    page,
    `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@500;800&display=block" rel="stylesheet"></head><body><pre id="out">pending</pre><canvas id="c"></canvas><script>
const words = ${JSON.stringify(missing)};
(async () => {
  await document.fonts.load("800 100px Geist"); await document.fonts.load("500 100px Geist");
  const ctx = document.getElementById("c").getContext("2d");
  const out = { "500": {}, "800": {} };
  for (const w of ["500", "800"]) { ctx.font = w + " 1000px Geist"; for (const word of words) out[w][word] = Math.round(ctx.measureText(word).width) / 1000; }
  document.getElementById("out").textContent = "RESULT" + JSON.stringify(out) + "END";
})();
</script></body></html>`,
  );
  const run = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--virtual-time-budget=15000", "--dump-dom", `file://${page}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  fs.rmSync(dir, { recursive: true, force: true });
  const match = (run.stdout || "").match(/RESULT(\{.*?\})END/s);
  if (!match) {
    const stderrMsg = run.stderr ? run.stderr.slice(0, 400) : "";
    const errorMsg = run.error ? ` Spawn error: ${run.error.message}` : "";
    throw new Error(`Chrome returned no measurements: ${stderrMsg}${errorMsg}`);
  }
  const measured = JSON.parse(match[1]) as Record<"500" | "800", Record<string, number>>;
  const merged = { "500": { ...table["500"], ...measured["500"] }, "800": { ...table["800"], ...measured["800"] } };
  for (const w of ["500", "800"] as const) merged[w] = Object.fromEntries(Object.entries(merged[w]).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 1)}\n`);
  console.log(`[scene-kit] measured ${missing.length} new words x 2 weights -> ${file}`);
  return missing.length;
}
