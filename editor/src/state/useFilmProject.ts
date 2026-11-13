/**
 * File Description: Project state for the Aideos editor.
 * Owns the single source of truth for the open film: its contents, the one labelled undo/redo
 * history every screen commits through, the project list and active-project persistence, the
 * autosave round trip to the dev server (ordered and revision-checked through the film sync state
 * machine in filmSyncMachine.ts), and the non-blocking toast queue. Screens never mutate the
 * film directly; they call `commit` with a label so one user gesture is always one undo step and
 * the history surface can name what happened.
 * Inputs and outputs: storage key and initial film -> reactive film project state with undo/redo transaction stack.
 * Used by: editor/src/App.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseFilm, type Film } from "../../../src/dl/schema";
import { buildTimeline, totalFrames } from "../../../src/dl/camera";
import { validateFilmAudioAndAssets } from "../../../src/dl/validateFilm";
import type { NoteTone, ToastMessage } from "../components/ui";
import {
  baseRevision,
  hasUnsavedEdits,
  initialSyncState,
  transition,
  type RemoteFilm,
  type SyncEffect,
  type SyncEvent,
  type SyncState,
  type Transition,
} from "./filmSyncMachine";

/** How many past states the editor keeps. Deep enough for a long session, bounded for memory. */
const HISTORY_LIMIT = 80;

/** Quiet period after the last edit before the film is autosaved. */
const AUTOSAVE_DELAY_MS = 900;

/** Wait before the live-update stream reconnects after it drops. */
const RECONNECT_DELAY_MS = 4000;

export interface HistoryEntry {
  film: Film;
  label: string;
  at: number;
}

export interface ProjectValidation {
  ok: boolean;
  message: string;
}

/** The result of asking the project to save a film: saved, or why not. */
export type SaveOutcome = { ok: true } | { ok: false; reason: string };

/** A film that changed on disk while the studio held edits of its own, kept beside the studio's version. */
export interface FilmConflict {
  remoteFilm: Film;
}

export interface FilmProject {
  film: Film;
  filmIds: string[];
  isLoading: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  isDirty: boolean;
  /** Set while the disk film and the studio's film both changed; resolve with keepMine or takeTheirs. */
  conflict: FilmConflict | null;
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
  /** Commit a film (if it is not already the open one) and save it through the sync machine. */
  saveFilm: (next: Film, label: string) => Promise<SaveOutcome>;
  undo: () => void;
  redo: () => void;
  jumpTo: (index: number) => void;
  save: () => Promise<void>;
  selectFilm: (id: string) => Promise<void>;
  registerFilm: (film: Film) => void;
  /** Conflict resolution: keep the studio's film and let the next save replace the disk version. */
  keepMine: () => void;
  /** Conflict resolution: take the film from disk as a new undoable step. */
  takeTheirs: () => void;
  notify: (tone: NoteTone, text: string, options?: { sticky?: boolean; progress?: number }) => number;
  updateToast: (id: number, patch: Partial<Omit<ToastMessage, "id">>) => void;
  dismissToast: (id: number) => void;
}

type PersistResult =
  | { kind: "saved"; rev: string | null }
  | { kind: "conflict"; remote: RemoteFilm<Film> }
  | { kind: "failed"; error: string };

