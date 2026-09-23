/**
 * File Description: The single definition of which narration grounds which shot-level device.
 * A device asserts data on screen, so it may only appear where the narration carries that data.
 * Both the Jev heuristic fallback (backend/jev.ts) and the design stage's block authoring
 * (backend/pipeline/design.ts) read these cues, so a visual the heuristic picks is always one the
 * design stage can ground, and a model-picked visual the narration does not support is refused.
 */

import type { ShotVisual } from "./jev";

/** A number read out of narration, with the unit suffix and label a StatCounter shows for it. */
export interface NarrationQuantity {
  value: number;
  suffix?: string;
  label: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

// A number as spoken or written: "22", "1,500", "3.5", "twenty two", "twenty-two", "a hundred".
const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?|(?:a\s+)?(?:${Object.keys(NUMBER_WORDS).join("|")})(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)`;

/** Units a StatCounter can show, with the suffix drawn after the number and a fallback label. */
const UNITS: { pattern: string; suffix: string; label: string; noun: boolean }[] = [
  { pattern: "percent|per cent|%", suffix: "%", label: "Share", noun: false },
  { pattern: "(?:to\\s+\\w+\\s+)?times|x", suffix: "x", label: "Speedup", noun: false },
  { pattern: "trillion", suffix: "T", label: "Total", noun: false },
  { pattern: "billion", suffix: "B", label: "Total", noun: false },
  { pattern: "million", suffix: "M", label: "Total", noun: false },
  { pattern: "gigabytes|GB", suffix: " GB", label: "Gigabytes", noun: true },
  { pattern: "terabytes|TB", suffix: " TB", label: "Terabytes", noun: true },
  { pattern: "watts", suffix: " W", label: "Watts", noun: true },
  { pattern: "years", suffix: "", label: "Years", noun: true },
  { pattern: "milliseconds|ms", suffix: " ms", label: "Milliseconds", noun: true },
  { pattern: "seconds", suffix: " s", label: "Seconds", noun: true },
  { pattern: "tokens", suffix: "", label: "Tokens", noun: true },
  { pattern: "parameters", suffix: "", label: "Parameters", noun: true },
];

// Words that end a descriptive phrase: verbs, conjunctions and other glue.
const PHRASE_STOP = new Set([
  "is", "are", "was", "were", "be", "been", "has", "have", "had", "will", "would", "can", "could",
  "and", "or", "but", "that", "which", "who", "to", "from", "than", "then", "so", "because", "while",
  "it", "its", "they", "we", "you", "in", "on", "at", "by", "for", "with", "into", "every", "each",
  "per", "as", "like", "across", "through", "out", "up", "down", "ago", "later", "away", "back", "off", "over", "again", "now", "ahead", "old",
]);
const PHRASE_SKIP = new Set(["of", "the", "a", "an", "its", "their", "our", "your", "this", "that"]);

// Converts a spoken or written number to its value, or NaN when it is not one.
function parseNumber(raw: string): number {
  const clean = raw.toLowerCase().replace(/^a\s+/, "").trim();
  if (/^\d/.test(clean)) return Number(clean.replace(/,/g, ""));
  const [tens, ones] = clean.split(/[\s-]+/);
  const base = NUMBER_WORDS[tens];
  if (base === undefined) return NaN;
  return ones ? base + (NUMBER_WORDS[ones] ?? NaN) : base;
}

// Builds a short title-case label from the words right after a quantity ("of the signal is lost" -> "Signal").
function labelFrom(rest: string): string | null {
  const words = rest.replace(/[^A-Za-z\s-]/g, " ").split(/\s+/).filter(Boolean);
  const picked: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (picked.length === 0 && PHRASE_SKIP.has(lower)) continue;
    if (PHRASE_STOP.has(lower) || PHRASE_SKIP.has(lower) || picked.length === 3) break;
    picked.push(lower);
  }
  if (picked.length === 0) return null;
  const phrase = picked.join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

// Builds a label from the last words of the clause before a quantity ("cuts latency by 40%" -> "Cuts latency").
function labelBefore(before: string): string | null {
  const clause = before.split(/[.,;:!?]/).pop() ?? "";
  const words = clause.replace(/[^A-Za-z\s-]/g, " ").split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
  while (words.length && (PHRASE_STOP.has(words[words.length - 1]) || PHRASE_SKIP.has(words[words.length - 1]) || ["about", "only", "just", "nearly", "almost", "roughly"].includes(words[words.length - 1]))) words.pop();
  const picked = words.slice(-2).filter((w) => !PHRASE_SKIP.has(w));
  if (picked.length === 0) return null;
  const phrase = picked.join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

// Reads the first number in a piece of narration together with its unit and what it measures.
// Only a number with a unit counts: a bare number (often a year) is not a statistic.
export function readQuantity(text: string): NarrationQuantity | null {
  let best: { index: number; quantity: NarrationQuantity } | null = null;
  for (const unit of UNITS) {
    const re = new RegExp(`(?:^|[^\\w.])${NUMBER}\\s*(${unit.pattern})(?![a-z0-9])`, "i");
    const m = re.exec(text);
    if (!m) continue;
    // A range ("two to three times") shows its upper end.
    const range = new RegExp(`\\bto\\s+${NUMBER}\\s+times`, "i").exec(m[0]);
    const value = parseNumber(range ? range[1] : m[1]);
    if (!Number.isFinite(value)) continue;
    if (best && best.index <= m.index) continue;
    const rest = text.slice(m.index + m[0].length);
    // A scale word is usually followed by the thing counted ("70 billion parameters").
    // A bare ratio or share says what it measures just before the number ("cuts latency by 40%").
    const label = labelFrom(rest) ?? (unit.noun ? null : labelBefore(text.slice(0, m.index + 1))) ?? unit.label;
    best = { index: m.index, quantity: { value, ...(unit.suffix ? { suffix: unit.suffix } : {}), label } };
  }
  return best?.quantity ?? null;
}

/** Narration cues that ground each device other than StatCounter, which is grounded by readQuantity. */
const NARRATION_CUES: Record<Exclude<ShotVisual, "Text" | "StatCounter">, RegExp> = {
  TokenStrip: /\b(in parallel|at once|all five|batch of them|single forward pass|tokens?|sequence|stream)\b/,
  Plot: /\b(scales?|scaling|grows?|throughput|linear|quadratic|loss|accuracy|curve)\b/,
  MatrixGrid: /\b(matrix|weights?|tensor|grid|attention map|embedding space|heat\s*map|table)\b/,
  Distribution: /\b(distribution|probability|proportions?|breakdown|fraction|shares?|split)\b/,
  LayerStack: /\b(layers?|stack|tier|hierarchy|pipeline|stages?|deep network|blocks?)\b/,
  ScaleBar: /\b(threshold|trade-off|tradeoff|spectrum|slider|range|bounds?|limits?|temperature)\b/,
};

// Reports whether the narration carries the data a shot visual would put on screen.
export function narrationSupportsVisual(visual: ShotVisual, narration: string): boolean {
  if (visual === "Text") return true;
  if (visual === "StatCounter") return readQuantity(narration) !== null;
  return NARRATION_CUES[visual].test(narration.toLowerCase());
}
