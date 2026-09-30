/**
 * File Description: Scenes three to six of the RAG explainer, the retrieval pipeline itself, drawn as
 * one continuous diagram so nothing cuts: a document is torn into overlapping chunks, the chunks fly
 * into a vector space as points that cluster by meaning, the question becomes a point with rings
 * around it that select its nearest neighbours, and those neighbours are stuffed into a prompt window
 * with a source receipt each. Every element lands on the word that names it.
 */

import type { NarrationTiming } from "../../sceneKit";
import { createCues } from "../../sceneKit";
import { Canvas, PAL, HAIR, HAIR2, el, g, text, stroke, rng } from "../kit";

/** Where the four nearest chunks land in the prompt, frame by frame, so the HUD's counter can follow. */
export function stuffFrames(timing: NarrationTiming): number[] {
  const cues = createCues(timing);
  const start = cues.word("stuff", "stuff");
  return [0, 1, 2, 3].map((j) => start + 14 + j * 9);
}

// The left column every step's words sit in, clear of the diagram on the right.
const LEFT = { x0: 100, x1: 960 };

/** Point positions in the vector plane: four refund chunks, three shipping, three pricing. */
const POINTS: Array<{ x: number; y: number; cluster: "A" | "B" | "C" }> = [
  { x: 1215, y: 395, cluster: "A" },
  { x: 1262, y: 452, cluster: "A" },
  { x: 1180, y: 470, cluster: "A" },
  { x: 1300, y: 400, cluster: "A" },
  { x: 1560, y: 330, cluster: "B" },
  { x: 1612, y: 388, cluster: "B" },
  { x: 1522, y: 392, cluster: "B" },
  { x: 1432, y: 672, cluster: "C" },
  { x: 1492, y: 716, cluster: "C" },
  { x: 1386, y: 724, cluster: "C" },
];
const QUERY = { x: 1335, y: 470 };
const HULLS = [
  { cx: 1240, cy: 432, r: 112, label: "refunds.md", lx: 1240, ly: 298 },
  { cx: 1568, cy: 368, r: 92, label: "shipping.md", lx: 1568, ly: 252 },
  { cx: 1437, cy: 704, r: 84, label: "pricing.md", lx: 1534, ly: 712, anchor: "start" as const },
];

