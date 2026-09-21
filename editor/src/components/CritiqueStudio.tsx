/**
 * File Description: Natural-Language Critique & Revision Studio component (Phase B).
 * Allows operators to refine video and scene parameters using natural language with live PatchOp diff previews,
 * real-time 19-rule validation feedback, atomic rollbacks, and full undo/redo capabilities.
 */

import { useState } from "react";
import type { Film } from "../../../src/dl/schema";
import {
  executeCritique,
  type CritiqueResponse,
} from "../../../backend/critique/engine";
import {
  Bot,
  Undo2,
  Check,
  AlertOctagon,
  MessageSquare,
  Loader2,
  Sparkles,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

export interface CritiqueStudioProps {
  film: Film;
  onUpdateFilm: (film: Film) => void;
  /** True when the project history has a step to go back to. */
  canUndo: boolean;
  onUndo: () => void;
  validationStatus?: { ok: boolean; message: string; rule?: string };
}

const QUICK_CRITIQUES = [
  { label: "ScaleBar to 0.75", prompt: "Make the scale bar density 0.75" },
  { label: "Blueprint Theme", prompt: "Switch visual theme to blueprint" },
  { label: "Smooth Dark Theme", prompt: "Switch visual theme to smooth dark" },
  { label: "Shorten Shot 2", prompt: "Shorten shot 2 by 1 second" },
  { label: "Wave Action Later", prompt: "Make the actor wave later" },
  { label: "Turn Actor Left", prompt: "Set actor facing direction to left" },
];

export function CritiqueStudio({
  film,
  onUpdateFilm,
  canUndo,
  onUndo,
  validationStatus,
}: CritiqueStudioProps) {
  const [critiqueInput, setCritiqueInput] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [pendingResponse, setPendingResponse] =
    useState<CritiqueResponse | null>(null);
  const [history, setHistory] = useState<
    Array<{ critique: string; outcome: string; time: string }>
  >([]);

  const handleSubmit = async (promptText?: string) => {
    const text = (promptText || critiqueInput).trim();
    if (!text || isProcessing) return;

    setIsProcessing(true);
    setPendingResponse(null);

    try {
      let response: CritiqueResponse;
      try {
        const res = await fetch("/api/critique", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ critique: text, film }),
        });
        if (res.ok) {
          response = await res.json();
        } else {
          response = executeCritique({ critique: text, film });
        }
      } catch {
        response = executeCritique({ critique: text, film });
      }

      setPendingResponse(response);

      if (response.ok && response.updatedFilm) {
        setHistory((prev) => [
          {
            critique: text,
            outcome: response.explanation,
            time: new Date().toLocaleTimeString(),
          },
          ...prev.slice(0, 9),
        ]);
      }
    } catch (err: any) {
      setPendingResponse({
        ok: false,
        target: "unsupported",
        explanation: "Execution failure",
        patchOps: [],
        error: err.message || String(err),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyPatch = () => {
    if (pendingResponse?.ok && pendingResponse.updatedFilm) {
      onUpdateFilm(pendingResponse.updatedFilm);
      setPendingResponse(null);
      setCritiqueInput("");
    }
  };

  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-4 overflow-y-auto bg-paper p-5 font-sans text-ink">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b-2 border-ink">
        <div>
          <div className="flex items-center gap-2.5">
            <Bot size={22} className="text-select-text" />
            <h2 className="text-xl font-extrabold tracking-[-0.02em] text-ink">
              Critique Studio
            </h2>
            <span className="text-xs bg-paper-3 text-ink-soft border-2 border-ink px-2.5 py-0.5 font-mono shadow-nb-sm">
              Patch Engine
            </span>
          </div>
          <p className="text-xs text-ink-soft mt-1">
            Instructions to refine timing, visual devices, actors, or themes
            with deep-diff verification.
          </p>
        </div>

        {/* Undo Control */}
        <div className="flex items-center gap-2">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="text-xs px-3.5 py-1.5 bg-paper-3 hover:bg-sunken border-2 border-ink text-ink font-bold transition-all disabled:opacity-40 flex items-center gap-1.5 shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
            title="Revert to previous film state (Undo)"
          >
            <Undo2 size={13} />
            <span>Undo last change</span>
          </button>
        </div>
      </div>

      {/* Real-time Validation Status Banner */}
      {validationStatus && (
        <div
          className={`mt-4 p-3 border text-xs font-mono flex items-center justify-between ${
            validationStatus.ok
              ? "bg-success/25 border-2 border-ink/80 text-ink"
              : "bg-danger/25 border-2 border-ink/90 text-ink"
          }`}
        >
          <div className="flex items-center gap-2">
            {validationStatus.ok ? (
              <Check size={14} className="text-ink" />
            ) : (
              <AlertOctagon size={14} className="text-ink" />
            )}
            <span className="font-bold">
              {validationStatus.ok
                ? "Invariants Healthy:"
                : "Validation Error:"}
            </span>
            <span>{validationStatus.message}</span>
          </div>
          {validationStatus.rule && (
            <span className="text-[10px] bg-danger/25 border-2 border-ink px-2 py-0.5 text-ink shadow-nb-sm">
              {validationStatus.rule}
            </span>
          )}
        </div>
      )}

      {/* Main Critique Input Box */}
      <div className="mt-6 flex flex-col gap-3 bg-paper-3 border-2 border-ink p-5 shadow-nb-sm">
        <label className="text-xs text-ink font-bold uppercase tracking-wider flex items-center gap-2">
          <MessageSquare size={13} />
          <span>Instruction</span>
        </label>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="e.g. Make the scale bar density 0.85, shorten shot 2 by 1 second, or switch theme to blueprint..."
            value={critiqueInput}
            onChange={(e) => setCritiqueInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className="flex-1 bg-paper border-2 border-ink px-4 py-3 text-sm text-ink outline-none focus:border-select placeholder:text-ink-mute font-medium transition-all shadow-nb-sm"
          />
          <button
            onClick={() => handleSubmit()}
            disabled={isProcessing || !critiqueInput.trim()}
            className="px-5 py-3 bg-select hover:bg-select active:scale-95 text-select-ink font-bold text-sm transition-all shadow-nb-sm disabled:opacity-40 flex items-center gap-2 shrink-0"
          >
            {isProcessing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            <span>{isProcessing ? "Analyzing..." : "Review Patch"}</span>
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <span className="text-[11px] text-ink-soft font-mono">
            Suggestions:
          </span>
          {QUICK_CRITIQUES.map((chip) => (
            <button
              key={chip.label}
              onClick={() => {
                setCritiqueInput(chip.prompt);
                handleSubmit(chip.prompt);
              }}
              className="text-[11px] px-2.5 py-1 bg-paper-3 hover:bg-sunken border-2 border-ink text-ink hover:text-ink transition-all font-medium shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Proposed Patch Preview Diff Card */}
      {pendingResponse && (
        <div
          className={`mt-6 p-5 border flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150 ${
            pendingResponse.ok
              ? "bg-paper-3 border-2 border-ink/80 shadow-emerald-950/30"
              : "bg-paper-3 border-2 border-ink/80 shadow-red-950/30"
          }`}
        >
          <div className="flex items-center justify-between border-b-2 border-ink pb-3">
            <div className="flex items-center gap-2">
              {pendingResponse.ok ? (
                <Sparkles size={18} className="text-ink" />
              ) : (
                <AlertTriangle size={18} className="text-ink" />
              )}
              <h3 className="text-sm font-bold text-ink">
                {pendingResponse.ok
                  ? "Proposed Transactional Patch"
                  : "Patch Validation Refusal"}
              </h3>
            </div>
            <span
              className={`text-[11px] font-mono px-2.5 py-0.5 border ${
                pendingResponse.ok
                  ? "bg-success/25 text-ink border-2 border-ink"
                  : "bg-danger/25 text-ink border-2 border-ink"
              }`}
            >
              Target: {pendingResponse.target.toUpperCase()}
            </span>
          </div>

          <div className="text-xs text-ink leading-relaxed">
            {pendingResponse.explanation}
          </div>

          {/* Error / Failing Rule Display */}
          {!pendingResponse.ok && pendingResponse.error && (
            <div className="p-3.5 bg-danger/25 border-2 border-ink/80 text-xs text-ink font-mono space-y-1.5 shadow-nb-sm">
              <div className="font-bold flex items-center gap-1.5 text-ink">
                <AlertOctagon size={14} className="text-ink" />
                <span>
                  Rollback Triggered by:{" "}
                  {pendingResponse.failingRule || "Validation Gate"}
                </span>
              </div>
              <p className="text-[11px] text-ink whitespace-pre-wrap">
                {pendingResponse.error}
              </p>
            </div>
          )}

          {/* PatchOp JSON inspection */}
          {pendingResponse.patchOps.length > 0 && (
            <div className="flex flex-col gap-1.5 font-mono text-xs">
              <span className="text-[11px] text-ink-soft font-bold uppercase">
                Operations ({pendingResponse.patchOps.length}):
              </span>
              <pre className="p-3 bg-paper border-2 border-ink text-ink text-[11px] overflow-x-auto max-h-48 shadow-nb-sm">
                {JSON.stringify(pendingResponse.patchOps, null, 2)}
              </pre>
            </div>
          )}

          {/* Action buttons */}
          {pendingResponse.ok && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setPendingResponse(null)}
                className="text-xs px-4 py-2 text-ink-soft hover:text-ink hover:bg-paper-3 font-semibold transition-all"
              >
                Dismiss
              </button>
              <button
                onClick={handleApplyPatch}
                className="text-xs px-5 py-2.5 bg-success hover:bg-success active:scale-95 text-ink font-bold transition-all shadow-nb-sm shadow-emerald-900/40 flex items-center gap-2"
              >
                <Check size={14} />
                <span>Apply Patch</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Critique History */}
      {history.length > 0 && (
        <div className="mt-8 flex flex-col gap-3">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-ink-soft">
            Recent Critiques ({history.length})
          </h3>
          <div className="flex flex-col gap-2">
            {history.map((item, idx) => (
              <div
                key={idx}
                className="p-3 bg-paper-3 border-2 border-ink flex items-center justify-between text-xs shadow-nb-sm"
              >
                <div className="flex items-center gap-2.5">
                  <Check size={12} className="text-ink shrink-0" />
                  <span className="font-medium text-ink">
                    "{item.critique}"
                  </span>
                  <ArrowRight size={12} className="text-ink-soft shrink-0" />
                  <span className="text-ink-soft">{item.outcome}</span>
                </div>
                <span className="text-[10px] text-ink-mute font-mono">
                  {item.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
