/**
 * File Description: Records and reads the owner's own verdict for a video package (videos/<slug>/owner-verdict.json). Final acceptance requires the owner's watch (docs/GOOD_VIDEO.md); automated tools like all-check never write this file or mark a film owner-approved.
 * Inputs and outputs: a film slug, owner decision (publish, publish-after-fixes, reject) and optional notes -> persisted OwnerVerdictRecord JSON and approval checks for the current film hash.
 * Used by: backend/lessons/cli.ts (aideos verdict), future self-improvement journal/loop, backend/lessons/verdict.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../videoPackageLoader";
import { hashFileOrNull } from "../filmAcceptance/store";
import { FILM_ID } from "../pipeline/generatedFiles";

/** The owner's decision after watching a film. */
export type OwnerVerdictDecision = "publish" | "publish-after-fixes" | "reject";

/** One timestamped owner verdict recorded after watching a specific film revision. */
export interface OwnerVerdictEntry {
  verdict: OwnerVerdictDecision;
  notes: string[];
  /** SHA-256 of videos/<slug>/film.json at the time the owner recorded this verdict. */
  filmHash: string | null;
  recordedBy: "owner";
  recordedAt: string;
}

/** The saved owner verdict file next to videos/<slug>/film.json. */
export interface OwnerVerdictRecord extends OwnerVerdictEntry {
  schema: "aideos.owner-verdict/1";
  slug: string;
  /** Append-only history of owner verdicts on this film, oldest first. */
  history: OwnerVerdictEntry[];
}

/** Arguments for recording an owner verdict on a film package. */
export interface RecordOwnerVerdictInput {
  slug: string;
  verdict: string;
  notes?: readonly string[];
  /** Override package directory (defaults to resolvePackageDir(slug)). */
  pkgDir?: string;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

const VALID_DECISIONS = new Set<OwnerVerdictDecision>([
  "publish",
  "publish-after-fixes",
  "reject",
]);

// Parses a CLI or API decision string into a canonical OwnerVerdictDecision ("fix" aliases "publish-after-fixes").
export function parseOwnerVerdictDecision(raw: string): OwnerVerdictDecision {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "publish") return "publish";
  if (normalized === "fix" || normalized === "publish-after-fixes") {
    return "publish-after-fixes";
  }
  if (normalized === "reject") return "reject";
  throw new Error(
    `Invalid owner verdict "${raw}". Expected one of: publish, fix (publish-after-fixes), reject`,
  );
}

// Path of a video package's owner verdict record.
export function ownerVerdictPath(pkgDir: string): string {
  return path.join(pkgDir, "owner-verdict.json");
}

// Validates one verdict entry loaded from disk.
function parseEntry(raw: unknown): OwnerVerdictEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.verdict !== "string" ||
    !VALID_DECISIONS.has(obj.verdict as OwnerVerdictDecision)
  ) {
    return null;
  }
  if (obj.recordedBy !== "owner") return null;
  if (typeof obj.recordedAt !== "string" || !obj.recordedAt.trim()) return null;
  const notes = Array.isArray(obj.notes)
    ? obj.notes.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    : [];
  const filmHash =
    typeof obj.filmHash === "string" && obj.filmHash.length > 0 ? obj.filmHash : null;
  return {
    verdict: obj.verdict as OwnerVerdictDecision,
    notes,
    filmHash,
    recordedBy: "owner",
    recordedAt: obj.recordedAt,
  };
}

// Reads a package's saved owner verdict; returns null when absent or invalid, never inferring approval from automated checks.
export function readOwnerVerdict(pkgDir: string): OwnerVerdictRecord | null {
  const file = ownerVerdictPath(pkgDir);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (!parsed || parsed.schema !== "aideos.owner-verdict/1") return null;
    if (typeof parsed.slug !== "string" || !FILM_ID.test(parsed.slug)) return null;
    const latest = parseEntry(parsed);
    if (!latest) return null;
    const rawHistory = Array.isArray(parsed.history) ? parsed.history : [];
    const history = rawHistory
      .map(parseEntry)
      .filter((entry): entry is OwnerVerdictEntry => entry !== null);
    return {
      schema: "aideos.owner-verdict/1",
      slug: parsed.slug,
      ...latest,
      history: history.length > 0 ? history : [latest],
    };
  } catch {
    return null;
  }
}

// True only when the owner explicitly recorded "publish" for the exact film manifest bytes currently on disk.
export function isOwnerApprovedForFilm(
  record: OwnerVerdictRecord | null,
  currentFilmHash: string | null,
): boolean {
  return (
    record !== null &&
    record.recordedBy === "owner" &&
    record.verdict === "publish" &&
    record.filmHash !== null &&
    currentFilmHash !== null &&
    record.filmHash === currentFilmHash
  );
}

// Records the owner's verdict atomically next to film.json, appending to the package's verdict history.
export function recordOwnerVerdict(input: RecordOwnerVerdictInput): OwnerVerdictRecord {
  const slug = input.slug.trim();
  if (!FILM_ID.test(slug)) {
    throw new Error(`Invalid film slug "${input.slug}": expected lowercase letters, digits and hyphens`);
  }
  const decision = parseOwnerVerdictDecision(input.verdict);
  const pkgDir = input.pkgDir ?? resolvePackageDir(slug);
  const filmPath = path.join(pkgDir, "film.json");
  if (!fs.existsSync(filmPath)) {
    throw new Error(`No video package found for "${slug}" (missing ${filmPath})`);
  }

  const filmHash = hashFileOrNull(filmPath);
  const notes = (input.notes ?? []).map((note) => note.trim()).filter(Boolean);
  const recordedAt = (input.now ?? (() => new Date()))().toISOString();
  const entry: OwnerVerdictEntry = {
    verdict: decision,
    notes,
    filmHash,
    recordedBy: "owner",
    recordedAt,
  };

  const existing = readOwnerVerdict(pkgDir);
  const history = existing ? [...existing.history, entry] : [entry];
  const record: OwnerVerdictRecord = {
    schema: "aideos.owner-verdict/1",
    slug,
    ...entry,
    history,
  };

  fs.mkdirSync(pkgDir, { recursive: true });
  const target = ownerVerdictPath(pkgDir);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record, null, 2) + "\n", "utf8");
  fs.renameSync(temp, target);
  return record;
}

// Formats an owner verdict record for terminal display.
export function formatOwnerVerdict(
  record: OwnerVerdictRecord,
  currentFilmHash?: string | null,
): string {
  const stale =
    currentFilmHash !== undefined &&
    record.filmHash !== null &&
    currentFilmHash !== record.filmHash;
  const lines = [
    `Owner verdict for ${record.slug}: ${record.verdict}${stale ? " (stale: film.json changed since verdict)" : ""}`,
    `  recorded at: ${record.recordedAt}`,
    `  film hash:   ${record.filmHash ? record.filmHash.slice(0, 12) : "unknown"}`,
  ];
  if (record.notes.length > 0) {
    lines.push("  notes:");
    for (const note of record.notes) lines.push(`    - ${note}`);
  }
  if (record.history.length > 1) {
    lines.push(`  history:     ${record.history.length} verdicts recorded`);
  }
  return lines.join("\n");
}
