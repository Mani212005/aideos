/**
 * File Description: Binds a receive action's decisive contact to the existing narration cue authority.
 * Inputs and outputs: measured narration and phrase cue -> receive action with absolute contact frame.
 * Used by: performance test/check harness; future authoring adapters can reuse this boundary.
 */
import { createCues, type NarrationTiming } from "../sceneKit/timing";
import { createReceiveAction } from "../../src/dl/performance/receive";
import type { ReceiveAction, Vec3 } from "../../src/dl/performance/types";

// Resolves contact through sceneKit word cues and retimes the sparse receive choreography.
export function bindReceive(
  timing: NarrationTiming,
  cue: { shotId: string; phrase: string; edge?: "start" | "end" },
  fps = 30,
  targetOffset: Vec3 = [0, 0, 0],
): ReceiveAction {
  const cues = createCues(timing, fps);
  const action = createReceiveAction(
    cues.word(cue.shotId, cue.phrase, cue.edge),
    fps,
    targetOffset,
  );
  if (action.toFrame > cues.durationFrames)
    throw new Error(
      "Narration ends before the receive action settles and holds.",
    );
  return action;
}
