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

// Undoes the per-row filters of one (sub)image in place, returning the raw scanlines without filter bytes.
function unfilter(data: Uint8Array, offset: number, width: number, height: number, bpp: number, bitsPerPixel: number): { rows: Uint8Array; next: number } {
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const rows = new Uint8Array(stride * height);
  let at = offset;
  for (let y = 0; y < height; y++) {
    if (at + 1 + stride > data.length) throw new Error("PNG image data is shorter than its size needs");
    const filter = data[at++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[at + x];
      const a = x >= bpp ? rows[row + x - bpp] : 0;
      const b = y > 0 ? rows[prev + x] : 0;
      const c = x >= bpp && y > 0 ? rows[prev + x - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: v = raw + paeth(a, b, c); break;
        default: throw new Error(`PNG row ${y} uses unknown filter ${filter}`);
      }
      rows[row + x] = v & 255;
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
  // Writes one decoded scanline of a (sub)image into the output at the given pixel positions.
  const put = (rows: Uint8Array, w: number, y: number, xAt: (x: number) => number, yOut: number) => {
    const stride = Math.ceil((w * bitsPerPixel) / 8);
    const start = y * stride;
    for (let x = 0; x < w; x++) {
      const o = (yOut * width + xAt(x)) * 4;
      if (colorType === 3) {
        const index = sample(rows, start, x, bitDepth, false);
        if (index * 3 + 2 >= plte!.length) throw new Error(`palette index ${index} is outside the PLTE chunk`);
        rgba[o] = plte![index * 3];
        rgba[o + 1] = plte![index * 3 + 1];
        rgba[o + 2] = plte![index * 3 + 2];
        rgba[o + 3] = trns && index < trns.length ? trns[index] : 255;
        continue;
      }
      const s = (k: number) => sample(rows, start, x * channels + k, bitDepth, true);
      const raw = (k: number) => (bitDepth === 16 ? (rows[start + (x * channels + k) * 2] << 8) | rows[start + (x * channels + k) * 2 + 1] : sample(rows, start, x * channels + k, bitDepth, false));
      if (colorType === 0 || colorType === 4) {
        const g = s(0);
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g;
        rgba[o + 3] = colorType === 4 ? s(1) : trns && trns.length >= 2 && raw(0) === trns.readUInt16BE(0) ? 0 : 255;
      } else {
        rgba[o] = s(0); rgba[o + 1] = s(1); rgba[o + 2] = s(2);
        rgba[o + 3] = colorType === 6 ? s(3) : trns && trns.length >= 6 && raw(0) === trns.readUInt16BE(0) && raw(1) === trns.readUInt16BE(2) && raw(2) === trns.readUInt16BE(4) ? 0 : 255;
      }
    }
  };
  if (!header.interlaced) {
    const { rows } = unfilter(data, 0, width, height, bpp, bitsPerPixel);
    for (let y = 0; y < height; y++) put(rows, width, y, (x) => x, y);
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
      for (let y = 0; y < h; y++) put(rows, w, y, (x) => x0 + x * dx, y0 + y * dy);
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
