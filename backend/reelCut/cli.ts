/**
 * File Description: Registers the reel brief, cut check and delivery build commands.
 * Inputs and outputs: Commander arguments -> generated brief path or report and process exit code.
 * Used by: backend/cli.ts and bin/aideos.
 */
import { Command } from "commander";
import { loadReelContext, readReelCut, writeReelBrief } from "./brief";
import { checkReelCut, formatReelReport } from "./check";
import { readFilm } from "../pipeline/filmStore";
import { reelBudgetFor } from "./store";
import { deliverReel } from "./writer";
import {
  REEL_MAX_SEC,
  parseReelBudget,
} from "./schema";

// Adds optional stricter pre-synthesis budgets to the shared delivery settings.
function withBudget(command: Command): Command {
  return command
    .argument("<film>", "film package slug")
    .option(
      "--max-sec <seconds>",
      `lower the delivered reel cap (maximum ${REEL_MAX_SEC} seconds, including the end card)`,
    )
    .option(
      "--target-sec <seconds>",
      "delivered reel target including the end card",
    );
}

// Applies optional stricter CLI budgets to the configured delivery cap and this film's card span.
function commandBudget(slug: string, options: { maxSec?: string; targetSec?: string }) {
  const film = readFilm(slug);
  if (!film) throw new Error(`no film for ${slug}`);
  const budget = reelBudgetFor(film);
  return parseReelBudget({ ...budget, maxSec: options.maxSec === undefined ? budget.maxSec : Number(options.maxSec),
    targetSec: options.targetSec === undefined ? budget.targetSec : Number(options.targetSec) });
}

// Registers reel authoring and build commands on the production CLI.
export function registerReelCommands(program: Command): void {
  const reel = program
    .command("reel")
    .description(
      "Write, check or build a separate condensed reel narration cut",
    );
  withBudget(
    reel
      .command("brief")
      .description(
        "Write a reel brief with locks, hashes and motion budgets",
      ),
  ).action(
    (
      film: string,
      options: { maxSec?: string; targetSec?: string },
    ) => {
      const budget = commandBudget(film, options);
      console.log(writeReelBrief(film, budget));
    },
  );
  withBudget(
    reel
      .command("check")
      .description(
        "Check a reel cut without changing source data",
      ),
  )
    .option("--json", "print a structured report")
    .action(
      (
        film: string,
        options: {
          maxSec?: string;
          targetSec?: string;
          json?: boolean;
        },
      ) => {
        try {
          const budget = commandBudget(film, options);
          const context = loadReelContext(film);
          const report = checkReelCut(readReelCut(film), context, budget);
          console.log(
            options.json
              ? JSON.stringify(report, null, 2)
              : formatReelReport(report),
          );
          if (!report.ok) process.exitCode = 1;
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 2;
        }
      },
    );
  reel.command("build").argument("<film>", "film package slug")
    .option("--delivery <mode>", "inline, agent or server", "inline")
    .action(async (film: string, options: { delivery: string }) => {
      const mode = options.delivery;
      if (mode !== "inline" && mode !== "agent" && mode !== "server") throw new Error("--delivery must be inline, agent or server");
      const outcome = await deliverReel(film, { mode, onProgress: (message) => console.error(message) });
      if (outcome.status === "needs_reel_cut") {
        console.log(`${outcome.status}: ${outcome.note}\n${outcome.nextSteps.join("\n")}`);
        process.exitCode = 3;
      } else console.log(`PASS ${film}: reel film built`);
    });
}
