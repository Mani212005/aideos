/**
 * File Description: The truthful, per-output description of a Three stage film that both reviewers read:
 * which characters and props are drawn (and which cast members no performance draws), what is projected
 * inside this output's frame per shot, each performance's evaluated contact against the decisive word
 * resolved from the timed narration, the camera as it moves in this crop, and the list of things no tool
 * measured (pixel visibility and final occlusion, face appeal, finger contact). Presence is posed geometry
 * projected into the output, never a claim that pixels show it.
 * Inputs and outputs: FilmFacts measured for one viewport plus timed narration -> StageTruth (for review.json) and plain words (for the Gemini prompt).
 * Used by: backend/review/review.ts, backend/geminiReview/facts.ts.
 */

import type { FilmFacts } from "./source";
import { phraseFrame, type Narration } from "./speech";

/** What no tool measures on a stage film; a reviewer judges these from the video or leaves them unmeasured. */
export const STAGE_UNMEASURED = [
  "pixel visibility and final occlusion (foreground artwork or another mesh may hide a projected character)",
  "face appeal and expression readability",
  "finger contact with the prop",
  "silhouette strength and apparent weight",
] as const;

/** What the stage facts did measure, and from what. */
export const STAGE_MEASURED = [
  "presence: posed mesh bounds with outline allowance projected into this output",
  "contact: the first frame the action's own evaluator attaches the prop",
  "decisive cue: the phrase resolved from the timed narration words of its shot",
  "camera: the compiled camera track projected into this output",
] as const;

/** The truthful stage description for one output. */
export interface StageTruth {
  renderer: "three";
  fps: number;
  format: "long" | "reel";
  viewport: { width: number; height: number };
  characters: Array<{ castId: string; id: string | null; version: number | null; hash: string | null; name: string | null }>;
  props: string[];
  /** Cast members no performance draws: never on screen. */
  hidden: string[];
  shots: Array<{ id: string; startSec: number; endSec: number; inFrameAtStart: string[]; inFrameAtEnd: string[]; offFrameAtStart: string[]; offFrameAtEnd: string[] }>;
  performances: Array<{
    id: string; action: string; actor: string; prop: string; character: string | null;
    decisive: { shotId: string; phrase: string; edge: "start" | "end" };
    /** Frame of the decisive word from the timed words, null when they are missing or do not contain it. */
    cueFrame: number | null;
    contactFrame: number | null;
    /** Contact minus cue, in frames; null when either is unknown. */
    offsetFrames: number | null;
    presentAtContact: string[];
    afterState: string;
  }>;
  camera: { moves: number; maxSpeedWidthsPerSec: number; summary: string };
  measured: readonly string[];
  unmeasured: readonly string[];
}

// Rounds to two decimals for readable seconds and speeds.
const r2 = (n: number) => Math.round(n * 100) / 100;

// Builds the stage truth for the output the facts were measured in, or nothing for a film without a Three stage.
export function stageTruth(facts: FilmFacts, narration: Narration | null): StageTruth | undefined {
  if (!facts.performances || !facts.stageCast || !facts.viewport || !facts.format) return undefined;
  const shots = (facts.planShots ?? []).map((shot) => ({
    id: shot.id, startSec: r2(shot.startSec), endSec: r2(shot.endSec),
    inFrameAtStart: shot.visibleAtStart.filter((id) => isCast(facts, id)),
    inFrameAtEnd: shot.visibleAtEnd.filter((id) => isCast(facts, id)),
    offFrameAtStart: shot.offFrameAtStart ?? [], offFrameAtEnd: shot.offFrameAtEnd ?? [],
  }));
  const performances = facts.performances.map((p) => {
    const shot = facts.planShots?.find((s) => s.id === p.decisive.shotId);
    const cueFrame = shot ? phraseFrame(narration, p.decisive.phrase, p.decisive.edge, shot, facts.fps) : null;
    return {
      id: p.id, action: p.action, actor: p.actor, prop: p.prop, character: p.character ? `${p.character.id} v${p.character.version}` : null,
      decisive: { shotId: p.decisive.shotId, phrase: p.decisive.phrase, edge: p.decisive.edge },
      cueFrame, contactFrame: p.contactFrame,
      offsetFrames: cueFrame !== null && p.contactFrame !== null ? p.contactFrame - cueFrame : null,
      presentAtContact: p.presentAtContact, afterState: p.afterState,
    };
  });
  const moves = facts.camera.moves.length;
  const camera = {
    moves, maxSpeedWidthsPerSec: r2(facts.camera.maxSpeed),
    summary: moves === 0
      ? `fixed: the compiled camera does not move in the ${facts.format} output`
      : `${moves} move(s) in the ${facts.format} output, fastest ${Math.round(facts.camera.maxSpeed * 100)}% of the output width per second`,
  };
  return {
    renderer: "three", fps: facts.fps, format: facts.format, viewport: facts.viewport,
    characters: facts.stageCast.characters.map((c) => ({ castId: c.castId, id: c.character?.id ?? null, version: c.character?.version ?? null, hash: c.character?.hash ?? null, name: c.character?.name ?? null })),
    props: facts.stageCast.props, hidden: facts.stageCast.hidden, shots, performances, camera,
    measured: STAGE_MEASURED, unmeasured: STAGE_UNMEASURED,
  };
}

