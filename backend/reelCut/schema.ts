/**
 * File Description: Authoritative reel narration cut and explicit pre-synthesis budget contracts.
 * Inputs and outputs: unknown cut JSON or budget -> validated reel cut data.
 * Used by: backend/reelCut/check.ts, brief.ts and cli.ts.
 */
import { z } from "zod";

const shotId = z.string().regex(/^[a-z0-9-]+$/);
const spokenText = z
  .string()
  .trim()
  .min(1)
  .refine((s) => /[a-z0-9]/i.test(s), "must contain a spoken word");

export const REEL_MAX_SEC = 179;
export const REEL_TARGET_SEC = 170;
export const REEL_END_CARD_SEC = 3;
export const DEFAULT_REEL_BUDGET = {
  maxSec: REEL_MAX_SEC,
  targetSec: REEL_TARGET_SEC,
  endCardSec: REEL_END_CARD_SEC,
} as const;

export const reelCutSchema = z.strictObject({
  schema: z.literal("aideos.reelcut/1"),
  source: z.enum(["agent", "server-model", "owner"]),
  long: z.strictObject({
    shots: z.record(shotId, z.string().regex(/^[a-f0-9]{64}$/)),
  }),
  shots: z
    .array(
      z.union([
        z.strictObject({ id: shotId, narration: spokenText }),
        z.strictObject({
          id: shotId,
          drop: z.literal(true),
          reason: z.string().trim().min(1),
        }),
      ]),
    )
    .min(1),
  approved: z
    .strictObject({
      by: z.literal("captain"),
      at: z.iso.datetime({ offset: true }),
    })
    .optional(),
});

export const reelBudgetSchema = z
  .strictObject({
    maxSec: z.number().positive().finite().max(REEL_MAX_SEC),
    targetSec: z.number().positive().finite(),
    endCardSec: z.number().nonnegative().finite(),
  })
  .refine(
    (b) => b.targetSec <= b.maxSec && b.endCardSec < b.targetSec,
    "target must be at most the cap and leave time for the story after the end card",
  );

export type ReelCut = z.infer<typeof reelCutSchema>;
export type ReelBudget = z.infer<typeof reelBudgetSchema>;

// Parses every reel budget through the shared fixed-reserve and hard-cap rules.
export function parseReelBudget(input: unknown): ReelBudget {
  return reelBudgetSchema.parse(input);
}
