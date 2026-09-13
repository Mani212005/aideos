/**
 * File Description: Audio-first timing helpers for the Aideos scene graph.
 * The video pipeline locks visuals to a recorded narration, so a scene's length is derived from its
 * audio segment rather than chosen. These helpers convert between milliseconds and frames, align a
 * scene to an audio segment so it satisfies validation Rule 14, and retime an animation timeline
 * proportionally when a scene is re-clocked to a different take. Pure: no Node imports.
 */

import type { Scene } from "./types";
import type { SvgAnimationClip, SvgAnimationTimeline } from "./svgAnimation";

/** The tolerance Rule 14 allows between a scene's frame count and its audio length. */
export const AUDIO_SYNC_TOLERANCE_MS = 50;

/** Converts an audio duration in milliseconds to the nearest whole frame count at a given fps. */
export function framesForAudioMs(audioDurationMs: number, fps: number): number {
  if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0) {
    throw new Error(`INVALID_AUDIO_DURATION: expected a positive duration in ms, got ${audioDurationMs}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`INVALID_FPS: expected a positive fps, got ${fps}`);
  }
  return Math.max(1, Math.round((audioDurationMs / 1000) * fps));
}

/** Reports how far a scene's frame count drifts from the audio it claims to be clocked to. */
export function audioSyncDriftMs(scene: Scene): number {
  return Math.abs((scene.durationFrames / scene.fps) * 1000 - scene.audioDurationMs);
}

/**
 * Retimes one clip proportionally from an old scene length to a new one.
 * Rounding keeps every frame value an integer, and a clip never collapses to zero length.
 */
function retimeClip(clip: SvgAnimationClip, scale: number): SvgAnimationClip {
  const retimed: SvgAnimationClip = {
    ...clip,
    startFrame: Math.max(0, Math.round(clip.startFrame * scale)),
    durationFrames: Math.max(1, Math.round(clip.durationFrames * scale)),
  };
  if (clip.staggerFrames !== undefined) {
    retimed.staggerFrames = Math.max(0, Math.round(clip.staggerFrames * scale));
  }
  return retimed;
}

/** Retimes every clip in a timeline proportionally from one scene length to another. */
export function retimeSvgTimeline(
  timeline: SvgAnimationTimeline,
  fromDurationFrames: number,
  toDurationFrames: number,
): SvgAnimationTimeline {
  if (fromDurationFrames <= 0) {
    throw new Error(`INVALID_RETIME_SOURCE: fromDurationFrames must be > 0, got ${fromDurationFrames}`);
  }
  const scale = toDurationFrames / fromDurationFrames;
  return { ...timeline, clips: timeline.clips.map((clip) => retimeClip(clip, scale)) };
}

/**
 * Re-clocks a scene to an audio segment, returning a new scene rather than mutating the input.
 * Asset animation timelines and keyframe tracks are retimed proportionally, so re-recording the
 * narration a little longer stretches the motion with it instead of desynchronising the two.
 */
export function alignSceneToAudio(
  scene: Scene,
  audio: { audioSource?: string; audioDurationMs: number },
): Scene {
  const nextDuration = framesForAudioMs(audio.audioDurationMs, scene.fps);
  const previousDuration = scene.durationFrames;
  if (previousDuration <= 0) {
    throw new Error(`INVALID_SCENE_DURATION: scene "${scene.sceneId}" has durationFrames ${previousDuration}`);
  }

  const scale = nextDuration / previousDuration;
  const lastFrame = nextDuration - 1;
  const retimeFrame = (frame: number) => Math.min(lastFrame, Math.max(0, Math.round(frame * scale)));

  // Keyframes are retimed then de-duplicated, because Rule 9 requires strictly ascending frames
  // and two nearby keyframes can round onto the same frame when a scene is shortened.
  const retimeTracks = <T extends { keyframes: Array<{ frame: number; value: number }> }>(tracks: T[]): T[] =>
    tracks.map((track) => {
      const seen = new Set<number>();
      const keyframes: Array<{ frame: number; value: number }> = [];
      for (const kf of track.keyframes) {
        const frame = retimeFrame(kf.frame);
        if (seen.has(frame)) {
          keyframes[keyframes.length - 1] = { ...kf, frame };
          continue;
        }
        seen.add(frame);
        keyframes.push({ ...kf, frame });
      }
      return { ...track, keyframes };
    });

  const retimeAsset = (asset: Scene["background"]): Scene["background"] => ({
    ...asset,
    tracks: asset.tracks ? retimeTracks(asset.tracks) : undefined,
    subGroups: asset.subGroups?.map((sg) =>
      sg.track ? { ...sg, track: retimeTracks([sg.track])[0] } : { ...sg },
    ),
    animation: asset.animation
      ? retimeSvgTimeline(asset.animation, previousDuration, nextDuration)
      : undefined,
  });

  return {
    ...scene,
    durationFrames: nextDuration,
    audioDurationMs: audio.audioDurationMs,
    audioSource: audio.audioSource ?? scene.audioSource,
    background: scene.background ? retimeAsset(scene.background) : scene.background,
    props: (scene.props ?? []).map(retimeAsset),
    actors: (scene.actors ?? []).map((actor) => ({
      ...actor,
      positionTracks: actor.positionTracks ? retimeTracks(actor.positionTracks) : undefined,
      jointTracks: actor.jointTracks
        ? Object.fromEntries(
            Object.entries(actor.jointTracks).map(([joint, track]) => [joint, retimeTracks([track])[0]]),
          )
        : undefined,
      actions: actor.actions?.map((action) => {
        const startFrame = retimeFrame(action.startFrame);
        const durationFrames = Math.max(1, Math.round(action.durationFrames * scale));
        return {
          ...action,
          startFrame,
          // An action must stay inside the scene (Rule 13) after retiming.
          durationFrames: Math.min(durationFrames, nextDuration - startFrame),
        };
      }),
    })),
  };
}
