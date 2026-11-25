/**
 * File Description: Property tests of the dependency-free PNG decoder. A small independent PNG encoder (forward filters, bit packing, Adam7 passes, palette and tRNS chunks, written from the PNG spec) turns random samples into files of every colour type, bit depth and interlace method; the decoder must give back exactly the RGBA the spec says those samples mean. Bad filter bytes, palette indexes outside the PLTE chunk and short image data must keep failing with a named error.
 * Inputs and outputs: seeded random samples encoded as PNG files -> decoded RGBA compared byte for byte with the RGBA computed from the samples.
 * Used by: npm test (found by glob).
 */

import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { decodePng } from "./png";

/** Valid bit depths of each PNG colour type. */
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
/** Channels per pixel of each colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Adam7 passes: x start, y start, x step, y step. */
const PASSES = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/** A seeded generator of numbers in [0, 1), so a failure names a case that can be run again. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** One PNG chunk (the decoder does not check CRCs, so the CRC is left zero). */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, data, Buffer.alloc(4)]);
}

/** The Paeth predictor, as the PNG spec states it. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Filters one scanline forward with filter `type` against the row above, as an encoder does. */
function filterRow(type: number, row: Uint8Array, above: Uint8Array, bpp: number): Buffer {
  const out = Buffer.alloc(1 + row.length);
  out[0] = type;
  for (let x = 0; x < row.length; x++) {
    const a = x >= bpp ? row[x - bpp] : 0;
    const b = above[x];
    const c = x >= bpp ? above[x - bpp] : 0;
    const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type];
    out[1 + x] = (row[x] - predicted) & 255;
  }
  return out;
}

/** Packs samples into a scanline of `depth`-bit values. */
function packRow(samples: number[], depth: number): Uint8Array {
  const row = new Uint8Array(Math.ceil((samples.length * depth) / 8));
  samples.forEach((v, i) => {
    if (depth === 16) {
      row[i * 2] = v >> 8;
      row[i * 2 + 1] = v & 255;
    } else {
      const bit = i * depth;
      row[bit >> 3] |= v << (8 - depth - (bit & 7));
    }
  });
  return row;
}

/** A PNG file and the RGBA the spec says it shows. */
interface Case {
  png: Buffer;
  width: number;
  height: number;
  expected: Uint8Array;
}

/** Builds a random PNG of one layout together with the RGBA its samples mean (grey levels scaled to 8 bits, 16-bit channels reduced to the high byte, palette and tRNS applied). */
function buildCase(rand: () => number, colorType: number, depth: number, width: number, height: number, interlaced: boolean, withTrns: boolean): Case {
  const channels = CHANNELS[colorType];
  const max = depth === 16 ? 65535 : (1 << depth) - 1;
  const levels = max + 1;
  // A small value range makes the tRNS colour key match real pixels.
  const range = withTrns && colorType !== 3 ? Math.min(levels, 3) : levels;
  const samples: number[][][] = Array.from({ length: height }, () => Array.from({ length: width }, () => Array.from({ length: channels }, () => Math.floor(rand() * range))));
  const paletteSize = colorType === 3 ? Math.min(levels, 256) : 0;
  const palette = Array.from({ length: paletteSize }, () => [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)]);
  const paletteAlpha = Array.from({ length: Math.floor(rand() * (paletteSize + 1)) }, () => Math.floor(rand() * 256));
  const key = Array.from({ length: channels === 3 ? 3 : 1 }, () => Math.floor(rand() * range));
  const to8 = (v: number) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max));
  const expected = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = samples[y][x];
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        // A palette index beyond the PLTE chunk is not drawable, so indexes stay inside it.
        s[0] %= paletteSize;
        expected.set([...palette[s[0]], s[0] < paletteAlpha.length && withTrns ? paletteAlpha[s[0]] : 255], o);
      } else if (colorType === 0 || colorType === 4) {
        const alpha = colorType === 4 ? to8(s[1]) : withTrns && s[0] === key[0] ? 0 : 255;
        expected.set([to8(s[0]), to8(s[0]), to8(s[0]), alpha], o);
      } else {
        const alpha = colorType === 6 ? to8(s[3]) : withTrns && s[0] === key[0] && s[1] === key[1] && s[2] === key[2] ? 0 : 255;
        expected.set([to8(s[0]), to8(s[1]), to8(s[2]), alpha], o);
      }
    }
  }
  // Scanlines of each (sub)image, each filtered with a random filter type against the row above.
  const bpp = Math.max(1, (channels * depth) >> 3);
  const grids = interlaced ? PASSES.map(([x0, y0, dx, dy]) => ({ x0, y0, dx, dy })) : [{ x0: 0, y0: 0, dx: 1, dy: 1 }];
  const parts: Buffer[] = [];
  for (const g of grids) {
    const xs: number[] = [];
    for (let x = g.x0; x < width; x += g.dx) xs.push(x);
    if (xs.length === 0) continue;
    let above: Uint8Array = new Uint8Array(Math.ceil((xs.length * channels * depth) / 8));
    for (let y = g.y0; y < height; y += g.dy) {
      const row = packRow(xs.flatMap((x) => samples[y][x]), depth);
      parts.push(filterRow(Math.floor(rand() * 5), row, above, bpp));
      above = row;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  ihdr[12] = interlaced ? 1 : 0;
  const chunks = [chunk("IHDR", ihdr)];
  if (colorType === 3) chunks.push(chunk("PLTE", Buffer.from(palette.flat())));
  if (withTrns && colorType === 3) chunks.push(chunk("tRNS", Buffer.from(paletteAlpha)));
  if (withTrns && colorType === 0) chunks.push(chunk("tRNS", Buffer.from([key[0] >> 8, key[0] & 255])));
  if (withTrns && colorType === 2) chunks.push(chunk("tRNS", Buffer.from(key.flatMap((k) => [k >> 8, k & 255]))));
  chunks.push(chunk("IDAT", zlib.deflateSync(Buffer.concat(parts))), chunk("IEND", Buffer.alloc(0)));
  return { png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]), width, height, expected };
}

