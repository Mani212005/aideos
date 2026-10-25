/**
 * File Description: Schema and type definitions for the committed aideos.audio-library/1 manifest.
 * Inputs and outputs: Raw JSON or manifest data -> validated AudioLibrary data structure.
 * Used by: backend/audioLibrary/library.ts, backend/audioLibrary/cli.ts, backend/cli.ts.
 */

import { z } from "zod";

export const AUDIO_LIBRARY_SCHEMA_ID = "aideos.audio-library/1" as const;

export const audioLicenceSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  attribution: z.string().nullable(),
  checkedAt: z.string(),
});

export const audioLoudnessSchema = z.object({
  integratedLufs: z.number(),
  truePeakDb: z.number(),
  lra: z.number(),
});

export const audioItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["music", "sfx"]),
  title: z.string(),
  artist: z.string(),
  source: z.string(),
  url: z.string().url().nullable(),
  fetch: z.enum(["manual", "direct", "archive"]).optional(),
  archivePath: z.string().optional(),
  licence: audioLicenceSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  durationSec: z.number().nonnegative(),
  loudness: audioLoudnessSchema,
  roles: z.array(z.string()),
  moods: z.array(z.string()),
  energy: z.number().int().min(1).max(5),
  contentIdRisk: z.enum(["none", "low", "medium", "high"]),
});

export const audioLibrarySchema = z.object({
  schema: z.literal(AUDIO_LIBRARY_SCHEMA_ID),
  version: z.number().int().default(1),
  updatedAt: z.string().optional(),
  items: z.array(audioItemSchema),
});

export type AudioLicence = z.infer<typeof audioLicenceSchema>;
export type AudioLoudness = z.infer<typeof audioLoudnessSchema>;
export type AudioItem = z.infer<typeof audioItemSchema>;
export type AudioLibrary = z.infer<typeof audioLibrarySchema>;

// Parses and validates an unknown data structure against the audio library schema.
export function parseAudioLibrary(raw: unknown): AudioLibrary {
  return audioLibrarySchema.parse(raw);
}
