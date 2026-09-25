/**
 * File Description: The coding model's frame review, as the vision judge stores and reads it.
 * The connected agent looks at the sampled stills and, in one round, critiques each against the
 * narration (its own opinions and concrete suggestions), repairs the design, and reports one
 * image-text similarity score per sample against the intent text. It hands that back through
 * the aideos_submit_frame_review MCP tool (or by writing design/judge/agent-report.json), and
 * this module validates it. It also keeps the per-frame embedding log, so every score is recorded
 * with the threshold it was held to.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { designDir } from "../designSpec/build";

/** One sample's review by the coding model. */
export const sampleReviewSchema = z.object({
  frame: z.number().int().min(0),
  /** The model's own opinions on the frame against the narration and intent. */
  note: z.string().max(2000).default(""),
  /** Concrete suggestions, each one a change it would make. */
  suggestions: z.array(z.string().min(1).max(500)).max(6).default([]),
  /** Image-text agreement of the still with the intent text, 0 (unrelated) to 1 (exactly this). */
  similarity: z.number().min(0).max(1).nullable().optional(),
  /** True when the model already changed the design to fix what its note describes. */
  repaired: z.boolean().optional(),
});

export const frameReviewSchema = z.object({ samples: z.array(sampleReviewSchema).max(400) });

export type SampleReview = z.infer<typeof sampleReviewSchema>;

/** A stored review with the time it was submitted. */
export interface StoredFrameReview {
  at: string;
  samples: SampleReview[];
}

/** One line of the per-frame embedding log. */
export interface EmbeddingLogEntry {
  at: string;
  frame: number;
  shotId: string;
  /** The image-text score, or null when nothing produced one. */
  score: number | null;
  /** The threshold the score was held to. */
  threshold: number;
  pass: boolean | null;
  source: "agent" | "injected" | "none";
}

// Returns the folder holding a film's judge records.
export function judgeDir(filmId: string): string {
  return path.join(designDir(filmId), "judge");
}

// Validates and stores the coding model's review, returning what was saved.
export function writeAgentReview(filmId: string, raw: unknown, now: () => Date = () => new Date()): StoredFrameReview {
  const parsed = frameReviewSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  }
  const stored: StoredFrameReview = { at: now().toISOString(), samples: parsed.data.samples };
  fs.mkdirSync(judgeDir(filmId), { recursive: true });
  fs.writeFileSync(path.join(judgeDir(filmId), "agent-report.json"), JSON.stringify(stored, null, 2) + "\n");
  return stored;
}

// Reads the coding model's review when it was submitted after `since`, else null.
export function readAgentReview(filmId: string, since?: string): StoredFrameReview | null {
  const file = path.join(judgeDir(filmId), "agent-report.json");
  if (!fs.existsSync(file)) return null;
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as StoredFrameReview;
    const checked = frameReviewSchema.safeParse({ samples: stored.samples });
    if (!checked.success || (since !== undefined && !(stored.at > since))) return null;
    return { at: stored.at, samples: checked.data.samples };
  } catch {
    return null;
  }
}

// Appends one line per frame to the film's embedding log.
export function appendEmbeddingLog(filmId: string, entries: EmbeddingLogEntry[]): void {
  fs.mkdirSync(judgeDir(filmId), { recursive: true });
  fs.appendFileSync(path.join(judgeDir(filmId), "embedding-log.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""));
}
