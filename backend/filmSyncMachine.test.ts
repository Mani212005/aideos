/**
 * File Description: Behavioural tests for the editor film sync state machine and the film revision rule
 * (M7): states, transitions, own-echo recognition, conflict handling with both versions kept, ordered
 * saves, input refused while loading and impossible transitions, driven through the public functions.
 * Inputs and outputs: synthetic events over short synthetic films -> asserted states, effects and decisions.
 * Used by: npm test (node --test glob over backend/**).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  baseRevision,
  hasUnsavedEdits,
  initialSyncState,
  transition,
  type RemoteFilm,
  type SyncEvent,
  type SyncState,
} from "../editor/src/state/filmSyncMachine";
import { decideSave, filmRevision, revisionOfFilm } from "./filmRevision";

type F = { id: string; n: number };

/** Run a list of events in order and return the final state, asserting none of them was rejected. */
function run(events: SyncEvent<F>[], from: SyncState<F> = initialSyncState<F>()): SyncState<F> {
  let state = from;
  for (const event of events) {
    const result = transition(state, event);
    assert.equal(result.rejected, undefined, `${event.type} was rejected: ${result.rejected}`);
    state = result.state;
  }
  return state;
}

/** A remote version of the synthetic film with a revision. */
function remote(rev: string | null, n: number, sameAsLocal = false): RemoteFilm<F> {
  return { rev, film: { id: "demo", n }, sameAsLocal };
}

const loaded = (rev: string | null = "r1") =>
  run([{ type: "load_started", seq: 1 }, { type: "loaded", seq: 1, rev }]);

test("a studio starts loading and a load settles it clean at the loaded revision", () => {
  const start = initialSyncState<F>();
  assert.equal(start.phase, "loading");
  const state = loaded("r1");
  assert.deepEqual(state, { phase: "clean", rev: "r1", ownRev: null });
  assert.equal(baseRevision(state), "r1");
  assert.equal(baseRevision(start), null);
});

test("input is refused while loading, for every kind of edit and for saving", () => {
  const loading = initialSyncState<F>();
  const edited = transition(loading, { type: "edited" });
  assert.match(edited.rejected ?? "", /disabled while the film loads/);
  assert.equal(edited.state, loading);
  assert.match(transition(loading, { type: "save_started", seq: 1 }).rejected ?? "", /loads/);
});

test("an edit makes the film dirty, a save started from dirty is saving, and success settles clean on the new revision", () => {
  let state = run([{ type: "edited" }], loaded("r1"));
  assert.equal(state.phase, "dirty");
  assert.equal(hasUnsavedEdits(state), true);
  state = run([{ type: "save_started", seq: 1 }], state);
  assert.equal(state.phase, "saving");
  state = run([{ type: "save_succeeded", seq: 1, rev: "r2" }], state);
  assert.deepEqual(state, { phase: "clean", rev: "r2", ownRev: "r2" });
  assert.equal(hasUnsavedEdits(state), false);
});

test("saves are serialized: a second save cannot start while one is in flight, and an old result cannot settle a newer save", () => {
  const saving = run([{ type: "edited" }, { type: "save_started", seq: 1 }], loaded("r1"));
  const second = transition(saving, { type: "save_started", seq: 2 });
  assert.match(second.rejected ?? "", /already in flight/);
  assert.equal(second.state, saving);

  const stale = transition(saving, { type: "save_succeeded", seq: 99, rev: "rX" });
  assert.match(stale.rejected ?? "", /not the save in flight/);
  assert.equal(stale.state, saving);
});

test("an edit made while a save is in flight leaves the film dirty on the saved revision, ready for the next save", () => {
  let state = run([{ type: "edited" }, { type: "save_started", seq: 1 }, { type: "edited" }], loaded("r1"));
  assert.equal(hasUnsavedEdits(state), true);
  state = run([{ type: "save_succeeded", seq: 1, rev: "r2" }], state);
  assert.deepEqual(state, { phase: "dirty", failed: false, rev: "r2", ownRev: "r2" });
});

test("a failed save keeps the film dirty on the same base and is not retried until the next edit", () => {
  let state = run([{ type: "edited" }, { type: "save_started", seq: 1 }, { type: "save_failed", seq: 1 }], loaded("r1"));
  assert.deepEqual(state, { phase: "dirty", failed: true, rev: "r1", ownRev: null });
  state = run([{ type: "edited" }], state);
  assert.deepEqual(state, { phase: "dirty", failed: false, rev: "r1", ownRev: null });
});

