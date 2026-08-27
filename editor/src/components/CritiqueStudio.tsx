/**
 * File Description: Natural-Language Critique & Revision Studio component (Phase B).
 * Allows operators to refine video and scene parameters using natural language with live PatchOp diff previews,
 * real-time 19-rule validation feedback, atomic rollbacks, and full undo/redo capabilities.
 */

import { useState } from "react";
import type { Film } from "../../../src/dl/schema";
import { executeCritique, type CritiqueResponse } from "../../../backend/critique/engine";

interface CritiqueStudioProps {
  film: Film;
  onUpdateFilm: (film: Film) => void;
  undoStack: Film[];
  onUndo: () => void;
  validationStatus?: { ok: boolean; message: string; rule?: string };
}

const QUICK_CRITIQUES = [
  { label: "🎯 ScaleBar to 0.75", prompt: "Make the scale bar density 0.75" },
  { label: "🎨 Blueprint Theme", prompt: "Switch visual theme to blueprint" },
  { label: "🌑 Smooth Dark Theme", prompt: "Switch visual theme to smooth dark" },
  { label: "⏱️ Shorten Shot 2", prompt: "Shorten shot 2 by 1 second" },
  { label: "👋 Wave Action Later", prompt: "Make the actor wave later" },
  { label: "🔄 Turn Actor Left", prompt: "Set actor facing direction to left" },
];

