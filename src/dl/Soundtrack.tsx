/**
 * File Description: Shared soundtrack component mixing multi-clip audio tracks, background music with sidechain ducking, narration spine, end card voice, and sound effects.
 * Inputs and outputs: Film and timeline props -> rendered Remotion audio elements and sequences.
 * Used by: src/dl/Video.tsx (render path) and src/dl/Film.tsx (FilmView preview path).
 */

import React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { deliveryTimeline, formatForSize } from "./delivery";
import { EndCardVoice } from "./EndCard";
import { TOTAL_FRAMES, FILM, TIMELINE, FPS } from "./runtime";
import { calculateDuckingVolume, type SpeechInterval } from "./audio/ducking";
import { getRetimedAudioRelPath } from "./audio/retime";
import type { Film } from "./schema";
import type { TimedShot } from "./camera";

export type SoundtrackProps = {
  film?: Film;
  timeline?: TimedShot[];
  voiceoverSrc?: string;
  voiceoverVolume?: number;
  musicSrc?: string;
  musicVolume?: number;
};

// Calculates narration volume level ramped at head and tail.
export const voiceLevel = (frame: number, level: number, total: number = TOTAL_FRAMES) =>
  level *
  Math.min(1, frame / 6) *
  Math.min(1, Math.max(0, total - frame) / 12);

// Renders the shared soundtrack with ducked music, narration spine or clips, sound effects and end-card audio.
export const Soundtrack: React.FC<SoundtrackProps> = ({
  film = FILM,
  timeline = TIMELINE,
  voiceoverSrc,
  voiceoverVolume,
  musicSrc,
  musicVolume,
}) => {
  const { width, height } = useVideoConfig();
  const effectiveFps = film.fps ?? FPS;
  // The narration fades against the end of the story; music runs on under the end card to the
  // end of the delivered video.
  const effectiveTotalFrames = timeline.length > 0 ? timeline[timeline.length - 1].to : TOTAL_FRAMES;
  const delivery = deliveryTimeline(film, formatForSize(width, height), { timeline });
  const card = delivery.card;
  const effectiveVoiceoverSrc = (voiceoverSrc ?? "").trim() || film.voiceover?.src || "";
  const effectiveVoiceoverVolume = voiceoverVolume ?? film.voiceover?.volume ?? 1;
  const effectiveMusicSrc = (musicSrc ?? "").trim() || film.music?.src || film.audio?.src || "";
  const effectiveMusicVolume = musicVolume ?? film.music?.volume ?? 1;
  const audioClips = film.audioClips ?? [];
  const hasPrimaryMusicClip = audioClips.some((ac) => ac.id === "clip-music-main" && ac.channel === "music");

  // Extract speech intervals from audio clips or timeline shots with narration
  const voClips = film.audioClips?.filter((ac) => (ac.channel ?? "voiceover") === "voiceover") ?? [];
  const speechIntervals: SpeechInterval[] =
    voClips.length > 0
      ? voClips.map((ac) => ({
          startSec: ac.position,
          endSec: ac.position + (ac.end - (ac.start ?? 0)) / (ac.speed ?? 1.0),
        }))
      : timeline.filter((t) => Boolean(t.shot.scriptText)).map((t) => ({
          startSec: t.from / effectiveFps,
          endSec: t.to / effectiveFps,
        }));
  // The music ducks under the end card's spoken line too.
  if (card && film.endCardVoice && card.lineFrom !== null) {
    speechIntervals.push({
      startSec: card.lineFrom / effectiveFps,
      endSec: card.lineFrom / effectiveFps + film.endCardVoice.durationSec,
    });
  }

  const hasVoiceoverClips = voClips.length > 0;

  return (
    <>
      {/* 1. Background Music Track (with ducking) */}
      {!hasPrimaryMusicClip && effectiveMusicSrc.trim().length > 0 ? (
        <Audio
          key={`aideos-music-${film.id}`}
          src={staticFile(effectiveMusicSrc)}
          trimBefore={Math.round((film.audio?.trimBefore ?? 0) * effectiveFps)}
          volume={(f) =>
            calculateDuckingVolume({
              frame: f,
              fps: effectiveFps,
              totalFrames: delivery.totalFrames,
              musicVolume: effectiveMusicVolume,
              duckUnderVoiceover: film.music?.duckUnderVoiceover ?? true,
              speechIntervals,
            })
          }
        />
      ) : null}

      {/* 2. Voiceover & Multi-Clip Audio Track */}
      {audioClips.length > 0
        ? audioClips.map((ac) => {
            const speed = ac.speed ?? 1.0;
            const isRetimed = Math.abs(speed - 1.0) > 0.001;
            const startFrame = Math.round(ac.position * effectiveFps);
            const isMusicClip = ac.channel === "music";
            const durFrames =
              isMusicClip &&
              delivery.card &&
              ac.position + (ac.end - (ac.start ?? 0)) >= effectiveTotalFrames / effectiveFps - 0.05
                ? Math.round(delivery.totalFrames) - startFrame
                : Math.max(1, Math.round(ac.end * effectiveFps) - Math.round((ac.start ?? 0) * effectiveFps));
            const startFrom = Math.round((ac.start ?? 0) * effectiveFps);
            const clipLevel = isMusicClip
              ? ac.id === "clip-music-main"
                ? (ac.volume ?? 1)
                : (ac.volume ?? 1) * effectiveMusicVolume
              : (ac.volume ?? 1) * effectiveVoiceoverVolume;
            const audioSrc = isRetimed
              ? staticFile(ac.retimedSrc || getRetimedAudioRelPath(ac.src, speed))
              : staticFile(ac.src);

            return (
              <Sequence key={ac.id} from={startFrame} durationInFrames={durFrames}>
                <Audio
                  src={audioSrc}
                  trimBefore={startFrom}
                  playbackRate={1.0}
                  volume={(f) =>
                    isMusicClip
                      ? calculateDuckingVolume({
                          frame: f + startFrame,
                          fps: effectiveFps,
                          totalFrames: delivery.totalFrames,
                          musicVolume: clipLevel,
                          duckUnderVoiceover: true,
                          speechIntervals,
                        })
                      : voiceLevel(f + startFrame, clipLevel, effectiveTotalFrames)
                  }
                />
              </Sequence>
            );
          })
        : null}

      {!hasVoiceoverClips && effectiveVoiceoverSrc.trim().length > 0 ? (
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

      {/* 3. The end card's spoken line, at the narration's own level */}
      {card ? <EndCardVoice film={film} card={card} volume={effectiveVoiceoverVolume} /> : null}

      {/* 4. Transition Sound Effects (SFX) Track */}
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
    </>
  );
};
