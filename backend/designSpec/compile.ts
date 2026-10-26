/**
 * File Description: Compiles a design spec into the film's scene.
 * Cues are resolved against the film's measured narration, clips and camera poses are added
 * through the kit's Timeline (so a snap, camera discontinuity or second origin is refused with
 * the element named), and the result is the film with its `scene`, `accent`, `design` provenance
 * and any per-shot block overrides applied.
 * Pure: it reads nothing from disk, so the build step and the tests share it. Characters arrive already
 * resolved and verified (see resolveDesignCharacters in build.ts); the compiled film embeds each spec.
 * Inputs and outputs: shot specifications, visual cues, and layout geometry -> compiled scene and shot timelines.
 * Used by: backend/designSpec/designer.ts, backend/designSpec/designSpec.test.ts.
 */

import { DEVICE_BLOCKS, type Film } from "../../src/dl/schema";
import type { CameraTrack, EnvironmentAsset, Scene } from "../../src/dl/scene/types";
import { FPS, SCENE_SIZE, Timeline, createCues, type Cues, type NarrationTiming } from "../sceneKit";
import { resolveCue, collapsedCueShot } from "./cues";
import type { DesignSpec, SpecCamera } from "./spec";
import { fitReceiveSpan } from "../performance/bindReceive";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import type { CharacterSpec } from "../../src/dl/characters/schema";
import { DOT_RESOURCE_HASH, STAGE_RESOURCE_HASH } from "../../src/dl/scene/rigs/registry";
import { validateStage } from "../../src/dl/scene/validateStage";
import { receiveSchema } from "../../src/dl/scene/stageContract";
import { captionWordsToVtt } from "../../src/dl/captionsParser";

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
    // Word timestamps are rounded to milliseconds; give the rounded onset to the nearest shot boundary.
    const wordTimeRoundingSec = 0.0005;
    return {
      shotId: shot.id,
      text: shot.scriptText ?? "",
      startSec,
      durationSec: shot.dur,
      words: words
        .filter((w) => w.start >= startSec - wordTimeRoundingSec && w.start < cursor - wordTimeRoundingSec)
        .map((w) => ({ word: w.punctuated_word ?? w.word, startSec: w.start, endSec: w.end })),
    };
  });
  return { totalDurationSec: cursor, segments };
}

/** Who produced a design, recorded on the film. */
export type DesignSource = "agent" | "server-model" | "hand-built";

