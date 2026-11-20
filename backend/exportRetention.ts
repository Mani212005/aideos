/**
 * File Description: Bounded retention for timestamped Studio exports in videos/<film>/renders/. Keeps the newest exports per format so repeated Studio exports cannot fill a tight disk, while strictly preserving CLI renders, hand-named exports, active outputs, and any file referenced by publish/record.json.
 * Inputs and outputs: renders directory, film id, format, keep count, protected filenames, and optional publish record path -> list of kept and removed export files.
 * Used by: editor/vite.config.ts (POST /api/export onDone), backend/exportRetention.test.ts.
 */

import fs from "node:fs";
import path from "node:path";

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
  /** Optional path to videos/<film>/publish/record.json; files named in it are never deleted. */
  publishRecordPath?: string;
}

export interface PruneStudioExportsResult {
  kept: string[];
  removed: string[];
  protectedNames: string[];
  /** Set when pruning aborted safely without deleting any file (for example a corrupt publish record). */
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

// Recursively collects file basenames from string values inside a JSON publish record.
function collectReferencedBasenames(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.add(path.basename(trimmed));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedBasenames(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectReferencedBasenames(entry, out);
    }
  }
}

// Reads filenames referenced by publish/record.json; fails closed when the file exists but cannot be parsed.
export function readProtectedPublishFilenames(
  publishRecordPath: string,
): { ok: true; names: Set<string> } | { ok: false; reason: string } {
  if (!fs.existsSync(publishRecordPath)) {
    return { ok: true, names: new Set<string>() };
  }
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(publishRecordPath, "utf8"));
    const names = new Set<string>();
    collectReferencedBasenames(raw, names);
    return { ok: true, names };
  } catch (err) {
    return {
      ok: false,
      reason: `unreadable publish record at ${publishRecordPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Removes Studio exports beyond the newest `keep` per format while never deleting hand-named, CLI, active, or published exports.
export function pruneStudioExports(input: PruneStudioExportsInput): PruneStudioExportsResult {
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

  if (input.publishRecordPath) {
    const published = readProtectedPublishFilenames(input.publishRecordPath);
    if (!published.ok) {
      return {
        kept: [],
        removed: [],
        protectedNames: [...protectedSet].sort(),
        skippedReason: published.reason,
      };
    }
    for (const name of published.names) protectedSet.add(name);
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
    if (i < keep || protectedSet.has(name)) {
      kept.push(name);
      continue;
    }
    const target = path.join(input.rendersDir, name);
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
