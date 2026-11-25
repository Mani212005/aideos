/**
 * File Description: A small, dependency-free PNG reader and writer for the picture layer (the illustrated stage's plate and generated objects): reads a PNG's size from its header, decodes any standard PNG (every colour type and bit depth, Adam7 interlacing, palette transparency) into straight-alpha RGBA8, encodes RGBA8 as a plain PNG (the tiny synthetic test fixtures), hashes file bytes with sha256, and checks a declared picture against its file on disk. Uses only node:zlib and node:crypto, so the design check, the scene validator and the image cache read pixels the same way without a native image library.
 * Inputs and outputs: PNG bytes or a repo-relative path -> { width, height } or decoded RGBA pixels; RGBA pixels -> PNG bytes; a declared RasterSource -> the problems with its file.
 * Used by: src/dl/scene/validateSceneNode.ts, backend/pictures/cache.ts, backend/designCheck/pictures.ts, backend/designSpec/build.ts, backend/scene/loadSceneAssets.ts, tests.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import type { RasterSource } from "../../src/dl/scene/types";
import { resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";

/** The eight bytes every PNG starts with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decoded pixels: straight (not premultiplied) RGBA, 8 bits a channel, rows top to bottom. */
export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** The facts a PNG header states. */
export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaced: boolean;
}

/** Lowercase hex sha256 of some bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Splits a PNG into its chunks after checking the signature.
function chunks(png: Uint8Array): Array<{ type: string; data: Buffer }> {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG file (bad signature)");
  const out: Array<{ type: string; data: Buffer }> = [];
  let at = 8;
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    if (at + 12 + length > buf.length) throw new Error(`PNG chunk ${type} runs past the end of the file`);
    out.push({ type, data: buf.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === "IEND") break;
  }
  return out;
}

/** Reads a PNG's header (size, bit depth, colour type, interlacing) without decoding pixels. */
export function readPngHeader(png: Uint8Array): PngHeader {
  const first = chunks(png)[0];
  if (!first || first.type !== "IHDR" || first.data.length !== 13) throw new Error("PNG has no valid IHDR header");
  const d = first.data;
  const header = { width: d.readUInt32BE(0), height: d.readUInt32BE(4), bitDepth: d[8], colorType: d[9], interlaced: d[12] === 1 };
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[header.colorType]?.includes(header.bitDepth)) throw new Error(`PNG colour type ${header.colorType} with bit depth ${header.bitDepth} is not valid`);
  if (header.width < 1 || header.height < 1) throw new Error("PNG has an empty size");
  if (d[10] !== 0 || d[11] !== 0 || d[12] > 1) throw new Error("PNG uses an unknown compression, filter or interlace method");
  return header;
}

