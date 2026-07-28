import { z } from "zod";
import { EPISODE } from "./script";

/**
 * ---------------------------------------------------------------------------
 * THE HAND-OFF SURFACE
 * ---------------------------------------------------------------------------
 * Everything here shows up as an editable form in Remotion Studio, and Studio
 * writes changes back into `defaultProps` in Root.tsx.
 *
 * This is deliberately the "last 10%" layer: the things a person wants to change
 * at the final moment — swap in a voiceover they just recorded, nudge the music
 * down, turn the grain off — without opening an editor or asking anyone.
 *
 * Only JSON-serialisable primitives, because Remotion has to serialise props to
 * the render workers. Empty string means "not set", which keeps the form simple:
 * there is no null to reason about.
 */
export const videoPropsSchema = z.object({
  /** Filename in `public/`. Drop your recording there and type its name here. */
  voiceoverSrc: z.string(),
  voiceoverVolume: z.number().min(0).max(2),

  /** Filename in `public/`. Leave as-is to keep the current bed, or swap it. */
  musicSrc: z.string(),
  /** Master level for the bed. Drops automatically when a voiceover is set. */
  musicVolume: z.number().min(0).max(1),

  /** Captions JSON in `public/`, in @remotion/captions Caption[] format. */
  captionsSrc: z.string(),

  /** The chapter bar along the bottom edge. */
  showProgressRail: z.boolean(),
  /** Film grain strength. 0 turns it off. */
  grain: z.number().min(0).max(0.2),
});

export type VideoProps = z.infer<typeof videoPropsSchema>;

/**
 * Seeded from the episode, so Studio opens showing what the episode already
 * declares rather than an empty form.
 */
export const defaultVideoProps: VideoProps = {
  voiceoverSrc: EPISODE.voiceover?.src ?? "",
  voiceoverVolume: EPISODE.voiceover?.volume ?? 1,
  musicSrc: EPISODE.audio?.src ?? "",
  musicVolume: 1,
  captionsSrc: EPISODE.captions ?? "",
  showProgressRail: true,
  grain: 0.055,
};
