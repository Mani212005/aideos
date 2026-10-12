/**
 * File Description: Local numerical check of the cue-bound Iona receive action.
 * Inputs and outputs: approved fixture timing -> JSON critique and nonzero exit on failure.
 * Used by: npm run performance:check.
 */
import { bindReceive } from "../backend/performance/bindReceive";
import { RECEIVE_CUE, RECEIVE_TIMING } from "../backend/performance/fixture";
import { createCues } from "../backend/sceneKit/timing";
import { critiquePerformance } from "../src/dl/performance/critique";
import { createPerformanceEvaluator } from "../src/dl/performance/evaluate";
import { IONA_RIG } from "../src/dl/performance/iona";

const action = bindReceive(RECEIVE_TIMING, RECEIVE_CUE);
const report = critiquePerformance(
  IONA_RIG,
  action,
  createPerformanceEvaluator(IONA_RIG, action),
  createCues(RECEIVE_TIMING).word(RECEIVE_CUE.shotId, RECEIVE_CUE.phrase),
);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
