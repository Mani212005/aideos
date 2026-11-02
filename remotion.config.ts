/**
 * File Description: CLI configuration for Remotion rendering and bundling, including the test-only audio library override.
 * Inputs and outputs: configuration API and AIDEOS_AUDIO_LIBRARY -> sets video image format, output overwrite, render concurrency and the library manifest the bundle imports.
 * Used by: Remotion CLI commands (npm run render, npm run render:reel, npm run studio).
 */

import { Config } from "@remotion/cli/config";
import { audioLibraryWebpackOverride } from "./backend/pipeline/audioLibraryOverride.mjs";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(2);
Config.setTimeoutInMilliseconds(180000);

// Tests bundle a synthetic audio library: the mixer imports audio/library.json, so swap that one module for the manifest AIDEOS_AUDIO_LIBRARY names.
if (process.env.AIDEOS_AUDIO_LIBRARY?.trim()) {
  // The cached bundle would keep the committed manifest, and a test bundle must not poison the shared cache either.
  Config.setCachingEnabled(false);
  Config.overrideWebpackConfig((config) => audioLibraryWebpackOverride(config));
}
