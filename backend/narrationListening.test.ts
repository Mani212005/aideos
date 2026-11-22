/**
 * File Description: Behaviour tests for the blind A/B listening-set format. They prove the set is blind (no
 * system name, order or path in the listener manifest gives the pair away), reproducible from its seed, that the
 * key maps every item back to the right file, and that scoring a filled-in results file gives the documented
 * accept, reject or incomplete verdict with an exact sign test. Takes are fake file references (paths and hashes
 * only); no audio of any kind is created or read.
 * Inputs and outputs: fake paired takes and results -> manifests, keys, summaries and verdicts.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  buildListeningSet,
  LISTENING_ACCEPTANCE,
  scoreListening,
  signTestP,
  type ListeningKey,
  type ListeningResults,
  type SetSentence,
} from "./narrationListening";

const SYSTEMS = ["current", "tuned"] as const;

// Makes n fake sentences, each with one take per system; the paths carry no system name.
function sentences(n: number, withScores = false): SetSentence[] {
  return Array.from({ length: n }, (_, i) => {
    const id = `s${String(i + 1).padStart(3, "0")}`;
    const hash = (label: string) => createHash("sha256").update(`${id}${label}`).digest("hex");
    return {
      id,
      text: `Sentence number ${i + 1}.`,
      takes: {
        current: { audioPath: `clips/${id}-p.wav`, sha256: hash("p"), ...(withScores ? { score: 0.4 } : {}) },
        tuned: { audioPath: `clips/${id}-q.wav`, sha256: hash("q"), ...(withScores ? { score: 0.8 } : {}) },
      },
    };
  });
}

// Answers every item so that the candidate (tuned) wins `candidateWins` items and the baseline the rest.
function answer(key: ListeningKey, results: ListeningResults, candidateWins: number, ratings?: { current: number; tuned: number }): ListeningResults {
  let won = 0;
  const items = results.items.map((item, index) => {
    const k = key.items[index];
    const candidateSide = k.a === "tuned" ? "a" : "b";
    const baselineSide = candidateSide === "a" ? "b" : "a";
    const candidateWins_ = won < candidateWins;
    if (candidateWins_) won += 1;
    return {
      ...item,
      preferred: (candidateWins_ ? candidateSide : baselineSide) as "a" | "b",
      naturalness: ratings
        ? ({ [candidateSide]: ratings.tuned, [baselineSide]: ratings.current } as { a: number; b: number })
        : { a: null, b: null },
    };
  });
  return { ...results, listener: "owner", items };
}

test("the manifest is blind: no system name, hash or score appears in it, and the same seed gives the same set", () => {
  const a = buildListeningSet({ seed: "owner-set-1", systems: SYSTEMS, sentences: sentences(20, true) });
  const again = buildListeningSet({ seed: "owner-set-1", systems: SYSTEMS, sentences: sentences(20, true) });
  assert.deepEqual(again, a);
  const other = buildListeningSet({ seed: "owner-set-2", systems: SYSTEMS, sentences: sentences(20, true) });
  assert.notDeepEqual(other.manifest.items.map((i) => i.a.audioPath), a.manifest.items.map((i) => i.a.audioPath), "another seed shuffles differently");

  const text = JSON.stringify(a.manifest);
  assert.ok(!/current|tuned|sha256|score/i.test(text), "nothing in the manifest names a system or carries a hash or score");
  assert.deepEqual(a.results.items.map((i) => i.preferred), new Array(20).fill(null), "the results template starts unanswered");
});

test("the key maps every item back to the exact files the manifest shows, and sides and order are really shuffled", () => {
  const input = sentences(200);
  const set = buildListeningSet({ seed: "balance", systems: SYSTEMS, sentences: input });
  const byPath = new Map<string, { system: string; sha: string }>();
  for (const s of input) for (const system of SYSTEMS) byPath.set(s.takes[system].audioPath, { system, sha: s.takes[system].sha256 });

  let candidateIsA = 0;
  set.manifest.items.forEach((item, index) => {
    const k = set.key.items[index];
    assert.equal(k.id, item.id);
    assert.deepEqual(byPath.get(item.a.audioPath), { system: k.a, sha: k.sha256.a });
    assert.deepEqual(byPath.get(item.b.audioPath), { system: k.b, sha: k.sha256.b });
    assert.notEqual(k.a, k.b);
    if (k.a === "tuned") candidateIsA += 1;
  });
  assert.ok(candidateIsA > 70 && candidateIsA < 130, `the candidate is A in ${candidateIsA} of 200 items, so sides are balanced`);
  const inInputOrder = set.manifest.items.every((item, i) => item.text === input[i].text);
  assert.equal(inInputOrder, false, "the items are not in the input order");
});

test("a malformed set is refused: too few sentences, a path that unblinds or escapes, a repeated id, a missing take", () => {
  const build = (s: SetSentence[]) => buildListeningSet({ seed: "x", systems: SYSTEMS, sentences: s });
  assert.throws(() => build(sentences(LISTENING_ACCEPTANCE.minItems - 1)), /at least/);

  const named = sentences(16);
  named[3].takes.tuned.audioPath = "clips/tuned-4.wav";
  assert.throws(() => build(named), /unblind/);

  for (const bad of ["/etc/voice.wav", "../up.wav", "clips/../../up.wav", "C:\\voice.wav"]) {
    const escaped = sentences(16);
    escaped[0].takes.current.audioPath = bad;
    assert.throws(() => build(escaped), /relative/, bad);
  }

  const dup = sentences(16);
  dup[5].id = dup[4].id;
  assert.throws(() => build(dup), /duplicate/);

  const missing = sentences(16);
  delete (missing[2].takes as Record<string, unknown>).tuned;
  assert.throws(() => build(missing), /exactly one take/);

  const samefile = sentences(16);
  samefile[1].takes.tuned.audioPath = samefile[1].takes.current.audioPath;
  assert.throws(() => build(samefile), /one audio file/);
});

test("the sign test is exact", () => {
  assert.ok(Math.abs(signTestP(14, 16) - 274 / 65536) < 1e-12);
  assert.equal(signTestP(8, 16), 1);
  assert.ok(Math.abs(signTestP(2, 16) - signTestP(14, 16)) < 1e-12, "two-sided: a loss of the same size has the same p");
  assert.equal(signTestP(0, 0), 1);
  assert.throws(() => signTestP(5, 4), /invalid/);
});

test("a candidate that wins clearly is accepted; a close or losing one is rejected with the reason", () => {
  const set = buildListeningSet({ seed: "verdict", systems: SYSTEMS, sentences: sentences(20) });
  const accept = scoreListening(set.key, answer(set.key, set.results, 16));
  assert.equal(accept.verdict, "accept");
  assert.deepEqual(accept.wins, { current: 4, tuned: 16 });
  assert.ok(accept.signTestP !== null && accept.signTestP < 0.05);

  const close = scoreListening(set.key, answer(set.key, set.results, 12));
  assert.equal(close.verdict, "reject");
  assert.match(close.reasons.join(" "), /won 60%/);

  const losing = scoreListening(set.key, answer(set.key, set.results, 3));
  assert.equal(losing.verdict, "reject");
});

test("ratings can overrule wins: a candidate rated below the baseline is rejected even when it was preferred", () => {
  const set = buildListeningSet({ seed: "ratings", systems: SYSTEMS, sentences: sentences(20) });
  const summary = scoreListening(set.key, answer(set.key, set.results, 18, { current: 4, tuned: 2 }));
  assert.equal(summary.verdict, "reject");
  assert.match(summary.reasons.join(" "), /mean rating/);
  assert.equal(summary.meanNaturalness.tuned, 2);
});

test("ties are not counted for or against, and an unanswered item keeps the verdict incomplete", () => {
  const set = buildListeningSet({ seed: "ties", systems: SYSTEMS, sentences: sentences(20) });
  const done = answer(set.key, set.results, 14);
  done.items[0] = { ...done.items[0], preferred: "tie" };
  const summary = scoreListening(set.key, done);
  assert.equal(summary.ties, 1);
  assert.equal(summary.wins.current + summary.wins.tuned, 19);

  const partial = { ...done, items: done.items.map((item, i) => (i === 5 ? { ...item, preferred: null } : item)) };
  const incomplete = scoreListening(set.key, partial);
  assert.equal(incomplete.verdict, "incomplete");
  assert.match(incomplete.reasons[0], /1 of 20/);
});

test("the scorer is checked against the listener: agreement counts the items where the higher score was preferred", () => {
  const set = buildListeningSet({ seed: "agree", systems: SYSTEMS, sentences: sentences(20, true) });
  // fake scores say tuned (0.8) beats current (0.4) everywhere; the listener prefers tuned in 15 of 20
  const summary = scoreListening(set.key, answer(set.key, set.results, 15));
  assert.deepEqual(summary.scorerAgreement, { agree: 15, decided: 20 });

  const unscored = buildListeningSet({ seed: "agree-none", systems: SYSTEMS, sentences: sentences(16) });
  assert.equal(scoreListening(unscored.key, answer(unscored.key, unscored.results, 10)).scorerAgreement, null, "a set without scores reports no agreement");
});

test("a results file for another set, with an unknown answer or a bad rating, is refused", () => {
  const set = buildListeningSet({ seed: "guard", systems: SYSTEMS, sentences: sentences(16) });
  const good = answer(set.key, set.results, 12);
  assert.throws(() => scoreListening(set.key, { ...good, setId: "0000000000000000" }), /does not match/);
  assert.throws(() => scoreListening(set.key, { ...good, items: good.items.map((i, n) => (n === 0 ? { ...i, preferred: "left" as "a" } : i)) }), /use "a"/);
  assert.throws(() => scoreListening(set.key, { ...good, items: good.items.map((i, n) => (n === 0 ? { ...i, naturalness: { a: 7, b: null } } : i)) }), /1 to 5/);
  assert.throws(() => scoreListening(set.key, { ...good, items: good.items.slice(1) }), /missing/);
});
