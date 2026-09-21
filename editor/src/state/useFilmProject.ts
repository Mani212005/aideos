/**
 * File Description: Project state for the Aideos editor.
 * Owns the single source of truth for the open film: its contents, the one labelled undo/redo
 * history every screen commits through, the project list and active-project persistence, the
 * autosave round trip to the dev server, and the non-blocking toast queue. Screens never mutate the
 * film directly; they call `commit` with a label so one user gesture is always one undo step and
 * the history surface can name what happened.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Film } from "../../../src/dl/schema";
import { buildTimeline, totalFrames } from "../../../src/dl/camera";
import { validateFilmAudioAndAssets } from "../../../src/dl/validateFilm";
import type { NoteTone, ToastMessage } from "../components/ui";

/** How many past states the editor keeps. Deep enough for a long session, bounded for memory. */
const HISTORY_LIMIT = 80;

export interface HistoryEntry {
  film: Film;
  label: string;
  at: number;
}

export interface ProjectValidation {
  ok: boolean;
  message: string;
}

export interface FilmProject {
  film: Film;
  filmIds: string[];
  isLoading: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  isDirty: boolean;
  history: HistoryEntry[];
  historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  validation: ProjectValidation;
  durationFrames: number;
  durationSec: number;
  audioDurationSec: number | undefined;
  timeline: ReturnType<typeof buildTimeline> | null;
  toasts: ToastMessage[];
  commit: (next: Film, label: string) => void;
  replaceFilm: (next: Film) => void;
  undo: () => void;
  redo: () => void;
  jumpTo: (index: number) => void;
  save: () => Promise<void>;
  selectFilm: (id: string) => Promise<void>;
  registerFilm: (film: Film) => void;
  notify: (tone: NoteTone, text: string, options?: { sticky?: boolean; progress?: number }) => number;
  updateToast: (id: number, patch: Partial<Omit<ToastMessage, "id">>) => void;
  dismissToast: (id: number) => void;
}

