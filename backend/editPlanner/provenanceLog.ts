/**
 * File Description: Provenance Logging for AI Video Edit Operations (Phase 4).
 * Appends a structured edit-event record to videos/<slug>/edit_log.jsonl whenever
 * an edit program is planned or applied. Each record captures the natural-language
 * request, the resolved EditOp[] program, the plan summary, timestamps, and whether
 * the result was a dry-run preview or an applied commit. No record is ever mutated -
 * the log is append-only and is the durable audit trail for agent-driven batch edits.
 * Inputs and outputs: edit event record and slug -> appended edit_log.jsonl file.
 * Used by: backend/editPlanner/interpreter.ts.
 */

import fs from "node:fs";
import path from "node:path";
import type { EditOp } from "./schema";

/** A single provenance record written to the edit log. */
export interface EditProvenanceRecord {
  /** ISO-8601 timestamp of the edit event. */
  timestamp: string;
  /** The film package slug this edit targets. */
  filmId: string;
  /** Natural-language edit request that produced this program. */
  request: string;
  /** Natural-language plan summary returned by the planner. */
  plan: string;
  /** Resolved edit program. */
  ops: EditOp[];
  /** Number of LLM repair attempts required to validate the program. */
  attempts: number;
  /** Whether this record represents a dry-run preview (plan only, not applied). */
  dryRun: boolean;
  /** Optional identity of the agent or user that initiated the edit. */
  source?: string;
  /** Warnings emitted during planning or application. */
  warnings?: string[];
}

/**
 * Appends a single provenance record to the film's edit_log.jsonl file.
 * Each line is a self-contained JSON object (JSON Lines format).
 * The file is created on first write; subsequent writes append without rewrites.
 */
export function appendEditProvenanceRecord(
  videosDir: string,
  filmId: string,
  record: Omit<EditProvenanceRecord, "filmId" | "timestamp">,
  source?: string,
): void {
  const logPath = path.join(videosDir, filmId, "edit_log.jsonl");
  const entry: EditProvenanceRecord = {
    timestamp: new Date().toISOString(),
    filmId,
    ...record,
    source: source ?? record.source,
  };
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // Provenance write is best-effort: log but never throw on failure
    console.error("[provenance] Failed to write edit log:", err);
  }
}

/**
 * Reads all provenance records for a film, newest first.
 * Returns an empty array if the log file does not exist.
 */
export function readEditProvenanceLog(
  videosDir: string,
  filmId: string,
): EditProvenanceRecord[] {
  const logPath = path.join(videosDir, filmId, "edit_log.jsonl");
  if (!fs.existsSync(logPath)) return [];
  try {
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as EditProvenanceRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is EditProvenanceRecord => r !== null)
      .reverse(); // newest first
  } catch {
    return [];
  }
}
