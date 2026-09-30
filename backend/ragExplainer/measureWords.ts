/**
 * File Description: Measures the width of every word the RAG explainer sets in Geist, with the
 * font's own kerning, by asking headless Chrome. Per-glyph advances are close but drift by a few
 * pixels per word once kerning pairs ("kn", "ow", "Th") apply, and words are laid out one element at a
 * time, so the error would show as uneven gaps. Output: wordWidths.json (em per word, weights 500 and 800).
 * Re-run after changing any narrated or displayed word: npx tsx backend/ragExplainer/measureWords.ts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { findChromeBinary } from "../scene/renderStill";
import { BEATS } from "./beats";

/** Output file, read by typeMetrics at layout time. */
export const WORD_WIDTHS_PATH = path.resolve(__dirname, "wordWidths.json");

// Every distinct display word, in the case it may be set in.
function displayWords(): string[] {
  const set = new Set<string>();
  for (const beat of BEATS) {
    for (const raw of beat.narration.split(/\s+/)) {
      const bare = raw.replace(/[.,:;*]/g, "");
      if (!bare) continue;
      set.add(bare);
      set.add(bare.toUpperCase());
    }
  }
  return [...set].sort();
}

// Measures every word in headless Chrome and writes the table.
export function measureWords(): void {
  const chrome = findChromeBinary();
  if (!chrome) throw new Error("Chrome is required to measure words.");
  const words = displayWords();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rag-measure-"));
  const page = path.join(dir, "m.html");
  fs.writeFileSync(
    page,
    `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@500;800&display=block" rel="stylesheet"></head><body><pre id="out">pending</pre><canvas id="c"></canvas><script>
const words = ${JSON.stringify(words)};
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
  const match = run.stdout.match(/RESULT(\{.*?\})END/s);
  if (!match) throw new Error(`Chrome returned no measurements: ${run.stderr.slice(0, 400)}`);
  fs.writeFileSync(WORD_WIDTHS_PATH, `${JSON.stringify(JSON.parse(match[1]), null, 1)}\n`);
  console.log(`[rag-explainer] measured ${words.length} words x 2 weights -> ${WORD_WIDTHS_PATH}`);
}

if (typeof require !== "undefined" && require.main === module) measureWords();
