/**
 * File Description: Schema and type definitions for the committed aideos.audio-library/1 manifest.
 * Inputs and outputs: Raw JSON or manifest data -> validated AudioLibrary data structure.
 * Used by: backend/audioLibrary/library.ts, backend/audioLibrary/musicProfile.ts, backend/defaultSoundtrack.ts, backend/musicSelector.ts, backend/designCheck/types.ts, scripts/release.ts.
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

// One loudness rise of a music bed: it starts at startSec, peaks at endSec and gains riseDb in between (source time, seconds).
export const musicSwellSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  riseDb: z.number().positive(),
});

// How much a music bed competes with narration, measured once by `aideos audio profile` and read by the default scorer.
export const musicProfileSchema = z.object({
  // Share of the bed's energy in the 300 to 3400 Hz speech band, in dB (0 is all of it; lower leaves the voice more room).
  midrangeDb: z.number().max(0),
  swells: z.array(musicSwellSchema),
});

export const audioItemIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const audioItemSchema = z.object({
  id: audioItemIdSchema,
  kind: z.enum(["music", "sfx"]),
  title: z.string(),
  artist: z.string(),
  source: z.string(),
  url: z.string().url().nullable(),
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
  // Music only. false marks a bed with vocals, which the default scorer avoids; absent means not labelled.
  instrumental: z.boolean().optional(),
  // Music only. Absent means not measured, which the default scorer treats as neutral.
  profile: musicProfileSchema.optional(),
  // An item is required unless the manifest says false; only a missing required item fails `aideos audio fetch`.
  required: z.boolean().optional(),
});

export const audioLibrarySchema = z.object({
  schema: z.literal(AUDIO_LIBRARY_SCHEMA_ID),
  version: z.number().int().default(1),
  updatedAt: z.string().optional(),
  items: z.array(audioItemSchema),
});

export type AudioLicence = z.infer<typeof audioLicenceSchema>;
export type AudioLoudness = z.infer<typeof audioLoudnessSchema>;
export type MusicSwell = z.infer<typeof musicSwellSchema>;
export type MusicProfile = z.infer<typeof musicProfileSchema>;
export type AudioItem = z.infer<typeof audioItemSchema>;
export type AudioLibrary = z.infer<typeof audioLibrarySchema>;

// Parses and validates an unknown data structure against the audio library schema.
export function parseAudioLibrary(raw: unknown): AudioLibrary {
  return audioLibrarySchema.parse(raw);
}
