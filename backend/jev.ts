/**
 * File Description: TypeSafe Jev decision model client for screenplay visual selection.
 * Implements CHOICE over the 7 animated primitives and shot-level visual strategies, each with
 * confidence gating, safe fallback, and fast deterministic heuristic fallback over one shared
 * decision client. The prefetch functions batch every beat of a film into one request (split only
 * past MAX_BATCH_QUESTIONS), so a build costs one round-trip instead of one per beat.
 */

import { narrationSupportsVisual } from "./shotVisualCues";

/** The 7 animated primitives in the design system closed set. */
export const ANIMATED_PRIMITIVES = [
  "TextReveal",
  "StatCounter",
  "CodeBlock",
  "Card",
  "Divider",
  "IconLabel",
  "ProgressBar",
] as const;

export type AnimatedPrimitive = (typeof ANIMATED_PRIMITIVES)[number];

/** Safe generic primitives that can be rendered without specialized numeric or syntax structures. */
export const SAFE_GENERIC_PRIMITIVES: readonly AnimatedPrimitive[] = [
  "TextReveal",
  "Card",
] as const;

/** Complex primitives requiring higher confidence because they demand specialized data shapes. */
export const COMPLEX_PRIMITIVES: readonly AnimatedPrimitive[] = [
  "StatCounter",
  "CodeBlock",
  "ProgressBar",
  "Divider",
  "IconLabel",
] as const;

/** Default confidence threshold required to accept a complex primitive choice from Jev. */
export const DEFAULT_COMPLEX_CONFIDENCE_THRESHOLD = 0.65;

/** Overall minimum confidence threshold for any model decision. */
export const DEFAULT_MIN_CONFIDENCE_THRESHOLD = 0.40;

/** Default timeout in milliseconds for fast Jev decision calls. */
export const DEFAULT_JEV_TIMEOUT_MS = 1500;

/** Default model identifier for Jev decision requests against the direct TypeSafe endpoint. */
export const DEFAULT_JEV_MODEL = "jev-latest";

/** Model identifier for Jev decision requests routed through the OpenRouter alpha decisions API. */
export const OPENROUTER_JEV_MODEL = "typesafe/jev-1.13";

/** Official TypeSafe System One evaluation endpoint. */
export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** OpenRouter alpha decisions endpoint. */
export const OPENROUTER_DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

/** Rubric criteria descriptions for the 7 primitives passed to Jev CHOICE question. */
export const PRIMITIVE_CRITERIA: Record<AnimatedPrimitive, string> = {
  TextReveal: "Kinetic typography reveal for headlines, primary narrative titles, quotes, or spoken thesis statements.",
  StatCounter: "Large animated numerical counter with units for metrics, performance numbers, benchmarks, percentages, or quantitative gains.",
  CodeBlock: "Syntax or terminal code block for code snippets, terminal commands, function signatures, or raw script execution.",
  Card: "Container card grouping related metadata, concept definitions, architectural modules, or structured properties.",
  Divider: "Thin hairline separator rule separating distinct sections, conceptual phases, or narrative shifts.",
  IconLabel: "Compact icon with accompanying short text badge or label for status, tags, tools, or metadata flags.",
  ProgressBar: "Linear or segmented progress indicator for completion, steps, stages, timelines, or percentages toward a target.",
};

/** State representation evaluated by Jev for primitive selection. */
export interface JevDecisionState {
  visual?: string;
  narration?: string;
  onscreen?: string[];
  activeComponents?: string[];
  sceneTitle?: string;
}

/** Options for configuring Jev decision calls. */
export interface JevDecisionOptions {
  model?: string;
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
  complexThreshold?: number;
  minThreshold?: number;
  fetchFn?: typeof fetch;
}

/** Parsed choice answer from Jev decision evaluation. */
export interface JevChoiceAnswer {
  choice: AnimatedPrimitive;
  confidence: number;
  probabilities: Record<string, number>;
}

/** Final primitive selection result with provenance and fallback tracking. */
export interface PrimitiveSelectionResult {
  primitive: AnimatedPrimitive;
  source: "jev" | "confidence-fallback" | "heuristic-fallback";
  confidence?: number;
  probabilities?: Record<string, number>;
  rawChoice?: string;
  fallbackReason?: string;
}

// Global injectable mock handler for testing without network requests.
let activeMockHandler: ((state: JevDecisionState) => Promise<JevChoiceAnswer | null> | JevChoiceAnswer | null) | null = null;

