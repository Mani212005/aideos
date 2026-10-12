/**
 * File Description: Deliberately damaged receive evaluators exercising independent numerical critique.
 * Inputs and outputs: valid evaluator and named defect -> evaluator with one introduced failure.
 * Used by: backend/performance/performance.test.ts.
 */
import { add } from "../../src/dl/performance/math";
import type { PerformanceEvaluator } from "../../src/dl/performance/types";

export type Defect =
  | "stretch"
  | "slide"
  | "miss-grip"
  | "late-contact"
  | "pose-snap"
  | "velocity-snap"
  | "history"
  | "frozen"
  | "attachment"
  | "nonfinite";

// Introduces a behavioral defect at the evaluator boundary, leaving the action's obligations intact.
export function degrade(
  evaluate: PerformanceEvaluator,
  defect: Defect,
): PerformanceEvaluator {
  let calls = 0;
  const frozen = evaluate(0);
  // Returns a fresh corrupted state so defects never alter the valid evaluator or earlier samples.
  return (frame) => {
    const state = structuredClone(evaluate(frame));
    if (defect === "stretch")
      state.joints.elbowR.position = add(
        state.joints.elbowR.position,
        [0.2, 0, 0],
      );
    if (defect === "slide")
      state.joints.ankleL.position = add(state.joints.ankleL.position, [
        frame * 0.002,
        0,
        0,
      ]);
    if (defect === "miss-grip")
      state.joints.wristR.position = add(
        state.joints.wristR.position,
        [0, 0.1, 0],
      );
    if (defect === "late-contact")
      state.contact.mode = frame >= 72 ? "attached" : "airborne";
    if (defect === "pose-snap" && frame >= 45)
      state.joints.head.position = add(state.joints.head.position, [0.2, 0, 0]);
    if (defect === "velocity-snap")
      state.joints.head.position = add(state.joints.head.position, [
        Math.max(0, frame - 45) * 0.03,
        0,
        0,
      ]);
    if (defect === "history")
      state.joints.head.position = add(state.joints.head.position, [
        ++calls * 0.0001,
        0,
        0,
      ]);
    if (defect === "frozen") {
      state.root = structuredClone(frozen.root);
      state.joints = structuredClone(frozen.joints);
    }
    if (defect === "attachment" && frame >= 69)
      state.prop.position = add(state.prop.position, [0, 0.2, 0]);
    if (defect === "nonfinite") state.joints.wristR.position = [NaN, 0, 0];
    return state;
  };
}
