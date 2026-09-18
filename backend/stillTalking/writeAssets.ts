/**
 * File Description: Writes the vector artwork for "Still Talking" into its video package.
 * Emits every asset built by artwork.ts to videos/still-talking/visuals/ and checks each one parses
 * with the scene engine's own SVG parser before it lands, so a malformed document is caught here
 * rather than as a missing prop halfway through a render.
 */

import * as fs from "fs";
import * as path from "path";
import { parseSvgDocument, collectSvgElementIds } from "../../src/dl/scene/svgDocument";
import { buildAllArtwork } from "./artwork";

/** Absolute path to the film's visuals directory. */
export function visualsDir(): string {
  return path.resolve(__dirname, "../../videos/still-talking/visuals");
}

/** Writes every asset and returns the element ids each document declares, keyed by file name. */
export function writeAssets(): Record<string, string[]> {
  const dir = visualsDir();
  fs.mkdirSync(dir, { recursive: true });

  const artwork = buildAllArtwork();
  const idsByFile: Record<string, string[]> = {};

  for (const [fileName, source] of Object.entries(artwork)) {
    // Parsing before writing means a broken document never reaches the package.
    const parsed = parseSvgDocument(source);
    const ids = collectSvgElementIds(parsed);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicates.length > 0) {
      throw new Error(`${fileName} declares duplicate element ids: ${duplicates.join(", ")}`);
    }
    fs.writeFileSync(path.join(dir, fileName), source, "utf8");
    idsByFile[fileName] = ids;
  }

  return idsByFile;
}

if (require.main === module) {
  const ids = writeAssets();
  for (const [file, list] of Object.entries(ids)) {
    console.log(`${file.padEnd(18)} ${list.length} ids`);
  }
}
