/**
 * File Description: Command-line interface for `aideos compare <ours.mp4> <reference.mp4>`: runs the study measurements on both local videos and writes a labelled side-by-side
 * contact sheet (REF left, OURS right), a metric diff (agreed deltas only, disagreements listed as unresolved), a plain-words summary and a JSON of the same. Local files only.
 * Inputs and outputs: CLI arguments -> an output folder and a printed summary; exit 2 when the comparison cannot run (a URL, a missing file, no ffmpeg).
 * Used by: backend/cli.ts, bin/aideos.
 */

import path from "node:path";
import type { Command } from "commander";
import { runCompare } from "./run";
import { COMPARE_BOUNDARY } from "./types";

// Registers `compare` on the program.
export function registerCompareCommands(program: Command): void {
  program
    .command("compare")
    .description(`Compare one of our videos with a local reference as numbers only: a labelled contact sheet (REF left, OURS right) and a metric diff of the study measurements. ${COMPARE_BOUNDARY}`)
    .argument("<ours>", "our video (a local file)")
    .argument("<reference>", "the reference video (a local file; a URL is refused: aideos compare never downloads or scrapes)")
    .option("--out <dir>", "the output folder (default compare-<ours>-vs-<reference> next to our video)")
    .option("--ours-words <file>", "word timings (voiceover_words.json shape) of our video for words per minute; otherwise <name>.words.json next to it is used when it exists")
    .option("--ref-words <file>", "word timings of the reference video, same shape")
    .option("--no-sheet", "skip the contact sheet and write only the diff, the summary and the JSON")
    .option("--send-to <film>", "also type the summary into the agent session that started this film (the route all-check uses for its feedback; no agent is started). When that route is not available the summary file path is printed instead")
    .option("--json", "print the report as JSON on stdout (progress goes to stderr)")
    .addHelpText("after", `\nBoundary: ${COMPARE_BOUNDARY}\nA delta is stated only when both videos have the metric agreed by two independent methods; a disagreement is listed as unresolved with both numbers and is not used.\nDocs: docs/COMPARE.md`)
    .action(async (ours: string, reference: string, options: { out?: string; oursWords?: string; refWords?: string; sheet?: boolean; sendTo?: string; json?: boolean }) => {
      try {
        const result = await runCompare({
          ours,
          ref: reference,
          out: options.out,
          oursWords: options.oursWords,
          refWords: options.refWords,
          noSheet: options.sheet === false,
          sendTo: options.sendTo,
          cwd: process.env.AIDEOS_CALLER_CWD || process.cwd(),
          deps: { onProgress: (m) => console.error(`[compare] ${m}`) },
        });
        if (result.delivery) console.error(`[compare] summary: ${result.delivery.delivered ? result.delivery.reason : `not sent (${result.delivery.reason}). Read ${path.join(result.dir, "summary.md")} instead`}`);
        if (options.json) {
          console.log(JSON.stringify(result.report, null, 2));
          return;
        }
        console.log(`Comparison written to ${result.dir}`);
        console.log(`PROPOSAL, numbers only. ${COMPARE_BOUNDARY}`);
        console.log("\nLargest agreed deltas (ours minus ref):");
        for (const b of result.report.summary) console.log(`  - ${b}`);
        if (result.report.files.sheet) console.log(`\ncontact sheet: ${path.join(result.dir, result.report.files.sheet)} (${result.report.sheet?.width}x${result.report.sheet?.height})`);
        console.log(`files: ${result.dir}/{diff.md,summary.md,compare.json}`);
      } catch (err) {
        // A comparison that cannot run (a URL, a missing file, no ffmpeg) is a tool error, not a measurement: exit 2.
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
      }
    });
}
