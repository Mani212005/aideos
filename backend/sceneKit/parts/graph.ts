import { el, g, stroke, PAL}  from "../svg";

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  radius?: number;
  fill?: string;
  label?: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  color?: string;
  strokeWidth?: number;
  opacity?: number;
}

export function drawGraph(id: string, nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const edgeEls = edges.map(e => {
    const s = nodeMap.get(e.sourceId);
    const t = nodeMap.get(e.targetId);
    if (!s || !t) return "";
    return el("line", {
      id: e.id,
      x1: s.x,
      y1: s.y,
      x2: t.x,
      y2: t.y,
      ...stroke(e.color ?? PAL.ink, e.strokeWidth ?? 2),
      opacity: e.opacity
    });
  }).filter(Boolean).join("\n");

  const nodeEls = nodes.map(nd => {
    return el("circle", {
      id: nd.id,
      cx: nd.x,
      cy: nd.y,
      r: nd.radius ?? 6,
      fill: nd.fill ?? PAL.ink
    });
  }).join("\n");

  return g(id, 0, 0, edgeEls + "\n" + nodeEls);
}
