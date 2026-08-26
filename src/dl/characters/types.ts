/**
 * File Description: Type definitions for the pure TypeScript vector character rig system.
 * Defines semantic token bindings, hierarchical 2-level joint groups, and pose keyframes.
 */

import { z } from "zod";

/** Semantic color token names mapping to the 6-value design system palette. */
export type SemanticToken =
  | "surface"
  | "ink"
  | "muted"
  | "hairline"
  | "accent"
  | "canvas"
  | "none";

export const semanticTokenSchema = z.enum([
  "surface",
  "ink",
  "muted",
  "hairline",
  "accent",
  "canvas",
  "none",
]);

/** Represents a single vector path element with semantic color binding. */
export interface PathElement {
  d: string;
  fill?: SemanticToken;
  stroke?: SemanticToken;
  strokeWidth?: number;
  fillRule?: "nonzero" | "evenodd";
}

export const pathElementSchema = z.object({
  d: z.string().min(1),
  fill: semanticTokenSchema.optional(),
  stroke: semanticTokenSchema.optional(),
  strokeWidth: z.number().min(0).max(20).optional(),
  fillRule: z.enum(["nonzero", "evenodd"]).optional(),
});

/** Joint group in a 2-level skeletal rig with an optional parent group link. */
export interface RigGroup {
  id: string;
  name: string;
  pivot: { x: number; y: number };
  parent?: string;
  paths: PathElement[];
  defaultRotation?: number;
}

export const rigGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pivot: z.object({ x: z.number(), y: z.number() }),
  parent: z.string().optional(),
  paths: z.array(pathElementSchema),
  defaultRotation: z.number().optional(),
});

/** Complete pure TypeScript character vector rig definition. */
export interface CharacterRig {
  id: string;
  name: string;
  description?: string;
  viewBox: string;
  defaultScale?: number;
  groups: RigGroup[];
}

export const characterRigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional(),
  viewBox: z.string().default("0 0 400 600"),
  defaultScale: z.number().min(0.1).max(5).default(1).optional(),
  groups: z.array(rigGroupSchema).min(1),
});

/** Transformation parameters for a single rig group in a pose keyframe. */
export interface PoseTransform {
  rotate?: number;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
}

export const poseTransformSchema = z.object({
  rotate: z.number().min(-360).max(360).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  scaleX: z.number().min(0.1).max(5).optional(),
  scaleY: z.number().min(0.1).max(5).optional(),
});

/** A single pose keyframe evaluated at normalized timeline progress t in [0, 1]. */
export interface PoseKeyframe {
  t: number;
  groups: Record<string, PoseTransform>;
}

export const poseKeyframeSchema = z.object({
  t: z.number().min(0).max(1),
  groups: z.record(z.string(), poseTransformSchema),
});

/** Preset pose template for 1-click authoring in the editor. */
export interface PosePreset {
  id: string;
  name: string;
  description: string;
  groups: Record<string, PoseTransform>;
}
