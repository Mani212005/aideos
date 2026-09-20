/**
 * File Description: Comprehensive Semantic Validator for Video Edit Programs (Phase 2).
 * Validates EditOp programs against the closed Zod schema, semantic timeline bounds,
 * referenced entity integrity, and a dry-run simulation against validateLayeredFilm.
 * Enforces the "add the rule to the validator, not just the prompt" principle.
 */

import type { EditContext } from "../editContext/buildEditContext";
import type { LayeredFilm, Layer, Clip } from "../../src/dl/layeredSchema";
import { editProgramSchema, type EditOp } from "./schema";
import { applyEditProgram } from "./interpreter";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";

export interface EditProgramValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  program?: EditOp[];
}

/**
 * Constructs a minimal LayeredFilm from an EditContext to enable dry-run simulation.
 */
function createLayeredFilmFromContext(context: EditContext): LayeredFilm {
  const layers: Layer[] = context.lanes.map((l) => ({
    id: l.id,
    label: l.label,
    number: l.number,
    hidden: l.hidden,
    muted: l.muted,
    locked: l.locked,
    height: 48,
  }));

  const clips: Clip[] = context.clips.map((c) => ({
    id: c.id,
    layerId: c.layerId,
    position: c.position,
    start: c.start,
    end: c.end,
    kind: c.kind as any,
    payload: { src: "media/source.mp4" },
    opacity: 1,
    volume: 1,
  }));

  return {
    id: "context-film",
    title: "Context Film",
    fps: (context.meta.fps as 24 | 30 | 60) || 30,
    accent: context.meta.accent || "#635BFF",
    theme: context.meta.theme,
    canvas: { nodes: [{ id: "n1", label: "Scene", x: 0, y: 0, w: 190, h: 62 }], edges: [] },
    chapters: [],
    layers,
    clips,
  };
}

/**
 * Validates an edit program array against schema, semantic rules, and dry-run simulation.
 */
