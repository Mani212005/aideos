/**
 * File Description: Finds SVG text visible during each long shot in the reel crop using the existing projector.
 * Inputs and outputs: compiled Film and local SVG sources -> displayed text grouped by shot id.
 * Used by: backend/reelCut/brief.ts when loading a package's authoring constraints.
 */
import fs from "node:fs";
import type { Film } from "../../src/dl/schema";
import { buildTimeline } from "../../src/dl/camera";
import { parseSvgDocument, type SvgNode } from "../../src/dl/scene/svgDocument";
import { resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import { prepareSvgProjection } from "../designCheck/insetRegion";

// Reads the text-bearing nodes with the same ancestor naming the geometry projector uses.
function textByElement(source: string): Map<string, string[]> {
  const doc = parseSvgDocument(
    fs.readFileSync(resolveRepoAssetPath(source), "utf8"),
  );
  const labels = new Map<string, string[]>();
  // Collects a text element's full content, including nested tspan words.
  const content = (node: SvgNode): string =>
    [node.text ?? "", ...node.children.map(content)].join(" ").trim();
  // Tracks the nearest identified ancestor to match projected part names even on unlabelled text.
  const visit = (node: SvgNode, parentId?: string) => {
    if (
      ["defs", "title", "desc", "style", "clipPath", "mask"].includes(node.tag)
    )
      return;
    const id = node.attrs.id ?? parentId;
    if (["text", "tspan", "textPath"].includes(node.tag)) {
      const name = id ?? node.tag;
      labels.set(name, [...(labels.get(name) ?? []), content(node)]);
    }
    for (const child of node.children) visit(child, id);
  };
  for (const node of doc.children) visit(node);
  return labels;
}

// Samples every story frame, preserving short reveals, authored visibility and the reel's actual crop.
export function visibleReelText(film: Film): Record<string, string[]> {
  if (!film.scene) return {};
  const labels = new Map(
    [film.scene.background, ...film.scene.props].flatMap((p) =>
      p.svgSource
        ? [
            [p.assetId, textByElement(p.svgSource)] satisfies [
              string,
              Map<string, string[]>,
            ],
          ]
        : [],
    ),
  );
  if (![...labels.values()].some((l) => l.size)) return {};
  const at = prepareSvgProjection(
    { ...film.scene, actors: [] },
    1080,
    1920,
    { includeBackground: true },
  );
  return Object.fromEntries(
    buildTimeline(film).map(({ shot, from, to }) => {
      const texts = new Set<string>();
      for (let frame = from; frame < to; frame++)
        for (const entity of at(frame)) {
          const entityLabels = labels.get(entity.id);
          if (!entityLabels) continue;
          for (const part of entity.parts) {
            const b = part.bounds;
            if (b.x1 <= 0 || b.x0 >= 1080 || b.y1 <= 0 || b.y0 >= 1920)
              continue;
            for (const text of entityLabels.get(part.name) ?? [])
              if (text) texts.add(text);
          }
        }
      return [shot.id, [...texts]];
    }),
  );
}
