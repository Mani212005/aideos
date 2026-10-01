/**
 * File Description: The `aideos review` orchestrator: resolves what to review, measures the rendered
 * video (picture, text, audio) plus film data and narration where they exist, evaluates the rubric
 * criteria, extracts evidence frames for what failed, and writes review.json. The JSON is the
 * interface other tools read (the Gemini review loop includes it as context); the process exit code
 * is non-zero when any gate criterion fails. Deterministic: same video, same report.
 */

import fs from "node:fs";
import path from "node:path";
import { evaluateCriteria } from "./criteria";
import { detectSilences, extractStill, measureLoudness, probeVideo } from "./media";
import { measureRender } from "./renderFacts";
import { loadFilmFacts, siblingFile, type FilmFacts } from "./source";
import { loadNarration, type Narration } from "./speech";
import type { CriterionResult, ReviewReport } from "./types";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** What to review and the optional extra inputs. */
export interface ReviewRequest {
  /** A film slug under videos/ or the path of an mp4. */
  target: string;
  /** Path of a film.json to read the camera, persistence and geometry from. */
  film?: string;
  /** Path of word timings (JSON) or narration text for audio sync, caption matching and grounding. */
  words?: string;
  /** Where review.json and review/ evidence frames go. */
  outDir?: string;
  /** Do not write anything (used by tests and dry runs). */
  noWrite?: boolean;
  skipOcr?: boolean;
  onProgress?: (message: string) => void;
}

/** The resolved inputs of a review. */
export interface ResolvedTarget {
  subject: string;
  mp4: string;
  film: string | null;
  words: string | null;
  outDir: string;
}

