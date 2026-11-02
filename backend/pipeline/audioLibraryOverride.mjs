/**
 * File Description: The one place that swaps the audio library manifest a Remotion bundle imports. The browser-safe mixer reads the committed audio/library.json, so tests that cache a synthetic library (AIDEOS_AUDIO_LIBRARY, see backend/testSupport/fixtureVideosDir.ts) need the bundle to read that manifest instead. A no-op when the variable is unset.
 * Inputs and outputs: AIDEOS_AUDIO_LIBRARY and a webpack config -> the config with that one module replaced, plus bundle options that also turn bundle caching off.
 * Used by: remotion.config.ts, backend/pipeline/renderSampleWorker.mjs, backend/journeys/remotionFrames.ts.
 */

import path from "node:path";
import { webpack } from "@remotion/bundler";

// Replaces audio/library.json in a webpack config with the manifest AIDEOS_AUDIO_LIBRARY names.
export function audioLibraryWebpackOverride(config) {
  const override = process.env.AIDEOS_AUDIO_LIBRARY?.trim();
  if (!override) return config;
  return {
    ...config,
    plugins: [...(config.plugins ?? []), new webpack.NormalModuleReplacementPlugin(/audio[\\/]library\.json$/, path.resolve(override))],
  };
}

// Options for a programmatic bundle() call; the cached bundle would keep the committed manifest, and a test bundle must not poison the shared cache.
export function audioLibraryBundleOptions() {
  return process.env.AIDEOS_AUDIO_LIBRARY?.trim() ? { webpackOverride: audioLibraryWebpackOverride, enableCaching: false } : {};
}
