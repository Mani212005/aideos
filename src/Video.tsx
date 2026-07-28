import React from "react";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { EpisodeStory } from "./Story";
import { EPISODE, SCRIPT, sec, TOTAL_FRAMES } from "./script";
import { Captions } from "./ui/Captions";
import type { VideoProps } from "./videoProps";

const HOOK_END = sec(SCRIPT[1].start);
const ENDCARD_START = sec(SCRIPT[SCRIPT.length - 1].start);

/**
 * Music bed.
 *
 * Held low on purpose: this is scored to be voiced over. The bed lifts where
 * there is no narration (the cold open and the end card) and sits back under the
 * body of the explainer, which is the same shape a human editor would draw.
 *
 * The original version passed `from={-50}` to `<Audio>`, which is not how the
 * track gets trimmed — `trimBefore` is. That is why the music always started on
 * the file's own soft intro.
 */
const bedVolume = (
  frame: number,
  hasVoiceover: boolean,
  master: number,
): number => {
  // With narration present the bed has to sit far lower. Ducking here rather
  // than in an editor keeps the mix reproducible from the project alone.
  const ducked = (hasVoiceover ? 0.38 : 1) * master;
  const BASE = 0.17 * ducked;
  const LIFT = 0.28 * ducked;

  if (frame < 24) return (frame / 24) * LIFT;
  if (frame < HOOK_END) return LIFT;
  if (frame < HOOK_END + 30)
    return LIFT + ((BASE - LIFT) * (frame - HOOK_END)) / 30;
  if (frame > ENDCARD_START) {
    const t = Math.min(1, (frame - ENDCARD_START) / 30);
    const lifted = BASE + (LIFT - BASE) * t;
    const tail = Math.max(0, Math.min(1, (TOTAL_FRAMES - frame) / 45));
    return lifted * tail;
  }
  return BASE;
};

/**
 * Narration level. A short ramp at each end rather than a flat number: cutting a
 * voice track in hard at full level produces an audible click on the first and
 * last frames.
 */
const voiceVolume = (frame: number, level: number): number => {
  const head = Math.min(1, frame / 6);
  const tail = Math.min(1, Math.max(0, TOTAL_FRAMES - frame) / 12);
  return level * head * tail;
};

/**
 * Props come from the composition's schema, so every one of these is editable in
 * Remotion Studio and saved back to `defaultProps`.
 */
export const EpisodeVideo: React.FC<VideoProps> = ({
  voiceoverSrc,
  voiceoverVolume,
  musicSrc,
  musicVolume,
  captionsSrc,
  showProgressRail,
  grain,
}) => {
  const hasVoiceover = voiceoverSrc.trim().length > 0;

  return (
    <>
      {musicSrc.trim().length > 0 ? (
        <Audio
          src={staticFile(musicSrc)}
          // Skip the track's own fade-in and land on a downbeat.
          trimBefore={sec(EPISODE.audio?.trimBefore ?? 0)}
          volume={(f) => bedVolume(f, hasVoiceover, musicVolume)}
        />
      ) : null}
      {hasVoiceover ? (
        <Audio
          src={staticFile(voiceoverSrc)}
          volume={(f) => voiceVolume(f, voiceoverVolume)}
        />
      ) : null}
      <EpisodeStory showProgressRail={showProgressRail} grain={grain} />
      {/* Captions sit above everything, including the vignette and grain. */}
      {captionsSrc.trim().length > 0 ? <Captions src={captionsSrc} /> : null}
    </>
  );
};
