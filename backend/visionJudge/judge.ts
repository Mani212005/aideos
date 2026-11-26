/**
 * File Description: The vision judge for a designed scene film.
 * One unified loop with no Gemini step. Stills are sampled and rendered once (sampler.ts). The
 * connected coding model, in one round, critiques each sample against the narration with its own
 * opinions and concrete suggestions, repairs the design, and scores each still against the intent
 * text (agentReview.ts). Those scores are logged per frame with their threshold. Jev, which only
 * ever sees text, is the final judge: it rules on each frame (Match, WrongData, LayoutDefect,
 * Unreadable) and rates each suggestion (accept, accept-with-change, reject). A film is only ever
 * written by a passing design build (design check plus honesty check), never by this module; a
 * failed sample is returned with its exact error so synthesis can repair it. When image reviews
 * and embeddings are absent, the vision judge skips cleanly without evaluating text alone.
 * Inputs and outputs: film slug, scene definition, and narration -> visual critique findings and repaired scene.
 * Used by: backend/designSpec/designer.ts.
 */

import { environment } from "../env";

import fs from "node:fs";
import path from "node:path";
import { dispatchTask } from "../agentBridge/dispatcher";
import type { DispatchResult } from "../agentBridge/types";
import { readFilm } from "../pipeline/filmStore";
import {
  DEFAULT_EMBEDDING_THRESHOLD,
  judgeFrameVerdicts,
  type FrameVerdictState,
} from "../jev";
import { appendEmbeddingLog, judgeDir, readAgentReview, type EmbeddingLogEntry, type SampleReview } from "./agentReview";
import type { JudgeOptions, JudgeResult, JudgedSample, JudgeFailure, RepairFn } from "./types";
import { clampStride, renderSamples, type SampleStill } from "./sampler";

// True when the dispatch actually reached a listening agent (the queue and task file alone mean nobody is).
function reachedAgent(dispatch: DispatchResult): boolean {
  return dispatch.channels.some((c) => c === "agent_link" || c === "tmux" || c === "firstmate_inbox");
}

// Writes the manifest that lists every sampled still for the agent (and for the record).
function writeManifest(filmId: string, samples: SampleStill[], stride: number): void {
  fs.mkdirSync(judgeDir(filmId), { recursive: true });
  const manifest = samples.map((s) => ({
    frame: s.frame,
    timeSec: s.timeSec,
    shotId: s.shotId,
    narration: s.narration,
    onscreen: s.onscreen,
    still: path.relative(path.resolve(__dirname, "../.."), s.png),
  }));
  fs.writeFileSync(path.join(judgeDir(filmId), "manifest.json"), JSON.stringify({ stride, samples: manifest }, null, 2) + "\n");
}

// Runs the agent round: sends the stills task and waits for the review, or reports why there is none.
async function agentRound(
  filmId: string,
  samples: SampleStill[],
  stride: number,
  options: JudgeOptions,
  instruction?: string,
): Promise<{ round: JudgeResult["agentRound"]; reviews: SampleReview[] }> {
  if (options.skipAgent ?? Boolean(environment.NODE_TEST_CONTEXT)) return { round: "skipped", reviews: [] };
  const requestedAt = new Date().toISOString();
  const dispatch = await (options.dispatch ?? dispatchTask)({
    eventType: "frame_review",
    filmId,
    enableFallback: false,
    ...(instruction ? { customInstruction: instruction } : {}),
    metadata: { stride, sampleCount: samples.length, stills: samples.map((s) => s.png) },
    ...(options.ownerKey ? { ownerKey: options.ownerKey } : {}),
  });
  if (!reachedAgent(dispatch)) {
    return { round: "no-agent", reviews: [] };
  }
  options.onProgress?.(`frame review sent to the coding agent (${dispatch.channels.join(", ")}); waiting for its report`);
  const deadline = Date.now() + (options.agentTimeoutMs ?? 20 * 60 * 1000);
  while (Date.now() < deadline) {
    const review = readAgentReview(filmId, requestedAt);
    if (review) return { round: "reported", reviews: review.samples };
    await new Promise((r) => setTimeout(r, options.pollMs ?? 5000));
  }
  options.onProgress?.("the coding agent did not report on the frames in time");
  return { round: "timed-out", reviews: [] };
}

// Builds the exact error text a failed sample hands back to synthesis.
export function describeFailure(sample: JudgedSample, narration: string): string {
  const parts = [`frame ${sample.frame} (shot ${sample.shotId}) was ruled ${sample.verdict}`, `narration: "${narration}"`];
  if (sample.embedding.score !== null) {
    parts.push(`image-text score ${sample.embedding.score.toFixed(2)} against threshold ${sample.embedding.threshold.toFixed(2)}`);
  }
  if (sample.note) parts.push(`the coding model said: ${sample.note}`);
  const kept = sample.suggestions.map((text, j) => ({ text, rating: sample.suggestionVerdicts[j] })).filter((k) => k.rating !== "reject");
  if (kept.length) {
    parts.push("apply: " + kept.map((k) => (k.rating === "accept-with-change" ? `${k.text} (adjust it to fit this frame first)` : k.text)).join("; "));
  }
  return parts.join(" | ");
}

