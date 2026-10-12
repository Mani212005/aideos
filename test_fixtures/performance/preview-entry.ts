/**
 * File Description: Browser entry exposing the cue-bound action for an isolated Iona filmstrip.
 * Inputs and outputs: fixture narration -> evaluator and action bundled by esbuild.
 * Used by: scripts/performance_filmstrip.ts; independent of the production Film render tree.
 */
import { bindReceive } from "../../backend/performance/bindReceive";
import { RECEIVE_CUE, RECEIVE_TIMING } from "../../backend/performance/fixture";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { IONA_RIG } from "../../src/dl/performance/iona";
export const action = bindReceive(RECEIVE_TIMING, RECEIVE_CUE);
export const evaluate = createPerformanceEvaluator(IONA_RIG, action);
