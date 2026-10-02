import { el, g, text, stroke, PAL}  from "../svg";

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
    
    // Simple line for now
    const line = el("line", {
      id: e.id,
      x1: sx,
      y1: sy,
      x2: tx,
      y2: ty,
      ...stroke(PAL.muted, 2)
    });
    
    return line;
  }).join("\n");

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
    
    return g(c.id, 0, 0, rect + "\n" + labelEl);
  }).join("\n");

  return g(id, 0, 0, edgeEls + "\n" + cardEls);
}
