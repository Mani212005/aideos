/**
 * File Description: Defines the currently active film bundle rendered by default in studio and CLI.
 */

import { stillTalkingFilm } from "./films/still-talking";
import type { Film } from "./schema";

/**
 * Which film renders. One line, so swapping the subject of the whole pipeline
 * is a one-word change rather than a search through the components.
 */
export const ACTIVE_FILM: Film = stillTalkingFilm;
