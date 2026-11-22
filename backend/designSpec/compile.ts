/**
 * File Description: Compiles a design spec into the film's scene.
 * Cues are resolved against the film's measured narration, clips and camera poses are added
 * through the kit's Timeline (so a snap, camera discontinuity or second origin is refused with
 * the element named), and the result is the film with its `scene`, `accent`, `design` provenance
 * and any per-shot block overrides applied.
 * Declared pictures (the illustrated stage) become raster assets from the pinned files build.ts resolves.
 * Pure: it reads nothing from disk, so the build step and the tests share it. Characters arrive already
 * resolved and verified (see resolveDesignCharacters in build.ts); the compiled film embeds each spec.
 * Inputs and outputs: shot specifications, visual cues, and layout geometry -> compiled scene and shot timelines.
 * Used by: backend/designSpec/designer.ts, backend/designSpec/designSpec.test.ts.
 */

import { DEVICE_BLOCKS, type Film } from "../../src/dl/schema";
import type { CameraTrack, EnvironmentAsset, RasterSource, Scene } from "../../src/dl/scene/types";
import { FPS, SCENE_SIZE, Timeline, createCues, type Cues, type NarrationTiming } from "../sceneKit";
import { resolveCue, collapsedCueShot } from "./cues";
import type { DesignSpec, SpecCamera, SpecClip } from "./spec";
import { fitReceiveSpan } from "../performance/bindReceive";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import type { CharacterSpec } from "../../src/dl/characters/schema";
import { DOT_RESOURCE_HASH, STAGE_RESOURCE_HASH } from "../../src/dl/scene/rigs/registry";
import { validateStage } from "../../src/dl/scene/validateStage";
import { receiveSchema } from "../../src/dl/scene/stageContract";
import { captionWordsToVtt } from "../../src/dl/captionsParser";
import { resolveSoundtrack } from "./soundtrack";
import { planSpliceWindow, spacePosesAtCuts, SPLICE_EASING, type SpliceOptions } from "../reelCut/splice";
import { planStretchedGlides, type GlideShot } from "../reelCut/glide";

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
function compileCamera(inputPoses: SpecCamera[], cues: Cues, errors: string[], splice?: SpliceOptions, glide?: { keptShots: readonly GlideShot[]; fps: number; holdPush?: number }): CameraTrack | undefined {
  // A spliced reel drops the poses of dropped shots: the camera eases between the kept poses instead of collapsing them onto one frame.
  const spliced = splice && cues.collapsed?.size;
  const poses = spliced ? inputPoses.filter((pose) => !collapsedCueShot(pose.at, cues)) : inputPoses;
  const resolved = spliced ? poses.map((pose) => {
    try { return Math.min(resolveCue(pose.at, cues), cues.durationFrames - 1); } catch { return undefined; }
  }) : [];
  // A glide the splice window cannot hold under the camera rule is stretched into the next kept shot, or reported when that shot has no room.
  const planned = spliced && splice.limits && glide ? planStretchedGlides({
    poses: poses.map((pose, i) => ({ id: pose.id ?? `camera-${i}`, center: [pose.center[0], pose.center[1]] as const, zoom: pose.zoom, ...(pose.easing ? { easing: pose.easing } : {}) })),
    frames: resolved, cuts: [...cues.collapsed!.values()], keptShots: glide.keptShots, totalFrames: cues.durationFrames, fps: glide.fps, sceneSize: SCENE_SIZE,
    limits: splice.limits, gap: splice.frames, ...(glide.holdPush !== undefined ? { holdPush: glide.holdPush } : {}),
  }) : undefined;
  // A failed plan reports its error and leaves the frames as authored; the compile then fails on that error alone.
  errors.push(...planned?.errors ?? []);
  const stretched = planned && !planned.errors.length ? planned.frames : undefined;
  const spaced = spliced ? spacePosesAtCuts(stretched ?? resolved, [...cues.collapsed!.values()], splice.frames) : new Map<number, number>();
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
      frame = spaced.get(i) ?? stretched?.[i] ?? Math.min(resolveCue(pose.at, cues), lastFrame);
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
  options: { characters?: Readonly<Record<string, CharacterSpec>>; collapsed?: ReadonlyMap<string, number>; format?: "long" | "reel"; splice?: SpliceOptions; pictures?: Readonly<Record<string, RasterSource>> } = {},
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

  // A declared picture resolves to its pinned, cached file (build.ts); an unresolved one is an error, never a placeholder.
  const declaredPictures = new Set((("pictures" in spec ? spec.pictures?.items : undefined) ?? []).map((p) => p.id));
  const pictureSource = (where: string, id: string): RasterSource | undefined => {
    if (!declaredPictures.has(id)) {
      errors.push(`${where} names picture "${id}", which design.json's pictures do not declare`);
      return undefined;
    }
    const source = options.pictures?.[id];
    if (!source) errors.push(`${where}: picture "${id}" is not resolved; build designs through buildDesign, which reads the picture cache`);
    return source;
  };
  const props: EnvironmentAsset[] = spec.assets.filter((a) => "file" in a || "picture" in a).map((a) => {
    if (!("file" in a) && !("picture" in a)) throw new Error("a stage asset requires a file or a picture");
    const timeline = new Timeline(`${a.id}-motion`, cues.durationFrames);
    // Spliced reel state: per element slot, the value it holds, when its last kept clip ended and the dropped clips awaiting one eased carry.
    // Names the element slot a property writes (scale is tracked by its X slot).
    const slotKey = (target: string, property: string) => `${target}::${property === "scale" ? "scaleX" : property}`;
    const held = new Map<string, number>();
    const idleFrom = new Map<string, number>();
    type Pending = { target: string; property: SpecClip["property"]; from: number; to: number; cutFrame: number; origin?: SpecClip["origin"]; clips: Array<{ clip: SpecClip; shotId: string; frame: number; start: number; end: number }> };
    const pending = new Map<string, Pending>();
    // Slots that have a clip in the timeline, and slots whose dropped clips netted zero: a netted slot that never gets a clip must still hold its initial value.
    const written = new Set<string>();
    const netZero = new Map<string, Pending>();
    // Adds one clip as authored, tracking the value each of its slots now holds.
    const addClip = (clip: SpecClip, extra: { targets?: string[]; id?: string; from?: number; start: number; end: number; dropped?: boolean }) => {
      timeline.add({
        id: extra.id ?? clip.id,
        targets: extra.targets ?? clip.targets,
        property: clip.property,
        from: extra.from ?? clip.from,
        to: clip.to,
        start: extra.start,
        end: extra.end,
        ...(clip.easing ? { easing: clip.easing } : {}),
        ...(clip.stagger && !extra.dropped ? { stagger: clip.stagger } : {}),
        ...(clip.origin ? { origin: { x: clip.origin[0], y: clip.origin[1] } } : {}),
        ...(clip.allowJump ? { allowJump: true } : {}),
      });
      for (const target of extra.targets ?? clip.targets) {
        written.add(slotKey(target, clip.property));
        held.set(slotKey(target, clip.property), clip.to);
        idleFrom.set(slotKey(target, clip.property), Math.max(idleFrom.get(slotKey(target, clip.property)) ?? 0, extra.end + (clip.stagger && !extra.dropped ? clip.stagger * (clip.targets.length - 1) : 0)));
      }
    };
    // Settles a slot's dropped clips before the next kept clip: one eased carry in the idle gap, or the collapsed clips when no gap fits.
    // When no gap fits and the next kept clip leaves from the carried value, that clip absorbs the carry and starts from the pre-cut value (returned).
    const settle = (key: string, gapEnd: number, next?: SpecClip): number | undefined => {
      const carry = pending.get(key);
      if (!carry) return undefined;
      pending.delete(key);
      if (Math.abs(carry.to - carry.from) <= 1e-6) {
        held.set(key, carry.to);
        netZero.set(key, carry);
        return undefined;
      }
      const window = options.splice ? planSpliceWindow({ gapStart: idleFrom.get(key) ?? 0, gapEnd, cutFrame: carry.cutFrame, frames: options.splice.frames }) : undefined;
      if (window) {
        const first = carry.clips[0].clip;
        timeline.add({ id: `splice-${first.id}-${carry.target}`, targets: [carry.target], property: carry.property, from: carry.from, to: carry.to,
          start: window.start, end: window.end, easing: SPLICE_EASING, ...(carry.origin ? { origin: { x: carry.origin[0], y: carry.origin[1] } } : {}) });
        written.add(key);
        held.set(key, carry.to);
        idleFrom.set(key, window.end);
        return undefined;
      }
      if (options.splice && next && !next.allowJump && slotKey(carry.target, next.property) === key && Math.abs(next.from - carry.to) <= 1e-6) return carry.from;
      for (const entry of carry.clips) {
        const clipId = entry.clip.targets.length === 1 ? entry.clip.id : `${entry.clip.id}-${carry.target}`;
        collapsedClips.push({ asset: a.id, clipId, shotId: entry.shotId, frame: entry.frame });
        addClip(entry.clip, { targets: [carry.target], id: clipId, start: Math.max(0, entry.start - 1), end: Math.max(1, entry.end), dropped: true });
      }
    };
    for (const clip of spec.clips.filter((c) => c.asset === a.id)) {
      try {
        const start = resolveCue(clip.start, cues);
        const end = resolveCue(clip.end, cues);
        const dropped = start === end ? collapsedCueShot(clip.start, cues) ?? collapsedCueShot(clip.end, cues) : undefined;
        let absorbed: number | undefined;
        if (options.splice) {
          if (dropped && !clip.allowJump) {
            for (const target of clip.targets) {
              const key = slotKey(target, clip.property);
              const carry = pending.get(key) ?? { target, property: clip.property, from: held.get(key) ?? clip.from, to: clip.to, cutFrame: start, clips: [] };
              carry.to = clip.to;
              carry.cutFrame = start;
              if (clip.origin) carry.origin = clip.origin;
              carry.clips.push({ clip, shotId: dropped, frame: start, start, end });
              pending.set(key, carry);
            }
            continue;
          }
          for (const target of clip.targets) absorbed = settle(slotKey(target, clip.property), start, clip.targets.length === 1 ? clip : undefined) ?? absorbed;
        }
        // A hidden collapsed change still leaves its final value for the next shot. The design
        // checker rejects this one-frame representation whenever the change would be visible.
        if (dropped) collapsedClips.push({ asset: a.id, clipId: clip.id, shotId: dropped, frame: start });
        addClip(clip, { ...(absorbed !== undefined ? { from: absorbed } : {}), start: dropped ? Math.max(0, start - 1) : start, end: dropped ? Math.max(1, end) : end, dropped: !!dropped });
      } catch (err) {
        errors.push(`clip "${clip.id}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      for (const key of [...pending.keys()]) settle(key, cues.durationFrames);
    } catch (err) {
      errors.push(`asset "${a.id}" splice: ${err instanceof Error ? err.message : String(err)}`);
    }
    // A slot animated only inside dropped shots with zero net change has no clip, so the engine would show its SVG default (opacity 1) from frame 0.
    // One hold clip keeps the value the slot had before the cut.
    try {
      for (const [key, carry] of netZero) {
        if (written.has(key)) continue;
        timeline.add({ id: `hold-${carry.clips[0].clip.id}-${carry.target}`, targets: [carry.target], property: carry.property, from: carry.from, to: carry.from, start: 0, end: 1,
          ...(carry.origin ? { origin: { x: carry.origin[0], y: carry.origin[1] } } : {}) });
      }
    } catch (err) {
      errors.push(`asset "${a.id}" splice hold: ${err instanceof Error ? err.message : String(err)}`);
    }
    const built = timeline.build();
    const raster = "picture" in a && a.picture !== undefined ? pictureSource(`asset "${a.id}"`, a.picture) : undefined;
    return {
      assetId: a.id,
      ...("plane" in a ? { plane: a.plane } : {}),
      ...("file" in a && a.file !== undefined ? { svgSource: `${pkg}/${a.file}` } : {}),
      ...(raster ? { raster } : {}),
      ...(a.layer !== undefined ? { layer: a.layer } : {}),
      position: { x: a.position[0], y: a.position[1] },
      scale: a.scale,
      rotation: a.rotation,
      opacity: a.opacity,
      ...(built.clips.length ? { animation: built } : {}),
    };
  });

  const keptShots = film.shots.filter((shot) => !cues.collapsed?.has(shot.id)).map((shot) => ({ id: shot.id, from: cues.from(shot.id), to: cues.to(shot.id) }));
  const keyframes = spec.camera ? compileCamera(spec.camera, cues, errors, options.splice, { keptShots, fps, holdPush: spec.holdPush }) : undefined;
  if (spec.holdPush !== undefined && !keyframes) errors.push("holdPush needs `camera` poses: a film with a fixed camera has no hold to push in on");
  const camera = keyframes && spec.holdPush !== undefined ? { ...keyframes, holdPush: spec.holdPush } : keyframes;

  if (errors.length) return { errors };

  const plate = spec.background && "picture" in spec.background ? pictureSource("background", spec.background.picture) : undefined;
  if (errors.length) return { errors };
  const background: EnvironmentAsset = {
    assetId: "background",
    ...(plate ? { raster: plate } : { svgSource: `${pkg}/${spec.background && "file" in spec.background ? spec.background.file : DEFAULT_BACKGROUND_FILE}` }),
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

  let soundtrack = film.soundtrack;
  if (spec.soundtrack) {
    try {
      soundtrack = resolveSoundtrack(spec.soundtrack, cues, film, options.format ?? "long");
    } catch (err) {
      errors.push(`soundtrack: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length) return { errors };

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
      ...(soundtrack ? { soundtrack } : {}),
      scene,
      shots,
      design: { source, brief: spec.brief },
    } as Film,
    errors: [],
    collapsedClips,
  };
}