// Sets a mock handler for Jev decisions in tests.
export function setMockJevHandler(handler: typeof activeMockHandler): void {
  activeMockHandler = handler;
}

// Gets the active mock handler for Jev decisions.
export function getMockJevHandler(): typeof activeMockHandler {
  return activeMockHandler;
}

// Clears the active mock handler.
export function clearMockJevHandler(): void {
  activeMockHandler = null;
}

// Safely reads an environment variable in both Node and browser environments.
function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process?.env) {
    return process.env[key];
  }
  return undefined;
}

// Logs a non-silent warning when a live Jev API call fails before falling back to the heuristic.
function warnJevCallFailure(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[jev] ${context} call failed, falling back to heuristic: ${message}`);
}

// Resolves the configured Jev API key from environment variables.
export function getJevApiKey(): string | undefined {
  return (
    readEnv("TYPESAFE_API_KEY") ||
    readEnv("JEV_API_KEY") ||
    readEnv("OPENROUTER_API_KEY") ||
    undefined
  );
}

// Resolves the appropriate Jev decision endpoint URL.
export function getJevEndpoint(apiKey?: string): string {
  const customBase = readEnv("TYPESAFE_BASE_URL");
  if (customBase) return customBase;

  const customEndpoint = readEnv("JEV_API_ENDPOINT");
  if (customEndpoint) return customEndpoint;

  const key = apiKey ?? getJevApiKey();
  const openRouterKey = readEnv("OPENROUTER_API_KEY");
  const typeSafeKey = readEnv("TYPESAFE_API_KEY") || readEnv("JEV_API_KEY");

  if (key && key === openRouterKey && !typeSafeKey) {
    return OPENROUTER_DECISIONS_ENDPOINT;
  }

  return TYPESAFE_ENDPOINT;
}

// Resolves the default model identifier based on endpoint and environment.
export function getJevModel(endpoint?: string): string {
  const explicitModel = readEnv("JEV_MODEL") || readEnv("TYPESAFE_MODEL");
  if (explicitModel) return explicitModel;

  const targetEndpoint = endpoint ?? getJevEndpoint();
  if (targetEndpoint.includes("openrouter.ai")) {
    return OPENROUTER_JEV_MODEL;
  }

  return DEFAULT_JEV_MODEL;
}

// Builds the request payload for TypeSafe / OpenRouter decisions API.
export function buildDecisionRequest(
  state: JevDecisionState,
  model: string = DEFAULT_JEV_MODEL,
): Record<string, unknown> {
  return {
    model,
    state: {
      visual: state.visual || "",
      narration: state.narration || "",
      onscreen: state.onscreen || [],
      activeComponents: state.activeComponents || [],
      ...(state.sceneTitle ? { sceneTitle: state.sceneTitle } : {}),
    },
    questions: {
      primitive: {
        type: "choice",
        instructions:
          "Select the single most appropriate animated visual primitive from the 7 design system primitives for this scene.",
        criteria: PRIMITIVE_CRITERIA,
      },
    },
  };
}

// Normalizes a raw string candidate to a canonical AnimatedPrimitive if valid.
function normalizePrimitiveName(raw: string): AnimatedPrimitive | null {
  const clean = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  for (const prim of ANIMATED_PRIMITIVES) {
    if (prim.toLowerCase() === clean) {
      return prim;
    }
  }
  return null;
}

// Parses the JSON response from the Jev decisions API into a typed JevChoiceAnswer.
export function parseDecisionResponse(val: unknown): JevChoiceAnswer {
  if (!val || typeof val !== "object") {
    throw new Error("Invalid Jev response: expected JSON object");
  }

  const obj = val as Record<string, unknown>;

  if (obj.error && typeof obj.error === "object") {
    const errObj = obj.error as Record<string, unknown>;
    const msg = typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
    throw new Error(`Jev API error: ${msg}`);
  }

  const answersContainer =
    (obj.answers && typeof obj.answers === "object" ? (obj.answers as Record<string, unknown>) : null) ||
    (obj.decisions && typeof obj.decisions === "object" ? (obj.decisions as Record<string, unknown>) : null) ||
    obj;

  const primitiveData = answersContainer.primitive;
  if (!primitiveData) {
    throw new Error("Jev response missing 'primitive' question in answers");
  }

  let rawChoice = "";
  let confidence = 0.5;
  const probabilities: Record<string, number> = {};

  if (typeof primitiveData === "string") {
    rawChoice = primitiveData;
  } else if (typeof primitiveData === "object" && primitiveData !== null) {
    const pObj = primitiveData as Record<string, unknown>;
    if (typeof pObj.choice === "string") {
      rawChoice = pObj.choice;
    } else if (typeof pObj.value === "string") {
      rawChoice = pObj.value;
    }

    if (typeof pObj.confidence === "number" && !Number.isNaN(pObj.confidence)) {
      confidence = Math.max(0, Math.min(1, pObj.confidence));
    }

    if (pObj.probabilities && typeof pObj.probabilities === "object") {
      const probMap = pObj.probabilities as Record<string, unknown>;
      for (const [k, v] of Object.entries(probMap)) {
        if (typeof v === "number" && !Number.isNaN(v)) {
          probabilities[k] = v;
        }
      }
    }
  }

  const canonicalChoice = normalizePrimitiveName(rawChoice);
  if (!canonicalChoice) {
    throw new Error(`Jev returned unknown primitive choice: "${rawChoice}"`);
  }

  if (Object.keys(probabilities).length === 0) {
    probabilities[canonicalChoice] = confidence;
  }

  return {
    choice: canonicalChoice,
    confidence,
    probabilities,
  };
}

// Selects the most appropriate primitive deterministically using fast heuristic rules.
export function heuristicPrimitiveSelection(state: JevDecisionState): AnimatedPrimitive {
  const parts: string[] = [];
  if (state.visual) parts.push(state.visual);
  if (state.narration) parts.push(state.narration);
  if (state.onscreen && state.onscreen.length > 0) parts.push(...state.onscreen);
  const combined = parts.join(" ").toLowerCase();

  // 1. Explicit Card detection: if the cue explicitly calls for a card/panel
  const hasExplicitCard =
    /\b(container card|feature card|summary card|info card|overview card|property panel|module card|data card)\b/i.test(
      combined,
    );
  if (hasExplicitCard) {
    return "Card";
  }

  // 2. CodeBlock detection: code snippets, terminal commands, shell scripts, programming constructs
  const hasCodeKeywords =
    /```|`[^`]+`|\b(npm|pnpm|yarn|pip|cargo|git|curl|docker|bash|zsh|sh|cli|terminal|stdout|stdin|stderr)\b/.test(
      combined,
    ) ||
    /\b(function|const|let|var|def|class|interface|import|export|return|async|await|console\.log|println!)\b/.test(
      combined,
    ) ||
    /\b(code snippet|source code|terminal command|syntax|codeblock|code block|function signature)\b/.test(
      combined,
    );
  if (hasCodeKeywords) {
    return "CodeBlock";
  }

  // 3. StatCounter detection: numerical quantities, metrics, percentages, multipliers, benchmarks
  const hasQuantity =
    /\b\d+(?:\.\d+)?\s*(?:%|percent\b|x\b|times\b|ms\b|fps\b|gb\b|mb\b|tb\b|k\b|m\b|b\b|billion\b|million\b|trillion\b)/i.test(
      combined,
    ) ||
    /\b(two|three|four|five|ten|twenty|fifty|hundred)\s*(?:to\s+\w+\s*)?times\b/i.test(combined) ||
    /\b(speedup|latency|throughput|accuracy score|benchmark|reduction by|gain of)\s+\d+/i.test(combined);
  if (hasQuantity) {
    return "StatCounter";
  }

  // 4. ProgressBar detection: progress, steps, stages, completion ratio, sequence advancement
  const hasProgress =
    /\b(progress|progress bar|completion|percentage complete|loading state|pipeline progress)\b/i.test(
      combined,
    ) ||
    /\b(?:step|phase|stage)\s+\d+\s+(?:of|\/)\s+\d+\b/i.test(combined) ||
    /\b(halfway|milestone|step-by-step progress|linear progression)\b/i.test(combined);
  if (hasProgress) {
    return "ProgressBar";
  }

  // 5. Divider detection: separation lines, phase boundaries, section breaks, rule separators
  const hasDivider =
    /\b(divider|separation rule|hairline rule|section boundary|topic transition|horizontal separator|rule separator)\b/i.test(
      combined,
    );
  if (hasDivider) {
    return "Divider";
  }

  // 6. IconLabel detection: badges, status pills, tags, metadata chips, icon indicators
  const hasIconLabel =
    /\b(icon label|badge|status pill|tag label|status tag|metadata chip|pill badge|icon with text|status badge)\b/i.test(
      combined,
    );
  if (hasIconLabel) {
    return "IconLabel";
  }

  // 7. General Card detection: multi-item onscreen elements forming a card layout
  if (state.onscreen && state.onscreen.length >= 2) {
    return "Card";
  }

  // 7. Default to clean kinetic typography
  return "TextReveal";
}

// Evaluates model choice against confidence thresholds and falls back safely on low confidence.
export function applyConfidenceGating(
  answer: JevChoiceAnswer,
  state: JevDecisionState,
  options?: { complexThreshold?: number; minThreshold?: number },
): PrimitiveSelectionResult {
  const complexThreshold = options?.complexThreshold ?? DEFAULT_COMPLEX_CONFIDENCE_THRESHOLD;
  const minThreshold = options?.minThreshold ?? DEFAULT_MIN_CONFIDENCE_THRESHOLD;

  const isComplex = COMPLEX_PRIMITIVES.includes(answer.choice);

  // If Jev selects a complex primitive with insufficient confidence, fall back to safe generic primitive
  if (isComplex && answer.confidence < complexThreshold) {
    const isMultiItem =
      (state.onscreen && state.onscreen.length > 1) ||
      (state.narration && state.narration.length > 120);
    const safeFallback: AnimatedPrimitive = isMultiItem ? "Card" : "TextReveal";

    return {
      primitive: safeFallback,
      source: "confidence-fallback",
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      rawChoice: answer.choice,
      fallbackReason: `Low confidence (${answer.confidence.toFixed(2)} < ${complexThreshold}) for complex primitive ${answer.choice}; safely fell back to ${safeFallback}`,
    };
  }

  // If overall confidence is below the minimum threshold, fall back to deterministic heuristic
  if (answer.confidence < minThreshold) {
    const heuristicChoice = heuristicPrimitiveSelection(state);
    return {
      primitive: heuristicChoice,
      source: "confidence-fallback",
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      rawChoice: answer.choice,
      fallbackReason: `Confidence (${answer.confidence.toFixed(2)} < ${minThreshold}) below minimum threshold; fell back to heuristic`,
    };
  }

  return {
    primitive: answer.choice,
    source: "jev",
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    rawChoice: answer.choice,
  };
}

// Executes an HTTP call to the Jev decisions endpoint with timeout handling.
export async function decidePrimitiveWithModel(
  state: JevDecisionState,
  options?: JevDecisionOptions,
): Promise<JevChoiceAnswer> {
  const apiKey = options?.apiKey ?? getJevApiKey();
  if (!apiKey) {
    throw new Error("No Jev API key provided or found in environment");
  }

  const endpoint = options?.endpoint ?? getJevEndpoint(apiKey);
  const model = options?.model ?? getJevModel(endpoint);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS;
  const fetcher = options?.fetchFn ?? fetch;

  const payload = buildDecisionRequest(state, model);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Jev decision endpoint returned HTTP ${response.status}: ${errText}`);
    }

    const json = (await response.json()) as unknown;
    return parseDecisionResponse(json);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Jev decision timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Top-level entry point that selects the most appropriate animated primitive for a scene.
