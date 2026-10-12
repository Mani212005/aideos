/**
 * File Description: Small illustrative narration spine binding the approved catch to a decisive word.
 * Inputs and outputs: fixed measured-style word timings -> shared receive timing fixture.
 * Used by: performance tests and local critique command; no synthesis or personal video access.
 */
import type { NarrationTiming } from "../sceneKit/timing";

export const RECEIVE_TIMING: NarrationTiming = {
  totalDurationSec: 5,
  segments: [
    {
      shotId: "catch",
      text: "Iona catches the glider.",
      startSec: 0,
      durationSec: 5,
      words: [
        { word: "Iona", startSec: 0.5, endSec: 0.8 },
        { word: "catches", startSec: 2.3, endSec: 2.5 },
        { word: "the", startSec: 2.6, endSec: 2.7 },
        { word: "glider.", startSec: 2.8, endSec: 3.1 },
      ],
    },
  ],
};
export const RECEIVE_CUE = { shotId: "catch", phrase: "catches" };
