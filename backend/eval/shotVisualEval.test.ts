/**
 * File Description: Offline guard for the shot-visual evaluation set.
 * Checks the labelled cases are well formed and that the local heuristic, which is what ships
 * whenever Jev is unavailable, does not regress below its measured accuracy on them.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHOT_VISUALS, heuristicShotVisualSelection, type ShotVisual } from "../jev";

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "shot_visual_cases.json"), "utf8")) as {
  narration: string;
  onscreen: string[];
  want: ShotVisual;
}[];

test("ShotVisualEval: every case is labelled with a real shot visual and every visual is covered", () => {
  for (const c of cases) assert.ok((SHOT_VISUALS as readonly string[]).includes(c.want), c.narration);
  for (const v of SHOT_VISUALS) assert.ok(cases.some((c) => c.want === v), `no case for ${v}`);
});

test("ShotVisualEval: the offline heuristic keeps at least its measured 28/32 on the set", () => {
  const hits = cases.filter((c) => heuristicShotVisualSelection({ narration: c.narration, onscreen: c.onscreen }) === c.want).length;
  assert.ok(hits >= 28, `heuristic regressed to ${hits}/${cases.length}`);
});
