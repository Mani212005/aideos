/**
 * File Description: Pure state rules for the Auto-Prompt button: one request in flight at a time, and the badge that says where the prompt stands.
 * Inputs and outputs: an async request, or a dispatch result plus the live pane delivery -> a guarded run, or the badge label and tone.
 * Used by: editor/src/components/ScriptEditor.tsx, backend/agentBridge/autoPrompt.test.ts.
 */

import type { PaneDeliveryView } from "./paneDelivery";

export type BadgeTone = "quiet" | "warn" | "info" | "success" | "danger";

export interface AutoPromptBadge {
  label: string;
  tone: BadgeTone;
  /** Hover text, when the badge has more to say. */
  title?: string;
}

/** Lets one request run at a time; a call made while one is running is dropped, even before the screen re-renders. */
export function createSingleFlight() {
  let busy = false;
  return {
    /** Runs the request unless one is running; resolves to undefined when it was dropped. */
    async run<T>(request: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await request();
      } finally {
        busy = false;
      }
    },
    /** True while a request is running. */
    isBusy: () => busy,
  };
}

/** The badge for an Auto-Prompt: a reused task says "Already queued" (or sent), a new one follows the terminal queue. */
export function autoPromptBadge(duplicate: boolean | undefined, delivery: PaneDeliveryView | null): AutoPromptBadge | null {
  const reused = Boolean(duplicate || delivery?.duplicate);
  if (reused) return { label: delivery?.state === "sent" ? "Already sent" : "Already queued", tone: "quiet" };
  if (!delivery) return null;
  if (delivery.state === "queued") return { label: "Queued", tone: "warn", title: `Sent when your ${delivery.agent} agent is idle at an empty prompt` };
  if (delivery.state === "sending") return { label: "Sending", tone: "info" };
  if (delivery.state === "sent") return { label: "Sent", tone: "success" };
  return { label: "Not sent", tone: "danger", title: delivery.error };
}
