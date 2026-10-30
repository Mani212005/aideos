/**
 * File Description: The single source of each format's delivered length: the story (the film's own
 * timeline) plus the fixed end card appended to every video, with the card's span, its spoken
 * line's word timings and the reel length budget. Parses the `endCard` and `reel` sections of the
 * committed aideos.config.json. Pure and browser safe (no Node imports), so Remotion, the studio
 * preview, the pipeline, review and gemini facts all agree on one number.
 * Inputs and outputs: Film manifest, format and optional prebuilt timeline -> DeliveryTimeline (story frames, card span, total frames, card words).
 * Used by: src/Root.tsx, src/dl/runtime.ts, src/dl/Video.tsx, src/dl/Film.tsx, src/dl/EndCard.tsx, editor/src/screens/EditStage.tsx, editor/src/App.tsx, backend/aideosConfig.ts, backend/endCard/voice.ts, backend/pipeline/run.ts, backend/review/source.ts, backend/geminiReview/facts.ts.
 */

import { z } from "zod";
import rawConfig from "../../aideos.config.json";
import { buildTimeline, totalFrames, type TimedShot } from "./camera";
import type { Film } from "./schema";

/** The two deliverables. Matches `Format` in tokens.ts and the pipeline's production formats. */
export type DeliveryFormat = "long" | "reel";

const endCardConfigSchema = z
  .object({
    /** The template's global switch. The per-video switch plugs in through `endCardEnabledFor`. */
    enabled: z.boolean().default(true),
    /** Seconds the card holds after the story, per format. */
    durationSec: z
      .object({ long: z.number().min(0).max(20).default(6), reel: z.number().min(0).max(20).default(3) })
      .prefault({}),
    label: z.string().min(1).max(40).default("THANKS FOR WATCHING"),
    headline: z.string().min(1).max(40).default("Like and subscribe"),
    like: z.string().min(1).max(16).default("LIKE"),
    subscribe: z.string().min(1).max(16).default("SUBSCRIBE"),
    /** Channel handle line; empty hides it. */
    handle: z.string().max(40).default(""),
    /** The spoken call to action, synthesized in the film's own voice; empty keeps the card silent. */
    spokenLine: z.string().max(120).default("If this helped, like and subscribe."),
    /** Seconds into the card the spoken line starts. */
    spokenLineDelaySec: z.number().min(0).max(5).default(0.3),
  })
  .prefault({});

const reelConfigSchema = z
  .object({
    /** Hard cap on a reel's delivered length (story plus end card), seconds. */
    maxSec: z.number().positive().default(179),
    /** What a reel cut aims for, leaving headroom under the cap for TTS variance. */
    targetSec: z.number().positive().default(170),
  })
  .prefault({})
  .refine((reel) => reel.targetSec <= reel.maxSec, { message: "reel.targetSec must not exceed reel.maxSec" });

const deliveryConfigSchema = z.object({ endCard: endCardConfigSchema, reel: reelConfigSchema });

export type EndCardConfig = z.infer<typeof endCardConfigSchema>;
export type ReelConfig = z.infer<typeof reelConfigSchema>;
export type DeliveryConfig = z.infer<typeof deliveryConfigSchema>;

// Validates the `endCard` and `reel` sections of a parsed aideos.config.json, filling defaults.
export function parseDeliveryConfig(raw: unknown): DeliveryConfig {
  const source = (raw ?? {}) as { endCard?: unknown; reel?: unknown };
  const result = deliveryConfigSchema.safeParse({ endCard: source.endCard, reel: source.reel });
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`aideos.config.json: ${lines.join("; ")}`);
  }
  return result.data;
}

/** The committed delivery settings, validated once at module scope like the film itself. */
export const DELIVERY_CONFIG: DeliveryConfig = parseDeliveryConfig(rawConfig);

/** Quiet the spoken line keeps before the card ends, so its last word is never clipped. */
const LINE_TAIL_SEC = 0.15;

