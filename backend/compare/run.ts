/**
 * File Description: The `aideos compare` run: validates the two local videos (a URL is refused, nothing is downloaded), runs the study measurements on both, builds the
 * metric diff, draws the labelled contact sheet and writes the output folder (contact-sheet.png, diff.md, summary.md, compare.json and the two bibles). Optionally hands the
 * summary to the agent session that started a film, through the same route all-check uses for its feedback (a prompt in that session's pane; no agent is started).
 * Inputs and outputs: two video paths and options -> files in the output folder, a CompareReport and, with a film to notify, the delivery outcome.
 * Used by: backend/compare/cli.ts, backend/compare/compare.test.ts.
 */

import { callerWorkingDirectory } from "../paths";

import fs from "node:fs";
import path from "node:path";
import { deliverMessageToOrigin, type FeedbackDeps, type FeedbackOutcome } from "../allCheck/feedback";
import { slugify, sidecarWords } from "../study/run";
import { isRemoteReference, studyReference, type StudyDeps } from "../study/study";
import type { StudyBible } from "../study/types";
import { renderContactSheet } from "./board";
import { buildFacts, buildRows } from "./diff";
import { buildSummary, formatDiff, formatSummary } from "./summary";
import { COMPARE_BOUNDARY, COMPARE_SCHEMA, type CompareReport } from "./types";

/** Options of a compare run. */
export interface CompareRunOptions {
  /** Our video (a local file). */
  ours: string;
  /** The reference video (a local file). */
  ref: string;
  /** The output folder itself; defaults to compare-<ours>-vs-<ref> next to our video. */
  out?: string;
  /** Word timings for the wpm of each side; otherwise <name>.words.json next to the video is used when it exists. */
  oursWords?: string;
  refWords?: string;
  /** Film slug whose originating agent session receives the summary. */
  sendTo?: string;
  /** Skip the contact sheet (the diff is still written). */
  noSheet?: boolean;
  /** Base directory that relative paths resolve against (the caller's cwd). */
  cwd?: string;
  deps?: StudyDeps;
  feedbackDeps?: FeedbackDeps;
}

/** What a run produced. */
export interface CompareRunResult {
  dir: string;
  report: CompareReport;
  bibles: { ours: StudyBible; ref: StudyBible };
  /** Set when a film was named to receive the summary. */
  delivery?: FeedbackOutcome;
}

// Checks one input: a URL is refused and a missing file is an error; returns the absolute path.
function resolveInput(label: string, input: string, cwd: string): string {
  if (isRemoteReference(input)) {
    throw new Error(`${label} "${input}" is a URL. aideos compare reads local files only: it never downloads or scrapes anything. Save the video yourself where you are allowed to, then pass its path.`);
  }
  const file = path.resolve(cwd, input);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`no video file at ${file}`);
  return file;
}

// Writes JSON with two-space indentation and a trailing newline.
function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

// The short message handed to the originating session: the summary bullets and where the files are. It states numbers only and asks for nothing.
export function formatSendMessage(slug: string, report: CompareReport, dir: string): string {
  return [
    `aideos compare for "${slug}" (OURS) against a reference (REF): numbers only, craft measurements only, no verdict and no pass or fail.`,
    ...report.summary.map((b) => `  - ${b}`),
    `  details: ${path.join(dir, report.files.summary)} and ${path.join(dir, report.files.report)}`,
  ].join("\n");
}

// Runs the comparison and writes the output folder.
export async function runCompare(options: CompareRunOptions): Promise<CompareRunResult> {
  const cwd = options.cwd ?? callerWorkingDirectory();
  const say = options.deps?.onProgress ?? (() => undefined);
  const oursFile = resolveInput("ours", options.ours, cwd);
  const refFile = resolveInput("reference", options.ref, cwd);
  const dir = path.resolve(cwd, options.out ?? path.join(path.dirname(oursFile), `compare-${slugify(path.basename(oursFile))}-vs-${slugify(path.basename(refFile))}`));
  const words = (explicit: string | undefined, file: string) => (explicit ? path.resolve(cwd, explicit) : sidecarWords(file));

  say("studying the reference (REF)");
  const ref = await studyReference(refFile, { wordsFile: words(options.refWords, refFile), deps: options.deps });
  say("studying ours (OURS)");
  const ours = await studyReference(oursFile, { wordsFile: words(options.oursWords, oursFile), deps: options.deps });

  fs.mkdirSync(path.join(dir, "bibles"), { recursive: true });
  const rows = buildRows(ours, ref);
  const facts = buildFacts(ours, ref);
  let sheet: CompareReport["sheet"] = null;
  if (!options.noSheet) {
    say("drawing the contact sheet");
    sheet = renderContactSheet({ ours: { file: oursFile, bible: ours }, ref: { file: refFile, bible: ref }, outFile: path.join(dir, "contact-sheet.png") });
  }
  const side = (b: StudyBible) => ({ file: b.source.file, durationSec: b.media.durationSec, width: b.media.width, height: b.media.height, aspect: b.media.aspect, fps: b.media.fps });
  const report: CompareReport = {
    schema: COMPARE_SCHEMA,
    proposal: true,
    boundary: COMPARE_BOUNDARY,
    generatedAt: new Date().toISOString(),
    ours: side(ours),
    ref: side(ref),
    facts,
    rows,
    summary: buildSummary(rows, facts),
    unresolved: rows.filter((r) => r.status === "unresolved").map((r) => ({ id: r.id, reason: r.reason ?? "" })),
    notMeasured: rows.filter((r) => r.status === "not-measured").map((r) => ({ id: r.id, reason: r.reason ?? "" })),
    sheet,
    files: { sheet: sheet ? sheet.file : null, diff: "diff.md", summary: "summary.md", report: "compare.json" },
  };
  fs.writeFileSync(path.join(dir, report.files.diff), formatDiff(report));
  fs.writeFileSync(path.join(dir, report.files.summary), formatSummary(report));
  writeJson(path.join(dir, report.files.report), report);
  writeJson(path.join(dir, "bibles", "ours.json"), ours);
  writeJson(path.join(dir, "bibles", "ref.json"), ref);

  const result: CompareRunResult = { dir, report, bibles: { ours, ref } };
  if (options.sendTo) result.delivery = deliverMessageToOrigin(options.sendTo, formatSendMessage(options.sendTo, report, dir), options.feedbackDeps, "comparison");
  return result;
}
