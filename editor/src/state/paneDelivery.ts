/**
 * File Description: Follows one Auto-Prompt delivery to the agent's terminal (queued, sending, sent or failed) by polling the studio server.
 * Inputs and outputs: the pane delivery a dispatch returned -> its live state for the queued badge.
 * Used by: editor/src/components/ScriptEditor.tsx.
 */

import { useEffect, useState } from "react";

export interface PaneDeliveryView {
  id: string;
  agent: string;
  state: "queued" | "sending" | "sent" | "failed";
  duplicate: boolean;
  verified: boolean;
  error?: string;
}

const POLL_MS = 1000;

/** The delivery's live state: it starts as the dispatch reported it and is refreshed until it is sent or failed. */
export function usePaneDelivery(initial: PaneDeliveryView | null | undefined): PaneDeliveryView | null {
  const [live, setLive] = useState<PaneDeliveryView | null>(initial ?? null);
  const id = initial?.id;

  useEffect(() => {
    setLive(initial ?? null);
    if (!id || (initial?.state !== "queued" && initial?.state !== "sending")) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/prompt-agent/queue?id=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(String(res.status));
        const { entry } = (await res.json()) as { entry: PaneDeliveryView };
        if (stopped) return;
        setLive({ ...entry, duplicate: initial.duplicate });
        if (entry.state === "sent" || entry.state === "failed") window.clearInterval(timer);
      } catch {
        // The server restarted or forgot the entry: keep the last state we saw and stop asking.
        window.clearInterval(timer);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // The initial value only changes when a new dispatch replaces it.
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return live;
}