// Judges one scene film: sample, agent round, embedding scores, then Jev's rulings.
export async function judgeFilm(filmId: string, options: JudgeOptions = {}, instruction?: string): Promise<JudgeResult> {
  const threshold = options.threshold ?? DEFAULT_EMBEDDING_THRESHOLD;
  const stride = clampStride(options.stride);
  const empty = (skipped: string, agentRound: JudgeResult["agentRound"] = "skipped"): JudgeResult => ({ filmId, skipped, agentRound, samples: [], failures: [], passed: null });
  const before = readFilm(filmId);
  if (!before?.scene) return empty("the film has no scene to sample stills from");

  let samples: SampleStill[];
  try {
    samples = renderSamples(filmId, before, { ...options, stride });
  } catch (err) {
    // Missing rasterizer or a broken scene must never fail a film that already passed its design check.
    return empty(err instanceof Error ? err.message : String(err));
  }
  writeManifest(filmId, samples, stride);

  const filmBefore = JSON.stringify(before);
  const { round, reviews } = await agentRound(filmId, samples, stride, options, instruction);
  if (reviews.length === 0 && !options.embed) {
    const reason =
      round === "timed-out"
        ? "the coding agent did not report on the frames in time"
        : round === "no-agent"
          ? "no image-capable agent is connected"
          : "agent review was skipped and no image embedder was provided";
    const message = `vision judge skipped: ${reason}`;
    options.onProgress?.(message);
    return empty(reason);
  }
  if (!options.embed) {
    const reviewedFrames = new Set(reviews.map((review) => review.frame));
    const missingFrames = samples.filter((sample) => !reviewedFrames.has(sample.frame)).map((sample) => sample.frame);
    if (missingFrames.length > 0) {
      const reason = `the coding agent did not review sampled frames ${missingFrames.join(", ")}`;
      options.onProgress?.(`vision judge skipped: ${reason}`);
      return empty(reason, round);
    }
  }
  options.onProgress?.(`rendered ${samples.length} review stills (every ${stride} frames)`);
  // The agent repairs in the same round, so what it looked at may have changed: restill the final film.
  const after = readFilm(filmId);
  if (round === "reported" && after && JSON.stringify(after) !== filmBefore) {
    samples = renderSamples(filmId, after, { ...options, stride });
    writeManifest(filmId, samples, stride);
    options.onProgress?.("the agent changed the design in its round; restilled the final film");
  }

  const reviewByFrame = new Map(reviews.map((r) => [r.frame, r]));
  const embeds: EmbeddingLogEntry[] = [];
  const states: FrameVerdictState[] = [];
  for (const sample of samples) {
    const review = reviewByFrame.get(sample.frame);
    let score: number | null = null;
    let source: EmbeddingLogEntry["source"] = "none";
    if (options.embed) {
      score = await options.embed(sample.png, sample.narration);
      source = "injected";
    } else if (typeof review?.similarity === "number") {
      score = review.similarity;
      source = "agent";
    }
    embeds.push({ at: new Date().toISOString(), frame: sample.frame, shotId: sample.shotId, score, threshold, pass: score === null ? null : score >= threshold, source });
    states.push({
      frame: sample.frame,
      shotId: sample.shotId,
      narration: sample.narration,
      onscreen: sample.onscreen,
      note: review?.note ?? "",
      suggestions: review?.suggestions ?? [],
      embeddingScore: score,
      embeddingThreshold: threshold,
      ...(review?.repaired ? { repaired: true } : {}),
    });
  }
  appendEmbeddingLog(filmId, embeds);

  const rulings = await judgeFrameVerdicts(states, options.jevOptions);
  const judged: JudgedSample[] = samples.map((sample, i) => ({
    frame: sample.frame,
    shotId: sample.shotId,
    png: sample.png,
    embedding: { score: embeds[i].score, threshold, pass: embeds[i].pass, source: embeds[i].source },
    note: states[i].note ?? "",
    suggestions: states[i].suggestions ?? [],
    repaired: Boolean(states[i].repaired),
    verdict: rulings[i].verdict,
    verdictSource: rulings[i].source,
    suggestionVerdicts: rulings[i].suggestionVerdicts,
  }));
  const failures: JudgeFailure[] = judged
    .map((s, i) => ({ s, narration: samples[i].narration }))
    .filter(({ s }) => s.verdict !== "Match")
    .map(({ s, narration }) => ({ frame: s.frame, shotId: s.shotId, verdict: s.verdict, error: describeFailure(s, narration) }));

  const result: JudgeResult = { filmId, agentRound: round, samples: judged, failures, passed: failures.length === 0 };
  fs.writeFileSync(path.join(judgeDir(filmId), "verdicts.json"), JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2) + "\n");
  return result;
}

// Judges a film and, while samples fail, hands each exact error back to synthesis for a bounded number of rounds.
export async function judgeAndRepair(
  filmId: string,
  options: JudgeOptions & { repair?: RepairFn; maxRepairRounds?: number } = {},
): Promise<JudgeResult> {
  let result = await judgeFilm(filmId, options);
  const rounds = options.maxRepairRounds ?? 2;
  for (let round = 1; result.passed === false && options.repair && round <= rounds; round++) {
    options.onProgress?.(`${result.failures.length} frame(s) failed the vision judge; repair round ${round}/${rounds}`);
    const errors = result.failures.map((f) => f.error).join("\n");
    if (!(await options.repair(errors))) break;
    result = await judgeFilm(filmId, options);
  }
  return result;
}