test("decoder: every colour type, bit depth and interlace method decodes to the RGBA the spec says, whatever filter each row uses", () => {
  const sizes: Array<[number, number]> = [[1, 1], [1, 6], [7, 1], [3, 5], [9, 9], [17, 13]];
  const rand = seeded(20261125);
  let cases = 0;
  for (const colorType of [0, 2, 3, 4, 6]) {
    for (const depth of DEPTHS[colorType]) {
      for (const interlaced of [false, true]) {
        for (const [w, h] of sizes) {
          for (const withTrns of [false, true]) {
            const c = buildCase(rand, colorType, depth, w, h, interlaced, withTrns);
            const image = decodePng(c.png);
            assert.equal(image.width, w);
            assert.equal(image.height, h);
            assert.deepEqual(Buffer.from(image.rgba), Buffer.from(c.expected), `colour type ${colorType}, depth ${depth}, ${interlaced ? "interlaced" : "plain"}, ${w}x${h}, tRNS ${withTrns}`);
            cases++;
          }
        }
      }
    }
  }
  assert.equal(cases, 2 * 6 * 2 * 15, "every valid layout was exercised");
});

test("decoder: a filter byte outside 0 to 4, a palette index outside PLTE and image data cut short each fail with a named error", () => {
  const rand = seeded(7);
  const good = buildCase(rand, 6, 8, 4, 4, false, false);
  assert.doesNotThrow(() => decodePng(good.png));
  const rebuild = (mutate: (raw: Buffer) => Buffer, base: Buffer): Buffer => {
    const idatAt = base.indexOf("IDAT") - 4;
    const length = base.readUInt32BE(idatAt);
    const raw = zlib.inflateSync(base.subarray(idatAt + 8, idatAt + 8 + length));
    return Buffer.concat([base.subarray(0, idatAt), chunk("IDAT", zlib.deflateSync(mutate(raw))), chunk("IEND", Buffer.alloc(0))]);
  };
  assert.throws(() => decodePng(rebuild((raw) => { raw[0] = 5; return raw; }, good.png)), /unknown filter 5/);
  assert.throws(() => decodePng(rebuild((raw) => raw.subarray(0, raw.length - 2), good.png)), /shorter than its size needs/);
  const paletted = buildCase(rand, 3, 8, 4, 4, false, false);
  const plteAt = paletted.png.indexOf("PLTE") - 4;
  const shortPalette = Buffer.concat([paletted.png.subarray(0, plteAt), chunk("PLTE", Buffer.from([1, 2, 3])), paletted.png.subarray(plteAt + 12 + paletted.png.readUInt32BE(plteAt))]);
  assert.throws(() => decodePng(rebuild((raw) => { for (let y = 0; y < 4; y++) raw.fill(0, y * 5, y * 5 + 1).fill(200, y * 5 + 1, y * 5 + 5); return raw; }, shortPalette)), /palette index 200 is outside the PLTE chunk/);
});