export async function selectPrimitive(
  state: JevDecisionState,
  options?: JevDecisionOptions,
): Promise<PrimitiveSelectionResult> {
  // 1. Check if an active mock handler is registered (e.g. during testing)
  if (activeMockHandler) {
    try {
      const mockAnswer = await activeMockHandler(state);
      if (mockAnswer) {
        return applyConfidenceGating(mockAnswer, state, options);
      }
    } catch (mockErr: unknown) {
      const fallback = heuristicPrimitiveSelection(state);
      return {
        primitive: fallback,
        source: "heuristic-fallback",
        fallbackReason: `Mock handler error: ${mockErr instanceof Error ? mockErr.message : String(mockErr)}`,
      };
    }
  }

  // 2. Check for API key in options or environment
  const apiKey = options?.apiKey ?? getJevApiKey();
  if (!apiKey) {
    const fallback = heuristicPrimitiveSelection(state);
    return {
      primitive: fallback,
      source: "heuristic-fallback",
      fallbackReason: "No Jev API key configured in environment",
    };
  }

  // 3. Make the Jev model decision call with graceful fallback on error or timeout
  try {
    const answer = await decidePrimitiveWithModel(state, options);
    return applyConfidenceGating(answer, state, options);
  } catch (err: unknown) {
    warnJevCallFailure("selectPrimitive", err);
    const fallback = heuristicPrimitiveSelection(state);
    return {
      primitive: fallback,
      source: "heuristic-fallback",
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Closed set of shot-level visual strategies the compile path can render as schema-valid blocks. */
export const SHOT_VISUALS = [
  "Text",
  "StatCounter",
  "TokenStrip",
  "Plot",
  "MatrixGrid",
  "Distribution",
  "LayerStack",
  "ScaleBar",
] as const;

export type ShotVisual = (typeof SHOT_VISUALS)[number];

/** Device visuals that demand higher confidence because they assert data the narration must carry. */
export const SHOT_COMPLEX_VISUALS: readonly ShotVisual[] = [
  "StatCounter",
  "TokenStrip",
  "Plot",
  "MatrixGrid",
  "Distribution",
  "LayerStack",
  "ScaleBar",
] as const;

/**
 * Confidence a device shot visual needs before it is used. Lower than the primitive threshold
 * because the design stage separately refuses any device whose data the narration does not carry,
 * so this gate only has to catch a wrong kind of chart, not invented data. Calibrated with
 * `npm run eval:visuals -- --jev`: at 0.65 correct picks such as LayerStack 0.52 and ScaleBar 0.53
 * were discarded and shipped accuracy (81%) fell below the heuristic alone (88%); at 0.45 it is 94%.
 */
export const DEFAULT_SHOT_COMPLEX_CONFIDENCE_THRESHOLD = 0.45;

/** Rubric criteria for each shot-level visual strategy passed to the Jev CHOICE question. */
export const SHOT_VISUAL_CRITERIA: Record<ShotVisual, string> = {
  Text: "Headline plus supporting body copy for narrative beats with no chartable data.",
  StatCounter: "Large animated number for metrics, percentages, multipliers, or benchmark gains.",
  TokenStrip: "Token sequence strip for parallel decoding, batches, streams, or sequences.",
  Plot: "Single-line growth curve for scaling, throughput, loss, accuracy, or curves.",
  MatrixGrid: "Grid heatmap for matrices, weights, tensors, attention maps, or tables.",
  Distribution: "Probability breakdown for distributions, proportions, splits, or shares.",
  LayerStack: "Layered stack for layers, hierarchies, pipelines, stages, or deep networks.",
  ScaleBar: "Threshold slider for trade-offs, spectrums, ranges, bounds, or temperature.",
};

/** State evaluated by Jev for shot-level visual choice. */
export interface ShotVisualState {
  visual?: string;
  narration?: string;
  onscreen?: string[];
  activeVisuals?: string[];
  sceneTitle?: string;
  durationSec?: number;
  wantsFootage?: boolean;
}

/** Parsed shot-visual choice answer from the Jev decision evaluation. */
export interface ShotVisualAnswer {
  choice: ShotVisual;
  confidence: number;
  probabilities: Record<string, number>;
}

/** Final shot-visual selection result with provenance and fallback tracking. */
export interface ShotVisualResult {
  visual: ShotVisual;
  source: "jev" | "confidence-fallback" | "heuristic-fallback";
  confidence?: number;
  probabilities?: Record<string, number>;
  rawChoice?: string;
  fallbackReason?: string;
}

// Global injectable mock handler for shot-visual decisions in tests.
let activeShotVisualMockHandler:
  | ((state: ShotVisualState) => Promise<ShotVisualAnswer | null> | ShotVisualAnswer | null)
  | null = null;

// Sets a mock handler for shot-visual decisions in tests.
export function setMockShotVisualHandler(handler: typeof activeShotVisualMockHandler): void {
  activeShotVisualMockHandler = handler;
}

// Gets the active mock handler for shot-visual decisions.
export function getMockShotVisualHandler(): typeof activeShotVisualMockHandler {
  return activeShotVisualMockHandler;
}

// Clears the active mock handler for shot-visual decisions.
export function clearMockShotVisualHandler(): void {
  activeShotVisualMockHandler = null;
}

// Posts one decision payload to the Jev endpoint with timeout handling (single shared client).
async function postJevRequest(
  payload: Record<string, unknown>,
  options?: JevDecisionOptions,
): Promise<unknown> {
  const apiKey = options?.apiKey ?? getJevApiKey();
  if (!apiKey) {
    throw new Error("No Jev API key provided or found in environment");
  }
  const endpoint = options?.endpoint ?? getJevEndpoint(apiKey);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS;
  const fetcher = options?.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Jev decision endpoint returned HTTP ${response.status}: ${errText}`);
    }
    return (await response.json()) as unknown;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Jev decision timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Builds the request payload for a shot-level visual strategy CHOICE question.
export function buildShotVisualRequest(
  state: ShotVisualState,
  model: string = DEFAULT_JEV_MODEL,
): Record<string, unknown> {
  return {
    model,
    state: {
      visual: state.visual || "",
      narration: state.narration || "",
      onscreen: state.onscreen || [],
      activeVisuals: state.activeVisuals || [],
      ...(state.sceneTitle ? { sceneTitle: state.sceneTitle } : {}),
      ...(typeof state.durationSec === "number" ? { durationSec: state.durationSec } : {}),
      ...(typeof state.wantsFootage === "boolean" ? { wantsFootage: state.wantsFootage } : {}),
    },
    questions: {
      shotVisual: {
        type: "choice",
        instructions:
          "Select the single shot-level visual strategy whose blocks can be authored against the film schema for this beat. Prefer Text when the narration carries no chartable data.",
        criteria: SHOT_VISUAL_CRITERIA,
      },
    },
  };
}

// Normalizes a raw string candidate to a canonical ShotVisual if valid.
function normalizeShotVisualName(raw: string): ShotVisual | null {
  const clean = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  for (const v of SHOT_VISUALS) {
    if (v.toLowerCase() === clean) {
      return v;
    }
  }
  return null;
}

// Extracts a generic CHOICE answer (choice + confidence + probabilities) for one question key.
function parseChoiceAnswer(val: unknown, questionKey: string, normalize: (raw: string) => string | null): { choice: string; confidence: number; probabilities: Record<string, number> } {
  if (!val || typeof val !== "object") {
    throw new Error("Invalid Jev response: expected JSON object");
  }
  const obj = val as Record<string, unknown>;
  if (obj.error && typeof obj.error === "object") {
    const errObj = obj.error as Record<string, unknown>;
    const msg = typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
    throw new Error(`Jev API error: ${msg}`);
  }
  const answersContainer =
    (obj.answers && typeof obj.answers === "object" ? (obj.answers as Record<string, unknown>) : null) ||
    (obj.decisions && typeof obj.decisions === "object" ? (obj.decisions as Record<string, unknown>) : null) ||
    obj;
  const data = answersContainer[questionKey];
  if (!data) {
    throw new Error(`Jev response missing '${questionKey}' question in answers`);
  }
  let rawChoice = "";
  let confidence = 0.5;
  const probabilities: Record<string, number> = {};
  if (typeof data === "string") {
    rawChoice = data;
  } else if (typeof data === "object" && data !== null) {
    const pObj = data as Record<string, unknown>;
    if (typeof pObj.choice === "string") {
      rawChoice = pObj.choice;
    } else if (typeof pObj.value === "string") {
      rawChoice = pObj.value;
    }
    if (typeof pObj.confidence === "number" && !Number.isNaN(pObj.confidence)) {
      confidence = Math.max(0, Math.min(1, pObj.confidence));
    }
    if (pObj.probabilities && typeof pObj.probabilities === "object") {
      const probMap = pObj.probabilities as Record<string, unknown>;
      for (const [k, v] of Object.entries(probMap)) {
        if (typeof v === "number" && !Number.isNaN(v)) {
          probabilities[k] = v;
        }
      }
    }
  }
  const canonical = normalize(rawChoice);
  if (!canonical) {
    throw new Error(`Jev returned unknown ${questionKey} choice: "${rawChoice}"`);
  }
  if (Object.keys(probabilities).length === 0) {
    probabilities[canonical] = confidence;
  }
  return { choice: canonical, confidence, probabilities };
}

// Parses the JSON response for a shot-visual CHOICE into a typed answer.
export function parseShotVisualResponse(val: unknown): ShotVisualAnswer {
  const parsed = parseChoiceAnswer(val, "shotVisual", (raw) => normalizeShotVisualName(raw));
  const choice = normalizeShotVisualName(parsed.choice);
  if (!choice) {
    throw new Error(`Jev returned unknown shotVisual choice: "${parsed.choice}"`);
  }
  return { choice, confidence: parsed.confidence, probabilities: parsed.probabilities };
}

// Selects a shot-level visual deterministically using fast heuristic rules.
export function heuristicShotVisualSelection(state: ShotVisualState): ShotVisual {
  const narration = state.narration || "";
  const last = (state.activeVisuals || []).slice(-1)[0];
  return (
    SHOT_COMPLEX_VISUALS.find((v) => v !== last && narrationSupportsVisual(v, narration)) ?? "Text"
  );
}

// Evaluates a shot-visual choice against confidence thresholds and falls back safely.
export function applyShotVisualGating(
  answer: ShotVisualAnswer,
  state: ShotVisualState,
  options?: { complexThreshold?: number; minThreshold?: number },
): ShotVisualResult {
  const complexThreshold = options?.complexThreshold ?? DEFAULT_SHOT_COMPLEX_CONFIDENCE_THRESHOLD;
  const minThreshold = options?.minThreshold ?? DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  const isComplex = (SHOT_COMPLEX_VISUALS as readonly string[]).includes(answer.choice);
  if (isComplex && answer.confidence < complexThreshold) {
    return {
      visual: "Text",
      source: "confidence-fallback",
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      rawChoice: answer.choice,
      fallbackReason: `Low confidence (${answer.confidence.toFixed(2)} < ${complexThreshold}) for device visual ${answer.choice}; safely fell back to Text`,
    };
  }
  if (answer.confidence < minThreshold) {
    const heuristicChoice = heuristicShotVisualSelection(state);
    return {
      visual: heuristicChoice,
      source: "confidence-fallback",
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      rawChoice: answer.choice,
      fallbackReason: `Confidence (${answer.confidence.toFixed(2)} < ${minThreshold}) below minimum threshold; fell back to heuristic`,
    };
  }
  return {
    visual: answer.choice,
    source: "jev",
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    rawChoice: answer.choice,
  };
}

// Executes one shared-client call for a shot-visual CHOICE question.
export async function decideShotVisualWithModel(
  state: ShotVisualState,
  options?: JevDecisionOptions,
): Promise<ShotVisualAnswer> {
  const model = options?.model ?? getJevModel(options?.endpoint ?? getJevEndpoint(options?.apiKey));
  const payload = buildShotVisualRequest(state, model);
  const json = await postJevRequest(payload, options);
  return parseShotVisualResponse(json);
}

// Top-level entry point that selects the shot-level visual strategy for one beat.
export async function selectShotVisual(
  state: ShotVisualState,
  options?: JevDecisionOptions,
): Promise<ShotVisualResult> {
  if (activeShotVisualMockHandler) {
    try {
      const mockAnswer = await activeShotVisualMockHandler(state);
      if (mockAnswer) {
        return applyShotVisualGating(mockAnswer, state, options);
      }
    } catch (mockErr: unknown) {
      const fallback = heuristicShotVisualSelection(state);
      return {
        visual: fallback,
        source: "heuristic-fallback",
        fallbackReason: `Mock handler error: ${mockErr instanceof Error ? mockErr.message : String(mockErr)}`,
      };
    }
  }
  const apiKey = options?.apiKey ?? getJevApiKey();
  if (!apiKey) {
    const fallback = heuristicShotVisualSelection(state);
    return {
      visual: fallback,
      source: "heuristic-fallback",
      fallbackReason: "No Jev API key configured in environment",
    };
  }
  try {
    const answer = await decideShotVisualWithModel(state, options);
    return applyShotVisualGating(answer, state, options);
  } catch (err: unknown) {
    warnJevCallFailure("selectShotVisual", err);
    const fallback = heuristicShotVisualSelection(state);
    return {
      visual: fallback,
      source: "heuristic-fallback",
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Most questions sent in one batched Jev request; larger batches are split and sent in parallel. */
export const MAX_BATCH_QUESTIONS = 24;

/** Default timeout for one batched request, which carries many questions instead of one. */
export const DEFAULT_JEV_BATCH_TIMEOUT_MS = 6000;

/** A prefetched Jev answer for one item, or the reason it could not be answered. */
export type PrefetchedAnswer<A> = { answer: A } | { error: string };

// Asks one CHOICE question per item in as few Jev requests as possible and returns one result per item.
async function askChoiceBatch<A>(
  items: Record<string, unknown>[],
  instructions: string,
  criteria: Record<string, string>,
  parse: (val: unknown, questionKey: string) => A,
  options: JevDecisionOptions | undefined,
  context: string,
): Promise<PrefetchedAnswer<A>[]> {
  const model = options?.model ?? getJevModel(options?.endpoint ?? getJevEndpoint(options?.apiKey));
  const requestOptions = { ...options, timeoutMs: options?.timeoutMs ?? DEFAULT_JEV_BATCH_TIMEOUT_MS };
  const chunks: number[][] = [];
  for (let start = 0; start < items.length; start += MAX_BATCH_QUESTIONS) {
    chunks.push(items.slice(start, start + MAX_BATCH_QUESTIONS).map((_, k) => start + k));
  }
  const results: PrefetchedAnswer<A>[] = new Array(items.length);
  await Promise.all(
    chunks.map(async (indices) => {
      const questions: Record<string, unknown> = {};
      indices.forEach((_, k) => {
        questions[`q${k}`] = { type: "choice", instructions: `For \`beats[${k}]\`: ${instructions}`, criteria };
      });
      const payload = { model, state: { beats: indices.map((i) => items[i]) }, questions };
      try {
        const json = await postJevRequest(payload, requestOptions);
        indices.forEach((itemIndex, k) => {
          try {
            results[itemIndex] = { answer: parse(json, `q${k}`) };
          } catch (err: unknown) {
            results[itemIndex] = { error: err instanceof Error ? err.message : String(err) };
          }
        });
      } catch (err: unknown) {
        warnJevCallFailure(context, err);
        const error = err instanceof Error ? err.message : String(err);
        for (const itemIndex of indices) results[itemIndex] = { error };
      }
    }),
  );
  return results;
}

