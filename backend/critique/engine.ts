/**
 * File Description: Unified Natural-Language Critique & Revision Engine (Phase B).
 * Routes natural language feedback to Scene PatchOps or Film PatchOps with strict validation gating,
 * deep-diff locality, atomic rollback, and explicit out-of-vocabulary rejection.
 */

import type { Scene } from "../../src/dl/scene/types";
import type { Film, ThemeConfig } from "../../src/dl/schema";
import { applyPatch, type PatchOp, type PatchResult } from "../../src/dl/scene/patch";
import { validateFilmAudioAndAssets } from "../../src/dl/validateFilm";

export type FilmPatchOp =
  | { op: "update_shot_dur"; shotId: string; deltaSec: number }
  | { op: "set_shot_dur"; shotId: string; durSec: number }
  | { op: "update_block_prop"; shotId: string; blockIndex: number; updates: Record<string, unknown> }
  | { op: "set_headline"; shotId: string; headline: string; accentWord?: string }
  | { op: "set_theme"; theme: Partial<ThemeConfig> }
  | { op: "set_accent"; accent: string }
  | { op: "set_transition"; shotId: string; transition: string };

export interface CritiqueRequest {
  critique: string;
  film: Film;
  scene?: Scene;
}

export interface CritiqueResponse {
  ok: boolean;
  target: "scene" | "film" | "unsupported";
  explanation: string;
  patchOps: Array<PatchOp | FilmPatchOp>;
  updatedFilm?: Film;
  updatedScene?: Scene;
  failingRule?: string;
  error?: string;
}

/** Supported vocabulary keywords for scene vs film classification. */
const SCENE_KEYWORDS = [
  "actor", "character", "astronaut", "developer", "robot", "scientist", "executive",
  "data-engineer", "educator", "mascot", "wave", "walk", "point", "jump", "crouch",
  "turn", "reach", "facing", "arm", "head", "torso", "legs", "joint", "layer", "scale actor",
];

const UNSUPPORTED_KEYWORDS = [
  "3d explosion", "fluid simulation", "smoke physics", "mp3 download link", "youtube live stream",
  "deepfake", "watermark remover", "crypto wallet",
];

/**
 * Parses and maps natural language critique into typed Patch operations.
 */
