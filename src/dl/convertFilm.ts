/**
 * File Description: Lossless Bidirectional Converter between Film and LayeredFilm (Phase L-1 and Phase 0).
 * Forward conversion lays a Film out onto z-ordered layers; reverse conversion folds a LayeredFilm
 * back into the canonical Film manifest. The reverse direction accepts the originating Film as a
 * base so every field the layer model does not represent (captions, voiceover metadata, per-shot
 * transition and footage flags, schema version) survives a round trip untouched. Audio clips that
 * the legacy `voiceover`, `music` and `sfx` summary fields cannot fully describe (because they were
 * moved, trimmed, split or imported) are written out to `audioClips`, and imported video clips or
 * standalone overlays are written out to `videoClips` and `overlayClips`, which forward conversion
 * then treats as the authority for those channels.
 */

import type { Film, Shot, AudioClip, VideoClip, OverlayClip } from "./schema";
import type {
  LayeredFilm,
  Layer,
  Clip,
  AnimationPayload,
  AudioPayload,
  VideoPayload,
  TextPayload,
  ImagePayload,
  SubtitlePayload,
} from "./layeredSchema";
import { computeShotStartTimes } from "../../backend/timeline/timeline";
import { generateWordsFromFilm } from "./captionsParser";

/** Ids that forward conversion synthesizes from the legacy summary fields. */
const SPINE_CLIP_ID = "clip-voiceover-spine";
const MUSIC_CLIP_ID = "clip-music-main";

/** Fixed synthetic duration used for an sfx cue, which the Film schema does not store. */
const SFX_CLIP_DURATION = 1;

/** Layer ids used by the forward conversion, kept stable so films reopen with the same lanes. */
export const CONVERTED_LAYER_IDS = {
  voiceover: "layer-audio-spine",
  music: "layer-audio-music",
  sfx: "layer-audio-sfx",
  footage: "layer-audio-footage",
  animation: "layer-animation-main",
  subtitles: "layer-subtitles-main",
  video: "layer-video",
  text: "layer-text-overlay",
  image: "layer-image-overlay",
} as const;

/** Lane ids that are only ever created on demand (never part of the always-present default set). */
const ON_DEMAND_LAYER_IDS: readonly string[] = [
  CONVERTED_LAYER_IDS.footage,
  CONVERTED_LAYER_IDS.video,
  CONVERTED_LAYER_IDS.text,
  CONVERTED_LAYER_IDS.image,
];

/** Resolve which audio lane a channel belongs on. */
function layerIdForChannel(channel: AudioClip["channel"] | undefined): string {
  if (channel === "music") return CONVERTED_LAYER_IDS.music;
  if (channel === "sfx") return CONVERTED_LAYER_IDS.sfx;
  if (channel === "external") return CONVERTED_LAYER_IDS.footage;
  return CONVERTED_LAYER_IDS.voiceover;
}

/** Resolve which lane an overlay clip belongs on by default. */
function layerIdForOverlayKind(kind: OverlayClip["kind"]): string {
  if (kind === "image") return CONVERTED_LAYER_IDS.image;
  if (kind === "subtitle") return CONVERTED_LAYER_IDS.subtitles;
  return CONVERTED_LAYER_IDS.text;
}

/** A subtitle clip whose id matches the pattern forward-conversion synthesizes from voiceover words. */
function isDerivedSubtitleId(id: string): boolean {
  return /^clip-sub-\d+-/.test(id);
}

/** The lane set a film starts with before the user adds, renames or reorders any lane. */
export function defaultTimelineLayers(): Layer[] {
  return [
    { id: CONVERTED_LAYER_IDS.voiceover, number: 0, label: "Voiceover", locked: false, hidden: false, muted: false, height: 52 },
    { id: CONVERTED_LAYER_IDS.music, number: 2, label: "Music", locked: false, hidden: false, muted: false, height: 48 },
    { id: CONVERTED_LAYER_IDS.sfx, number: 4, label: "Sound Effects", locked: false, hidden: false, muted: false, height: 48 },
    { id: CONVERTED_LAYER_IDS.animation, number: 10, label: "Scenes", locked: false, hidden: false, muted: false, height: 76 },
    { id: CONVERTED_LAYER_IDS.subtitles, number: 20, label: "Subtitles", locked: false, hidden: false, muted: false, height: 48 },
  ];
}

