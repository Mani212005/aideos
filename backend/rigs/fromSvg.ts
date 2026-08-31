/**
 * File Description: SVG-to-CharacterRig Converter and Auto-Rigging Engine (Phase 6).
 * Parses semantic SVG groups (#torso, #head, #leftArm, #rightArm, #legs), computes anatomical joint pivots,
 * validates 100% theme-token color compliance, and generates typed CharacterRig and ModelSheet modules.
 */

import type { CharacterRig, RigGroup, PathElement, SemanticToken } from "../../src/dl/characters/types";
import type { ModelSheet } from "../../src/dl/scene/types";

export interface RiggingOptions {
  rigId: string;
  name: string;
  defaultScale?: number;
}

export interface RiggingResult {
  rig: CharacterRig;
  modelSheet: ModelSheet;
}

const REQUIRED_JOINT_GROUPS = ["torso", "head", "leftArm", "rightArm", "legs"] as const;

// Hex color to semantic token mapping table (Archival / Blueprint / Standard Palette)
const COLOR_TO_TOKEN_MAP: Record<string, SemanticToken> = {
  "#ffffff": "surface",
  "#fff": "surface",
  "#101013": "surface",
  "#1e293b": "surface",
  "#111827": "ink",
  "#f5f5f5": "ink",
  "#000000": "ink",
  "#000": "ink",
  "#64748b": "muted",
  "#8a8a8e": "muted",
  "#94a3b8": "muted",
  "#635bff": "accent",
  "#ff6b00": "accent",
  "#10b981": "accent",
  "#0a0a0b": "canvas",
  "#f8f6f0": "canvas",
  "rgba(17, 24, 39, 0.12)": "hairline",
  "rgba(245,245,245,0.1)": "hairline",
  "rgba(245,245,245,0.12)": "hairline",
  "rgba(245, 245, 245, 0.1)": "hairline",
  "rgba(245, 245, 245, 0.12)": "hairline",
  "none": "none",
  "transparent": "none",
};

/** Normalizes a fill or stroke attribute value to a semantic color token slot. */
export function mapColorToSemanticToken(colorValue: string | undefined, pathIndex: number, attrName: string): SemanticToken {
  if (!colorValue || colorValue === "none" || colorValue === "transparent") {
    return "none";
  }

  // If already a named semantic token
  const lower = colorValue.toLowerCase().trim();
  if (["surface", "ink", "muted", "hairline", "accent", "canvas", "none"].includes(lower)) {
    return lower as SemanticToken;
  }

  const mapped = COLOR_TO_TOKEN_MAP[lower];
  if (mapped) {
    return mapped;
  }

  throw new Error(
    `UNMAPPABLE_COLOR_TOKEN: Path at index ${pathIndex} has unmappable ${attrName} color "${colorValue}". All rig paths must strictly bind 6-token semantic palette slots.`,
  );
}

/** Computes anatomical joint pivot coordinates from geometric boundaries or explicit markers. */
function computeAnatomicalPivot(groupId: string, bbox: { minX: number; maxX: number; minY: number; maxY: number }): { x: number; y: number } {
  const midX = Math.round((bbox.minX + bbox.maxX) / 2);
  const midY = Math.round((bbox.minY + bbox.maxY) / 2);

  switch (groupId) {
    case "torso":
      // Hip / spine base pivot: horizontal center, lower third of torso
      return { x: midX, y: Math.round(bbox.minY + (bbox.maxY - bbox.minY) * 0.7) };
    case "head":
      // Neck collar hinge: horizontal center, bottom edge of head
      return { x: midX, y: Math.round(bbox.maxY) };
    case "leftArm":
      // Left shoulder socket: upper-right region of left arm (toward torso)
      return { x: Math.round(bbox.maxX - 5), y: Math.round(bbox.minY + 15) };
    case "rightArm":
      // Right shoulder socket: upper-left region of right arm (toward torso)
      return { x: Math.round(bbox.minX + 5), y: Math.round(bbox.minY + 15) };
    case "legs":
      // Pelvis / hip base: horizontal center, top edge of legs
      return { x: midX, y: Math.round(bbox.minY) };
    default:
      return { x: midX, y: midY };
  }
}

