/**
 * File Description: Locates the installed Chrome or Chromium binary every headless-Chrome caller launches. Kept free of
 * React and rendering imports so cheap callers (the CI step list) can ask whether Chrome exists.
 * Inputs and outputs: AIDEOS_CHROME_PATH and the well-known install paths -> the binary path, or null when none is present.
 * Used by: backend/scene/renderStill.ts (re-exported as findChromeBinary), scripts/ci.ts, scripts/warmChrome.ts.
 */

import fs from "node:fs";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Locates an installed Chrome or Chromium binary, or returns null when none is present. */
export function findChromeBinary(): string | null {
  const fromEnv = process.env.AIDEOS_CHROME_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}
