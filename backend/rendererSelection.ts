/**
 * File Description: The renderer choice for every render job. By default (`auto`) the native renderer draws every film its emitter supports in that format, and Remotion renders everything else exactly as before, with every refusal reason logged. `AIDEOS_RENDERER=remotion` (or `--renderer remotion`) is the kill switch that keeps every film on Remotion; `AIDEOS_RENDERER=native` requires native and fails a film it cannot draw. A native failure on a film native accepted is an error, never a fallback.
 * Inputs and outputs: the requested mode, a film and a format, and factories for both renderers -> the chosen Renderer, its name and the refusal reasons (or a Renderer that makes that choice when the job prepares).
 * Used by: backend/pipeline/run.ts (render stage), backend/exportJobs.ts (studio Export), backend/geminiReview/render.ts (review and all-check renders), scripts/render_active.ts (`aideos render`, `aideos reel`), backend/rendererSelection.test.ts.
 */

import type { Film } from "../src/dl/schema";
import { nativeSupport, type NativeFormat } from "./renderIr/emit";
import { nativeBinaryProblem } from "./nativeRenderer";
import type { Renderer, RenderRequest } from "./renderJob";

export type RendererName = "remotion" | "native";
/** `auto` picks native when it can draw the film, `remotion` is the kill switch, `native` requires native. */
export type RendererMode = "auto" | RendererName;

const MODES: readonly RendererMode[] = ["auto", "remotion", "native"];

/** Validates a mode name; an empty or missing value is `auto`. */
export function parseRendererMode(raw: string | undefined): RendererMode {
  const value = raw?.trim() || "auto";
  if (!(MODES as readonly string[]).includes(value)) throw new Error(`Unknown renderer "${value}": use auto, remotion or native`);
  return value as RendererMode;
}

/** Reads the renderer mode from `AIDEOS_RENDERER`; `auto` when unset. */
export function rendererModeFromEnv(env: NodeJS.ProcessEnv = process.env): RendererMode {
  return parseRendererMode(env.AIDEOS_RENDERER);
}

/** Reads the requested mode from a `--renderer X` argument or `AIDEOS_RENDERER` (the argument wins); `auto` by default. */
export function requestedRenderer(argv: string[], env: NodeJS.ProcessEnv = process.env): { name: RendererMode; rest: string[] } {
  const rest = [...argv];
  let raw = env.AIDEOS_RENDERER;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--renderer" || arg.startsWith("--renderer=")) {
      const value = arg === "--renderer" ? rest[i + 1] : arg.slice("--renderer=".length);
      if (value === undefined) throw new Error("--renderer needs a value: auto, remotion or native");
      raw = value;
      rest.splice(i, arg === "--renderer" ? 2 : 1);
      i--;
    }
  }
  return { name: parseRendererMode(raw), rest };
}

/** The outcome of a choice: which renderer draws the film and, when Remotion does in `auto`, every reason native could not. */
export interface RendererChoice {
  name: RendererName;
  renderer: Renderer;
  fallbackReason?: string;
}

/** Picks the renderer for one film and format. Only the chosen factory runs. */
export function selectRenderer(
  film: Film,
  format: NativeFormat,
  requested: RendererMode,
  factories: { remotion: () => Renderer; native: () => Renderer },
  checks: { binaryProblem?: () => string | null } = {},
): RendererChoice {
  if (requested === "remotion") return { name: "remotion", renderer: factories.remotion() };
  const reasons = nativeSupport(film, format);
  const binary = (checks.binaryProblem ?? nativeBinaryProblem)();
  if (binary) reasons.push(binary);
  if (reasons.length === 0) return { name: "native", renderer: factories.native() };
  if (requested === "native") {
    throw new Error(`AIDEOS_RENDERER=native: the native renderer cannot render "${film.id}" (${format}): ${reasons.join("; ")}`);
  }
  return { name: "remotion", renderer: factories.remotion(), fallbackReason: reasons.join("; ") };
}

/** One line that says which renderer draws a film and why, for the caller's log. */
export function describeChoice(choice: RendererChoice, film: Film, format: NativeFormat): string {
  if (choice.name === "native") return `${format}: native renderer draws "${film.id}"`;
  return choice.fallbackReason
    ? `${format}: Remotion renders "${film.id}"; the native renderer cannot: ${choice.fallbackReason}`
    : `${format}: Remotion renders "${film.id}" (AIDEOS_RENDERER=remotion)`;
}

/**
 * A Renderer that makes the choice when the job prepares, so it sees the film the job actually renders (after the
 * studio's `prepareFilm`), then hands every step to the chosen renderer unchanged. Its `name` and
 * `profileSettingsApplied` are the chosen renderer's, so the job's sidecar records what really drew the film.
 */
export function createSelectedRenderer(options: {
  mode: RendererMode;
  remotion: () => Renderer;
  native: () => Renderer;
  /** Receives the choice before anything renders. */
  onChoice?: (choice: RendererChoice, message: string) => void;
  binaryProblem?: () => string | null;
}): Renderer {
  let chosen: Renderer | undefined;
  /** The chosen renderer, or an error when a step runs before `prepare`. */
  const active = (): Renderer => {
    if (!chosen) throw new Error("the renderer was used before the job prepared it");
    return chosen;
  };
  return {
    get name() {
      return chosen?.name;
    },
    get profileSettingsApplied() {
      return chosen?.profileSettingsApplied;
    },
    /** Chooses for this request's film and format, then prepares the chosen renderer. */
    async prepare(request: RenderRequest, context) {
      const choice = selectRenderer(request.film, request.format, options.mode, options, { binaryProblem: options.binaryProblem });
      chosen = choice.renderer;
      options.onChoice?.(choice, describeChoice(choice, request.film, request.format));
      await chosen.prepare?.(request, context);
    },
    /** Delegates to the chosen renderer. */
    checkDiskBudget(request, context) {
      return active().checkDiskBudget(request, context);
    },
    /** Delegates to the chosen renderer; a native failure stays a failure. */
    render(request, context) {
      return active().render(request, context);
    },
    /** Delegates to the chosen renderer when one was chosen. */
    async cleanup() {
      await chosen?.cleanup?.();
    },
  };
}