// Compiles camera poses into a keyframe track: each pose becomes a Timeline.camera() move from the previous one.
function compileCamera(poses: SpecCamera[], cues: Cues, errors: string[]): CameraTrack | undefined {
  const timeline = new Timeline("camera", cues.durationFrames);
  const lastFrame = cues.durationFrames - 1;
  const seen = new Set<string>();
  let prev: { id: string; frame: number; pose: SpecCamera } | undefined;
  poses.forEach((pose, i) => {
    const id = pose.id ?? `camera-${i}`;
    if (seen.has(id)) errors.push(`camera pose "${id}" is declared twice`);
    seen.add(id);
    let frame: number;
    try {
      // A cue on the film's end resolves one past the last frame; the camera must arrive on a real one.
      frame = Math.min(resolveCue(pose.at, cues), lastFrame);
    } catch (err) {
      errors.push(`camera "${id}": ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (frame < 0) {
      errors.push(`camera "${id}": cue "${pose.at}" resolves to frame ${frame}, before the film starts`);
      return;
    }
    if (!prev) {
      if (pose.easing) errors.push(`camera "${id}": the first pose has no move to arrive by, so remove its easing`);
    } else {
      // Dropping a shot can merge two identical holds without creating a camera jump.
      if (cues.collapsed?.size && frame === prev.frame && pose.center[0] === prev.pose.center[0] && pose.center[1] === prev.pose.center[1] && pose.zoom === prev.pose.zoom) return;
      if (frame <= prev.frame) {
        errors.push(`camera "${id}": cue "${pose.at}" is frame ${frame}, not after "${prev.id}" at frame ${prev.frame}; list poses in time order, each at least one frame apart`);
      } else {
        try {
          timeline.camera({
            id,
            from: { center: { x: prev.pose.center[0], y: prev.pose.center[1] }, zoom: prev.pose.zoom },
            to: { center: { x: pose.center[0], y: pose.center[1] }, zoom: pose.zoom },
            start: prev.frame,
            end: frame,
            ...(pose.easing ? { easing: pose.easing } : {}),
          });
        } catch (err) {
          errors.push(`camera "${id}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    prev = { id, frame, pose };
  });
  return timeline.buildCamera();
}

// Compiles a spec onto a film. Returns the new film, or every error found (never a partial film).
export function compileDesign(
  film: Film,
  spec: DesignSpec,
  words: TimedWord[],
  source: DesignSource,
  options: { characters?: Readonly<Record<string, CharacterSpec>>; collapsed?: ReadonlyMap<string, number> } = {},
): { film?: Film; errors: string[]; collapsedClips?: Array<{ asset: string; clipId: string; shotId: string; frame: number }> } {
  const errors: string[] = [];
  const collapsedClips: Array<{ asset: string; clipId: string; shotId: string; frame: number }> = [];
  const fps = film.fps ?? FPS;
  const cues = createCues(narrationTimingForFilm(film, words), fps, options);
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
    if (!shotIds.has(id) && !options.collapsed?.has(id)) errors.push(`shots."${id}" overrides a shot the film does not have (shots: ${[...shotIds].join(", ")})`);
  }

  const props: EnvironmentAsset[] = spec.assets.filter((a) => "file" in a).map((a) => {
    if (!("file" in a)) throw new Error("SVG asset requires a file");
    const timeline = new Timeline(`${a.id}-motion`, cues.durationFrames);
    for (const clip of spec.clips.filter((c) => c.asset === a.id)) {
      try {
        const start = resolveCue(clip.start, cues);
        const end = resolveCue(clip.end, cues);
        const dropped = start === end ? collapsedCueShot(clip.start, cues) ?? collapsedCueShot(clip.end, cues) : undefined;
        // A hidden collapsed change still leaves its final value for the next shot. The design
        // checker rejects this one-frame representation whenever the change would be visible.
        if (dropped) collapsedClips.push({ asset: a.id, clipId: clip.id, shotId: dropped, frame: start });
        timeline.add({
          id: clip.id,
          targets: clip.targets,
          property: clip.property,
          from: clip.from,
          to: clip.to,
          start: dropped ? Math.max(0, start - 1) : start,
          end: dropped ? Math.max(1, end) : end,
          ...(clip.easing ? { easing: clip.easing } : {}),
          ...(clip.stagger && !dropped ? { stagger: clip.stagger } : {}),
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
      ...("plane" in a ? { plane: a.plane } : {}),
      svgSource: `${pkg}/${a.file}`,
      ...(a.layer !== undefined ? { layer: a.layer } : {}),
      position: { x: a.position[0], y: a.position[1] },
      scale: a.scale,
      rotation: a.rotation,
      opacity: a.opacity,
      ...(built.clips.length ? { animation: built } : {}),
    };
  });

  const camera = spec.camera ? compileCamera(spec.camera, cues, errors) : undefined;

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
    ...(camera ? { camera } : {}),
    background,
    props,
    actors: [],
  };
  if ("performances" in spec) {
    scene.renderer = "three";
    if (spec.treatment) scene.treatment = spec.treatment;
    let shotFrame = 0;
    for (const shot of film.shots) {
      const startFrame = Math.round(shotFrame * fps);
      shotFrame += shot.dur;
      const treatment = spec.shots?.[shot.id]?.stageTreatment;
      if (treatment) (scene.treatments ??= []).push({ startFrame, endFrame: Math.round(shotFrame * fps), treatment });
    }
    scene.cast = [];
    for (const a of spec.assets) {
      if (a.renderer !== "three") continue;
      if (a.kind === "prop") { scene.cast.push({ ...a, treatment: a.treatment ?? spec.treatment ?? "cel-v1", resourceHash: STAGE_RESOURCE_HASH }); continue; }
      const { character: characterId, ...placement } = a;
      const character = options.characters && Object.prototype.hasOwnProperty.call(options.characters, characterId) ? options.characters[characterId] : undefined;
      if (!character) { errors.push(`asset "${a.id}": character "${characterId}" was not resolved; build designs through buildDesign, which loads verified specs`); continue; }
      scene.cast.push({ ...placement, treatment: a.treatment ?? spec.treatment ?? "cel-v1", character, resourceHash: STAGE_RESOURCE_HASH });
    }
    if (scene.treatment === "dots-v1" || scene.treatments?.some((span) => span.treatment === "dots-v1") || scene.cast.some((c) => c.treatment === "dots-v1")) scene.treatmentResourceHash = DOT_RESOURCE_HASH;
    scene.performances = [];
    for (const p of spec.performances) {
      try {
        const actor = scene.cast.find((c) => c.id === p.actor);
        const character = actor && "character" in actor ? actor.character : undefined;
        if (!character) throw new Error(`actor "${p.actor}" is not a resolved character asset`);
        const frame = cues.wordOnce(p.decisive.shotId, p.decisive.phrase, p.decisive.edge);
        const fitted = fitReceiveSpan(frame, resolveCue(p.start, cues), cues.durationFrames, fps, p.targetOffset, { rig: rigFromCharacter(character), policy: p.limits });
        scene.performances.push({ id: p.id, action: p.action, actor: p.actor, prop: p.prop, decisive: { ...p.decisive, frame }, afterState: p.afterState, data: receiveSchema.parse(fitted.action), retarget: { from: fitted.from, to: fitted.action.rigId, characterHash: character.hash, policy: p.limits, warnings: fitted.warnings.map((w) => `${w.field}: ${w.message}`) } });
      } catch (err) { errors.push(`performance ${p.id} cue ${p.decisive.shotId}:"${p.decisive.phrase}": ${err instanceof Error ? err.message : String(err)}`); }
    }
    errors.push(...validateStage(scene));
    if (errors.length) return { errors };
  }

  const shots = film.shots.map((shot) => {
    const override = spec.shots?.[shot.id];
    if (!override) return shot;
    if (!override.blocks) return override.stage ? { ...shot, stage: override.stage } : shot;
    // An anchor shot draws a panel over the scene; text cards keep the scene in view.
    const keepsChart = override.blocks.some((b) => b.c === "StatCounter" || (DEVICE_BLOCKS as readonly string[]).includes(b.c));
    const stage = override.stage ?? (override.blocks.length === 0 ? "none" : keepsChart ? shot.stage : "frame");
    return { ...shot, stage, blocks: override.blocks };
  });

  return {
    film: {
      ...film,
      ...("performances" in spec && film.captions !== "off" ? { captions: captionWordsToVtt(words.map((w) => ({ text: w.punctuated_word ?? w.word, startFrame: Math.round(w.start * fps), endFrame: Math.round(w.end * fps) })), fps, 1) } : {}),
      ...(spec.accent ? { accent: spec.accent } : {}),
      scene,
      shots,
      design: { source, brief: spec.brief },
    } as Film,
    errors: [],
    collapsedClips,
  };
}
