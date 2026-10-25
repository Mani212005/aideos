/**
 * File Description: Top-level Remotion video composition mixing canvas visuals and the shared soundtrack.
 * Inputs and outputs: Film props and dimensions -> full Remotion Composition component.
 * Used by: src/Root.tsx, backend/insetStage.test.ts.
 */

import React, { useMemo } from "react";
import { FilmView } from "./Film";
import { Soundtrack, voiceLevel as soundtrackVoiceLevel } from "./Soundtrack";
import { FILM, TIMELINE, TOTAL_FRAMES, type FilmProps } from "./runtime";
import { captionWordsForFilm } from "./captionsParser";
import type { Film } from "./schema";
import type { TimedShot } from "./camera";

/**
 * The film plus its soundtrack.
 *
 * Describes the render composition's film, timeline, and audio override props; src/dl/Soundtrack.tsx owns audio mixing.
 */

export type VideoProps = FilmProps & {
  film?: Film;
  timeline?: TimedShot[];
};

// Calculates narration volume using the active film length when no total is supplied.
export const voiceLevel = (frame: number, level: number, total: number = TOTAL_FRAMES) =>
  soundtrackVoiceLevel(frame, level, total);

// Renders the combined video composition with layered audio tracks, sound effects, and subtitles.
export const Video: React.FC<VideoProps> = ({
  accent,
  voiceoverSrc,
  voiceoverVolume,
  musicSrc,
  musicVolume,
  showRail,
  showGrid,
  film = FILM,
  timeline = TIMELINE,
}) => {
  const captionWords = useMemo(() => captionWordsForFilm(film), [film]);

  return (
    <>
      <Soundtrack
        film={film}
        timeline={timeline}
        voiceoverSrc={voiceoverSrc}
        voiceoverVolume={voiceoverVolume}
        musicSrc={musicSrc}
        musicVolume={musicVolume}
      />
      <FilmView
        film={film}
        timeline={timeline}
        accent={accent}
        showGrid={showGrid}
        showRail={showRail}
        captionWords={captionWords}
        includeAudio={false}
      />
    </>
  );
};
