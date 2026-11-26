/**
 * File Description: The shared set of shot visual choices.
 * Inputs and outputs: None -> typed shot visual vocabulary.
 * Used by: Jev and narration grounding.
 */

export const SHOT_VISUALS = [
  "Text",
  "StatCounter",
  "TokenStrip",
  "Plot",
  "MatrixGrid",
  "Distribution",
  "LayerStack",
  "ScaleBar",
] as const;

export type ShotVisual = (typeof SHOT_VISUALS)[number];
