/**
 * File Description: Bounded retention for timestamped Studio exports (aideos_<film>_<format>_<epoch>.mp4) in videos/<film>/renders/. Rule: per film and format, keep the newest two timestamped exports plus the just-finished export, and also keep every export whose SHA-256 mp4 hash is named in videos/<film>/acceptance.json (formats[format].mp4Hash, formats[format].measured.mp4Hash, formats[format].judged[*].mp4Hash). Everything else timestamped is removed with its sidecars. CLI renders, hand-named files and other formats or films are never touched. Fails closed: if acceptance.json exists but cannot be read or parsed, nothing is deleted; an export that cannot be hashed is kept. owner-verdict.json is not part of retention.
 * Inputs and outputs: renders directory, film id, format, keep count, protected filenames, and optional acceptance.json path -> list of kept and removed export files.
  * Used by: editor/vite.config.ts (POST /api/export onDone), backend/exportRetention.test.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/** Default number of timestamped Studio exports retained per film and format. */
export const STUDIO_EXPORT_KEEP_PER_FORMAT = 2;

/** Sidecar suffixes generated beside a rendered mp4 by RenderJob. */
export const STUDIO_EXPORT_SIDECAR_SUFFIXES = [
  ".render.json",
  ".master.json",
  ".publish.lock",
] as const;

export interface PruneStudioExportsInput {
  rendersDir: string;
  filmId: string;
  format: "long" | "reel";
  /** Number of newest timestamped Studio exports to keep per format (default 2). */
  keep?: number;
  /** Additional filenames that must never be deleted (for example the just-finished export). */
  keepFilenames?: Iterable<string>;
  /** Optional path to videos/<film>/acceptance.json; exports whose SHA-256 mp4 hash it names are never deleted. */
  acceptancePath?: string;
}

export interface PruneStudioExportsResult {
  kept: string[];
  removed: string[];
  protectedNames: string[];
  /** Set when pruning aborted safely without deleting any file (for example an unreadable acceptance record). */
  skippedReason?: string;
}

// Escapes regex metacharacters in a literal string.
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Extracts the epoch-millisecond timestamp from a Studio export filename for one film and format, or null for any other file.
export function parseStudioExportFilename(
  filename: string,
  filmId: string,
  format: "long" | "reel",
): number | null {
  if (!filmId) return null;
  const pattern = new RegExp(`^aideos_${escapeRegex(filmId)}_${format}_(\\d+)\\.mp4$`);
  const match = pattern.exec(filename);
  if (!match) return null;
  const ts = Number(match[1]);
  return Number.isSafeInteger(ts) ? ts : null;
}

// Adds a value to the set when it is a non-empty string.
function addHash(value: unknown, out: Set<string>): void {
  if (typeof value === "string" && value.trim()) out.add(value.trim().toLowerCase());
}

// Reads the SHA-256 mp4 hashes named by acceptance.json (record, measured and judged draws of each format); fails closed when the file exists but cannot be read or parsed.
export function readProtectedMp4Hashes(
  acceptancePath: string,
): { ok: true; hashes: Set<string> } | { ok: false; reason: string } {
  if (!fs.existsSync(acceptancePath)) {
    return { ok: true, hashes: new Set<string>() };
  }
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(acceptancePath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("expected a JSON object");
    }
    const formats = (raw as { formats?: unknown }).formats;
    const hashes = new Set<string>();
    if (formats && typeof formats === "object") {
      for (const record of Object.values(formats as Record<string, unknown>)) {
        if (!record || typeof record !== "object") continue;
        const { mp4Hash, measured, judged } = record as {
          mp4Hash?: unknown;
          measured?: { mp4Hash?: unknown } | null;
          judged?: unknown;
        };
        addHash(mp4Hash, hashes);
        addHash(measured?.mp4Hash, hashes);
        if (Array.isArray(judged)) {
          for (const draw of judged) addHash((draw as { mp4Hash?: unknown } | null)?.mp4Hash, hashes);
        }
      }
    }
    return { ok: true, hashes };
  } catch (err) {
    return {
      ok: false,
      reason: `unreadable acceptance record at ${acceptancePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// SHA-256 of a file as lowercase hex, streamed in chunks, or null when it cannot be read.
async function hashFile(file: string): Promise<string | null> {
  try {
    const hash = crypto.createHash("sha256");
    await pipeline(fs.createReadStream(file), hash);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

// Removes Studio exports beyond the newest `keep` per format while never deleting hand-named, CLI, active, or published exports.
export async function pruneStudioExports(input: PruneStudioExportsInput): Promise<PruneStudioExportsResult> {
  const keep = input.keep ?? STUDIO_EXPORT_KEEP_PER_FORMAT;
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`Invalid keep count (${keep}): expected a positive integer`);
  }
  if (!fs.existsSync(input.rendersDir)) {
    return { kept: [], removed: [], protectedNames: [] };
  }

  const protectedSet = new Set<string>();
  if (input.keepFilenames) {
    for (const name of input.keepFilenames) {
      if (name) protectedSet.add(path.basename(name));
    }
  }

  let protectedHashes = new Set<string>();
  if (input.acceptancePath) {
    const accepted = readProtectedMp4Hashes(input.acceptancePath);
    if (accepted.ok === false) {
      return {
        kept: [],
        removed: [],
        protectedNames: [...protectedSet].sort(),
        skippedReason: accepted.reason,
      };
    }
    protectedHashes = accepted.hashes;
  }

  const candidates: Array<{ name: string; ts: number }> = [];
  for (const entry of fs.readdirSync(input.rendersDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ts = parseStudioExportFilename(entry.name, input.filmId, input.format);
    if (ts !== null) candidates.push({ name: entry.name, ts });
  }

  candidates.sort((a, b) => b.ts - a.ts || b.name.localeCompare(a.name));

  const kept: string[] = [];
  const removed: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const { name } = candidates[i];
    const target = path.join(input.rendersDir, name);
    if (i < keep || protectedSet.has(name)) {
      kept.push(name);
      continue;
    }
    const hash = protectedHashes.size > 0 ? await hashFile(target) : null;
    if (protectedHashes.size > 0 && (hash === null || protectedHashes.has(hash))) {
      protectedSet.add(name);
      kept.push(name);
      continue;
    }
    fs.rmSync(target, { force: true });
    for (const suffix of STUDIO_EXPORT_SIDECAR_SUFFIXES) {
      fs.rmSync(`${target}${suffix}`, { force: true });
    }
    removed.push(name);
  }

  return {
    kept,
    removed,
    protectedNames: [...protectedSet].sort(),
  };
}
