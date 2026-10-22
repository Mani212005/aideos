/**
 * File Description: Supplies the active caption rectangle to visual devices without coupling them to film storage.
 * Inputs and outputs: FilmView caption geometry -> hero label placement in nested devices.
 * Used by: FilmView, Dynamic3DHeroOverlay and AnalogyInset.
 */
import { createContext } from "react";
import type { CaptionRect } from "./captionPlacement";
export const CaptionRegionContext = createContext<CaptionRect | undefined>(
  undefined,
);