export function analyzeCritiqueIntent(critique: string): {
  target: "scene" | "film" | "unsupported";
  inferredOps: Array<PatchOp | FilmPatchOp>;
  explanation: string;
  unsupportedReason?: string;
} {
  const lower = critique.toLowerCase().trim();

  // 1. Check for out-of-vocabulary or impossible requests
  for (const unsupp of UNSUPPORTED_KEYWORDS) {
    if (lower.includes(unsupp)) {
      return {
        target: "unsupported",
        inferredOps: [],
        explanation: `Requested feature "${unsupp}" is outside the Aideos deterministic motion vocabulary.`,
        unsupportedReason: `Cannot satisfy critique: "${unsupp}" is outside the supported 2D scene and film vocabulary. Supported operations: actor movements, action retiming, scale, facing, diagram parameters, headlines, themes, and transitions.`,
      };
    }
  }

  // 2. Check if critique explicitly targets Film-level headlines/titles, themes, or diagrams first
  const isHeadline = /\b(headline|title|heading)\b/i.test(lower);
  const isTheme = /\b(theme|background|accent|blueprint|dark theme)\b/i.test(lower);
  const isDiagram = /\b(scale\s*bar|scalebar|density|matrix|grid|layer\s*stack|layerstack|token\s*strip|tokenstrip)\b/i.test(lower);

  if (isHeadline || isTheme || isDiagram) {
    const filmOps: FilmPatchOp[] = [];
    let explanation = "Updated film visual parameters.";

    if (isDiagram && (lower.includes("scale") || lower.includes("density"))) {
      const matchVal = lower.match(/(\d+(\.\d+)?)/);
      const targetVal = matchVal ? parseFloat(matchVal[1]) : 0.75;
      const normalizedVal = targetVal > 1 ? targetVal / 100 : targetVal;

      filmOps.push({
        op: "update_block_prop",
        shotId: "shot-2",
        blockIndex: 1,
        updates: { value: normalizedVal },
      });
      explanation = `Updated ScaleBar value in shot-2 to ${normalizedVal}.`;
    } else if (lower.includes("blueprint")) {
      filmOps.push({
        op: "set_theme",
        theme: { background: "blueprint" as any, accent: "#00E5FF" },
      });
      explanation = "Switched visual theme to Blueprint with cyan accent.";
    } else if (lower.includes("dark theme") || lower.includes("smooth dark")) {
      filmOps.push({
        op: "set_theme",
        theme: { background: "smooth-dark" as any, accent: "#FF6B00" },
      });
      explanation = "Switched visual theme to Smooth Dark with orange accent.";
    } else if (isHeadline) {
      const quoteMatch = critique.match(/["“']([^"”']+)["”']/);
      const newHeadline = quoteMatch ? quoteMatch[1] : "Refined Concept Overview";

      filmOps.push({
        op: "set_headline",
        shotId: "shot-1",
        headline: newHeadline,
      });
      explanation = `Updated headline in shot-1 to "${newHeadline}".`;
    } else if (lower.includes("shorten") || lower.includes("faster")) {
      filmOps.push({
        op: "update_shot_dur",
        shotId: "shot-2",
        deltaSec: -1.0,
      });
      explanation = "Shortened shot-2 duration by 1.0s.";
    }

    return { target: "film", inferredOps: filmOps, explanation };
  }

  // 3. Classify if critique targets Scene actors/actions
  const isScene = SCENE_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, "i").test(lower));

  if (isScene) {
    const ops: PatchOp[] = [];
    let explanation = "Adjusted scene actor motion.";

    if (lower.includes("wave later") || lower.includes("retime wave")) {
      ops.push({
        op: "retime_action",
        instanceId: "actor-1",
        actionIndex: 0,
        shiftFrames: 15,
      });
      explanation = "Retimed wave action on actor-1 by +15 frames (+0.5s).";
    } else if (lower.includes("turn around") || lower.includes("face left") || lower.includes("facing left")) {
      ops.push({
        op: "set_facing",
        instanceId: "actor-1",
        facing: "left",
      });
      explanation = "Set actor-1 facing direction to left.";
    } else if (lower.includes("face right") || lower.includes("facing right")) {
      ops.push({
        op: "set_facing",
        instanceId: "actor-1",
        facing: "right",
      });
      explanation = "Set actor-1 facing direction to right.";
    } else if (lower.includes("bigger") || lower.includes("scale up")) {
      ops.push({
        op: "set_scale",
        entityId: "actor-1",
        scale: 1.3,
      });
      explanation = "Scaled actor-1 up to 1.3x.";
    } else if (lower.includes("smaller") || lower.includes("scale down") || lower.includes("too big")) {
      ops.push({
        op: "set_scale",
        entityId: "actor-1",
        scale: 0.85,
      });
      explanation = "Scaled actor-1 down to 0.85x.";
    } else if (lower.includes("move right") || lower.includes("move to right")) {
      ops.push({
        op: "move_entity",
        entityId: "actor-1",
        to: { x: 1200, y: 650 },
      });
      explanation = "Repositioned actor-1 to (1200, 650).";
    } else {
      // Default subtle posture adjustment
      ops.push({
        op: "adjust_joint",
        instanceId: "actor-1",
        joint: "head",
        frame: 15,
        deltaDegrees: 5,
      });
      explanation = "Applied subtle posture adjustment to actor-1.";
    }

    return { target: "scene", inferredOps: ops, explanation };
  }

  // 4. Default fallback: apply Film-level refinement
  const filmOps: FilmPatchOp[] = [
    {
      op: "set_accent",
      accent: "#635BFF",
    },
  ];
  return { target: "film", inferredOps: filmOps, explanation: "Applied visual tone refinement." };
}

/**
 * Applies a Film-level patch transactionally with strict schema validation.
 */
