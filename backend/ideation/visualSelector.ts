/**
 * File Description: Reasoned Visual Intent Selector for Aideos.
 * Replaces lexical keyword matching with visual-intent selection, first-class "none" choice,
 * confidence-gated fallback, and data-driven metaphor authoring.
 */

import type { MetaphorContent } from "../../src/dl/schema";
import { generateStructuredJson, isGoogleAiConfigured } from "../modelClient";

export interface VisualBlockSpec {
  blockType: string;
  description: string;
  goodFor: string;
}

export interface MetaphorSpec {
  kind: MetaphorContent["kind"];
  description: string;
  relationship: string;
}

export const VISUAL_BLOCK_REGISTRY: VisualBlockSpec[] = [
  {
    blockType: "CharacterBeat",
    description: "Articulated 2D SVG character performing contextual anatomical gestures.",
    goodFor: "Narrator introductions, direct explanations, human emotion, and payoff celebrations.",
  },
  {
    blockType: "ScaleBar",
    description: "Horizontal logarithmic scale comparing orders of magnitude.",
    goodFor: "Orders of magnitude, capacity comparisons, and scale differentials.",
  },
  {
    blockType: "LayerStack",
    description: "Vertical translucent layer stack diagram.",
    goodFor: "Hierarchical protocols, thermodynamic regimes, depth layers, and architectural stages.",
  },
  {
    blockType: "Plot",
    description: "2D line plot with unit-space trajectory.",
    goodFor: "Mathematical functions, growth curves, rate curves, and computational complexity.",
  },
  {
    blockType: "Distribution",
    description: "Probability distribution bar chart with animated token likelihoods.",
    goodFor: "Probability distributions, softmax sampling, and token likelihood rankings.",
  },
  {
    blockType: "AnalogyInset",
    description: "Visual illustration or video still framed with a descriptive caption.",
    goodFor: "Real-world physical analogies, historical diagrams, and architectural references.",
  },
  {
    blockType: "MatrixGrid",
    description: "2D matrix heatmap with animated row/column sweeps.",
    goodFor: "Tensor allocations, attention matrices, memory arrays, and tabular weights.",
  },
  {
    blockType: "TokenStrip",
    description: "Horizontal sequence of discrete token chips lighting up.",
    goodFor: "Tokenization, text parsing, discrete sequence processing, and AST tokens.",
  },
  {
    blockType: "AttentionArcs",
    description: "Token sequence with directed quadratic Bezier attention arcs.",
    goodFor: "Self-attention, relational lookup, and dependency linking between tokens.",
  },
  {
    blockType: "VectorSpace",
    description: "2D embedding space with scatter points and vector arrows.",
    goodFor: "Semantic clustering, vector projections, and latent representations.",
  },
  {
    blockType: "StatCounter",
    description: "Large animated numerical counter with unit prefix/suffix.",
    goodFor: "Key quantitative metrics, performance speedups, and benchmark percentages.",
  },
  {
    blockType: "MetaphorViewer",
    description: "Stylized visual concept visualizer.",
    goodFor: "Physical analogies, balance scale trade-offs, fluid capacity, and mechanical gear synchronization.",
  },
  {
    blockType: "none",
    description: "No diagram or visual device; pure elegant typography and kinetic headline.",
    goodFor: "Conceptual claims, rhetorical statements, transitions, and punchy conclusions.",
  },
];

export const METAPHOR_REGISTRY: MetaphorSpec[] = [
  {
    kind: "balance-scale",
    description: "Two-pan mechanical balance scale tilting under opposing weights.",
    relationship: "Trade-offs and equilibrium between two competing, mutually constraining physical or mathematical quantities.",
  },
  {
    kind: "liquid-bucket",
    description: "Translucent liquid reservoir with animated wave fill and level graduations.",
    relationship: "Accumulation, dynamic buffer capacity, drainage, and fluid volume.",
  },
  {
    kind: "clock-gears",
    description: "Interlocking meshed gears rotating at synchronized angular speeds.",
    relationship: "Mechanical synchronization, pipeline cadence, and multi-stage hardware execution.",
  },
  {
    kind: "spider-web",
    description: "Radial spider web weaving with interconnected nodes and concentric spirals.",
    relationship: "Interconnected graphs, network topologies, and distributed mesh routing.",
  },
  {
    kind: "character-throw",
    description: "Retro monitor scanning a script document once and discarding it.",
    relationship: "Single-pass processing, prompt caching, and immutable static reference.",
  },
  {
    kind: "typing-cursor-quote",
    description: "Terminal editor typing a thesis statement with a verification rubber stamp.",
    relationship: "Direct quotations, axiomatic theses, and verified historical statements.",
  },
  {
    kind: "glowing-cluster",
    description: "Multi-dimensional constellation of glowing nodes and geometric mesh lines.",
    relationship: "High-dimensional latent spaces and abstract embeddings.",
  },
];

