/**
 * File Description: Pure TypeScript data contract for the Aideos 2D Scene Graph.
 * Defines serializable scene hierarchy (background, props, actors), tracks, keyframes,
 * rotating subgroups (D1), actions, model sheets (D2), and scene root. (Axiom 1: pure data).
 */

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

export interface EnvironmentAsset {
  assetId: string; // unique within scene
  svgSource: string; // path to committed SVG file
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
}

export interface ScheduledAction {
  actionId: string; // references the action registry
  startFrame: number; // integer >= 0
  durationFrames: number; // integer > 0
  intensity: number; // 0.0 - 1.0
  side?: "left" | "right";
}

export interface ActorInstance {
  instanceId: string; // unique within scene. NEVER regenerated.
  rigId: string; // references a CharacterRig in the cast library
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

/** D2: Canonical record per cast member. Lives beside the rig file. */
export interface ModelSheet {
  rigId: string;
  canonicalHeight: number; // scene-space pixels at scale 1.0
  canonicalScale: number; // typical scale in a mid-shot
  referencePose: string; // a pose preset id
  defaultFacing: "left" | "right";
}

export interface Scene {
  schemaVersion: SchemaVersion;
  sceneId: string;
  fps: number; // 30
  durationFrames: number; // integer > 0
  /** D4: Audio segment this scene is clocked to. */
  audioSource: string;
  audioDurationMs: number;
  sceneSize: { w: number; h: number }; // virtual scene coordinate space (e.g. 1920x1080)
  background: EnvironmentAsset;
  props: EnvironmentAsset[];
  actors: ActorInstance[]; // length <= 15
}
