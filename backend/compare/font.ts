/**
 * File Description: A built-in 5x7 pixel font (upper case letters, digits and a few signs) and the drawing helpers the `aideos compare` contact sheet uses
 * for labels, so the sheet needs no system font, no drawtext filter and no browser. Lower case text is drawn as upper case; an unknown character is drawn as "?".
 * Inputs and outputs: an RGB canvas, a position, a text and a scale -> the text drawn into the canvas; a text and a scale -> its pixel width.
 * Used by: backend/compare/board.ts.
 */

/** A packed RGB canvas. */
export interface Canvas {
  width: number;
  height: number;
  data: Uint8Array;
}

/** An RGB colour, 0 to 255 per channel. */
export type Rgb = [number, number, number];

/** Glyph width and height in font pixels, and the advance between glyphs. */
export const GLYPH = { width: 5, height: 7, advance: 6 } as const;

// Each glyph is seven rows of five columns, joined by "/" ("#" is ink).
const GLYPHS: Record<string, string> = {
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#",
  B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.",
  D: "####./#...#/#...#/#...#/#...#/#...#/####.",
  E: "#####/#..../#..../####./#..../#..../#####",
  F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.###.",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: ".###./..#../..#../..#../..#../..#../.###.",
  J: "..###/...#./...#./...#./...#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#",
  L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#",
  N: "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
  P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".####/#..../#..../.###./....#/....#/####.",
  T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..",
  Z: "#####/....#/...#./..#../.#.../#..../#####",
  "0": ".###./#...#/#..##/#.#.#/##..#/#...#/.###.",
  "1": "..#../.##../..#../..#../..#../..#../.###.",
  "2": ".###./#...#/....#/...#./..#../.#.../#####",
  "3": "####./....#/....#/.###./....#/....#/####.",
  "4": "...#./..##./.#.#./#..#./#####/...#./...#.",
  "5": "#####/#..../####./....#/....#/#...#/.###.",
  "6": ".###./#..../#..../####./#...#/#...#/.###.",
  "7": "#####/....#/...#./..#../.#.../.#.../.#...",
  "8": ".###./#...#/#...#/.###./#...#/#...#/.###.",
  "9": ".###./#...#/#...#/.####/....#/....#/.###.",
  ".": "...../...../...../...../...../.##../.##..",
  ":": "...../.##../.##../...../.##../.##../.....",
  "#": ".#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.",
  "-": "...../...../...../#####/...../...../.....",
  "/": "....#/....#/...#./..#../.#.../#..../#....",
  "%": "##..#/##..#/...#./..#../.#.../#..##/#..##",
  "(": "...#./..#../.#.../.#.../.#.../..#../...#.",
  ")": ".#.../..#../...#./...#./...#./..#../.#...",
  ",": "...../...../...../...../.##../..#../.#...",
  "+": "...../..#../..#../#####/..#../..#../.....",
  "=": "...../...../#####/...../#####/...../.....",
  "_": "...../...../...../...../...../...../#####",
  " ": "...../...../...../...../...../...../.....",
  "?": ".###./#...#/....#/...#./..#../...../..#..",
};

// The pixel width of a text at a scale (no trailing gap).
export function textWidth(text: string, scale: number): number {
  return text.length === 0 ? 0 : (text.length * GLYPH.advance - (GLYPH.advance - GLYPH.width)) * scale;
}

// A new canvas filled with one colour.
export function newCanvas(width: number, height: number, fill: Rgb): Canvas {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
  }
  return { width, height, data };
}

// Fills a rectangle (clipped to the canvas).
export function fillRect(canvas: Canvas, x: number, y: number, w: number, h: number, color: Rgb): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(canvas.width, Math.round(x + w));
  const y1 = Math.min(canvas.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * canvas.width + xx) * 3;
      canvas.data[i] = color[0];
      canvas.data[i + 1] = color[1];
      canvas.data[i + 2] = color[2];
    }
  }
}

// Draws a text with its top left corner at (x, y); returns the pixel width it used.
export function drawText(canvas: Canvas, x: number, y: number, text: string, scale: number, color: Rgb): number {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const rows = (GLYPHS[ch] ?? GLYPHS["?"]).split("/");
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < GLYPH.width; rx++) if (row[rx] === "#") fillRect(canvas, cx + rx * scale, y + ry * scale, scale, scale, color);
    });
    cx += GLYPH.advance * scale;
  }
  return textWidth(text, scale);
}

// Copies packed RGB pixels (w * h * 3 bytes) into the canvas at (x, y).
export function blit(canvas: Canvas, x: number, y: number, w: number, h: number, rgb: Uint8Array): void {
  for (let yy = 0; yy < h; yy++) {
    const dy = y + yy;
    if (dy < 0 || dy >= canvas.height) continue;
    for (let xx = 0; xx < w; xx++) {
      const dx = x + xx;
      if (dx < 0 || dx >= canvas.width) continue;
      const s = (yy * w + xx) * 3;
      const d = (dy * canvas.width + dx) * 3;
      canvas.data[d] = rgb[s];
      canvas.data[d + 1] = rgb[s + 1];
      canvas.data[d + 2] = rgb[s + 2];
    }
  }
}
