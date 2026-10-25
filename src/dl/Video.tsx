/**
 * File Description: Top-level Remotion video composition mixing canvas visuals, voiceover narration, sidechain-ducked music, sound effects and the end card's spoken line.
 * Inputs and outputs: Film props and dimensions -> full Remotion Composition component.
 * Used by: src/Root.tsx, backend/insetStage.test.ts.
 */

import React, { useMemo } from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { FilmView } from "./Film";
import { deliveryTimeline, formatForSize, DELIVERY_CONFIG } from "./delivery";
import { EndCardVoice } from "./EndCard";
import { TOTAL_FRAMES, FILM, TIMELINE, REEL_FILM, REEL_TIMELINE, FPS, type FilmProps } from "./runtime";
import { calculateDuckingVolume, type SpeechInterval } from "./audio/ducking";
import { getRetimedAudioRelPath } from "./audio/retime";
import { captionWordsForFilm } from "./captionsParser";
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
  const { width, height } = useVideoConfig();
  const effectiveFps = film.fps ?? FPS;
  // The narration fades against the end of the story; music runs on under the end card to the
  // end of the delivered video.
  const effectiveTotalFrames = timeline.length > 0 ? timeline[timeline.length - 1].to : TOTAL_FRAMES;
  const delivery = deliveryTimeline(film, formatForSize(width, height), { timeline });
  if (delivery.format === "reel" && delivery.totalFrames / film.fps > DELIVERY_CONFIG.reel.maxSec) {
    throw new Error(`needs reel cut: delivered reel exceeds the ${DELIVERY_CONFIG.reel.maxSec} s cap`);
  }
  const card = delivery.card;
  const effectiveVoiceoverSrc = (voiceoverSrc ?? "").trim() || film.voiceover?.src || "";
  const effectiveVoiceoverVolume = voiceoverVolume ?? film.voiceover?.volume ?? 1;
  const effectiveMusicSrc = (musicSrc ?? "").trim() || film.music?.src || film.audio?.src || "";
  const effectiveMusicVolume = musicVolume ?? film.music?.volume ?? 1;
  const captionWords = useMemo(() => captionWordsForFilm(film), [film]);

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
  // The music ducks under the end card's spoken line too.
  if (card && film.endCardVoice && card.lineFrom !== null) {
    speechIntervals.push({
      startSec: card.lineFrom / effectiveFps,
      endSec: card.lineFrom / effectiveFps + film.endCardVoice.durationSec,
    });
  }

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
              totalFrames: delivery.totalFrames,
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

// Renders the reel's own timing and soundtrack through the shared video tree.
export const ReelVideo: React.FC<FilmProps> = (props) => <Video {...props} film={REEL_FILM} timeline={REEL_TIMELINE} />;


