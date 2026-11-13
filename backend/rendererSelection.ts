/**
 * File Description: The renderer flag. Remotion stays the default; `--renderer native` (or `AIDEOS_RENDERER=native`) asks for the native renderer, which is used only when it can draw the film in that format and its binary is built. Otherwise the job falls back to Remotion and says why, so asking for native never leaves a film unrendered.
 * Inputs and outputs: the requested renderer name, a film and a format, and factories for both renderers -> the chosen Renderer, its name and the fallback reason.
 * Used by: scripts/render_active.ts (`aideos render`, `aideos reel`), backend/rendererSelection.test.ts.
 */

import type { Film } from "../src/dl/schema";
import { nativeSupport, type NativeFormat } from "./renderIr/emit";
import { nativeBinaryProblem } from "./nativeRenderer";
import type { Renderer } from "./renderJob";

export type RendererName = "remotion" | "native";

/** Reads the requested renderer from a `--renderer X` argument or `AIDEOS_RENDERER`; remotion by default. */
export function requestedRenderer(argv: string[], env: NodeJS.ProcessEnv = process.env): { name: RendererName; rest: string[] } {
  const rest = [...argv];
  let raw = env.AIDEOS_RENDERER?.trim() || "remotion";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--renderer" || arg.startsWith("--renderer=")) {
      const value = arg === "--renderer" ? rest[i + 1] : arg.slice("--renderer=".length);
      if (value === undefined) throw new Error("--renderer needs a value: remotion or native");
      raw = value;
      rest.splice(i, arg === "--renderer" ? 2 : 1);
      i--;
    }
  }
  if (raw !== "remotion" && raw !== "native") throw new Error(`Unknown renderer "${raw}": use remotion or native`);
  return { name: raw, rest };
}

/** Picks the renderer for one film and format, falling back to Remotion when native cannot draw it. */
export function selectRenderer(
  film: Film,
  format: NativeFormat,
  requested: RendererName,
  factories: { remotion: () => Renderer; native: () => Renderer },
  checks: { binaryProblem?: () => string | null } = {},
): { name: RendererName; renderer: Renderer; fallbackReason?: string } {
  if (requested === "remotion") return { name: "remotion", renderer: factories.remotion() };
  const reasons = nativeSupport(film, format);
  const binary = (checks.binaryProblem ?? nativeBinaryProblem)();
  if (binary) reasons.push(binary);
  if (reasons.length) return { name: "remotion", renderer: factories.remotion(), fallbackReason: reasons.join("; ") };
  return { name: "native", renderer: factories.native() };
}
