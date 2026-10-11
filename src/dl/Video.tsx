/**
 * File Description: Top-level Remotion video composition mixing canvas visuals, voiceover narration, sidechain-ducked music, and sound effects.
 * Inputs and outputs: Film props and dimensions -> full Remotion Composition component.
 * Used by: src/Root.tsx, backend/insetStage.test.ts.
 */

import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { FilmView } from "./Film";
import { TOTAL_FRAMES, FILM, TIMELINE, FPS, type FilmProps } from "./runtime";
import { calculateDuckingVolume, type SpeechInterval } from "./audio/ducking";
import { getRetimedAudioRelPath } from "./audio/retime";
import { generateWordsFromFilm } from "./captionsParser";
import type { Film } from "./schema";
import type { TimedShot } from "./camera";

/**
 * The film plus its soundtrack.
 *
 * Mixes three audio layers (voiceover, music with sidechain ducking, and sfx).
 */

export type VideoProps = FilmProps & {
  film?: Film;
  timeline?: TimedShot[];
};

// Calculates narration volume level ramped at head and tail.
export const voiceLevel = (frame: number, level: number, total: number = TOTAL_FRAMES) =>
  level *
  Math.min(1, frame / 6) *
  Math.min(1, Math.max(0, total - frame) / 12);

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
  const effectiveFps = film.fps ?? FPS;
  const effectiveTotalFrames = timeline.length > 0 ? timeline[timeline.length - 1].to : TOTAL_FRAMES;
  const effectiveVoiceoverSrc = (voiceoverSrc ?? "").trim() || film.voiceover?.src || "";
  const effectiveVoiceoverVolume = voiceoverVolume ?? film.voiceover?.volume ?? 1;
  const effectiveMusicSrc = (musicSrc ?? "").trim() || film.music?.src || film.audio?.src || "";
  const effectiveMusicVolume = musicVolume ?? film.music?.volume ?? 1;

  // Extract speech intervals from audio clips or timeline shots with narration
  const speechIntervals: SpeechInterval[] =
    film.audioClips && film.audioClips.length > 0
      ? film.audioClips
          .filter((ac) => (ac.channel ?? "voiceover") === "voiceover")
          .map((ac) => ({
            startSec: ac.position,
            endSec: ac.position + (ac.end - (ac.start ?? 0)) / (ac.speed ?? 1.0),
          }))
      : timeline.filter((t) => Boolean(t.shot.scriptText)).map((t) => ({
          startSec: t.from / effectiveFps,
          endSec: t.to / effectiveFps,
        }));

  return (
    <>
      {/* 1. Background Music Track (with ducking) */}
      {effectiveMusicSrc.trim().length > 0 ? (
        <Audio
          key={`aideos-music-${film.id}`}
          src={staticFile(effectiveMusicSrc)}
          trimBefore={Math.round((film.audio?.trimBefore ?? 0) * effectiveFps)}
          volume={(f) =>
            calculateDuckingVolume({
              frame: f,
              fps: effectiveFps,
              totalFrames: effectiveTotalFrames,
              musicVolume: effectiveMusicVolume,
              duckUnderVoiceover: film.music?.duckUnderVoiceover ?? true,
              speechIntervals,
            })
          }
        />
      ) : null}

      {/* 2. Voiceover & Multi-Clip Audio Track */}
      {film.audioClips && film.audioClips.length > 0 ? (
        film.audioClips
          .filter((ac) => ac.channel !== "music" || !effectiveMusicSrc)
          .map((ac) => {
            const speed = ac.speed ?? 1.0;
            const isRetimed = Math.abs(speed - 1.0) > 0.001;
            const startFrame = Math.round(ac.position * effectiveFps);
            const durFrames = Math.max(1, Math.round(ac.end * effectiveFps) - Math.round((ac.start ?? 0) * effectiveFps));
            const startFrom = Math.round((ac.start ?? 0) * effectiveFps);
            const clipLevel = (ac.volume ?? 1) * effectiveVoiceoverVolume;
            const audioSrc = isRetimed
              ? staticFile(ac.retimedSrc || getRetimedAudioRelPath(ac.src, speed))
              : staticFile(ac.src);

            return (
              <Sequence key={ac.id} from={startFrame} durationInFrames={durFrames}>
                <Audio
                  src={audioSrc}
                  trimBefore={startFrom}
                  playbackRate={1.0}
                  volume={(f) => voiceLevel(f + startFrame, clipLevel, effectiveTotalFrames)}
                />
              </Sequence>
            );
          })
      ) : effectiveVoiceoverSrc.trim().length > 0 ? (
        (() => {
          const speed = film.voiceover?.speed ?? 1.0;
          const isRetimed = Math.abs(speed - 1.0) > 0.001;
          const audioSrc = isRetimed
            ? staticFile(film.voiceover?.retimedSrc || getRetimedAudioRelPath(effectiveVoiceoverSrc, speed))
            : staticFile(effectiveVoiceoverSrc);

          return (
            <Audio
              key={`aideos-voiceover-${film.id}-${speed}`}
              src={audioSrc}
              playbackRate={1.0}
              volume={(f) => voiceLevel(f, effectiveVoiceoverVolume, effectiveTotalFrames)}
            />
          );
        })()
      ) : null}

      {/* 3. Transition Sound Effects (SFX) Track */}
      {film.sfx && film.sfx.length > 0
        ? film.sfx.map((sfx, idx) => {
            const startFrame = Math.round(sfx.timeSec * effectiveFps);
            return (
              <Sequence key={`sfx-${idx}-${sfx.src}`} from={startFrame}>
                <Audio src={staticFile(sfx.src)} volume={() => sfx.volume ?? 1} />
              </Sequence>
            );
          })
        : null}

      <FilmView
        film={film}
        timeline={timeline}
        accent={accent}
        showGrid={showGrid}
        showRail={showRail}
        captionWords={
          film.subtitles === false
            ? []
            : generateWordsFromFilm(film as unknown as Record<string, unknown>)
        }
        includeAudio={false}
      />
    </>
  );
};