export function validateEditProgram(
  input: unknown,
  context: EditContext,
): EditProgramValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Zod schema validation (Closed union rejects unknown ops)
  const parseResult = editProgramSchema.safeParse(input);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const pathStr = issue.path.join(".");
      errors.push(`Schema violation at ${pathStr || "root"}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const ops = parseResult.data;
  if (ops.length === 0) {
    errors.push("Edit program is empty: at least one edit operation is required");
    return { valid: false, errors, warnings };
  }

  const knownClipIds = new Set(context.clips.map((c) => c.id));
  const knownLaneIds = new Set(context.lanes.map((l) => l.id));
  const filmDuration =
    context.meta.durationSec ||
    context.clips.reduce((max, c) => Math.max(max, c.position + (c.end - c.start)), 0) ||
    3600;

  // 2. Semantic parameter checks
  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx];
    const opPrefix = `Op #${idx + 1} (${op.op}):`;

    switch (op.op) {
      case "add_text_overlay": {
        if (op.startSec >= op.endSec) {
          errors.push(`${opPrefix} startSec (${op.startSec}) must be strictly less than endSec (${op.endSec})`);
        }
        if (op.startSec < 0) {
          errors.push(`${opPrefix} startSec (${op.startSec}) cannot be negative`);
        }
        if (op.endSec > filmDuration + 10) {
          warnings.push(`${opPrefix} endSec (${op.endSec}) extends past film duration (${filmDuration.toFixed(1)}s)`);
        }
        if (!op.text || op.text.trim().length === 0) {
          errors.push(`${opPrefix} text content cannot be empty`);
        }
        break;
      }

      case "add_slide": {
        if (op.startSec >= op.endSec) {
          errors.push(`${opPrefix} startSec (${op.startSec}) must be strictly less than endSec (${op.endSec})`);
        }
        if (op.startSec < 0) {
          errors.push(`${opPrefix} startSec (${op.startSec}) cannot be negative`);
        }
        break;
      }

      case "add_caption_track": {
        if (op.fromSec !== undefined && op.toSec !== undefined && op.fromSec >= op.toSec) {
          errors.push(`${opPrefix} fromSec (${op.fromSec}) must be strictly less than toSec (${op.toSec})`);
        }
        break;
      }

      case "remove_fillers": {
        if (op.scope && typeof op.scope === "object" && !Array.isArray(op.scope)) {
          if (op.scope.fromSec >= op.scope.toSec) {
            errors.push(`${opPrefix} scope fromSec (${op.scope.fromSec}) must be strictly less than toSec (${op.scope.toSec})`);
          }
        }
        break;
      }

      case "remove_dead_air": {
        if (op.range && op.range.fromSec >= op.range.toSec) {
          errors.push(`${opPrefix} range fromSec (${op.range.fromSec}) must be strictly less than toSec (${op.range.toSec})`);
        }
        if (op.minSilenceSec !== undefined && op.targetGapSec !== undefined && op.minSilenceSec <= op.targetGapSec) {
          warnings.push(`${opPrefix} minSilenceSec (${op.minSilenceSec}) should be greater than targetGapSec (${op.targetGapSec})`);
        }
        break;
      }

      case "trim_range": {
        if (op.fromSec >= op.toSec) {
          errors.push(`${opPrefix} fromSec (${op.fromSec}) must be strictly less than toSec (${op.toSec})`);
        }
        if (op.fromSec < 0) {
          errors.push(`${opPrefix} fromSec (${op.fromSec}) cannot be negative`);
        }
        break;
      }

      case "split_at": {
        if (op.atSec < 0 || op.atSec > filmDuration + 5) {
          errors.push(`${opPrefix} atSec (${op.atSec}) is out of timeline bounds [0, ${filmDuration.toFixed(1)}]`);
        }
        if (op.clipId && !knownClipIds.has(op.clipId)) {
          errors.push(`${opPrefix} referenced clipId "${op.clipId}" does not exist in timeline context`);
        }
        break;
      }

      case "move_clip": {
        if (!knownClipIds.has(op.clipId)) {
          errors.push(`${opPrefix} referenced clipId "${op.clipId}" does not exist in timeline context`);
        }
        if (op.toSec < 0) {
          errors.push(`${opPrefix} toSec (${op.toSec}) cannot be negative`);
        }
        break;
      }

      case "set_clip_speed": {
        if (op.clipId !== "base" && !knownClipIds.has(op.clipId)) {
          errors.push(`${opPrefix} referenced clipId "${op.clipId}" does not exist in timeline context`);
        }
        if (op.factor <= 0) {
          errors.push(`${opPrefix} speed factor must be positive`);
        }
        break;
      }

      case "set_volume": {
        if (op.clipId && !knownClipIds.has(op.clipId)) {
          errors.push(`${opPrefix} referenced clipId "${op.clipId}" does not exist in timeline context`);
        }
        if (op.laneId && !knownLaneIds.has(op.laneId)) {
          errors.push(`${opPrefix} referenced laneId "${op.laneId}" does not exist in timeline context`);
        }
        if (op.volume < 0 || op.volume > 1) {
          errors.push(`${opPrefix} volume (${op.volume}) must be in range [0, 1]`);
        }
        break;
      }

      case "mute_lane":
      case "hide_lane": {
        if (!knownLaneIds.has(op.laneId)) {
          errors.push(`${opPrefix} referenced laneId "${op.laneId}" does not exist in timeline context`);
        }
        break;
      }

      case "set_accent": {
        if (!/^#[0-9a-fA-F]{6}$/.test(op.hex)) {
          errors.push(`${opPrefix} accent hex code "${op.hex}" must be a 6-digit hex color (e.g. #635BFF)`);
        }
        break;
      }

      case "reorder_segments": {
        for (const cid of op.order) {
          if (!knownClipIds.has(cid)) {
            errors.push(`${opPrefix} referenced clipId "${cid}" in order list does not exist in timeline context`);
          }
        }
        break;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // 3. Dry-run simulation gate: ensure applying the program produces a valid LayeredFilm
  try {
    const workingFilm = createLayeredFilmFromContext(context);
    const result = applyEditProgram(workingFilm, ops, context);
    if (result.rejected.length > 0) {
      for (const rej of result.rejected) {
        errors.push(`Simulation failed for ${rej.op.op}: ${rej.reason}`);
      }
    } else {
      validateLayeredFilm(result.film);
    }
  } catch (err: unknown) {
    const dryRunError = err instanceof Error ? err.message : String(err);
    errors.push(`Dry-run simulation failed: ${dryRunError}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    program: errors.length === 0 ? ops : undefined,
  };
}
