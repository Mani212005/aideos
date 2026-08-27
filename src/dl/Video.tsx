import React from "react";
import { Audio } from "@remotion/media";
import { Sequence, useCurrentFrame, staticFile } from "remotion";
import { FilmView } from "./Film";
import { TOTAL_FRAMES, FILM, TIMELINE, FPS, type FilmProps } from "./runtime";
import { calculateDuckingVolume, type SpeechInterval } from "./audio/ducking";
import { generateWordsFromFilm } from "./captionsParser";

/**
 * The film plus its soundtrack.
 *
 * Mixes three audio layers (voiceover, music with sidechain ducking, and sfx).
 */

/**
 * Narration level. Ramped at both ends — cutting a voice track in at full level
 * puts an audible click on the first and last frames.
 */
export const voiceLevel = (frame: number, level: number) =>
  level *
  Math.min(1, frame / 6) *
  Math.min(1, Math.max(0, TOTAL_FRAMES - frame) / 12);

export const Video: React.FC<FilmProps> = ({
  accent,
  voiceoverSrc,
  musicSrc,
  musicVolume,
  showRail,
  showGrid,
}) => {
  const frame = useCurrentFrame();
  const effectiveVoiceoverSrc = voiceoverSrc.trim() || FILM.voiceover?.src || "";
  const effectiveMusicSrc = musicSrc.trim() || FILM.music?.src || FILM.audio?.src || "";
  const effectiveMusicVolume = FILM.music?.volume ?? musicVolume ?? 1;

  // Extract speech intervals from timeline shots with narration
  const speechIntervals: SpeechInterval[] = TIMELINE.filter((t) => Boolean(t.shot.scriptText)).map(
    (t) => ({
      startSec: t.from / FPS,
      endSec: t.to / FPS,
    }),
  );

  const currentDuckingVolume = calculateDuckingVolume({
    frame,
    fps: FPS,
    totalFrames: TOTAL_FRAMES,
    musicVolume: effectiveMusicVolume,
    duckUnderVoiceover: FILM.music?.duckUnderVoiceover ?? true,
    speechIntervals,
  });

  return (
    <>
      {/* 1. Background Music Track (with ducking) */}
      {effectiveMusicSrc.trim().length > 0 ? (
        <Audio
          key={`aideos-music-${FILM.id}`}
          src={staticFile(effectiveMusicSrc)}
          trimBefore={Math.round((FILM.audio?.trimBefore ?? 0) * FPS)}
          volume={() => currentDuckingVolume}
        />
      ) : null}

      {/* 2. Voiceover Track */}
      {effectiveVoiceoverSrc.trim().length > 0 ? (
        <Audio
          key={`aideos-voiceover-${FILM.id}`}
          src={staticFile(effectiveVoiceoverSrc)}
          volume={() => voiceLevel(frame, FILM.voiceover?.volume ?? 1)}
        />
      ) : null}

      {/* 3. Transition Sound Effects (SFX) Track */}
      {FILM.sfx && FILM.sfx.length > 0
        ? FILM.sfx.map((sfx, idx) => {
            const startFrame = Math.round(sfx.timeSec * FPS);
            return (
              <Sequence key={`sfx-${idx}-${sfx.src}`} from={startFrame}>
                <Audio src={staticFile(sfx.src)} volume={() => sfx.volume ?? 1} />
              </Sequence>
            );
          })
        : null}

      <FilmView
        film={FILM}
        timeline={TIMELINE}
        accent={accent}
        showGrid={showGrid}
        showRail={showRail}
        captionWords={generateWordsFromFilm(FILM as unknown as Record<string, unknown>)}
      />
    </>
  );
};

