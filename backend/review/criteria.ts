/**
 * File Description: Turns measured facts into the rubric's criterion verdicts for `aideos review`.
 * Pure: takes the render facts (pixels and OCR), film facts, narration and audio measurements and
 * returns one CriterionResult per measurable criterion with its numbers, thresholds, evidence times
 * and the concrete fix. Thresholds come from thresholds.ts only. A criterion whose inputs are
 * missing is "skipped", never a pass: a video is not good because nothing could be measured.
 * Inputs and outputs: render facts and film facts -> CriterionResult array with thresholds and verdicts.
 * Used by: backend/review/review.ts.
 */

import type { Loudness, Silence } from "./media";
import type { RenderFacts } from "./renderFacts";
import type { FilmFacts } from "./source";
import { captionMatch, chanceNearWordStarts, cutsThroughWords, pauses, shareNearWordStarts, spokenNumbers, wordsPerMinute, type Narration } from "./speech";
import { THRESHOLDS as T } from "./thresholds";
import type { CriterionKey, CriterionResult, Evidence, VideoFacts } from "./types";

/** Everything the criteria are computed from. */
export interface ReviewInputs {
  video: VideoFacts;
  render: RenderFacts;
  film: FilmFacts | null;
  narration: Narration | null;
  loudness: Loudness | null;
  silences: Silence[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Maps a value onto 0..4 so that `bad` scores 0 and `good` scores 4 (works in either direction).
function score(value: number, bad: number, good: number): number {
  return Math.round(clamp(((value - bad) / (good - bad)) * 4, 0, 4) * 10) / 10;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Builds a skipped criterion with the reason it could not be measured.
function skipped(id: number, key: CriterionKey, name: string, gate: boolean, why: string): CriterionResult {
  return { id, key, name, gate, status: "skipped", score: null, summary: `not measured: ${why}`, metrics: {}, threshold: {}, evidence: [] };
}

// Picks up to `n` times spread across a sorted list, so evidence covers the whole film.
function spread(times: number[], n: number): number[] {
  if (times.length <= n) return times;
  return Array.from({ length: n }, (_, i) => times[Math.floor((i * (times.length - 1)) / (n - 1))]);
}

// Criterion 1: one persistent stage (gate).
function persistentStage(i: ReviewInputs): CriterionResult {
  const { render, film, video } = i;
  const p = render.persistence;
  const per30 = (render.stageClearTimes.length / Math.max(1, video.durationSec)) * 30;
  const informative = film?.boundaries.filter((b) => film.kind === "node-graph" || b.outgoing > 0) ?? [];
  const cleared = informative.filter((b) => b.outgoing === 0 || b.kept / b.outgoing < 0.5);
  const keptShare = informative.length ? 1 - cleared.length / informative.length : null;
  const metrics: CriterionResult["metrics"] = {
    layoutCorrelationMedian: p ? round(p.median, 3) : null,
    layoutCorrelationP10: p ? round(p.p10, 3) : null,
    stageClearEvents: render.stageClearTimes.length,
    stageClearsPer30s: round(per30),
    boundaryKeptShare: keptShare === null ? null : round(keptShare),
  };
  const threshold = { layoutCorrelationMedianMin: T.persistence.medianMin, stageClearsPer30sMax: T.persistence.clearsPer30sMax, boundaryKeptShareMin: T.persistence.boundaryCarryMin };
  if (!p && keptShare === null) return skipped(1, "persistent-stage", "One persistent stage", true, "video too short or flat to correlate layouts, and no film data");
  const failures: string[] = [];
  if (p && p.median < T.persistence.medianMin) failures.push(`layout correlates ${round(p.median, 2)} with two seconds earlier (needs ${T.persistence.medianMin})`);
  if (p && per30 > T.persistence.clearsPer30sMax) failures.push(`${render.stageClearTimes.length} stage clears (${round(per30, 1)} per 30 s, max ${T.persistence.clearsPer30sMax})`);
  if (keptShare !== null && keptShare < T.persistence.boundaryCarryMin) failures.push(`only ${Math.round(keptShare * 100)}% of beat boundaries keep the previous beat's elements on stage (needs ${Math.round(T.persistence.boundaryCarryMin * 100)}%)`);
  const evidence: Evidence[] = [
    ...spread(render.stageClearTimes, 3).map((t) => ({ t: t + 1, note: `stage cleared around ${round(t, 1)} s: ink coverage collapsed` })),
    ...cleared.slice(0, 2).map((b) => ({ t: b.t + 0.5, note: `film data: this beat boundary leaves ${b.kept} of ${b.outgoing} previous elements on stage` })),
    ...(p ? p.weakest.slice(0, 1).map((w) => ({ t: w.t, note: `layout least like two seconds earlier (correlation ${round(w.corr, 2)})` })) : []),
  ];
  const s = p ? Math.min(score(p.median, 0.3, 0.9), score(per30, 6, 1)) : score(keptShare ?? 0, 0, 1);
  return {
    id: 1, key: "persistent-stage", name: "One persistent stage", gate: true,
    status: failures.length ? "fail" : "pass", score: s,
    summary: failures.length ? failures.join("; ") : "the stage persists and transforms across beats",
    metrics, threshold, evidence,
    fix: failures.length ? "Keep one stage up for the whole film: each beat should transform what is already on screen (move, scale, retag, shrink into a card) instead of clearing it and drawing a new panel." : undefined,
  };
}

// Criterion 2: carry-over with transformation, from film data only (never pixel overlap in place).
function carryOver(i: ReviewInputs): CriterionResult {
  const { film, video } = i;
  if (!film) return skipped(2, "carry-over", "Carry-over with transformation", false, "needs aideos film data; pixel overlap in place measures stillness, not continuity");
  const hits = film.boundaries.filter((b) => b.transformed > 0);
  const per20 = (hits.length / Math.max(1, video.durationSec)) * 20;
  const floor = 1 / 20;
  const ok = hits.length / Math.max(1, video.durationSec) >= floor;
  return {
    id: 2, key: "carry-over", name: "Carry-over with transformation", gate: false,
    status: ok ? "pass" : "fail", score: score(per20, 0, 1.5),
    summary: `${hits.length} beat boundaries carry an element across while changing it (${round(per20, 2)} per 20 s, needs at least 1)`,
    metrics: { transformedBoundaries: hits.length, per20s: round(per20) },
    threshold: { per20sMin: 1 },
    evidence: spread(hits.map((b) => b.t), 3).map((t) => ({ t: t + 0.5, note: "an element persists across this boundary and is transformed" })),
    fix: ok ? undefined : "At each beat boundary keep at least one named element and change its position, scale, shape or role (a graph that slides aside and shrinks into a flowchart card).",
  };
}

// Criterion 3: animation cues land on spoken words more often than chance.
function cueTiming(i: ReviewInputs): CriterionResult {
  const { film, narration } = i;
  if (!film || film.clipStarts.length === 0) return skipped(3, "cue-timing", "Cues aimed at spoken words", false, "needs a scene film with animation clips");
  if (!narration?.timed) return skipped(3, "cue-timing", "Cues aimed at spoken words", false, "needs word timings");
  const tol = T.audioSync.cueToleranceSec;
  const starts = [...new Set(film.clipStarts.map((t) => Math.round(t * 1000) / 1000))];
  const share = shareNearWordStarts(narration.words, starts, tol);
  const chance = chanceNearWordStarts(narration.words, tol);
  const lift = share - chance;
  const ok = lift >= 0.15;
  return {
    id: 3, key: "cue-timing", name: "Cues aimed at spoken words", gate: false,
    status: ok ? "pass" : "fail", score: score(lift, 0, 0.4),
    summary: `${Math.round(share * 100)}% of ${starts.length} clip starts sit within ${Math.round(tol * 1000)} ms of a word start; chance alone gives ${Math.round(chance * 100)}%`,
    metrics: { clipStarts: starts.length, shareNearWordStart: round(share), chanceShare: round(chance), lift: round(lift) },
    threshold: { liftMin: 0.15, toleranceSec: tol },
    evidence: [],
    fix: ok ? undefined : "Aim each cue at the spoken word it depicts (createCues(timing).word(shot, phrase)) instead of at a fraction of the shot.",
  };
}

// Criterion 4: a camera that moves, from film data (gate).
function camera(i: ReviewInputs): CriterionResult {
  const { film, video } = i;
  if (!film) return skipped(4, "camera", "Camera that does something", true, "camera is read from film data, not pixels; pass --film or review an aideos film");
  const cam = film.camera;
  const need = Math.max(1, Math.floor(video.durationSec / T.camera.movePerSec));
  const metrics = { cameraKind: cam.kind, moves: cam.moves.length, movesNeeded: need, subThresholdMoves: cam.driftOnly, maxSpeedWidthPerSec: round(cam.maxSpeed, 3) };
  const threshold = { movePerSec: T.camera.movePerSec, maxSpeedWidthPerSec: T.camera.maxSpeedWidthPerSec };
  const failures: string[] = [];
  if (!cam.available) failures.push("the film has no camera track");
  else if (cam.moves.length < need) failures.push(`${cam.moves.length} camera moves, needs at least ${need} (one per ${T.camera.movePerSec} s)`);
  if (cam.maxSpeed > T.camera.maxSpeedWidthPerSec) failures.push(`fastest move travels ${round(cam.maxSpeed, 2)} frame widths per second (max ${T.camera.maxSpeedWidthPerSec})`);
  return {
    id: 4, key: "camera", name: "Camera that does something", gate: true,
    status: failures.length ? "fail" : "pass", score: cam.available ? score(cam.moves.length / need, 0, 1.5) : 0,
    summary: failures.length ? failures.join("; ") : `${cam.moves.length} purposeful camera moves`,
    metrics, threshold,
    evidence: spread(cam.moves.map((m) => m.t), 3).map((t) => ({ t: t + 0.5, note: "camera move" })),
    fix: failures.length ? "Add a slow camera move that changes what is framed at least once every 20 s (push in on the detail being explained, pull back for the payoff), none faster than 20% of the frame width per second." : undefined,
  };
}

// Criterion 5: burned-in captions along the bottom (gate).
function captions(i: ReviewInputs): CriterionResult {
  const { render, narration, silences } = i;
  if (!render.ocrRan) return skipped(5, "captions", "Bottom captions", true, "OCR was not run");
  if (!narration && !i.video.hasAudio) return skipped(5, "captions", "Bottom captions", true, "no narration: the video has no audio and no narration was given");
  // Only narrated moments are held to having a caption: with timed words, within a second of a word; otherwise outside any silence.
  const narratedSamples = render.samples.filter((s) => (narration?.timed ? narration.words.some((w) => s.t >= w.start - 1 && s.t <= w.end + 1) : !silences.some((x) => x.end - x.start >= 1 && s.t >= x.start && s.t <= x.end)));
  if (narratedSamples.length === 0) return skipped(5, "captions", "Bottom captions", true, "no narrated moments to check");
  const withCaption = narratedSamples.filter((s) => s.hasCaption);
  const coverage = withCaption.length / narratedSamples.length;
  const tooTall = withCaption.filter((s) => s.captionLines > T.captions.maxLines).length;
  const matches = narration ? withCaption.map((s) => captionMatch(s.captionText, narration, s.t)).filter((m): m is number => m !== null) : [];
  const match = matches.length ? matches.reduce((a, b) => a + b, 0) / matches.length : null;
  const failures: string[] = [];
  if (coverage < T.captions.coverageMin) failures.push(`captions on screen in ${Math.round(coverage * 100)}% of narrated moments (needs ${Math.round(T.captions.coverageMin * 100)}%)`);
  if (withCaption.length && tooTall / withCaption.length > 0.1) failures.push(`${tooTall} caption frames run past ${T.captions.maxLines} lines`);
  if (match !== null && match < 0.7) failures.push(`only ${Math.round(match * 100)}% of caption words are in the narration`);
  const missing = narratedSamples.filter((s) => !s.hasCaption).map((s) => s.t);
  return {
    id: 5, key: "captions", name: "Bottom captions", gate: true,
    status: failures.length ? "fail" : "pass", score: score(coverage, 0, 0.9),
    summary: failures.length ? failures.join("; ") : `captions present in ${Math.round(coverage * 100)}% of narrated moments`,
    metrics: { narratedSamples: narratedSamples.length, captionSamples: withCaption.length, coverage: round(coverage), overTwoLineFrames: tooTall, captionWordMatch: match === null ? null : round(match) },
    threshold: { coverageMin: T.captions.coverageMin, maxLines: T.captions.maxLines, wordHeightMinPx: T.captions.wordHeightMin, wordMatchMin: 0.7 },
    evidence: spread(missing, 4).map((t) => ({ t, note: "narrated moment with no caption band in the bottom quarter" })),
    fix: failures.length ? "Burn in captions along the bottom quarter of the frame (word-highlighted, two lines at most, 36 px or more at 1080p) for all narrated time; keep artwork out of that band." : undefined,
  };
}

// Criterion 6: text is large and contrasty enough to read (gate).
function readability(i: ReviewInputs): CriterionResult {
  const { render } = i;
  if (!render.ocrRan) return skipped(6, "readability", "Readability", true, "OCR was not run");
  const total = render.samples.reduce((a, s) => a + s.words, 0);
  if (total === 0) return skipped(6, "readability", "Readability", true, "no on-screen text found");
  const small = render.samples.reduce((a, s) => a + s.smallWords, 0) / total;
  const faint = render.samples.reduce((a, s) => a + s.lowContrastWords, 0) / total;
  const failures: string[] = [];
  if (small > T.readability.smallShareMax) failures.push(`${Math.round(small * 100)}% of on-screen words are under ${T.readability.wordHeightMin} px tall at 1080p (max ${Math.round(T.readability.smallShareMax * 100)}%)`);
  if (faint > T.readability.lowContrastShareMax) failures.push(`${Math.round(faint * 100)}% of words have contrast under ${T.readability.contrastMin}:1 (max ${Math.round(T.readability.lowContrastShareMax * 100)}%)`);
  const worst = [...render.samples].filter((s) => s.words > 0).sort((a, b) => b.smallWords / b.words + b.lowContrastWords / b.words - (a.smallWords / a.words + a.lowContrastWords / a.words)).slice(0, 3).map((s) => s.t).sort((a, b) => a - b);
  return {
    id: 6, key: "readability", name: "Readability", gate: true,
    status: failures.length ? "fail" : "pass", score: Math.min(score(small, 0.9, 0.2), score(faint, 0.3, 0)),
    summary: failures.length ? failures.join("; ") : "on-screen text is large and contrasty enough",
    metrics: { words: total, smallShare: round(small), lowContrastShare: round(faint) },
    threshold: { wordHeightMinPx: T.readability.wordHeightMin, smallShareMax: T.readability.smallShareMax, contrastMin: T.readability.contrastMin, lowContrastShareMax: T.readability.lowContrastShareMax },
    evidence: failures.length ? worst.map((t) => ({ t, note: "frame with the most small or faint text" })) : [],
    fix: failures.length ? "Set essential text at 24 px or more at 1080p (labels 20 px at least), and keep it at 4.5:1 contrast or better against what is behind it." : undefined,
  };
}

// Criterion 7: no text overlap, nothing in the edge margin (gate).
function overlap(i: ReviewInputs): CriterionResult {
  const { render, film } = i;
  if (!render.ocrRan && !film) return skipped(7, "overlap", "No overlap or clipping", true, "OCR was not run and there is no film data");
  const bad = render.samples.filter((s) => s.overlaps > 0 || s.offSafe > 0);
  const share = render.samples.length ? bad.length / render.samples.length : 0;
  const nodeOverlaps = film?.nodeOverlaps ?? [];
  const failures: string[] = [];
  if (share > T.overlap.badFrameShareMax) failures.push(`${bad.length} of ${render.samples.length} sampled frames show overlapping text or text inside the ${T.overlap.safeMarginPx}px edge margin`);
  if (nodeOverlaps.length) failures.push(`canvas nodes overlap: ${nodeOverlaps.slice(0, 3).join(", ")}`);
  return {
    id: 7, key: "overlap", name: "No overlap or clipping", gate: true,
    status: failures.length ? "fail" : "pass", score: nodeOverlaps.length ? 0 : score(share, 0.3, 0),
    summary: failures.length ? failures.join("; ") : "no overlapping or edge-crowded text found",
    metrics: { sampledFrames: render.samples.length, badFrames: bad.length, badFrameShare: round(share), nodeOverlaps: nodeOverlaps.length },
    threshold: { badFrameShareMax: T.overlap.badFrameShareMax, safeMarginPx: T.overlap.safeMarginPx },
    evidence: spread(bad.map((s) => s.t), 3).map((t) => ({ t, note: "overlapping or edge-crowded text" })),
    fix: failures.length ? "Move or resize the overlapping elements, and keep text at least 24 px (1080p) inside every frame edge." : undefined,
  };
}

// Criterion 8: picture and sound agree (gate).
function audioSync(i: ReviewInputs): CriterionResult {
  const { video, film, narration } = i;
  const audioDurationSec = video.audioDurationSec;
  if (audioDurationSec === null) return skipped(8, "audio-sync", "Audio sync", true, "the video has no audio track");
  const failures: string[] = [];
  const lengthDiff = Math.abs(audioDurationSec - video.durationSec);
  if (lengthDiff > T.audioSync.lengthToleranceSec) failures.push(`audio is ${round(audioDurationSec, 2)} s but the picture is ${round(video.durationSec, 2)} s`);
  const filmDiff = film ? Math.abs(film.durationSec - video.durationSec) : null;
  if (filmDiff !== null && filmDiff > T.audioSync.lengthToleranceSec) failures.push(`the film's shots add up to ${round(film!.durationSec, 2)} s but the rendered video is ${round(video.durationSec, 2)} s`);
  const cuts = film && narration?.timed ? cutsThroughWords(narration.words, film.shotBoundaries, T.audioSync.boundaryToleranceSec) : null;
  if (cuts && cuts.length) failures.push(`${cuts.length} shot boundaries cut through a spoken word (${cuts.slice(0, 3).map((c) => `"${c.word}" at ${round(c.t, 1)} s`).join(", ")})`);
  const tail = narration?.timed && narration.words.length ? narration.words[narration.words.length - 1].end - video.durationSec : null;
  if (tail !== null && tail > T.audioSync.lengthToleranceSec) failures.push(`narration runs ${round(tail, 2)} s past the end of the video`);
  return {
    id: 8, key: "audio-sync", name: "Audio sync", gate: true,
    status: failures.length ? "fail" : "pass", score: failures.length ? clamp(2 - failures.length, 0, 2) : 4,
    summary: failures.length ? failures.join("; ") : "picture and narration are locked" + (cuts === null ? " (shot boundaries not checked: needs film data and word timings)" : ""),
    metrics: { audioVideoLengthDiffSec: round(lengthDiff, 3), filmVideoLengthDiffSec: filmDiff === null ? null : round(filmDiff, 3), shotBoundariesChecked: cuts === null ? 0 : film!.shotBoundaries.length, boundariesThroughWords: cuts ? cuts.length : null },
    threshold: { lengthToleranceSec: T.audioSync.lengthToleranceSec, boundaryToleranceSec: T.audioSync.boundaryToleranceSec },
    evidence: (cuts ?? []).slice(0, 3).map((c) => ({ t: c.t, note: `shot boundary cuts through "${c.word}"` })),
    fix: failures.length ? "Derive shot lengths and the film length from the measured narration, and place every shot boundary inside a pause." : undefined,
  };
}

// Criterion 9: pacing (stillness, cuts, dead air, speaking rate).
function pacing(i: ReviewInputs): CriterionResult {
  const { render, video, narration, film, silences } = i;
  const failures: string[] = [];
  const longest = render.staticRuns.reduce((m, r) => Math.max(m, r.end - r.start), 0);
  if (render.staticRuns.length) failures.push(`the picture holds unchanged for ${round(longest, 1)} s (max ${T.pacing.staticRunMaxSec} s)`);
  const cutsPerMin = (render.hardCutTimes.length / Math.max(1, video.durationSec)) * 60;
  if (cutsPerMin > T.pacing.hardCutsPerMinMax) failures.push(`${render.hardCutTimes.length} hard cuts (${round(cutsPerMin, 1)} per minute, max ${T.pacing.hardCutsPerMinMax}): the film plays as separate panels`);
  let deadAir = 0;
  if (narration?.timed) deadAir = pauses(narration.words, T.pacing.deadAirMaxSec).length;
  else if (video.audioDurationSec !== null) deadAir = silences.filter((s) => s.start > 1 && s.end < video.durationSec - 1 && s.end - s.start > T.pacing.deadAirMaxSec).length;
  if (deadAir > 0) failures.push(`${deadAir} stretches of dead air longer than ${T.pacing.deadAirMaxSec} s inside the narration`);
  const wpm = narration?.timed ? wordsPerMinute(narration.words) : narration ? (narration.text.split(/\s+/).filter(Boolean).length / video.durationSec) * 60 : null;
  if (wpm !== null && (wpm < T.pacing.wpmMin || wpm > T.pacing.wpmMax) && narration?.timed) failures.push(`narration runs at ${Math.round(wpm)} words per minute (window ${T.pacing.wpmMin} to ${T.pacing.wpmMax})`);
  const meanBeat = film ? film.shotDurations.reduce((a, b) => a + b, 0) / film.shotDurations.length : null;
  return {
    id: 9, key: "pacing", name: "Pacing", gate: false,
    status: failures.length ? "fail" : "pass", score: Math.round(clamp(4 - failures.length * 1.5, 0, 4) * 10) / 10,
    summary: failures.length ? failures.join("; ") : "no static holds, cuts or dead air; narration pace is in range",
    metrics: { longestStaticSec: round(longest, 1), hardCuts: render.hardCutTimes.length, hardCutsPerMin: round(cutsPerMin, 1), deadAirStretches: deadAir, wordsPerMinute: wpm === null ? null : Math.round(wpm), meanBeatSec: meanBeat === null ? null : round(meanBeat, 1) },
    threshold: { staticRunMaxSec: T.pacing.staticRunMaxSec, hardCutsPerMinMax: T.pacing.hardCutsPerMinMax, deadAirMaxSec: T.pacing.deadAirMaxSec, wpmMin: T.pacing.wpmMin, wpmMax: T.pacing.wpmMax },
    evidence: [...render.staticRuns.slice(0, 2).map((r) => ({ t: (r.start + r.end) / 2, note: "picture unchanged here" })), ...spread(render.hardCutTimes, 3).map((t) => ({ t, note: "hard cut" }))],
    fix: failures.length ? "Replace cuts with continuous transforms of the same stage, give every beat something that moves, and trim pauses over 0.7 s." : undefined,
  };
}

// Digit groups of a spoken number as written with thousands separators ("100000000" -> 100, 000, 000).
function digitGroups(n: number): string[] {
  const s = String(Math.round(n));
  if (s.length <= 3) return [s];
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",").split(",");
}

// Criterion 11: numbers on screen are said in the narration.
function grounding(i: ReviewInputs): CriterionResult {
  const { render, narration } = i;
  if (!narration) return skipped(11, "grounding", "Numbers grounded in narration", false, "needs the narration (word timings or text)");
  if (!render.ocrRan) return skipped(11, "grounding", "Numbers grounded in narration", false, "OCR was not run");
  const spoken = new Set<number>(spokenNumbers(narration.text));
  const groups = new Set([...spoken].filter((n) => n >= 1000).flatMap(digitGroups));
  const seen = new Map<string, number>();
  for (const s of render.samples) {
    for (const raw of s.numbers) {
      const tok = raw.replace(/%$/, "");
      // Leading-zero integers are chapter and step numbers, and very long tokens are OCR runs: neither is a claim.
      if (/^0\d/.test(tok) || tok.replace(/[,.]/g, "").length > 9) continue;
      if (!seen.has(tok)) seen.set(tok, s.t);
    }
  }
  const ungrounded = [...seen.entries()].filter(([tok]) => {
    const v = Number(tok.replace(/,/g, ""));
    return !(spoken.has(v) || groups.has(tok.replace(/,/g, "")) || spoken.has(Math.round(v)) || v === 0);
  });
  return {
    id: 11, key: "grounding", name: "Numbers grounded in narration", gate: false,
    status: ungrounded.length > T.grounding.ungroundedMax ? "fail" : "pass",
    score: score(ungrounded.length, 6, 0),
    summary: ungrounded.length ? `${ungrounded.length} on-screen numbers are not said in the narration: ${ungrounded.slice(0, 8).map(([t]) => t).join(", ")}` : `all ${seen.size} on-screen numbers are said in the narration`,
    metrics: { distinctNumbersOnScreen: seen.size, ungrounded: ungrounded.length, ungroundedList: ungrounded.slice(0, 12).map(([t]) => t).join(" ") },
    threshold: { ungroundedMax: T.grounding.ungroundedMax },
    evidence: ungrounded.slice(0, 3).map(([tok, t]) => ({ t, note: `"${tok}" is on screen but never spoken` })),
    fix: ungrounded.length ? "Say every number the picture shows, or mark it as illustrative; remove numbers that are only decoration." : undefined,
  };
}

// Criterion 12: loudness and true peak.
function loudness(i: ReviewInputs): CriterionResult {
  const l = i.loudness;
  if (!l) return skipped(12, "loudness", "Loudness and mix", false, "the video has no audio track");
  const failures: string[] = [];
  if (l.integratedLufs < T.loudness.lufsMin || l.integratedLufs > T.loudness.lufsMax) failures.push(`integrated loudness ${l.integratedLufs} LUFS (window ${T.loudness.lufsMin} to ${T.loudness.lufsMax})`);
  if (l.truePeakDb > T.loudness.truePeakMaxDb) failures.push(`true peak ${l.truePeakDb} dBFS (max ${T.loudness.truePeakMaxDb})`);
  return {
    id: 12, key: "loudness", name: "Loudness and mix", gate: false,
    status: failures.length ? "fail" : "pass", score: failures.length ? 1 : 4,
    summary: failures.length ? failures.join("; ") : `${l.integratedLufs} LUFS, true peak ${l.truePeakDb} dBFS`,
    metrics: { integratedLufs: l.integratedLufs, truePeakDb: l.truePeakDb },
    threshold: { lufsMin: T.loudness.lufsMin, lufsMax: T.loudness.lufsMax, truePeakMaxDb: T.loudness.truePeakMaxDb },
    evidence: [],
    fix: failures.length ? "Normalise the mix to between -18 and -14 LUFS integrated with true peak at or below -1 dBFS." : undefined,
  };
}

// Computes every criterion's verdict from the measured inputs, in rubric order.
export function evaluateCriteria(i: ReviewInputs): CriterionResult[] {
  return [persistentStage(i), carryOver(i), cueTiming(i), camera(i), captions(i), readability(i), overlap(i), audioSync(i), pacing(i), grounding(i), loudness(i)];
}
