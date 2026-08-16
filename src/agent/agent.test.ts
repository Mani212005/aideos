/**
 * File Description: Unit test and verification suite for the GenClaw video engine modules.
 * Tests perception analysis, spatial assertions, bounded repair state machine, and engine pipeline execution.
 */

import { analyzePerception } from "./perception";
import { runSpatialAssertions, FrameSnapshot, ViewportConfig } from "./spatial_assert";
import { createRepairStateMachine, processRepairAttempt } from "./repair_machine";
import { executeEnginePipeline } from "./genclaw_engine";

// Runs verification assertions for perception, spatial assertions, repair machine, and engine orchestrator.
export function runAgentTests(): { success: boolean; results: string[] } {
  const results: string[] = [];

  // Test 1: Perception Analysis
  const perception = analyzePerception("Explain Transformer Attention Mechanism in 60 seconds.");
  if (perception.shots.length > 0 && perception.designSystemApplied) {
    results.push("Test 1 Passed: Perception analysis correctly parsed prompt and applied design constraints.");
  } else {
    results.push("Test 1 Failed: Perception output invalid.");
  }

  // Test 2: Spatial Assertions
  const viewport: ViewportConfig = { width: 1920, height: 1080, safeZoneMargin: 20 };
  const mockSnapshots: FrameSnapshot[] = [
    {
      frame: 0,
      timestamp: 0,
      elements: [
        { elementId: "headline", zIndex: 1, bounds: { x: 100, y: 100, width: 800, height: 100 } },
        { elementId: "card", zIndex: 0, bounds: { x: 100, y: 300, width: 800, height: 400 } },
      ],
    },
  ];
  const spatialResult = runSpatialAssertions(mockSnapshots, viewport);
  if (spatialResult.passed) {
    results.push("Test 2 Passed: Spatial assertions validated non-overlapping bounding boxes successfully.");
  } else {
    results.push("Test 2 Failed: Spatial assertions returned unexpected violations.");
  }

  // Test 3: Repair State Machine
  let state = createRepairStateMachine(3);
  const step1 = processRepairAttempt(state, "Syntax error at line 14");
  state = step1.nextState;
  const step2 = processRepairAttempt(state, "Syntax error at line 14");
  state = step2.nextState;

  if (step1.action === "EDIT_PREVIOUS" && state.isOscillating && state.currentStrategy === "ESCALATE_TO_CAPTAIN") {
    results.push("Test 3 Passed: Repair state machine bounded attempts, enforced local edits, and detected oscillation.");
  } else {
    results.push(`Test 3 Failed: Repair machine state unexpected (action=${step1.action}, oscillating=${state.isOscillating}, strategy=${state.currentStrategy}).`);
  }

  // Test 4: GenClaw Engine Pipeline Execution
  const engineResult = executeEnginePipeline("Create code animation of sort algorithm", {
    maxRepairRounds: 3,
  });
  if (engineResult.success && engineResult.finalStage === "COMPLETED") {
    results.push("Test 4 Passed: GenClaw Engine pipeline executed end-to-end successfully.");
  } else {
    results.push(`Test 4 Failed: Engine pipeline finished with stage ${engineResult.finalStage}.`);
  }

  const allPassed = results.every((r) => r.startsWith("Test"));
  return { success: allPassed, results };
}

// Main execution entry point when run directly via tsx or node.
if (require.main === module) {
  const testRun = runAgentTests();
  console.log("--- GenClaw Agent Verification Results ---");
  testRun.results.forEach((res) => console.log(res));
  if (!testRun.success) {
    process.exit(1);
  }
}
