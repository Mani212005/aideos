/**
 * File Description: Model-Driven AI Video Editor Panel Component (Phase 2).
 * Replaces hardcoded regex heuristics with a model-driven planning and execution workflow.
 * Allows users to request edits in natural language, reviews the generated natural-language
 * plan and discrete EditOp checklist (dry-run-then-apply), and commits changes as a single undo step.
 */

import React, { useState, useMemo } from "react";
import { Sparkles, Check, X, Loader2, ArrowRight, Wand2 } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import type { TimedShot } from "../../../src/dl/camera";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../../src/dl/convertFilm";
import { applyEditProgram } from "../../../backend/editPlanner/interpreter";
import type { EditOp } from "../../../backend/editPlanner/schema";
import type { EditContext } from "../../../backend/editContext/buildEditContext";

interface OnCanvasAiEditorProps {
  film: Film;
  timeline: TimedShot[];
  currentFrame: number;
  onUpdateFilm: (updatedFilm: Film) => void;
  accent?: string;
}

interface PlannedState {
  plan: string;
  ops: EditOp[];
  warnings: string[];
  context?: EditContext;
}

/** Formats an EditOp into a readable summary for the operations checklist. */
function describeEditOp(op: EditOp): string {
  switch (op.op) {
    case "add_text_overlay":
      return `Text Overlay: "${op.text}" at ${op.startSec.toFixed(1)}s - ${op.endSec.toFixed(1)}s (${op.position || "bottom"})`;
    case "add_slide":
      return `Slide: ${op.visualDirection || "Visual graphic"} at ${op.startSec.toFixed(1)}s - ${op.endSec.toFixed(1)}s`;
    case "add_caption_track":
      return `Caption Track: ${op.style || "kinetic"} style${op.fromSec !== undefined ? ` from ${op.fromSec}s` : ""}`;
    case "remove_fillers":
      return `Remove Fillers: scope=${typeof op.scope === "object" ? "custom range" : op.scope || "all"}`;
    case "remove_dead_air":
      return `Remove Dead Air: minSilence=${op.minSilenceSec ?? 0.6}s, gap=${op.targetGapSec ?? 0.1}s`;
    case "trim_range":
      return `Trim Range: ${op.fromSec.toFixed(1)}s - ${op.toSec.toFixed(1)}s`;
    case "split_at":
      return `Split: at ${op.atSec.toFixed(1)}s${op.clipId ? ` on ${op.clipId}` : ""}`;
    case "move_clip":
      return `Move Clip: "${op.clipId}" to ${op.toSec.toFixed(1)}s`;
    case "set_clip_speed":
      return `Set Speed: "${op.clipId}" factor=${op.factor}x`;
    case "set_volume":
      return `Set Volume: ${op.clipId ? `clip "${op.clipId}"` : `lane "${op.laneId}"`} = ${(op.volume * 100).toFixed(0)}%`;
    case "mute_lane":
      return `${op.muted !== false ? "Mute" : "Unmute"} Lane: "${op.laneId}"`;
    case "hide_lane":
      return `${op.hidden !== false ? "Hide" : "Show"} Lane: "${op.laneId}"`;
    case "set_accent":
      return `Set Accent Color: ${op.hex}`;
    case "set_theme":
      return `Update Theme Configuration`;
    case "reorder_segments":
      return `Reorder Segments: ${op.order.length} clips`;
    default:
      return (op as any).op;
  }
}

