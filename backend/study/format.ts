/**
 * File Description: Markdown rendering of a study bible and its seed for `aideos study`: the header repeats the proposal and craft-only boundary,
 * then a metric table (status, value, both methods' readings, tolerance), what was not measured, and the seed. Numbers and method names only.
 * Inputs and outputs: a StudyBible and a LookSeed -> markdown text.
 * Used by: backend/study/run.ts, backend/cli.ts.
 */

import type { LookSeed } from "./seed";
import type { Metric, StudyBible } from "./types";

// Escapes the pipe character so a method name cannot break a markdown table cell.
function cell(text: string): string {
  return text.replace(/\|/g, "/").replace(/\n/g, " ");
}

// One table row for a metric.
function row(m: Metric): string {
  const readings = m.methods.map((r) => `${r.value === null ? "n/a" : r.value}`).join(" / ");
  const value = m.value === null ? "excluded" : `${m.value} ${m.unit}`;
  return `| ${m.id} | ${m.status} | ${value} | ${readings} | ${cell(m.tolerance ?? "-")} |`;
}

// Renders the short markdown bible of one reference.
export function formatBible(bible: StudyBible): string {
  const lines: string[] = [
    `# Study: ${bible.source.file}`,
    "",
    "> PROPOSAL, numbers only. This is a measurement, not a plan, a verdict or advice.",
    `> ${bible.boundary}`,
    "",
    `${bible.media.width}x${bible.media.height} (${bible.media.aspect}), ${bible.media.durationSec} s, ${bible.media.fps} fps, ${bible.media.hasAudio ? "with audio" : "no audio"}. Generated ${bible.generatedAt}.`,
    "",
    "A metric is `agreed` only when two independent methods read it within the stated tolerance. `unresolved` means they disagreed or one could not run: both readings are kept and the metric is excluded from the seed. `single-method` and `not-pixel` metrics are named with their one method.",
    "",
    "| Metric | Status | Value | Readings (method A / method B) | Tolerance |",
    "|---|---|---|---|---|",
    ...bible.metrics.map(row),
    "",
    "## Methods",
    "",
    ...bible.metrics.flatMap((m) => [`- ${m.id}: ${m.methods.map((r, i) => `${m.methods.length > 1 ? (i === 0 ? "A" : "B") + ": " : ""}${r.method}${r.note ? ` (${r.note})` : ""}`).join("; ")}${m.reason ? `. ${m.reason}` : ""}`]),
    "",
    "## Not measured",
    "",
    ...bible.notMeasured.map((n) => `- ${n.what}: ${n.why}`),
    "",
  ];
  return lines.join("\n");
}

// Renders the short markdown seed: the brief paragraph, the partial look and the exclusions.
export function formatSeed(seed: LookSeed): string {
  return [
    `# Look seed (proposal) from ${seed.source}`,
    "",
    `> ${seed.boundary}`,
    "> A proposal made only of metrics two methods agreed on. It never replaces design/look.json and is not a valid look plan.",
    "",
    "## Look brief paragraph",
    "",
    seed.brief,
    "",
    "## Partial look",
    "",
    "```json",
    JSON.stringify(seed.partialLook, null, 2),
    "```",
    "",
    "## Excluded from the seed",
    "",
    ...(seed.excluded.length ? seed.excluded.map((e) => `- ${e.metric} (${e.status}): ${e.reason}`) : ["- none"]),
    "",
  ].join("\n");
}