// Asks Jev for every beat's shot visual in one batched request, or returns null when the
// per-beat path must run instead (a test mock is active or no API key is configured).
export async function prefetchShotVisualAnswers(
  states: ShotVisualState[],
  options?: JevDecisionOptions,
): Promise<PrefetchedAnswer<ShotVisualAnswer>[] | null> {
  if (activeShotVisualMockHandler || !(options?.apiKey ?? getJevApiKey()) || states.length === 0) return null;
  const items = states.map((s) => ({
    visual: s.visual || "",
    narration: s.narration || "",
    onscreen: s.onscreen || [],
    ...(s.sceneTitle ? { sceneTitle: s.sceneTitle } : {}),
    ...(typeof s.durationSec === "number" ? { durationSec: s.durationSec } : {}),
  }));
  return askChoiceBatch(
    items,
    "select the single shot-level visual strategy whose blocks can be authored against the film schema for this beat. Prefer Text when the narration carries no chartable data. Neighbouring beats are context only.",
    SHOT_VISUAL_CRITERIA,
    (val, key) => {
      const parsed = parseChoiceAnswer(val, key, (raw) => normalizeShotVisualName(raw));
      return { choice: parsed.choice as ShotVisual, confidence: parsed.confidence, probabilities: parsed.probabilities };
    },
    options,
    "prefetchShotVisualAnswers",
  );
}

