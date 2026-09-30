/**
 * File Description: Pieces several RAG explainer scenes share: the persistent HUD, the dotted
 * backdrop, corner brackets, and the terminal-style next-token probability panel that appears both
 * when the model is guessing and again when it is grounded.
 */

import { Canvas, PAL, HAIR, HAIR2, W, el, g, text, stroke, n } from "../kit";

/**
 * Corner brackets, the reference's frame furniture. The bottom pair sits at `bottom` rather than at
 * the frame's edge: the film's own chapter rail paints an opaque scrim over the last ~90px.
 */
export function corners(inset = 44, bottom = 900, len = 30, color: string = HAIR2): string {
  const c = (x: number, y: number, dx: number, dy: number) =>
    el("path", { d: `M${n(x + dx * len)} ${n(y)} L${n(x)} ${n(y)} L${n(x)} ${n(y + dy * len)}`, ...stroke(color, 2) });
  return [c(inset, inset, 1, 1), c(W - inset, inset, -1, 1), c(inset, bottom, 1, -1), c(W - inset, bottom, -1, -1)].join("");
}

/** The static backdrop: a dotted grid and a soft warm glow that keeps the dark from being flat. */
export function backdropSvg(): string {
  const defs =
    `<defs>` +
    `<pattern id="dots" width="48" height="48" patternUnits="userSpaceOnUse"><circle cx="24" cy="24" r="1.3" fill="${PAL.ink}" fill-opacity="0.10"/></pattern>` +
    `<radialGradient id="glow" cx="50%" cy="58%" r="55%"><stop offset="0" stop-color="${PAL.accent}" stop-opacity="0.10"/><stop offset="1" stop-color="${PAL.accent}" stop-opacity="0"/></radialGradient>` +
    `</defs>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1920" width="1920" height="1920">${defs}` +
    `<rect x="0" y="0" width="1920" height="1920" fill="${PAL.canvas}"/>` +
    `<rect x="0" y="420" width="1920" height="1080" fill="url(#dots)"/>` +
    `<rect x="0" y="420" width="1920" height="1080" fill="url(#glow)"/>` +
    `</svg>\n`
  );
}

/** One readout that changes value over the film: each value is its own element, cut on and off. */
function readoutSeries(c: Canvas, prefix: string, x: number, y: number, values: Array<{ label: string; frame: number }>): void {
  const ids = values.map((v, i) => {
    const id = `${prefix}-${i}`;
    c.add(text(v.label, { id, x, y, size: 20, face: "mono", weight: 500, fill: PAL.muted, anchor: "end", tracking: 0.08 }));
    return id;
  });
  ids.forEach((id, i) => {
    c.init(id, { opacity: i === 0 ? 1 : 0 });
    if (i > 0) c.cutOn(id, values[i].frame);
    if (i < ids.length - 1) c.cutOff(id, values[i + 1].frame);
  });
}

/**
 * The persistent HUD: corner brackets, a title tag and the live context readout. It stays on screen
 * for the whole film in muted tones. The chapter rail and progress are the film's own (Film.tsx).
 */
export function buildHud(c: Canvas, contextSteps: Array<{ label: string; frame: number }>): void {
  c.add(corners());
  c.add(text("RAG / RETRIEVAL-AUGMENTED GENERATION", { x: 84, y: 92, size: 20, face: "mono", weight: 500, fill: PAL.muted, tracking: 0.08 }));
  readoutSeries(c, "ctx", W - 84, 92, contextSteps);
  c.add(text("T 0.7  TOP-P 0.9", { x: W - 84, y: 122, size: 20, face: "mono", weight: 500, fill: PAL.muted, anchor: "end", tracking: 0.08 }));

}

/** One row of the next-token panel. */
export interface TokenRow {
  label: string;
  /** Probability before and after the moment the panel's state changes (equal when it never does). */
  p: [number, number];
}

/** Handles a caller needs to drive a panel built by tokenPanel. */
export interface TokenPanel {
  root: string;
  ids: string[];
  /** Plays the state change: bars move to their second probability and the hot row follows. */
  shift(frame: number, dur?: number): void;
  /** Top row before and after, so a caller can point at the pick. */
  hotBefore: number;
  hotAfter: number;
  height: number;
}

/**
 * Builds the terminal-style "p( next | context )" panel: a prompt line typed into it, then
 * candidate next tokens as labelled probability bars. The hot row is drawn in accent.
 */
