/**
 * File Description: The first film of a new project. From a story already converted to the tagged form it compiles scenes and shots; a story too short to be a film (the film schema asks for 10 s at narration rate 1, scaled by the house pace: 8.3 s at 1.2x) gets a film of one title shot instead, with no invented shots, numbers or text. A compiled film that fails the schema for any other reason (more than 12 sections, more than 24 canvas nodes, a 90 s run with no text beat or canvas return) throws the Invalid film error, the same error writeFilm gives. A story with one section gets an end node, because the schema asks for 2 canvas nodes.
 * Inputs and outputs: id, title, accent, theme, tagged story script and the compile flag -> the first Film, or an Error "Invalid film: ..." for a story the schema refuses.
 * Used by: editor/vite.config.ts (api/projects/new), backend/newProjectFilm.test.ts.
 */

import { HOUSE_PACE } from "../src/dl/pacingProfile";
import { filmSchema, filmUnderFloorMessage, parseFilm, type Film, type ThemeConfig } from "../src/dl/schema";
import { buildFilmPartsFromScript, hasScreenplayTags } from "./scriptIntake";

/** What the first film is made from. */
export interface NewProjectFilmInput {
  id: string;
  title: string;
  accent?: string;
  theme: ThemeConfig;
  /** The story in the tagged screenplay form (script.md). */
  storyScript: string;
  /** Compile scenes and shots from the story when it has screenplay tags. */
  autoCompile: boolean;
}

/** The message of the one schema issue that a short story causes. */
const UNDER_MIN_FILM = filmUnderFloorMessage(HOUSE_PACE.minFilmSec);

/** A film of one title shot: the smallest honest film for a story that is too short to compile. */
function titleOnlyFilm(input: NewProjectFilmInput): Film {
  const title = input.title.trim();
  return {
    id: input.id,
    title,
    fps: 30,
    accent: input.accent,
    theme: input.theme,
    chapters: [title],
    canvas: {
      nodes: [
        { id: "intro", label: title, x: -200, y: -100, w: 230, h: 70 },
        { id: "end", label: "End", x: 160, y: -100, w: 230, h: 70 },
      ],
      edges: [{ from: "intro", to: "end", dashed: false }],
    },
    shots: [
      {
        id: "shot-1",
        dur: 10,
        look: "intro",
        move: "cut",
        stage: "frame",
        drift: false,
        zoom: 1,
        blocks: [{ c: "TextReveal", text: title, size: "headline" }],
      },
    ],
  } as Film;
}

/** Builds the first film of a project. Throws "Invalid film: ..." when the compiled film breaks a schema limit other than the minimum film length. */
export function buildNewProjectFilm(input: NewProjectFilmInput): Film {
  if (!input.autoCompile || !hasScreenplayTags(input.storyScript)) return titleOnlyFilm(input);
  const parts = buildFilmPartsFromScript(input.storyScript);
  // The schema asks for at least two canvas nodes: a story with one section compiles to one, so an end node follows it.
  const nodes = parts.nodes.length >= 2 ? parts.nodes : [...parts.nodes, { id: "end", label: "End", x: 60, y: -100, w: 230, h: 68 }];
  const edges = parts.nodes.length >= 2 ? parts.edges : [...parts.edges, { from: nodes[0].id, to: "end", dashed: false }];
  const compiled = {
    id: input.id,
    title: input.title.trim(),
    fps: 30,
    accent: input.accent,
    theme: input.theme,
    chapters: nodes.map((n) => n.label),
    canvas: { nodes, edges },
    shots: parts.shots,
  } as Film;
  const checked = filmSchema.safeParse(compiled);
  if (checked.success) return compiled;
  // Only a story under the minimum film length keeps the title-only film. Any other refusal is the Invalid film error.
  if (checked.error.issues.every((issue) => issue.message === UNDER_MIN_FILM)) return titleOnlyFilm(input);
  return parseFilm(compiled);
}
