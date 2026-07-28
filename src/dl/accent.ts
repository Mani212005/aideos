import { createContext, useContext } from "react";
import { PALETTE } from "./tokens";

/**
 * The one colour, in context.
 *
 * It is not imported directly from the palette by components because it is the
 * single token a film — or the person in Studio — is allowed to override. Every
 * other value in §01 is fixed; making the accent a prop and the rest constants
 * is what stops "themeable" turning into "unbounded".
 */
export const AccentContext = createContext<string>(PALETTE.accent);

export const useAccent = () => useContext(AccentContext);