/** Persist a film to the dev server, returning the issues list when the server rejects it. */
async function persistFilm(film: Film): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/films/${film.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ film }),
    });
    const payload = (await res.json().catch(() => null)) as
      | { file?: string; error?: string; issues?: string[] }
      | null;
    if (!res.ok) {
      return { ok: false, error: payload?.issues?.join("\n") ?? payload?.error ?? `Save failed (${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Project-wide editor state: the open film, its history, persistence and status messages. */
export function useFilmProject(initialFilm: Film, knownFilmIds: string[]): FilmProject {
  const [history, setHistory] = useState<HistoryEntry[]>([
    { film: initialFilm, label: "Opened project", at: Date.now() },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [filmIds, setFilmIds] = useState<string[]>(knownFilmIds);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);

  const film = history[historyIndex]?.film ?? initialFilm;
  const filmRef = useRef(film);
  filmRef.current = film;

  /** Queue a non-blocking status message and return its id so it can be updated later. */
  const notify = useCallback(
    (tone: NoteTone, text: string, options?: { sticky?: boolean; progress?: number }) => {
      const id = toastSeq.current++;
      setToasts((prev) => [...prev.slice(-3), { id, tone, text, ...options }]);
      return id;
    },
    [],
  );

  /** Update a queued message in place, used to drive long-running job progress. */
  const updateToast = useCallback((id: number, patch: Partial<Omit<ToastMessage, "id">>) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /** Remove a queued message. */
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Record a new film state as one labelled, undoable step and schedule an autosave. */
  const commit = useCallback(
    (next: Film, label: string) => {
      setHistory((prev) => {
        const truncated = prev.slice(0, historyIndex + 1);
        const appended = [...truncated, { film: next, label, at: Date.now() }];
        const trimmed = appended.length > HISTORY_LIMIT ? appended.slice(appended.length - HISTORY_LIMIT) : appended;
        setHistoryIndex(trimmed.length - 1);
        return trimmed;
      });
      setIsDirty(true);
    },
    [historyIndex],
  );

  /** Swap the open film without creating a history step, used when loading a project. */
  const replaceFilm = useCallback((next: Film) => {
    setHistory([{ film: next, label: "Opened project", at: Date.now() }]);
    setHistoryIndex(0);
    setIsDirty(false);
  }, []);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  /** Step back one labelled edit. */
  const undo = useCallback(() => {
    setHistoryIndex((i) => {
      if (i <= 0) return i;
      setIsDirty(true);
      return i - 1;
    });
  }, []);

  /** Step forward one labelled edit. */
  const redo = useCallback(() => {
    setHistoryIndex((i) => {
      if (i >= history.length - 1) return i;
      setIsDirty(true);
      return i + 1;
    });
  }, [history.length]);

  /** Jump directly to any point in the history surface. */
  const jumpTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= history.length) return;
      setHistoryIndex(index);
      setIsDirty(true);
    },
    [history.length],
  );

  /** Write the current film to disk through the dev server. */
  const save = useCallback(async () => {
    setSaving(true);
    const res = await persistFilm(film);
    setSaving(false);
    if (res.ok) {
      setLastSavedAt(Date.now());
      setIsDirty(false);
      notify("success", `Saved ${film.id}`);
    } else {
      notify("danger", res.error ?? "Save failed");
    }
  }, [film, notify]);

  /** Load another project, replacing the open film and its history. */
  const selectFilm = useCallback(
    async (id: string) => {
      setIsLoading(true);
      localStorage.setItem("aideos_active_film_id", id);
      try {
        await fetch("/api/active-film", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
      } catch {
        // The active-project pointer is a convenience; failing to set it must not block the load.
      }

      try {
        const res = await fetch(`/api/films/${id}`);
        const data = await res.json();
        if (data.ok && data.film) {
          replaceFilm(data.film as Film);
          notify("info", `Opened ${id}`);
          return;
        }
        notify("danger", `Could not open ${id}`);
      } catch (err) {
        notify("danger", `Could not open ${id}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [notify, replaceFilm],
  );

  /** Add a newly created project to the switcher and open it. */
  const registerFilm = useCallback(
    (next: Film) => {
      setFilmIds((prev) => Array.from(new Set([next.id, ...prev])));
      replaceFilm(next);
      localStorage.setItem("aideos_active_film_id", next.id);
      void fetch("/api/active-film", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: next.id }),
      }).catch(() => undefined);
    },
    [replaceFilm],
  );

  // Restore the project list and the last active project on mount.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/films");
        const ids = (await res.json()) as string[];
        if (!live || !Array.isArray(ids) || ids.length === 0) {
          setIsLoading(false);
          return;
        }
        setFilmIds(ids);

        let activeId = localStorage.getItem("aideos_active_film_id");
        if (!activeId || !ids.includes(activeId)) {
          try {
            const activeRes = await fetch("/api/active-film");
            const activeData = await activeRes.json();
            if (activeData.activeId && ids.includes(activeData.activeId)) activeId = activeData.activeId;
          } catch {
            // Falls through to the default pick below.
          }
        }
        if (!activeId || !ids.includes(activeId)) {
          activeId = ids.includes("what-is-jepa") ? "what-is-jepa" : ids[0];
        }

        const filmRes = await fetch(`/api/films/${activeId}`);
        const filmData = await filmRes.json();
        if (live && filmData.ok && filmData.film) {
          replaceFilm(filmData.film as Film);
          localStorage.setItem("aideos_active_film_id", activeId);
        }
      } catch {
        // Offline or server-less: the bundled film stays open.
      } finally {
        if (live) setIsLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [replaceFilm]);

  // Autosave shortly after the film settles, so edits survive a reload without a manual save.
  useEffect(() => {
    if (!isDirty) return;
    const timer = window.setTimeout(() => {
      void persistFilm(film).then((res) => {
        if (res.ok) {
          setLastSavedAt(Date.now());
          setIsDirty(false);
        }
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [film, isDirty]);

  // Live studio hot-reload: subscribe to film_updated events over the SSE trace transport
  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;
    const activeId = film.id;
    if (!activeId) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: any = null;
    let isMounted = true;

    /** Connect to the SSE endpoint to stream live film updates. */
    const connect = () => {
      if (!isMounted) return;
      try {
        const es = new EventSource(`/api/agent/trace?filmId=${encodeURIComponent(activeId)}`);
        eventSource = es;

        es.addEventListener("film_updated", (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.filmId === activeId && data.film) {
              const incomingFilm = data.film as Film;
              if (JSON.stringify(incomingFilm) !== JSON.stringify(filmRef.current)) {
                replaceFilm(incomingFilm);
                notify("info", `⚡ Live update: ${incomingFilm.title || activeId} updated`);
              }
            }
          } catch (err) {
            console.warn("[useFilmProject] Error parsing live film update:", err);
          }
        });

        es.onerror = () => {
          if (!isMounted) return;
          es.close();
          reconnectTimer = setTimeout(connect, 4000);
        };
      } catch {
        reconnectTimer = setTimeout(connect, 4000);
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSource) eventSource.close();
    };
  }, [film.id, notify, replaceFilm]);

  const timeline = useMemo(() => {
    try {
      return buildTimeline(film, film.voiceover?.durationSec);
    } catch (err) {
      console.warn("[timeline] could not be built", err);
      return null;
    }
  }, [film]);

  const durationFrames = timeline ? totalFrames(timeline) : 300;

  const validation = useMemo<ProjectValidation>(() => {
    try {
      validateFilmAudioAndAssets(film, { toleranceSec: 1000 });
      return { ok: true, message: "Schema rules and audio invariants healthy" };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Validation error" };
    }
  }, [film]);

  const audioDurationSec = useMemo(() => {
    if (film.voiceover?.durationSec && film.voiceover.durationSec > 0) return film.voiceover.durationSec;
    if (!film.shots || film.shots.length === 0) return undefined;
    const total = film.shots.reduce((acc, s) => acc + (s.dur || 3), 0);
    return total > 0 ? total : undefined;
  }, [film]);

  return {
    film,
    filmIds,
    isLoading,
    saving,
    lastSavedAt,
    isDirty,
    history,
    historyIndex,
    canUndo,
    canRedo,
    undoLabel: canUndo ? history[historyIndex].label : null,
    redoLabel: canRedo ? history[historyIndex + 1].label : null,
    validation,
    durationFrames,
    durationSec: durationFrames / (film.fps || 30),
    audioDurationSec,
    timeline,
    toasts,
    commit,
    replaceFilm,
    undo,
    redo,
    jumpTo,
    save,
    selectFilm,
    registerFilm,
    notify,
    updateToast,
    dismissToast,
  };
}
