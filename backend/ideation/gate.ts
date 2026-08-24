/**
 * File Description: The pacing acceptance gate for the staged pipeline
 * (report section 4 step 3). Builds a provisional Film from a raw shot list
 * and runs the exact `parseFilm` rules the validator enforces at render time,
 * so bad pacing dies here, at token cost, never render cost.
 */
import { parseFilm } from "../../src/dl/schema";
import type { Film } from "../../src/dl/schema";
import { parseShotlist } from "./schemas";
import type { Shotlist } from "./schemas";
import { layoutNodes, compileEdges } from "./compile";

/**
 * Assemble a film-shaped object from a validated shot list using the same
 * deterministic layout the compiler uses, then run every pacing rule through
 * parseFilm. Returns the parsed shot list and the provisional film.
 */
export function gateShotList(raw: unknown): { shotlist: Shotlist; film: Film } {
  const shotlist = parseShotlist(raw);
  const nodes = layoutNodes(shotlist.nodes);
  const film = parseFilm({
    id: shotlist.id,
    title: shotlist.title,
    fps: shotlist.fps,
    chapters: shotlist.chapters,
    canvas: {
      nodes,
      edges: compileEdges(shotlist),
    },
    shots: shotlist.shots.map((s) => ({
      id: s.id,
      ...(s.ch ? { ch: s.ch } : {}),
      dur: s.dur,
      move: s.move,
      stage: s.stage,
      look: s.look,
      drift: s.drift,
      zoom: s.zoom,
      ...(s.scriptText ? { scriptText: s.scriptText } : {}),
      ...(s.visualDirection ? { visualDirection: s.visualDirection } : {}),
      ...(s.transition ? { transition: s.transition } : {}),
      blocks: s.blocks,
    })),
  });
  return { shotlist, film };
}
