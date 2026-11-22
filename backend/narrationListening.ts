/**
 * File Description: The blind A/B listening-set format for judging whether a narrator voice sounds natural. For
 * each sentence two takes (one per voice system, for example the current voice and a tuned one) are paired; the
 * order inside every pair and of the pairs themselves is randomised from a seed so the listener cannot tell which
 * system is which. The module builds three plain JSON documents: the listener manifest (no system names), the
 * answer key (kept away from the listener until the results are in) and an empty results file for the owner to
 * fill in. It then scores a filled-in results file against the key and gives an accept or reject verdict. The
 * documents hold only relative audio paths, content hashes and text, never audio, so no recording or synthesized
 * speech can end up in the repo through them.
 * Inputs and outputs: paired takes per sentence and a seed -> manifest, key and results template; a results file and a key -> a summary and an accept, reject or incomplete verdict.
 * Used by: backend/narrationListening.test.ts, docs/NATURAL_NARRATION.md.
 */

import { createHash } from "node:crypto";

/** Schema tag of the listener manifest. */
export const LISTENING_MANIFEST_SCHEMA = "aideos.listening-manifest/1";
/** Schema tag of the answer key. */
export const LISTENING_KEY_SCHEMA = "aideos.listening-key/1";
/** Schema tag of the results file the owner fills in. */
export const LISTENING_RESULTS_SCHEMA = "aideos.listening-results/1";

/** The rule a candidate voice must meet to be accepted over the baseline. */
export const LISTENING_ACCEPTANCE = {
  /** Fewest sentences a set may have; fewer cannot reach significance. */
  minItems: 16,
  /** Share of decided (non-tie) sentences the candidate must win. */
  minDecidedWinShare: 0.65,
  /** Largest two-sided exact sign-test p-value allowed over the decided sentences. */
  maxPValue: 0.05,
} as const;

/** One take of a sentence as the caller supplies it: where its audio file is and the file's content hash. */
export interface SetTake {
  /** Audio file path relative to the listening set's folder (never absolute, never leaving it, no system name in it). */
  audioPath: string;
  /** SHA-256 of the audio file, hex; ties the manifest to the exact take that was judged. */
  sha256: string;
  /** The naturalness score the take's scorer gave it (0..1), when known; used only to check the scorer against the listener. */
  score?: number | null;
}

/** One sentence with one take per system. */
export interface SetSentence {
  id: string;
  text: string;
  /** Takes keyed by system id; must hold exactly the two systems of the set. */
  takes: Record<string, SetTake>;
}

/** Input of `buildListeningSet`. */
export interface ListeningSetInput {
  /** Any string; the same seed and input always give the same set. */
  seed: string;
  /** The two systems compared: the current voice first, the candidate second. */
  systems: readonly [string, string];
  sentences: SetSentence[];
}

/** One item the listener sees: the sentence and two unlabeled takes. */
export interface ManifestItem {
  id: string;
  text: string;
  a: { audioPath: string };
  b: { audioPath: string };
}

/** The listener manifest: no system names, only items in a randomised order. */
export interface ListeningManifest {
  schema: typeof LISTENING_MANIFEST_SCHEMA;
  setId: string;
  items: ManifestItem[];
}

/** The answer key: which system is A and which is B for every item. */
export interface ListeningKey {
  schema: typeof LISTENING_KEY_SCHEMA;
  setId: string;
  /** The current voice first, the candidate second. */
  systems: [string, string];
  items: Array<{
    id: string;
    a: string;
    b: string;
    sha256: { a: string; b: string };
    scores?: { a: number | null; b: number | null };
  }>;
}

/** What the listener says about one item. */
export interface ResultItem {
  id: string;
  /** Which take sounds more natural: "a", "b", "tie", or null for not yet answered. */
  preferred: "a" | "b" | "tie" | null;
  /** Optional 1 to 5 naturalness rating of each take (1 robotic, 5 natural). */
  naturalness: { a: number | null; b: number | null };
  notes: string;
}

/** The results file the owner fills in. */
export interface ListeningResults {
  schema: typeof LISTENING_RESULTS_SCHEMA;
  setId: string;
  listener: string;
  items: ResultItem[];
}

/** The outcome of scoring a results file. */
export interface ListeningSummary {
  total: number;
  answered: number;
  /** Items won per system id. */
  wins: Record<string, number>;
  ties: number;
  /** Mean 1 to 5 rating per system id, or null when no rating was given for it. */
  meanNaturalness: Record<string, number | null>;
  /** Two-sided exact sign-test p-value over the decided items, or null when none were decided. */
  signTestP: number | null;
  /** Share of decided items where the higher-scored take was the preferred one; null when no decided item carries both scores. */
  scorerAgreement: { agree: number; decided: number } | null;
  verdict: "accept" | "reject" | "incomplete";
  /** Plain reasons for the verdict, one per failed or unmet condition. */
  reasons: string[];
}

// Derives a 32-bit seed from a string.
function seedFrom(text: string): number {
  return createHash("sha256").update(text).digest().readUInt32LE(0);
}

