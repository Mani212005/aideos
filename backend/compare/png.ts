/**
 * File Description: Minimal PNG writer and reader for the `aideos compare` contact sheet: 8-bit RGB, filter 0 on every row, zlib deflate, own CRC32.
 * No image library and no browser are needed. The reader only understands what this writer produces (it exists so a test can read sheet pixels back).
 * Inputs and outputs: width, height and packed RGB bytes -> PNG file bytes; PNG bytes written by this module -> width, height and packed RGB bytes.
 * Used by: backend/compare/board.ts, backend/compare/compare.test.ts.
 */

import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// CRC32 of a byte range, as PNG chunks need.
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// One PNG chunk: length, type, data and CRC.
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// Encodes packed RGB bytes (width * height * 3) as a PNG file.
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`bad PNG size ${width}x${height}`);
  if (rgb.length !== width * height * 3) throw new Error(`PNG data has ${rgb.length} bytes, expected ${width * height * 3}`);
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

// Decodes a PNG written by encodePng (8-bit RGB, filter 0, one IDAT chunk or more).
export function decodePng(file: Buffer): { width: number; height: number; rgb: Uint8Array } {
  if (file.length < 33 || file.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG file");
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  for (let pos = 8; pos + 12 <= file.length; ) {
    const length = file.readUInt32BE(pos);
    const type = file.toString("ascii", pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2) throw new Error("only 8-bit RGB PNG files are supported");
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error("only filter 0 rows are supported");
    rgb.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, rgb };
}
