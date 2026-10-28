/**
 * File Description: Shared soundtrack component mixing multi-clip audio tracks, background music with sidechain ducking, narration spine, end card voice, and sound effects.
 * Inputs and outputs: Film and timeline props -> rendered Remotion audio elements and sequences.
 * Used by: src/dl/Video.tsx (render), src/dl/Film.tsx (preview) and src/dl/reviewAudio.tsx (review stems).
 */

import React from "react";
import { Audio, Sequence, staticFile, useDelayRender, useVideoConfig } from "remotion";
import { deliveryTimeline, formatForSize } from "./delivery";
import { EndCardVoice } from "./EndCard";
import { calculateDuckingVolume, type SpeechInterval } from "./audio/ducking";
import { getRetimedAudioRelPath } from "./audio/retime";
import { normalizeFilmSoundtrack, type Film } from "./schema";
import { totalFrames, type TimedShot } from "./camera";
import {
  dbGain, effectGain, isLibrarySource, mergeSpeech, mixSections, sectionEnvelope, speechGain, usesSectionMixer,
  soundtrackItem, soundtrackItemSrc,
} from "./audio/sectionMixer";

export { normalizeFilmSoundtrack };

// Loads the ESM-only frame audio implementation when an authored section first needs it.
const FrameAudio = React.lazy(async () => ({ default: (await import("@remotion/media")).Audio }));

// Holds rendering while frame audio loads, then releases the hold when Suspense unmounts this fallback.
const LoadingFrameAudio: React.FC = () => {
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = React.useState(() => delayRender("Loading soundtrack frame audio"));
  React.useEffect(() => () => continueRender(handle), [continueRender, handle]);
  return null;
};

export type SoundtrackProps = {
  film: Film;
  stem?: "music" | "narration";
  timeline: TimedShot[];
  voiceoverSrc?: string;
  voiceoverVolume?: number;
  musicSrc?: string;
  musicVolume?: number;
};

// Calculates narration volume level ramped at head and tail.
export const voiceLevel = (frame: number, level: number, total: number) =>
  level *
  Math.min(1, frame / 6) *
  Math.min(1, Math.max(0, total - frame) / 12);