// A small deterministic random generator (mulberry32) returning numbers in [0, 1).
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns a shuffled copy of the list (Fisher-Yates) using the given generator.
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Throws unless an audio path is relative, stays inside the set folder and names neither system (a path must not unblind the pair).
function assertBlindPath(audioPath: string, systems: readonly string[]): void {
  if (!audioPath || audioPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(audioPath) || audioPath.split(/[\\/]/).includes("..")) {
    throw new Error(`listening set: audio path "${audioPath}" must be relative to the set folder and must not leave it`);
  }
  const lower = audioPath.toLowerCase();
  for (const system of systems) {
    if (lower.includes(system.toLowerCase())) throw new Error(`listening set: audio path "${audioPath}" names system "${system}", which would unblind the pair`);
  }
}

/**
 * Builds the three documents of a blind A/B set. The A and B sides and the order of the items are randomised from
 * the seed; item ids follow the shuffled order so they carry no information about the input order. Throws on a
 * malformed set (wrong systems, duplicate sentence ids, a path that unblinds, fewer than the minimum items).
 */
export function buildListeningSet(input: ListeningSetInput): { manifest: ListeningManifest; key: ListeningKey; results: ListeningResults } {
  const [baseline, candidate] = input.systems;
  if (!baseline || !candidate || baseline === candidate) throw new Error("listening set: systems must be two different non-empty ids");
  if (input.sentences.length < LISTENING_ACCEPTANCE.minItems) {
    throw new Error(`listening set: needs at least ${LISTENING_ACCEPTANCE.minItems} sentences to be able to reach significance, got ${input.sentences.length}`);
  }
  const seen = new Set<string>();
  for (const sentence of input.sentences) {
    if (seen.has(sentence.id)) throw new Error(`listening set: duplicate sentence id "${sentence.id}"`);
    seen.add(sentence.id);
    const names = Object.keys(sentence.takes).sort();
    if (names.length !== 2 || !names.includes(baseline) || !names.includes(candidate)) {
      throw new Error(`listening set: sentence "${sentence.id}" must have exactly one take for "${baseline}" and one for "${candidate}"`);
    }
    for (const take of Object.values(sentence.takes)) {
      assertBlindPath(take.audioPath, input.systems);
      if (!/^[0-9a-f]{64}$/.test(take.sha256)) throw new Error(`listening set: sentence "${sentence.id}" has a take without a hex SHA-256`);
    }
    if (sentence.takes[baseline].audioPath === sentence.takes[candidate].audioPath) {
      throw new Error(`listening set: sentence "${sentence.id}" uses one audio file for both takes`);
    }
  }

  const random = mulberry32(seedFrom(input.seed));
  const order = shuffled(input.sentences, random);
  const width = Math.max(2, String(order.length).length);
  const manifestItems: ManifestItem[] = [];
  const keyItems: ListeningKey["items"] = [];
  order.forEach((sentence, index) => {
    const id = `item-${String(index + 1).padStart(width, "0")}`;
    const candidateIsA = random() < 0.5;
    const [a, b] = candidateIsA ? [candidate, baseline] : [baseline, candidate];
    manifestItems.push({ id, text: sentence.text, a: { audioPath: sentence.takes[a].audioPath }, b: { audioPath: sentence.takes[b].audioPath } });
    const scoreA = sentence.takes[a].score;
    const scoreB = sentence.takes[b].score;
    keyItems.push({
      id,
      a,
      b,
      sha256: { a: sentence.takes[a].sha256, b: sentence.takes[b].sha256 },
      ...(scoreA !== undefined || scoreB !== undefined ? { scores: { a: scoreA ?? null, b: scoreB ?? null } } : {}),
    });
  });

  const setId = createHash("sha256").update(JSON.stringify([input.seed, keyItems])).digest("hex").slice(0, 16);
  return {
    manifest: { schema: LISTENING_MANIFEST_SCHEMA, setId, items: manifestItems },
    key: { schema: LISTENING_KEY_SCHEMA, setId, systems: [baseline, candidate], items: keyItems },
    results: {
      schema: LISTENING_RESULTS_SCHEMA,
      setId,
      listener: "",
      items: manifestItems.map((item) => ({ id: item.id, preferred: null, naturalness: { a: null, b: null }, notes: "" })),
    },
  };
}

// Two-sided exact sign-test p-value for `wins` of `n` decided items under a fair coin.
export function signTestP(wins: number, n: number): number {
  if (!Number.isInteger(wins) || !Number.isInteger(n) || n < 0 || wins < 0 || wins > n) throw new Error(`signTestP: invalid wins ${wins} of ${n}`);
  if (n === 0) return 1;
  const extreme = Math.max(wins, n - wins);
  // P(X >= extreme) for X ~ Binomial(n, 1/2), summed from log-probabilities to stay exact for large n.
  let logChoose = 0;
  const logHalfN = -n * Math.LN2;
  let tail = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logChoose += Math.log(n - k + 1) - Math.log(k);
    if (k >= extreme) tail += Math.exp(logChoose + logHalfN);
  }
  return Math.min(1, 2 * tail);
}

