/**
 * File Description: Types of the Aideos vector scene, derived from the one Zod scene schema in ./schema.ts,
 * so a parsed film's `scene` is the very type the compiler and renderers take (no casts between two copies).
 * Covers the scene root, environment assets and pictures, asset tracks and rotating sub-groups (D1), and the camera track.
 * Inputs and outputs: Zod scene schemas -> TypeScript types for scenes, assets, tracks and cameras.
 * Used by: src/dl/scene/compile.ts, src/dl/scene/SceneClip.tsx, backend/sceneKit/timeline.ts, backend/renderIr/emit.ts.
 */

import type { z } from "zod";
import type {
  cameraKeyframeSchema,
  cameraTrackSchema,
  environmentAssetSchema,
  keyframeSchema,
  rasterSourceSchema,
  rotatingSubGroupSchema,
  sceneSchema,
  trackSchema,
  vec2Schema,
} from "./schema";

export type SchemaVersion = Scene["schemaVersion"];
export type Vec2 = z.infer<typeof vec2Schema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type Track = z.infer<typeof trackSchema>;
export type RotatingSubGroup = z.infer<typeof rotatingSubGroupSchema>;
export type RasterSource = z.infer<typeof rasterSourceSchema>;
export type EnvironmentAsset = z.infer<typeof environmentAssetSchema>;
export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;
export type CameraTrack = z.infer<typeof cameraTrackSchema>;
export type Scene = z.infer<typeof sceneSchema>;
