/**
 * File Description: Scene eight of the RAG explainer, "the catch".
 * The pipeline drawn as three stacked stages (question, retrieved chunk, answer) where the retrieval
 * returns the wrong chunk and the answer confidently cites it. Then the retrieval stage is marked as
 * the bug: garbage in, confident out.
 */

import type { NarrationTiming } from "../../sceneKit";
import { Canvas, PAL, HAIR2, el, g, text, stroke } from "../kit";

// Builds the fail scene asset: the wrong chunk, the confident citation and the bug marker.
export function buildFail(timing: NarrationTiming, durationFrames: number): Canvas {
  const c = new Canvas("fail", timing, durationFrames);
  const { from, to, word } = c.cues;
  c.lifetime(from("wrong"), to("garbage") - 10);

  c.lyric({ beat: "wrong", rows: ["But fetch the", "wrong chunk,", "and I'll be wrong,", "with *citations.*"], x: 120, y: 310, size: 84, bounds: { x0: 100, x1: 960 } });
  c.lyric({ beat: "garbage", rows: ["Garbage in,", "confident out.", "Bad retrieval", "is the *bug.*"], x: 120, y: 310, size: 92, bounds: { x0: 100, x1: 960 }, entry: "drop" });

  const X = 1000;
  const Wd = 800;
  // Stage 1: the question.
  c.add(g("f-q", X, 200, el("rect", { x: 0, y: 0, width: Wd, height: 64, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }) + text("Q: what is the refund window?", { x: 24, y: 42, size: 26, face: "mono", weight: 500, fill: PAL.ink })));
  c.add(el("line", { id: "f-l1", x1: X + 400, y1: 264, x2: X + 400, y2: 340, ...stroke(HAIR2, 3) }));
  // Stage 2: the retrieved chunk, which is the wrong one.
  c.add(
    g(
      "f-r",
      X,
      340,
      el("rect", { x: 0, y: 0, width: Wd, height: 160, fill: PAL.surface, stroke: PAL.accent, "stroke-width": 2 }) +
        text("RETRIEVED", { x: 24, y: 38, size: 18, face: "mono", weight: 500, fill: PAL.muted, tracking: 0.12 }) +
        text("shipping.md", { x: 24, y: 80, size: 22, face: "mono", weight: 700, fill: PAL.accent }) +
        text("orders ship in 5 business days", { x: 24, y: 126, size: 32, face: "mono", weight: 500, fill: PAL.ink }) +
        g("f-tag", Wd - 250, 18, el("rect", { x: 0, y: 0, width: 226, height: 40, fill: PAL.accent }) + text("WRONG CHUNK", { x: 113, y: 27, size: 20, face: "mono", weight: 700, fill: PAL.canvas, anchor: "middle", tracking: 0.1 })),
    ),
  );
  c.add(el("line", { id: "f-l2", x1: X + 400, y1: 500, x2: X + 400, y2: 576, ...stroke(HAIR2, 3) }));
  // Stage 3: the confident answer, with a citation.
  c.add(
    g(
      "f-a",
      X,
      576,
      el("rect", { x: 0, y: 0, width: Wd, height: 140, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }) +
        text("ANSWER", { x: 24, y: 38, size: 18, face: "mono", weight: 500, fill: PAL.muted, tracking: 0.12 }) +
        text("A: 5 business days", { x: 24, y: 96, size: 38, face: "mono", weight: 500, fill: PAL.ink }) +
        g("f-cite", Wd - 280, 76, el("rect", { x: 0, y: 0, width: 256, height: 44, ...stroke(PAL.accent, 2) }) + el("path", { d: "M14 24 L22 32 L36 14", ...stroke(PAL.accent, 4, { "stroke-linecap": "round", "stroke-linejoin": "round" }) }) + text("shipping.md", { x: 52, y: 30, size: 20, face: "mono", weight: 700, fill: PAL.accent })),
    ),
  );
  // Labels that arrive in the second line.
  c.add(text("GARBAGE IN", { id: "f-gi", x: X + 424, y: 312, size: 22, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.14 }));
  c.add(text("CONFIDENT OUT", { id: "f-co", x: X + 424, y: 548, size: 22, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.14 }));
  c.add(el("rect", { id: "f-bug", x: X - 14, y: 326, width: Wd + 28, height: 188, ...stroke(PAL.accent, 4, { "stroke-dasharray": "14 10" }) }));
  c.add(g("f-bug-tag", X - 14, 740, el("rect", { x: 0, y: 0, width: 330, height: 50, fill: PAL.accent }) + text("BAD RETRIEVAL = BUG", { x: 165, y: 33, size: 22, face: "mono", weight: 700, fill: PAL.canvas, anchor: "middle", tracking: 0.08 })));

  const wr = from("wrong");
  c.appear("f-q", wr + 4, 10);
  c.draw(["f-l1"], word("wrong", "fetch"), word("wrong", "fetch") + 12);
  c.appear("f-r", word("wrong", "wrong"), 10);
  c.init("f-tag", { scale: 0, opacity: 0 });
  c.to("f-tag", "scale", 1, word("wrong", "chunk,") , word("wrong", "chunk,") + 10, { origin: { x: 113, y: 20 } });
  c.to("f-tag", "opacity", 1, word("wrong", "chunk,"), word("wrong", "chunk,") + 5, { easing: "linear" });
  c.draw(["f-l2"], word("wrong", "be"), word("wrong", "be") + 12);
  c.appear("f-a", word("wrong", "be"), 10);
  c.init("f-cite", { opacity: 0 });
  c.fadeIn("f-cite", word("wrong", "citations"), 8);

  c.appear("f-gi", word("garbage", "Garbage"), 8);
  c.appear("f-co", word("garbage", "confident"), 8);
  c.draw("f-bug", word("garbage", "retrieval"), word("garbage", "retrieval") + 16);
  c.init("f-bug-tag", { opacity: 0 });
  c.fadeIn("f-bug-tag", word("garbage", "bug"), 8);
  return c;
}
