/**
 * File Description: React context and hook managing per-film accent color overrides across rendered components.
 * Inputs and outputs: theme accent hex color string -> AccentContext provider and useAccent hook.
 * Used by: src/dl/Film.tsx, src/dl/Block.tsx, and dl visual primitives.
 */

import { createContext, useContext } from "react";
import { PALETTE } from "./tokens";

/**
 * The one colour, in context.
 *
 * It is not imported directly from the palette by components because it is the
 * single token a film - or the person in Studio - is allowed to override. Every
 * other value in §01 is fixed; making the accent a prop and the rest constants
 * is what stops "themeable" turning into "unbounded".
 */
export const AccentContext = createContext<string>(PALETTE.accent);

export const useAccent = () => useContext(AccentContext);
