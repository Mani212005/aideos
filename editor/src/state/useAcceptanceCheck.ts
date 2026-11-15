/**
 * File Description: Client state of the Check lens verdict. It posts the film on screen to the dev server, which reads acceptance.json and answers with the Check view (state, six hard gates, score against the 9.0 bar). It reads again when the film or the format changes and when the window gets focus, so a check an agent just finished shows without a button.
 * Inputs and outputs: the film on screen and the format -> a loading, ready or unavailable result.
 * Used by: editor/src/screens/CheckStage.tsx.
 */

import { useEffect, useState } from "react";
import type { Film } from "../../../src/dl/schema";
import type { CheckView } from "../../../backend/filmAcceptance/checkView";

/** What the lens knows about the verdict right now. */
export type CheckLoad = { status: "loading" } | { status: "ready"; view: CheckView } | { status: "unavailable" };

/** Reads the Check view of the film on screen from the dev server. */
export function useAcceptanceCheck(film: Film, format: "long" | "reel"): CheckLoad {
  const key = `${film.id}:${format}`;
  const [result, setResult] = useState<{ key: string; load: CheckLoad } | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  // Reads again when the window gets focus, because an agent may have finished a check meanwhile.
  useEffect(() => {
    // Counts a focus event so the read below runs again.
    const onFocus = () => setFocusTick((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/acceptance/${encodeURIComponent(film.id)}?format=${format}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ film }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Check failed (${r.status})`);
        return r.json();
      })
      .then((data: { check?: CheckView }) => {
        if (!alive) return;
        setResult({ key, load: data?.check ? { status: "ready", view: data.check } : { status: "unavailable" } });
      })
      .catch(() => {
        if (alive) setResult({ key, load: { status: "unavailable" } });
      });
    return () => {
      alive = false;
    };
  }, [film, format, key, focusTick]);

  // A result for another film or format never shows; the same film keeps its last result while it is read again.
  return result && result.key === key ? result.load : { status: "loading" };
}