/** Channels per pixel of each PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// The Paeth predictor of the PNG filter spec.
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Undoes the per-row filters of one (sub)image, returning the raw scanlines without filter bytes. The filter is chosen once per row, outside the byte loop.
function unfilter(data: Uint8Array, offset: number, width: number, height: number, bpp: number, bitsPerPixel: number): { rows: Uint8Array; next: number } {
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const rows = new Uint8Array(stride * height);
  // The row above the first row reads as zeros, so every filter treats row 0 like any other row.
  const zeros = new Uint8Array(stride);
  const lead = Math.min(bpp, stride);
  let at = offset;
  for (let y = 0; y < height; y++) {
    if (at + 1 + stride > data.length) throw new Error("PNG image data is shorter than its size needs");
    const filter = data[at++];
    const row = y * stride;
    const up = y > 0 ? rows : zeros;
    const upAt = y > 0 ? row - stride : 0;
    switch (filter) {
      case 0:
        rows.set(data.subarray(at, at + stride), row);
        break;
      case 1:
        for (let x = 0; x < lead; x++) rows[row + x] = data[at + x];
        for (let x = bpp; x < stride; x++) rows[row + x] = data[at + x] + rows[row + x - bpp];
        break;
      case 2:
        for (let x = 0; x < stride; x++) rows[row + x] = data[at + x] + up[upAt + x];
        break;
      case 3:
        for (let x = 0; x < lead; x++) rows[row + x] = data[at + x] + (up[upAt + x] >> 1);
        for (let x = bpp; x < stride; x++) rows[row + x] = data[at + x] + ((rows[row + x - bpp] + up[upAt + x]) >> 1);
        break;
      case 4:
        for (let x = 0; x < lead; x++) rows[row + x] = data[at + x] + paeth(0, up[upAt + x], 0);
        for (let x = bpp; x < stride; x++) rows[row + x] = data[at + x] + paeth(rows[row + x - bpp], up[upAt + x], up[upAt + x - bpp]);
        break;
      default:
        throw new Error(`PNG row ${y} uses unknown filter ${filter}`);
    }
    at += stride;
  }
  return { rows, next: at };
}

// Reads sample `i` of a scanline at a bit depth, scaled to 8 bits.
function sample(row: Uint8Array, start: number, i: number, depth: number, scale: boolean): number {
  if (depth === 8) return row[start + i];
  if (depth === 16) return row[start + i * 2];
  const bit = i * depth;
  const v = (row[start + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  return scale ? Math.round((v * 255) / ((1 << depth) - 1)) : v;
}

// Reads the full-precision value of sample `i` of a scanline (16-bit channels keep both bytes), as the tRNS colour key compares it.
function rawSample(row: Uint8Array, start: number, i: number, depth: number): number {
  return depth === 16 ? (row[start + i * 2] << 8) | row[start + i * 2 + 1] : sample(row, start, i, depth, false);
}

/** Decodes a PNG into straight-alpha RGBA8 (16-bit channels keep their high byte; tRNS transparency is applied). */
export function decodePng(png: Uint8Array): RgbaImage {
  const header = readPngHeader(png);
  const all = chunks(png);
  const idat = Buffer.concat(all.filter((c) => c.type === "IDAT").map((c) => c.data));
  if (idat.length === 0) throw new Error("PNG has no image data");
  const data = new Uint8Array(zlib.inflateSync(idat));
  const { width, height, bitDepth, colorType } = header;
  const channels = CHANNELS[colorType];
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const plte = all.find((c) => c.type === "PLTE")?.data;
  const trns = all.find((c) => c.type === "tRNS")?.data;
  if (colorType === 3 && !plte) throw new Error("palette PNG has no PLTE chunk");
  const rgba = new Uint8Array(width * height * 4);
  // The tRNS colour key of a grey or RGB image as full-precision samples (null when the image has none).
  const keyGray = colorType === 0 && trns && trns.length >= 2 ? trns.readUInt16BE(0) : null;
  const keyRgb = colorType === 2 && trns && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  // The palette as RGBA entries (alpha from tRNS), so a palette pixel is one table lookup.
  const entries = plte ? Math.floor(plte.length / 3) : 0;
  const palette = new Uint8Array(entries * 4);
  for (let i = 0; i < entries; i++) {
    palette[i * 4] = plte![i * 3];
    palette[i * 4 + 1] = plte![i * 3 + 1];
    palette[i * 4 + 2] = plte![i * 3 + 2];
    palette[i * 4 + 3] = trns && i < trns.length ? trns[i] : 255;
  }
  // Writes one decoded scanline of a (sub)image into the output: pixel x lands at column xStart + x * xStep of row yOut.
  const put = (rows: Uint8Array, w: number, y: number, xStart: number, xStep: number, yOut: number): void => {
    const start = y * Math.ceil((w * bitsPerPixel) / 8);
    const oStep = xStep * 4;
    let o = (yOut * width + xStart) * 4;
    if (bitDepth === 8 && colorType === 6) {
      // 8-bit RGBA is already the output layout.
      if (xStep === 1) rgba.set(rows.subarray(start, start + w * 4), o);
      else for (let x = 0; x < w; x++, o += oStep) for (let k = 0; k < 4; k++) rgba[o + k] = rows[start + x * 4 + k];
      return;
    }
    if (bitDepth === 8 && colorType === 2) {
      for (let x = 0, i = start; x < w; x++, i += 3, o += oStep) {
        const r = rows[i], g = rows[i + 1], b = rows[i + 2];
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b;
        rgba[o + 3] = keyRgb && r === keyRgb[0] && g === keyRgb[1] && b === keyRgb[2] ? 0 : 255;
      }
      return;
    }
    if (colorType === 3) {
      for (let x = 0; x < w; x++, o += oStep) {
        const index = bitDepth === 8 ? rows[start + x] : sample(rows, start, x, bitDepth, false);
        if (index >= entries) throw new Error(`palette index ${index} is outside the PLTE chunk`);
        const p = index * 4;
        rgba[o] = palette[p]; rgba[o + 1] = palette[p + 1]; rgba[o + 2] = palette[p + 2]; rgba[o + 3] = palette[p + 3];
      }
      return;
    }
    // Every other layout (grey, grey and alpha, 16-bit, sub-byte depths) reads samples one at a time.
    for (let x = 0; x < w; x++, o += oStep) {
      const at = x * channels;
      if (colorType === 0 || colorType === 4) {
        const g = sample(rows, start, at, bitDepth, true);
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g;
        rgba[o + 3] = colorType === 4 ? sample(rows, start, at + 1, bitDepth, true) : keyGray !== null && rawSample(rows, start, at, bitDepth) === keyGray ? 0 : 255;
      } else {
        rgba[o] = sample(rows, start, at, bitDepth, true); rgba[o + 1] = sample(rows, start, at + 1, bitDepth, true); rgba[o + 2] = sample(rows, start, at + 2, bitDepth, true);
        rgba[o + 3] = colorType === 6 ? sample(rows, start, at + 3, bitDepth, true) : keyRgb && rawSample(rows, start, at, bitDepth) === keyRgb[0] && rawSample(rows, start, at + 1, bitDepth) === keyRgb[1] && rawSample(rows, start, at + 2, bitDepth) === keyRgb[2] ? 0 : 255;
      }
    }
  };
  if (!header.interlaced) {
    const { rows } = unfilter(data, 0, width, height, bpp, bitsPerPixel);
    for (let y = 0; y < height; y++) put(rows, width, y, 0, 1, y);
  } else {
    // Adam7: seven passes, each a small filtered image on its own grid.
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    let offset = 0;
    for (const [x0, y0, dx, dy] of passes) {
      const w = Math.ceil((width - x0) / dx);
      const h = Math.ceil((height - y0) / dy);
      if (w <= 0 || h <= 0) continue;
      const { rows, next } = unfilter(data, offset, w, h, bpp, bitsPerPixel);
      offset = next;
      for (let y = 0; y < h; y++) put(rows, w, y, x0, dx, y0 + y * dy);
    }
  }
  return { width, height, rgba };
}

