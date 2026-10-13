/**
 * File Description: Binds a receive action's decisive contact to the existing narration cue authority.
 * Inputs and outputs: measured narration and phrase cue -> receive action with absolute contact frame.
 * Used by: performance test/check harness; future authoring adapters can reuse this boundary.
 */
import { createCues, type NarrationTiming } from "../sceneKit/timing";
import { createReceiveAction } from "../../src/dl/performance/receive";
import { shiftReceive } from "../../src/dl/performance/span";
import type { ReceiveAction, Vec3 } from "../../src/dl/performance/types";

// Resolves contact through sceneKit word cues and retimes the sparse receive choreography.
export function bindReceive(
  timing: NarrationTiming,
  cue: { shotId: string; phrase: string; edge?: "start" | "end" },
  fps = 30,
  targetOffset: Vec3 = [0, 0, 0],
  startFrame = 0,
): ReceiveAction {
  const cues = createCues(timing, fps);
  return bindReceiveSpan(cues.word(cue.shotId, cue.phrase, cue.edge), startFrame, cues.durationFrames, fps, targetOffset);
}

// Binds preparation, exact contact and unchanged recovery to an absolute narration span.
export function bindReceiveSpan(contactFrame: number, startFrame: number, durationFrames: number, fps = 30, targetOffset: Vec3 = [0, 0, 0]): ReceiveAction {
  if (contactFrame - startFrame < fps) throw new Error("Receive preparation needs at least one second before the decisive cue.");
  const action = shiftReceive(createReceiveAction(
    contactFrame - startFrame,
    fps,
    targetOffset,
  ), startFrame);
  if (action.toFrame > durationFrames)
    throw new Error(
      "Narration ends before the receive action settles and holds.",
    );
  return action;
}
