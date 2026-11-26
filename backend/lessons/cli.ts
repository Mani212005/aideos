/**
 * File Description: CLI registration for `aideos verdict`, letting the owner record or inspect their watch verdict on a film package.
 * Inputs and outputs: CLI arguments (<slug> [publish|fix|reject] [--note ...] [--json]) -> reads or writes videos/<slug>/owner-verdict.json and prints the result.
 * Used by: backend/cli.ts, bin/aideos.
 */

import path from "node:path";
import type { Command } from "commander";
import { resolvePackageDir } from "../videoPackageLoader";
import { hashFileOrNull } from "../filmAcceptance/store";
import {
  formatOwnerVerdict,
  ownerVerdictPath,
  readOwnerVerdict,
  recordOwnerVerdict,
} from "./verdict";

// Collects repeatable --note flags into a list.
function collectNote(value: string, previous: string[]): string[] {
  return [...previous, value];
}

// Registers the `verdict` command on the root CLI program.
export function registerVerdictCommands(program: Command): void {
  program
    .command("verdict")
    .description(
      "Record or show the owner's watch verdict for a film (publish, fix, or reject) in videos/<slug>/owner-verdict.json; automated checks never mark a film owner-approved",
    )
    .argument("<slug>", "film package slug under videos/")
    .argument(
      "[decision]",
      "owner decision after watching: publish, fix (publish-after-fixes), or reject; omit to show the saved verdict",
    )
    .option("-n, --note <text>", "owner note to store with the verdict (repeatable)", collectNote, [])
    .option("--json", "print the verdict record as JSON")
    .action(
      (
        slug: string,
        decision: string | undefined,
        options: { note: string[]; json?: boolean },
      ) => {
        const pkgDir = resolvePackageDir(slug);
        const currentHash = hashFileOrNull(path.join(pkgDir, "film.json"));

        if (!decision) {
          const existing = readOwnerVerdict(pkgDir);
          if (options.json) {
            console.log(JSON.stringify(existing, null, 2));
            return;
          }
          if (!existing) {
            console.log(`No owner verdict recorded for ${slug} (${ownerVerdictPath(pkgDir)}).`);
            return;
          }
          console.log(formatOwnerVerdict(existing, currentHash));
          return;
        }

        const record = recordOwnerVerdict({
          slug,
          verdict: decision,
          notes: options.note,
          pkgDir,
        });
        if (options.json) {
          console.log(JSON.stringify(record, null, 2));
          return;
        }
        console.log(formatOwnerVerdict(record, currentHash));
        console.log(`Saved: ${ownerVerdictPath(pkgDir)}`);
      },
    );
}
