/**
 * File Description: Writes a scene film's vector artwork into its video package.
 * Every document is parsed with the scene engine's own SVG parser and checked for duplicate element
 * ids before it lands, so a malformed asset is caught at write time rather than as a missing prop
 * halfway through a render.
 */

import * as fs from "fs";
import * as path from "path";
import { parseSvgDocument, collectSvgElementIds } from "../../src/dl/scene/svgDocument";

// Validates and writes each named SVG document into `dir`, returning the element ids per file.
export function writeSvgAssets(dir: string, artwork: Record<string, string>): Record<string, string[]> {
  fs.mkdirSync(dir, { recursive: true });
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