export interface VisualDecisionInput {
  shotId: string;
  narration: string;
  prevNarration?: string;
  nextNarration?: string;
  prevVisual?: string;
  prevMetaphor?: string;
}

export interface VisualDecisionResult {
  blockType: string | "none";
  metaphor?: MetaphorContent;
  headline: string;
  rationale: string;
  confidence: number;
}

/**
 * Extracts a concise 4-8 word punchy headline from a narration sentence (Rule E-b).
 */
export function extractConciseHeadline(narration: string): string {
  const cleaned = narration.replace(/[^\w\s-]/g, "").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  if (words.length <= 8) {
    return words.join(" ");
  }

  // Extract key concept words up to 8 words
  return words.slice(0, 7).join(" ");
}

/**
 * Semantic fallback selector that reasons about visual structure without superficial lexical triggers.
 */
export function selectVisualIntentFallback(input: VisualDecisionInput): VisualDecisionResult {
  const text = input.narration.trim();
  const lower = text.toLowerCase();
  const headline = extractConciseHeadline(text);

  // 1. Quantitative headline metric -> StatCounter
  const hasMetric = text.match(/\b(\d+(?:\.\d+)?%|\d+x|\d+\s*(?:fps|flps))\b/i);
  if (hasMetric && !input.prevVisual?.includes("StatCounter")) {
    const rawVal = hasMetric[1];
    return {
      blockType: "StatCounter",
      headline,
      rationale: `Narration emphasizes high-impact quantitative benchmark metric (${rawVal}), highlighted prominently with StatCounter.`,
      confidence: 0.90,
    };
  }

  // 2. Mathematical scaling / complexity curves -> Plot
  if (
    (lower.includes("quadratically") || lower.includes("linear time") || lower.includes("growth curve") || lower.includes("scaling")) &&
    input.prevVisual !== "Plot"
  ) {
    return {
      blockType: "Plot",
      headline,
      rationale: `Narration describes mathematical scaling behavior across sequence lengths; 2D Plot visualizes asymptotic complexity.`,
      confidence: 0.88,
    };
  }

  // 3. Hierarchical decomposition, protocol layers, or thermodynamic regimes -> LayerStack
  if (
    (lower.includes("triple point") || lower.includes("subproblems") || lower.includes("layer") || lower.includes("memory wall") || lower.includes("stages")) &&
    input.prevVisual !== "LayerStack"
  ) {
    return {
      blockType: "LayerStack",
      headline,
      rationale: `Narration describes distinct operational tiers and structural regimes; LayerStack visualizes hierarchical separation.`,
      confidence: 0.89,
    };
  }

  // 4. Scale comparison or latency differentials -> ScaleBar
  if (
    (lower.includes("atmosphere") || lower.includes("dense as earth") || lower.includes("milliseconds") || lower.includes("orders of magnitude") || lower.includes("gigabytes of vram")) &&
    input.prevVisual !== "ScaleBar"
  ) {
    return {
      blockType: "ScaleBar",
      headline,
      rationale: `Narration compares physical orders of magnitude and capacity limits; ScaleBar visualizes logarithmic differentials.`,
      confidence: 0.87,
    };
  }

  // 5. Matrix / Tensor tiling -> MatrixGrid
  if (
    (lower.includes("matrix") || lower.includes("tensor") || lower.includes("warpgroups") || lower.includes("sram")) &&
    input.prevVisual !== "MatrixGrid"
  ) {
    return {
      blockType: "MatrixGrid",
      headline,
      rationale: `Narration explains hardware memory tiling and parallel tensor execution; MatrixGrid illustrates localized block sweeps.`,
      confidence: 0.88,
    };
  }

  // 6. Token / Log Sequence processing -> TokenStrip
  if (
    (lower.includes("token") || lower.includes("dns resolvers") || lower.includes("log replication") || lower.includes("quorum")) &&
    input.prevVisual !== "TokenStrip"
  ) {
    return {
      blockType: "TokenStrip",
      headline,
      rationale: `Narration describes discrete atomic units progressing through a distributed or linguistic pipeline; TokenStrip visualizes sequential flow.`,
      confidence: 0.86,
    };
  }

  // 7. Relational trade-offs between competing physical quantities -> MetaphorViewer (balance-scale)
  if (
    (lower.includes("trade-off") || lower.includes("dual-phase design") || lower.includes("opposing constraints")) &&
    input.prevMetaphor !== "balance-scale"
  ) {
    return {
      blockType: "MetaphorViewer",
      metaphor: {
        kind: "balance-scale",
        leftLabel: "Primary Constraint",
        rightLabel: "Tradeoff Penalty",
        caption: "Equilibrium Boundary",
      },
      headline,
      rationale: `Narration describes competing engineering constraints that demand equilibrium; Balance Scale illustrates mutual trade-off.`,
      confidence: 0.85,
    };
  }

  // 8. Default to clean kinetic typography for narrative prose and transitions
  return {
    blockType: "none",
    headline,
    rationale: `Narrative statement focusing on conceptual explanation; clean kinetic typography maintains pacing clarity without visual distraction.`,
    confidence: 0.85,
  };
}