// Throws unless a results file belongs to this key and has well-formed answers; returns its items by id.
function indexResults(key: ListeningKey, results: ListeningResults): Map<string, ResultItem> {
  if (results.schema !== LISTENING_RESULTS_SCHEMA) throw new Error(`listening results: unexpected schema "${results.schema}"`);
  if (results.setId !== key.setId) throw new Error(`listening results: set id ${results.setId} does not match the key's ${key.setId}`);
  const byId = new Map<string, ResultItem>();
  for (const item of results.items) {
    if (byId.has(item.id)) throw new Error(`listening results: item "${item.id}" appears twice`);
    if (item.preferred !== null && item.preferred !== "a" && item.preferred !== "b" && item.preferred !== "tie") {
      throw new Error(`listening results: item "${item.id}" has preferred "${String(item.preferred)}"; use "a", "b", "tie" or null`);
    }
    for (const side of ["a", "b"] as const) {
      const r = item.naturalness[side];
      if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 5)) throw new Error(`listening results: item "${item.id}" rates ${side} ${r}; use a whole number from 1 to 5 or null`);
    }
    byId.set(item.id, item);
  }
  for (const k of key.items) if (!byId.has(k.id)) throw new Error(`listening results: item "${k.id}" is missing`);
  if (byId.size !== key.items.length) throw new Error("listening results: it has items the key does not know");
  return byId;
}

/**
 * Scores a filled-in results file against its key. The verdict is "incomplete" until every item has an answer,
 * then "accept" only when the candidate wins at least the required share of decided items, the sign test is
 * significant in the candidate's favour, and its mean rating (when ratings were given) is not below the
 * baseline's; otherwise "reject". Every unmet condition is named in `reasons`.
 */
export function scoreListening(key: ListeningKey, results: ListeningResults): ListeningSummary {
  const byId = indexResults(key, results);
  const [baseline, candidate] = key.systems;
  const wins: Record<string, number> = { [baseline]: 0, [candidate]: 0 };
  const ratings: Record<string, number[]> = { [baseline]: [], [candidate]: [] };
  let ties = 0;
  let answered = 0;
  let agree = 0;
  let scoredDecided = 0;

  for (const k of key.items) {
    const r = byId.get(k.id) as ResultItem;
    if (r.naturalness.a !== null) ratings[k.a].push(r.naturalness.a);
    if (r.naturalness.b !== null) ratings[k.b].push(r.naturalness.b);
    if (r.preferred === null) continue;
    answered += 1;
    if (r.preferred === "tie") {
      ties += 1;
      continue;
    }
    const winner = r.preferred === "a" ? k.a : k.b;
    wins[winner] += 1;
    const sa = k.scores?.a;
    const sb = k.scores?.b;
    if (typeof sa === "number" && typeof sb === "number" && sa !== sb) {
      scoredDecided += 1;
      if ((sa > sb ? k.a : k.b) === winner) agree += 1;
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const meanNaturalness = { [baseline]: mean(ratings[baseline]), [candidate]: mean(ratings[candidate]) };
  const decided = wins[baseline] + wins[candidate];
  const p = decided > 0 ? signTestP(wins[candidate], decided) : null;
  const reasons: string[] = [];
  let verdict: ListeningSummary["verdict"];

  if (answered < key.items.length) {
    verdict = "incomplete";
    reasons.push(`${key.items.length - answered} of ${key.items.length} items are not answered yet`);
  } else {
    const share = decided > 0 ? wins[candidate] / decided : 0;
    if (key.items.length < LISTENING_ACCEPTANCE.minItems) reasons.push(`the set has ${key.items.length} items, fewer than the ${LISTENING_ACCEPTANCE.minItems} needed`);
    if (share < LISTENING_ACCEPTANCE.minDecidedWinShare) reasons.push(`the candidate won ${Math.round(share * 100)}% of decided items, below the required ${Math.round(LISTENING_ACCEPTANCE.minDecidedWinShare * 100)}%`);
    if (p === null || p > LISTENING_ACCEPTANCE.maxPValue || wins[candidate] <= wins[baseline]) reasons.push(`the sign test is not significant in the candidate's favour (p ${p === null ? "undefined" : p.toFixed(3)}, limit ${LISTENING_ACCEPTANCE.maxPValue})`);
    const mb = meanNaturalness[baseline];
    const mc = meanNaturalness[candidate];
    if (mb !== null && mc !== null && mc < mb) reasons.push(`the candidate's mean rating ${mc.toFixed(2)} is below the baseline's ${mb.toFixed(2)}`);
    verdict = reasons.length === 0 ? "accept" : "reject";
  }

  return {
    total: key.items.length,
    answered,
    wins,
    ties,
    meanNaturalness,
    signTestP: p,
    scorerAgreement: scoredDecided > 0 ? { agree, decided: scoredDecided } : null,
    verdict,
    reasons,
  };
}
