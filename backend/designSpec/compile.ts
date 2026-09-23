/**
 * File Description: Compiles a design spec into the film's scene.
 * Cues are resolved against the film's measured narration, clips are added through the kit's
 * Timeline (so a snap or a second origin is refused with the clip named), and the result is the
 * film with its `scene`, `accent`, `design` provenance and any per-shot block overrides applied.
 * Pure: it reads nothing from disk, so the build step and the tests share it.
 */

import { DEVICE_BLOCKS, type Film } from "../../src/dl/schema";
import type { EnvironmentAsset, Scene } from "../../src/dl/scene/types";
import { FPS, SCENE_SIZE, Timeline, createCues, type NarrationTiming } from "../sceneKit";
import { resolveCue } from "./cues";
import type { DesignSpec } from "./spec";

/** One narrated word with its offsets in seconds, as voiceover_words.json stores it. */
export interface TimedWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
}

/** File the build writes when a spec has no background: the plain canvas colour. */
export const DEFAULT_BACKGROUND_FILE = "visuals/canvas.svg";

// Builds the kit's narration timing from a film's shots and its voiceover word offsets.
export function narrationTimingForFilm(film: Film, words: TimedWord[]): NarrationTiming {
  let cursor = 0;
  const segments = film.shots.map((shot) => {
    const startSec = cursor;
    cursor += shot.dur;
    return {
      shotId: shot.id,
      text: shot.scriptText ?? "",
      startSec,
      durationSec: shot.dur,
      words: words
        .filter((w) => w.start >= startSec - 1e-6 && w.start < cursor - 1e-6)
        .map((w) => ({ word: w.punctuated_word ?? w.word, startSec: w.start, endSec: w.end })),
    };
  });
  return { totalDurationSec: cursor, segments };
}

/** Who produced a design, recorded on the film. */
export type DesignSource = "agent" | "server-model" | "hand-built";

// Compiles a spec onto a film. Returns the new film, or every error found (never a partial film).
export function compileDesign(
  film: Film,
  spec: DesignSpec,
  words: TimedWord[],
  source: DesignSource,
): { film?: Film; errors: string[] } {
  const errors: string[] = [];
  const fps = film.fps ?? FPS;
  const cues = createCues(narrationTimingForFilm(film, words), fps);
  const pkg = `videos/${film.id}`;

  const assetIds = new Set<string>();
  for (const a of spec.assets) {
    if (assetIds.has(a.id)) errors.push(`asset "${a.id}" is declared twice`);
    assetIds.add(a.id);
  }
  for (const clip of spec.clips) {
    if (!assetIds.has(clip.asset)) errors.push(`clip "${clip.id}" animates unknown asset "${clip.asset}"`);
  }
  const shotIds = new Set(film.shots.map((s) => s.id));
  for (const id of Object.keys(spec.shots ?? {})) {
    if (!shotIds.has(id)) errors.push(`shots."${id}" overrides a shot the film does not have (shots: ${[...shotIds].join(", ")})`);
  }

  const props: EnvironmentAsset[] = spec.assets.map((a) => {
    const timeline = new Timeline(`${a.id}-motion`, cues.durationFrames);
    for (const clip of spec.clips.filter((c) => c.asset === a.id)) {
      try {
        timeline.add({
          id: clip.id,
          targets: clip.targets,
          property: clip.property,
          from: clip.from,
          to: clip.to,
          start: resolveCue(clip.start, cues),
          end: resolveCue(clip.end, cues),
          ...(clip.easing ? { easing: clip.easing } : {}),
          ...(clip.stagger ? { stagger: clip.stagger } : {}),
          ...(clip.origin ? { origin: { x: clip.origin[0], y: clip.origin[1] } } : {}),
          ...(clip.allowJump ? { allowJump: true } : {}),
        });
      } catch (err) {
        errors.push(`clip "${clip.id}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const built = timeline.build();
    return {
      assetId: a.id,
      svgSource: `${pkg}/${a.file}`,
      ...(a.layer !== undefined ? { layer: a.layer } : {}),
      position: { x: a.position[0], y: a.position[1] },
      scale: a.scale,
      rotation: a.rotation,
      opacity: a.opacity,
      ...(built.clips.length ? { animation: built } : {}),
    };
  });

  if (errors.length) return { errors };

  const background: EnvironmentAsset = {
    assetId: "background",
    svgSource: `${pkg}/${spec.background?.file ?? DEFAULT_BACKGROUND_FILE}`,
    layer: 0,
    position: { x: SCENE_SIZE.w / 2, y: SCENE_SIZE.h / 2 },
    scale: spec.background?.scale ?? 4.8,
    rotation: 0,
    opacity: 1,
  };
  const scene: Scene = {
    schemaVersion: "1.0.0" as Scene["schemaVersion"],
    sceneId: film.id,
    fps,
    durationFrames: cues.durationFrames,
    audioSource: film.voiceover?.src ?? "",
    audioDurationMs: Math.round((film.voiceover?.durationSec ?? cues.durationFrames / fps) * 1000),
    sceneSize: { ...SCENE_SIZE },
    background,
    props,
    actors: [],
  };

  const shots = film.shots.map((shot) => {
    const override = spec.shots?.[shot.id];
    if (!override) return shot;
    // An anchor shot draws a panel over the scene; text cards keep the scene in view.
    const keepsChart = override.blocks.some((b) => b.c === "StatCounter" || (DEVICE_BLOCKS as readonly string[]).includes(b.c));
    const stage = override.stage ?? (override.blocks.length === 0 ? "none" : keepsChart ? shot.stage : "frame");
    return { ...shot, stage, blocks: override.blocks };
  });

  return {
    film: {
      ...film,
      ...(spec.accent ? { accent: spec.accent } : {}),
      scene,
      shots,
      design: { source, brief: spec.brief },
    } as Film,
    errors: [],
  };
}
