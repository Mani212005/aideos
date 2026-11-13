/**
 * File Description: The explicit editor film sync state machine (loading / clean / dirty / saving /
 * conflict). One pure transition function owns every state the studio's copy of a film can be in
 * relative to the film on disk, which revision the studio started from, and what to do when
 * another writer (an agent, a pipeline stage, another tab) changes the file. It replaces the four
 * independent flags (isLoading, saving, lastSavedAt, isDirty) the editor used to keep, and it
 * never performs I/O: the hook that drives it runs the returned effects.
 * Inputs and outputs: a sync state and an event -> the next state, the effects to run and, for an
 * impossible transition, a rejection reason (the state is returned unchanged).
 * Used by: editor/src/state/useFilmProject.ts, backend/filmSyncMachine.test.ts.
 */

/** A version of the film written by someone, as the server reports it (revision plus the film). */
export interface RemoteFilm<F> {
  rev: string | null;
  order: number;
  film: F;
  /** True when this version holds the same content as the studio's open film (so there is nothing to choose between). */
  sameAsLocal: boolean;
}

/** What every non-loading state knows about the disk: the revision the studio is based on and the last one it wrote itself. */
interface Known {
  /** Revision of the film on disk that the open film was loaded or last saved from; null when unknown. */
  rev: string | null;
  order: number;
  /** Revision produced by this studio's own last save, so its echo over the event stream is not mistaken for another writer. */
  ownRev: string | null;
}

export type SyncState<F> =
  | { phase: "loading"; seq: number; resume: Known | null }
  | ({ phase: "clean" } & Known)
  | ({ phase: "dirty"; failed: boolean } & Known)
  | ({
      phase: "saving";
      seq: number;
      editedWhileSaving: boolean;
      /** Updates that arrived over the event stream while the request was in flight, replayed once it settles. */
      held: RemoteFilm<F>[];
    } & Known)
  | ({ phase: "conflict"; remote: RemoteFilm<F> } & Known);

export type SyncPhase = SyncState<unknown>["phase"];

export type SyncEvent<F> =
  | { type: "load_started"; seq: number }
  | { type: "loaded"; seq: number; rev: string | null; order: number }
  | { type: "load_failed"; seq: number }
  | { type: "edited" }
  | { type: "save_started"; seq: number }
  | { type: "save_succeeded"; seq: number; rev: string | null; order: number }
  | { type: "save_failed"; seq: number }
  | { type: "save_conflicted"; seq: number; remote: RemoteFilm<F> }
  | { type: "external_update"; remote: RemoteFilm<F> }
  | { type: "keep_mine" }
  | { type: "take_theirs" };

/** What the hook must do after a transition: put another writer's film into the open film, or fold in measurements only. */
export type SyncEffect<F> =
  | { kind: "adopt"; film: F; rev: string | null; source: "live" | "resolved" }
  | { kind: "absorb"; film: F }
  | { kind: "conflict"; remote: RemoteFilm<F>; reason: "saving" | "editing" };

export interface Transition<F> {
  state: SyncState<F>;
  effects: SyncEffect<F>[];
  /** Set when the event is impossible in the current state; `state` is then the unchanged input. */
  rejected?: string;
}

/** The state a studio starts in: nothing is loaded yet. */
export function initialSyncState<F>(): SyncState<F> {
  return { phase: "loading", seq: 0, resume: null };
}

/** The revision the open film is based on, or null while loading or when unknown. */
export function baseRevision<F>(state: SyncState<F>): string | null {
  return state.phase === "loading" ? null : state.rev;
}

/** True while the studio holds edits the disk does not have (dirty, saving after an edit, or in conflict). */
export function hasUnsavedEdits<F>(state: SyncState<F>): boolean {
  if (state.phase === "dirty" || state.phase === "conflict") return true;
  return state.phase === "saving" && state.editedWhileSaving;
}

