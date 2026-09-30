/**
 * File Description: Scene one of the RAG explainer, "the confident liar".
 * A training-data timeline that simply stops at a cutoff, the model inventing answers in the empty
 * space after it, "hallucination" versus "confidence" as two bars that disagree, and the terminal
 * next-token panel showing the model picking the most plausible wrong number with no source at all.
 */

import type { NarrationTiming } from "../../sceneKit";
import { Canvas, PAL, HAIR2, el, g, text, stroke, rng, frameOf } from "../kit";
import { tokenPanel } from "./common";

// Builds the liar scene asset: markup plus its animation timeline.
export function buildLiar(timing: NarrationTiming, durationFrames: number): Canvas {
  const c = new Canvas("liar", timing, durationFrames);
  const { from, to, word } = c.cues;
  const end = word("lookup", "remember", "end");
  c.lifetime(0, end);

  // ---- stale: a timeline of training data that stops dead ------------------------------------------
  const axisY = 800;
  const cutX = 1140;
  const graphParts: string[] = [];
  graphParts.push(el("line", { id: "axis", x1: 120, y1: axisY, x2: 1800, y2: axisY, ...stroke(HAIR2, 2) }));
  let ticks = "";
  for (let x = 120; x <= 1800; x += 60) ticks += el("line", { x1: x, y1: axisY, x2: x, y2: axisY + (x % 240 === 120 ? 16 : 9), ...stroke(HAIR2, 2) });
  graphParts.push(el("g", { id: "ticks" }, ticks));
  graphParts.push(text("TRAINING DATA", { x: 120, y: axisY + 52, size: 20, face: "mono", weight: 500, fill: PAL.muted, tracking: 0.1 }));

  const rand = rng(11);
  const dataGroups: string[] = [];
  for (let i = 0; i < 10; i++) {
    const id = `dd-${i}`;
    dataGroups.push(id);
    let dots = "";
    for (let k = 0; k < 6; k++) {
      const x = 130 + i * 98 + rand() * 88;
      const y = axisY - 14 - rand() * 46;
      dots += el("circle", { cx: x, cy: y, r: 3 + rand() * 4, fill: PAL.ink, "fill-opacity": 0.35 + rand() * 0.4 });
    }
    graphParts.push(el("g", { id }, dots));
  }
  graphParts.push(el("line", { id: "cutoff", x1: cutX, y1: axisY - 100, x2: cutX, y2: axisY + 60, ...stroke(PAL.accent, 4) }));
  graphParts.push(text("LAST SPRING", { id: "cutoff-label", x: cutX, y: axisY + 92, size: 22, face: "mono", weight: 700, fill: PAL.accent, anchor: "middle", tracking: 0.1 }));
  graphParts.push(el("rect", { id: "empty", x: cutX + 30, y: axisY - 100, width: 630, height: 130, ...stroke(HAIR2, 2, { "stroke-dasharray": "10 10" }) }));
  graphParts.push(text("TODAY  ???", { id: "empty-label", x: cutX + 345, y: axisY - 26, size: 26, face: "mono", weight: 500, fill: PAL.muted, anchor: "middle", tracking: 0.12 }));

  // Invented answers: hollow accent circles with a question mark, popping into the empty zone.
  const invented: string[] = [];
  const spots = [[1240, 725], [1330, 770], [1410, 715], [1490, 775], [1560, 725], [1640, 770], [1710, 720], [1290, 690]];
  spots.forEach(([x, y], i) => {
    const id = `inv-${i}`;
    invented.push(id);
    graphParts.push(
      g(id, x, y, el("circle", { cx: 0, cy: 0, r: 17, fill: PAL.accent, "fill-opacity": 0.16, stroke: PAL.accent, "stroke-width": 2 }) + text("?", { x: 0, y: 8, size: 24, face: "mono", weight: 700, fill: PAL.accent, anchor: "middle" })),
    );
  });
  c.add(el("g", { id: "graph" }, graphParts.join("")));

  const stale = from("stale");
  c.draw("axis", stale, stale + 26, { easing: "expoOut" });
  c.appear("ticks", stale + 6, 12);
  c.appear(dataGroups, frameOf(c.timing.segments[0].words[1].startSec), 8, { stagger: 4 });
  c.draw("cutoff", word("stale", "spring"), word("stale", "spring") + 10);
  c.appear(["cutoff-label", "empty", "empty-label"], word("stale", "spring") + 4, 10);
  c.init(invented, { scale: 0, opacity: 0 });
  const inventAt = word("invent", "invent");
  c.to(invented, "scale", 1, inventAt, inventAt + 10, { stagger: 3, origin: { x: 0, y: 0 } });
  c.to(invented, "opacity", 1, inventAt, inventAt + 6, { stagger: 3, easing: "linear" });
  c.fadeOut("graph", from("halluc") + 4, 8, { easing: "linear" });

  c.lyric({ beat: "stale", rows: ["I know so much,", "but I stopped learning", "last *spring.*"], x: 120, y: 250, size: 118 });
  c.lyric({ beat: "invent", rows: ["Ask me about", "today, and I'll", "*invent* anything."], x: 120, y: 250, size: 118, entry: "drop" });

  // ---- halluc: two words that mean the same thing, and two bars that disagree ----------------------
  c.lyric({ beat: "halluc", rows: ["They call it", "*hallucination.*", "I call it *confidence.*"], x: 120, y: 230, size: [90, 168, 90], entry: "slam" });
  const gauge: string[] = [];
  const bx = 340;
  const bw = 760;
  gauge.push(text("CONFIDENCE", { x: 120, y: 744, size: 24, face: "mono", weight: 500, fill: PAL.ink, tracking: 0.08 }));
  gauge.push(el("rect", { x: bx, y: 722, width: bw, height: 12, fill: PAL.ink, "fill-opacity": 0.08 }));
  gauge.push(el("rect", { id: "conf-bar", x: bx, y: 722, width: bw, height: 12, fill: PAL.accent }));
  gauge.push(text("0.99", { x: bx + bw + 24, y: 744, size: 24, face: "mono", weight: 700, fill: PAL.accent }));
  gauge.push(text("ACCURACY", { x: 120, y: 812, size: 24, face: "mono", weight: 500, fill: PAL.ink, tracking: 0.08 }));
  gauge.push(el("rect", { x: bx, y: 790, width: bw, height: 12, ...stroke(HAIR2, 2, { "stroke-dasharray": "8 8" }) }));
  gauge.push(text("unknown", { x: bx + bw + 24, y: 812, size: 24, face: "mono", weight: 500, fill: PAL.muted }));
  c.add(el("g", { id: "gauge" }, gauge.join("")));
  c.init("conf-bar", { scaleX: 0 });
  const confAt = word("halluc", "confidence");
  c.appear("gauge", confAt - 6, 8);
  c.to("conf-bar", "scaleX", 0.99, confAt - 2, confAt + 22, { origin: { x: bx, y: 0 } });
  c.fadeOut("gauge", to("halluc") - 10, 8);

  // ---- nexttoken: no brakes, just the most likely word ----------------------------------------------
  c.lyric({ beat: "nexttoken", rows: ["No source,", "no brakes.", "Just the next", "*likely* word."], x: 120, y: 240, size: 100, exit: from("lookup") - 6 });
  const panel = tokenPanel(c, {
    x: 1000,
    y: 230,
    w: 800,
    prompt: "Q: what is the refund window?",
    rows: [
      { label: "14 days", p: [0.34, 0.34] },
      { label: "30 days", p: [0.27, 0.27] },
      { label: "60 days", p: [0.22, 0.22] },
      { label: "a week", p: [0.17, 0.17] },
    ],
    typeFrom: from("nexttoken") + 8,
    typeTo: from("nexttoken") + 38,
    appearAt: from("nexttoken") + 2,
    tag: "illustrative",
  });
  // The panel and the words leave together as the next line begins.
  const leave = word("lookup", "remember");
  c.fadeOut(panel.root, leave, 8, { easing: "linear" });
  return c;
}
