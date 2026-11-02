/**
 * File Description: Type declarations for audioLibraryOverride.mjs.
 * Inputs and outputs: none -> types for the audio library bundle override helpers.
 * Used by: remotion.config.ts, backend/journeys/remotionFrames.ts.
 */

import type { WebpackOverrideFn } from "@remotion/bundler";

// Replaces audio/library.json in a webpack config with the manifest AIDEOS_AUDIO_LIBRARY names.
export const audioLibraryWebpackOverride: WebpackOverrideFn;

// Options for a programmatic bundle() call that reads the AIDEOS_AUDIO_LIBRARY manifest.
export function audioLibraryBundleOptions(): { webpackOverride?: WebpackOverrideFn; enableCaching?: boolean };
