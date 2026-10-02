/**
 * File Description: SVG flow card building block for flowchart cards and connecting edges.
 */

import { el, g, text, stroke, PAL } from "../svg";

export interface FlowCardNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  fill?: string;
}

export interface FlowCardEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
}

// Renders interactive flow cards and directional connector edges into an SVG group.
export function drawFlowCards(id: string, cards: FlowCardNode[], edges: FlowCardEdge[]) {
  const cardMap = new Map(cards.map(c => [c.id, c]));

  const edgeEls = edges.map(e => {
    const s = cardMap.get(e.sourceId);
    const t = cardMap.get(e.targetId);
    if (!s || !t) return "";
    
    // Connect centers
    const sx = s.x + s.w / 2;
    const sy = s.y + s.h / 2;
    const tx = t.x + t.w / 2;
    const ty = t.y + t.h / 2;
    
    const line = el("line", {
      id: e.id,
      x1: sx,
      y1: sy,
      x2: tx,
      y2: ty,
      ...stroke(PAL.muted, 2)
    });
    
    let labelEl = "";
    if (e.label) {
      labelEl = text(e.label, {
        id: `${e.id}-label`,
        x: (sx + tx) / 2,
        y: (sy + ty) / 2 - 8,
        size: 14,
        anchor: "middle",
        fill: PAL.muted
      });
    }
    
    return labelEl ? `${line}\n${labelEl}` : line;
  }).filter(Boolean).join("\n");

  const cardEls = cards.map(c => {
    const rect = el("rect", {
      id: `${c.id}-rect`,
      x: c.x,
      y: c.y,
      width: c.w,
      height: c.h,
      rx: 8,
      fill: c.fill ?? PAL.surface,
      stroke: PAL.muted,
      "stroke-width": 2
    });
    
    let labelEl = "";
    if (c.label) {
      labelEl = text(c.label, {
        id: `${c.id}-label`,
        x: c.x + c.w / 2,
        y: c.y + c.h / 2 + 6,
        size: 20,
        anchor: "middle",
        fill: PAL.ink
      });
    }
    
    return g(c.id, 0, 0, labelEl ? `${rect}\n${labelEl}` : rect);
  }).filter(Boolean).join("\n");

  return g(id, 0, 0, [edgeEls, cardEls].filter(Boolean).join("\n"));
}
