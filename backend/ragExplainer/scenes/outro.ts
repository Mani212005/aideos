/**
 * File Description: Scene nine of the RAG explainer, the recap and the close.
 * Four verbs land one per spoken word with a small drawing each (chunks, points, rings, a prompt
 * window), then the frame clears to "Ground it." and the last line types itself out beneath it.
 */

import type { NarrationTiming } from "../../sceneKit";
import { Canvas, PAL, HAIR2, W, el, g, text, stroke } from "../kit";

// Builds the outro asset: the four-verb recap and the closing card.
export function buildOutro(timing: NarrationTiming, durationFrames: number): Canvas {
  const c = new Canvas("outro", timing, durationFrames);
  const { from, word } = c.cues;
  c.lifetime(from("recap"), null);

  // ---- recap: four verbs, four pictures -----------------------------------------------------------
  c.lyric({ beat: "recap", rows: ["*Chunk* it.", "*Embed* it.", "*Search* it.", "*Stuff* it."], x: 120, y: 300, size: 124, bounds: { x0: 100, x1: 960 }, entry: "slam", exit: from("end") - 6 });

  const cells = [
    { verb: "Chunk", n: "01", draw: () => {
      let s = "";
      for (let i = 0; i < 4; i++) s += el("rect", { x: -90 + (i % 2) * 6, y: -70 + i * 38, width: 180, height: 30, ...stroke(PAL.accent, 3) }) + el("line", { x1: -74, y1: -55 + i * 38, x2: 40 + (i % 2) * 20, y2: -55 + i * 38, ...stroke(PAL.ink, 3) });
      return s;
    } },
    { verb: "Embed", n: "02", draw: () => {
      const pts = [[-70, -40], [-40, -10], [-85, 5], [-15, -50], [55, -55], [80, -20], [35, -25], [10, 55], [55, 70], [-25, 75]];
      return pts.map(([x, y], i) => el("circle", { cx: x, cy: y, r: 9, fill: i < 4 ? PAL.accent : PAL.ink, "fill-opacity": i < 4 ? 1 : 0.8 })).join("");
    } },
    { verb: "Search", n: "03", draw: () =>
      [30, 62, 96].map((r) => el("circle", { cx: 0, cy: 0, r, ...stroke(PAL.accent, 3, { "stroke-opacity": 0.85 }) })).join("") + el("circle", { cx: 0, cy: 0, r: 11, fill: PAL.accent }),
    },
    { verb: "Stuff", n: "04", draw: () => {
      let s = el("rect", { x: -100, y: -80, width: 200, height: 160, ...stroke(PAL.ink, 3) });
      for (let i = 0; i < 3; i++) s += el("rect", { x: -80, y: -60 + i * 40, width: 160, height: 28, fill: PAL.accent, "fill-opacity": 0.85 });
      return s;
    } },
  ];
  const ids: string[] = [];
  cells.forEach((cell, i) => {
    const id = `cell-${i}`;
    ids.push(id);
    const cx = 1160 + (i % 2) * 380;
    const cy = 360 + Math.floor(i / 2) * 340;
    c.add(g(id, cx, cy, el("rect", { x: -170, y: -150, width: 340, height: 300, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }) + cell.draw() + text(`${cell.n} / ${cell.verb.toUpperCase()}`, { x: -150, y: 132, size: 20, face: "mono", weight: 700, fill: PAL.muted, tracking: 0.12 })));
    c.init(id, { scale: 0.7, opacity: 0 });
    const f = word("recap", cell.verb);
    c.to(id, "scale", 1, f, f + 12, { origin: { x: 0, y: 0 } });
    c.to(id, "opacity", 1, f, f + 6, { easing: "linear" });
    c.to(id, "opacity", 0, from("end") - 6, from("end"), { easing: "linear" });
  });

  // ---- end: one line, big, then the model speaks ---------------------------------------------------
  c.lyric({ beat: "end", rows: ["*Ground it.*", "Then let the model speak."], x: W / 2, y: 470, size: [230, 76], align: "center", entry: "slam", rowEntry: [undefined, "rise"], exit: "hold", lead: 1.12, tracking: -0.03 });
  c.add(el("line", { id: "end-rule", x1: 330, y1: 560, x2: W - 330, y2: 560, ...stroke(PAL.accent, 4) }));
  c.draw("end-rule", word("end", "let"), word("end", "speak", "end"), { easing: "expoOut" });
  c.add(text("RETRIEVE  /  AUGMENT  /  GENERATE", { id: "end-tag", x: W / 2, y: 830, size: 24, face: "mono", weight: 700, fill: PAL.muted, anchor: "middle", tracking: 0.2 }));
  c.appear("end-tag", word("end", "speak", "end") + 6, 14);
  return c;
}