// Turns one prefetched shot-visual answer into a gated result against the beat's live state.
export function resolveShotVisual(
  prefetched: PrefetchedAnswer<ShotVisualAnswer>,
  state: ShotVisualState,
  options?: JevDecisionOptions,
): ShotVisualResult {
  if ("answer" in prefetched) return applyShotVisualGating(prefetched.answer, state, options);
  return { visual: heuristicShotVisualSelection(state), source: "heuristic-fallback", fallbackReason: prefetched.error };
}

// Asks Jev for every beat group's animated primitive in one batched request, or returns null
// when the per-group path must run instead (a test mock is active or no API key is configured).
export async function prefetchPrimitiveAnswers(
  states: JevDecisionState[],
  options?: JevDecisionOptions,
): Promise<PrefetchedAnswer<JevChoiceAnswer>[] | null> {
  if (activeMockHandler || !(options?.apiKey ?? getJevApiKey()) || states.length === 0) return null;
  const items = states.map((s) => ({
    visual: s.visual || "",
    narration: s.narration || "",
    onscreen: s.onscreen || [],
    ...(s.sceneTitle ? { sceneTitle: s.sceneTitle } : {}),
  }));
  return askChoiceBatch(
    items,
    "select the single most appropriate animated visual primitive from the 7 design system primitives for this scene. Neighbouring beats are context only.",
    PRIMITIVE_CRITERIA,
    (val, key) => {
      const parsed = parseChoiceAnswer(val, key, (raw) => normalizePrimitiveName(raw));
      return { choice: parsed.choice as AnimatedPrimitive, confidence: parsed.confidence, probabilities: parsed.probabilities };
    },
    options,
    "prefetchPrimitiveAnswers",
  );
}

// Turns one prefetched primitive answer into a gated result against the group's live state.
export function resolvePrimitive(
  prefetched: PrefetchedAnswer<JevChoiceAnswer>,
  state: JevDecisionState,
  options?: JevDecisionOptions,
): PrimitiveSelectionResult {
  if ("answer" in prefetched) return applyConfidenceGating(prefetched.answer, state, options);
  return { primitive: heuristicPrimitiveSelection(state), source: "heuristic-fallback", fallbackReason: prefetched.error };
}