/** A caption word of the end card's spoken line, in absolute frames of the delivered video. */
export interface CardWord {
  text: string;
  startFrame: number;
  endFrame: number;
}

/** Where the end card sits in a delivered video. */
export interface EndCardSpan {
  /** First frame of the card (the frame after the story's last). */
  from: number;
  /** Frame after the card's last, equal to the delivered total. */
  to: number;
  durationInFrames: number;
  /** Frame the spoken line starts, when the film carries one. */
  lineFrom: number | null;
}

/** One format's delivered length, split into the story and the card. */
export interface DeliveryTimeline {
  format: DeliveryFormat;
  fps: number;
  /** Frames of the film's own timeline (what the narration is locked to). */
  storyFrames: number;
  card: EndCardSpan | null;
  /** Frames the delivered video runs: story plus card. */
  totalFrames: number;
  /** The spoken line's words, offset into the card; empty for a silent card or no card. */
  cardWords: CardWord[];
}

// The format a frame size renders, by the same rule as tokens.ts useLayout.
export function formatForSize(width: number, height: number): DeliveryFormat {
  return width < height ? "reel" : "long";
}

// Whether this film carries the end card, respecting both the global config and its per-film override.
export function endCardEnabledFor(film: Film, config: DeliveryConfig = DELIVERY_CONFIG): boolean {
  return config.endCard.enabled && film.endCard?.enabled !== false;
}

// Seconds the end card holds in one format, or 0 when this film has no card.
export function endCardSeconds(film: Film, format: DeliveryFormat, config: DeliveryConfig = DELIVERY_CONFIG): number {
  return endCardEnabledFor(film, config) ? config.endCard.durationSec[format] : 0;
}

/**
 * Lays out one format's delivered video: the story, then the card. The card's frame count is
 * rounded once from its configured seconds, so every reader gets the same integer. The spoken line
 * is placed `spokenLineDelaySec` into the card (earlier when it would not otherwise fit) and its
 * words are clipped to the card's end.
 */
export function deliveryTimeline(
  film: Film,
  format: DeliveryFormat,
  options: { timeline?: TimedShot[]; config?: DeliveryConfig } = {},
): DeliveryTimeline {
  const config = options.config ?? DELIVERY_CONFIG;
  const fps = film.fps;
  const timeline = options.timeline ?? buildTimeline(film, film.voiceover?.durationSec);
  const storyFrames = totalFrames(timeline);
  const cardFrames = Math.round(endCardSeconds(film, format, config) * fps);
  if (cardFrames <= 0) return { format, fps, storyFrames, card: null, totalFrames: storyFrames, cardWords: [] };

  const to = storyFrames + cardFrames;
  const voice = film.endCardVoice;
  // The line starts its configured delay into the card, earlier when that would run it past the end.
  const lineDelaySec = voice
    ? Math.min(config.endCard.spokenLineDelaySec, Math.max(0, cardFrames / fps - voice.durationSec - LINE_TAIL_SEC))
    : 0;
  const lineFrom = voice ? storyFrames + Math.round(lineDelaySec * fps) : null;
  const cardWords: CardWord[] =
    voice && lineFrom !== null
      ? voice.words
          .map((w) => ({
            text: w.word,
            startFrame: lineFrom + Math.round(w.start * fps),
            endFrame: Math.min(to, lineFrom + Math.max(Math.round(w.end * fps), Math.round(w.start * fps) + 1)),
          }))
          .filter((w) => w.startFrame < to)
      : [];
  return {
    format,
    fps,
    storyFrames,
    card: { from: storyFrames, to, durationInFrames: cardFrames, lineFrom },
    totalFrames: to,
    cardWords,
  };
}

// Seconds one format's delivered video runs (story plus card).
export function deliveredSeconds(film: Film, format: DeliveryFormat, options: { timeline?: TimedShot[]; config?: DeliveryConfig } = {}): number {
  const delivery = deliveryTimeline(film, format, options);
  return delivery.totalFrames / delivery.fps;
}
