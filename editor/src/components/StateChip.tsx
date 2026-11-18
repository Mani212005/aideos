/**
 * File Description: The one chip that names where a film stands: Draft, Fail, Pass, Old or OK. The Check lens and the Films home draw it the same way, so one word means one state on every screen.
 * Inputs and outputs: a check state -> a small pill with the state word.
 * Used by: editor/src/screens/CheckStage.tsx, editor/src/components/shell/FilmsHome.tsx.
 */

import { Check } from "lucide-react";
import type { CheckState } from "../../../backend/filmAcceptance/checkView";
import { Badge, type BadgeTone } from "./ui";

/** The word for each state. */
export const STATE_TEXT: Record<CheckState, string> = {
  draft: "Draft",
  fail: "Fail",
  pass: "Pass",
  old: "Old",
  ok: "OK",
};

/** The tone for each state. */
export const STATE_TONE: Record<CheckState, BadgeTone> = {
  draft: "quiet",
  fail: "danger",
  pass: "success",
  old: "warn",
  ok: "success",
};

/** A pill with the state word of a film. */
export function StateChip({ state }: { state: CheckState }) {
  return (
    <Badge tone={STATE_TONE[state]} icon={state === "ok" ? <Check className="h-3 w-3" aria-hidden /> : undefined}>
      {STATE_TEXT[state]}
    </Badge>
  );
}
