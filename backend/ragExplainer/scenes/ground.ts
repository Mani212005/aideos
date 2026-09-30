/**
 * File Description: Scene seven of the RAG explainer, "the answer".
 * The same next-token panel that showed the model guessing returns, and once the context lands its
 * bars collapse onto the grounded answer. A hallucination counter steps down while the answer, with
 * its source, is written out beneath it. Numbers are labelled illustrative: they show the mechanism.
 */

import type { NarrationTiming } from "../../sceneKit";
import { Canvas, PAL, HAIR2, el, g, text, stroke } from "../kit";
import { tokenPanel } from "./common";

// Builds the ground scene asset: the panel shift, the falling counter and the sourced answer.
export function buildGround(timing: NarrationTiming, durationFrames: number): Canvas {
  const c = new Canvas("ground", timing, durationFrames);
  const { from, to, word } = c.cues;
  c.lifetime(from("shift"), to("grounded") - 10);

  c.lyric({ beat: "shift", rows: ["Watch the odds", "shift once the", "*context* lands."], x: 120, y: 310, size: 100, bounds: { x0: 100, x1: 960 } });
  c.lyric({ beat: "grounded", rows: ["The guesses", "fall away.", "The answer", "has a *source.*"], x: 120, y: 290, size: 92, bounds: { x0: 100, x1: 960 }, entry: "drop" });

  const panel = tokenPanel(c, {
    x: 1000,
    y: 200,
    w: 800,
    prompt: "Q: what is the refund window?",
    rows: [
      { label: "14 days", p: [0.34, 0.04] },
      { label: "30 days", p: [0.27, 0.93] },
      { label: "60 days", p: [0.22, 0.02] },
      { label: "a week", p: [0.17, 0.01] },
    ],
    typeFrom: from("shift") + 4,
    typeTo: from("shift") + 22,
    appearAt: from("shift") + 1,
    tag: "illustrative",
  });
  panel.shift(word("shift", "lands"), 20);

  // The hallucination counter: every value is its own element, cut on as the last one leaves.
  const cx = 1000;
  const cy = 750;
  c.add(text("P( HALLUCINATION )", { id: "hc-label", x: cx, y: cy - 96, size: 22, face: "mono", weight: 700, fill: PAL.muted, tracking: 0.14 }));
  c.add(el("rect", { id: "hc-track", x: cx, y: cy + 84, width: 800, height: 10, fill: PAL.ink, "fill-opacity": 0.08 }));
  c.add(el("rect", { id: "hc-bar", x: cx, y: cy + 84, width: 800, height: 10, fill: PAL.accent }));
  const values = [0.83, 0.71, 0.56, 0.41, 0.27, 0.16, 0.09, 0.04];
  const ids = values.map((v, i) => {
    const id = `hc-${i}`;
    c.add(text(v.toFixed(2), { id, x: cx, y: cy + 46, size: 150, face: "mono", weight: 700, fill: i === values.length - 1 ? PAL.accent : PAL.ink }));
    return id;
  });
  const appearAt = word("shift", "lands") + 6;
  c.appear(["hc-label", "hc-track"], appearAt, 8);
  c.init("hc-bar", { scaleX: 0 });
  c.to("hc-bar", "scaleX", values[0], appearAt, appearAt + 14, { origin: { x: cx, y: 0 } });
  const startDrop = word("grounded", "guesses");
  const endDrop = word("grounded", "source", "end");
  ids.forEach((id, i) => {
    c.init(id, { opacity: 0 });
    const f = i === 0 ? appearAt : startDrop + Math.round(((endDrop - startDrop) * i) / (values.length - 1));
    c.cutOn(id, f);
    if (i < ids.length - 1) {
      const next = startDrop + Math.round(((endDrop - startDrop) * (i + 1)) / (values.length - 1));
      c.cutOff(id, next);
    }
  });
  // The bar follows the numbers down, one step per value.
  values.forEach((v, i) => {
    if (i === 0) return;
    const at = (k: number) => startDrop + Math.round(((endDrop - startDrop) * k) / (values.length - 1));
    const end = i < values.length - 1 ? Math.min(at(i) + 10, at(i + 1)) : at(i) + 10;
    c.to("hc-bar", "scaleX", v, at(i), end, { origin: { x: cx, y: 0 } });
  });

  // The grounded answer, with its source, written out under the words.
  const ax = 120;
  const ay = 690;
  const answer = "A: within 30 days";
  const cw = 0.6 * 36;
  c.add(
    g(
      "answer",
      ax,
      ay,
      el("rect", { x: 0, y: 0, width: 780, height: 110, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }) +
        text(answer, { x: 28, y: 68, size: 36, face: "mono", weight: 500, fill: PAL.ink }) +
        el("rect", { id: "an-cover", x: 28, y: 32, width: answer.length * cw, height: 50, fill: PAL.surface }) +
        g("an-src", 500, 34, el("rect", { x: 0, y: 0, width: 250, height: 44, ...stroke(PAL.accent, 2) }) + el("path", { d: "M14 24 L22 32 L36 14", ...stroke(PAL.accent, 4, { "stroke-linecap": "round", "stroke-linejoin": "round" }) }) + text("refunds.md", { x: 52, y: 30, size: 20, face: "mono", weight: 700, fill: PAL.accent })),
    ),
  );
  const ansAt = word("grounded", "answer");
  c.appear("answer", ansAt - 6, 8);
  c.typeReveal("an-cover", 28, answer.length * cw, answer.length, ansAt, word("grounded", "has") + 4);
  c.init("an-src", { opacity: 0 });
  c.fadeIn("an-src", word("grounded", "source"), 8);
  return c;
}
