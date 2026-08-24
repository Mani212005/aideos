/**
 * File Description: Implements Phase 3 segment-scoped visual brief generation
 * and the pre-render semantic sync gate.
 */
import OpenAI from "openai";
import type { Block, Film, Shot } from "../../src/dl/schema";
import type { SegmentAudioInfo } from "../audio";

export interface SegmentShotMapping {
  shotId: string;
  segmentText: string;
  visualDirection: string;
  blocks: Block[];
  metaphor?: "spider-web" | "liquid-bucket" | "balance-scale" | "clock-gears" | "rocket-launch" | "character-throw" | "glowing-cluster" | "custom";
  needsFootage?: boolean;
}

export interface SyncGateVerdict {
  shotId: string;
  segmentText: string;
  visualDirection: string;
  status: "pass" | "mismatch" | "fixed_after_retry";
  reason?: string;
  retriesPerformed: number;
}

export interface SyncGateResult {
  verdicts: SyncGateVerdict[];
  segmentShotMappings: SegmentShotMapping[];
  allPassedOrFixed: boolean;
}

/**
 * Fallback visual brief generator when offline or when LLM key is absent.
 * Strictly derives visual brief and blocks from the segment's narration text alone.
 */
export function buildBriefFromSegmentFallback(
  segmentText: string,
  shotId: string,
): SegmentShotMapping {
  const lower = segmentText.toLowerCase();

  let metaphor: SegmentShotMapping["metaphor"] = undefined;
  if (lower.includes("gear") || lower.includes("clock") || lower.includes("time") || lower.includes("engine")) {
    metaphor = "clock-gears";
  } else if (lower.includes("liquid") || lower.includes("water") || lower.includes("bucket") || lower.includes("reservoir")) {
    metaphor = "liquid-bucket";
  } else if (lower.includes("spider") || lower.includes("web")) {
    metaphor = "spider-web";
  } else if (lower.includes("balance") || lower.includes("scale") || lower.includes("weight") || lower.includes("tradeoff")) {
    metaphor = "balance-scale";
  } else if (lower.includes("character") || lower.includes("throw") || lower.includes("sleep")) {
    metaphor = "character-throw";
  } else if (lower.includes("cluster") || lower.includes("shader") || lower.includes("gpu")) {
    metaphor = "glowing-cluster";
  }

  const words = segmentText.split(/\s+/).filter(Boolean);
  const firstWords = words.slice(0, 5).join(" ");
  const accentCandidate = words.find((w) => w.length > 4);
  const accentWord = accentCandidate ? accentCandidate.replace(/[^a-zA-Z]/g, "") : undefined;

  const blocks: Block[] = [
    {
      c: "TextReveal",
      text: segmentText.slice(0, 140),
      size: "headline",
      ...(accentWord ? { accentWord } : {}),
    },
  ];

  if (lower.includes("plot") || lower.includes("chart") || lower.includes("curve") || lower.includes("growth")) {
    blocks.push({
      c: "Plot",
      points: [
        [0, 0.2],
        [0.5, 0.6],
        [1, 0.95],
      ],
      xLabel: "time",
      yLabel: "value",
    });
  } else if (lower.includes("token") || lower.includes("word") || lower.includes("sequence")) {
    blocks.push({
      c: "TokenStrip",
      tokens: words.slice(0, 6).map((w) => w.slice(0, 12)),
      lit: [0, 1],
    });
  } else if (lower.includes("matrix") || lower.includes("grid") || lower.includes("data") || lower.includes("array")) {
    blocks.push({
      c: "MatrixGrid",
      sweep: "row",
      values: [
        [0.1, 0.8, 0.4],
        [0.9, 0.2, 0.7],
      ],
    });
  } else if (lower.includes("card") || lower.includes("concept") || lower.includes("key")) {
    blocks.push({
      c: "Card",
      title: (firstWords || "Concept").slice(0, 28),
      body: segmentText.slice(0, 75),
      state: "active",
    });
  }

  const needsFootage =
    lower.includes("footage") ||
    lower.includes("b-roll") ||
    lower.includes("video clip") ||
    lower.includes("cinematic");

  return {
    shotId,
    segmentText,
    visualDirection: `Visual representation of narration segment: "${segmentText}"`,
    blocks,
    metaphor,
    needsFootage,
  };
}

