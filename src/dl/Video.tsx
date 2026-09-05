/**
 * File Description: Top-level Remotion video composition mixing canvas visuals, voiceover narration, sidechain-ducked music, and sound effects.
 */

import React from "react";
import { Audio } from "@remotion/media";
import { Sequence, staticFile } from "remotion";
import { FilmView } from "./Film";
import { TOTAL_FRAMES, FILM, TIMELINE, FPS, type FilmProps } from "./runtime";
import { calculateDuckingVolume, type SpeechInterval } from "./audio/ducking";
import { generateWordsFromFilm } from "./captionsParser";

/**
 * The film plus its soundtrack.
 *
 * Mixes three audio layers (voiceover, music with sidechain ducking, and sfx).
 */

// Calculates narration volume level ramped at head and tail.
export const voiceLevel = (frame: number, level: number) =>
  level *
  Math.min(1, frame / 6) *
  Math.min(1, Math.max(0, TOTAL_FRAMES - frame) / 12);

// Renders the combined video composition with layered audio tracks, sound effects, and subtitles.
export const Video: React.FC<FilmProps> = ({
  accent,
  voiceoverSrc,
  voiceoverVolume,
  musicSrc,
  musicVolume,
  showRail,
  showGrid,
}) => {
  const effectiveVoiceoverSrc = (voiceoverSrc ?? "").trim() || FILM.voiceover?.src || "";
  const effectiveVoiceoverVolume = voiceoverVolume ?? FILM.voiceover?.volume ?? 1;
  const effectiveMusicSrc = (musicSrc ?? "").trim() || FILM.music?.src || FILM.audio?.src || "";
  const effectiveMusicVolume = musicVolume ?? FILM.music?.volume ?? 1;

  // Extract speech intervals from audio clips or timeline shots with narration
  const speechIntervals: SpeechInterval[] =
    FILM.audioClips && FILM.audioClips.length > 0
      ? FILM.audioClips.map((ac) => ({
          startSec: ac.position,
          endSec: ac.position + (ac.end - (ac.start ?? 0)) / (ac.speed ?? 1.0),
        }))
      : TIMELINE.filter((t) => Boolean(t.shot.scriptText)).map((t) => ({
          startSec: t.from / FPS,
          endSec: t.to / FPS,
        }));

  return (
    <>
      {/* 1. Background Music Track (with ducking) */}
      {effectiveMusicSrc.trim().length > 0 ? (
        <Audio
          key={`aideos-music-${FILM.id}`}
          src={staticFile(effectiveMusicSrc)}
          trimBefore={Math.round((FILM.audio?.trimBefore ?? 0) * FPS)}
          volume={(f) =>
            calculateDuckingVolume({
              frame: f,
              fps: FPS,
              totalFrames: TOTAL_FRAMES,
              musicVolume: effectiveMusicVolume,
              duckUnderVoiceover: FILM.music?.duckUnderVoiceover ?? true,
              speechIntervals,
            })
          }
        />
      ) : null}

      {/* 2. Voiceover & Multi-Clip Audio Track */}
      {FILM.audioClips && FILM.audioClips.length > 0 ? (
        FILM.audioClips.map((ac) => {
          const speed = ac.speed ?? 1.0;
          const startFrame = Math.round(ac.position * FPS);
          const startFrom = Math.round((ac.start ?? 0) * FPS);
          const endAt = Math.round(ac.end * FPS);
          const rawDurFrames = Math.max(1, endAt - startFrom);
          const effectiveDurFrames = Math.max(1, Math.round(rawDurFrames / speed));
          const clipLevel = (ac.volume ?? 1) * effectiveVoiceoverVolume;

          return (
            <Sequence key={ac.id} from={startFrame} durationInFrames={effectiveDurFrames}>
              <Audio
                src={staticFile(ac.src)}
                trimBefore={startFrom}
                playbackRate={speed}
                volume={(f) => voiceLevel(f, clipLevel)}
              />
            </Sequence>
          );
        })
      ) : effectiveVoiceoverSrc.trim().length > 0 ? (
        <Audio
          key={`aideos-voiceover-${FILM.id}`}
          src={staticFile(effectiveVoiceoverSrc)}
          playbackRate={FILM.voiceover?.speed ?? 1.0}
          volume={(f) => voiceLevel(f, effectiveVoiceoverVolume)}
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
        includeAudio={false}
      />
    </>
  );
};


