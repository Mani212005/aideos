/**
 * File Description: Command-line interface for `aideos audio fetch`, `verify`, and `import`.
 * Inputs and outputs: CLI arguments -> downloads, validates, or imports audio library assets.
 * Used by: backend/cli.ts, bin/aideos.
 */

import path from "node:path";
import type { Command } from "commander";
import {
  loadAudioLibrary,
  verifyAudioLibrary,
  fetchAudioLibrary,
  importManualAudioItem,
  type AudioLibraryVerifyReport,
  type AudioFetchItemResult,
} from "./library";

// Formats a byte count into a human-readable string.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Formats a duration in seconds into mm:ss format.
function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Formats an AudioLibraryVerifyReport into human-readable terminal output.
export function formatVerifyReport(report: AudioLibraryVerifyReport): string {
  const lines: string[] = [];
  lines.push(`Audio library verification: ${report.ok ? "PASS" : "FAIL"}`);
  lines.push(`Cache location: ${path.relative(process.cwd(), report.cacheDir) || report.cacheDir}`);
  lines.push("");

  for (const item of report.results) {
    const durStr = item.kind === "music" ? `, ${formatDuration(item.durationSec)}` : "";
    switch (item.status) {
      case "valid":
        lines.push(`  [ok]      ${item.id.padEnd(16)} (${item.filename}) - ${formatBytes(item.actualBytes ?? item.expectedBytes)}${durStr}`);
        break;
      case "missing":
        lines.push(`  [missing] ${item.id.padEnd(16)} (${item.filename}) - run "aideos audio fetch"`);
        break;
      case "mismatch":
        lines.push(`  [corrupt] ${item.id.padEnd(16)} (${item.filename}) - ${item.message}`);
        break;
      case "unavailable":
        lines.push(`  [manual]  ${item.id.padEnd(16)} (${item.filename}) - ${item.message}`);
        break;
    }
  }

  lines.push("");
  lines.push(
    `Summary: ${report.summary.total} total items (${report.summary.valid} valid, ${report.summary.missing} missing, ${report.summary.mismatch} mismatched, ${report.summary.unavailable} manual/unavailable)`
  );

  return lines.join("\n");
}

// Registers the audio command group on the Aideos CLI program.
export function registerAudioCommands(program: Command): void {
  const audio = program
    .command("audio")
    .description("Manage and verify the shared background music and sound effects library");

  audio
    .command("fetch")
    .description("Download audio library assets into the shared cache and verify SHA256 hashes")
    .option("--item <id>", "fetch a single item by id")
    .option("--force", "re-download and overwrite files even if already present in cache")
    .option("--json", "print fetch report as JSON")
    .action(
      async (options: {
        item?: string;
        force?: boolean;
        json?: boolean;
      }) => {
        const library = loadAudioLibrary();

        const report = await fetchAudioLibrary(library, {
          force: options.force,
          itemId: options.item,
          onProgress: (res: AudioFetchItemResult) => {
            if (!options.json) {
              if (res.status === "downloaded") {
                console.log(`  [downloaded] ${res.id.padEnd(16)} -> ${res.filename} (${formatBytes(res.bytes)})`);
              } else if (res.status === "skipped") {
                console.log(`  [cached]     ${res.id.padEnd(16)} -> ${res.filename} (${res.message})`);
              } else if (res.status === "manual") {
                console.log(`  [manual]     ${res.id.padEnd(16)} -> ${res.message}`);
              }
            }
          },
        });

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log("");
          console.log(
            `Fetch complete: ${report.summary.downloaded} downloaded, ${report.summary.skipped} already cached, ${report.summary.manual} manual/pending (${report.summary.total} total).`
          );
          console.log(`Cache: ${report.cacheDir}`);
        }

        if (!report.ok) {
          process.exitCode = 1;
        }
      }
    );

  audio
    .command("verify")
    .description("Verify cached audio assets against library SHA256 hash locks")
    .option("--json", "print verification report as JSON")
    .option("--item <id>", "verify a single item by id")
    .action((options: { json?: boolean; item?: string }) => {
      const library = loadAudioLibrary();
      const filteredLibrary = options.item
        ? {
            ...library,
            items: library.items.filter((i) => i.id === options.item),
          }
        : library;

      if (options.item && filteredLibrary.items.length === 0) {
        throw new Error(`Audio item "${options.item}" not found in library manifest`);
      }

      const report = verifyAudioLibrary(filteredLibrary);

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatVerifyReport(report));
      }

      if (!report.ok) {
        process.exitCode = 1;
      }
    });

  audio
    .command("import")
    .description("Import a manual audio file (e.g. YouTube Audio Library) into the shared cache")
    .argument("<id>", "Audio library item ID")
    .argument("<file>", "Local file path to the audio file")
    .action((id: string, file: string) => {
      const imported = importManualAudioItem(id, file);
      console.log(`Successfully imported ${imported.item.id} (${imported.item.title}) into cache.`);
      console.log(`Path: ${imported.cachePath}`);
      console.log(`SHA256: ${imported.sha256}`);
    });
}
