import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { parseFilm } from "./schema";
import { buildTimeline, totalFrames } from "./camera";
import { ACTIVE_FILM } from "./activeFilm";
import { PALETTE } from "./tokens";

/**
 * The film, validated once at module scope.
 *
 * Parsing here rather than inside a component means a malformed film fails at
 * bundle time with a field path, instead of rendering four thousand broken
 * frames and failing on the last one.
 */
export const FILM = parseFilm(ACTIVE_FILM);
export const TIMELINE = buildTimeline(FILM);
export const FPS = FILM.fps;
export const TOTAL_FRAMES = totalFrames(TIMELINE);

/**
 * The Studio hand-off surface.
 *
 * Deliberately small. Everything here is something a person plausibly wants to
 * change at the last moment without opening an editor — the colour, the audio,
 * the proofing overlays. Anything else is a design decision, and design
 * decisions live in the schema where they can be validated.
 */
export const filmPropsSchema = z.object({
  /** §01's one colour. Changing it re-skins the entire film. */
  accent: zColor(),
  /** Filename in `public/`. Drop a recording there and type its name. */
  voiceoverSrc: z.string(),
  voiceoverVolume: z.number().min(0).max(2),
  musicSrc: z.string(),
  musicVolume: z.number().min(0).max(1),
  /** The chapter rail along the bottom. */
  showRail: z.boolean(),
  /** The 8px grid, for proofing alignment. Never leave this on for a render. */
  showGrid: z.boolean(),
});

export type FilmProps = z.infer<typeof filmPropsSchema>;

export const defaultFilmProps: FilmProps = {
  accent: FILM.accent ?? PALETTE.accent,
  voiceoverSrc: FILM.voiceover?.src ?? "",
  voiceoverVolume: FILM.voiceover?.volume ?? 1,
  musicSrc: FILM.audio?.src ?? "",
  musicVolume: 1,
  showRail: true,
  showGrid: false,
};
