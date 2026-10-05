/**
 * File Description: Registers the `aideos all-check` commands on the backend CLI: `all-check <slug>`
 * launches the background agent, and `all-check round|frames|finish|status|wait|rollback <slug>` are
 * the commands that agent (and the calling agent) run. Also rewrites `all-check <sub> ...` into the
 * hyphenated command names so both spellings work. Exit codes: 0 good, 1 not all good, 2 could not
 * run (bad input, preflight, a tool failed), 3 wait timed out, 4 the agent stopped without a result.
 * Inputs and outputs: CLI arguments -> executes allCheck pipeline.
 * Used by: backend/cli.ts, bin/aideos.
 */

import path from "node:path";
import type { Command } from "commander";
import {
  AllCheckError,
  finishRun,
  parseAllCheckOptions,
  realRoundDeps,
  recordFrameCheck,
  rollbackFilm,
  readRecords,
  readConfig,
  realIdleWatchdog,
  runRound,
  settleRound,
  strayFiles,
  runStatus,
  startAllCheck,
  waitForResult,
  type AllCheckResult,
  type CheckFormat,
  type FormatRoundRecord,
} from "./index";

const REPO_ROOT = path.resolve(__dirname, "../..");
/** Minutes of agent silence, with no round running, after which `wait` closes the run itself. */
const DEFAULT_IDLE_MIN = 10;

export const ALL_CHECK_SUBCOMMANDS = ["round", "frames", "finish", "status", "wait", "rollback"] as const;

// Rewrites `all-check round ...` into `all-check-round ...` so the group reads naturally.
export function rewriteAllCheckArgv(argv: string[]): string[] {
  const i = argv.indexOf("all-check", 2);
  if (i === 2 && (ALL_CHECK_SUBCOMMANDS as readonly string[]).includes(argv[i + 1])) {
    return [...argv.slice(0, i), `all-check-${argv[i + 1]}`, ...argv.slice(i + 2)];
  }
  return argv;
}

// Prints an error as one clear message and sets the exit code.
function fail(err: unknown, code = 2): void {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = err instanceof AllCheckError ? 2 : code;
}

// Formats one record as the lines the agent reads after a round.
function describeRecord(rec: FormatRoundRecord): string {
  const lines = [
    `[${rec.format}] round ${rec.round}: reviewer ${rec.review.error ? "ERROR" : `${rec.review.score?.toFixed(1)} ${rec.review.verdict}`}, measured ${rec.measured.error ? "ERROR" : rec.measured.passed ? "pass" : "FAIL"}${rec.pairwise ? `, cross-review ${rec.pairwise.error ? "ERROR" : rec.pairwise.winner}` : ""}, frame check ${rec.frameCheck.status} -> ${rec.passed ? "PASSED" : "not passed"}`,
  ];
  for (const f of rec.failing) lines.push(`    - ${f}`);
  lines.push(`    details: ${rec.videoPath.replace(/\.mp4$/, ".md")}`, `    stills:  ${rec.frameCheck.stillsDir} (${rec.frameCheck.stills.length} frames)`);
  return lines.join("\n");
}

// Formats the final result as the summary the calling agent reports.
export function describeResult(result: AllCheckResult): string {
  const part = (name: string, s: AllCheckResult["long"]) => (s ? `${name} ${s.score?.toFixed(1) ?? "n/a"}/10 (round ${s.round}, ${s.passed ? "passed" : "not passed"}) ${s.finalPath ?? ""}` : `${name} never measured`);
  const lines = [
    `all-check ${result.status === "passed" ? "ALL GOOD" : "NOT ALL GOOD"}: ${result.slug} (target ${result.target.toFixed(1)}, ${result.roundsUsed} of ${result.roundBudget} rounds used)`,
    `  ${part("long", result.long)}`,
    `  ${part("reel", result.reel)}`,
  ];
  for (const f of result.stillFailing) lines.push(`  still failing: ${f}`);
  if (result.restoredFilmFromRound !== null) lines.push(`  film.json restored to the best round (${result.restoredFilmFromRound}); the final videos are that round's renders`);
  if (result.strayFiles.length) lines.push(`  rule violation: files created outside videos/${result.slug}/: ${result.strayFiles.join(", ")}`);
  lines.push(`  report: ${result.reportPath}`);
  return lines.join("\n");
}

