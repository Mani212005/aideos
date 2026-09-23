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

// Reads the first number in a piece of narration together with the unit that follows it.
export function readQuantity(text: string): NarrationQuantity | null {
  const multiplier = text.match(/\b(two|three|four|five|ten|twenty|fifty|hundred|\d+(?:\.\d+)?)\s*(?:to\s+\w+\s*)?times\b/i);
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, ten: 10, twenty: 20, fifty: 50, hundred: 100 };
  if (multiplier) {
    const raw = multiplier[1].toLowerCase();
    const value = words[raw] ?? Number(raw);
    if (Number.isFinite(value)) return { value, suffix: "x", label: "Throughput gain" };
  }

  const scaled = text.match(/\b(\d+(?:\.\d+)?|seventy|eighty|ninety|sixty|fifty|forty|thirty|twenty|ten)\s+(billion|million|trillion|gigabytes|percent)\b/i);
  if (scaled) {
    const raw = scaled[1].toLowerCase();
    const numberWords: Record<string, number> = {
      ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    };
    const value = numberWords[raw] ?? Number(raw);
    const unit = scaled[2].toLowerCase();
    if (Number.isFinite(value)) {
      const suffix = unit === "percent" ? "%" : unit === "gigabytes" ? " GB" : unit.charAt(0).toUpperCase();
      return { value, suffix, label: unit === "gigabytes" ? "Moved per token" : "Parameters" };
    }
  }
  return null;
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
