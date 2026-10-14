/**
 * File Description: Finite material declaration for the frozen P0 art, pending character-owned data declarations.
 * Inputs and outputs: approved local asset identity -> allowed authored base and outline colors.
 * Used by: Three stage design gates; shading and antialiasing do not enlarge this declaration.
 */

/** Approved Iona base/trim/outline colors; texture identity is checked by the frozen resource manifest. */
export const STAGE_MATERIAL_PALETTES: Readonly<Record<string, readonly string[]>> = {
  "iona-art-v1": ["#101826", "#f0c8a8", "#1c2a4e", "#131c38", "#1f8a8c", "#f2e8d0", "#b5532f", "#252c3c", "#161b26", "#2b3a4a", "#e9e2d2", "#1fa7a4", "#145f62", "#167074", "#ffffff", "#e0b092", "#37538c"],
};
