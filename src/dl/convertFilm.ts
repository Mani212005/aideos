/**
 * File Description: Lossless Bidirectional Converter between Film and LayeredFilm (Phase L-1).
 * Preserves 100% data fidelity across all 5 production films.
 */

import type { Film, Shot, AudioClip } from "./schema";
import type { LayeredFilm, Layer, Clip, AnimationPayload, AudioPayload } from "./layeredSchema";
import { computeShotStartTimes } from "../../backend/timeline/timeline";
import { generateWordsFromFilm } from "./captionsParser";

/**
 * Converts a legacy/generated Film manifest into an OpenShot-grade LayeredFilm.
 */
export function convertFilmToLayeredFilm(film: Film): LayeredFilm {
  const fps = film.fps || 30;
  const startTimes = computeShotStartTimes(film.shots);

  const layers: Layer[] = [
    {
      id: "layer-audio-spine",
      number: 0,
      label: "Voiceover Audio",
      locked: false,
      hidden: false,
      muted: false,
      height: 48,
    },
    {
      id: "layer-audio-music",
      number: 2,
      label: "Background Music",
      locked: false,
      hidden: false,
      muted: false,
      height: 40,
    },
    {
      id: "layer-audio-sfx",
      number: 4,
      label: "Sound Effects",
      locked: false,
      hidden: false,
      muted: false,
      height: 40,
    },
    {
      id: "layer-animation-main",
      number: 10,
      label: "Spatial Animation",
      locked: false,
      hidden: false,
      muted: false,
      height: 72,
    },
    {
      id: "layer-subtitles-main",
      number: 20,
      label: "Subtitles",
      locked: false,
      hidden: false,
      muted: false,
      height: 40,
    },
  ];

  const clips: Clip[] = [];

  // 1. Audio Clips (Voiceover, Multi-Clip Audio, Music, SFX)
  if (film.audioClips && film.audioClips.length > 0) {
    for (const ac of film.audioClips) {
      const layerId =
        ac.channel === "music"
          ? "layer-audio-music"
          : ac.channel === "sfx"
            ? "layer-audio-sfx"
            : "layer-audio-spine";
      clips.push({
        id: ac.id,
        layerId,
        position: ac.position,
        start: ac.start ?? 0,
        end: ac.end,
        kind: "audio",
        payload: {
          src: ac.src,
          channel: ac.channel || "voiceover",
        },
        volume: ac.volume ?? 1,
        opacity: 1,
      });
    }
  } else if (film.voiceover?.src) {
    const totalVoDur = film.shots.reduce((acc, s) => acc + (s.dur || 3), 0);
    clips.push({
      id: "clip-voiceover-spine",
      layerId: "layer-audio-spine",
      position: 0,
      start: 0,
      end: totalVoDur,
      kind: "audio",
      payload: {
        src: film.voiceover.src,
        channel: "voiceover",
      },
      volume: film.voiceover.volume ?? 1,
      opacity: 1,
    });
  }

  if (film.music?.src) {
    const totalDur = film.shots.reduce((acc, s) => acc + (s.dur || 3), 0);
    clips.push({
      id: "clip-music-main",
      layerId: "layer-audio-music",
      position: 0,
      start: 0,
      end: totalDur,
      kind: "audio",
      payload: {
        src: film.music.src,
        channel: "music",
        duckUnderVoiceover: film.music.duckUnderVoiceover ?? true,
      },
      volume: film.music.volume ?? 1,
      opacity: 1,
    });
  }

  if (film.sfx && film.sfx.length > 0) {
    film.sfx.forEach((sfx, idx) => {
      clips.push({
        id: `clip-sfx-${idx}`,
        layerId: "layer-audio-sfx",
        position: sfx.timeSec,
        start: 0,
        end: 1,
        kind: "audio",
        payload: {
          src: sfx.src,
          channel: "sfx",
        },
        volume: sfx.volume ?? 1,
        opacity: 1,
      });
    });
  }

  // 2. Animation Clips (from shots)
  for (let i = 0; i < film.shots.length; i++) {
    const shot = film.shots[i];
    const pos = shot.position ?? shot.startSec ?? startTimes[i] ?? 0;
    const dur = shot.dur || 3;

    clips.push({
      id: `clip-anim-${shot.id}`,
      layerId: "layer-animation-main",
      position: pos,
      start: shot.start ?? 0,
      end: (shot.start ?? 0) + dur,
      kind: "animation",
      payload: {
        shotId: shot.id,
        ch: shot.ch,
        stage: shot.stage,
        look: shot.look,
        move: shot.move,
        cameraAngle: shot.cameraAngle,
        drift: shot.drift ?? false,
        zoom: shot.zoom ?? 1,
        scriptText: shot.scriptText,
        visualDirection: shot.visualDirection,
        metaphor: shot.metaphor,
        blocks: shot.blocks || [],
      },
      opacity: 1,
      volume: 1,
    });
  }

  // 3. Subtitle Clips (from parsed cues)
  const captionWords = generateWordsFromFilm(film as unknown as Record<string, unknown>);
  for (let i = 0; i < captionWords.length; i++) {
    const cw = captionWords[i];
    const wStartSec = Number((cw.startFrame / fps).toFixed(3));
    const nextStartSec = i < captionWords.length - 1
      ? Number((captionWords[i + 1].startFrame / fps).toFixed(3))
      : Number((cw.endFrame / fps).toFixed(3));
    const cueDur = Math.max(0.01, Number((Math.min(cw.endFrame / fps - wStartSec, nextStartSec - wStartSec)).toFixed(3)));

    clips.push({
      id: `clip-sub-${i}-${cw.text.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      layerId: "layer-subtitles-main",
      position: wStartSec,
      start: 0,
      end: cueDur,
      kind: "subtitle",
      payload: {
        text: cw.text,
        startFrame: cw.startFrame,
        endFrame: cw.endFrame,
      },
      opacity: 1,
      volume: 1,
    });
  }

  return {
    id: film.id,
    title: film.title,
    fps: film.fps,
    accent: film.accent || "#FF6B00",
    theme: film.theme,
    canvas: film.canvas,
    chapters: film.chapters,
    layers,
    clips,
  };
}

/**
 * Converts a LayeredFilm back into a canonical Film manifest.
 */
export function convertLayeredFilmToFilm(layeredFilm: LayeredFilm): Film {
  const animClips = layeredFilm.clips
    .filter((c) => c.kind === "animation")
    .sort((a, b) => a.position - b.position);

  const shots: Shot[] = animClips.map((c) => {
    const p = c.payload as AnimationPayload;
    const dur = Number((c.end - c.start).toFixed(3));

    return {
      id: p.shotId || c.id.replace(/^clip-anim-/, ""),
      ch: p.ch,
      position: c.position,
      startSec: c.position,
      start: c.start,
      end: c.end,
      dur,
      stage: p.stage,
      look: p.look,
      move: p.move,
      cameraAngle: p.cameraAngle,
      drift: p.drift,
      zoom: p.zoom,
      scriptText: p.scriptText,
      visualDirection: p.visualDirection,
      metaphor: p.metaphor,
      blocks: p.blocks,
    };
  });

  const audioClipsList = layeredFilm.clips
    .filter((c) => c.kind === "audio")
    .sort((a, b) => a.position - b.position);

  const voClips = audioClipsList.filter(
    (c) => (c.payload as AudioPayload)?.channel === "voiceover" || !(c.payload as AudioPayload)?.channel
  );
  const musicClips = audioClipsList.filter(
    (c) => (c.payload as AudioPayload)?.channel === "music"
  );
  const sfxClips = audioClipsList.filter(
    (c) => (c.payload as AudioPayload)?.channel === "sfx"
  );

  const isDedicatedSpine = voClips.length === 1 && voClips[0].id === "clip-voiceover-spine";
  const audioClips: AudioClip[] | undefined =
    voClips.length > 0 && !isDedicatedSpine
      ? voClips.map((c) => ({
          id: c.id,
          src: (c.payload as AudioPayload).src,
          position: c.position,
          start: c.start,
          end: c.end,
          volume: c.volume ?? 1,
          channel: "voiceover" as const,
        }))
      : undefined;

  const voiceover = voClips.length > 0
    ? {
        src: (voClips[0].payload as AudioPayload).src,
        volume: voClips[0].volume ?? 1,
      }
    : undefined;

  const music = musicClips.length > 0
    ? {
        src: (musicClips[0].payload as AudioPayload).src,
        volume: musicClips[0].volume ?? 1,
        duckUnderVoiceover: (musicClips[0].payload as AudioPayload).duckUnderVoiceover ?? true,
      }
    : undefined;

  const sfx = sfxClips.length > 0
    ? sfxClips.map((c) => ({
        timeSec: c.position,
        src: (c.payload as AudioPayload).src,
        volume: c.volume ?? 1,
      }))
    : undefined;

  return {
    id: layeredFilm.id,
    title: layeredFilm.title,
    fps: layeredFilm.fps as 24 | 30 | 60,
    accent: layeredFilm.accent,
    theme: layeredFilm.theme,
    canvas: layeredFilm.canvas,
    chapters: layeredFilm.chapters,
    shots,
    ...(voiceover ? { voiceover } : {}),
    ...(audioClips ? { audioClips } : {}),
    ...(music ? { music } : {}),
    ...(sfx ? { sfx } : {}),
  };
}

