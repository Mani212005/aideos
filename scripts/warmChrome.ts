/**
 * File Description: Pays the system Chrome's first-launch cost on a fresh CI runner before any test launches Chrome.
 * On a new GitHub runner the first headless start of /usr/bin/google-chrome took a median 8 s and up to 34 s
 * (cold reads of its ~420 MB install), while every later start took under a second, so tests that bound a
 * launch (caption measurement, the character browser, the studio journeys) failed whenever they happened to
 * be first. This step reads the install once and makes one headless launch, and prints how long each took.
 * Inputs and outputs: the Chrome found by findChromeBinary -> its install folder read once plus one headless
 * launch; prints both timings; exit 0, or 1 when Chrome is missing or cannot start.
 * Used by: scripts/ci.ts (first step of the unit and journeys jobs).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findChromeBinary } from "../backend/scene/chromeBinary";

/** A launch that has not finished by then is reported as a failure rather than left to hang the job. */
const LAUNCH_LIMIT_MS = 120000;

/** Reads every regular file under `dir` once (discarding the bytes) and returns how many bytes were read. */
export function readTree(dir: string): number {
  let total = 0;
  const buffer = Buffer.alloc(1 << 20);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += readTree(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const fd = fs.openSync(full, "r");
    try {
      let n: number;
      while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) total += n;
    } finally {
      fs.closeSync(fd);
    }
  }
  return total;
}

/** Starts Chrome headless once on a blank page in a throwaway profile and resolves when it exits cleanly. */
function launchOnce(chrome: string): Promise<void> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-warm-chrome-"));
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        ...(process.env.CI === "true" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
        `--user-data-dir=${profile}`,
        "--dump-dom",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const limit = setTimeout(() => child.kill("SIGKILL"), LAUNCH_LIMIT_MS);
    child.once("error", (error) => {
      clearTimeout(limit);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(limit);
      fs.rmSync(profile, { recursive: true, force: true });
      if (code === 0) resolve();
      else reject(new Error(`Chrome exited with ${signal ?? code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Entry point: read the install, launch once, print the timings. */
async function main(): Promise<void> {
  const chrome = findChromeBinary();
  if (!chrome) throw new Error("no Chrome or Chromium found; install Chrome or set AIDEOS_CHROME_PATH");
  const installDir = path.dirname(fs.realpathSync(chrome));
  const readStart = Date.now();
  const bytes = readTree(installDir);
  const readMs = Date.now() - readStart;
  const launchStart = Date.now();
  await launchOnce(chrome);
  const launchMs = Date.now() - launchStart;
  console.log(
    `[warm-chrome] read ${(bytes / 1e6).toFixed(0)} MB of ${installDir} in ${(readMs / 1000).toFixed(1)}s; first headless launch took ${(launchMs / 1000).toFixed(1)}s`,
  );
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err: unknown) => {
    console.error(`[warm-chrome] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
