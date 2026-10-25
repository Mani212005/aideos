/**
 * File Description: Resolves design-spec cues ("jupiter@0.4", 'jupiter:"the storm"@end+6') to frames.
 * All timing comes from the measured narration through the scene-film kit, so a re-recorded take
 * retimes the design and a cue naming a phrase that is no longer spoken fails with a clear reason.
 * Inputs and outputs: narration word timings and keywords -> synchronized visual animation cues.
 * Used by: backend/designSpec/compile.ts.
 * Inputs and outputs: narration word timings and keywords -> synchronized visual animation cues.
 * Used by: backend/designSpec/compile.ts.
 */

import type { Cues } from "../sceneKit";
import type { LookPerformance } from "../lookPlan/schema";

const CUE = /^(?<shot>[a-z0-9-]+)(?::"(?<phrase>[^"]+)")?(?:@(?<at>end|start|\d*\.?\d+))?(?<offset>[+-]\d+)?$/;
const END = /^end(?<offset>[+-]\d+)?$/;

// Names a dropped shot through the same validated cue grammar used by resolution.
export function collapsedCueShot(cue: string | number, cues: Cues): string | undefined {
  if (typeof cue !== "string") return undefined;
  const shot = CUE.exec(cue.trim())?.groups?.shot;
  return shot && cues.collapsed?.has(shot) ? shot : undefined;
}

// Resolves one cue to a frame number, throwing a message an agent can act on when it cannot.
export function resolveCue(cue: string | number, cues: Cues): number {
  if (typeof cue === "number") return cue;
  const text = cue.trim();
  const end = END.exec(text);
  if (end) return cues.durationFrames + Number(end.groups?.offset ?? 0);
  const m = CUE.exec(text);
  if (!m?.groups) {
    throw new Error(`cue "${cue}" is not valid; use shot, shot@0.5, shot@end, shot:"spoken phrase", optionally +N/-N frames`);
  }
  const { shot, phrase, at } = m.groups;
  const collapsed = cues.collapsed?.get(shot);
  if (collapsed !== undefined) return collapsed;
  const offset = Number(m.groups.offset ?? 0);
  if (phrase) return cues.word(shot, phrase, at === "end" ? "end" : "start") + offset;
  if (!at || at === "start") return cues.from(shot) + offset;
  if (at === "end") return cues.to(shot) + offset;
  const fraction = Number(at);
  if (!(fraction >= 0 && fraction <= 1)) throw new Error(`cue "${cue}": a fraction must be between 0 and 1`);
  return cues.at(shot, fraction) + offset;
}

// Returns the timing error when a performance starts on or after its unique decisive word.
export function performanceStartIssue(performance: Pick<LookPerformance, "start" | "decisive">, cues: Cues): string | null {
  const decisive = cues.wordOnce(performance.decisive.shotId, performance.decisive.phrase, performance.decisive.edge);
  const start = resolveCue(performance.start, cues);
  if (start < decisive) return null;
  const startCue = typeof performance.start === "string" ? `"${performance.start}"` : `frame ${performance.start}`;
  return `starts at frame ${start} on ${startCue}, not before its decisive ${performance.decisive.event} on "${performance.decisive.phrase}" in shot "${performance.decisive.shotId}" at frame ${decisive}`;
}