/**
 * Converts a legacy/generated Film manifest into an OpenShot-grade LayeredFilm.
 * When the film carries its own `layers` list that list is used verbatim, with any lane a clip
 * still needs appended, so user-created lanes survive a reload.
 */
export function convertFilmToLayeredFilm(film: Film): LayeredFilm {
  const fps = film.fps || 30;
  const startTimes = computeShotStartTimes(film.shots);

  const layers: Layer[] =
    film.layers && film.layers.length > 0
      ? (JSON.parse(JSON.stringify(film.layers)) as Layer[])
      : defaultTimelineLayers();

  /** Guarantee a lane exists before a clip is routed onto it, appending a default when missing. */
  const ensureLayer = (layerId: string): string => {
    if (layers.some((l) => l.id === layerId)) return layerId;
    const fallback = defaultTimelineLayers().find((l) => l.id === layerId);
    if (fallback) {
      layers.push(fallback);
      return layerId;
    }
    if (layerId === CONVERTED_LAYER_IDS.footage) {
      layers.push({
        id: CONVERTED_LAYER_IDS.footage,
        number: 5,
        label: "Footage Audio",
        locked: false,
        hidden: false,
        muted: false,
        height: 48,
      });
      return layerId;
    }
    if (layerId === CONVERTED_LAYER_IDS.video) {
      layers.push({
        id: CONVERTED_LAYER_IDS.video,
        number: 15,
        label: "Video Footage",
        locked: false,
        hidden: false,
        muted: false,
        height: 72,
      });
      return layerId;
    }
    if (layerId === CONVERTED_LAYER_IDS.text) {
      layers.push({
        id: CONVERTED_LAYER_IDS.text,
        number: 16,
        label: "Text Overlays",
        locked: false,
        hidden: false,
        muted: false,
        height: 48,
      });
      return layerId;
    }
    if (layerId === CONVERTED_LAYER_IDS.image) {
      layers.push({
        id: CONVERTED_LAYER_IDS.image,
        number: 17,
        label: "Image Overlays",
        locked: false,
        hidden: false,
        muted: false,
        height: 56,
      });
      return layerId;
    }
    // A lane referenced by a clip but missing from the manifest falls back to the scenes lane.
    return ensureLayer(CONVERTED_LAYER_IDS.animation);
  };

  const clips: Clip[] = [];
  const declaredChannels = new Set<string>();

  // 1. Audio clips. When the film carries an explicit audioClips list, that list is the authority
  //    for every channel it mentions and the legacy summary fields for those channels are skipped.
  if (film.audioClips && film.audioClips.length > 0) {
    for (const ac of film.audioClips) {
      const channel = ac.channel || "voiceover";
      declaredChannels.add(channel);
      const layerId = ensureLayer(ac.layerId ?? layerIdForChannel(channel));
      clips.push({
        id: ac.id,
        layerId,
        position: ac.position,
        start: ac.start ?? 0,
        end: ac.end,
        kind: "audio",
        payload: {
          src: ac.src,
          channel,
          speed: ac.speed,
          retimedSrc: ac.retimedSrc,
        },
        linkedClipId: ac.linkedClipId ?? null,
        volume: Math.min(1, ac.volume ?? 1),
        opacity: 1,
      });
    }
  }

  if (!declaredChannels.has("voiceover") && film.voiceover?.src) {
    const totalVoDur =
      film.voiceover.durationSec && film.voiceover.durationSec > 0
        ? film.voiceover.durationSec
        : film.shots.reduce((acc, s) => acc + (s.dur || 3), 0);
    clips.push({
      id: SPINE_CLIP_ID,
      layerId: ensureLayer(CONVERTED_LAYER_IDS.voiceover),
      position: 0,
      start: 0,
      end: totalVoDur,
      sourceDuration: film.voiceover.durationSec,
      kind: "audio",
      payload: { src: film.voiceover.src, channel: "voiceover" },
      volume: Math.min(1, film.voiceover.volume ?? 1),
      opacity: 1,
    });
  }

  if (!declaredChannels.has("music") && film.music?.src) {
    const totalDur = film.shots.reduce((acc, s) => acc + (s.dur || 3), 0);
    clips.push({
      id: MUSIC_CLIP_ID,
      layerId: ensureLayer(CONVERTED_LAYER_IDS.music),
      position: 0,
      start: 0,
      end: totalDur,
      kind: "audio",
      payload: {
        src: film.music.src,
        channel: "music",
        duckUnderVoiceover: film.music.duckUnderVoiceover ?? true,
      },
      volume: Math.min(1, film.music.volume ?? 1),
      opacity: 1,
    });
  }

  if (!declaredChannels.has("sfx") && film.sfx && film.sfx.length > 0) {
    film.sfx.forEach((sfx, idx) => {
      clips.push({
        id: `clip-sfx-${idx}`,
        layerId: ensureLayer(CONVERTED_LAYER_IDS.sfx),
        position: sfx.timeSec,
        start: 0,
        end: SFX_CLIP_DURATION,
        kind: "audio",
        payload: { src: sfx.src, channel: "sfx" },
        volume: Math.min(1, sfx.volume ?? 1),
        opacity: 1,
      });
    });
  }

  // 1b. Video clips: imported footage pictures. Symmetric with the audioClips branch above.
  if (film.videoClips && film.videoClips.length > 0) {
    for (const vc of film.videoClips) {
      const layerId = ensureLayer(vc.layerId ?? CONVERTED_LAYER_IDS.video);
      clips.push({
        id: vc.id,
        layerId,
        position: vc.position,
        start: vc.start ?? 0,
        end: vc.end,
        sourceDuration: vc.sourceDuration,
        kind: "video",
        payload: { src: vc.src, width: vc.width, height: vc.height },
        linkedClipId: vc.linkedClipId ?? null,
        volume: vc.muted ? 0 : Math.min(1, vc.volume ?? 1),
        opacity: vc.opacity ?? 1,
      });
    }
  }

  // 1c. Overlay clips: text / image / standalone-subtitle clips the shot list cannot represent.
  if (film.overlayClips && film.overlayClips.length > 0) {
    for (const oc of film.overlayClips) {
      const layerId = ensureLayer(oc.layerId ?? layerIdForOverlayKind(oc.kind));
      clips.push({
        id: oc.id,
        layerId,
        position: oc.position,
        start: oc.start ?? 0,
        end: oc.end,
        kind: oc.kind,
        payload: oc.payload,
        opacity: oc.opacity ?? 1,
        volume: 1,
      });
    }
  }

  // 2. Animation clips, one per shot.
  for (let i = 0; i < film.shots.length; i++) {
    const shot = film.shots[i];
    const pos = shot.position ?? shot.startSec ?? startTimes[i] ?? 0;
    const dur = shot.dur || 3;

    clips.push({
      id: `clip-anim-${shot.id}`,
      layerId: ensureLayer(shot.layerId ?? CONVERTED_LAYER_IDS.animation),
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
        speed: shot.speed,
        scriptText: shot.scriptText,
        visualDirection: shot.visualDirection,
        metaphor: shot.metaphor,
        blocks: shot.blocks || [],
      },
      opacity: 1,
      volume: 1,
    });
  }

  // 3. Subtitle clips derived from the parsed caption cues (when no explicit overlay subtitles exist).
  const hasExplicitSubtitles = Boolean(film.overlayClips?.some((oc) => oc.kind === "subtitle"));
  if (!hasExplicitSubtitles) {
    const captionWords = generateWordsFromFilm(film as unknown as Record<string, unknown>);
    for (let i = 0; i < captionWords.length; i++) {
      const cw = captionWords[i];
      const wStartSec = Number((cw.startFrame / fps).toFixed(3));
      const nextStartSec =
        i < captionWords.length - 1
          ? Number((captionWords[i + 1].startFrame / fps).toFixed(3))
          : Number((cw.endFrame / fps).toFixed(3));
      const cueDur = Math.max(
        0.01,
        Number(Math.min(cw.endFrame / fps - wStartSec, nextStartSec - wStartSec).toFixed(3)),
      );

      clips.push({
        id: `clip-sub-${i}-${cw.text.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        layerId: ensureLayer(CONVERTED_LAYER_IDS.subtitles),
        position: wStartSec,
        start: 0,
        end: cueDur,
        kind: "subtitle",
        payload: { text: cw.text, startFrame: cw.startFrame, endFrame: cw.endFrame },
        opacity: 1,
        volume: 1,
      });
    }
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

/** True when an audio clip is exactly what forward conversion would synthesize from `voiceover`. */
function isPlainSpine(clip: Clip): boolean {
  const p = clip.payload as AudioPayload | undefined;
  const isDefaultSpeed = !p?.speed || Math.abs(p.speed - 1) < 0.001;
  return clip.id === SPINE_CLIP_ID && clip.position === 0 && clip.start === 0 && isDefaultSpeed;
}

/** True when an audio clip is exactly what forward conversion would synthesize from `music`. */
function isPlainMusic(clip: Clip): boolean {
  return clip.id === MUSIC_CLIP_ID && clip.position === 0 && clip.start === 0;
}

/** True when an audio clip is exactly what forward conversion would synthesize from `sfx`. */
function isPlainSfx(clip: Clip): boolean {
  return /^clip-sfx-\d+$/.test(clip.id) && clip.start === 0 && clip.end === SFX_CLIP_DURATION;
}

/** True when a lane list is still exactly the derived default set, ignoring lane order. */
function isDefaultLayerSet(layers: Layer[]): boolean {
  const defaults = defaultTimelineLayers();
  const byId = new Map(defaults.map((l) => [l.id, l]));
  // Lanes created on demand (footage audio, video, text/image overlays) do not count as a user
  // change: their presence only reflects that an import or an AI edit used them.
  const meaningful = layers.filter((l) => !ON_DEMAND_LAYER_IDS.includes(l.id));
  if (meaningful.length !== defaults.length) return false;
  return meaningful.every((l) => {
    const d = byId.get(l.id);
    return (
      d !== undefined &&
      d.number === l.number &&
      d.label === l.label &&
      d.locked === l.locked &&
      d.hidden === l.hidden &&
      d.muted === l.muted &&
      d.height === l.height
    );
  });
}

/**
 * Converts a LayeredFilm back into a canonical Film manifest.
 * Pass the Film the layered copy was derived from as `base` so fields outside the layer model
 * (captions, voiceover metadata, per-shot transition and footage flags) round trip unchanged.
 */
export function convertLayeredFilmToFilm(layeredFilm: LayeredFilm, base?: Film): Film {
  const baseShots = new Map<string, Shot>((base?.shots ?? []).map((s) => [s.id, s]));

  const animClips = layeredFilm.clips
    .filter((c) => c.kind === "animation")
    .sort((a, b) => a.position - b.position);

  const shots: Shot[] = animClips.map((c) => {
    const p = c.payload as AnimationPayload;
    const dur = Number((c.end - c.start).toFixed(3));
    const shotId = p.shotId || c.id.replace(/^clip-anim-/, "");
    const original = baseShots.get(shotId);

    return {
      // Fields the layer model does not represent are carried through from the base shot.
      ...(original ?? {}),
      id: shotId,
      // Only shots dragged off the default scene lane need to record where they live, so an
      // ordinary edit does not rewrite every shot in the manifest.
      layerId: c.layerId === CONVERTED_LAYER_IDS.animation ? undefined : c.layerId,
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
      speed: p.speed,
      scriptText: p.scriptText,
      visualDirection: p.visualDirection,
      metaphor: p.metaphor,
      blocks: p.blocks,
    };
  });

  const audioClipsList = layeredFilm.clips.filter((c) => c.kind === "audio").sort((a, b) => a.position - b.position);

  /** Read the channel off an audio clip payload, defaulting to the voiceover channel. */
  const channelOf = (c: Clip): AudioClip["channel"] => (c.payload as AudioPayload)?.channel ?? "voiceover";

  const voClips = audioClipsList.filter((c) => channelOf(c) === "voiceover");
  const musicClips = audioClipsList.filter((c) => channelOf(c) === "music");
  const sfxClips = audioClipsList.filter((c) => channelOf(c) === "sfx");

  // Only clips that the summary fields cannot fully describe need an explicit audioClips entry.
  const explicitClips = audioClipsList.filter(
    (c) => !(isPlainSpine(c) || isPlainMusic(c) || isPlainSfx(c)),
  );

  const audioClips: AudioClip[] | undefined =
    explicitClips.length > 0
      ? explicitClips.map((c) => {
          const p = c.payload as AudioPayload;
          return {
            id: c.id,
            src: p.src,
            position: c.position,
            start: c.start,
            end: c.end,
            volume: c.volume ?? 1,
            speed: p.speed,
            retimedSrc: p.retimedSrc,
            channel: channelOf(c),
            layerId: c.layerId === layerIdForChannel(channelOf(c)) ? undefined : c.layerId,
            linkedClipId: c.linkedClipId ?? undefined,
          };
        })
      : undefined;

  const videoClipsList = layeredFilm.clips.filter((c) => c.kind === "video").sort((a, b) => a.position - b.position);
  const videoClips: VideoClip[] | undefined =
    videoClipsList.length > 0
      ? videoClipsList.map((c) => {
          const p = c.payload as VideoPayload;
          return {
            id: c.id,
            src: p.src,
            position: c.position,
            start: c.start,
            end: c.end,
            sourceDuration: c.sourceDuration,
            width: p.width,
            height: p.height,
            opacity: c.opacity ?? 1,
            volume: c.volume ?? 1,
            layerId: c.layerId === CONVERTED_LAYER_IDS.video ? undefined : c.layerId,
            linkedClipId: c.linkedClipId ?? undefined,
          };
        })
      : undefined;

  // Only text/image clips and *non-derived* subtitle clips need an explicit overlayClips entry;
  // a subtitle clip generated from the voiceover words stays derived and is never written out.
  const overlaySourceClips = layeredFilm.clips.filter(
    (c) => c.kind === "text" || c.kind === "image" || (c.kind === "subtitle" && !isDerivedSubtitleId(c.id)),
  );
  const overlayClips: OverlayClip[] | undefined =
    overlaySourceClips.length > 0
      ? overlaySourceClips
          .sort((a, b) => a.position - b.position)
          .map((c) => ({
            id: c.id,
            kind: c.kind as OverlayClip["kind"],
            position: c.position,
            start: c.start,
            end: c.end,
            opacity: c.opacity ?? 1,
            layerId: c.layerId === layerIdForOverlayKind(c.kind as OverlayClip["kind"]) ? undefined : c.layerId,
            payload: c.payload as TextPayload | ImagePayload | SubtitlePayload,
          }))
      : undefined;

  const voiceover = voClips.length > 0
    ? {
        ...(base?.voiceover ?? {}),
        src: (voClips[0].payload as AudioPayload).src,
        volume: voClips[0].volume ?? 1,
      }
    : base?.voiceover;

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
    ...(base ?? {}),
    id: layeredFilm.id,
    title: layeredFilm.title,
    fps: layeredFilm.fps as 24 | 30 | 60,
    accent: layeredFilm.accent,
    theme: layeredFilm.theme,
    canvas: layeredFilm.canvas,
    chapters: layeredFilm.chapters,
    shots,
    // Lanes are only written out once they differ from the derived default set, so untouched
    // films never gain a layers block they did not ask for.
    ...(isDefaultLayerSet(layeredFilm.layers) ? { layers: base?.layers } : { layers: layeredFilm.layers }),
    ...(voiceover ? { voiceover } : {}),
    ...(audioClips ? { audioClips } : { audioClips: undefined }),
    ...(videoClips ? { videoClips } : { videoClips: undefined }),
    ...(overlayClips ? { overlayClips } : { overlayClips: undefined }),
    ...(music ? { music } : {}),
    ...(sfx ? { sfx } : {}),
  };
}