/** Persist a film to the dev server, naming the revision it started from; a stale base comes back as a conflict. */
async function persistFilm(film: Film, baseRev: string | null): Promise<PersistResult> {
  try {
    const res = await fetch(`/api/films/${film.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseRev ? { film, baseRev } : { film }),
    });
    const payload = (await res.json().catch(() => null)) as
      | { file?: string; error?: string; issues?: string[]; rev?: string; film?: Film; code?: string }
      | null;
    if (res.status === 409 && payload?.code === "stale_revision" && payload.film) {
      return { kind: "conflict", remote: { rev: payload.rev ?? null, film: parseFilm(payload.film), sameAsLocal: false } };
    }
    if (!res.ok) {
      return { kind: "failed", error: payload?.issues?.join("\n") ?? payload?.error ?? `Save failed (${res.status})` };
    }
    return { kind: "saved", rev: payload?.rev ?? null };
  } catch (err) {
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fetch a film and the revision it has on disk, or null when it cannot be read. */
async function fetchFilm(id: string): Promise<{ rev: string | null; film: Film } | null> {
  const res = await fetch(`/api/films/${id}`);
  const data = (await res.json()) as { ok?: boolean; film?: Film; rev?: string };
  if (!data.ok || !data.film) return null;
  return { rev: data.rev ?? null, film: data.film };
}

/** True when two films hold the same content, or differ only by the measurements the backend adds when it writes one. */
function sameFilmContent(local: Film, remote: Film): boolean {
  const incoming = parseFilm(remote);
  return (
    JSON.stringify(incoming) === JSON.stringify(parseFilm(local)) ||
    JSON.stringify(parseFilm(withMeasurements(local, incoming))) === JSON.stringify(incoming)
  );
}

/** Fold the backend's soundtrack measurements from `incoming` into `current` without touching anything else. */
function withMeasurements(current: Film, incoming: Film): Film {
  if (!current.soundtrack || !incoming.soundtrack) return current;
  return {
    ...current,
    soundtrack: {
      ...current.soundtrack,
      speech: incoming.soundtrack.speech,
      speechSource: incoming.soundtrack.speechSource,
      narrationPeakDb: incoming.soundtrack.narrationPeakDb,
      sections: current.soundtrack.sections.map((section, i) => ({
        ...section,
        sourceChannels: incoming.soundtrack?.sections[i]?.sourceChannels,
      })),
    },
  };
}

/** Project-wide editor state: the open film, its history, persistence and status messages. */
export function useFilmProject(initialFilm: Film, knownFilmIds: string[]): FilmProject {
  const [history, setHistory] = useState<HistoryEntry[]>([
    { film: initialFilm, label: "Opened project", at: Date.now() },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [filmIds, setFilmIds] = useState<string[]>(knownFilmIds);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);

  // The sync machine is the one owner of loading / clean / dirty / saving / conflict. The ref is
  // read and written synchronously by `dispatchSync`, so two events in one tick never see a stale state.
  const syncRef = useRef<SyncState<Film>>(initialSyncState<Film>());
  const [sync, setSync] = useState<SyncState<Film>>(syncRef.current);
  const loadSeq = useRef(0);
  const saveSeq = useRef(0);
  const inFlightSave = useRef<Promise<SaveOutcome> | null>(null);

  const historyRef = useRef(history);
  const indexRef = useRef(0);
  historyRef.current = history;
  indexRef.current = historyIndex;

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

  /** Replace the whole history and the cursor together, keeping the refs in step with the rendered state. */
  const writeHistory = useCallback((entries: HistoryEntry[], index: number) => {
    historyRef.current = entries;
    indexRef.current = index;
    filmRef.current = entries[index].film;
    setHistory(entries);
    setHistoryIndex(index);
  }, []);

  /** Append a film as one labelled history step without telling the sync machine (callers do that). */
  const pushHistory = useCallback(
    (next: Film, label: string) => {
      const truncated = historyRef.current.slice(0, indexRef.current + 1);
      const appended = [...truncated, { film: next, label, at: Date.now() }];
      const trimmed = appended.length > HISTORY_LIMIT ? appended.slice(appended.length - HISTORY_LIMIT) : appended;
      writeHistory(trimmed, trimmed.length - 1);
    },
    [writeHistory],
  );

  /** Put another writer's film (or the backend's measurements of our own write) into the open film. */
  const applyRemoteFilm = useCallback(
    (effect: Extract<SyncEffect<Film>, { kind: "adopt" | "absorb" }>) => {
      const current = filmRef.current;
      const incoming = parseFilm(effect.film);
      if (effect.kind === "absorb") {
        // Our own write came back with the backend's measurements: fold those in, keep every newer edit.
        const merged = withMeasurements(current, incoming);
        if (JSON.stringify(parseFilm(merged)) === JSON.stringify(parseFilm(current))) return;
        writeHistory(
          historyRef.current.map((entry) => (entry.film === current ? { ...entry, film: merged } : entry)),
          indexRef.current,
        );
        return;
      }
      if (effect.source === "resolved") {
        pushHistory(incoming, "Used the version saved elsewhere");
        return;
      }
      if (JSON.stringify(incoming) === JSON.stringify(parseFilm(current))) return;
      // Backend measurements update the current gesture without adding a second Undo step.
      if (JSON.stringify(parseFilm(withMeasurements(current, incoming))) === JSON.stringify(incoming)) {
        writeHistory(
          historyRef.current.map((entry) => (entry.film === current ? { ...entry, film: incoming } : entry)),
          indexRef.current,
        );
        return;
      }
      pushHistory(incoming, "Live sync update");
      notify("info", `⚡ Live update: ${incoming.title || incoming.id} updated`);
    },
    [notify, pushHistory, writeHistory],
  );

  /** Run what a transition asks for: update the open film, or tell the user about a conflict. */
  const runEffects = useCallback(
    (effects: SyncEffect<Film>[]) => {
      for (const effect of effects) {
        if (effect.kind === "conflict") {
          notify(
            "warn",
            "This film was changed somewhere else while you had edits. Your version is kept: choose Keep mine or Use theirs.",
            { sticky: true },
          );
          continue;
        }
        try {
          applyRemoteFilm(effect);
        } catch (err) {
          console.warn("[useFilmProject] Error applying live film update:", err);
        }
      }
    },
    [applyRemoteFilm, notify],
  );

  /** Feed one event to the sync machine, publish the new state and run its effects. */
  const dispatchSync = useCallback(
    (event: SyncEvent<Film>): Transition<Film> => {
      const result = transition(syncRef.current, event);
      if (result.state !== syncRef.current) {
        syncRef.current = result.state;
        setSync(result.state);
      }
      runEffects(result.effects);
      return result;
    },
    [runEffects],
  );

  /** Record a new film state as one labelled, undoable step and schedule an autosave. */
  const commit = useCallback(
    (next: Film, label: string) => {
      if (syncRef.current.phase === "loading") return; // Input is disabled while the film loads.
      pushHistory(next, label);
      dispatchSync({ type: "edited" });
    },
    [dispatchSync, pushHistory],
  );

  /** Make the open film another writer's film (project switch or registration): history restarts, the machine is told the revision. */
  const openFilmState = useCallback(
    (next: Film, rev: string | null, seq: number) => {
      const result = dispatchSync({ type: "loaded", seq, rev });
      if (result.rejected) return false;
      writeHistory([{ film: next, label: "Opened project", at: Date.now() }], 0);
      return true;
    },
    [dispatchSync, writeHistory],
  );

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  /** Move the history cursor and mark the film edited, unless the film is still loading. */
  const moveCursor = useCallback(
    (index: number) => {
      if (syncRef.current.phase === "loading") return;
      if (index < 0 || index >= historyRef.current.length || index === indexRef.current) return;
      writeHistory(historyRef.current, index);
      dispatchSync({ type: "edited" });
    },
    [dispatchSync, writeHistory],
  );

  /** Step back one labelled edit. */
  const undo = useCallback(() => moveCursor(indexRef.current - 1), [moveCursor]);

  /** Step forward one labelled edit. */
  const redo = useCallback(() => moveCursor(indexRef.current + 1), [moveCursor]);

  /** Jump directly to any point in the history surface. */
  const jumpTo = useCallback((index: number) => moveCursor(index), [moveCursor]);

  /** Send one film through the sync machine: one request in flight at a time, based on the revision it started from. */
  const runSave = useCallback(
    (target: Film, announce: boolean): Promise<SaveOutcome> => {
      const base = baseRevision(syncRef.current);
      const seq = ++saveSeq.current;
      const started = dispatchSync({ type: "save_started", seq });
      if (started.rejected) return Promise.resolve({ ok: false, reason: started.rejected });
      const run = (async (): Promise<SaveOutcome> => {
        const res = await persistFilm(target, base);
        if (res.kind === "saved") {
          dispatchSync({ type: "save_succeeded", seq, rev: res.rev });
          setLastSavedAt(Date.now());
          if (announce) notify("success", `Saved ${target.id}`);
          return { ok: true };
        }
        if (res.kind === "conflict") {
          const remote = { ...res.remote, sameAsLocal: sameFilmContent(filmRef.current, res.remote.film) };
          dispatchSync({ type: "save_conflicted", seq, remote });
          return { ok: false, reason: "The film was changed somewhere else; choose Keep mine or Use theirs." };
        }
        dispatchSync({ type: "save_failed", seq });
        notify("danger", announce ? res.error : `Autosave failed: ${res.error}`);
        return { ok: false, reason: res.error };
      })();
      inFlightSave.current = run;
      void run.finally(() => {
        if (inFlightSave.current === run) inFlightSave.current = null;
      });
      return run;
    },
    [dispatchSync, notify],
  );

  /** Save the film the machine is ready to save, after any request in flight has settled. */
  const saveWhenReady = useCallback(
    async (target: Film, announce: boolean): Promise<SaveOutcome> => {
      if (inFlightSave.current) await inFlightSave.current;
      const phase = syncRef.current.phase;
      if (phase === "conflict") {
        const reason = "The film was changed somewhere else; choose Keep mine or Use theirs before saving.";
        notify("danger", reason);
        return { ok: false, reason };
      }
      if (phase === "loading") return { ok: false, reason: "The film is still loading." };
      return runSave(target, announce);
    },
    [notify, runSave],
  );

  /** Write the current film to disk through the dev server. */
  const save = useCallback(async () => {
    await saveWhenReady(filmRef.current, true);
  }, [saveWhenReady]);

  /** Commit a film (unless it is already the open one) and save exactly that film. */
  const saveFilm = useCallback(
    async (next: Film, label: string): Promise<SaveOutcome> => {
      if (syncRef.current.phase === "loading") return { ok: false, reason: "The film is still loading." };
      if (next !== filmRef.current && JSON.stringify(next) !== JSON.stringify(filmRef.current)) commit(next, label);
      return saveWhenReady(next, false);
    },
    [commit, saveWhenReady],
  );

  /** Take the film from disk after the studio and another writer both changed it. */
  const takeTheirs = useCallback(() => {
    dispatchSync({ type: "take_theirs" });
  }, [dispatchSync]);

  /** Keep the studio's film after a conflict; the next save replaces the disk version on purpose. */
  const keepMine = useCallback(() => {
    dispatchSync({ type: "keep_mine" });
  }, [dispatchSync]);

  /** Load a project from the server into the open film, with the revision it has on disk. */
  const loadFilm = useCallback(
    async (id: string, fallback: Film | null): Promise<boolean> => {
      const seq = ++loadSeq.current;
      const started = dispatchSync({ type: "load_started", seq });
      if (started.rejected) return false;
      try {
        const loaded = await fetchFilm(id);
        if (loaded) return openFilmState(loaded.film, loaded.rev, seq);
        if (fallback) return openFilmState(fallback, null, seq);
        dispatchSync({ type: "load_failed", seq });
        notify("danger", `Could not open ${id}`);
      } catch (err) {
        if (fallback) return openFilmState(fallback, null, seq);
        dispatchSync({ type: "load_failed", seq });
        notify("danger", `Could not open ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return false;
    },
    [dispatchSync, notify, openFilmState],
  );

  /** Get the open film into a state it can be left in: finish any save, save pending edits, and say why if it cannot. */
  const settleBeforeLeaving = useCallback(async (): Promise<boolean> => {
    if (inFlightSave.current) await inFlightSave.current;
    if (syncRef.current.phase === "dirty") await saveWhenReady(filmRef.current, false);
    if (!hasUnsavedEdits(syncRef.current)) return true;
    notify(
      "danger",
      syncRef.current.phase === "conflict"
        ? "This film changed somewhere else: choose Keep mine or Use theirs before switching project."
        : "Your latest edits are not saved yet: fix the save problem before switching project.",
    );
    return false;
  }, [notify, saveWhenReady]);

  /** Load another project, replacing the open film and its history; unsaved edits are saved first, never dropped. */
  const selectFilm = useCallback(
    async (id: string) => {
      if (!(await settleBeforeLeaving())) return;
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
      if (await loadFilm(id, null)) notify("info", `Opened ${id}`);
    },
    [loadFilm, notify, settleBeforeLeaving],
  );

  /** Add a newly created project to the switcher and open it. */
  const registerFilm = useCallback(
    (next: Film) => {
      setFilmIds((prev) => Array.from(new Set([next.id, ...prev])));
      void (async () => {
        if (!(await settleBeforeLeaving())) return;
        await loadFilm(next.id, next);
        localStorage.setItem("aideos_active_film_id", next.id);
        await fetch("/api/active-film", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: next.id }),
        }).catch(() => undefined);
      })();
    },
    [loadFilm, settleBeforeLeaving],
  );

  // Restore the project list and the last active project on mount.
  useEffect(() => {
    let live = true;
    const seq = ++loadSeq.current;
    dispatchSync({ type: "load_started", seq });
    (async () => {
      let opened = false;
      try {
        const res = await fetch("/api/films");
        const ids = (await res.json()) as string[];
        if (!live || !Array.isArray(ids) || ids.length === 0) return;
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
          activeId = ids[0];
        }

        const loaded = await fetchFilm(activeId);
        if (live && loaded) {
          opened = openFilmState(loaded.film, loaded.rev, seq);
          localStorage.setItem("aideos_active_film_id", activeId);
        }
      } catch {
        // Offline or server-less: the bundled film stays open.
      } finally {
        if (live && !opened) dispatchSync({ type: "load_failed", seq });
      }
    })();
    return () => {
      live = false;
    };
  }, [dispatchSync, openFilmState]);

  // Autosave shortly after the film settles, so edits survive a reload without a manual save. A save
  // that failed is not retried on a timer (the next edit or a manual save retries it).
  useEffect(() => {
    if (sync.phase !== "dirty" || sync.failed) return;
    const timer = window.setTimeout(() => {
      void saveWhenReady(filmRef.current, false);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [sync, film, saveWhenReady]);

  // Live studio hot-reload: subscribe to film_updated events over the SSE trace transport. Every
  // (re)connection also reads the film from disk, because events missed while disconnected are not replayed.
  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;
    const activeId = film.id;
    if (!activeId) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    /** Hand a film written by anyone to the sync machine, which decides whether it is ours, new, or a conflict. */
    const deliver = (rev: string | null, incoming: Film) => {
      if (!isMounted) return;
      const remote: RemoteFilm<Film> = {
        rev,
        film: incoming,
        sameAsLocal: sameFilmContent(filmRef.current, incoming),
      };
      dispatchSync({ type: "external_update", remote });
    };

    /** Connect to the SSE endpoint to stream live film updates. */
    const connect = () => {
      if (!isMounted) return;
      try {
        const es = new EventSource(`/api/agent/trace?filmId=${encodeURIComponent(activeId)}`);
        eventSource = es;

        es.addEventListener("connected", () => {
          void fetchFilm(activeId)
            .then((remote) => {
              if (remote) deliver(remote.rev, parseFilm(remote.film));
            })
            .catch(() => undefined);
        });

        es.addEventListener("film_updated", (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.filmId === activeId && data.film) {
              deliver(typeof data.rev === "string" ? data.rev : null, parseFilm(data.film));
            }
          } catch (err) {
            console.warn("[useFilmProject] Error parsing live film update:", err);
          }
        });

        es.onerror = () => {
          if (!isMounted) return;
          es.close();
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        };
      } catch {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSource) eventSource.close();
    };
  }, [dispatchSync, film.id]);

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
    isLoading: sync.phase === "loading",
    saving: sync.phase === "saving",
    lastSavedAt,
    isDirty: hasUnsavedEdits(sync),
    conflict: sync.phase === "conflict" ? { remoteFilm: sync.remote.film } : null,
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
    saveFilm,
    undo,
    redo,
    jumpTo,
    save,
    selectFilm,
    registerFilm,
    keepMine,
    takeTheirs,
    notify,
    updateToast,
    dismissToast,
  };
}
