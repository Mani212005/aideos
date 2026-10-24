/**
 * File Description: Registers the independent reel brief and deterministic cut-check commands.
 * Inputs and outputs: Commander arguments -> generated brief path or report and process exit code.
 * Used by: backend/cli.ts and bin/aideos.
 */
import { Command } from "commander";
import { loadReelContext, readReelCut, writeReelBrief } from "./brief";
import { checkReelCut, formatReelReport } from "./check";
import {
  DEFAULT_REEL_BUDGET,
  REEL_MAX_SEC,
  parseReelBudget,
} from "./schema";

// Adds the pre-synthesis budget parameters until the production stage supplies its delivery budget.
function withBudget(command: Command): Command {
  return command
    .argument("<film>", "film package slug")
    .option(
      "--max-sec <seconds>",
      `lower the delivered reel cap (maximum ${REEL_MAX_SEC} seconds, including the end card)`,
      String(DEFAULT_REEL_BUDGET.maxSec),
    )
    .option(
      "--target-sec <seconds>",
      "delivered reel target including the end card",
      String(DEFAULT_REEL_BUDGET.targetSec),
    );
}

// Registers the reel authoring commands without starting render, synthesis or agent delivery.
export function registerReelCommands(program: Command): void {
  const reel = program
    .command("reel")
    .description(
      "Write or check a separate condensed reel narration cut for scene films only",
    );
  withBudget(
    reel
      .command("brief")
      .description(
        "Write a scene-film reel brief with locks, hashes and motion budgets",
      ),
  ).action(
    (
      film: string,
      options: { maxSec: string; targetSec: string },
    ) => {
      const budget = parseReelBudget({
        maxSec: Number(options.maxSec),
        targetSec: Number(options.targetSec),
        endCardSec: DEFAULT_REEL_BUDGET.endCardSec,
      });
      console.log(writeReelBrief(film, budget));
    },
  );
  withBudget(
    reel
      .command("check")
      .description(
        "Check a scene-film reel cut without changing source data",
      ),
  )
    .option("--json", "print a structured report")
    .action(
      (
        film: string,
        options: {
          maxSec: string;
          targetSec: string;
          json?: boolean;
        },
      ) => {
        try {
          const budget = parseReelBudget({
            maxSec: Number(options.maxSec),
            targetSec: Number(options.targetSec),
            endCardSec: DEFAULT_REEL_BUDGET.endCardSec,
          });
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
}
