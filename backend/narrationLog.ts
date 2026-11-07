/**
 * File Description: The visible change list for a project's narration. It remembers the narration lines
 * last seen in videos/<slug>/script.md (in narration_log.json) and, each time it is synced, appends one
 * entry per added, edited or removed line, tagged with who changed it. Because it compares against what
 * was last seen rather than hooking each writer, an agent that edits script.md on disk, over MCP or through
 * the studio is recorded the same way. The first sync only sets the baseline, so the user's own story is never
 * listed as a change.
 * Inputs and outputs: a package directory and a source ("user" or "agent") -> new change entries, persisted.
 * Used by: editor/vite.config.ts (api/scripts, api/narration, api/projects/new), backend/narrationLog.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { diffNarration, narrationLines, type NarrationChangeKind } from "./storyScript";

/** Who made a narration change: the person in the studio, or the connected agent. */
export type NarrationSource = "user" | "agent";

/** One recorded narration change. */
export interface NarrationLogEntry {
  /** 1-based, increasing, never reused. */
  id: number;
  /** ISO time the change was noticed. */
  at: string;
  source: NarrationSource;
  kind: NarrationChangeKind;
  before?: string;
  after?: string;
}

/** The persisted file: the narration last seen plus every change since the baseline. */
export interface NarrationLogFile {
  version: 1;
  current: string[];
  entries: NarrationLogEntry[];
}

/** Where a package keeps its narration change list. */
export function narrationLogPath(pkgDir: string): string {
  return path.join(pkgDir, "narration_log.json");
}

/** Reads the change list, or null when the project has none yet (or it is unreadable). */
export function readNarrationLog(pkgDir: string): NarrationLogFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(narrationLogPath(pkgDir), "utf8")) as NarrationLogFile;
    return parsed.version === 1 && Array.isArray(parsed.current) && Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null;
  }
}

/** Reads the project's current script.md text ("" when there is none). */
export function readScriptText(pkgDir: string): string {
  try {
    return fs.readFileSync(path.join(pkgDir, "script.md"), "utf8");
  } catch {
    return "";
  }
}

/**
 * Compares script.md's narration with what the log last saw, appends an entry per difference (tagged
 * with `source`) and remembers the new narration. The first call for a project records the baseline and
 * returns no entries. Returns only the entries this call added.
 */
export function syncNarrationLog(pkgDir: string, source: NarrationSource, now: Date = new Date()): NarrationLogEntry[] {
  const lines = narrationLines(readScriptText(pkgDir));
  const log = readNarrationLog(pkgDir);
  if (!log) {
    fs.mkdirSync(pkgDir, { recursive: true });
    writeLog(pkgDir, { version: 1, current: lines, entries: [] });
    return [];
  }

  const changes = diffNarration(log.current, lines);
  if (changes.length === 0) return [];

  let nextId = (log.entries[log.entries.length - 1]?.id ?? 0) + 1;
  const added: NarrationLogEntry[] = changes.map((change) => ({
    id: nextId++,
    at: now.toISOString(),
    source,
    kind: change.kind,
    ...(change.before !== undefined ? { before: change.before } : {}),
    ...(change.after !== undefined ? { after: change.after } : {}),
  }));
  writeLog(pkgDir, { version: 1, current: lines, entries: [...log.entries, ...added] });
  return added;
}

/** Writes the log atomically so a reader never sees half a file. */
function writeLog(pkgDir: string, log: NarrationLogFile): void {
  const target = narrationLogPath(pkgDir);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(log, null, 2), "utf8");
  fs.renameSync(tmp, target);
}
