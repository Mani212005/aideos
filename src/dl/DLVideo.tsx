import React from "react";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { FilmView } from "./Film";
import { DL_TOTAL_FRAMES, FILM, TIMELINE, type DLProps } from "./runtime";

/**
 * The film plus its soundtrack.
 *
 * The mix is computed rather than edited, so it survives a re-render from the
 * data alone. That matters more than it sounds: an explainer gets its voiceover
 * last, and a mix that lives in an editor has to be rebuilt by hand every time
 * a single line of script changes.
 */

/** Bed level. Ducks hard when there is narration to sit under. */
const bed = (frame: number, hasVoice: boolean, master: number) => {
  const level = (hasVoice ? 0.34 : 1) * master * 0.24;
  const headIn = Math.min(1, frame / 24);
  const tailOut = Math.max(0, Math.min(1, (DL_TOTAL_FRAMES - frame) / 45));
  return level * headIn * tailOut;
};

/**
 * Narration level. Ramped at both ends — cutting a voice track in at full level
 * puts an audible click on the first and last frames.
 */
const voice = (frame: number, level: number) =>
  level * Math.min(1, frame / 6) * Math.min(1, Math.max(0, DL_TOTAL_FRAMES - frame) / 12);

export const DLVideo: React.FC<DLProps> = ({
  accent,
  voiceoverSrc,
  voiceoverVolume,
  musicSrc,
  musicVolume,
  showRail,
  showGrid,
}) => {
  const hasVoice = voiceoverSrc.trim().length > 0;

  return (
    <>
      {musicSrc.trim().length > 0 ? (
        <Audio
          src={staticFile(musicSrc)}
          trimBefore={Math.round((FILM.audio?.trimBefore ?? 0) * FILM.fps)}
          volume={(f) => bed(f, hasVoice, musicVolume)}
        />
      ) : null}
      {hasVoice ? (
        <Audio src={staticFile(voiceoverSrc)} volume={(f) => voice(f, voiceoverVolume)} />
      ) : null}
      <FilmView
        film={FILM}
        timeline={TIMELINE}
        accent={accent}
        showGrid={showGrid}
        showRail={showRail}
      />
    </>
  );
};
