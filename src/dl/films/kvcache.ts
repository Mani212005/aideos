import type { Film } from "../schema";

/**
 * KV caching, as one canvas.
 *
 * Pure data — the only import is a type. The storyboard generator and the
 * validator load this file in plain Node with no fonts, no React and no
 * browser, so a single runtime import here breaks both of them.
 *
 * The canvas is laid out once, left to right, and every edge points forward.
 * That is not decoration: the camera reads the graph in the same direction the
 * argument does, so a pan is always "and then", never "meanwhile".
 */
export const kvcacheFilm: Film = {
  id: "kvcache",
  title: "Why your LLM remembers — the KV cache",
  fps: 30,
  accent: "#635BFF",
  chapters: ["tokens", "attention", "the cache", "the bill"],

  canvas: {
    nodes: [
      // Deliberately not a wide, flat row. A 4:1 canvas fits a 16:9 frame and
      // strands a 9:16 one in dead space, and since both formats solve their
      // framing from this same layout, the canvas has to be shaped for the
      // narrower of the two.
      { id: "tokens", label: "tokens", sub: "your prompt, as ids", x: 40, y: 300, w: 200, h: 64 },
      { id: "attend", label: "attention", sub: "every token looks back", x: 340, y: 60, w: 200, h: 64 },
      { id: "kv", label: "keys & values", sub: "what each token exposes", x: 340, y: 540, w: 200, h: 64 },
      { id: "prefill", label: "prefill", sub: "the prompt, all at once", x: 640, y: 60, w: 190, h: 64 },
      { id: "decode", label: "decode", sub: "one token at a time", x: 640, y: 540, w: 190, h: 64 },
      { id: "cache", label: "the kv cache", sub: "kept, not recomputed", x: 930, y: 300, w: 200, h: 64 },
      { id: "cost", label: "the bill", sub: "memory bought with time", x: 1220, y: 300, w: 190, h: 76 },
    ],
    edges: [
      { from: "tokens", to: "attend", dashed: false },
      { from: "tokens", to: "kv", dashed: false },
      { from: "attend", to: "prefill", dashed: false },
      { from: "attend", to: "decode", dashed: false },
      { from: "kv", to: "prefill", dashed: false },
      { from: "kv", to: "decode", dashed: false },
      { from: "prefill", to: "cache", dashed: false },
      // Dashed reads as reused everywhere in the system — this is the only edge
      // in the film that costs nothing to travel, which is the whole point.
      { from: "decode", to: "cache", dashed: true },
      { from: "cache", to: "cost", dashed: false },
    ],
  },

  shots: [
    {
      id: "open",
      dur: 8,
      look: "tokens",
      move: "cut",
      stage: "frame",
      zoom: 0.5,
      drift: true,
      blocks: [
        {
          c: "TextReveal",
          size: "display",
          text: "A model never re-reads your prompt.",
          accentWord: "prompt",
        },
        {
          c: "Body",
          text: "It would have to, thousands of times per answer. Something has to remember for it — and that something has a price.",
        },
      ],
    },
    {
      id: "strip",
      dur: 14,
      look: "tokens",
      move: "zoom-in",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        { c: "Kicker", text: "step 01 · tokenisation" },
        {
          c: "TextReveal",
          size: "headline",
          text: "Your sentence arrives as ids.",
          accentWord: "ids",
        },
        {
          c: "TokenStrip",
          tokens: ["Write", "a", "hai", "ku", "about", "cach", "ing"],
          lit: [],
          caption: "7 tokens · not 5 words",
        },
      ],
    },
    {
      id: "spine-1",
      dur: 6,
      look: ["tokens", "attend", "kv"],
      move: "zoom-out",
      stage: "none",
      zoom: 1,
      drift: false,
      blocks: [],
    },

    /* ---------------------------------------------------------------- 02 */
    {
      id: "attention",
      dur: 18,
      look: "attend",
      move: "cut",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        { c: "Kicker", text: "step 02 · attention" },
        {
          c: "TextReveal",
          size: "headline",
          text: "Every new token looks back at every old one.",
          accentWord: "back",
        },
        {
          c: "AttentionArcs",
          tokens: ["Write", "a", "hai", "ku", "about", "cach"],
          focus: 5,
          links: [4, 2, 0],
          note: "strongest link drawn in accent",
        },
      ],
    },
    {
      id: "matrix",
      dur: 16,
      look: "attend",
      move: "hold",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        {
          c: "TextReveal",
          size: "subhead",
          text: "Those glances are a grid.",
          accentWord: "grid",
        },
        { c: "Math", text: "softmax(*q* · *k*ᵀ / √d) · v" },
        {
          c: "MatrixGrid",
          values: [
            [0.62, 0.11, 0.09, 0.18],
            [0.08, 0.71, 0.13, 0.08],
            [0.21, 0.14, 0.47, 0.18],
            [0.12, 0.09, 0.16, 0.63],
          ],
          rowLabel: "row = query",
          colLabel: "col = key",
          valueLabel: "value = weight",
          sweep: "row",
        },
      ],
    },
    {
      id: "beat-1",
      dur: 6,
      look: "attend",
      move: "hold",
      stage: "frame",
      zoom: 0.5,
      drift: true,
      blocks: [
        {
          c: "TextReveal",
          size: "display",
          text: "It is all weighted sums.",
          accentWord: "weighted",
        },
      ],
    },
    {
      id: "kvsplit",
      dur: 16,
      look: "kv",
      move: "pan",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        { c: "Kicker", text: "the two things worth keeping" },
        {
          c: "TextReveal",
          size: "headline",
          text: "Each token hands out a key and a value.",
          accentWord: "key",
        },
        {
          c: "Body",
          text: "The key is how it answers being looked up. The value is what it says when it is. Neither depends on anything that comes after it — which is the whole reason this works.",
        },
      ],
    },
    {
      id: "spine-2",
      dur: 6,
      look: ["attend", "kv", "prefill", "decode"],
      move: "zoom-out",
      stage: "none",
      zoom: 1,
      drift: false,
      blocks: [],
    },

    /* ---------------------------------------------------------------- 03 */
    {
      id: "prefill",
      dur: 16,
      look: "prefill",
      move: "cut",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        { c: "Kicker", text: "step 03 · prefill" },
        {
          c: "TextReveal",
          size: "headline",
          text: "The whole prompt goes through once.",
          accentWord: "once",
        },
        { c: "LayerStack", count: 32, bottomLabel: "layer 01", topLabel: "layer 32" },
      ],
    },
    {
      id: "cache",
      dur: 18,
      look: "cache",
      move: "pan",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        {
          c: "TextReveal",
          size: "headline",
          text: "Keep the grid. That is the cache.",
          accentWord: "cache",
        },
        {
          c: "MatrixGrid",
          values: [
            [0.62, 0.11, 0.09, 0.18],
            [0.08, 0.71, 0.13, 0.08],
            [0.21, 0.14, 0.47, 0.18],
            [0.12, 0.09, 0.16, 0.63],
            [0.09, 0.12, 0.11, 0.68],
          ],
          rowLabel: "rows already kept",
          colLabel: "one new row",
          valueLabel: "nothing recomputed",
          sweep: "row",
        },
      ],
    },
    {
      id: "beat-2",
      dur: 6,
      look: "cache",
      move: "hold",
      stage: "frame",
      zoom: 0.5,
      drift: true,
      blocks: [
        {
          c: "TextReveal",
          size: "display",
          text: "Read it again, or store it. Pick one.",
          accentWord: "store",
        },
      ],
    },
    {
      id: "decode",
      dur: 18,
      look: "decode",
      move: "pan",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        { c: "Kicker", text: "step 04 · decode" },
        {
          c: "TextReveal",
          size: "headline",
          text: "Now each word costs one row.",
          accentWord: "one",
        },
        {
          c: "Distribution",
          prompt: "Write a haiku about cach___",
          items: [
            { label: "ing", p: 0.78 },
            { label: "es", p: 0.11 },
            { label: "e", p: 0.06 },
            { label: "ed", p: 0.03 },
          ],
          note: "p(next token) · softmax over vocab",
        },
      ],
    },
    {
      id: "spine-3",
      dur: 6,
      look: ["prefill", "decode", "cache"],
      move: "zoom-out",
      stage: "none",
      zoom: 1,
      drift: false,
      blocks: [],
    },

    /* ---------------------------------------------------------------- 04 */
    {
      id: "cost",
      dur: 16,
      look: "cost",
      move: "cut",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        { c: "Kicker", text: "step 05 · what it costs" },
        {
          c: "TextReveal",
          size: "headline",
          text: "You bought speed with memory.",
          accentWord: "memory",
        },
        { c: "ScaleBar", ticks: ["1k", "8k", "32k", "128k"], value: 0.78, label: "context" },
      ],
    },
    {
      id: "growth",
      dur: 14,
      look: "cost",
      move: "hold",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        {
          c: "TextReveal",
          size: "subhead",
          text: "And it grows linearly, forever.",
          accentWord: "linearly",
        },
        {
          c: "Plot",
          points: [
            [0, 0],
            [0.25, 0.25],
            [0.5, 0.5],
            [0.75, 0.75],
            [1, 1],
          ],
          xLabel: "tokens",
          yLabel: "GB",
          endLabel: "128k",
        },
      ],
    },
    {
      id: "stat",
      dur: 12,
      look: "cost",
      move: "hold",
      stage: "anchor",
      zoom: 0.6,
      drift: false,
      blocks: [
        { c: "StatCounter", to: 128000, label: "tokens held in the cache", format: "plain" },
        {
          c: "Body",
          text: "At that length the cache for a 70B model runs to tens of gigabytes — bigger than a lot of the weights it is reading from.",
        },
      ],
    },
    {
      id: "payoff",
      dur: 12,
      look: "all",
      move: "zoom-out",
      stage: "none",
      zoom: 1,
      drift: true,
      blocks: [],
    },
    {
      id: "close",
      dur: 8,
      look: "all",
      move: "hold",
      stage: "frame",
      zoom: 1,
      drift: true,
      blocks: [
        {
          c: "TextReveal",
          size: "display",
          text: "Prefill once. Cache. Then decode forever.",
          accentWord: "Cache",
        },
        { c: "IconLabel", text: "keys · values · prefill · decode" },
      ],
    },
  ],
};
