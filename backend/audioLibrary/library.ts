/**
 * File Description: Audio library loader, item hashing, cache management, fetcher and verifier.
 * Inputs and outputs: audio/library.json and cache paths -> fetched and verified audio assets in .audio-library.
 * Used by: backend/audioLibrary/cli.ts, backend/cli.ts.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { getProjectRoot, getAudioLibraryCacheDir } from "../../src/dl/videoPackageLoader";
import { audioItemIdSchema, parseAudioLibrary, type AudioItem, type AudioLibrary } from "./schema";

export type AudioItemStatus = "valid" | "missing" | "mismatch" | "unavailable";

export interface AudioItemVerifyResult {
  id: string;
  kind: "music" | "sfx";
  title: string;
  filename: string;
  durationSec: number;
  status: AudioItemStatus;
  expectedSha256: string;
  actualSha256?: string;
  expectedBytes: number;
  actualBytes?: number;
  message?: string;
}

export interface AudioLibraryVerifyReport {
  ok: boolean;
  cacheDir: string;
  summary: {
    total: number;
    valid: number;
    missing: number;
    mismatch: number;
    unavailable: number;
  };
  results: AudioItemVerifyResult[];
}

export interface AudioFetchItemResult {
  id: string;
  filename: string;
  status: "downloaded" | "skipped" | "manual";
  bytes: number;
  sha256: string;
  message?: string;
}

export interface AudioLibraryFetchReport {
  ok: boolean;
  cacheDir: string;
  summary: {
    total: number;
    downloaded: number;
    skipped: number;
    manual: number;
  };
  results: AudioFetchItemResult[];
}

// Resolves the default path to the committed audio/library.json file.
export function getDefaultLibraryPath(): string {
  return path.resolve(getProjectRoot(), "audio/library.json");
}

// Loads and validates audio/library.json from disk.
export function loadAudioLibrary(customPath?: string): AudioLibrary {
  const filePath = customPath ? path.resolve(customPath) : getDefaultLibraryPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio library file not found: ${filePath}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return parseAudioLibrary(raw);
}

// Determines the destination cache filename for an audio library item.
export function getAudioItemFilename(item: { id: string; url: string | null; archivePath?: string }): string {
  audioItemIdSchema.parse(item.id);
  if (item.archivePath) {
    const ext = path.extname(item.archivePath) || ".ogg";
    return `${item.id}${ext}`;
  }
  if (item.url) {
    const cleanUrl = item.url.split("?")[0].split("#")[0];
    const ext = path.extname(cleanUrl) || ".mp3";
    return `${item.id}${ext}`;
  }
  return `${item.id}.mp3`;
}

// Returns the full absolute path of an audio item inside the cache.
export function getAudioItemCachePath(
  item: { id: string; url: string | null; archivePath?: string },
  customCacheDir?: string
): string {
  const cacheDir = customCacheDir ? path.resolve(customCacheDir) : getAudioLibraryCacheDir();
  return path.join(cacheDir, getAudioItemFilename(item));
}

// Computes the lowercase SHA256 hex digest of a file on disk.
export function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest("hex");
}

// Verifies a single audio item against the cache on disk.
export function verifyAudioItem(item: AudioItem, customCacheDir?: string): AudioItemVerifyResult {
  const filename = getAudioItemFilename(item);
  const filePath = getAudioItemCachePath(item, customCacheDir);

  if (!fs.existsSync(filePath)) {
    if (item.url === null) {
      return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        filename,
        durationSec: item.durationSec,
        status: "unavailable",
        expectedSha256: item.sha256,
        expectedBytes: item.bytes,
        message: "Manual item not yet imported into cache",
      };
    }
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      filename,
      durationSec: item.durationSec,
      status: "missing",
      expectedSha256: item.sha256,
      expectedBytes: item.bytes,
      message: "File missing from cache",
    };
  }

  const stat = fs.statSync(filePath);
  const actualSha256 = computeFileSha256(filePath);

  if (actualSha256 !== item.sha256) {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      filename,
      durationSec: item.durationSec,
      status: "mismatch",
      expectedSha256: item.sha256,
      actualSha256,
      expectedBytes: item.bytes,
      actualBytes: stat.size,
      message: `SHA256 mismatch (expected ${item.sha256.slice(0, 16)}..., got ${actualSha256.slice(0, 16)}...)`,
    };
  }

  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    filename,
    durationSec: item.durationSec,
    status: "valid",
    expectedSha256: item.sha256,
    actualSha256,
    expectedBytes: item.bytes,
    actualBytes: stat.size,
  };
}

// Verifies every item in an audio library against the shared cache.
export function verifyAudioLibrary(library: AudioLibrary, options: { cacheDir?: string } = {}): AudioLibraryVerifyReport {
  const cacheDir = options.cacheDir ? path.resolve(options.cacheDir) : getAudioLibraryCacheDir();
  const results = library.items.map((item) => verifyAudioItem(item, cacheDir));

  const summary = {
    total: results.length,
    valid: results.filter((r) => r.status === "valid").length,
    missing: results.filter((r) => r.status === "missing").length,
    mismatch: results.filter((r) => r.status === "mismatch").length,
    unavailable: results.filter((r) => r.status === "unavailable").length,
  };

  const ok = summary.missing === 0 && summary.mismatch === 0 && summary.unavailable === 0;

  return {
    ok,
    cacheDir,
    summary,
    results,
  };
}

// Downloads raw bytes from a URL and saves them to a destination file.
async function downloadToFile(url: string, destPath: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  } catch {
    // Fall back to curl if Node fetch encountered network or SSL transport issue
    execFileSync("curl", ["-fsSL", url, "-o", destPath], { stdio: "pipe" });
  }
}

// Fetches a single audio item, verifies its sha256, and stores it in the cache.
export async function fetchAudioItem(
  item: AudioItem,
  options: {
    cacheDir?: string;
    force?: boolean;
    archiveCache?: Map<string, string>;
  } = {}
): Promise<AudioFetchItemResult> {
  const cacheDir = options.cacheDir ? path.resolve(options.cacheDir) : getAudioLibraryCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });

  const filename = getAudioItemFilename(item);
  const targetPath = path.join(cacheDir, filename);

  // Check if file is already present with matching hash
  if (fs.existsSync(targetPath) && !options.force) {
    const existingSha256 = computeFileSha256(targetPath);
    if (existingSha256 === item.sha256) {
      return {
        id: item.id,
        filename,
        status: "skipped",
        bytes: item.bytes,
        sha256: item.sha256,
        message: "already present in cache (hash match)",
      };
    }
  }

  // Handle manual items where url is null
  if (item.url === null) {
    if (fs.existsSync(targetPath)) {
      const existingSha256 = computeFileSha256(targetPath);
      if (existingSha256 === item.sha256) {
        return {
          id: item.id,
          filename,
          status: "skipped",
          bytes: item.bytes,
          sha256: item.sha256,
          message: "manual item already present in cache",
        };
      }
    }
    return {
      id: item.id,
      filename,
      status: "manual",
      bytes: item.bytes,
      sha256: item.sha256,
      message: `manual item needs import: run "aideos audio import ${item.id} <file>"`,
    };
  }

  const tempPath = path.join(cacheDir, `${filename}.tmp.${Date.now()}`);

  try {
    if (item.archivePath) {
      let archiveZip = options.archiveCache?.get(item.url);
      if (!archiveZip || !fs.existsSync(archiveZip)) {
        archiveZip = path.join(cacheDir, `archive_${crypto.randomBytes(6).toString("hex")}.zip`);
        try {
          await downloadToFile(item.url, archiveZip);
        } catch (err) {
          if (fs.existsSync(archiveZip)) {
            fs.unlinkSync(archiveZip);
          }
          throw err;
        }
        options.archiveCache?.set(item.url, archiveZip);
      }
      const extracted = execFileSync("unzip", ["-p", archiveZip, item.archivePath], {
        maxBuffer: Math.max(item.bytes + 1, 1024),
      });
      fs.writeFileSync(tempPath, extracted);
    } else {
      await downloadToFile(item.url, tempPath);
    }

    if (!fs.existsSync(tempPath)) {
      throw new Error(`Failed to download audio item ${item.id} from ${item.url}`);
    }

    const downloadedSha256 = computeFileSha256(tempPath);
    if (downloadedSha256 !== item.sha256) {
      fs.unlinkSync(tempPath);
      throw new Error(
        `SHA256 mismatch for "${item.id}": expected ${item.sha256}, got ${downloadedSha256}`
      );
    }

    fs.renameSync(tempPath, targetPath);

    return {
      id: item.id,
      filename,
      status: "downloaded",
      bytes: item.bytes,
      sha256: item.sha256,
    };
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw err;
  }
}

// Fetches audio items sequentially into the shared cache and verifies hashes.
export async function fetchAudioLibrary(
  library: AudioLibrary,
  options: {
    cacheDir?: string;
    force?: boolean;
    itemId?: string;
    onProgress?: (result: AudioFetchItemResult) => void;
  } = {}
): Promise<AudioLibraryFetchReport> {
  const cacheDir = options.cacheDir ? path.resolve(options.cacheDir) : getAudioLibraryCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });

  const archiveCache = new Map<string, string>();
  const itemsToFetch = options.itemId
    ? library.items.filter((item) => item.id === options.itemId)
    : library.items;

  if (options.itemId && itemsToFetch.length === 0) {
    throw new Error(`Audio item "${options.itemId}" not found in library manifest`);
  }

  const results: AudioFetchItemResult[] = [];

  try {
    for (const item of itemsToFetch) {
      const result = await fetchAudioItem(item, {
        cacheDir,
        force: options.force,
        archiveCache,
      });
      results.push(result);
      options.onProgress?.(result);
    }
  } finally {
    for (const zipPath of archiveCache.values()) {
      if (fs.existsSync(zipPath)) {
        try {
          fs.unlinkSync(zipPath);
        } catch {
          // Ignore cleanup errors for temp archives
        }
      }
    }
  }

  const summary = {
    total: results.length,
    downloaded: results.filter((r) => r.status === "downloaded").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    manual: results.filter((r) => r.status === "manual").length,
  };

  return {
    ok: summary.manual === 0,
    cacheDir,
    summary,
    results,
  };
}

// Imports a local audio file as a manual item into the shared cache.
export function importManualAudioItem(
  id: string,
  sourceFilePath: string,
  options: {
    libraryPath?: string;
    cacheDir?: string;
  } = {}
): { item: AudioItem; cachePath: string; sha256: string } {
  const library = loadAudioLibrary(options.libraryPath);
  const item = library.items.find((i) => i.id === id);
  if (!item) {
    throw new Error(`Audio item "${id}" not found in audio library manifest`);
  }

  const resolvedSource = path.resolve(sourceFilePath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Source audio file not found: ${resolvedSource}`);
  }

  const fileSha256 = computeFileSha256(resolvedSource);
  if (item.sha256 && fileSha256 !== item.sha256) {
    throw new Error(
      `SHA256 mismatch for manual item "${id}": expected ${item.sha256}, got ${fileSha256}`
    );
  }

  const cacheDir = options.cacheDir ? path.resolve(options.cacheDir) : getAudioLibraryCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });

  const filename = getAudioItemFilename(item);
  const targetPath = path.join(cacheDir, filename);

  fs.copyFileSync(resolvedSource, targetPath);

  return {
    item,
    cachePath: targetPath,
    sha256: fileSha256,
  };
}
