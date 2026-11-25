/**
 * File Description: The state of every film for the Films home. For each film id it reads the film from the dev server and asks the acceptance route for its Check state (Draft, Fail, Pass, Old, OK), one film after the other so a long list never floods the server. It reads again each time the home opens, because a check may have finished meanwhile.
 * Inputs and outputs: the film ids and whether the home is open -> a map from film id to a loading, ready or unavailable state.
 * Used by: editor/src/components/shell/FilmsHome.tsx.
 */

import { useEffect, useState } from "react";
import type { CheckState, CheckView } from "../../../backend/filmAcceptance/checkView";

/** What the home knows about one film. */
export type FilmStateLoad = { status: "loading" } | { status: "ready"; state: CheckState } | { status: "unavailable" };

/** Reads the Check state of one film, or null when it cannot be read (or the read was cancelled through `signal`). */
async function readState(id: string, signal: AbortSignal): Promise<CheckState | null> {
  try {
    const filmRes = await fetch(`/api/films/${encodeURIComponent(id)}`, { signal });
    const body = (await filmRes.json()) as { film?: unknown };
    if (!filmRes.ok || !body.film) return null;
    const res = await fetch(`/api/acceptance/${encodeURIComponent(id)}?format=long`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ film: body.film }),
      signal,
    });
    if (!res.ok) return null;
    return ((await res.json()) as { check?: CheckView }).check?.state ?? null;
  } catch {
    return null;
  }
}

/** The Check state of each film in `ids`, read while `active` is true. */
export function useFilmStates(ids: readonly string[], active: boolean): Record<string, FilmStateLoad> {
  const [states, setStates] = useState<Record<string, FilmStateLoad>>({});
  const key = ids.join("\n");

  useEffect(() => {
    if (!active) return;
    // Closing the home (or a changed film list) aborts the read in flight instead of letting it finish unseen.
    const controller = new AbortController();
    void (async () => {
      for (const id of key.split("\n").filter(Boolean)) {
        const state = await readState(id, controller.signal);
        if (controller.signal.aborted) return;
        setStates((prev) => ({ ...prev, [id]: state ? { status: "ready", state } : { status: "unavailable" } }));
      }
    })();
    return () => controller.abort();
  }, [key, active]);

  return states;
}
