/**
 * File Description: Shared Studio output format dimensions and labels.
 * Inputs and outputs: format identifiers -> dimensions and display labels.
 * Used by: editor/src/App.tsx and editor/src/screens/EditStage.tsx.
 */

export const FORMATS = {
  long: { width: 1920, height: 1080, label: "16:9" },
  reel: { width: 1080, height: 1920, label: "9:16" },
} as const;

export type Format = keyof typeof FORMATS;
