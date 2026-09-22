/**
 * File Description: TypeSafe Jev decision model client for screenplay visual selection.
 * Implements CHOICE over the 7 animated primitives, shot-level visual strategies, SVG-route
 * decisions, and vision-judge verdicts, each with confidence gating, safe fallback, and fast
 * deterministic heuristic fallback over one shared decision client.
 */

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

/** Default model identifier for Jev decision requests. */
export const DEFAULT_JEV_MODEL = "typesafe/jev-1.13";

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
    return "typesafe/jev-1.13";
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

/** Closed set for SVG routing: standard blocks or a synthesized SVG asset with clip tracks. */
export const SVG_ROUTES = ["standard-blocks", "svg-asset"] as const;

export type SvgRoute = (typeof SVG_ROUTES)[number];

/** Closed verdict set for the vision judge over a rendered still. */
export const VISION_VERDICTS = ["pass", "fail"] as const;

export type VisionVerdict = (typeof VISION_VERDICTS)[number];

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

/** Rubric criteria for the SVG-route decision passed to the Jev CHOICE question. */
export const SVG_ROUTE_CRITERIA: Record<SvgRoute, string> = {
  "standard-blocks": "Standard TextReveal/Body/device blocks already cover the beat.",
  "svg-asset": "A bespoke SVG scene asset is needed: the visual direction names a concrete object, character, animal, diagram, or spatial arrangement no standard block can draw.",
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

/** State evaluated by Jev for SVG-route choice. */
export interface SvgRouteState {
  visual?: string;
  narration?: string;
  onscreen?: string[];
  sceneTitle?: string;
  durationSec?: number;
  wantsFootage?: boolean;
}

/** Input to the vision judge: a rendered still plus the intent it must match. */
export interface VisionJudgeInput {
  pngBase64: string;
  intent: string;
  shotId?: string;
  clipIds?: string[];
  assetIds?: string[];
}

/** Parsed shot-visual choice answer from the Jev decision evaluation. */
export interface ShotVisualAnswer {
  choice: ShotVisual;
  confidence: number;
  probabilities: Record<string, number>;
}

/** Parsed SVG-route choice answer from the Jev decision evaluation. */
export interface SvgRouteAnswer {
  choice: SvgRoute;
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

/** Final SVG-route selection result with provenance and fallback tracking. */
export interface SvgRouteResult {
  route: SvgRoute;
  source: "jev" | "confidence-fallback" | "heuristic-fallback";
  confidence?: number;
  probabilities?: Record<string, number>;
  rawChoice?: string;
  fallbackReason?: string;
}

/** Vision judge outcome: a look-alike score plus failure reasons fed back to repair. */
export interface VisionJudgeResult {
  score: number;
  pass: boolean;
  reasons: string[];
  source: "jev" | "heuristic-fallback";
  confidence?: number;
  fallbackReason?: string;
}

// Global injectable mock handlers for shot-visual, SVG-route, and vision decisions in tests.
let activeShotVisualMockHandler:
  | ((state: ShotVisualState) => Promise<ShotVisualAnswer | null> | ShotVisualAnswer | null)
  | null = null;
let activeSvgRouteMockHandler:
  | ((state: SvgRouteState) => Promise<SvgRouteAnswer | null> | SvgRouteAnswer | null)
  | null = null;
let activeVisionMockHandler:
  | ((input: VisionJudgeInput) => Promise<VisionJudgeResult | null> | VisionJudgeResult | null)
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

// Sets a mock handler for SVG-route decisions in tests.
export function setMockSvgRouteHandler(handler: typeof activeSvgRouteMockHandler): void {
  activeSvgRouteMockHandler = handler;
}

// Gets the active mock handler for SVG-route decisions.
export function getMockSvgRouteHandler(): typeof activeSvgRouteMockHandler {
  return activeSvgRouteMockHandler;
}

// Clears the active mock handler for SVG-route decisions.
export function clearMockSvgRouteHandler(): void {
  activeSvgRouteMockHandler = null;
}

// Sets a mock handler for vision-judge decisions in tests.
export function setMockVisionHandler(handler: typeof activeVisionMockHandler): void {
  activeVisionMockHandler = handler;
}

// Gets the active mock handler for vision-judge decisions.
export function getMockVisionHandler(): typeof activeVisionMockHandler {
  return activeVisionMockHandler;
}

// Clears the active mock handler for vision-judge decisions.
export function clearMockVisionHandler(): void {
  activeVisionMockHandler = null;
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

// Builds the request payload for an SVG-route CHOICE question.
export function buildSvgRouteRequest(
  state: SvgRouteState,
  model: string = DEFAULT_JEV_MODEL,
): Record<string, unknown> {
  return {
    model,
    state: {
      visual: state.visual || "",
      narration: state.narration || "",
      onscreen: state.onscreen || [],
      ...(state.sceneTitle ? { sceneTitle: state.sceneTitle } : {}),
      ...(typeof state.durationSec === "number" ? { durationSec: state.durationSec } : {}),
      ...(typeof state.wantsFootage === "boolean" ? { wantsFootage: state.wantsFootage } : {}),
    },
    questions: {
      svgRoute: {
        type: "choice",
        instructions:
          "Decide whether this beat needs a bespoke SVG scene asset. Choose svg-asset only when the visual direction names a concrete object, character, animal, diagram, or spatial arrangement that standard blocks cannot draw and no footage covers it.",
        criteria: SVG_ROUTE_CRITERIA,
      },
    },
  };
}

// Builds the request payload for a vision-judge verdict over a rendered still.
export function buildVisionJudgeRequest(
  input: VisionJudgeInput,
  model: string = DEFAULT_JEV_MODEL,
): Record<string, unknown> {
  return {
    model,
    state: {
      intent: input.intent,
      ...(input.shotId ? { shotId: input.shotId } : {}),
      clipIds: input.clipIds || [],
      assetIds: input.assetIds || [],
      imageBase64: input.pngBase64.slice(0, 4000),
      imageTruncated: input.pngBase64.length > 4000,
    },
    questions: {
      verdict: {
        type: "choice",
        instructions:
          "Judge whether the rendered still matches the intent description. Choose pass only when the depicted subject, arrangement, and key elements match the intent. Return confidence as the look-alike score from 0 to 1.",
        criteria: {
          pass: "The still depicts the intent: subject, arrangement, and key elements match.",
          fail: "The still does not depict the intent: wrong subject, missing elements, or unreadable layout.",
        },
      },
    },
    attachments: [
      {
        kind: "rendered-still-png-base64",
        mediaType: "image/png",
        dataBase64: input.pngBase64,
      },
    ],
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

// Normalizes a raw string candidate to a canonical SvgRoute if valid.
function normalizeSvgRouteName(raw: string): SvgRoute | null {
  const clean = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (clean === "standardblocks") return "standard-blocks";
  if (clean === "svgasset") return "svg-asset";
  for (const r of SVG_ROUTES) {
    if (r.replace(/[^a-z]/g, "") === clean) {
      return r;
    }
  }
  return null;
}

// Normalizes a raw string candidate to a canonical VisionVerdict if valid.
function normalizeVisionVerdict(raw: string): VisionVerdict | null {
  const clean = raw.trim().toLowerCase();
  if (clean === "pass") return "pass";
  if (clean === "fail") return "fail";
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
    } else if (typeof pObj.verdict === "string") {
      rawChoice = pObj.verdict;
    }
    if (typeof pObj.confidence === "number" && !Number.isNaN(pObj.confidence)) {
      confidence = Math.max(0, Math.min(1, pObj.confidence));
    } else if (typeof pObj.score === "number" && !Number.isNaN(pObj.score)) {
      confidence = Math.max(0, Math.min(1, pObj.score));
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

// Parses the JSON response for an SVG-route CHOICE into a typed answer.
export function parseSvgRouteResponse(val: unknown): SvgRouteAnswer {
  const parsed = parseChoiceAnswer(val, "svgRoute", (raw) => normalizeSvgRouteName(raw));
  const choice = normalizeSvgRouteName(parsed.choice);
  if (!choice) {
    throw new Error(`Jev returned unknown svgRoute choice: "${parsed.choice}"`);
  }
  return { choice, confidence: parsed.confidence, probabilities: parsed.probabilities };
}

// Parses the JSON response for a vision-judge verdict into a score plus failure reasons.
export function parseVisionJudgeResponse(val: unknown, fallbackIntent?: string): VisionJudgeResult {
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
  const data = answersContainer.verdict ?? answersContainer.likeness ?? answersContainer.judge;
  if (!data) {
    throw new Error("Jev response missing 'verdict' question in answers");
  }
  let rawVerdict = "";
  let score = 0.5;
  let reasons: string[] = [];
  let probabilities: Record<string, number> | undefined;
  if (typeof data === "string") {
    rawVerdict = data;
  } else if (typeof data === "object" && data !== null) {
    const pObj = data as Record<string, unknown>;
    if (typeof pObj.choice === "string") rawVerdict = pObj.choice;
    else if (typeof pObj.value === "string") rawVerdict = pObj.value;
    else if (typeof pObj.verdict === "string") rawVerdict = pObj.verdict;
    if (typeof pObj.score === "number" && !Number.isNaN(pObj.score)) {
      score = Math.max(0, Math.min(1, pObj.score));
    } else if (typeof pObj.confidence === "number" && !Number.isNaN(pObj.confidence)) {
      score = Math.max(0, Math.min(1, pObj.confidence));
    }
    if (Array.isArray(pObj.reasons)) {
      reasons = pObj.reasons.filter((r): r is string => typeof r === "string").slice(0, 8);
    } else if (Array.isArray(pObj.failures)) {
      reasons = pObj.failures.filter((r): r is string => typeof r === "string").slice(0, 8);
    } else if (typeof pObj.reason === "string") {
      reasons = [pObj.reason];
    }
    if (pObj.probabilities && typeof pObj.probabilities === "object") {
      probabilities = {};
      for (const [k, v] of Object.entries(pObj.probabilities as Record<string, unknown>)) {
        if (typeof v === "number" && !Number.isNaN(v)) probabilities[k] = v;
      }
    }
  }
  const verdict = normalizeVisionVerdict(rawVerdict);
  if (!verdict) {
    throw new Error(`Jev returned unknown verdict choice: "${rawVerdict}"`);
  }
  const pass = verdict === "pass";
  if (reasons.length === 0 && !pass) {
    reasons = [`Still does not match intent${fallbackIntent ? `: ${fallbackIntent.slice(0, 120)}` : ""}`];
  }
  return { score, pass, reasons, source: "jev", confidence: score, ...(probabilities ? {} : {}) };
}

// Selects a shot-level visual deterministically using fast heuristic rules.
export function heuristicShotVisualSelection(state: ShotVisualState): ShotVisual {
  const parts: string[] = [];
  if (state.visual) parts.push(state.visual);
  if (state.narration) parts.push(state.narration);
  if (state.onscreen && state.onscreen.length > 0) parts.push(...state.onscreen);
  const combined = parts.join(" ").toLowerCase();
  const lowerNarration = (state.narration || "").toLowerCase();
  const last = (state.activeVisuals || []).slice(-1)[0];
  const candidates: ShotVisual[] = [];
  const quantityLike =
    /\b\d+(?:\.\d+)?\s*(?:%|percent\b|x\b|times\b|ms\b|fps\b|gb\b|mb\b|tb\b|k\b|m\b|b\b|billion\b|million\b|trillion\b)/i.test(combined) ||
    /\b(two|three|four|five|ten|twenty|fifty|hundred)\s*(?:to\s+\w+\s*)?times\b/i.test(combined);
  if (quantityLike) candidates.push("StatCounter");
  if (/\b(in parallel|at once|all five|batch of them|single forward pass|tokens?|sequence|stream)\b/.test(lowerNarration)) {
    candidates.push("TokenStrip");
  }
  if (/\b(scales?|scaling|grows?|throughput|linear|quadratic|loss|accuracy|curve)\b/.test(lowerNarration)) {
    candidates.push("Plot");
  }
  if (/\b(matrix|weights?|tensor|grid|attention map|embedding space|heat\s*map|table)\b/.test(lowerNarration)) {
    candidates.push("MatrixGrid");
  }
  if (/\b(distribution|probability|proportions?|breakdown|fraction|shares?|split)\b/.test(lowerNarration)) {
    candidates.push("Distribution");
  }
  if (/\b(layers?|stack|tier|hierarchy|pipeline|stages?|deep network|blocks?)\b/.test(lowerNarration)) {
    candidates.push("LayerStack");
  }
  if (/\b(threshold|trade-off|tradeoff|spectrum|slider|range|bounds?|limits?|temperature)\b/.test(lowerNarration)) {
    candidates.push("ScaleBar");
  }
  if ((state.onscreen || []).length === 0 && candidates.length === 0) return "Text";
  const eligible = candidates.filter((c) => c !== last);
  if (eligible.length > 0) return eligible[0];
  if (candidates.length > 0 && candidates[0] !== last) return candidates[0];
  return "Text";
}

// Selects an SVG route deterministically: concrete visual scenes with no footage go to SVG.
export function heuristicSvgRouteSelection(state: SvgRouteState): SvgRoute {
  if (state.wantsFootage) return "standard-blocks";
  const visual = (state.visual || "").toLowerCase();
  if (!visual) return "standard-blocks";
  if (/\b(b-?roll|footage|live action|generated video|cinematic plate)\b/i.test(visual)) {
    return "standard-blocks";
  }
  const concrete =
    /\b(diagram|illustration|character|animal|rat|mouse|robot|astronaut|map|network|graph|object|device|machine|room|city|landscape|scene|depict|show|arrangement|spatial|cluster|orbit|planet|star)\b/i.test(visual);
  if (concrete && visual.length >= 24) return "svg-asset";
  return "standard-blocks";
}

// Heuristic vision judgement used when the judge is unavailable: pass through without blocking.
export function heuristicVisionJudgement(input: VisionJudgeInput): VisionJudgeResult {
  void input;
  return {
    score: 0.5,
    pass: true,
    reasons: [],
    source: "heuristic-fallback",
    fallbackReason: "No Jev API key configured for vision judge; passing through",
  };
}

// Evaluates a shot-visual choice against confidence thresholds and falls back safely.
export function applyShotVisualGating(
  answer: ShotVisualAnswer,
  state: ShotVisualState,
  options?: { complexThreshold?: number; minThreshold?: number },
): ShotVisualResult {
  const complexThreshold = options?.complexThreshold ?? DEFAULT_COMPLEX_CONFIDENCE_THRESHOLD;
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

// Evaluates an SVG-route choice against confidence thresholds and falls back safely.
export function applySvgRouteGating(
  answer: SvgRouteAnswer,
  state: SvgRouteState,
  options?: { complexThreshold?: number; minThreshold?: number },
): SvgRouteResult {
  const complexThreshold = options?.complexThreshold ?? DEFAULT_COMPLEX_CONFIDENCE_THRESHOLD;
  const minThreshold = options?.minThreshold ?? DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  if (answer.choice === "svg-asset" && answer.confidence < complexThreshold) {
    return {
      route: "standard-blocks",
      source: "confidence-fallback",
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      rawChoice: answer.choice,
      fallbackReason: `Low confidence (${answer.confidence.toFixed(2)} < ${complexThreshold}) for svg-asset; safely fell back to standard-blocks`,
    };
  }
  if (answer.confidence < minThreshold) {
    const heuristicChoice = heuristicSvgRouteSelection(state);
    return {
      route: heuristicChoice,
      source: "confidence-fallback",
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      rawChoice: answer.choice,
      fallbackReason: `Confidence (${answer.confidence.toFixed(2)} < ${minThreshold}) below minimum threshold; fell back to heuristic`,
    };
  }
  return {
    route: answer.choice,
    source: "jev",
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    rawChoice: answer.choice,
  };
}

// Evaluates a vision verdict against the minimum threshold, passing through when unsure.
export function applyVisionGating(
  result: VisionJudgeResult,
  input: VisionJudgeInput,
  options?: { minThreshold?: number },
): VisionJudgeResult {
  const minThreshold = options?.minThreshold ?? DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  const confidence = result.confidence ?? result.score;
  if (confidence < minThreshold) {
    const heuristic = heuristicVisionJudgement(input);
    return {
      ...heuristic,
      fallbackReason: `Vision confidence (${confidence.toFixed(2)} < ${minThreshold}) below minimum; passing through`,
    };
  }
  return result;
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

// Executes one shared-client call for an SVG-route CHOICE question.
export async function decideSvgRouteWithModel(
  state: SvgRouteState,
  options?: JevDecisionOptions,
): Promise<SvgRouteAnswer> {
  const model = options?.model ?? getJevModel(options?.endpoint ?? getJevEndpoint(options?.apiKey));
  const payload = buildSvgRouteRequest(state, model);
  const json = await postJevRequest(payload, options);
  return parseSvgRouteResponse(json);
}

// Executes one shared-client call for a vision-judge verdict over a rendered still.
export async function judgeVisionWithModel(
  input: VisionJudgeInput,
  options?: JevDecisionOptions,
): Promise<VisionJudgeResult> {
  if (!input.pngBase64 || input.pngBase64.length < 16) {
    throw new Error("Vision judge needs a rendered PNG base64 still, not empty input");
  }
  if (!input.intent || !input.intent.trim()) {
    throw new Error("Vision judge needs an intent description to judge the still against");
  }
  const model = options?.model ?? getJevModel(options?.endpoint ?? getJevEndpoint(options?.apiKey));
  const payload = buildVisionJudgeRequest(input, model);
  const json = await postJevRequest(payload, options);
  const parsed = parseVisionJudgeResponse(json, input.intent);
  return applyVisionGating(parsed, input, options);
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
    const fallback = heuristicShotVisualSelection(state);
    return {
      visual: fallback,
      source: "heuristic-fallback",
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}

// Top-level entry point that decides whether one beat routes to SVG asset synthesis.
export async function selectSvgRoute(
  state: SvgRouteState,
  options?: JevDecisionOptions,
): Promise<SvgRouteResult> {
  if (activeSvgRouteMockHandler) {
    try {
      const mockAnswer = await activeSvgRouteMockHandler(state);
      if (mockAnswer) {
        return applySvgRouteGating(mockAnswer, state, options);
      }
    } catch (mockErr: unknown) {
      const fallback = heuristicSvgRouteSelection(state);
      return {
        route: fallback,
        source: "heuristic-fallback",
        fallbackReason: `Mock handler error: ${mockErr instanceof Error ? mockErr.message : String(mockErr)}`,
      };
    }
  }
  const apiKey = options?.apiKey ?? getJevApiKey();
  if (!apiKey) {
    const fallback = heuristicSvgRouteSelection(state);
    return {
      route: fallback,
      source: "heuristic-fallback",
      fallbackReason: "No Jev API key configured in environment",
    };
  }
  try {
    const answer = await decideSvgRouteWithModel(state, options);
    return applySvgRouteGating(answer, state, options);
  } catch (err: unknown) {
    const fallback = heuristicSvgRouteSelection(state);
    return {
      route: fallback,
      source: "heuristic-fallback",
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}

// Top-level entry point that judges a rendered still against its intent description.
export async function judgeVisionStill(
  input: VisionJudgeInput,
  options?: JevDecisionOptions,
): Promise<VisionJudgeResult> {
  if (activeVisionMockHandler) {
    try {
      const mocked = await activeVisionMockHandler(input);
      if (mocked) {
        return applyVisionGating(mocked, input, options);
      }
    } catch (mockErr: unknown) {
      return {
        score: 0.5,
        pass: true,
        reasons: [],
        source: "heuristic-fallback",
        fallbackReason: `Mock handler error: ${mockErr instanceof Error ? mockErr.message : String(mockErr)}`,
      };
    }
  }
  const apiKey = options?.apiKey ?? getJevApiKey();
  if (!apiKey) {
    return heuristicVisionJudgement(input);
  }
  try {
    return await judgeVisionWithModel(input, options);
  } catch (err: unknown) {
    return {
      score: 0.5,
      pass: true,
      reasons: [],
      source: "heuristic-fallback",
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}
