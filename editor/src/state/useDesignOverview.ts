/**
 * File Description: Loads a film's design overview from the dev server (/api/design/:id): who
 * designed it, the idea, the artwork, motion by shot and why each shot got its visual. Shared by
 * the Look stage's Design view and the shot inspector's "why this visual" panel.
 */

import { useCallback, useEffect, useState } from "react";
import type { DesignOverview } from "../../../backend/designSpec/shotTools";

export type { DesignOverview };

/** The overview for a film, refetched whenever `revision` changes. */
export function useDesignOverview(filmId: string, revision: unknown) {
  const [overview, setOverview] = useState<DesignOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/design/${filmId}`)
      .then(async (res) => {
        const body = await res.json();
        if (!live) return;
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        setOverview(body.overview);
        setError(null);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [filmId, revision, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { overview, error, refresh };
}

/** Posts to a design action and returns its JSON body, throwing its error message on failure. */
export async function postDesignAction<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/design/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.reason || json?.error || `HTTP ${res.status}`);
  return json as T;
}
