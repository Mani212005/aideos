/**
 * File Description: Pure TypeScript data contract for the Aideos 2D Scene Graph.
 * Defines serializable scene hierarchy (background, props, actors schema), tracks, keyframes,
 * rotating subgroups (D1), custom SVG animation timelines, camera tracks, and scene root. Character rigs are not implemented or rendered.
 * Inputs and outputs: TypeScript definitions -> types for scenes, actors, props, cameras, and animation clips.
 * Used by: src/dl/scene/compile.ts, src/dl/schema.ts, backend/sceneKit/timeline.ts.
 */

import type { SvgAnimationTimeline } from "./svgAnimation";
import type { StageTreatment, TreatmentSpan } from "./materials/treatment";
import type { StageCast, StagePerformance } from "./stageContract";

export type SchemaVersion = string; // e.g. "1.0.0"

export interface Vec2 {
  x: number;
  y: number;
}

export interface Keyframe {
  frame: number; // integer >= 0, index within scene
  value: number;
  easing?: string; // omit to use spline interpolation
}

export interface Track {
  trackId: string; // unique within its owning entity
  keyframes: Keyframe[];
  continuity?: "C0" | "C1"; // requested AND verified at compile time
}

/** D1: One rotating sub-group per environment asset (wheels, fans, cogs). */
export interface RotatingSubGroup {
  /** SVG element id within this asset's document. */
  elementId: string;
  /** Rotation pivot in the asset's local coordinate space. */
  pivot: Vec2;
  /** Constant angular velocity in degrees per second. Use this OR track, not both. */
  degreesPerSecond?: number;
  /** Keyframed rotation in degrees. Use this OR degreesPerSecond, not both. */
  track?: Track;
}

/**
 * A picture (the illustrated stage's plate or one of its generated objects): one PNG drawn centred on
 * its asset's origin at one scene unit per pixel, then placed, scaled and faded like an SVG asset. The
 * picture is the asset's single animatable element, so a clip targets it by the asset's own id. Pictures
 * carry no words, numbers or lines: SVG keeps all of those. See src/dl/scene/raster.ts.
 */
export interface RasterSource {
  /** Repo-relative path to the PNG, e.g. "videos/<slug>/visuals/generated/<fingerprint>.png". */
  src: string;
  /** Pixel width of the PNG, which is also its drawn width in scene units at scale 1. */
  width: number;
  /** Pixel height of the PNG, which is also its drawn height in scene units at scale 1. */
  height: number;
  /** sha256 of the approved file (lowercase hex): the design pins it, and both renderers refuse other bytes. */
  sha256: string;
}

export interface EnvironmentAsset {
  plane?: "background" | "foreground";
  assetId: string; // unique within scene
  /** Path to the committed SVG artwork. Exactly one of `svgSource` and `raster` is set. */
  svgSource?: string;
  /** A picture instead of SVG artwork. Exactly one of `svgSource` and `raster` is set. */
  raster?: RasterSource;
  /** D5: omit to derive from position.y per frame. Present = explicit override. */
  layer?: number;
  position: Vec2; // scene-space pixels
  scale: number; // uniform; 1.0 = authored size
  rotation: number; // degrees
  opacity: number; // 0.0 - 1.0
  /** Track ids: "x" | "y" | "scale" | "rotation" | "opacity". */
  tracks?: Track[];
  /** D1: Multiple rotating sub-groups per asset (e.g. front + rear bicycle wheels). */
  subGroups?: RotatingSubGroup[];
  /**
   * Custom element-level SVG animation for this asset: which elements of its SVG document move,
   * along which property, over which frames. See svgAnimation.ts for the clip format.
   */
  animation?: SvgAnimationTimeline;
}

export interface ScheduledAction {
  actionId: string; // references the action registry
  startFrame: number; // integer >= 0
  durationFrames: number; // integer > 0
  intensity: number; // 0.0 - 1.0
  side?: "left" | "right";
}

/**
 * Actor instance schema definition.
 * Note: Character rigs are not implemented or rendered; validateScene explicitly rejects scenes with actors.
 */
export interface ActorInstance {
  instanceId: string; // unique within scene. NEVER regenerated.
  rigId: string; // rig identifier
  /** D5: omit to derive from position.y per frame. Present = explicit override. */
  layer?: number;
  position: Vec2; // base placement when no position track exists
  scale: number;
  facing: "left" | "right"; // horizontal flip, applied before rotation
  /** Track ids: "x" | "y". */
  positionTracks?: Track[];
  /** Key = CharacterGroup.id, e.g. "leftArm". */
  jointTracks?: Record<string, Track>;
  /** Scheduled actions; the compiler resolves these to jointTracks. */
  actions?: ScheduledAction[];
}

/**
 * D2: Canonical record per cast member. Lives beside the rig file.
 * Note: Character rigs are not implemented or rendered.
 */
export interface ModelSheet {
  rigId: string;
  canonicalHeight: number; // scene-space pixels at scale 1.0
  canonicalScale: number; // typical scale in a mid-shot
  referencePose: string; // a pose preset id
  defaultFacing: "left" | "right";
}

export interface CameraKeyframe {
  frame: number;
  center: Vec2;
  zoom: number;
  rotation?: number;
  easing?: string;
}

export interface CameraTrack {
  keyframes: CameraKeyframe[];
  /** Opt-in slow push-in over every camera hold, as a fraction of zoom (0.01 to 0.03). Absent means off. */
  holdPush?: number;
}

export interface Scene {
  treatmentResourceHash?: string;
  treatment?: StageTreatment;
  treatments?: TreatmentSpan[];
  renderer?: "svg" | "three";
  cast?: StageCast[];
  performances?: StagePerformance[];
  schemaVersion: SchemaVersion;
  sceneId: string;
  fps: number; // 30
  durationFrames: number; // integer > 0
  /** D4: Audio segment this scene is clocked to. */
  audioSource: string;
  audioDurationMs: number;
  sceneSize: { w: number; h: number }; // virtual scene coordinate space (e.g. 1920x1080)
  camera?: CameraTrack;
  background: EnvironmentAsset;
  props: EnvironmentAsset[];
  actors: ActorInstance[]; // length <= 15
}
