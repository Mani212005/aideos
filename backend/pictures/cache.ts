/**
 * File Description: The picture cache of the illustrated stage, built like the per-line voice cache (backend/voiceLines.ts). Each picture a design declares (the plate or one generated object) is kept under videos/<slug>/visuals/generated/ as `<fingerprint>.png`, the original generated file byte for byte (its provenance data and invisible watermark included), beside `<fingerprint>.json`, a small record of how it was made (prompt, date, seconds, tool, sha256, size). The fingerprint is the hash of the film's one style paragraph, the object's prompt, its aspect ratio, the tool label and the cut-out settings, so a rebuild with unchanged prompts makes no request and changing one object's prompt regenerates only that object. Generation is injected: aideos never calls an image service itself (pictures are made on the captain's Mac through Codex image generation and stored with `storePicture`). Nothing here deletes a picture: originals are kept.
 * Inputs and outputs: a package directory, the design's `pictures` block and an optional generator -> each picture's cached file and record, newly stored pictures, and the pictures still to make.
 * Used by: backend/designSpec/build.ts, backend/cli.ts (`aideos pictures`), backend/designCheck/pictures.ts, backend/pictures/cache.test.ts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RasterSource } from "../../src/dl/scene/types";
import { readPngHeader, sha256Hex } from "./png";
import { composePicturePrompt, PICTURE_ASPECTS, type PictureAspect } from "./policy";

export { PICTURE_ASPECTS, type PictureAspect };

/** Bump to make every stored picture a different fingerprint when the way prompts are composed changes. */
const CACHE_VERSION = 1;

/** Where a package keeps its generated pictures, relative to the package. */
export const PICTURE_DIR = "visuals/generated";

/** Everything that decides what a picture looks like, and so its fingerprint. */
export interface PictureRequest {
  /** The film's one style paragraph, pasted into every prompt. */
  style: string;
  /** This object's own prompt. */
  prompt: string;
  aspect: PictureAspect;
  /** Which generator made it, e.g. "codex-imagegen" (a label, recorded and fingerprinted, never called). */
  tool: string;
  /** How the transparent background was obtained, e.g. "none", "generator-alpha" or "local-vision". */
  cutout: string;
}

/** The record kept beside each picture. */
export interface PictureRecord {
  schema: "aideos.picture/1";
  fingerprint: string;
  /** The exact prompt the generator was given (style paragraph, object prompt and the fixed rules). */
  prompt: string;
  style: string;
  objectPrompt: string;
  aspect: PictureAspect;
  tool: string;
  cutout: string;
  /** ISO date and time the picture was stored. */
  createdAt: string;
  /** Seconds the generation took, as the generator reported it. */
  seconds: number;
  sha256: string;
  width: number;
  height: number;
}

/** A picture found in the cache: its record and the package-relative path of its PNG. */
export interface CachedPicture {
  record: PictureRecord;
  /** Package-relative, e.g. "visuals/generated/<fingerprint>.png". */
  file: string;
}

/** The fingerprint of a picture: a hash of style paragraph, object prompt, aspect ratio, tool label and cut-out settings. */
export function pictureFingerprint(request: PictureRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([CACHE_VERSION, request.style.trim(), request.prompt.trim(), request.aspect, request.tool.trim(), request.cutout.trim()]))
    .digest("hex")
    .slice(0, 32);
}

/** The package-relative paths of one fingerprint's PNG and record. */
export function pictureFiles(fingerprint: string): { png: string; record: string } {
  return { png: `${PICTURE_DIR}/${fingerprint}.png`, record: `${PICTURE_DIR}/${fingerprint}.json` };
}

/** Reads a cached picture, or null when its PNG or record is missing, unreadable or no longer matches (then it is made again). */
export function readCachedPicture(pkgDir: string, request: PictureRequest): CachedPicture | null {
  const fingerprint = pictureFingerprint(request);
  const files = pictureFiles(fingerprint);
  try {
    const record = JSON.parse(fs.readFileSync(path.join(pkgDir, files.record), "utf8")) as PictureRecord;
    if (record.schema !== "aideos.picture/1" || record.fingerprint !== fingerprint) return null;
    const bytes = fs.readFileSync(path.join(pkgDir, files.png));
    if (sha256Hex(bytes) !== record.sha256) return null;
    return { record, file: files.png };
  } catch {
    return null;
  }
}

/**
 * Stores one generated picture under its fingerprint: the PNG exactly as the generator returned it (never
 * re-encoded, so its provenance metadata and watermark stay) and its record, each written atomically.
 * Refuses bytes that are not a PNG. Returns the stored record.
 */