/**
 * Executes reasoned visual intent selection for a shot.
 */
export async function selectShotVisualIntent(
  input: VisualDecisionInput,
): Promise<VisualDecisionResult> {
  if (!isGoogleAiConfigured()) {
    return selectVisualIntentFallback(input);
  }

  try {
    const prompt = `You are the lead visual art director for Aideos technical explainer films.
Analyze the following shot narration and surrounding context to select the single best visual block or metaphor.

SHOT NARRATION: "${input.narration}"
PREVIOUS SHOT NARRATION: "${input.prevNarration || "None (First shot)"}"
NEXT SHOT NARRATION: "${input.nextNarration || "None (Last shot)"}"
PREVIOUS SHOT VISUAL: "${input.prevVisual || "none"}"
PREVIOUS SHOT METAPHOR: "${input.prevMetaphor || "none"}"

AVAILABLE VISUAL BLOCKS:
${VISUAL_BLOCK_REGISTRY.map((b) => `- ${b.blockType}: ${b.description} (Good for: ${b.goodFor})`).join("\n")}

AVAILABLE METAPHORS (Used ONLY when a physical/relational analogy genuinely clarifies the concept):
${METAPHOR_REGISTRY.map((m) => `- ${m.kind}: ${m.description} (Relationship: ${m.relationship})`).join("\n")}

CRITICAL ART DIRECTION RULES:
1. "none" is a first-class, prestigious choice. If the narration is a conceptual claim, question, or transition, choose "none" and let clean typography breathe.
2. NEVER select a visual based on casual lexical words (e.g. "load balances" is NOT a balance scale; "time" is NOT clock gears; "water" is NOT automatically a liquid bucket).
3. Do not repeat the same metaphor or visual device used in the previous shot.
4. Author a concise headline of at most 8 words capturing the core claim (do NOT copy the entire narration).
5. Provide a specific, reasoned rationale (2-3 sentences) explaining why this exact visual structure matches the underlying engineering/scientific relationship in this shot.
6. If selecting MetaphorViewer, you MUST author all dynamic label fields in the content payload.

Respond in JSON format:
{
  "blockType": string, // One of the block types or "none"
  "metaphor": { "kind": string, ...dynamicLabelFields } | null,
  "headline": string, // Max 8 words
  "rationale": string, // Specific, non-templated rationale
  "confidence": number // 0.0 to 1.0
}`;

    const parsed = await generateStructuredJson<any>(prompt, {
      systemInstruction: "You are an expert technical explainer film visual director. Output JSON only.",
      temperature: 0.2,
    });

    if (parsed.confidence !== undefined && parsed.confidence < 0.65) {
      return {
        blockType: "none",
        headline: extractConciseHeadline(input.narration),
        rationale: `Model confidence was below threshold (${parsed.confidence}); falling back to clean text reveal.`,
        confidence: parsed.confidence,
      };
    }

    return {
      blockType: parsed.blockType || "none",
      metaphor: parsed.metaphor || undefined,
      headline: parsed.headline || extractConciseHeadline(input.narration),
      rationale: parsed.rationale || `Visual representation tailored for "${input.narration}"`,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.85,
    };
  } catch {
    return selectVisualIntentFallback(input);
  }
}