// Tells whether an id is a stage cast member (SVG targets also appear in shot presence lists).
function isCast(facts: FilmFacts, id: string): boolean {
  return Boolean(facts.stageCast?.characters.some((c) => c.castId === id) || facts.stageCast?.props.includes(id));
}

// Formats a list for prose, or a word for nothing.
const list = (ids: string[], none = "nothing") => (ids.length ? ids.join(", ") : none);

// Says the stage truth in plain words for a reviewer prompt: counts, per-shot presence, contact against the word, camera, and what is unmeasured.
export function stageTruthText(truth: StageTruth): string {
  const fps = truth.fps;
  const characters = truth.characters.map((c) => c.id ? `${c.name ?? c.id} (cast "${c.castId}", character ${c.id} v${c.version}, hash ${c.hash?.slice(0, 12) ?? "none"})` : `cast "${c.castId}" (character spec did not verify)`);
  const lines = [
    `- Stage: one persistent Three.js cel-shaded stage, seen in the ${truth.format} output (${truth.viewport.width}x${truth.viewport.height}).`,
    `- Characters drawn: ${truth.characters.length}${characters.length ? `: ${characters.join("; ")}` : ""}. Props drawn: ${list(truth.props)}. Cast never drawn (hidden): ${list(truth.hidden, "none")}.`,
    ...truth.performances.map((p) => {
      const cue = p.cueFrame === null ? `the word "${p.decisive.phrase}" was not found in the timed narration of shot ${p.decisive.shotId}` : `the decisive word "${p.decisive.phrase}" (${p.decisive.edge}) in shot ${p.decisive.shotId} is at ${(p.cueFrame / fps).toFixed(2)} s (frame ${p.cueFrame})`;
      const contact = p.contactFrame === null ? "the action never makes contact" : `contact at frame ${p.contactFrame}${p.offsetFrames === null ? "" : p.offsetFrames === 0 ? ", on the word" : `, ${Math.abs(p.offsetFrames)} frame(s) ${p.offsetFrames > 0 ? "after" : "before"} it`}`;
      return `- Performance ${p.id}: ${p.actor}${p.character ? ` (${p.character})` : ""} ${p.action === "receive-v1" ? "catches" : p.action} ${p.prop}; ${cue}; ${contact}. Projected in frame at contact: ${list(p.presentAtContact)}. Afterwards: ${p.afterState}.`;
    }),
    `- Projected in frame per shot (posed geometry in this output, not pixels): ${truth.shots.map((s) => `${s.id} ${s.startSec}-${s.endSec} s: start ${list(s.inFrameAtStart)}, end ${list(s.inFrameAtEnd)}${s.offFrameAtStart.length || s.offFrameAtEnd.length ? `, off-frame ${list([...new Set([...s.offFrameAtStart, ...s.offFrameAtEnd])])}` : ""}`).join("; ")}.`,
    `- Camera: ${truth.camera.summary}. A moving character or prop is not a camera move.`,
    `- NOT measured by any tool: ${truth.unmeasured.join("; ")}. Judge these only from what you see and hear in the video. If you cannot see it clearly, it does not pass: never credit a criterion from these facts alone.`,
  ];
  return lines.join("\n");
}
