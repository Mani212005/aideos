/**
 * File Description: Behavioural tests for the default music selector: a calm bed with room for the voice beats a competing one, swells only count inside the part of the track that plays, energy follows story position and pace, vocals and reuse are avoided, and ties are broken by the seed alone.
 * Inputs and outputs: fixture music items with profiles -> ranking and pick assertions (no audio, no ffmpeg, no network).
 * Used by: npm test (backend/**\/*.test.ts glob).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { AudioItem } from "./audioLibrary/schema";
import { hasVocals, pickMusic, rankMusic, targetEnergy, type MusicAct, type MusicCandidate } from "./musicSelector";

// Builds a hash-shaped music item; every field the selector does not read stays fixed.
function bed(id: string, extra: Partial<AudioItem> = {}): AudioItem {
  return {
    id, kind: "music", title: id, artist: "fixture", source: "fixture", url: null,
    licence: { id: "fixture", url: "https://example.com/", attribution: null, checkedAt: "2026-11-22" },
    sha256: "0".repeat(64), bytes: 1, durationSec: 240, loudness: { integratedLufs: -16, truePeakDb: -3, lra: 3 },
    roles: ["hook", "explain", "payoff", "reel"], moods: [], energy: 2, contentIdRisk: "none", ...extra,
  };
}

// Pairs an item with the part of the track a 60 s section would play from the start.
function from(item: AudioItem, startSec = 0): MusicCandidate {
  return { item, window: { startSec, endSec: startSec + 60 } };
}

const EXPLAIN: MusicAct = { role: "explain", meanShotSec: 12 };

test("a bed with room for the voice beats one that fills the speech band, at equal energy", () => {
  const crowded = bed("crowded", { profile: { midrangeDb: -2.5, swells: [] } });
  const roomy = bed("roomy", { profile: { midrangeDb: -11, swells: [] } });
  assert.equal(rankMusic(EXPLAIN, [from(crowded), from(roomy)])[0].item.id, "roomy");
});

test("a swell counts only when it falls inside the part of the track that plays", () => {
  const swelling = bed("swelling", { profile: { midrangeDb: -9, swells: [{ startSec: 100, endSec: 106, riseDb: 14 }] } });
  const steady = bed("steady", { profile: { midrangeDb: -9, swells: [] } });
  assert.equal(rankMusic(EXPLAIN, [from(swelling, 0), from(steady, 0)])[0].parts.swell, 0, "the swell at 100 s is not in 0 to 60 s");
  const played = rankMusic(EXPLAIN, [from(swelling, 70), from(steady, 70)]);
  assert.equal(played[0].item.id, "steady", "the swell at 100 s is inside 70 to 130 s");
  assert.ok(played[1].parts.swell > 0);
});

test("a bigger swell costs more than a smaller one", () => {
  const small = bed("small", { profile: { midrangeDb: -9, swells: [{ startSec: 10, endSec: 14, riseDb: 6 }] } });
  const big = bed("big", { profile: { midrangeDb: -9, swells: [{ startSec: 10, endSec: 14, riseDb: 15 }] } });
  assert.deepEqual(rankMusic(EXPLAIN, [from(big), from(small)]).map((entry) => entry.item.id), ["small", "big"]);
});

test("explanation wants a calmer bed than the hook, and a fast cut asks for one more step of energy", () => {
  const calm = bed("calm", { energy: 1 });
  const lively = bed("lively", { energy: 4 });
  assert.equal(rankMusic({ role: "explain", meanShotSec: 12 }, [from(lively), from(calm)])[0].item.id, "calm");
  assert.equal(rankMusic({ role: "hook", meanShotSec: 12 }, [from(calm), from(lively)])[0].item.id, "lively");
  assert.ok(targetEnergy({ role: "explain", meanShotSec: 5 }) > targetEnergy({ role: "explain", meanShotSec: 12 }));
  assert.ok(targetEnergy({ role: "explain", meanShotSec: 20 }) < targetEnergy({ role: "explain", meanShotSec: 12 }));
});

test("a mood the story position prefers breaks a near tie", () => {
  const plain = bed("plain", { moods: ["Corporate Music"] });
  const fitting = bed("fitting", { moods: ["Atmospheric", "Ambient"] });
  assert.equal(rankMusic(EXPLAIN, [from(plain), from(fitting)])[0].item.id, "fitting");
});

test("a bed with vocals is chosen only when nothing else is eligible", () => {
  const sung = bed("sung", { instrumental: false, profile: { midrangeDb: -12, swells: [] } });
  const tagged = bed("tagged", { moods: ["Vocals", "Pop"], profile: { midrangeDb: -12, swells: [] } });
  const drone = bed("drone", { profile: { midrangeDb: -3, swells: [] }, energy: 4 });
  assert.ok(hasVocals(sung) && hasVocals(tagged) && !hasVocals(drone));
  assert.equal(rankMusic(EXPLAIN, [from(sung), from(tagged), from(drone)])[0].item.id, "drone");
  assert.equal(rankMusic(EXPLAIN, [from(sung)])[0].item.id, "sung");
});

test("a bed already used in the film loses to a similar one, but not to a much worse one", () => {
  const used = new Set(["first"]);
  const first = bed("first", { profile: { midrangeDb: -10, swells: [] } });
  const similar = bed("similar", { profile: { midrangeDb: -9, swells: [] } });
  const awful = bed("awful", { profile: { midrangeDb: -1, swells: [{ startSec: 5, endSec: 9, riseDb: 20 }] } });
  assert.equal(rankMusic(EXPLAIN, [from(first), from(similar)], used)[0].item.id, "similar");
  assert.equal(rankMusic(EXPLAIN, [from(first), from(awful)], used)[0].item.id, "first");
});

test("an unmeasured bed is neutral, and equal beds are decided by the seed in id order, never by input order", () => {
  const a = bed("a");
  const b = bed("b");
  const c = bed("c");
  const forward = rankMusic(EXPLAIN, [from(a), from(b), from(c)]);
  const backward = rankMusic(EXPLAIN, [from(c), from(b), from(a)]);
  assert.deepEqual(forward.map((entry) => entry.item.id), ["a", "b", "c"]);
  assert.deepEqual(backward.map((entry) => entry.item.id), ["a", "b", "c"]);
  assert.deepEqual([0, 1, 2, 3, 4].map((seed) => pickMusic(forward, seed).item.id), ["a", "b", "c", "a", "b"]);
});

test("the seed never lifts a clearly worse bed above the best one", () => {
  const best = bed("best", { profile: { midrangeDb: -12, swells: [] } });
  const worse = bed("worse", { profile: { midrangeDb: -3, swells: [] } });
  const ranked = rankMusic(EXPLAIN, [from(worse), from(best)]);
  for (const seed of [0, 1, 2, 3, 4294967295]) assert.equal(pickMusic(ranked, seed).item.id, "best");
  assert.throws(() => pickMusic([], 0), /at least one/);
});

// Deterministic generator (mulberry32) so a failing case reproduces from its index.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("property: over 300 generated libraries the ranking ignores input order, the pick is never costlier than the best plus the tie width, and a swell never makes a bed cheaper", () => {
  const roles = ["hook", "explain", "payoff", "reel"];
  for (let c = 0; c < 300; c++) {
    const next = random(1000 + c);
    const act: MusicAct = { role: roles[Math.floor(next() * roles.length)], meanShotSec: next() < 0.2 ? null : 3 + next() * 20 };
    const used = new Set(next() < 0.5 ? ["bed-0"] : []);
    const candidates = Array.from({ length: 1 + Math.floor(next() * 8) }, (_, i) => from(bed(`bed-${i}`, {
      energy: 1 + Math.floor(next() * 5),
      moods: next() < 0.5 ? ["Atmospheric", "Positive"] : ["Corporate Music"],
      profile: { midrangeDb: -14 + next() * 14, swells: next() < 0.5 ? [] : [{ startSec: next() * 120, endSec: 130, riseDb: 5 + next() * 15 }] },
    }), next() * 100));
    const ranked = rankMusic(act, candidates, used);
    assert.deepEqual(rankMusic(act, [...candidates].reverse(), used).map((entry) => entry.item.id), ranked.map((entry) => entry.item.id), `case ${c}: input order`);
    assert.ok(ranked.every((entry, i) => i === 0 || ranked[i - 1].cost <= entry.cost), `case ${c}: sorted`);
    for (const seed of [0, 1, 7, 4294967295]) assert.ok(pickMusic(ranked, seed).cost - ranked[0].cost <= 0.25, `case ${c}: pick within the tie width`);
    const base = candidates[0];
    const swollen = { ...base, item: { ...base.item, profile: { midrangeDb: base.item.profile!.midrangeDb, swells: [...base.item.profile!.swells, { startSec: base.window.startSec, endSec: base.window.endSec, riseDb: 12 }] } } };
    assert.ok(rankMusic(act, [swollen], used)[0].cost >= rankMusic(act, [base], used)[0].cost, `case ${c}: an added swell never lowers the cost`);
  }
});
