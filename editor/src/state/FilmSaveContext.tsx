/**
 * File Description: React context that hands screens the project's one save path (commit and save
 * through the film sync machine), so no component posts a film to the dev server on its own.
 * Inputs and outputs: the project's saveFilm function -> a useFilmSave hook returning it.
 * Used by: editor/src/App.tsx (provider), ScriptEditor, CustomizationEditor, Styleboard, OnCanvasAiEditor.
 */

import { createContext, useContext } from "react";
import type { Film } from "../../../src/dl/schema";
import type { SaveOutcome } from "./useFilmProject";

/** Commit a film as one labelled undo step (unless it is already open) and save it; resolves with the outcome. */
export type SaveFilm = (next: Film, label: string) => Promise<SaveOutcome>;

export const FilmSaveContext = createContext<SaveFilm | null>(null);

/** The project's save path; throws when a component is rendered outside the studio shell. */
export function useFilmSave(): SaveFilm {
  const saveFilm = useContext(FilmSaveContext);
  if (!saveFilm) throw new Error("useFilmSave must be used inside the studio's FilmSaveContext provider");
  return saveFilm;
}