test("a stale save enters conflict with the disk version kept beside the studio's, and autosave cannot start", () => {
  const saving = run([{ type: "edited" }, { type: "save_started", seq: 1 }], loaded("r1"));
  const result = transition(saving, { type: "save_conflicted", seq: 1, remote: remote("r9", 9) });
  assert.equal(result.state.phase, "conflict");
  assert.deepEqual(result.effects, [{ kind: "conflict", remote: remote("r9", 9), reason: "saving" }]);
  assert.equal(hasUnsavedEdits(result.state), true);
  assert.match(transition(result.state, { type: "save_started", seq: 2 }).rejected ?? "", /conflict/);
  // Edits during a conflict are kept (the studio's film keeps changing) and the conflict stays.
  assert.equal(transition(result.state, { type: "edited" }).state.phase, "conflict");
});

test("a conflicted save whose disk version has the same content as the studio's needs no choice", () => {
  const saving = run([{ type: "edited" }, { type: "save_started", seq: 1 }], loaded("r1"));
  const result = transition(saving, { type: "save_conflicted", seq: 1, remote: remote("r9", 1, true) });
  assert.deepEqual(result.state, { phase: "dirty", failed: false, rev: "r9", ownRev: null });
  assert.deepEqual(result.effects, []);
});

test("keep mine bases the next save on the disk revision; use theirs adopts the disk film as clean", () => {
  const conflict = run(
    [{ type: "edited" }, { type: "save_started", seq: 1 }, { type: "save_conflicted", seq: 1, remote: remote("r9", 9) }],
    loaded("r1"),
  );
  const mine = transition(conflict, { type: "keep_mine" });
  assert.deepEqual(mine.state, { phase: "dirty", failed: false, rev: "r9", ownRev: null });
  assert.deepEqual(mine.effects, []);

  const theirs = transition(conflict, { type: "take_theirs" });
  assert.deepEqual(theirs.state, { phase: "clean", rev: "r9", ownRev: null });
  assert.deepEqual(theirs.effects, [{ kind: "adopt", film: { id: "demo", n: 9 }, rev: "r9", source: "resolved" }]);
});

test("resolving a conflict that does not exist is an impossible transition", () => {
  const clean = loaded("r1");
  for (const type of ["keep_mine", "take_theirs"] as const) {
    const result = transition(clean, { type });
    assert.match(result.rejected ?? "", /no conflict/);
    assert.equal(result.state, clean);
  }
});

test("another writer's film is adopted when the studio is clean and becomes a conflict when the studio has edits", () => {
  const adopted = transition(loaded("r1"), { type: "external_update", remote: remote("r2", 2) });
  assert.deepEqual(adopted.state, { phase: "clean", rev: "r2", ownRev: null });
  assert.deepEqual(adopted.effects, [{ kind: "adopt", film: { id: "demo", n: 2 }, rev: "r2", source: "live" }]);

  // An agent's design lands while the studio holds an unsaved edit: the edit must not be autosaved over it.
  const dirty = run([{ type: "edited" }], loaded("r1"));
  const clash = transition(dirty, { type: "external_update", remote: remote("r2", 2) });
  assert.equal(clash.state.phase, "conflict");
  assert.deepEqual(clash.effects, [{ kind: "conflict", remote: remote("r2", 2), reason: "editing" }]);
});

test("the studio's own write coming back over the event stream is absorbed, never treated as another writer", () => {
  const saved = run([{ type: "edited" }, { type: "save_started", seq: 1 }, { type: "save_succeeded", seq: 1, rev: "r2" }], loaded("r1"));
  // The studio has already made a newer edit when its own echo arrives.
  const editing = run([{ type: "edited" }], saved);
  const echo = transition(editing, { type: "external_update", remote: remote("r2", 2) });
  assert.equal(echo.state, editing);
  assert.deepEqual(echo.effects, [{ kind: "absorb", film: { id: "demo", n: 2 } }]);
});

test("an event with the revision the studio already has is ignored", () => {
  const clean = loaded("r1");
  const result = transition(clean, { type: "external_update", remote: remote("r1", 1) });
  assert.equal(result.state, clean);
  assert.deepEqual(result.effects, []);
});