export function tokenPanel(
  c: Canvas,
  o: { x: number; y: number; w: number; prompt: string; rows: TokenRow[]; typeFrom: number; typeTo: number; appearAt: number; tag: string },
): TokenPanel {
  const rowH = 54;
  const headH = 64;
  const promptH = 78;
  const h = headH + promptH + rows(o.rows.length, rowH) + 26;
  const root = c.uid("tp");
  const barX = 250;
  const barW = o.w - barX - 130;
  const hotBefore = o.rows.reduce((b, r, i, a) => (r.p[0] > a[b].p[0] ? i : b), 0);
  const hotAfter = o.rows.reduce((b, r, i, a) => (r.p[1] > a[b].p[1] ? i : b), 0);
  const ids: string[] = [root];
  const parts: string[] = [];

  parts.push(el("rect", { x: 0, y: 0, width: o.w, height: h, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }));
  parts.push(text("p( next | context )", { x: 26, y: 40, size: 22, face: "mono", weight: 500, fill: PAL.muted }));
  parts.push(text(o.tag, { x: o.w - 26, y: 40, size: 22, face: "mono", weight: 500, fill: PAL.muted, anchor: "end" }));
  parts.push(el("line", { x1: 0, y1: headH - 6, x2: o.w, y2: headH - 6, stroke: HAIR, "stroke-width": 2 }));

  // The prompt, typed in by sliding a panel-coloured cover off it.
  const promptY = headH + 44;
  const cw = 0.6 * 30;
  parts.push(text(o.prompt, { x: 26, y: promptY, size: 30, face: "mono", weight: 500, fill: PAL.ink }));
  const cover = c.uid("tp-cover");
  const coverW = o.prompt.length * cw;
  parts.push(el("rect", { id: cover, x: 26, y: promptY - 34, width: coverW, height: 46, fill: PAL.surface }));
  ids.push(cover);
  const caret = c.uid("tp-caret");
  parts.push(el("rect", { id: caret, x: 26, y: promptY - 28, width: 3, height: 36, fill: PAL.accent }));
  ids.push(caret);

  const barIds: string[] = [];
  const hotBarIds: string[] = [];
  const valueSets: Array<{ before: string; after: string }> = [];
  const rowHotBg: string[] = [];
  o.rows.forEach((r, i) => {
    const y = headH + promptH + i * rowH;
    const bg = c.uid("tp-hot");
    parts.push(el("rect", { id: bg, x: 0, y: y - 4, width: o.w, height: rowH - 4, fill: PAL.accent, "fill-opacity": 0.16 }));
    rowHotBg.push(bg);
    parts.push(text(r.label, { x: 26, y: y + 30, size: 26, face: "mono", weight: 500, fill: PAL.ink }));
    parts.push(el("rect", { x: barX, y: y + 12, width: barW, height: 8, fill: PAL.ink, "fill-opacity": 0.08 }));
    const bar = c.uid("tp-bar");
    const hot = c.uid("tp-barhot");
    parts.push(el("rect", { id: bar, x: barX, y: y + 12, width: barW, height: 8, fill: PAL.muted }));
    parts.push(el("rect", { id: hot, x: barX, y: y + 12, width: barW, height: 8, fill: PAL.accent }));
    barIds.push(bar);
    hotBarIds.push(hot);
    const vb = c.uid("tp-v0");
    const va = c.uid("tp-v1");
    parts.push(text(r.p[0].toFixed(2), { id: vb, x: o.w - 26, y: y + 30, size: 26, face: "mono", weight: 500, fill: i === hotBefore ? PAL.accent : PAL.muted, anchor: "end" }));
    parts.push(text(r.p[1].toFixed(2), { id: va, x: o.w - 26, y: y + 30, size: 26, face: "mono", weight: 500, fill: i === hotAfter ? PAL.accent : PAL.muted, anchor: "end" }));
    valueSets.push({ before: vb, after: va });
    ids.push(bg, bar, hot, vb, va);
  });

  c.add(g(root, o.x, o.y, parts.join("")));

  // Entrance: the panel rises in, the prompt types, then the bars fill to their first state.
  c.init(root, { opacity: 0, translateY: 30 });
  c.to(root, "translateY", 0, o.appearAt, o.appearAt + 14);
  c.to(root, "opacity", 1, o.appearAt, o.appearAt + 10, { easing: "linear" });
  c.typeReveal(cover, 26, coverW, o.prompt.length, o.typeFrom, o.typeTo);
  c.init(caret, { translateX: 0 });
  c.typeCaret(caret, cw, o.prompt.length, o.typeFrom, o.typeTo);

  const barsAt = o.typeTo + 4;
  o.rows.forEach((r, i) => {
    c.init([barIds[i], hotBarIds[i]], { scaleX: 0 });
    c.to(barIds[i], "scaleX", r.p[0], barsAt + i * 3, barsAt + i * 3 + 14, { origin: { x: barX, y: 0 } });
    c.init(hotBarIds[i], { opacity: i === hotBefore ? 1 : 0 });
    c.to(hotBarIds[i], "scaleX", r.p[0], barsAt + i * 3, barsAt + i * 3 + 14, { origin: { x: barX, y: 0 } });
    c.init([rowHotBg[i], valueSets[i].before], { opacity: 0 });
    c.init(valueSets[i].after, { opacity: 0 });
    c.fadeIn(valueSets[i].before, barsAt + i * 3, 6);
    if (i === hotBefore) c.fadeIn(rowHotBg[i], barsAt + i * 3, 6);
  });

  const shift = (frame: number, dur = 18) => {
    o.rows.forEach((r, i) => {
      c.to(barIds[i], "scaleX", r.p[1], frame, frame + dur, { origin: { x: barX, y: 0 } });
      c.to(hotBarIds[i], "scaleX", r.p[1], frame, frame + dur, { origin: { x: barX, y: 0 } });
      c.cutOff(valueSets[i].before, frame + Math.round(dur / 2));
      c.cutOn(valueSets[i].after, frame + Math.round(dur / 2));
      if (hotBefore !== hotAfter) {
        if (i === hotBefore) {
          c.fadeOut(rowHotBg[i], frame, 8);
          c.fadeOut(hotBarIds[i], frame, 8);
        }
        if (i === hotAfter) {
          c.fadeIn(rowHotBg[i], frame + 4, 8);
          c.fadeIn(hotBarIds[i], frame + 4, 8);
        }
      }
    });
  };
  return { root, ids, shift, hotBefore, hotAfter, height: h };
}

// Total height of n rows.
function rows(count: number, rowH: number): number {
  return count * rowH;
}