// Renders the shared soundtrack with ducked music, narration spine or clips, sound effects and end-card audio.
export const Soundtrack: React.FC<SoundtrackProps> = ({
  film,
  stem,
  timeline,
  voiceoverSrc,
  voiceoverVolume,
  musicSrc,
  musicVolume,
}) => {
  const { width, height } = useVideoConfig();
  const effectiveFps = film.fps;
  // The narration fades against the end of the story; music runs on under the end card to the
  // end of the delivered video.
  const effectiveTotalFrames = totalFrames(timeline);
  const delivery = deliveryTimeline(film, formatForSize(width, height), { timeline });
  const card = delivery.card;
  const effectiveVoiceoverSrc = (voiceoverSrc ?? "").trim() || film.voiceover?.src || "";
  const effectiveVoiceoverVolume = voiceoverVolume ?? film.voiceover?.volume ?? 1;

  const soundtrack = normalizeFilmSoundtrack(film);
  const sectionMix = usesSectionMixer(soundtrack);
  const effectMix = Boolean(film.soundtrack?.sfx.some(isLibrarySource));
  const sections = sectionMix ? mixSections(soundtrack, delivery) : [];
  const primarySection = soundtrack.sections[0];
  const requestedMusicSrc = (musicSrc ?? "").trim();
  const effectiveMusicSrc = requestedMusicSrc || primarySection?.src || primarySection?.item || "";
  const effectiveMusicVolume = musicVolume ?? primarySection?.volume ?? 1;
  const audioClips = film.audioClips ?? [];
  const duplicatePrimaryMusicClipId = audioClips.find(
    (ac) =>
      (ac.id === "clip-music-main" || ac.id === "clip-music-section-0") &&
      ac.channel === "music" &&
      ac.src === effectiveMusicSrc &&
      ac.position === 0 &&
      (ac.start ?? 0) === 0,
  )?.id;

  // Extract speech intervals from audio clips or timeline shots with narration
  const voClips = film.audioClips?.filter((ac) => (ac.channel ?? "voiceover") === "voiceover") ?? [];
  const speechIntervals: SpeechInterval[] =
    soundtrack.speech.length > 0
      ? [...soundtrack.speech]
      : voClips.length > 0
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
  // Authored soundtracks honor measured silence, including an intentionally empty speech list.
  const measuredSpeech = mergeSpeech([
    ...soundtrack.speech.map((interval) => ({
      startSec: interval.startSec,
      endSec: Math.min(interval.endSec, effectiveTotalFrames / effectiveFps),
    })),
    ...(card && film.endCardVoice && card.lineFrom !== null ? [{
      startSec: card.lineFrom / effectiveFps,
      endSec: Math.min(card.to / effectiveFps, card.lineFrom / effectiveFps + film.endCardVoice.durationSec),
    }] : []),
  ]);

  return (
    <>
      {/* 1. Background Music Track (with ducking) */}
      {stem !== "narration" && (sectionMix ? sections.map((section, index) => (
        <Sequence key={`music-section-${index}`} from={section.from} durationInFrames={section.durationInFrames}>
          {/* Frame audio applies each gain to its own samples, avoiding packet-sized gain holds. */}
          <React.Suspense fallback={<LoadingFrameAudio />}>
          <FrameAudio
            src={staticFile(section.src)}
            disallowFallbackToHtml5Audio
            trimBefore={section.trimBefore}
            trimAfter={section.trimBefore + section.durationInFrames}
            volume={(frame) => section.gain * (musicVolume ?? 1) * sectionEnvelope(section, frame) *
              (section.duck ? speechGain(
                (frame + section.from) / effectiveFps, measuredSpeech, soundtrack.mix,
                effectiveTotalFrames / effectiveFps,
              ) : dbGain(soundtrack.mix.musicOnlyGainDb))}
          />
          </React.Suspense>
        </Sequence>
      )) : effectiveMusicSrc.trim().length > 0 ? (
        <Audio
          key={`aideos-music-${film.id}`}
          src={staticFile(effectiveMusicSrc)}
          trimBefore={Math.round((primarySection?.offsetSec ?? film.audio?.trimBefore ?? 0) * effectiveFps)}
          volume={(f) =>
            calculateDuckingVolume({
              frame: f,
              fps: effectiveFps,
              totalFrames: delivery.totalFrames,
              musicVolume: effectiveMusicVolume,
              duckUnderVoiceover: primarySection?.duckUnderVoiceover ?? film.music?.duckUnderVoiceover ?? true,
              speechIntervals,
            })
          }
        />
      ) : null)}

      {/* 2. Voiceover & Multi-Clip Audio Track */}
      {audioClips.length > 0
        ? audioClips.filter((ac) => ac.id !== duplicatePrimaryMusicClipId &&
          (!sectionMix || ac.channel !== "music") && (!effectMix || ac.channel !== "sfx") &&
          (!stem || (stem === "music" ? ac.channel === "music" : (ac.channel ?? "voiceover") === "voiceover"))).map((ac) => {
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
              ? (ac.volume ?? 1) * effectiveMusicVolume
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

      {stem !== "music" && !hasVoiceoverClips && effectiveVoiceoverSrc.trim().length > 0 ? (
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
      {stem !== "music" && card ? <EndCardVoice film={film} card={card} volume={effectiveVoiceoverVolume} /> : null}

      {/* 4. Transition Sound Effects (SFX) Track */}
      {!stem && soundtrack.sfx.length > 0
        ? soundtrack.sfx.map((sfx, idx) => {
            const startFrame = Math.round(sfx.timeSec * effectiveFps);
            const mixedEffect = isLibrarySource(sfx);
            const item = mixedEffect ? soundtrackItem(sfx.item, sfx.sha256) : null;
            const sfxSrc = sfx.src || (item ? soundtrackItemSrc(item) : sfx.item);
            const durationInFrames = item ? Math.max(1, Math.ceil(item.durationSec * effectiveFps)) : undefined;
            return (
              <Sequence key={`sfx-${idx}-${sfxSrc}`} from={startFrame} durationInFrames={durationInFrames}>
                <Audio src={staticFile(sfxSrc)} useWebAudioApi={mixedEffect} allowAmplificationDuringRender={mixedEffect}
                  volume={() => mixedEffect ? effectGain(sfx, soundtrack.mix,
                    (soundtrack.narrationPeakDb ?? -1) + 20 * Math.log10(effectiveVoiceoverVolume || 1e-10),
                  ) : sfx.volume ?? 1} />
              </Sequence>
            );
          })
        : null}
    </>
  );
};