/** Return the state unchanged with the reason the event is impossible here. */
function reject<F>(state: SyncState<F>, reason: string): Transition<F> {
  return { state, effects: [], rejected: reason };
}

/** Return the state unchanged because the event does not matter here (not an error). */
function ignore<F>(state: SyncState<F>): Transition<F> {
  return { state, effects: [] };
}

/** Strip the phase-specific fields so a state can resume as another phase on the same revisions. */
function known<F>(state: Exclude<SyncState<F>, { phase: "loading" }>): Known {
  return { rev: state.rev, order: state.order, ownRev: state.ownRev };
}

/** Apply another writer's film to a state that is not saving: our own echo is absorbed, anything else adopted or kept as a conflict. */
function applyExternal<F>(state: SyncState<F>, remote: RemoteFilm<F>): Transition<F> {
  if (state.phase === "loading") return ignore(state);
  if (state.phase === "saving") {
    if (remote.order <= state.order) return ignore(state);
    return { state: { ...state, held: [...state.held, remote] }, effects: [] };
  }
  if (remote.order < state.order) return ignore(state);
  if (remote.order === state.order) {
    return remote.rev !== null && remote.rev === state.ownRev
      ? { state, effects: [{ kind: "absorb", film: remote.film }] }
      : ignore(state);
  }
  if (remote.rev !== null && remote.rev === state.ownRev) {
    return { state: { ...state, order: remote.order }, effects: [{ kind: "absorb", film: remote.film }] };
  }
  if (remote.rev !== null && remote.rev === state.rev) return { state: { ...state, order: remote.order }, effects: [] };
  if (remote.sameAsLocal) {
    // The disk already holds what the studio holds (a server step wrote the film the studio also committed): just follow the revision.
    return {
      state: { phase: "clean", rev: remote.rev, order: remote.order, ownRev: state.ownRev },
      effects: [{ kind: "absorb", film: remote.film }],
    };
  }
  switch (state.phase) {
    case "clean":
      return {
        state: { phase: "clean", rev: remote.rev, order: remote.order, ownRev: state.ownRev },
        effects: [{ kind: "adopt", film: remote.film, rev: remote.rev, source: "live" }],
      };
    case "dirty":
      return {
        state: { phase: "conflict", rev: state.rev, order: remote.order, ownRev: state.ownRev, remote },
        effects: [{ kind: "conflict", remote, reason: "editing" }],
      };
    case "conflict":
      if (remote.order <= state.remote.order) return ignore(state);
      return { state: { ...state, order: remote.order, remote }, effects: [] };
  }
}

/** Replay held updates, in arrival order, against the state a settled save left behind. */
function replayHeld<F>(start: Transition<F>, held: RemoteFilm<F>[]): Transition<F> {
  let current = start;
  for (const update of held) {
    const next = applyExternal(current.state, update);
    current = { state: next.state, effects: [...current.effects, ...next.effects] };
  }
  return current;
}

