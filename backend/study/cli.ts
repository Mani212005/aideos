/**
 * File Description: Command-line interface for `aideos study <reference.mp4 ...>`: measures local reference videos as numbers only (two independent methods per
 * pixel-derived metric, an agreement flag, unresolved metrics excluded) and writes a style bible and a look seed proposal per reference. Local files only.
 * Inputs and outputs: CLI arguments -> a study folder (bible.json, bible.md, seed.json, seed.md per reference) and a printed summary; exit 2 when a study cannot run.
 * Used by: backend/cli.ts, bin/aideos.
 */

import type { Command } from "commander";
import { runStudy } from "./run";
import { IP_BOUNDARY, type Metric } from "./types";

// One summary line for a metric.
function metricLine(m: Metric): string {
  const readings = m.methods.map((r) => (r.value === null ? "n/a" : String(r.value))).join(" / ");
  return `  ${m.status.padEnd(13)} ${m.id.padEnd(34)} ${(m.value === null ? "excluded" : `${m.value} ${m.unit}`).padEnd(26)} [${readings}]`;
}

// Registers `study` on the program.
export function registerStudyCommands(program: Command): void {
  program
    .command("study")
    .description(`Measure local reference videos as numbers only and write a style bible plus a look seed proposal. ${IP_BOUNDARY}`)
    .argument("<references...>", "local reference video files (a URL is refused: aideos study never downloads or scrapes)")
    .option("--name <name>", "study name, used as the folder name (default study-<timestamp>)")
    .option("--out <dir>", "folder that holds the study folder (default .frames/study, which git ignores)")
    .option("--words <file>", "word timings (voiceover_words.json shape) for words per minute of a single reference; otherwise <name>.words.json next to the video is used when it exists")
    .option("--into <film>", "also write design/look.seed.json and design/STUDY_SEED.md into this film package (one reference); never writes look.json and never overwrites a seed")
    .option("--json", "print the bibles as JSON on stdout (progress goes to stderr)")
    .addHelpText("after", `\nBoundary: ${IP_BOUNDARY}\nA metric is agreed only when two independent methods read it within a stated tolerance; a disagreement is recorded as unresolved and excluded from the seed.\nDocs: docs/STUDY.md`)
    .action(async (references: string[], options: { name?: string; out?: string; words?: string; into?: string; json?: boolean }) => {
      try {
        const result = await runStudy({
          references,
          name: options.name,
          outRoot: options.out,
          wordsFile: options.words,
          into: options.into,
          cwd: process.env.AIDEOS_CALLER_CWD || process.cwd(),
          deps: { onProgress: (m) => console.error(`[study] ${m}`) },
        });
        if (options.json) {
          console.log(JSON.stringify(result.references.length === 1 ? result.references[0].bible : result.references.map((r) => r.bible), null, 2));
          return;
        }
        console.log(`Study written to ${result.studyDir}`);
        console.log(`PROPOSAL, numbers only. ${IP_BOUNDARY}`);
        for (const ref of result.references) {
          console.log(`\n${ref.bible.source.file} (${ref.bible.media.width}x${ref.bible.media.height}, ${ref.bible.media.durationSec} s)`);
          for (const m of ref.bible.metrics) console.log(metricLine(m));
          const unresolved = ref.bible.metrics.filter((m) => m.status === "unresolved");
          if (unresolved.length) console.log(`  ${unresolved.length} metric(s) unresolved and excluded from the seed: ${unresolved.map((m) => m.id).join(", ")}`);
          console.log(`  files: ${ref.dir}/{bible.json,bible.md,seed.json,seed.md}`);
        }
        if (result.seededInto) console.log(`\nSeed written to ${result.seededInto.join(" and ")} (design/look.json was not touched).`);
      } catch (err) {
        // A study that cannot run (a URL, a missing file, no ffmpeg) is a tool error, not a measurement: exit 2.
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
      }
    });
}
