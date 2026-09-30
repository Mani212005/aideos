/**
 * File Description: Scene two of the RAG explainer, "the fix".
 * "Let me look it up" types a search into a query box, then a cream title card wipes up over the dark
 * film and spells out the three words of the acronym, each rising from behind a floor as it is spoken.
 */

import type { NarrationTiming } from "../../sceneKit";
import { Canvas, PAL, HAIR2, el, g, text, stroke, W, H } from "../kit";

// Builds the fix scene asset: the search box, then the cream title card.
export function buildFix(timing: NarrationTiming, durationFrames: number): Canvas {
  const c = new Canvas("fix", timing, durationFrames);
  const { from, to, word } = c.cues;
  c.lifetime(from("lookup"), to("title") + 2);

  // ---- lookup: a search box types the question the model should have asked --------------------------
  c.lyric({ beat: "lookup", rows: ["So don't make me", "remember.", "Let me *look it up.*"], x: 120, y: 250, size: 118 });
  const query = "refund window policy";
  const cw = 0.6 * 34;
  const search =
    el("rect", { x: 0, y: 0, width: 800, height: 96, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }) +
    el("circle", { cx: 52, cy: 46, r: 17, ...stroke(PAL.accent, 4) }) +
    el("line", { x1: 65, y1: 59, x2: 82, y2: 76, ...stroke(PAL.accent, 4, { "stroke-linecap": "round" }) }) +
    text(query, { x: 112, y: 59, size: 34, face: "mono", weight: 500, fill: PAL.ink }) +
    el("rect", { id: "sb-cover", x: 112, y: 22, width: query.length * cw, height: 50, fill: PAL.surface }) +
    el("rect", { id: "sb-caret", x: 112, y: 26, width: 3, height: 42, fill: PAL.accent }) +
    text("ENTER", { x: 770, y: 57, size: 20, face: "mono", weight: 500, fill: PAL.muted, anchor: "end", tracking: 0.1 });
  c.add(g("search", 1000, 700, search));
  const lookAt = word("lookup", "look");
  const typedBy = word("lookup", "up", "end");
  c.appear("search", lookAt - 8, 10);
  c.typeReveal("sb-cover", 112, query.length * cw, query.length, lookAt, typedBy);
  c.init("sb-caret", { translateX: 0 });
  c.typeCaret("sb-caret", cw, query.length, lookAt, typedBy);
  c.fadeOut("search", to("lookup") - 6, 6, { easing: "linear" });

  // ---- title: the acronym, unmasked one word at a time on a light card ----------------------------
  const cardIn = from("title") - 10;
  // The card is inset rather than full-bleed so the film's own chapter rail (and its dark scrim) sits
  // on the dark frame below it instead of cutting a band out of a light ground.
  const cardTop = 152;
  const cardBottom = 884;
  c.group("card", 0, 0, () => {
    // Everything inside is clipped to the card, so a row waiting below its floor can never show
    // against the dark frame (dark type on the warm glow is still faintly visible).
    c.add(`<defs><clipPath id="card-clip"><rect x="64" y="${cardTop}" width="${W - 128}" height="${cardBottom - cardTop}"/></clipPath></defs>`);
    c.group(undefined, 0, 0, () => {
      c.add(el("rect", { x: 64, y: cardTop, width: W - 128, height: cardBottom - cardTop, fill: PAL.cream }));
      c.lyric({
        beat: "title",
        rows: ["*Retrieval.*", "Augmented.", "Generation."],
        x: 130,
        y: 356,
        size: 220,
        upper: true,
        entry: "mask",
        fill: PAL.canvas,
        lead: 1.02,
        tracking: -0.035,
        bounds: { x0: 100, x1: W - 100 },
        // The floor the next row rises from: the card's own colour, drawn over the row that just landed.
        afterRow: (_row, baseline, size) => el("rect", { x: 64, y: baseline + 14, width: W - 128, height: Math.min(size * 1.6, cardBottom - (baseline + 14)), fill: PAL.cream }),
      });
      // What each word means, in the card's right margin, arriving with the word it explains.
      const notes: Array<[string, string]> = [["Retrieval", "find the facts"], ["Augmented", "add to the prompt"], ["Generation", "write the answer"]];
      notes.forEach(([spoken, note], i) => {
        const id = `note-${i}`;
        c.add(text(note, { id, x: W - 96, y: 356 + i * 224 * 1.02 - 12, size: 26, face: "mono", weight: 500, fill: PAL.canvas, anchor: "end", opacity: 0.7 }));
        c.appear(id, word("title", spoken) + 6, 8);
      });
    }, { "clip-path": "url(#card-clip)" });
  });
  c.init("card", { translateY: H });
  c.to("card", "translateY", 0, cardIn, cardIn + 16);
  c.to("card", "translateY", -H, to("title") - 14, to("title") + 2, { easing: "expoInOut" });
  return c;
}
