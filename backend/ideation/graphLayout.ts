/**
 * File Description: Relationship-Aware Spatial Graph Layout Generator (Section 7 Option b).
 * Generates 3-8 canvas nodes whose coordinates reflect conceptual relationships:
 * sequential progression left-to-right, conceptual contrasts opposed vertically,
 * and related subproblems clustered in proximity.
 */

import type { CanvasNode, CanvasEdge } from "../../src/dl/schema";

export interface ConceptEntity {
  id: string;
  label: string;
  sub?: string;
  chapterIndex?: number;
  relationship?: "sequential" | "contrast" | "hierarchy" | "parallel";
  relatedTo?: string;
}

export interface GeneratedGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Generates relationship-aware canvas nodes and directed edges from concept entities.
 */
export function generateRelationshipAwareCanvas(
  concepts: ConceptEntity[],
  options: { canvasWidth?: number; canvasHeight?: number } = {}
): GeneratedGraph {
  const count = concepts.length;
  if (count === 0) {
    return {
      nodes: [
        { id: "node-1", label: "Intro", x: 120, y: 320, w: 190, h: 62 },
        { id: "node-2", label: "Conclusion", x: 600, y: 320, w: 190, h: 62 },
      ],
      edges: [{ from: "node-1", to: "node-2", dashed: false }],
    };
  }

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const byId = new Map<string, CanvasNode>();

  const baseY = 340;
  const startX = 140;
  const totalXSpan = Math.max(800, (count - 1) * 320);

  for (let i = 0; i < count; i++) {
    const concept = concepts[i];
    const seqX = Math.round(startX + (i / Math.max(1, count - 1)) * totalXSpan);
    let x = seqX;
    let y = baseY;

    if (concept.relationship === "contrast") {
      // Contrast nodes are positioned on the upper or lower track opposing baseline
      const parent = concept.relatedTo ? byId.get(concept.relatedTo) : undefined;
      x = parent ? parent.x + 80 : seqX;
      y = i % 2 === 0 ? baseY - 160 : baseY + 160;
    } else if (concept.relationship === "hierarchy" && concept.relatedTo) {
      // Hierarchical subproblems clustered below their parent concept
      const parent = byId.get(concept.relatedTo);
      if (parent) {
        x = parent.x + 40;
        y = parent.y + 140;
      }
    } else if (concept.relationship === "parallel") {
      // Parallel branches placed alongside the main flow
      y = i % 2 === 0 ? baseY - 110 : baseY + 110;
    }

    const node: CanvasNode = {
      id: concept.id,
      label: concept.label.slice(0, 28),
      sub: concept.sub ? concept.sub.slice(0, 34) : undefined,
      x,
      y,
      w: 190,
      h: 62,
    };

    nodes.push(node);
    byId.set(concept.id, node);

    // Route edges based on relationships
    if (concept.relatedTo && byId.has(concept.relatedTo)) {
      edges.push({
        from: concept.relatedTo,
        to: concept.id,
        dashed: concept.relationship === "contrast",
      });
    } else if (i > 0) {
      edges.push({
        from: concepts[i - 1].id,
        to: concept.id,
        dashed: false,
      });
    }
  }

  return { nodes, edges };
}