test("an event that arrives during a save is held, and its own echo is absorbed once the save settles", () => {
  const saving = run([{ type: "edited" }, { type: "save_started", seq: 1 }], loaded("r1"));
  const held = transition(saving, { type: "external_update", remote: remote("r2", 2) });
  assert.equal(held.state.phase, "saving");
  assert.deepEqual(held.effects, []);

  const settled = transition(held.state, { type: "save_succeeded", seq: 1, rev: "r2" });
  assert.deepEqual(settled.state, { phase: "clean", rev: "r2", ownRev: "r2" });
  assert.deepEqual(settled.effects, [{ kind: "absorb", film: { id: "demo", n: 2 } }]);
});

test("a foreign event held during a save is replayed after it: it conflicts with the edit the studio made meanwhile", () => {
  let state = run([{ type: "edited" }, { type: "save_started", seq: 1 }], loaded("r1"));
  state = transition(state, { type: "external_update", remote: remote("r5", 5) }).state;
  state = run([{ type: "edited" }], state);
  const settled = transition(state, { type: "save_succeeded", seq: 1, rev: "r2" });
  assert.equal(settled.state.phase, "conflict");
  assert.equal(settled.effects.some((e) => e.kind === "conflict"), true);
});

test("a disk version with the same content as the studio's just moves the revision forward", () => {
  const dirty = run([{ type: "edited" }], loaded("r1"));
  const result = transition(dirty, { type: "external_update", remote: remote("r2", 1, true) });
  assert.deepEqual(result.state, { phase: "clean", rev: "r2", ownRev: null });
  assert.deepEqual(result.effects, []);
});

test("an event during loading is ignored: the load reads the newest film itself", () => {
  const loading = initialSyncState<F>();
  const result = transition(loading, { type: "external_update", remote: remote("r2", 2) });
  assert.equal(result.state, loading);
  assert.deepEqual(result.effects, []);
  assert.equal(result.rejected, undefined);
});

test("leaving a film with unsaved edits, a save in flight or a conflict is refused, so a project switch cannot drop an edit", () => {
  const dirty = run([{ type: "edited" }], loaded("r1"));
  assert.match(transition(dirty, { type: "load_started", seq: 2 }).rejected ?? "", /unsaved/);
  const saving = run([{ type: "save_started", seq: 1 }], loaded("r1"));
  assert.match(transition(saving, { type: "load_started", seq: 2 }).rejected ?? "", /in flight/);
  const conflict = run([{ type: "edited" }, { type: "external_update", remote: remote("r2", 2) }], loaded("r1"));
  assert.match(transition(conflict, { type: "load_started", seq: 2 }).rejected ?? "", /conflict/);
});

test("a superseded load cannot settle the studio, and a failed load returns to the film that was open", () => {
  const loading = run([{ type: "load_started", seq: 2 }], loaded("r1"));
  const old = transition(loading, { type: "loaded", seq: 1, rev: "rOld" });
  assert.match(old.rejected ?? "", /superseded/);
  assert.equal(old.state, loading);
  assert.deepEqual(transition(loading, { type: "load_failed", seq: 2 }).state, { phase: "clean", rev: "r1", ownRev: null });
  assert.match(transition(loaded("r1"), { type: "loaded", seq: 1, rev: "r2" }).rejected ?? "", /no load/);
});

test("a save result with no save in flight is an impossible transition", () => {
  const clean = loaded("r1");
  for (const event of [
    { type: "save_succeeded", seq: 1, rev: "r2" },
    { type: "save_failed", seq: 1 },
    { type: "save_conflicted", seq: 1, remote: remote("r2", 2) },
  ] as SyncEvent<F>[]) {
    const result = transition(clean, event);
    assert.match(result.rejected ?? "", /no save is in flight/);
    assert.equal(result.state, clean);
  }
});

test("the revision is the hash of the film.json bytes, so any writer produces one and identical bytes agree", () => {
  const film = { id: "demo", n: 1 };
  assert.equal(revisionOfFilm(film), filmRevision(JSON.stringify(film, null, 2)));
  assert.notEqual(revisionOfFilm(film), revisionOfFilm({ id: "demo", n: 2 }));
  assert.match(revisionOfFilm(film), /^[0-9a-f]{16}$/);
});

test("the save endpoint rule: a save from the revision on disk writes, a stale one is refused, and an unconditional one writes", () => {
  assert.equal(decideSave("r1", "r1"), "write");
  assert.equal(decideSave("r1", "r2"), "stale");
  assert.equal(decideSave(undefined, "r2"), "write");
  assert.equal(decideSave(null, "r2"), "write");
  assert.equal(decideSave("r1", null), "write");
});
