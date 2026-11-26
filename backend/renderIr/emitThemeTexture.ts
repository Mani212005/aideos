/**
 * File Description: The theme texture of the Render IR emitter (native renderer Phase 2, P2.4a): lowers the `blueprint-grid` and `subtle-dots` patterns `Film.tsx` draws under the canvas into one frame-sized SVG asset of explicit shapes, placed in the `aideos.render/7` underlay (frame space, under the stage) with the texture layer's opacity and the end card's slow push. A pattern tile in Chrome draws only what lies inside the tile, so a stroke centred on the tile's top and left edges keeps its inner half: the blueprint grid's 0.5 px minor lines are 0.25 px wide and its 1 px major lines 0.5 px wide, starting on the tile edge (measured against Chrome: SSIM 0.99997 over a whole frame, no pixel more than one level apart). The `paper-fibers` texture (P2.4b) is a turbulence lit by a distant light and then blended `multiply` with `SourceGraphic`, which is the rect's default black fill: black multiplied by anything is black, so Chrome draws no grain at all, only a black rect at the rect's 0.8 opacity in the 0.28 layer (measured: one flat colour over the whole frame on all three paper themes, 248,246,240 becoming 193,191,187); it is lowered to exactly that.
 * Inputs and outputs: a background theme, the frame size, the end card's push per frame and the last frame -> the texture's svg asset, its package file and its underlay node, or null for a theme without a lowered texture.
 * Used by: backend/renderIr/emit.ts (build), backend/journeys/theme_textures.journey.ts and scene_textures.journey.ts (through the emitter).
 */

import type { BackgroundTheme } from "../../src/dl/tokens";
import { linearKeyframes } from "./irValues";
import type { Asset, Node } from "./schema";

/** The texture as the emitter places it: its asset, the generated file and the underlay node. */
export interface ThemeTexture {
  asset: Asset;
  file: { path: string; text: string };
  node: Node;
}

/** The paper grain's rect opacity (`Film.tsx`). */
const PAPER_GRAIN_FILL = 0.8;
/** The paper grain's layer opacity, 0.28 as Chrome composites it: in 8 bits (71 / 255), which is what puts 248 at 193, not 192. */
const PAPER_GRAIN_LAYER = Math.round(0.28 * 255) / 255;

/**
 * The colour behind a node-graph canvas: the theme's canvas colour under its texture where the texture is uniform (the paper
 * grain darkens it evenly, 248, 246, 240 to 193, 191, 187), else the canvas colour itself. A card's backdrop blurs this.
 */
export function canvasBehindGraph(theme: BackgroundTheme, canvasHex: string): string {
  if (theme.gridType !== "paper-fibers") return canvasHex;
  const keep = 1 - PAPER_GRAIN_FILL * PAPER_GRAIN_LAYER;
  const channel = (i: number) => Math.round(parseInt(canvasHex.slice(1 + 2 * i, 3 + 2 * i), 16) * keep).toString(16).padStart(2, "0").toUpperCase();
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** The package path of the generated texture artwork. */
const TEXTURE_PATH = "visuals/theme-texture.svg";

/** Formats a number for SVG without float noise. */
function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** The blueprint grid (`bp-small` 20 px tiles inside `bp-large` 100 px tiles), each line the tile-clipped half of its stroke. */
function blueprintGrid(width: number, height: number): string {
  const out: string[] = [];
  const lines = (step: number, thickness: number, alpha: number) => {
    for (let x = 0; x < width; x += step) out.push(`<rect x="${x}" y="0" width="${n(thickness)}" height="${height}" fill="#FFFFFF" fill-opacity="${alpha}"/>`);
    for (let y = 0; y < height; y += step) out.push(`<rect x="0" y="${y}" width="${width}" height="${n(thickness)}" fill="#FFFFFF" fill-opacity="${alpha}"/>`);
  };
  // The small tiles fill the large one first, then the large tile's own edge is drawn over them.
  lines(20, 0.25, 0.18);
  lines(100, 0.5, 0.35);
  return out.join("");
}

/** The dot matrix (`dot-pat` 24 px tiles): one dot of radius 1.2 at each tile's centre, in the theme ink at 30%. */
function subtleDots(width: number, height: number, ink: string): string {
  const out: string[] = [];
  for (let y = 0; y < height; y += 24) for (let x = 0; x < width; x += 24) out.push(`<circle cx="${x + 12}" cy="${y + 12}" r="1.2" fill="${ink}" fill-opacity="0.3"/>`);
  return out.join("");
}

/**
 * The lowered texture of a theme, or null when the theme has none (`none`). `holdScale` is the end card's push (`Film.tsx` scales the texture with the canvas by it,
 * about the frame centre; the drift does not reach the texture).
 */
export function themeTexture(theme: BackgroundTheme, width: number, height: number, holdScale: (f: number) => number, last: number): ThemeTexture | null {
  let body: string;
  let opacity: number;
  if (theme.gridType === "blueprint-grid") {
    body = blueprintGrid(width, height);
    opacity = 0.45;
  } else if (theme.gridType === "subtle-dots") {
    body = subtleDots(width, height, theme.ink);
    opacity = 0.35;
  } else if (theme.gridType === "paper-fibers") {
    // `feBlend mode="multiply" in="SourceGraphic"` over the lit noise: the black fill wins, so the filter draws the black rect.
    body = `<rect x="0" y="0" width="${width}" height="${height}" fill="#000000" fill-opacity="${PAPER_GRAIN_FILL}"/>`;
    opacity = PAPER_GRAIN_LAYER;
  } else {
    return null;
  }
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g id="theme-texture-grid">${body}</g></svg>`;
  const node: Node = {
    kind: "group", id: "theme-texture-hold", x: 0, y: 0, scale: 1, rotation: 0,
    tracks: [
      { property: "scale", keyframes: linearKeyframes(holdScale, 0, last) },
      { property: "x", keyframes: linearKeyframes((f) => (width / 2) * (1 - holdScale(f)), 0, last) },
      { property: "y", keyframes: linearKeyframes((f) => (height / 2) * (1 - holdScale(f)), 0, last) },
    ],
    children: [{
      kind: "svg", id: "theme-texture", asset: "svg-theme-texture", x: 0, y: 0, scale: 1, rotation: 0, layer: 0,
      tracks: [{ property: "opacity", keyframes: [{ frame: 0, value: opacity }] }],
      elementTracks: [],
    }],
  };
  return { asset: { kind: "svg", id: "svg-theme-texture", path: TEXTURE_PATH, elementIds: ["theme-texture-grid"] }, file: { path: TEXTURE_PATH, text }, node };
}
