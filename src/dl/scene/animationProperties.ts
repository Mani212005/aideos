/**
 * File Description: Shared SVG animation properties and easing names.
 * Inputs and outputs: None -> typed animation vocabulary.
 * Used by: scene schema and animation compiler.
 */

/**
 * The properties a clip may drive on a single SVG element.
 * - translateX / translateY move the element in its asset's own coordinate space.
 * - scale / scaleX / scaleY scale it about its transform origin.
 * - rotate turns it about its transform origin, in degrees.
 * - opacity fades it, clamped to [0, 1].
 * - drawOn reveals a stroked path from 0 (nothing drawn) to 1 (fully drawn) via stroke dashing.
 * - x1 / y1 / x2 / y2 animate line endpoint coordinates directly.
 */
export const SVG_ANIMATABLE_PROPERTIES = [
  "translateX",
  "translateY",
  "scale",
  "scaleX",
  "scaleY",
  "rotate",
  "opacity",
  "drawOn",
  "x1",
  "y1",
  "x2",
  "y2",
] as const;
export type SvgAnimatableProperty = (typeof SVG_ANIMATABLE_PROPERTIES)[number];

/** The easing curves available to a clip. expoOut is the project standard (see motion.ts EXPO). */
export const SVG_EASINGS = ["linear", "expoOut", "expoIn", "expoInOut", "hold"] as const;
export type SvgEasing = (typeof SVG_EASINGS)[number];
