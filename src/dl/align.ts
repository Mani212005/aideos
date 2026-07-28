import { createContext, useContext } from "react";

/**
 * How the blocks in the current panel line up.
 *
 * A text beat is the only place the system centres anything, and it has to
 * centre *all* of it — a centred paragraph under a left-aligned headline reads
 * as a layout bug rather than a decision. Threading it through context keeps
 * the alignment out of every block's props, where an author could get it wrong.
 */
export const AlignContext = createContext<"left" | "center">("left");

export const useAlign = () => useContext(AlignContext);