/** The CRC-32 table of the PNG spec (polynomial 0xEDB88320). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

// The CRC-32 of some bytes, as PNG chunks carry it.
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Writes one PNG chunk with its CRC.
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes straight-alpha RGBA8 pixels as a plain, non-interlaced RGBA PNG with no metadata. */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, rgba } = image;
  if (rgba.length !== width * height * 4) throw new Error(`expected ${width * height * 4} RGBA bytes, got ${rgba.length}`);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Every problem with a declared picture's file: missing, not a PNG, a different size or bytes that no longer match the pin. */
export function rasterFileProblems(assetId: string, raster: RasterSource, resolve: (src: string) => string = resolveRepoAssetPath): string[] {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(resolve(raster.src));
  } catch {
    return [`Asset "${assetId}" picture file not found on disk: "${raster.src}"`];
  }
  let header: PngHeader;
  try {
    header = readPngHeader(bytes);
  } catch (err) {
    return [`Asset "${assetId}" picture "${raster.src}" is not a readable PNG: ${err instanceof Error ? err.message : String(err)}`];
  }
  const problems: string[] = [];
  if (header.width !== raster.width || header.height !== raster.height) problems.push(`Asset "${assetId}" picture "${raster.src}" is ${header.width} x ${header.height} pixels but the scene declares ${raster.width} x ${raster.height}`);
  const actual = sha256Hex(bytes);
  if (actual !== raster.sha256) problems.push(`Asset "${assetId}" picture "${raster.src}" has sha256 ${actual}, not the pinned ${raster.sha256}; approve the new image by pinning it in the design, or restore the approved file`);
  return problems;
}
