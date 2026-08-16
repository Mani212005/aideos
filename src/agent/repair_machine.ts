/**
 * File Description: Bounded repair state machine tracking attempt counts (max 3 rounds).
 * Enforces local edit_previous strategy for rounds 1-2, escalates to regenerate_from_source for round 3,
 * and detects oscillation patterns across repair attempts.
 */

export type RepairStrategy =
  | "EDIT_PREVIOUS"
  | "REGENERATE_FROM_SOURCE"
  | "ESCALATE_TO_CAPTAIN";

export interface RepairHistoryItem {
  round: number;
  errorSummary: string;
  strategy: RepairStrategy;
  checksum: string;
}

export interface RepairState {
  attemptCount: number;
  maxAttempts: number;
  currentStrategy: RepairStrategy;
  isOscillating: boolean;
  history: RepairHistoryItem[];
  isTerminated: boolean;
}

export interface RepairActionResult {
  nextState: RepairState;
  action: RepairStrategy;
  promptDirective: string;
  shouldHalt: boolean;
}

// Initializes a new repair state machine instance with initial attempt counter and strategy configuration.
export function createRepairStateMachine(maxAttempts: number = 3): RepairState {
  return {
    attemptCount: 0,
    maxAttempts,
    currentStrategy: "EDIT_PREVIOUS",
    isOscillating: false,
    history: [],
    isTerminated: false,
  };
}

// Computes a hash checksum of an error summary to track recurring error signatures.
export function computeErrorChecksum(errorSummary: string): string {
  let hash = 0;
  const str = errorSummary.trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `err_${Math.abs(hash).toString(16)}`;
}

// Analyzes repair history to detect whether the repair machine is oscillating between repetitive error patterns.
export function detectOscillation(history: RepairHistoryItem[]): boolean {
  if (history.length < 2) {
    return false;
  }

  const checksums = history.map((item) => item.checksum);
  const lastChecksum = checksums[checksums.length - 1];

  for (let i = 0; i < checksums.length - 1; i++) {
    if (checksums[i] === lastChecksum) {
      return true;
    }
  }

  return false;
}

// Processes a failure attempt, updates state machine counters, determines the next repair strategy, and guards against exceeding max rounds.
export function processRepairAttempt(
  state: RepairState,
  errorSummary: string
): RepairActionResult {
  if (state.isTerminated) {
    return {
      nextState: state,
      action: "ESCALATE_TO_CAPTAIN",
      promptDirective: "Repair machine terminated. Max attempts exceeded.",
      shouldHalt: true,
    };
  }

  const nextAttempt = state.attemptCount + 1;
  const checksum = computeErrorChecksum(errorSummary);

  let nextStrategy: RepairStrategy = "EDIT_PREVIOUS";
  if (nextAttempt >= state.maxAttempts) {
    nextStrategy = "REGENERATE_FROM_SOURCE";
  } else if (nextAttempt === 1 || nextAttempt === 2) {
    nextStrategy = "EDIT_PREVIOUS";
  }

  const updatedHistory: RepairHistoryItem[] = [
    ...state.history,
    {
      round: nextAttempt,
      errorSummary,
      strategy: nextStrategy,
      checksum,
    },
  ];

  const oscillating = detectOscillation(updatedHistory);
  const shouldHalt = nextAttempt > state.maxAttempts || oscillating;

  const finalStrategy: RepairStrategy = shouldHalt
    ? "ESCALATE_TO_CAPTAIN"
    : nextStrategy;

  const nextState: RepairState = {
    attemptCount: nextAttempt,
    maxAttempts: state.maxAttempts,
    currentStrategy: finalStrategy,
    isOscillating: oscillating,
    history: updatedHistory,
    isTerminated: shouldHalt,
  };

  let promptDirective = "";
  if (finalStrategy === "EDIT_PREVIOUS") {
    promptDirective = `Apply targeted local patch for error: ${errorSummary}. Retain original canvas layout and component structure.`;
  } else if (finalStrategy === "REGENERATE_FROM_SOURCE") {
    promptDirective = `Regenerate full composition from source script due to persistent errors: ${errorSummary}.`;
  } else {
    promptDirective = `Halt automatic repair and escalate to captain. Max attempts (${state.maxAttempts}) reached or oscillation detected.`;
  }

  return {
    nextState,
    action: finalStrategy,
    promptDirective,
    shouldHalt,
  };
}
