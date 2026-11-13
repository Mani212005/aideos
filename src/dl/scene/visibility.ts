/**
 * File Description: Shared authored and animated SVG opacity resolution and visible-ink policy.
 * Inputs and outputs: compiled element state, authored opacity and ancestor opacity -> effective opacity and visibility.
 * Used by: SVG rendering, stage timeline, design continuity, inset projection and measured review.
 */
import type { SvgElementState } from "./svgAnimation";

/** Ink above this opacity counts as visible for story motion and continuity. */
export const VISIBLE_OPACITY_MIN = 0.05;

// Returns an opacity override only when animation owns the rendered attribute.
export function animatedElementOpacity(state?: Pick<SvgElementState, "opacity" | "opacityDriven">): number | undefined {
  return state && (state.opacityDriven || state.opacity !== 1) ? state.opacity : undefined;
}

// Resolves effective opacity without overriding an undriven authored value.
export function elementOpacity(state?: Pick<SvgElementState, "opacity" | "opacityDriven">, authored = 1): number {
  return animatedElementOpacity(state) ?? authored;
}

// Tests effective opacity, including any authored or animated ancestors.
export function elementVisible(opacity: number): boolean {
  return opacity > VISIBLE_OPACITY_MIN;
}