/** The one transition function: every legal move of the studio's film sync, and a rejection for every impossible one. */
export function transition<F>(state: SyncState<F>, event: SyncEvent<F>): Transition<F> {
  switch (event.type) {
    case "load_started": {
      if (state.phase === "saving") return reject(state, "a save is in flight");
      if (state.phase === "dirty") return reject(state, "there are unsaved edits");
      if (state.phase === "conflict") return reject(state, "the film is in conflict");
      const resume = state.phase === "clean" ? known(state) : state.resume;
      return { state: { phase: "loading", seq: event.seq, resume }, effects: [] };
    }

    case "loaded": {
      if (state.phase !== "loading") return reject(state, "no load is in progress");
      if (state.seq !== event.seq) return reject(state, "a newer load superseded this one");
      return { state: { phase: "clean", rev: event.rev, order: event.order, ownRev: null }, effects: [] };
    }

    case "load_failed": {
      if (state.phase !== "loading") return reject(state, "no load is in progress");
      if (state.seq !== event.seq) return reject(state, "a newer load superseded this one");
      const back = state.resume ?? { rev: null, order: 0, ownRev: null };
      return { state: { phase: "clean", ...back }, effects: [] };
    }

    case "edited": {
      switch (state.phase) {
        case "loading":
          return reject(state, "input is disabled while the film loads");
        case "clean":
          return { state: { phase: "dirty", failed: false, ...known(state) }, effects: [] };
        case "dirty":
          return state.failed ? { state: { ...state, failed: false }, effects: [] } : ignore(state);
        case "saving":
          if (state.editedWhileSaving && !state.held.some((remote) => remote.sameAsLocal)) return ignore(state);
          return {
            state: {
              ...state,
              editedWhileSaving: true,
              held: state.held.map((remote) => remote.sameAsLocal ? { ...remote, sameAsLocal: false } : remote),
            },
            effects: [],
          };
        case "conflict":
          return ignore(state);
      }
      break;
    }

    case "save_started": {
      if (state.phase === "loading") return reject(state, "cannot save while the film loads");
      if (state.phase === "saving") return reject(state, "a save is already in flight");
      if (state.phase === "conflict") return reject(state, "resolve the conflict before saving");
      return {
        state: { phase: "saving", seq: event.seq, editedWhileSaving: false, held: [], ...known(state) },
        effects: [],
      };
    }

    case "save_succeeded": {
      if (state.phase !== "saving") return reject(state, "no save is in flight");
      if (state.seq !== event.seq) return reject(state, "this is not the save in flight");
      const settled: SyncState<F> = state.editedWhileSaving
        ? { phase: "dirty", failed: false, rev: event.rev, order: event.order, ownRev: event.rev }
        : { phase: "clean", rev: event.rev, order: event.order, ownRev: event.rev };
      return replayHeld({ state: settled, effects: [] }, state.held);
    }

    case "save_failed": {
      if (state.phase !== "saving") return reject(state, "no save is in flight");
      if (state.seq !== event.seq) return reject(state, "this is not the save in flight");
      const settled: SyncState<F> = { phase: "dirty", failed: true, ...known(state) };
      return replayHeld({ state: settled, effects: [] }, state.held);
    }

    case "save_conflicted": {
      if (state.phase !== "saving") return reject(state, "no save is in flight");
      if (state.seq !== event.seq) return reject(state, "this is not the save in flight");
      // The newest version of the film on disk is the one to keep beside the studio's own.
      const newest = state.held.reduce((latest, update) => update.order > latest.order ? update : latest, event.remote);
      if (newest.sameAsLocal) {
        // Someone wrote the same content: there is nothing to choose, so base the next save on the disk revision.
        return {
          state: { phase: "dirty", failed: false, rev: newest.rev, order: newest.order, ownRev: state.ownRev },
          effects: [{ kind: "absorb", film: newest.film }],
        };
      }
      return {
        state: { phase: "conflict", rev: state.rev, order: newest.order, ownRev: state.ownRev, remote: newest },
        effects: [{ kind: "conflict", remote: newest, reason: "saving" }],
      };
    }

    case "external_update":
      return applyExternal(state, event.remote);

    case "keep_mine": {
      if (state.phase !== "conflict") return reject(state, "there is no conflict to resolve");
      // The studio's film stays; the next save is based on what is now on disk, so it replaces it on purpose.
      return { state: { phase: "dirty", failed: false, rev: state.remote.rev, order: state.remote.order, ownRev: state.ownRev }, effects: [] };
    }

    case "take_theirs": {
      if (state.phase !== "conflict") return reject(state, "there is no conflict to resolve");
      return {
        state: { phase: "clean", rev: state.remote.rev, order: state.remote.order, ownRev: state.ownRev },
        effects: [{ kind: "adopt", film: state.remote.film, rev: state.remote.rev, source: "resolved" }],
      };
    }
  }
  return reject(state, "unknown event");
}
