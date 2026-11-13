/**
 * File Description: Persistence of the film acceptance machine. Reads and writes videos/<slug>/acceptance.json
 * (one record per format plus the ledger of films the tools themselves wrote), hashes film manifests and mp4
 * files, and answers "is film.json something a tool wrote or a hand edit" and "is this film the reviewed one".
 * Inputs and outputs: a package directory, a format and events -> the saved acceptance file and summaries.
 * Used by: backend/allCheck/round.ts, backend/allCheck/finish.ts, backend/pipeline/filmStore.ts,
 * backend/designSpec/build.ts, editor/vite.config.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  classifyFilmEdit,
  initialRecord,
  summarize,
  transition,
  withToolWrite,
  type AcceptanceEvent,
  type AcceptanceFormat,
  type AcceptanceRecord,
  type AcceptanceSummary,
  type FilmEditState,
} from "./machine";

/** The saved acceptance state of one video package. */
export interface AcceptanceFile {
  schema: "aideos.acceptance/1";
  /** Hashes of the film.json files the tools wrote, newest last. A film.json outside this list was edited by hand. */
  toolWrites: string[];
  formats: Partial<Record<AcceptanceFormat, AcceptanceRecord>>;
}

// SHA-256 of some bytes or text, as hex.
export function hashBytes(content: string | Uint8Array): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// SHA-256 of a file, or null when it is missing or unreadable.
export function hashFileOrNull(file: string): string | null {
  try {
    return hashBytes(fs.readFileSync(file));
  } catch {
    return null;
  }
}

// Path of a package's acceptance file.
export function acceptancePath(pkgDir: string): string {
  return path.join(pkgDir, "acceptance.json");
}

// Reads a package's acceptance file; a missing or unreadable one is an empty file, never an error.
export function readAcceptance(pkgDir: string): AcceptanceFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(acceptancePath(pkgDir), "utf8")) as Partial<AcceptanceFile>;
    if (parsed && parsed.schema === "aideos.acceptance/1") {
      return { schema: parsed.schema, toolWrites: Array.isArray(parsed.toolWrites) ? parsed.toolWrites : [], formats: parsed.formats ?? {} };
    }
  } catch {
    // Fall through to an empty file.
  }
  return { schema: "aideos.acceptance/1", toolWrites: [], formats: {} };
}

// Saves a package's acceptance file atomically.
function writeAcceptance(pkgDir: string, file: AcceptanceFile): void {
  fs.mkdirSync(pkgDir, { recursive: true });
  const target = acceptancePath(pkgDir);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(file, null, 2) + "\n");
  fs.renameSync(temp, target);
}

// The record of one format, or an empty one when nothing was recorded.
export function readRecord(pkgDir: string, format: AcceptanceFormat): AcceptanceRecord {
  return readAcceptance(pkgDir).formats[format] ?? initialRecord(format);
}

// Feeds events to one format's record in order and saves the result; an impossible event throws and saves nothing.
export function applyEvents(pkgDir: string, format: AcceptanceFormat, events: AcceptanceEvent[]): AcceptanceRecord {
  const file = readAcceptance(pkgDir);
  let record = file.formats[format] ?? initialRecord(format);
  for (const event of events) record = transition(record, event);
  writeAcceptance(pkgDir, { ...file, formats: { ...file.formats, [format]: record } });
  return record;
}

// Remembers the exact text a tool just wrote to film.json, so a later edit by hand can be told apart from it.
export function noteFilmWrite(pkgDir: string, contents: string): void {
  const file = readAcceptance(pkgDir);
  const hash = hashBytes(contents);
  if (file.toolWrites[file.toolWrites.length - 1] === hash) return;
  writeAcceptance(pkgDir, { ...file, toolWrites: withToolWrite(file.toolWrites, hash) });
}

// How a package's film.json stands against the films the tools wrote: clean, hand-edited, or untracked (no ledger yet).
export function filmEditState(pkgDir: string): FilmEditState {
  return classifyFilmEdit(readAcceptance(pkgDir).toolWrites, hashFileOrNull(path.join(pkgDir, "film.json")));
}

// The plain-language state of the film that would be exported in one format.
export function acceptanceSummary(pkgDir: string, format: AcceptanceFormat, currentFilmHash: string | null): AcceptanceSummary {
  const file = readAcceptance(pkgDir);
  return summarize(file.formats[format] ?? null, currentFilmHash);
}

// Summarizes the exact serialized film supplied by the export client, independent of film.json on disk.
export function acceptanceSummaryForFilm(pkgDir: string, format: AcceptanceFormat, film: unknown): AcceptanceSummary {
  return acceptanceSummary(pkgDir, format, hashBytes(JSON.stringify(film, null, 2)));
}
