/**
 * File Description: The word shape shared by the edit-context detectors and the MCP edit tools (the
 * voiceover WordInfo plus an ASR confidence score and a filler flag), and the reader that loads a
 * package's word transcript for edit planning. No transcription runs in this repo.
 * Inputs and outputs: a package slug -> TranscribedWord list with the source file and an optional warning.
 * Used by: backend/editContext/buildEditContext.ts, backend/editContext/detectFillers.ts, backend/editContext/detectSilences.ts import the type; backend/mcp/server.ts reads transcripts with readTranscriptWords.
 */

import fs from "fs";
import path from "path";
import type { WordInfo } from "./audio";
import { getVideosDir } from "../src/dl/videoPackageLoader";

/** A transcribed word: the shared WordInfo shape plus the ASR backend's own confidence score. */
export interface TranscribedWord extends WordInfo {
  confidence?: number;
  /** Set once a filler-detection pass has run over the transcript. Absent until then. */
  filler?: boolean;
}

/** Transcript read for edit planning: the words found, which file they came from, and a warning when an existing file was unusable. */
export interface TranscriptRead {
  words: TranscribedWord[];
  /** The sidecar the words came from, or null when the package has no transcript at all. */
  source: "import_words.json" | "voiceover_words.json" | null;
  /** Set when a transcript file exists but could not be read or has the wrong shape; absent when it is simply missing or fine. */
  warning?: string;
}

// True when a decoded JSON value is a usable word entry (text plus finite start and end seconds).
function isWordEntry(value: unknown): value is TranscribedWord {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Record<string, unknown>;
  return typeof w.word === "string" && Number.isFinite(w.start) && Number.isFinite(w.end);
}

/**
 * Reads a package's word-level transcript for edit planning. The imported transcript wins over the
 * voiceover one. A missing transcript is normal (empty words, no warning); an existing one that is
 * unreadable, not JSON or the wrong shape yields empty words plus a warning, so the caller can tell
 * the planner ran without transcript context instead of believing the transcript was empty.
 */
export function readTranscriptWords(slug: string, videosDir: string = getVideosDir()): TranscriptRead {
  const dir = path.join(videosDir, slug);
  for (const source of ["import_words.json", "voiceover_words.json"] as const) {
    const file = path.join(dir, source);
    if (!fs.existsSync(file)) continue;
    let decoded: unknown;
    try {
      decoded = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return { words: [], source, warning: `${source} exists but could not be read (${why}); planning without a transcript.` };
    }
    const list = (decoded as { words?: unknown } | null)?.words;
    if (!Array.isArray(list)) {
      return { words: [], source, warning: `${source} has no "words" list; planning without a transcript.` };
    }
    const bad = list.filter((entry) => !isWordEntry(entry)).length;
    if (bad > 0) {
      return { words: [], source, warning: `${source} has ${bad} of ${list.length} word entries without text, start or end; planning without a transcript.` };
    }
    return { words: list as TranscribedWord[], source };
  }
  return { words: [], source: null };
}