// Registers every all-check command.
export function registerAllCheckCommands(program: Command): void {
  program
    .command("all-check")
    .description("Run the whole video check (render long and reel, measured review, Gemini review, fix, repeat) in a background agent in its own tmux window")
    .argument("<slug>", "film slug under videos/")
    .option("--reference <mp4>", "reference video the long cut must win or tie against in the cross-review")
    .option("--rounds <n>", "round budget (default 6)")
    .option("--target <score>", "reviewer score both formats must reach (default 9.0)")
    .option("--agent <name>", "background agent: claude or agy (default: videoModels.generation.agent in aideos.config.json)")
    .option("--model <id>", "generation model for this run (default: videoModels.generation.model in aideos.config.json)")
    .option("--allow-forbidden-model", "allow a generation model the config forbids (gemini-3.1-pro) for this run")
    .option("--wait", "stay and wait for the result, then print it")
    .action(async (slug: string, flags: { reference?: string; rounds?: string; target?: string; agent?: string; model?: string; allowForbiddenModel?: boolean; wait?: boolean }) => {
      try {
        const options = parseAllCheckOptions(slug, flags);
        const started = startAllCheck(options);
        console.log(`all-check started for "${slug}" with the ${started.agent.agent} agent on ${started.agent.model}${started.agent.note ? ` (${started.agent.note})` : ""}.`);
        console.log(`  window:  ${started.window.windowId} in tmux session "${started.window.session}" (watch or step in: ${started.window.attachCommand})`);
        console.log(`  brief:   ${started.briefPath}`);
        console.log(`  result:  ${started.resultPath}`);
        console.log(`  wait:    aideos all-check wait ${slug}`);
        if (started.tookOverStaleLock) console.log("  (an earlier run's window was gone, so its lock was replaced)");
        if (flags.wait) await runWait(slug, 240, 20);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("all-check-round")
    .description("(all-check agent) Render and measure one round: measured review, Gemini review, cross-review, stills")
    .argument("<slug>")
    .option("--format <format>", "long, reel or both", "long")
    .option("--round <n>", "round number (default: a new round)")
    .option("--still-every <sec>", "seconds between frame-check stills", "4")
    .option("--skip-render", "measure the video already rendered instead of rendering again")
    .option("--json", "print the records as JSON")
    .action(async (slug: string, o: { format: string; round?: string; stillEvery: string; skipRender?: boolean; json?: boolean }) => {
      try {
        if (!["long", "reel", "both"].includes(o.format)) throw new AllCheckError(`--format must be long, reel or both (got "${o.format}")`);
        const deps = realRoundDeps((m) => console.error(m));
        const records = await runRound(
          { slug, format: o.format as CheckFormat | "both", round: o.round ? Number(o.round) : undefined, stillEverySec: Number(o.stillEvery), skipRender: o.skipRender },
          deps,
        );
        const round = records[0].round;
        const note = settleRound(slug, round, readRecords(slug));
        const config = readConfig(slug);
        const strays = strayFiles(slug, REPO_ROOT);
        if (o.json) {
          console.log(JSON.stringify({ records, rollback: note, strayFiles: strays }, null, 2));
        } else {
          console.log(records.map(describeRecord).join("\n"));
          if (note) console.log(`\n${note.message}`);
          if (strays.length) console.log(`\nRULE VIOLATION: these files were created outside videos/${slug}/ (delete them, and put scratch files in videos/${slug}/all-check/scratch/): ${strays.join(", ")}`);
          console.log(`\nNext: open the stills, record the frame check (aideos all-check frames ${slug} --round ${round} --format <format> --clean | --issue "..."), then read the failures above.`);
          if (round >= config.rounds) console.log(`THIS WAS THE LAST ROUND OF THE BUDGET (${config.rounds}). Record the frame check, then run: aideos all-check finish ${slug}. The run is only over when finish has written result.json: do not stop at a summary.`);
        }
        if (records.some((r) => r.review.error || r.measured.error || r.pairwise?.error)) process.exitCode = 2;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("all-check-frames")
    .description("(all-check agent) Record your frame check of a round: clean, or the issues you saw in the stills")
    .argument("<slug>")
    .requiredOption("--round <n>", "round number")
    .requiredOption("--format <format>", "long or reel")
    .option("--clean", "the stills show no clipping, overlap or off-frame content")
    .option("--issue <text>", "one problem found, with its time (repeatable)", (v: string, acc: string[] = []) => [...acc, v])
    .action((slug: string, o: { round: string; format: string; clean?: boolean; issue?: string[] }) => {
      try {
        if (!["long", "reel"].includes(o.format)) throw new AllCheckError(`--format must be long or reel (got "${o.format}")`);
        if (!o.clean && !(o.issue && o.issue.length)) throw new AllCheckError("say what you saw: --clean, or one or more --issue \"<time>: <problem>\"");
        if (o.clean && o.issue?.length) throw new AllCheckError("--clean and --issue contradict each other");
        console.log(describeRecord(recordFrameCheck({ slug, round: Number(o.round), format: o.format as CheckFormat, issues: o.issue ?? [] })));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("all-check-finish")
    .description("(all-check agent) Close the run: verdict, final videos, report.md, result.json, notification")
    .argument("<slug>")
    .action((slug: string) => {
      try {
        const result = finishRun(slug);
        console.log(describeResult(result));
        if (result.status !== "passed") process.exitCode = 1;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("all-check-status")
    .description("Show the state of an all-check run and the rounds measured so far")
    .argument("<slug>")
    .action((slug: string) => {
      try {
        const s = runStatus(slug);
        console.log(`${s.state}: ${s.detail}`);
        for (const line of s.lines) console.log(`  ${line}`);
        if (s.result) console.log(describeResult(s.result));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("all-check-wait")
    .description("Wait for an all-check run to finish, then print its scores and final video paths")
    .argument("<slug>")
    .option("--timeout-min <n>", "give up waiting after this many minutes", "240")
    .option("--poll-sec <n>", "seconds between checks", "20")
    .option("--idle-min <n>", "close the run from the measured records when the agent has been silent this many minutes without finishing", String(DEFAULT_IDLE_MIN))
    .action(async (slug: string, o: { timeoutMin: string; pollSec: string; idleMin: string }) => {
      try {
        await runWait(slug, Number(o.timeoutMin), Number(o.pollSec), Number(o.idleMin));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("all-check-rollback")
    .description("(all-check agent) Restore film.json from the backup taken at the start of a round")
    .argument("<slug>")
    .requiredOption("--round <n>", "round whose starting film to restore")
    .action((slug: string, o: { round: string }) => {
      try {
        console.log(`restored film.json from ${rollbackFilm(slug, Number(o.round))}`);
      } catch (err) {
        fail(err);
      }
    });
}

// Waits for a run and prints how it ended, setting the exit code.
async function runWait(slug: string, timeoutMin: number, pollSec: number, idleMin = DEFAULT_IDLE_MIN): Promise<void> {
  const out = await waitForResult(slug, {
    timeoutMs: timeoutMin * 60_000,
    pollMs: pollSec * 1000,
    idle: realIdleWatchdog(idleMin * 60_000),
    onProgress: (line) => console.log(line),
  });
  if (out.outcome === "result" && out.result) {
    console.log(describeResult(out.result));
    process.exitCode = out.result.status === "passed" ? 0 : 1;
  } else if (out.outcome === "timeout") {
    console.log(`still running after ${timeoutMin} minutes: ${out.status.detail}`);
    process.exitCode = 3;
  } else if (out.outcome === "stopped") {
    console.log(`the agent stopped without a result: ${out.status.detail}`);
    process.exitCode = 4;
  } else {
    console.log(`no all-check run for "${slug}". Start one with: aideos all-check ${slug}`);
    process.exitCode = 2;
  }
}
