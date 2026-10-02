import { el, g, text, stroke, PAL}  from "../svg";

export interface CalloutConfig {
  id: string;
  x: number; // Point being called out
  y: number;
  labelX: number; // Text location
  labelY: number;
  label: string;
  color?: string;
}

export function drawCallout(cfg: CalloutConfig) {
  const { id, x, y, labelX, labelY, label, color } = cfg;
  const c = color ?? PAL.ink;
  
  const line = el("line", {
    id: `${id}-line`,
    x1: x,
    y1: y,
    x2: labelX,
    y2: labelY,
    ...stroke(c, 2)
  });
  
  const dot = el("circle", {
    id: `${id}-dot`,
    cx: x,
    cy: y,
    r: 4,
    fill: c
  });
  
  // Basic bounding box estimation for text to draw a background if needed, but simple text is fine
  const labelEl = text(label, {
    id: `${id}-label`,
    x: labelX + (labelX > x ? 10 : -10),
    y: labelY + 6,
    size: 24,
    anchor: labelX > x ? "start" : "end",
    fill: c
  });

  return g(id, 0, 0, [line, dot, labelEl].join("\n"));
}