// Finds the rendered mp4 of a film slug among the places the pipeline and the studio put it.
function findSlugVideo(slug: string): string | null {
  const dir = path.join(REPO_ROOT, "videos", slug);
  const candidates = [path.join(REPO_ROOT, "out", `${slug}-long.mp4`), path.join(REPO_ROOT, "out", `${slug}.mp4`)];
  if (fs.existsSync(dir)) candidates.push(...fs.readdirSync(dir).filter((f) => f.endsWith(".mp4")).map((f) => path.join(dir, f)));
  candidates.push(path.join(REPO_ROOT, "out", `${slug}-reel.mp4`));
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

// Works out the mp4, film data, narration and output folder for a slug or an mp4 path.
export function resolveTarget(req: ReviewRequest): ResolvedTarget {
  const asFile = path.resolve(req.target);
  if (/\.(mp4|mov|webm|mkv)$/i.test(req.target) || (fs.existsSync(asFile) && fs.statSync(asFile).isFile())) {
    if (!fs.existsSync(asFile)) throw new Error(`no video at ${asFile}`);
    const base = path.basename(asFile).replace(/\.[^.]+$/, "");
    return {
      subject: asFile,
      mp4: asFile,
      film: req.film ? path.resolve(req.film) : null,
      words: req.words ? path.resolve(req.words) : null,
      outDir: path.resolve(req.outDir ?? path.join(REPO_ROOT, ".frames", "review", base)),
    };
  }
  const slug = req.target;
  const dir = path.join(REPO_ROOT, "videos", slug);
  const filmJson = path.join(dir, "film.json");
  if (!fs.existsSync(filmJson)) throw new Error(`"${slug}" is neither an mp4 nor a film: no videos/${slug}/film.json`);
  const mp4 = findSlugVideo(slug);
  if (!mp4) throw new Error(`no rendered video for "${slug}": looked for out/${slug}-long.mp4, out/${slug}.mp4 and videos/${slug}/*.mp4. Render it first (npm run render) or pass an mp4 path.`);
  return {
    subject: slug,
    mp4,
    film: req.film ? path.resolve(req.film) : filmJson,
    words: req.words ? path.resolve(req.words) : siblingFile(filmJson, "voiceover_words.json"),
    outDir: path.resolve(req.outDir ?? dir),
  };
}

// Extracts a still for every evidence time of the criteria that failed, so each finding can be looked at.
function attachEvidenceFrames(mp4: string, criteria: CriterionResult[], outDir: string, durationSec: number): void {
  const frameDir = path.join(outDir, "review");
  for (const c of criteria) {
    if (c.status !== "fail") continue;
    for (const e of c.evidence.slice(0, 4)) {
      const t = Math.min(Math.max(0, e.t), Math.max(0, durationSec - 0.1));
      const name = `${c.key}-${t.toFixed(1)}s.jpg`;
      if (extractStill(mp4, t, path.join(frameDir, name))) e.frame = path.posix.join("review", name);
    }
  }
}

// Builds ordered, concrete recommendations from the failures, gate failures first.
function recommend(criteria: CriterionResult[]): string[] {
  const failed = criteria.filter((c) => c.status === "fail" && c.fix);
  return [...failed.filter((c) => c.gate), ...failed.filter((c) => !c.gate)].map((c) => `${c.gate ? "[gate] " : ""}${c.name}: ${c.fix}`);
}

// Reviews one video end to end and returns the report (and writes it unless asked not to).
export async function reviewVideo(req: ReviewRequest): Promise<ReviewReport> {
  const target = resolveTarget(req);
  const video = probeVideo(target.mp4);
  let film: FilmFacts | null = null;
  if (target.film) {
    if (!fs.existsSync(target.film)) throw new Error(`no film data at ${target.film}`);
    film = loadFilmFacts(target.film).facts;
  }
  let narration: Narration | null = null;
  if (target.words) {
    if (!fs.existsSync(target.words)) throw new Error(`no narration at ${target.words}`);
    narration = loadNarration(target.words);
  }
  req.onProgress?.(`measuring ${path.basename(target.mp4)} (${video.width}x${video.height}, ${video.durationSec.toFixed(1)} s)`);
  const render = await measureRender(target.mp4, video, { skipOcr: req.skipOcr, onProgress: req.onProgress });
  const loudness = video.hasAudio ? measureLoudness(target.mp4) : null;
  const silences = video.hasAudio ? detectSilences(target.mp4, video.durationSec) : [];
  const criteria = evaluateCriteria({ video, render, film, narration, loudness, silences });

  if (!req.noWrite) attachEvidenceFrames(target.mp4, criteria, target.outDir, video.durationSec);
  const scored = criteria.filter((c) => c.score !== null);
  const gateFailures = criteria.filter((c) => c.gate && c.status === "fail").map((c) => c.key);
  const report: ReviewReport = {
    schema: "aideos.review/1",
    subject: target.subject,
    createdAt: new Date().toISOString(),
    video,
    sources: { film: target.film, words: target.words, narrationTextOnly: Boolean(narration && !narration.timed) },
    criteria,
    gateFailures,
    softFailures: criteria.filter((c) => !c.gate && c.status === "fail").map((c) => c.key),
    passed: gateFailures.length === 0,
    meanScore: scored.length ? Math.round((scored.reduce((a, c) => a + (c.score ?? 0), 0) / scored.length) * 100) / 100 : null,
    recommendations: recommend(criteria),
    outDir: req.noWrite ? null : target.outDir,
  };
  if (!req.noWrite) {
    fs.mkdirSync(target.outDir, { recursive: true });
    fs.writeFileSync(path.join(target.outDir, "review.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

// Formats a report as plain text a person or an agent can act on.
export function formatReview(report: ReviewReport): string {
  const lines = [`${report.passed ? "PASS" : "FAIL"} ${report.subject}: ${report.video.width}x${report.video.height}, ${report.video.durationSec.toFixed(1)} s, mean score ${report.meanScore ?? "n/a"}/4`];
  for (const c of report.criteria) {
    const mark = c.status === "pass" ? "pass" : c.status === "fail" ? "FAIL" : "skip";
    lines.push(`  ${mark} ${String(c.id).padStart(2)} ${c.gate ? "[gate] " : "       "}${c.name}${c.score === null ? "" : ` (${c.score}/4)`}: ${c.summary}`);
    if (c.status === "fail") for (const e of c.evidence.slice(0, 3)) lines.push(`         at ${e.t.toFixed(1)} s${e.frame ? ` (${e.frame})` : ""}: ${e.note}`);
  }
  if (report.recommendations.length) {
    lines.push("Recommendations:");
    report.recommendations.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));
  }
  if (report.outDir) lines.push(`Report: ${path.join(report.outDir, "review.json")}`);
  return lines.join("\n");
}
