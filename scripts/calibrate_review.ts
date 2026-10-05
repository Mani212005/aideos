/**
 * File Description: Local calibration of `aideos review` against the three reference videos.
 * Reads the paths from environment variables (the videos are the captain's and are never committed):
 * AIDEOS_CALIBRATION_A (the preferred explainer), AIDEOS_CALIBRATION_B (the rejected aideos
 * explainer) and AIDEOS_CALIBRATION_RAG (the RAG film), plus optional AIDEOS_CALIBRATION_A_WORDS,
 * AIDEOS_CALIBRATION_B_FILM and AIDEOS_CALIBRATION_B_WORDS. Prints the measured table and exits 1
 * unless the tool still reproduces A > B > RAG on stage persistence, A above both on captions, A
 * passing every gate it can be measured on, and B and RAG failing the gates the comparison turned on.
 * Re-run it after changing any threshold in backend/review/thresholds.ts.
 * Inputs and outputs: environment variable video paths -> prints calibration metrics and exit code.
 * Used by: npm run calibrate:review.
 */

import { reviewVideo } from "../backend/review/review";
import type { CriterionKey, ReviewReport } from "../backend/review/types";

interface Reference {
  name: "A" | "B" | "RAG";
  video: string | undefined;
  film?: string;
  words?: string;
}

const refs: Reference[] = [
  { name: "A", video: process.env.AIDEOS_CALIBRATION_A, words: process.env.AIDEOS_CALIBRATION_A_WORDS },
  { name: "B", video: process.env.AIDEOS_CALIBRATION_B, film: process.env.AIDEOS_CALIBRATION_B_FILM, words: process.env.AIDEOS_CALIBRATION_B_WORDS },
  { name: "RAG", video: process.env.AIDEOS_CALIBRATION_RAG },
];

// Reads one named metric of a criterion from a report.
function metric(r: ReviewReport, key: CriterionKey, name: string): number {
  const v = r.criteria.find((c) => c.key === key)?.metrics[name];
  return typeof v === "number" ? v : NaN;
}

// Runs the three reviews, prints the table and checks the required ordering.
async function main(): Promise<void> {
  const missing = refs.filter((r) => !r.video);
  if (missing.length) {
    console.error(`set ${missing.map((r) => `AIDEOS_CALIBRATION_${r.name}`).join(", ")} to the reference mp4 paths`);
    process.exit(2);
  }
  const reports = new Map<string, ReviewReport>();
  for (const ref of refs) {
    reports.set(ref.name, await reviewVideo({ target: ref.video!, film: ref.film, words: ref.words, noWrite: true }));
  }
  const rows = refs.map((ref) => {
    const r = reports.get(ref.name)!;
    return {
      video: ref.name,
      "layout corr": metric(r, "persistent-stage", "layoutCorrelationMedian"),
      "clears/30s": metric(r, "persistent-stage", "stageClearsPer30s"),
      "caption cover": metric(r, "captions", "coverage"),
      "small text": metric(r, "readability", "smallShare"),
      "hard cuts": metric(r, "pacing", "hardCuts"),
      gates: r.gateFailures.length ? `FAIL ${r.gateFailures.join(",")}` : "pass",
      mean: r.meanScore,
    };
  });
  console.table(rows);

  const [a, b, rag] = ["A", "B", "RAG"].map((n) => reports.get(n)!);
  const checks: Array<[string, boolean]> = [
    ["layout persistence A > B > RAG", metric(a, "persistent-stage", "layoutCorrelationMedian") > metric(b, "persistent-stage", "layoutCorrelationMedian") && metric(b, "persistent-stage", "layoutCorrelationMedian") > metric(rag, "persistent-stage", "layoutCorrelationMedian")],
    ["stage clears per 30 s A < B < RAG", metric(a, "persistent-stage", "stageClearsPer30s") < metric(b, "persistent-stage", "stageClearsPer30s") && metric(b, "persistent-stage", "stageClearsPer30s") < metric(rag, "persistent-stage", "stageClearsPer30s")],
    ["caption coverage A above B and RAG", metric(a, "captions", "coverage") > Math.max(metric(b, "captions", "coverage"), metric(rag, "captions", "coverage"))],
    ["A passes every measurable gate", a.passed],
    ["B fails the persistence and captions gates", b.gateFailures.includes("persistent-stage") && b.gateFailures.includes("captions")],
    ["RAG fails the persistence and captions gates", rag.gateFailures.includes("persistent-stage") && rag.gateFailures.includes("captions")],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
