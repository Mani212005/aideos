/**
 * File Description: Plain-words output of `aideos compare`: the summary bullets (short sentences in Simplified Technical English, numbers only, no verdict and no advice)
 * of the largest agreed deltas, the markdown diff table with its method names and the markdown summary file. Unresolved and not-measured metrics are listed apart
 * and never enter a bullet.
 * Inputs and outputs: CompareRow[] and TextFact[] -> summary bullets, unresolved and not-measured lists, diff.md and summary.md text.
 * Used by: backend/compare/run.ts.
 */

import { COMPARE, COMPARE_BOUNDARY, type CompareReport, type CompareRow, type TextFact } from "./types";

// Rounds a number to three significant figures for a sentence.
export function fmt(value: number): string {
  return String(Number(value.toPrecision(3)));
}

// One reading with its unit, for example "0.43 share".
function withUnit(value: number, unit: string): string {
  return unit ? `${fmt(value)} ${unit}` : fmt(value);
}

// The sentence for one agreed row that differs: both numbers and the size and direction of the delta.
export function bulletFor(row: CompareRow): string {
  const o = (row.ours?.value ?? 0) as number;
  const r = (row.ref?.value ?? 0) as number;
  const delta = row.delta ?? 0;
  const direction = delta > 0 ? "higher" : "lower";
  const size = r === 0 ? "" : ` (${Math.round((Math.abs(delta) / Math.abs(r)) * 100)}% of the reference)`;
  return `${row.label}: ours is ${withUnit(o, row.unit)}, the reference is ${withUnit(r, row.unit)}. Ours is ${withUnit(Math.abs(delta), row.unit)} ${direction}${size}.`;
}

// The agreed rows that differ by more than the study tolerance, largest relative delta first (ties by metric id).
export function largestDeltas(rows: CompareRow[]): CompareRow[] {
  return rows
    .filter((row) => row.status === "agreed" && row.differs === true)
    .sort((a, b) => (b.relativeDelta ?? 0) - (a.relativeDelta ?? 0) || a.id.localeCompare(b.id));
}

// Builds the summary bullets: the largest agreed deltas, an aspect note when the aspects differ, and one line on what was not used.
export function buildSummary(rows: CompareRow[], facts: TextFact[]): string[] {
  const top = largestDeltas(rows);
  const bullets: string[] = [];
  for (const fact of facts) {
    if (!fact.same) bullets.push(`${fact.label}: ours is ${fact.ours}, the reference is ${fact.ref}. The two frames have different shapes.`);
  }
  if (top.length === 0) bullets.push("No agreed metric differs by more than the study tolerance.");
  for (const row of top.slice(0, COMPARE.summaryTopCount)) bullets.push(bulletFor(row));
  if (top.length > COMPARE.summaryTopCount) bullets.push(`${top.length - COMPARE.summaryTopCount} more agreed ${top.length - COMPARE.summaryTopCount === 1 ? "metric differs" : "metrics differ"}. See diff.md.`);
  const unresolved = rows.filter((r) => r.status === "unresolved").map((r) => r.id);
  if (unresolved.length) bullets.push(`Not used: ${unresolved.length} ${unresolved.length === 1 ? "metric is" : "metrics are"} unresolved (${unresolved.join(", ")}). Two methods did not agree, so no delta is stated.`);
  return bullets;
}

// A table cell text: pipes and line breaks cannot break the table.
function cell(text: string): string {
  return text.replace(/\|/g, "/").replace(/\n/g, " ");
}

// The readings of one side, for the table: the agreed value, or both method numbers when it is not agreed.
function sideCell(side: CompareRow["ref"], unit: string): string {
  if (!side) return "n/a";
  if (side.value !== null && (side.status === "agreed" || side.status === "not-pixel")) return withUnit(side.value, unit);
  return `excluded [${side.readings.map((r) => (r.value === null ? "n/a" : fmt(r.value))).join(" / ")}]`;
}

// Renders the markdown diff table with a methods list under it.
export function formatDiff(report: Pick<CompareReport, "ours" | "ref" | "facts" | "rows" | "generatedAt">): string {
  const lines = [
    "# Metric diff: REF vs OURS",
    "",
    "> PROPOSAL, numbers only. This is a measurement, not a plan, a verdict or advice.",
    `> ${COMPARE_BOUNDARY}`,
    "",
    `REF: ${report.ref.file} (${report.ref.width}x${report.ref.height}, ${report.ref.aspect}, ${report.ref.durationSec} s). OURS: ${report.ours.file} (${report.ours.width}x${report.ours.height}, ${report.ours.aspect}, ${report.ours.durationSec} s). Generated ${report.generatedAt}.`,
    "",
    "A delta (ours minus ref) is stated only when both videos have the metric `agreed` by two independent methods (or read by one named non-pixel method). When a side is `unresolved`, both readings are kept in brackets, no delta is stated and the metric is not used. `differs` is yes when the delta is larger than the study tolerance for that metric.",
    "",
    "| Metric | REF | OURS | Delta (ours - ref) | Differs | Status |",
    "|---|---|---|---|---|---|",
    ...report.facts.map((f) => `| ${f.id} | ${cell(f.ref)} | ${cell(f.ours)} | ${f.same ? "same" : "different"} | ${f.same ? "no" : "yes"} | text |`),
    ...report.rows.map((r) => `| ${r.id} | ${cell(sideCell(r.ref, r.unit))} | ${cell(sideCell(r.ours, r.unit))} | ${r.delta === null ? "-" : `${r.delta > 0 ? "+" : ""}${fmt(r.delta)} ${r.unit}`.trim()} | ${r.differs === null ? "-" : r.differs ? "yes" : "no"} | ${r.status} |`),
    "",
    "## Methods",
    "",
    ...report.rows.flatMap((r) => {
      const source = r.ours ?? r.ref;
      if (!source) return [];
      const methods = source.readings.map((m, i) => `${source.readings.length > 1 ? (i === 0 ? "A" : "B") + ": " : ""}${m.method}`).join("; ");
      return [`- ${r.id}: ${methods}. Same within ${r.sameWithin}.${r.reason ? ` ${r.reason}.` : ""}`];
    }),
    "",
  ];
  return lines.join("\n");
}

// Renders the short markdown summary for a person or an agent: the bullets, what was not used and where the details are.
export function formatSummary(report: Pick<CompareReport, "ours" | "ref" | "summary" | "unresolved" | "notMeasured" | "files">): string {
  return [
    "# Compare summary: REF vs OURS",
    "",
    "> PROPOSAL, numbers only. This is a measurement, not a plan, a verdict or advice.",
    `> ${COMPARE_BOUNDARY}`,
    "",
    `REF: ${report.ref.file}. OURS: ${report.ours.file}. A delta is ours minus ref.`,
    "",
    "## Largest agreed deltas",
    "",
    ...report.summary.map((b) => `- ${b}`),
    "",
    "## Not used",
    "",
    ...(report.unresolved.length || report.notMeasured.length
      ? [...report.unresolved.map((u) => `- ${u.id} (unresolved): ${u.reason}`), ...report.notMeasured.map((n) => `- ${n.id} (not measured): ${n.reason}`)]
      : ["- none"]),
    "",
    "## Files",
    "",
    `- ${report.files.diff}: the metric diff table with method names`,
    `- ${report.files.report}: the same data as JSON`,
    ...(report.files.sheet ? [`- ${report.files.sheet}: the labelled contact sheet, REF on the left and OURS on the right`] : []),
    "",
  ].join("\n");
}