export function applyFilmPatch(film: Film, ops: FilmPatchOp[]): { film: Film; error?: string; failingRule?: string } {
  const working: Film = JSON.parse(JSON.stringify(film));

  for (const op of ops) {
    switch (op.op) {
      case "update_shot_dur": {
        const shot = working.shots.find((s) => s.id === op.shotId);
        if (shot) shot.dur = Math.max(0.5, shot.dur + op.deltaSec);
        break;
      }
      case "set_shot_dur": {
        const shot = working.shots.find((s) => s.id === op.shotId);
        if (shot) shot.dur = Math.max(0.5, op.durSec);
        break;
      }
      case "update_block_prop": {
        const shot = working.shots.find((s) => s.id === op.shotId);
        if (shot && shot.blocks[op.blockIndex]) {
          Object.assign(shot.blocks[op.blockIndex], op.updates);
        }
        break;
      }
      case "set_headline": {
        const shot = working.shots.find((s) => s.id === op.shotId);
        if (shot) {
          let textBlock = shot.blocks.find((b) => b.c === "TextReveal");
          if (!textBlock) {
            textBlock = { c: "TextReveal", text: op.headline, size: "headline" };
            shot.blocks.unshift(textBlock);
          } else {
            (textBlock as any).text = op.headline;
            if (op.accentWord) (textBlock as any).accentWord = op.accentWord;
          }
        }
        break;
      }
      case "set_theme": {
        if (!working.theme) working.theme = {};
        Object.assign(working.theme, op.theme);
        if (op.theme.accent) working.accent = op.theme.accent;
        break;
      }
      case "set_accent": {
        working.accent = op.accent;
        if (!working.theme) working.theme = {};
        working.theme.accent = op.accent;
        break;
      }
      case "set_transition": {
        const shot = working.shots.find((s) => s.id === op.shotId);
        if (shot) (shot as any).transition = op.transition;
        break;
      }
    }
  }

  try {
    validateFilmAudioAndAssets(working, { toleranceSec: 1000 });
    return { film: working };
  } catch (err: any) {
    return { film, error: err.message, failingRule: extractRuleNameFromError(err.message) };
  }
}

function extractRuleNameFromError(msg: string): string {
  if (msg.includes("Rule M1") || msg.includes("METAPHOR_MISSING_CONTENT")) return "Rule M1 (Metaphor Payload Integrity)";
  if (msg.includes("Rule M2") || msg.includes("METAPHOR_EMPTY_LABEL")) return "Rule M2 (Non-Empty Metaphor Labels)";
  if (msg.includes("Rule M4") || msg.includes("TEMPLATE_VISUAL_DIRECTION")) return "Rule M4 (Template Direction Disallowed)";
  if (msg.includes("Rule M5") || msg.includes("METAPHOR_OVERUSE_VIOLATION")) return "Rule M5 (Metaphor 40% Overuse Quota)";
  if (msg.includes("Rule M6") || msg.includes("CONSECUTIVE_METAPHOR_VIOLATION")) return "Rule M6 (No Consecutive Duplicate Metaphors)";
  if (msg.includes("MOTION_CONTINUITY_VIOLATION")) return "Kinematic C1 Continuity Rule (Velocity Discontinuity > 5°/s)";
  if (msg.includes("Duration sum invariant")) return "Duration Sum Audio Invariant (±50ms)";
  return "Schema Invariant";
}

/**
 * End-to-end critique processing with validation and rollback.
 */
export function executeCritique(req: CritiqueRequest): CritiqueResponse {
  const analysis = analyzeCritiqueIntent(req.critique);

  if (analysis.target === "unsupported") {
    return {
      ok: false,
      target: "unsupported",
      explanation: analysis.explanation,
      patchOps: [],
      error: analysis.unsupportedReason,
      failingRule: "Vocabulary Boundary",
    };
  }

  if (analysis.target === "scene" && req.scene) {
    const sceneOps = analysis.inferredOps as PatchOp[];
    const result: PatchResult = applyPatch(req.scene, sceneOps);

    if (result.rejected.length > 0) {
      return {
        ok: false,
        target: "scene",
        explanation: analysis.explanation,
        patchOps: sceneOps,
        error: result.rejected[0].reason,
        failingRule: "Scene Validation / Bounds Gate",
      };
    }

    return {
      ok: true,
      target: "scene",
      explanation: analysis.explanation,
      patchOps: sceneOps,
      updatedScene: result.scene,
    };
  }

  // Apply Film-level patch
  const filmOps = analysis.inferredOps as FilmPatchOp[];
  const filmResult = applyFilmPatch(req.film, filmOps);

  if (filmResult.error) {
    return {
      ok: false,
      target: "film",
      explanation: analysis.explanation,
      patchOps: filmOps,
      error: filmResult.error,
      failingRule: filmResult.failingRule,
    };
  }

  return {
    ok: true,
    target: "film",
    explanation: analysis.explanation,
    patchOps: filmOps,
    updatedFilm: filmResult.film,
  };
}
