import { el, g, stroke, PAL, n } from "../svg";

export interface ChartConfig {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  data: { x: number; y: number }[]; // x and y normalized 0..1
  curveColor?: string;
  dotProgress?: number; // 0..1 along the curve
}

export function drawChart(cfg: ChartConfig) {
  const { id, x, y, w, h, data, dotProgress } = cfg;
  
  // Axes
  const axes = el("path", {
    id: `${id}-axes`,
    d: `M ${n(x)} ${n(y)} L ${n(x)} ${n(y + h)} L ${n(x + w)} ${n(y + h)}`,
    ...stroke(PAL.muted, 2)
  });

  // Curve
  let pathD = "";
  if (data.length > 0) {
    const pts = data.map(d => ({ px: x + d.x * w, py: y + h - d.y * h }));
    pathD = `M ${n(pts[0].px)} ${n(pts[0].py)}`;
    for (let i = 1; i < pts.length; i++) {
      pathD += ` L ${n(pts[i].px)} ${n(pts[i].py)}`;
    }
  }

  const curve = el("path", {
    id: `${id}-curve`,
    d: pathD,
    ...stroke(cfg.curveColor ?? PAL.ink, 3)
  });

  // Dot
  let dot = "";
  if (dotProgress !== undefined && data.length > 1) {
    // Interpolate point
    const maxIdx = data.length - 1;
    const exactIdx = dotProgress * maxIdx;
    const i = Math.floor(exactIdx);
    const j = Math.ceil(exactIdx);
    const t = exactIdx - i;
    
    let dotX, dotY;
    if (i === j) {
      dotX = x + data[i].x * w;
      dotY = y + h - data[i].y * h;
    } else {
      const p1x = x + data[i].x * w;
      const p1y = y + h - data[i].y * h;
      const p2x = x + data[j].x * w;
      const p2y = y + h - data[j].y * h;
      dotX = p1x + (p2x - p1x) * t;
      dotY = p1y + (p2y - p1y) * t;
    }

    dot = el("circle", {
      id: `${id}-dot`,
      cx: dotX,
      cy: dotY,
      r: 6,
      fill: cfg.curveColor ?? PAL.ink
    });
  }

  return g(id, 0, 0, [axes, curve, dot].filter(Boolean).join("\n"));
}
