/**
 * File Description: Writes the vector artwork for "Still Talking" into its video package.
 * Emits every asset built by artwork.ts to videos/still-talking/visuals/ and checks each one parses
 * with the scene engine's own SVG parser before it lands, so a malformed document is caught here
 * rather than as a missing prop halfway through a render.
 */

import * as path from "path";
import { writeSvgAssets } from "../sceneKit";
import { buildAllArtwork } from "./artwork";

/** Absolute path to the film's visuals directory. */
export function visualsDir(): string {
  return path.resolve(__dirname, "../../videos/still-talking/visuals");
}

/** Writes every asset and returns the element ids each document declares, keyed by file name. */
export function writeAssets(): Record<string, string[]> {
  return writeSvgAssets(visualsDir(), buildAllArtwork());
}

if (require.main === module) {
  const ids = writeAssets();
  for (const [file, list] of Object.entries(ids)) {
    console.log(`${file.padEnd(18)} ${list.length} ids`);
  }
}
