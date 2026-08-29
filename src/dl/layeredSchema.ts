/**
 * File Description: Generic Layer & Clip Schema for Aideos (Phase L-1).
 * Implements OpenShot-grade generic layer architecture:
 * - Layer: User-created tracks with unique stored integer z-order (number).
 * - Clip: Universal timeline element with stored position, start (in), end (out), and derived duration.
 * - Discriminated clip payloads: 'animation' | 'video' | 'audio' | 'text' | 'subtitle' | 'image'.
 */

import { z } from "zod";
import {
  nodeSchema,
  edgeSchema,
  themeSchema,
  blockSchema,
  stageSchema,
  lookSchema,
  moveSchema,
  cameraAngleSchema,
} from "./schema";

/** A user-created track. Pure ordering and display state. */
export const layerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Z-order. Higher number draws on top. Stored integer. */
  number: z.number().int().min(0).max(100),
  label: z.string().min(1).max(40),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  muted: z.boolean().default(false),
  height: z.number().min(20).max(200).default(56),
});

export type Layer = z.infer<typeof layerSchema>;

/** Animation Clip Payload (procedural spatial beats, character rigs, vector devices) */
export const animationPayloadSchema = z.object({
  shotId: z.string().regex(/^[a-z0-9-]+$/),
  ch: z.string().min(1).max(30).optional(),
  stage: stageSchema,
  look: lookSchema,
  move: moveSchema.default("pan"),
  cameraAngle: cameraAngleSchema.optional(),
  drift: z.boolean().default(false),
  zoom: z.number().min(0.4).max(2.5).default(1),
  scriptText: z.string().optional(),
  visualDirection: z.string().optional(),
  metaphor: z.enum([
    "spider-web",
    "liquid-bucket",
    "balance-scale",
    "clock-gears",
    "rocket-launch",
    "character-throw",
    "glowing-cluster",
    "custom",
  ]).optional(),
  blocks: z.array(blockSchema).max(12).default([]),
});

/** Video Footage Clip Payload */
export const videoPayloadSchema = z.object({
  src: z.string().min(1),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  fps: z.number().positive().optional(),
});

/** Audio Clip Payload */
export const audioPayloadSchema = z.object({
  src: z.string().min(1),
  channel: z.enum(["voiceover", "music", "sfx", "external"]).default("voiceover"),
  duckUnderVoiceover: z.boolean().optional(),
});

/** Text / Typography Overlay Payload */
export const textPayloadSchema = z.object({
  text: z.string().min(1),
  size: z.enum(["kicker", "headline", "body", "caption"]).default("headline"),
  accentWord: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

/** Subtitle Caption Cue Payload */
export const subtitlePayloadSchema = z.object({
  text: z.string().min(1),
  startFrame: z.number().int().min(0).optional(),
  endFrame: z.number().int().min(0).optional(),
});

/** Static Image Payload */
export const imagePayloadSchema = z.object({
  src: z.string().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().positive().default(1),
});

export const clipKindSchema = z.enum([
  "animation",
  "video",
  "audio",
  "text",
  "subtitle",
  "image",
]);

export type ClipKind = z.infer<typeof clipKindSchema>;

/** Generic Universal Clip Schema */
export const clipSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  layerId: z.string().min(1),

  /** Timeline placement — STORED, never derived. */
  position: z.number().min(0),
  /** Source range in-point within source material (seconds) */
  start: z.number().min(0).default(0),
  /** Source range out-point within source material (seconds) */
  end: z.number().min(0),

  kind: clipKindSchema,
  payload: z.union([
    animationPayloadSchema,
    videoPayloadSchema,
    audioPayloadSchema,
    textPayloadSchema,
    subtitlePayloadSchema,
    imagePayloadSchema,
  ]),

  /** Cross-reference for split video/audio clip pairs */
  linkedClipId: z.string().nullable().optional(),

  /** Per-clip compositing properties */
  opacity: z.number().min(0).max(1).default(1),
  volume: z.number().min(0).max(1).default(1),
});

export type Clip = z.infer<typeof clipSchema>;

/** Layered Film Schema */
export const layeredFilmSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  fps: z.number().int().positive().default(30),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#FF6B00"),
  theme: themeSchema.optional(),
  canvas: z.object({
    nodes: z.array(nodeSchema).min(1),
    edges: z.array(edgeSchema).default([]),
  }),
  chapters: z.array(z.string()).default([]),
  layers: z.array(layerSchema).min(1),
  clips: z.array(clipSchema),
});

export type LayeredFilm = z.infer<typeof layeredFilmSchema>;
