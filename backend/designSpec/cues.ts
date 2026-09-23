/**
 * File Description: Resolves design-spec cues ("jupiter@0.4", 'jupiter:"the storm"@end+6') to frames.
 * All timing comes from the measured narration through the scene-film kit, so a re-recorded take
 * retimes the design and a cue naming a phrase that is no longer spoken fails with a clear reason.
 */

import type { Cues } from "../sceneKit";

const CUE = /^(?<shot>[a-z0-9-]+)(?::"(?<phrase>[^"]+)")?(?:@(?<at>end|start|\d*\.?\d+))?(?<offset>[+-]\d+)?$/;
const END = /^end(?<offset>[+-]\d+)?$/;

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
  const offset = Number(m.groups.offset ?? 0);
  if (phrase) return cues.word(shot, phrase, at === "end" ? "end" : "start") + offset;
  if (!at || at === "start") return cues.from(shot) + offset;
  if (at === "end") return cues.to(shot) + offset;
  const fraction = Number(at);
  if (!(fraction >= 0 && fraction <= 1)) throw new Error(`cue "${cue}": a fraction must be between 0 and 1`);
  return cues.at(shot, fraction) + offset;
}