export const OnCanvasAiEditor: React.FC<OnCanvasAiEditorProps> = ({
  film,
  onUpdateFilm,
  accent,
}) => {
  const [promptInput, setPromptInput] = useState<string>("");
  const [isPlanning, setIsPlanning] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [plannedState, setPlannedState] = useState<PlannedState | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  // Suggested prompt chips for quick actions
  const suggestionChips = useMemo(() => [
    "Remove filler words",
    "Trim dead air",
    "Add title overlay at start",
    "Mute footage audio",
  ], []);

  /** Requests an edit plan from the server endpoint /api/ai-edit. */
  const handlePlanEdits = async (requestText?: string) => {
    const query = (requestText || promptInput).trim();
    if (!query || isPlanning) return;

    setIsPlanning(true);
    setStatusMessage(null);
    setPlannedState(null);

    try {
      const res = await fetch("/api/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          film,
          request: query,
          dryRun: true,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to plan edits");
      }

      setPlannedState({
        plan: data.plan,
        ops: data.ops || [],
        warnings: data.warnings || [],
        context: data.context,
      });
    } catch (err: unknown) {
      setStatusMessage({
        text: err instanceof Error ? err.message : String(err),
        isError: true,
      });
    } finally {
      setIsPlanning(false);
    }
  };

  /** Applies the approved edit plan via the pure interpreter and commits a single undo step. */
  const handleApplyPlan = () => {
    if (!plannedState || isApplying) return;

    setIsApplying(true);
    setStatusMessage(null);

    try {
      const layered = convertFilmToLayeredFilm(film);
      const result = applyEditProgram(layered, plannedState.ops, plannedState.context);

      if (result.rejected.length > 0) {
        const firstRej = result.rejected[0];
        setStatusMessage({
          text: `Application rejected: ${firstRej.reason}`,
          isError: true,
        });
        setIsApplying(false);
        return;
      }

      const updatedFilm = convertLayeredFilmToFilm(result.film, film);
      onUpdateFilm(updatedFilm);

      void fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film: updatedFilm }),
      }).catch(() => undefined);

      setStatusMessage({
        text: "Applied AI edit successfully!",
        isError: false,
      });
      setPlannedState(null);
      setPromptInput("");
    } catch (err: unknown) {
      setStatusMessage({
        text: err instanceof Error ? err.message : String(err),
        isError: true,
      });
    } finally {
      setIsApplying(false);
    }
  };

  /** Cancels and discards the current planned edit state. */
  const handleDiscardPlan = () => {
    setPlannedState(null);
    setStatusMessage(null);
  };

  return (
    <div className="absolute bottom-4 right-4 z-40 max-w-lg w-full flex flex-col font-sans">
      {/* Container Box */}
      <div className="bg-paper-2 border-2 border-ink shadow-[4px_4px_0px_#14140f] rounded-lg overflow-hidden flex flex-col">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-sunken border-b-2 border-ink">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-ink" style={{ color: accent || "#5b4bff" }} />
            <span className="font-mono text-xs font-bold text-ink tracking-tight uppercase">
              AI Video Editor
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="font-mono text-xs text-ink hover:underline font-bold"
          >
            {isExpanded ? "Minimize" : "Expand"}
          </button>
        </div>

        {isExpanded && (
          <div className="p-3 flex flex-col gap-3 bg-paper-2">
            {/* Suggestion Chips */}
            {!plannedState && (
              <div className="flex flex-wrap gap-1.5">
                {suggestionChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setPromptInput(chip);
                      void handlePlanEdits(chip);
                    }}
                    disabled={isPlanning}
                    className="text-xs font-mono px-2 py-1 bg-paper border border-ink rounded hover:bg-sunken text-ink transition-colors disabled:opacity-50"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            )}

            {/* Prompt Input Form */}
            {!plannedState && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handlePlanEdits();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder="Ask AI to edit (e.g. 'remove filler words and trim dead air')..."
                  disabled={isPlanning}
                  className="flex-1 px-3 py-1.5 bg-paper-3 border-2 border-ink rounded font-mono text-xs text-ink placeholder:text-ink-mute focus:outline-none focus:ring-2 focus:ring-select"
                />
                <button
                  type="submit"
                  disabled={isPlanning || !promptInput.trim()}
                  className="px-3 py-1.5 bg-select text-paper-3 border-2 border-ink rounded font-mono text-xs font-bold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
                  style={{ backgroundColor: accent || "#5b4bff" }}
                >
                  {isPlanning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      Plan <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Generated Plan Review Surface (Dry-run-then-apply) */}
            {plannedState && (
              <div className="flex flex-col gap-2.5 p-3 bg-paper border-2 border-ink rounded">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold uppercase text-ink flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5" /> Planned Changes ({plannedState.ops.length} ops)
                  </span>
                  <button
                    type="button"
                    onClick={handleDiscardPlan}
                    className="p-1 text-ink hover:bg-sunken rounded"
                    title="Discard Plan"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Natural language summary paragraph */}
                <p className="text-xs text-ink font-sans leading-relaxed bg-paper-2 p-2 border border-ink rounded">
                  {plannedState.plan}
                </p>

                {/* Checklist of operations */}
                <div className="max-h-36 overflow-y-auto flex flex-col gap-1 pr-1">
                  {plannedState.ops.map((op, idx) => (
                    <div
                      key={idx}
                      className="text-xs font-mono px-2 py-1 bg-paper-3 border border-ink/40 rounded flex items-center gap-2 text-ink"
                    >
                      <Check className="w-3 h-3 text-success shrink-0" />
                      <span className="truncate">{describeEditOp(op)}</span>
                    </div>
                  ))}
                </div>

                {/* Action Controls */}
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-ink/20">
                  <button
                    type="button"
                    onClick={handleDiscardPlan}
                    disabled={isApplying}
                    className="px-3 py-1 bg-paper border-2 border-ink rounded font-mono text-xs font-bold text-ink hover:bg-sunken"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyPlan}
                    disabled={isApplying}
                    className="px-3 py-1 bg-success text-ink border-2 border-ink rounded font-mono text-xs font-bold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50"
                  >
                    {isApplying ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" /> Apply Edits
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Status Message Notification */}
            {statusMessage && (
              <div
                className={`text-xs font-mono px-2.5 py-1.5 border-2 border-ink rounded flex items-center justify-between ${
                  statusMessage.isError ? "bg-danger text-paper-3" : "bg-success text-ink"
                }`}
              >
                <span>{statusMessage.text}</span>
                <button
                  type="button"
                  onClick={() => setStatusMessage(null)}
                  className="ml-2 hover:opacity-75 font-bold"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
