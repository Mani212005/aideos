/**
 * File Description: Binds a receive action's decisive contact to the existing narration cue authority and fits it to its character.
 * Inputs and outputs: measured narration and phrase cue (or contact/start frames) plus a character rig -> retargeted receive with absolute contact frame and warnings.
 * Used by: design compile, performance test/check harness and character tests.
 */
import { createCues, type NarrationTiming } from "../sceneKit/timing";
import { createReceiveAction } from "../../src/dl/performance/receive";
import { shiftReceive } from "../../src/dl/performance/span";
import { retargetReceive, type ReachPolicy, type RetargetWarning } from "../../src/dl/performance/retarget";
import type { CharacterRig, ReceiveAction, Vec3 } from "../../src/dl/performance/types";
import { receiveSourceRig } from "../characters/library";

/** Which character performs the receive, and what to do when it cannot reach within its limits. */
export interface ReceiveFit {
  rig?: CharacterRig;
  policy?: ReachPolicy;
}

// Resolves contact through sceneKit word cues and retimes the sparse receive choreography.
export function bindReceive(
  timing: NarrationTiming,
  cue: { shotId: string; phrase: string; edge?: "start" | "end" },
  fps = 30,
  targetOffset: Vec3 = [0, 0, 0],
  startFrame = 0,
): ReceiveAction {
  const cues = createCues(timing, fps);
  return bindReceiveSpan(cues.wordOnce(cue.shotId, cue.phrase, cue.edge), startFrame, cues.durationFrames, fps, targetOffset);
}

// Binds preparation, exact contact and unchanged recovery to an absolute narration span on the approved Iona rig.
export function bindReceiveSpan(contactFrame: number, startFrame: number, durationFrames: number, fps = 30, targetOffset: Vec3 = [0, 0, 0]): ReceiveAction {
  return fitReceiveSpan(contactFrame, startFrame, durationFrames, fps, targetOffset).action;
}

// Binds the span, then retargets the receive onto the given character (Iona by default) under its limit policy.
export function fitReceiveSpan(contactFrame: number, startFrame: number, durationFrames: number, fps = 30, targetOffset: Vec3 = [0, 0, 0], fit: ReceiveFit = {}): { action: ReceiveAction; warnings: RetargetWarning[]; from: string } {
  if (contactFrame - startFrame < fps) throw new Error("Receive preparation needs at least one second before the decisive cue.");
  const source = receiveSourceRig();
  const reference = createReceiveAction(contactFrame - startFrame, fps);
  const { action, warnings } = retargetReceive(reference, source, fit.rig ?? source, { targetOffset, policy: fit.policy });
  const shifted = shiftReceive(action, startFrame);
  if (shifted.toFrame > durationFrames)
    throw new Error(
      "Narration ends before the receive action settles and holds.",
    );
  return { action: shifted, warnings, from: source.id };
}