export function storePicture(pkgDir: string, request: PictureRequest, png: Uint8Array, made: { seconds: number; createdAt?: Date }): PictureRecord {
  const header = readPngHeader(png);
  if (!Number.isFinite(made.seconds) || made.seconds < 0) throw new Error(`seconds must be a non-negative number, got ${made.seconds}`);
  const fingerprint = pictureFingerprint(request);
  const files = pictureFiles(fingerprint);
  const record: PictureRecord = {
    schema: "aideos.picture/1",
    fingerprint,
    prompt: composePicturePrompt(request.style, request.prompt),
    style: request.style.trim(),
    objectPrompt: request.prompt.trim(),
    aspect: request.aspect,
    tool: request.tool.trim(),
    cutout: request.cutout.trim(),
    createdAt: (made.createdAt ?? new Date()).toISOString(),
    seconds: Math.round(made.seconds * 100) / 100,
    sha256: sha256Hex(png),
    width: header.width,
    height: header.height,
  };
  const dir = path.join(pkgDir, PICTURE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const write = (rel: string, data: string | Uint8Array) => {
    const target = path.join(pkgDir, rel);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  };
  write(files.png, png);
  write(files.record, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** Makes one picture: the composed prompt in, the PNG bytes as the generator returned them out. */
export type PictureGenerator = (request: { prompt: string; aspect: PictureAspect; tool: string }) => Promise<{ png: Uint8Array; seconds: number }>;

/** One picture the design declares, by id. */
export interface DeclaredPicture {
  id: string;
  prompt: string;
  aspect: PictureAspect;
  cutout: string;
  /** The approved image's sha256: the design pins it once the picture is looked at and approved. */
  sha256?: string;
}

/** The design's `pictures` block: one style paragraph and one tool label for the whole film. */
export interface DeclaredPictures {
  style: string;
  tool: string;
  items: DeclaredPicture[];
}

/** The state of every declared picture after one pass. */
export interface PicturePass {
  /** Ready pictures as scene raster sources, keyed by picture id (src is package-relative here). */
  ready: Record<string, { file: string; record: PictureRecord }>;
  /** Pictures stored in this pass (a request was made for each). */
  generated: string[];
  /** Pictures served from the cache (no request). */
  reused: string[];
  /** Pictures with no cached file and no generator to make them. */
  missing: Array<{ id: string; fingerprint: string; prompt: string; aspect: PictureAspect }>;
}

/** The request of one declared picture. */
export function requestFor(pictures: DeclaredPictures, item: DeclaredPicture): PictureRequest {
  return { style: pictures.style, prompt: item.prompt, aspect: item.aspect, tool: pictures.tool, cutout: item.cutout };
}

/**
 * Brings every declared picture into the cache: a cached one is reused with no request, a missing one is
 * made by `generate` when one is given and stored the moment it arrives (so a run that fails part way keeps
 * what it finished), and is otherwise reported as missing with its fingerprint and composed prompt.
 */
export async function ensurePictures(pkgDir: string, pictures: DeclaredPictures, generate?: PictureGenerator): Promise<PicturePass> {
  const pass: PicturePass = { ready: {}, generated: [], reused: [], missing: [] };
  for (const item of pictures.items) {
    const request = requestFor(pictures, item);
    const cached = readCachedPicture(pkgDir, request);
    if (cached) {
      pass.ready[item.id] = cached;
      pass.reused.push(item.id);
      continue;
    }
    const prompt = composePicturePrompt(pictures.style, item.prompt);
    if (!generate) {
      pass.missing.push({ id: item.id, fingerprint: pictureFingerprint(request), prompt, aspect: item.aspect });
      continue;
    }
    const made = await generate({ prompt, aspect: item.aspect, tool: pictures.tool });
    const record = storePicture(pkgDir, request, made.png, { seconds: made.seconds });
    pass.ready[item.id] = { file: pictureFiles(record.fingerprint).png, record };
    pass.generated.push(item.id);
  }
  return pass;
}

/** The scene raster source of a ready picture, with its src made repo-relative under the package's repo path. */
export function rasterSourceOf(packageRepoPath: string, ready: { file: string; record: PictureRecord }): RasterSource {
  return { src: `${packageRepoPath}/${ready.file}`, width: ready.record.width, height: ready.record.height, sha256: ready.record.sha256 };
}

/**
 * Resolves every declared picture to its pinned, cached file for a design build, without making any request:
 * a picture with no cached image, an unpinned one or one whose cached image is not the pinned one is an error
 * that says exactly what to do. `packageRepoPath` is the package as the scene names it ("videos/<slug>").
 */
export function resolvePinnedPictures(pkgDir: string, pictures: DeclaredPictures, packageRepoPath: string): { sources: Record<string, RasterSource>; errors: string[] } {
  const sources: Record<string, RasterSource> = {};
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const item of pictures.items) {
    if (seen.has(item.id)) {
      errors.push(`picture "${item.id}" is declared twice`);
      continue;
    }
    seen.add(item.id);
    const request = requestFor(pictures, item);
    const fingerprint = pictureFingerprint(request);
    const cached = readCachedPicture(pkgDir, request);
    if (!cached) {
      errors.push(`picture "${item.id}" has no image for its current prompt yet (fingerprint ${fingerprint}): make it and store it with \`aideos pictures add ${path.basename(packageRepoPath)} ${item.id} <file.png> --seconds <s>\`, then pin its sha256 in design.json`);
      continue;
    }
    if (!item.sha256) {
      errors.push(`picture "${item.id}" is not approved yet: look at ${packageRepoPath}/${cached.file} and pin it with "sha256": "${cached.record.sha256}"`);
      continue;
    }
    if (item.sha256 !== cached.record.sha256) {
      errors.push(`picture "${item.id}" is pinned to ${item.sha256} but its prompt now gives ${cached.record.sha256} (${packageRepoPath}/${cached.file}); look at it and pin the new sha256, or restore the approved prompt`);
      continue;
    }
    sources[item.id] = rasterSourceOf(packageRepoPath, cached);
  }
  return { sources, errors };
}
