/**
 * File Description: Accuracy report for shot-level visual choice (`npm run eval:visuals`).
 * Runs the labelled beats in backend/eval/shot_visual_cases.json through the local heuristic and,
 * with `--jev`, through one batched Jev request, then reports each path's accuracy and what the
 * design stage would actually ship after confidence gating and narration grounding. Use it to
 * compare thresholds, criteria wording or models with numbers instead of impressions.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getJevApiKey,
  heuristicShotVisualSelection,
  prefetchShotVisualAnswers,
  resolveShotVisual,
  type ShotVisual,
  type ShotVisualState,
} from "../jev";
import { narrationSupportsVisual } from "../shotVisualCues";

/** One labelled beat: its narration, on-screen copy and the visual a designer would pick. */
interface EvalCase {
  narration: string;
  onscreen: string[];
  want: ShotVisual;
}

// Applies the design stage's grounding rule: a device the narration cannot back ships as Text.
function grounded(visual: ShotVisual, narration: string): ShotVisual {
  return narrationSupportsVisual(visual, narration) ? visual : "Text";
}

// Formats a hit count as a percentage of the total.
function pct(hits: number, total: number): string {
  return `${Math.round((100 * hits) / Math.max(1, total))}%`;
}

// Runs the evaluation and prints a per-case table plus summary accuracies.
async function main(): Promise<void> {
  const useJev = process.argv.includes("--jev");
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "shot_visual_cases.json"), "utf8")) as EvalCase[];
  const states: ShotVisualState[] = cases.map((c) => ({ narration: c.narration, onscreen: c.onscreen, durationSec: 6 }));

  let jevMs = 0;
  let prefetched: Awaited<ReturnType<typeof prefetchShotVisualAnswers>> = null;
  if (useJev) {
    if (!getJevApiKey()) throw new Error("--jev needs TYPESAFE_API_KEY (or JEV_API_KEY / OPENROUTER_API_KEY)");
    const started = Date.now();
    prefetched = await prefetchShotVisualAnswers(states);
    jevMs = Date.now() - started;
  }

  let heuristicHits = 0;
  let jevHits = 0;
  let shippedHits = 0;
  let jevFallbacks = 0;
  console.log(`${"narration".padEnd(58)} ${"want".padEnd(12)} ${"heuristic".padEnd(12)} ${useJev ? `${"jev".padEnd(18)} shipped` : "shipped"}`);
  cases.forEach((c, i) => {
    const heuristic = heuristicShotVisualSelection(states[i]);
    heuristicHits += Number(heuristic === c.want);
    let jevCell = "";
    let shipped = grounded(heuristic, c.narration);
    if (prefetched) {
      const p = prefetched[i];
      if ("answer" in p) {
        jevHits += Number(p.answer.choice === c.want);
        jevCell = `${p.answer.choice} ${p.answer.confidence.toFixed(2)}`;
      } else {
        jevFallbacks += 1;
        jevCell = "failed";
      }
      shipped = grounded(resolveShotVisual(p, states[i]).visual, c.narration);
    }
    shippedHits += Number(shipped === c.want);
    const mark = (v: string) => (v.startsWith(c.want) ? `${v} ✓` : v);
    console.log(
      `${c.narration.slice(0, 57).padEnd(58)} ${c.want.padEnd(12)} ${mark(heuristic).padEnd(12)} ${useJev ? `${mark(jevCell).padEnd(18)} ` : ""}${mark(shipped)}`,
    );
  });

  const n = cases.length;
  console.log(`\nheuristic alone:        ${pct(heuristicHits, n)} (${heuristicHits}/${n})`);
  if (useJev) {
    console.log(`Jev raw choice:         ${pct(jevHits, n)} (${jevHits}/${n}), ${jevFallbacks} failed`);
    console.log(`shipped (Jev + gating): ${pct(shippedHits, n)} (${shippedHits}/${n})`);
    console.log(`one batched request:    ${jevMs}ms for ${n} beats`);
  } else {
    console.log(`shipped (heuristic):    ${pct(shippedHits, n)} (${shippedHits}/${n})`);
    console.log("add --jev to include one live batched Jev request");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