export function CritiqueStudio({
  film,
  onUpdateFilm,
  undoStack,
  onUndo,
  validationStatus,
}: CritiqueStudioProps) {
  const [critiqueInput, setCritiqueInput] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [pendingResponse, setPendingResponse] = useState<CritiqueResponse | null>(null);
  const [history, setHistory] = useState<Array<{ critique: string; outcome: string; time: string }>>([]);

  const handleSubmit = (promptText?: string) => {
    const text = (promptText || critiqueInput).trim();
    if (!text) return;

    setIsProcessing(true);
    setPendingResponse(null);

    try {
      const response = executeCritique({
        critique: text,
        film,
      });

      setPendingResponse(response);

      if (response.ok && response.updatedFilm) {
        setHistory((prev) => [
          { critique: text, outcome: response.explanation, time: new Date().toLocaleTimeString() },
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
    <div className="w-full h-full bg-[#0A0A0B] text-[#F5F5F5] flex flex-col p-6 overflow-y-auto font-sans">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#222]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🤖</span>
            <h2 className="text-xl font-bold tracking-tight text-white">Natural-Language Critique Studio</h2>
            <span className="text-xs bg-[#1E1E24] text-[#8A8A8E] border border-[#333] px-2.5 py-0.5 rounded-full font-mono">
              Deterministic Patch Engine
            </span>
          </div>
          <p className="text-xs text-[#8A8A8E] mt-1">
            Type instructions in plain English to refine timing, adjust visual devices, scale actors, or swap themes with instant deep-diff verification.
          </p>
        </div>

        {/* Undo Control */}
        <div className="flex items-center gap-2">
          <button
            onClick={onUndo}
            disabled={undoStack.length === 0}
            className="text-xs px-3.5 py-1.5 rounded-lg bg-[#1A1A1E] hover:bg-[#25252D] border border-[#333] text-white font-bold transition-all disabled:opacity-40 flex items-center gap-1.5"
            title="Revert to previous film state (Undo)"
          >
            <span>↩️</span>
            <span>Undo ({undoStack.length})</span>
          </button>
        </div>
      </div>

      {/* Real-time Validation Status Banner */}
      {validationStatus && (
        <div
          className={`mt-4 p-3 rounded-xl border text-xs font-mono flex items-center justify-between ${
            validationStatus.ok
              ? "bg-emerald-950/40 border-emerald-800/80 text-emerald-300"
              : "bg-red-950/50 border-red-800/90 text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{validationStatus.ok ? "✓" : "❌"}</span>
            <span className="font-bold">{validationStatus.ok ? "Film Invariants Healthy:" : "Validation Error:"}</span>
            <span>{validationStatus.message}</span>
          </div>
          {validationStatus.rule && (
            <span className="text-[10px] bg-red-900/60 border border-red-700 px-2 py-0.5 rounded text-red-200">
              {validationStatus.rule}
            </span>
          )}
        </div>
      )}

      {/* Main Critique Input Box */}
      <div className="mt-6 flex flex-col gap-3 bg-[#121216] border border-[#262632] p-5 rounded-2xl shadow-xl">
        <label className="text-xs text-gray-300 font-bold uppercase tracking-wider flex items-center gap-2">
          <span>💬</span>
          <span>Director Critique / Instruction</span>
        </label>
        
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="e.g. Make the scale bar density 0.85, shorten shot 2 by 1 second, or switch theme to blueprint..."
            value={critiqueInput}
            onChange={(e) => setCritiqueInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className="flex-1 bg-[#0A0A0E] border border-[#333] rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-[#635BFF] placeholder:text-gray-600 font-medium transition-all"
          />
          <button
            onClick={() => handleSubmit()}
            disabled={isProcessing || !critiqueInput.trim()}
            className="px-5 py-3 rounded-xl bg-[#635BFF] hover:bg-[#5249e6] active:scale-95 text-white font-bold text-sm transition-all shadow-lg shadow-[#635BFF]/30 disabled:opacity-40 flex items-center gap-2 shrink-0"
          >
            <span>{isProcessing ? "⏳" : "⚡"}</span>
            <span>{isProcessing ? "Analyzing..." : "Review Patch"}</span>
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <span className="text-[11px] text-gray-500 font-mono">Suggestions:</span>
          {QUICK_CRITIQUES.map((chip) => (
            <button
              key={chip.label}
              onClick={() => {
                setCritiqueInput(chip.prompt);
                handleSubmit(chip.prompt);
              }}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-[#181820] hover:bg-[#252530] border border-[#333] text-gray-300 hover:text-white transition-all font-medium"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Proposed Patch Preview Diff Card */}
      {pendingResponse && (
        <div
          className={`mt-6 p-5 rounded-2xl border flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150 ${
            pendingResponse.ok
              ? "bg-[#0E1712] border-emerald-800/80 shadow-emerald-950/30"
              : "bg-[#1A0F12] border-red-800/80 shadow-red-950/30"
          }`}
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">{pendingResponse.ok ? "✨" : "⚠️"}</span>
              <h3 className="text-sm font-bold text-white">
                {pendingResponse.ok ? "Proposed Transactional Patch" : "Patch Validation Refusal"}
              </h3>
            </div>
            <span
              className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border ${
                pendingResponse.ok
                  ? "bg-emerald-950 text-emerald-300 border-emerald-700"
                  : "bg-red-950 text-red-300 border-red-700"
              }`}
            >
              Target: {pendingResponse.target.toUpperCase()}
            </span>
          </div>

          <div className="text-xs text-gray-200 leading-relaxed">
            {pendingResponse.explanation}
          </div>

          {/* Error / Failing Rule Display */}
          {!pendingResponse.ok && pendingResponse.error && (
            <div className="p-3.5 bg-red-950/60 border border-red-700/80 rounded-xl text-xs text-red-200 font-mono space-y-1.5">
              <div className="font-bold flex items-center gap-1.5 text-red-100">
                <span>🛑</span>
                <span>Rollback Triggered by: {pendingResponse.failingRule || "Validation Gate"}</span>
              </div>
              <p className="text-[11px] text-red-300/90 whitespace-pre-wrap">{pendingResponse.error}</p>
            </div>
          )}

          {/* PatchOp JSON inspection */}
          {pendingResponse.patchOps.length > 0 && (
            <div className="flex flex-col gap-1.5 font-mono text-xs">
              <span className="text-[11px] text-gray-400 font-bold uppercase">Operations ({pendingResponse.patchOps.length}):</span>
              <pre className="p-3 bg-[#0A0A0E] border border-white/10 rounded-xl text-gray-300 text-[11px] overflow-x-auto max-h-48">
                {JSON.stringify(pendingResponse.patchOps, null, 2)}
              </pre>
            </div>
          )}

          {/* Action buttons */}
          {pendingResponse.ok && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setPendingResponse(null)}
                className="text-xs px-4 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 font-semibold transition-all"
              >
                Dismiss
              </button>
              <button
                onClick={handleApplyPatch}
                className="text-xs px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold transition-all shadow-lg shadow-emerald-900/40 flex items-center gap-2"
              >
                <span>✓</span>
                <span>Apply Patch to Film</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Critique History */}
      {history.length > 0 && (
        <div className="mt-8 flex flex-col gap-3">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-gray-400">
            Recent Applied Critiques ({history.length})
          </h3>
          <div className="flex flex-col gap-2">
            {history.map((item, idx) => (
              <div
                key={idx}
                className="p-3 bg-[#121216] border border-[#222] rounded-xl flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-emerald-400">✓</span>
                  <span className="font-medium text-white">"{item.critique}"</span>
                  <span className="text-gray-500">→</span>
                  <span className="text-gray-400">{item.outcome}</span>
                </div>
                <span className="text-[10px] text-gray-600 font-mono">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
