/**
 * File Description: SVG isometric and flat layered planes building block for 3D multi-layer diagrams.
 * Inputs and outputs: layer plane specifications, tilt angle, and count -> SVG isometric planes markup.
 * Used by: backend/sceneKit/parts/index.ts, examples/diagram-parts/build.ts.
 */

import { el, g, PAL, n } from "../svg";

export interface LayerPlaneConfig {
  id: string;
  cx?: number;
  wNear?: number;
  wFar?: number;
  h?: number;
  top?: (layerIndex: number) => number;
  layers?: number;
  tilt?: number; // 0 = flat 2D, 1 = 3D stacked
  flatBounds?: { x: number; y: number; w: number; h: number };
}

// Computes linear interpolation between values a and b at progress t.
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export class LayerPlanes {
  config: Required<Omit<LayerPlaneConfig, 'top'>> & { top: (l: number) => number };

  // Initializes multi-layer planes with perspective geometry and tilt configuration.
  constructor(cfg: LayerPlaneConfig) {
    this.config = {
      id: cfg.id,
      cx: cfg.cx ?? 960,
      wNear: cfg.wNear ?? 1200,
      wFar: cfg.wFar ?? 800,
      h: cfg.h ?? 300,
      top: cfg.top ?? ((l: number) => 100 + ((cfg.layers ?? 3) - 1 - l) * 300),
      layers: cfg.layers ?? 3,
      tilt: cfg.tilt ?? 1,
      flatBounds: cfg.flatBounds ?? { x: 300, y: 100, w: 1320, h: 880 },
    };
  }

  // Projects normalized UV coordinates on a given layer plane into 2D canvas coordinates.
  project(u: number, v: number, layer: number) {
    const { cx, wNear, wFar, h, top, tilt, flatBounds: fb } = this.config;
    const fx = fb.x + u * fb.w;
    const fy = fb.y + v * fb.h;
    
    const wv = lerp(wFar, wNear, v);
    const lx = cx + (u - 0.5) * wv;
    const ly = top(layer) + v * h;
    
    return {
      x: lerp(fx, lx, tilt),
      y: lerp(fy, ly, tilt)
    };
  }

  // Generates SVG polygon elements for all configured layer planes.
  drawPlanes() {
    const out: string[] = [];
    for (let l = this.config.layers - 1; l >= 0; l--) {
      const corners = [
        this.project(0, 0, l),
        this.project(1, 0, l),
        this.project(1, 1, l),
        this.project(0, 1, l),
      ];
      const pts = corners.map(c => `${n(c.x)},${n(c.y)}`).join(" ");
      out.push(
        el("polygon", {
          id: `${this.config.id}-plane-${l}`,
          points: pts,
          fill: PAL.surface,
          "fill-opacity": 0.8,
          stroke: PAL.muted,
          "stroke-width": 1.5,
          "stroke-linejoin": "round"
        })
      );
    }
    return g(this.config.id, 0, 0, out.join("\n"));
  }
}