/** Parses raw SVG string into a structured CharacterRig and ModelSheet. */
export function parseSvgToCharacterRig(svgContent: string, options: RiggingOptions): RiggingResult {
  // 1. Extract viewBox
  const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/i);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : "0 0 400 600";

  // 2. Find groups matching convention: <g id="torso" ...> ... </g>
  const foundGroups: Map<string, { rawGroupSvg: string; paths: PathElement[]; bbox: { minX: number; maxX: number; minY: number; maxY: number } }> = new Map();

  const groupRegex = /<g\s+[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/g>/gi;
  let match: RegExpExecArray | null;

  while ((match = groupRegex.exec(svgContent)) !== null) {
    const groupId = match[1];
    const groupInnerSvg = match[2];

    if ((REQUIRED_JOINT_GROUPS as readonly string[]).includes(groupId)) {
      // Extract paths within group
      const paths: PathElement[] = [];
      const pathRegex = /<path\s+([^>]+)\/?>/gi;
      let pathMatch: RegExpExecArray | null;
      let pathIdx = 0;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      while ((pathMatch = pathRegex.exec(groupInnerSvg)) !== null) {
        const attrStr = pathMatch[1];

        const dMatch = attrStr.match(/\bd=["']([^"']+)["']/i);
        const fillMatch = attrStr.match(/\bfill=["']([^"']+)["']/i);
        const strokeMatch = attrStr.match(/\bstroke=["']([^"']+)["']/i);
        const strokeWidthMatch = attrStr.match(/\bstroke-width=["']([^"']+)["']/i);

        if (!dMatch) continue;

        const d = dMatch[1];
        const fillToken = mapColorToSemanticToken(fillMatch?.[1], pathIdx, "fill");
        const strokeToken = mapColorToSemanticToken(strokeMatch?.[1], pathIdx, "stroke");
        const strokeWidth = strokeWidthMatch ? parseFloat(strokeWidthMatch[1]) : undefined;

        // Approximate bounding box from path d commands
        const numbers = d.match(/[-+]?[0-9]*\.?[0-9]+/g)?.map(Number) || [];
        for (let i = 0; i < numbers.length - 1; i += 2) {
          const px = numbers[i];
          const py = numbers[i + 1];
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }

        paths.push({
          d,
          fill: fillToken,
          stroke: strokeToken,
          strokeWidth,
        });
        pathIdx++;
      }

      foundGroups.set(groupId, {
        rawGroupSvg: groupInnerSvg,
        paths,
        bbox: {
          minX: minX === Infinity ? 0 : minX,
          maxX: maxX === -Infinity ? 400 : maxX,
          minY: minY === Infinity ? 0 : minY,
          maxY: maxY === -Infinity ? 600 : maxY,
        },
      });
    }
  }

  // 3. Verify all 5 required joint groups are present
  const missingGroups = REQUIRED_JOINT_GROUPS.filter((req) => !foundGroups.has(req));
  if (missingGroups.length > 0) {
    throw new Error(
      `MISSING_REQUIRED_JOINT_GROUPS: SVG is missing required joint group(s): [${missingGroups.join(", ")}]. SVG must define groups with id="torso", id="head", id="leftArm", id="rightArm", and id="legs".`,
    );
  }

  // 4. Construct CharacterGroups with 2-level kinematic tree
  const groups: RigGroup[] = [];

  for (const reqId of REQUIRED_JOINT_GROUPS) {
    const data = foundGroups.get(reqId)!;
    const pivot = computeAnatomicalPivot(reqId, data.bbox);

    const groupObj: RigGroup = {
      id: reqId,
      name: reqId.charAt(0).toUpperCase() + reqId.slice(1),
      pivot,
      paths: data.paths,
    };

    // Hierarchical parenting: head, leftArm, rightArm have parent='torso'
    if (["head", "leftArm", "rightArm"].includes(reqId)) {
      groupObj.parent = "torso";
    }

    groups.push(groupObj);
  }

  const rig: CharacterRig = {
    id: options.rigId,
    name: options.name,
    viewBox,
    defaultScale: options.defaultScale || 1.0,
    groups,
  };

  // Compute canonical height from overall bounding box
  const allY = groups.flatMap((g) => g.paths.flatMap((p: PathElement) => p.d.match(/[-+]?[0-9]*\.?[0-9]+/g)?.map(Number) || []));
  const minY = allY.length > 0 ? Math.min(...allY.filter((_, i) => i % 2 === 1)) : 0;
  const maxY = allY.length > 0 ? Math.max(...allY.filter((_, i) => i % 2 === 1)) : 600;
  const canonicalHeight = Math.max(100, Math.round(maxY - minY));

  const modelSheet: ModelSheet = {
    rigId: options.rigId,
    canonicalHeight,
    canonicalScale: options.defaultScale || 1.0,
    referencePose: "idle",
    defaultFacing: "right",
  };

  return { rig, modelSheet };
}

/** Rewrites element IDs and URL references to ensure zero ID collisions across multiple instances in the same document. */
export function namespaceSvgIds(svgContent: string, instanceId: string): string {
  // Replace id="foo" with id="foo--instanceId"
  let namespaced = svgContent.replace(/\bid=["']([^"']+)["']/gi, (match, id) => `id="${id}--${instanceId}"`);

  // Replace url(#foo) with url(#foo--instanceId)
  namespaced = namespaced.replace(/url\(#([^)]+)\)/gi, (match, id) => `url(#${id}--${instanceId})`);

  // Replace href="#foo" and xlink:href="#foo" with href="#foo--instanceId"
  namespaced = namespaced.replace(/\b(xlink:)?href=["']#([^"']+)["']/gi, (match, prefix, id) => `${prefix || ""}href="#${id}--${instanceId}"`);

  return namespaced;
}