// Builds the flow asset: chunking, embedding, searching and stuffing, as one diagram.
export function buildFlow(timing: NarrationTiming, durationFrames: number): Canvas {
  const c = new Canvas("flow", timing, durationFrames);
  const { from, to, word } = c.cues;
  // Leaves ten frames before the next scene begins, so two panels never share the screen mid-fade.
  c.lifetime(from("tear"), to("receipts") - 10);

  // ---- step tags --------------------------------------------------------------------------------------
  const steps: Array<[string, string]> = [["STEP 01 / CHUNK", "tear"], ["STEP 02 / EMBED", "vectors"], ["STEP 03 / SEARCH", "query"], ["STEP 04 / STUFF", "stuff"]];
  steps.forEach(([label, beat], i) => {
    const id = `step-${i}`;
    c.add(text(label, { id, x: 120, y: 204, size: 24, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.14 }));
    c.appear(id, from(beat) + 1, 6);
    if (i < steps.length - 1) c.fadeOut(id, from(steps[i + 1][1]) - 1, 5, { easing: "linear" });
  });

  // A few lines of config under each step's words, the terminal-style readout the reference keeps in a corner.
  const readouts: Array<[string, string[]]> = [
    ["tear", ["chunk_size    = 500 tokens", "chunk_overlap = 50 tokens"]],
    ["vectors", ["embed(chunk) -> float[768]", "store(vector, source, text)"]],
    ["query", ["k      = 4", "metric = cosine distance"]],
    ["stuff", ["prompt = system + chunks + question", "model.generate(prompt)"]],
  ];
  readouts.forEach(([beat, lines], i) => {
    const ids = lines.map((line, k) => {
      const id = `ro-${i}-${k}`;
      c.add(text(line, { id, x: 120, y: 820 + k * 34, size: 22, face: "mono", weight: 500, fill: PAL.muted }));
      return id;
    });
    c.appear(ids, from(beat) + 10, 8, { stagger: 6 });
    if (i < readouts.length - 1) c.fadeOut(ids, from(readouts[i + 1][0]) - 1, 5, { easing: "linear" });
  });

  // ---- chunk: a document torn into overlapping pieces -------------------------------------------------
  const PX = 1180;
  const PY = 200;
  const chunkBase = (i: number) => PY + 72 + i * 92 + i * 14;
  c.group("stack", 0, 0, () => {
    c.add(g("page", PX, PY, el("rect", { x: 0, y: 0, width: 440, height: 640, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }) + text("refunds.md", { x: 26, y: 40, size: 22, face: "mono", weight: 500, fill: PAL.muted })));
    const widths = [[330, 290, 318], [300, 326, 270], [322, 280, 300], [288, 330, 308], [316, 296, 262], [330, 304, 286]];
    for (let i = 0; i < 6; i++) {
      const bars = widths[i].map((w, k) => el("rect", { x: 0, y: k * 28, width: w, height: 10, fill: PAL.ink, "fill-opacity": 0.34 })).join("");
      const inner =
        el("rect", { id: `cb-${i}`, x: -16, y: -16, width: 412, height: 98, fill: PAL.surface, stroke: PAL.accent, "stroke-width": 2 }) +
        bars +
        text(`#0${i + 1}`, { id: `cl-${i}`, x: 388, y: 10, size: 18, face: "mono", weight: 700, fill: PAL.accent, anchor: "end" });
      c.add(g(`ck-${i}`, PX + 26, PY + 72 + i * 92, inner));
    }
    // Overlap bands straddle the seam between neighbouring chunks.
    for (let i = 0; i < 5; i++) {
      c.add(el("rect", { id: `ov-${i}`, x: PX + 10, y: chunkBase(i) + 52, width: 420, height: 72, fill: PAL.accent, "fill-opacity": 0.2, stroke: PAL.accent, "stroke-width": 2, "stroke-dasharray": "8 6" }));
    }
    c.add(text("OVERLAP", { id: "ov-label", x: PX + 440, y: chunkBase(0) + 92, size: 20, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.12 }));
  });

  c.lyric({ beat: "tear", rows: ["Step one:", "tear your", "documents", "into *chunks.*"], x: 120, y: 310, size: 104, bounds: LEFT });
  c.lyric({ beat: "overlap", rows: ["Small pieces,", "with a little", "*overlap,*", "so no sentence", "gets cut."], x: 120, y: 290, size: 92, bounds: LEFT });
  c.lyric({ beat: "sizes", rows: ["*Too small,*", "it loses the plot.", "*Too big,*", "the signal drowns."], x: 120, y: 330, size: 84, bounds: LEFT, entry: "drop" });

  const ck = [0, 1, 2, 3, 4, 5].map((i) => `ck-${i}`);
  c.appear(["page", ...ck], from("tear") + 4, 10, { stagger: 0 });
  const split = word("tear", "into");
  c.to("page", "opacity", 0, split + 4, split + 12, { easing: "linear" });
  c.init(ck, { translateX: 0, translateY: 0, rotate: 0 });
  const origin = { x: 200, y: 30 };
  ck.forEach((id, i) => {
    const s = split + i * 3;
    c.to(id, "translateX", i % 2 ? 26 : -10, s, s + 16, { origin });
    c.to(id, "translateY", i * 14, s, s + 16, { origin });
    c.to(id, "rotate", i % 2 ? 2.2 : -1.8, s, s + 16, { origin });
  });
  const borders = [0, 1, 2, 3, 4, 5].map((i) => `cb-${i}`);
  const labels = [0, 1, 2, 3, 4, 5].map((i) => `cl-${i}`);
  c.appear(borders, split + 6, 10, { stagger: 3 });
  c.appear(labels, word("tear", "chunks"), 8, { stagger: 3 });
  const ov = [0, 1, 2, 3, 4].map((i) => `ov-${i}`);
  c.appear(ov, word("overlap", "overlap"), 8, { stagger: 4 });
  c.appear("ov-label", word("overlap", "overlap") + 4, 8);
  c.fadeOut("stack", word("sizes", "Too") - 6, 8, { easing: "linear" });

  // sizes: too small loses the plot, too big drowns the signal.
  const tooSmall = word("sizes", "small");
  const tooBig = word("sizes", "big");
  c.group("small-box", 1040, 230, () => {
    c.add(el("rect", { x: 0, y: 0, width: 360, height: 560, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }));
    c.add(text("TOO SMALL", { x: 24, y: 42, size: 22, face: "mono", weight: 700, fill: PAL.ink, tracking: 0.12 }));
    c.add(text("NO CONTEXT", { x: 24, y: 528, size: 20, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.12 }));
  });
  const scraps = ["the", "30", "of", "days", "within", "a", "refund", "is", "to", "window", "buy", "for"];
  const r = rng(5);
  const chips: string[] = [];
  scraps.forEach((w, i) => {
    const id = `chip-${i}`;
    chips.push(id);
    const cx = 1064 + (i % 3) * 110 + r() * 12;
    const cy = 310 + Math.floor(i / 3) * 104 + r() * 26;
    const cw = w.length * 11 + 26;
    c.add(g(id, cx, cy, el("rect", { x: 0, y: 0, width: cw, height: 38, fill: PAL.canvas, stroke: HAIR2, "stroke-width": 2 }) + text(w, { x: 13, y: 26, size: 19, face: "mono", weight: 500, fill: PAL.muted })));
  });
  c.appear("small-box", tooSmall - 4, 8);
  c.appear(chips, tooSmall, 8, { stagger: 2 });

  c.group("big-box", 1440, 230, () => {
    c.add(el("rect", { x: 0, y: 0, width: 340, height: 560, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }));
    c.add(text("TOO BIG", { x: 24, y: 42, size: 22, face: "mono", weight: 700, fill: PAL.ink, tracking: 0.12 }));
    c.add(text("NOISE", { x: 24, y: 528, size: 20, face: "mono", weight: 700, fill: PAL.muted, tracking: 0.12 }));
    const rr = rng(9);
    let bars = "";
    for (let i = 0; i < 17; i++) {
      if (i === 8) continue;
      bars += el("rect", { x: 24, y: 76 + i * 26, width: 190 + rr() * 120, height: 10, fill: PAL.ink, "fill-opacity": 0.24 });
    }
    c.add(el("g", { id: "noise" }, bars));
    c.add(el("rect", { id: "signal", x: 24, y: 76 + 8 * 26, width: 250, height: 10, fill: PAL.accent }));
  });
  c.appear("big-box", tooBig - 4, 8);
  c.appear("noise", tooBig, 14);
  c.init("signal", { opacity: 0 });
  c.fadeIn("signal", tooBig, 8);
  c.to("signal", "opacity", 0.18, word("sizes", "drowns"), word("sizes", "drowns") + 14, { easing: "linear" });
  c.fadeOut(["small-box", ...chips, "big-box"], to("sizes") - 10, 8, { easing: "linear" });

  // ---- embed: every chunk becomes a point --------------------------------------------------------------
  c.lyric({ beat: "vectors", rows: ["Step two:", "every chunk", "becomes a *vector,*", "a point in space."], x: 120, y: 310, size: 92, bounds: LEFT });
  c.lyric({ beat: "meaning", rows: ["Meaning is", "just *coordinates.*", "Similar ideas", "land *close.*"], x: 120, y: 310, size: 92, bounds: LEFT, entry: "drop" });

  const cardIds: string[] = [];
  const dotIds: string[] = [];
  const cardAt = (i: number) => ({ x: 1040 + (i % 2) * 250, y: 250 + Math.floor(i / 2) * 98 });
  const flyAt = word("vectors", "vector,");
  POINTS.forEach((p, i) => {
    const pos = cardAt(i);
    const id = `card-${i}`;
    cardIds.push(id);
    const inner =
      el("rect", { x: 0, y: 0, width: 220, height: 66, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }) +
      el("rect", { x: 16, y: 20, width: 150, height: 8, fill: PAL.ink, "fill-opacity": 0.34 }) +
      el("rect", { x: 16, y: 38, width: 112, height: 8, fill: PAL.ink, "fill-opacity": 0.34 }) +
      text(`c${String(i + 1).padStart(2, "0")}`, { x: 204, y: 52, size: 15, face: "mono", weight: 500, fill: PAL.muted, anchor: "end" });
    c.add(g(id, pos.x, pos.y, inner));
    const did = `pt-${i}`;
    dotIds.push(did);
  });
  // The plane: axes, hulls, points, query, rings, connectors. Drawn after the cards so dots land on top.
  c.group("plane", 0, 0, () => {
    c.add(el("line", { id: "ax-x", x1: 1040, y1: 820, x2: 1780, y2: 820, ...stroke(HAIR2, 2) }));
    c.add(el("line", { id: "ax-y", x1: 1040, y1: 200, x2: 1040, y2: 820, ...stroke(HAIR2, 2) }));
    c.add(text("DIM 1", { id: "ax-x-l", x: 1780, y: 850, size: 18, face: "mono", weight: 500, fill: PAL.muted, anchor: "end", tracking: 0.1 }));
    c.add(text("DIM 2", { id: "ax-y-l", x: 1064, y: 224, size: 18, face: "mono", weight: 500, fill: PAL.muted, tracking: 0.1 }));
    HULLS.forEach((h, i) => {
      c.add(el("circle", { id: `hull-${i}`, cx: h.cx, cy: h.cy, r: h.r, ...stroke(HAIR2, 2, { "stroke-dasharray": "6 8" }) }));
      c.add(text(h.label, { id: `hull-l-${i}`, x: h.lx, y: h.ly, size: 20, face: "mono", weight: 500, fill: PAL.muted, anchor: ("anchor" in h ? h.anchor : "middle") }));
    });
    POINTS.forEach((p, i) => {
      c.add(g(dotIds[i], p.x, p.y, el("circle", { cx: 0, cy: 0, r: 9, fill: PAL.ink, "fill-opacity": 0.9 })));
    });
  });
  c.add(text("chunk_07 = [ 0.21  -0.64  0.08  0.77 ... ]", { id: "vec", x: 1040, y: 880, size: 22, face: "mono", weight: 500, fill: PAL.muted }));

  c.appear(cardIds, word("vectors", "every"), 8, { stagger: 2 });
  c.appear("vec", word("vectors", "vector,") - 4, 8);
  c.draw(["ax-x", "ax-y"], word("vectors", "point") - 6, word("vectors", "point") + 12);
  c.appear(["ax-x-l", "ax-y-l"], word("vectors", "point") + 6, 8);
  c.init(dotIds, { scale: 0, opacity: 0 });
  POINTS.forEach((p, i) => {
    const pos = cardAt(i);
    const s = flyAt + i * 3;
    const dx = p.x - (pos.x + 110);
    const dy = p.y - (pos.y + 33);
    const o = { x: 110, y: 33 };
    c.to(cardIds[i], "translateX", dx, s, s + 22, { easing: "expoInOut", origin: o });
    c.to(cardIds[i], "translateY", dy, s, s + 22, { easing: "expoInOut", origin: o });
    c.to(cardIds[i], "scale", 0.22, s, s + 22, { easing: "expoInOut", origin: o });
    c.to(cardIds[i], "opacity", 0, s + 14, s + 22, { easing: "linear" });
    c.to(dotIds[i], "scale", 1, s + 16, s + 24, { origin: { x: 0, y: 0 } });
    c.to(dotIds[i], "opacity", 1, s + 16, s + 20, { easing: "linear" });
  });
  c.fadeOut("vec", to("meaning") - 8, 6, { easing: "linear" });

  // meaning: similar ideas cluster; dashed hulls draw around each cluster.
  const meaningAt = word("meaning", "Similar");
  c.draw(["hull-0", "hull-1", "hull-2"], meaningAt, meaningAt + 18, { stagger: 8 });
  c.appear(["hull-l-0", "hull-l-1", "hull-l-2"], meaningAt + 8, 8, { stagger: 8 });

  // ---- search: the question becomes a point, rings find its neighbours ---------------------------------
  c.lyric({ beat: "query", rows: ["Step three:", "your *question*", "becomes a", "point too."], x: 120, y: 310, size: 92, bounds: LEFT });
  c.lyric({ beat: "topk", rows: ["Draw rings", "around it.", "Grab the", "nearest few.", "That's *top k.*"], x: 120, y: 290, size: 88, bounds: LEFT, entry: "drop" });

  const pillW = 440;
  c.add(g("pill", 1040, 180, el("rect", { x: 0, y: 0, width: pillW, height: 54, fill: PAL.surface, stroke: PAL.accent, "stroke-width": 2 }) + text("what is the refund window?", { x: 20, y: 35, size: 22, face: "mono", weight: 500, fill: PAL.ink })));
  c.add(g("q-dot", QUERY.x, QUERY.y, el("circle", { cx: 0, cy: 0, r: 13, fill: PAL.accent }) + el("circle", { cx: 0, cy: 0, r: 13, ...stroke(PAL.accent, 2) })));
  c.add(g("q-pulse", QUERY.x, QUERY.y, el("circle", { cx: 0, cy: 0, r: 13, ...stroke(PAL.accent, 3) })));
  c.add(text("QUERY", { id: "q-label", x: QUERY.x + 24, y: QUERY.y + 38, size: 20, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.12 }));
  const qWord = word("query", "question");
  const qPoint = word("query", "point");
  c.appear("pill", qWord - 4, 8);
  const pillOrigin = { x: pillW / 2, y: 27 };
  c.to("pill", "translateX", QUERY.x - (1040 + pillW / 2), qPoint, qPoint + 18, { easing: "expoInOut", origin: pillOrigin });
  c.to("pill", "translateY", QUERY.y - (180 + 27), qPoint, qPoint + 18, { easing: "expoInOut", origin: pillOrigin });
  c.to("pill", "scale", 0.06, qPoint, qPoint + 18, { easing: "expoInOut", origin: pillOrigin });
  c.to("pill", "opacity", 0, qPoint + 12, qPoint + 18, { easing: "linear" });
  c.init(["q-dot", "q-pulse"], { scale: 0, opacity: 0 });
  c.to("q-dot", "scale", 1, qPoint + 16, qPoint + 26, { origin: { x: 0, y: 0 } });
  c.to("q-dot", "opacity", 1, qPoint + 16, qPoint + 20, { easing: "linear" });
  c.appear("q-label", qPoint + 22, 8);
  c.to("q-pulse", "opacity", 1, qPoint + 18, qPoint + 19, { easing: "linear" });
  c.to("q-pulse", "scale", 3.4, qPoint + 18, qPoint + 40, { easing: "expoOut", origin: { x: 0, y: 0 } });
  c.to("q-pulse", "opacity", 0, qPoint + 20, qPoint + 40, { easing: "linear" });

  // rings and the nearest four
  const ringR = [70, 112, 160];
  const ringIds = ringR.map((_, i) => `ring-${i}`);
  ringR.forEach((rad, i) => c.add(el("circle", { id: ringIds[i], cx: QUERY.x, cy: QUERY.y, r: rad, ...stroke(PAL.accent, 2, { "stroke-opacity": 0.7 }) })));
  const ringAt = word("topk", "rings");
  c.draw(ringIds, ringAt, ringAt + 18, { stagger: 7 });
  const nearAt = word("topk", "nearest");
  const nearest = POINTS.map((p, i) => ({ p, i })).filter(({ p }) => p.cluster === "A");
  const hotIds: string[] = [];
  const lineIds: string[] = [];
  nearest.forEach(({ p, i }) => {
    const hid = `hot-${i}`;
    hotIds.push(hid);
    c.add(g(hid, p.x, p.y, el("circle", { cx: 0, cy: 0, r: 15, fill: PAL.accent })));
    const lid = `nn-${i}`;
    lineIds.push(lid);
    c.add(el("line", { id: lid, x1: QUERY.x, y1: QUERY.y, x2: p.x, y2: p.y, ...stroke(PAL.accent, 2) }));
  });
  c.init(hotIds, { scale: 0.4, opacity: 0 });
  c.to(hotIds, "scale", 1, nearAt, nearAt + 10, { stagger: 3, origin: { x: 0, y: 0 } });
  c.to(hotIds, "opacity", 1, nearAt, nearAt + 6, { stagger: 3, easing: "linear" });
  c.draw(lineIds, word("topk", "few"), word("topk", "few") + 14, { stagger: 3 });
  const farIds = POINTS.map((p, i) => ({ p, i })).filter(({ p }) => p.cluster !== "A").map(({ i }) => dotIds[i]);
  c.to([...farIds, "hull-1", "hull-2", "hull-l-1", "hull-l-2"], "opacity", 0.22, nearAt, nearAt + 14, { easing: "linear" });
  c.add(text("TOP-K", { id: "topk-label", x: QUERY.x + 122, y: QUERY.y - 122, size: 22, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.14 }));
  c.appear("topk-label", word("topk", "top"), 8);

  // ---- stuff: the nearest chunks fly into the prompt window ---------------------------------------------
  c.lyric({ beat: "stuff", rows: ["Step four:", "*stuff* those", "chunks into", "my prompt."], x: 120, y: 310, size: 92, bounds: LEFT });
  c.lyric({ beat: "receipts", rows: ["Now I've got", "*receipts*", "before I speak."], x: 120, y: 310, size: 92, bounds: LEFT, entry: "drop" });

  const stuffAt = word("stuff", "stuff");
  const snippets = ["within 30 days of purchase", "to the original payment method", "items must be unused", "sale items are final"];
  const PP = { x: 980, y: 180, w: 820 };
  c.group("prompt", PP.x, PP.y, () => {
    c.add(el("rect", { x: 0, y: 0, width: PP.w, height: 620, fill: PAL.surface, stroke: HAIR2, "stroke-width": 2 }));
    c.add(text("PROMPT", { x: 26, y: 42, size: 22, face: "mono", weight: 700, fill: PAL.ink, tracking: 0.14 }));
    c.add(text("CONTEXT WINDOW", { x: PP.w - 290, y: 42, size: 18, face: "mono", weight: 500, fill: PAL.muted, anchor: "end", tracking: 0.1 }));
    c.add(el("rect", { x: PP.w - 270, y: 30, width: 244, height: 10, fill: PAL.ink, "fill-opacity": 0.1 }));
    c.add(el("rect", { id: "ctx-bar", x: PP.w - 270, y: 30, width: 244, height: 10, fill: PAL.accent }));
    c.add(el("line", { x1: 0, y1: 64, x2: PP.w, y2: 64, stroke: HAIR, "stroke-width": 2 }));
    c.add(text("SYSTEM  answer only from the context below.", { x: 26, y: 100, size: 20, face: "mono", weight: 500, fill: PAL.muted }));
    for (let j = 0; j < 4; j++) c.add(el("rect", { x: 20, y: 122 + j * 98, width: PP.w - 40, height: 86, fill: "none", stroke: HAIR, "stroke-width": 2, "stroke-dasharray": "6 8" }));
    c.add(text("Q: what is the refund window?", { x: 26, y: 122 + 4 * 98 + 58, size: 26, face: "mono", weight: 500, fill: PAL.ink }));
  });
  c.appear("prompt", stuffAt - 4, 10);
  c.to("plane", "opacity", 0.14, stuffAt - 4, stuffAt + 10, { easing: "linear" });
  c.init("ctx-bar", { scaleX: 0 });

  const slotFrames = stuffFrames(timing);
  nearest.forEach(({ p }, j) => {
    const id = `rc-${j}`;
    const sx = PP.x + 20;
    const sy = PP.y + 122 + j * 98;
    const slotW = PP.w - 40;
    const inner =
      el("rect", { x: 0, y: 0, width: slotW, height: 86, fill: PAL.canvas, stroke: HAIR2, "stroke-width": 2 }) +
      text("refunds.md", { x: 20, y: 30, size: 18, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.06 }) +
      text(snippets[j], { x: 20, y: 64, size: 26, face: "mono", weight: 500, fill: PAL.ink }) +
      g(`src-${j}`, slotW - 130, 22, el("path", { d: "M0 18 L9 27 L26 6", ...stroke(PAL.accent, 4, { "stroke-linecap": "round", "stroke-linejoin": "round" }) }) + text("SRC", { x: 40, y: 26, size: 20, face: "mono", weight: 700, fill: PAL.accent, tracking: 0.1 }));
    c.add(g(id, sx, sy, inner));
    const f = slotFrames[j];
    const o = { x: slotW / 2, y: 43 };
    c.init(id, { opacity: 0, scale: 0.12, translateX: p.x - (sx + slotW / 2), translateY: p.y - (sy + 43) });
    c.to(id, "opacity", 1, f, f + 6, { easing: "linear" });
    c.to(id, "scale", 1, f, f + 18, { origin: o });
    c.to(id, "translateX", 0, f, f + 18, { origin: o });
    c.to(id, "translateY", 0, f, f + 18, { origin: o });
    c.to(hotIds[j], "opacity", 0, f, f + 8, { easing: "linear" });
    c.to(lineIds[j], "opacity", 0, f, f + 8, { easing: "linear" });
    // The receipt: a check and SRC tag appear on each chunk as "receipts" is said, in order.
    c.init(`src-${j}`, { opacity: 0 });
    c.fadeIn(`src-${j}`, word("receipts", "receipts") + j * 5, 8);
  });
  c.to("ctx-bar", "scaleX", 0.147, slotFrames[0], slotFrames[3] + 18, { origin: { x: PP.w - 270, y: 0 } });
  return c;
}