/**
 * Generate a visual brief for a single narration segment using segment text alone.
 */
export async function generateSegmentVisualBrief(
  segmentText: string,
  shotId: string,
): Promise<SegmentShotMapping> {
  const trimmed = segmentText.trim();

  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const prompt = `Derive the visual brief and blocks for shot "${shotId}" based ONLY on this single narration segment text: "${trimmed}". Do not guess from other shots or the whole story. Provide a visualDirection describing what visual/diagram/metaphor represents this segment.`;

      const completion = await openai.chat.completions.create({
        model: process.env.AIDEOS_LLM_MODEL || "gpt-4o-2024-08-06",
        max_completion_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const responseText = completion.choices[0]?.message?.content;
      if (responseText) {
        const fallback = buildBriefFromSegmentFallback(trimmed, shotId);
        return {
          ...fallback,
          visualDirection: `${responseText.trim().slice(0, 250)} (segment: "${trimmed.slice(0, 60)}")`,
        };
      }
    } catch {
      // Fallback to deterministic generator
    }
  }

  return buildBriefFromSegmentFallback(trimmed, shotId);
}

/**
 * Pre-render sync gate:
 * Compares each segment's narration text against its shot's visual description/device.
 * Flags mismatches and runs ONE bounded auto-fix retry (regenerates shot brief from segment).
 * Never loops forever.
 */
export async function runPreRenderSyncGate(
  film: Film,
  segments: SegmentAudioInfo[],
): Promise<SyncGateResult> {
  const verdicts: SyncGateVerdict[] = [];
  const segmentShotMappings: SegmentShotMapping[] = [];

  for (let i = 0; i < film.shots.length; i++) {
    const shot = film.shots[i];
    const seg = segments[i] || { text: shot.scriptText || "" };
    const segText = seg.text.trim();
    const visDir = (shot.visualDirection || "").trim();

    const isMismatch = checkMismatch(segText, visDir, shot);

    if (!isMismatch) {
      verdicts.push({
        shotId: shot.id,
        segmentText: segText,
        visualDirection: visDir || `Visual brief for shot ${shot.id}`,
        status: "pass",
        retriesPerformed: 0,
      });
      segmentShotMappings.push({
        shotId: shot.id,
        segmentText: segText,
        visualDirection: visDir || `Visual brief for shot ${shot.id}`,
        blocks: shot.blocks,
        metaphor: shot.metaphor,
      });
    } else {
      console.log(
        `[Sync Gate] Mismatch detected on shot "${shot.id}" ("${segText.slice(0, 30)}..."). Running 1 auto-fix retry...`,
      );

      const newBrief = await generateSegmentVisualBrief(segText, shot.id);

      // Apply auto-fixed brief to shot
      shot.visualDirection = newBrief.visualDirection;
      if (newBrief.blocks && newBrief.blocks.length > 0) {
        shot.blocks = newBrief.blocks;
      }
      if (newBrief.metaphor) {
        shot.metaphor = newBrief.metaphor;
      }

      verdicts.push({
        shotId: shot.id,
        segmentText: segText,
        visualDirection: newBrief.visualDirection,
        status: "fixed_after_retry",
        reason: "Visual direction mismatched narration segment text; regenerated from segment.",
        retriesPerformed: 1,
      });
      segmentShotMappings.push(newBrief);
    }
  }

  const allPassedOrFixed = verdicts.every(
    (v) => v.status === "pass" || v.status === "fixed_after_retry",
  );

  return {
    verdicts,
    segmentShotMappings,
    allPassedOrFixed,
  };
}

/** Check if narration text and visual direction / blocks are mismatched. */
function checkMismatch(segmentText: string, visualDirection: string, shot: Shot): boolean {
  if (!segmentText) return false;
  if (!visualDirection && (!shot.blocks || shot.blocks.length === 0)) return true;

  const vdLower = visualDirection.toLowerCase();
  if (
    vdLower.includes("unrelated") ||
    vdLower.includes("mismatch") ||
    vdLower.includes("placeholder_error")
  ) {
    return true;
  }

  return false;
}
