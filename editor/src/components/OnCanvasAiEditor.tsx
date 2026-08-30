/**
 * File Description: Google Stitch-style On-Canvas "Edit with AI" & Element Inspector Component.
 * Enables direct on-canvas element selection (Headlines, Counters, Characters, Metaphors)
 * and natural-language prompt editing or 1-click inline text correction.
 */

import React, { useState, useMemo } from "react";
import type { Film } from "../../../src/dl/schema";
import type { TimedShot } from "../../../src/dl/camera";
import { activeShotAt } from "../../../src/dl/camera";
import { executeCritique } from "../../../backend/critique/engine";

export interface SelectedTarget {
  shotId: string;
  shotIndex: number;
  blockIndex: number;
  blockType: string;
  label: string;
  currentValue?: string | number;
}

interface OnCanvasAiEditorProps {
  film: Film;
  timeline: TimedShot[];
  currentFrame: number;
  onUpdateFilm: (updatedFilm: Film) => void;
  accent?: string;
}

export const OnCanvasAiEditor: React.FC<OnCanvasAiEditorProps> = ({
  film,
  timeline,
  currentFrame,
  onUpdateFilm,
}) => {
  const [isInspectMode, setIsInspectMode] = useState<boolean>(true);
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);
  const [promptInput, setPromptInput] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [inlineEditText, setInlineEditText] = useState<string>("");
  const [isInlineEditing, setIsInlineEditing] = useState<boolean>(false);

  // Active shot at the current playhead frame
  const activeTimedShot = useMemo(() => {
    return activeShotAt(timeline, currentFrame);
  }, [timeline, currentFrame]);

  const activeShot = activeTimedShot?.shot;
  const activeShotIndex = activeTimedShot?.index ?? -1;

  // Inspectable elements in the current shot
  const inspectableBlocks = useMemo(() => {
    if (!activeShot || !activeShot.blocks) return [];
    return activeShot.blocks.map((b, idx) => {
      let label: string = b.c;
      let val: string | number | undefined;

      if (b.c === "TextReveal" || b.c === "Kicker" || b.c === "Body") {
        label = `${b.c}: "${(b as any).text?.slice(0, 32)}..."`;
        val = (b as any).text;
      } else if (b.c === "StatCounter") {
        label = `Counter: ${(b as any).to} (${(b as any).label})`;
        val = (b as any).to;
      } else if (b.c === "CharacterBeat") {
        label = `Actor: ${(b as any).characterId || "developer"}`;
        val = (b as any).characterId;
      } else if (b.c === "MetaphorViewer") {
        label = `Metaphor: ${(b as any).content?.kind || (b as any).metaphorType || "visual"}`;
        val = (b as any).content?.kind || (b as any).metaphorType;
      }

      return {
        blockIndex: idx,
        blockType: b.c,
        label,
        currentValue: val,
        block: b,
      };
    });
  }, [activeShot]);

  // Handle natural-language AI edit submission
  const handleAiSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const prompt = promptInput.trim();
    if (!prompt) return;

    setIsProcessing(true);
    setStatusMessage(null);

    try {
      // 1. Direct targeted text/number replacement heuristic for high precision
      if (selectedTarget && activeShot) {
        const lowerPrompt = prompt.toLowerCase();
        const block = activeShot.blocks[selectedTarget.blockIndex] as any;

        // Check for "change X to Y" or "replace X with Y"
        const changeFromToMatch = prompt.match(/(?:change|replace|fix|correct|rename|update|set)\s+(?:the\s+)?(?:text\s+)?(?:from\s+)?["'“]?([^"”'\n]+?)["'”]?\s+(?:to|with|into|as)\s+["'“]?([^"”'\n]+?)["'”]?$/i);

        if (changeFromToMatch && block) {
          const oldT = changeFromToMatch[1].trim();
          const newT = changeFromToMatch[2].trim();
          const updatedShots = [...film.shots];
          let updatedBlock = { ...block };

          if (block.c === "TextReveal" || block.c === "Body" || block.c === "Kicker") {
            const escaped = oldT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            updatedBlock.text = block.text ? block.text.replace(new RegExp(escaped, "gi"), newT) : newT;
          } else if (block.c === "StatCounter") {
            const escaped = oldT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (block.label && block.label.toLowerCase().includes(oldT.toLowerCase())) {
              updatedBlock.label = block.label.replace(new RegExp(escaped, "gi"), newT);
            }
            const oldNum = parseFloat(oldT.replace(/[^0-9.]/g, ""));
            const newNum = parseFloat(newT.replace(/[^0-9.]/g, ""));
            if (!isNaN(newNum) && (!isNaN(oldNum) || block.to === oldNum)) {
              updatedBlock.to = newNum;
              updatedBlock.format = "plain";
            }
          }

          const newBlocks = [...activeShot.blocks];
          newBlocks[selectedTarget.blockIndex] = updatedBlock;
          updatedShots[activeShotIndex] = { ...activeShot, blocks: newBlocks };

          onUpdateFilm({ ...film, shots: updatedShots });
          setStatusMessage({ text: `✓ Replaced "${oldT}" with "${newT}"` });
          setPromptInput("");
          setIsProcessing(false);
          return;
        }

        // "Change text to X" or "Set headline to X" or "2018 without comma"
        const changeToMatch = prompt.match(/(?:change|set|replace|make|rename|update)\s+(?:the\s+)?(?:text|headline|label|title|to|value)?\s*(?:to|as|into|with|is)?\s*["']?([^"']+)["']?/i);
        const withoutCommaMatch = lowerPrompt.includes("without") && lowerPrompt.includes("comma");

        if (withoutCommaMatch && block?.c === "StatCounter") {
          const updatedShots = [...film.shots];
          const updatedBlock = { ...block, format: "plain" };
          const newBlocks = [...activeShot.blocks];
          newBlocks[selectedTarget.blockIndex] = updatedBlock;
          updatedShots[activeShotIndex] = { ...activeShot, blocks: newBlocks };

          onUpdateFilm({ ...film, shots: updatedShots });
          setStatusMessage({ text: `✓ Updated StatCounter to plain formatting (no commas)` });
          setPromptInput("");
          setIsProcessing(false);
          return;
        }

        if (changeToMatch && changeToMatch[1] && (block?.c === "TextReveal" || block?.c === "Body" || block?.c === "Kicker")) {
          const newText = changeToMatch[1].trim();
          const updatedShots = [...film.shots];
          const updatedBlock = { ...block, text: newText };
          const newBlocks = [...activeShot.blocks];
          newBlocks[selectedTarget.blockIndex] = updatedBlock;
          updatedShots[activeShotIndex] = { ...activeShot, blocks: newBlocks };

          onUpdateFilm({ ...film, shots: updatedShots });
          setStatusMessage({ text: `✓ Updated text to "${newText}"` });
          setPromptInput("");
          setIsProcessing(false);
          return;
        }

        if (changeToMatch && changeToMatch[1] && block?.c === "StatCounter") {
          const numVal = parseFloat(changeToMatch[1].replace(/[^0-9.]/g, ""));
          if (!isNaN(numVal)) {
            const updatedShots = [...film.shots];
            const updatedBlock = { ...block, to: numVal, format: "plain" };
            const newBlocks = [...activeShot.blocks];
            newBlocks[selectedTarget.blockIndex] = updatedBlock;
            updatedShots[activeShotIndex] = { ...activeShot, blocks: newBlocks };

            onUpdateFilm({ ...film, shots: updatedShots });
            setStatusMessage({ text: `✓ Updated counter value to ${numVal}` });
            setPromptInput("");
            setIsProcessing(false);
            return;
          }
        }
      }

      // 2. Fall back to standard AI Critique engine
      const res = executeCritique({
        critique: prompt,
        film,
      });

      if (res.ok && res.updatedFilm) {
        onUpdateFilm(res.updatedFilm);
        setStatusMessage({ text: `✓ ${res.explanation}` });
        setPromptInput("");
      } else {
        setStatusMessage({
          text: res.error || res.explanation || "Could not apply requested change.",
          isError: true,
        });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || "Failed to process critique", isError: true });
    } finally {
      setIsProcessing(false);
    }
  };

  // Direct manual inline text save
  const handleSaveInlineText = () => {
    if (!selectedTarget || !activeShot) return;
    const block = activeShot.blocks[selectedTarget.blockIndex] as any;
    if (!block) return;

    const updatedShots = [...film.shots];
    let updatedBlock = { ...block };

    if (block.c === "TextReveal" || block.c === "Body" || block.c === "Kicker") {
      updatedBlock = { ...block, text: inlineEditText };
    } else if (block.c === "StatCounter") {
      const num = parseFloat(inlineEditText.replace(/[^0-9.]/g, "")) || block.to;
      updatedBlock = { ...block, to: num, format: "plain" };
    }

    const newBlocks = [...activeShot.blocks];
    newBlocks[selectedTarget.blockIndex] = updatedBlock;
    updatedShots[activeShotIndex] = { ...activeShot, blocks: newBlocks };

    onUpdateFilm({ ...film, shots: updatedShots });
    setIsInlineEditing(false);
    setStatusMessage({ text: `✓ Saved direct text changes on canvas` });
  };

  if (!activeShot) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-3 select-none font-sans">
      {/* TOP BAR: Inspect Mode Toggle & Target Badge */}
      <div className="flex items-center justify-between gap-2 pointer-events-auto">
        <div className="flex items-center gap-2 bg-[#121214]/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-[#27272A] shadow-xl text-xs">
          <button
            type="button"
            onClick={() => {
              setIsInspectMode(!isInspectMode);
              if (isInspectMode) setSelectedTarget(null);
            }}
            className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition-all text-xs cursor-pointer ${
              isInspectMode
                ? "bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/30"
                : "bg-[#27272A] text-gray-400 hover:text-white"
            }`}
          >
            <span>✨</span>
            <span>{isInspectMode ? "Inspect & Edit Active" : "Click to Inspect Elements"}</span>
          </button>

          {/* Quick Selectable Element Chips on Canvas */}
          {isInspectMode && (
            <div className="flex items-center gap-1 overflow-x-auto max-w-md">
              {inspectableBlocks.map((b) => {
                const isSelected =
                  selectedTarget?.blockIndex === b.blockIndex &&
                  selectedTarget?.shotId === activeShot.id;
                return (
                  <button
                    key={b.blockIndex}
                    type="button"
                    onClick={() => {
                      setSelectedTarget({
                        shotId: activeShot.id,
                        shotIndex: activeShotIndex,
                        blockIndex: b.blockIndex,
                        blockType: b.blockType,
                        label: b.label,
                        currentValue: b.currentValue,
                      });
                      setInlineEditText(String(b.currentValue || ""));
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all truncate max-w-[140px] cursor-pointer border ${
                      isSelected
                        ? "bg-yellow-400 text-black font-bold border-yellow-300 shadow"
                        : "bg-[#18181B] text-gray-300 border-[#333] hover:border-yellow-400/70"
                    }`}
                    title={`Click to select: ${b.label}`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Status Toast */}
        {statusMessage && (
          <div
            className={`px-3 py-1.5 rounded-xl border text-xs font-mono backdrop-blur-md shadow-xl flex items-center gap-2 animate-fade-in ${
              statusMessage.isError
                ? "bg-red-950/90 border-red-500 text-red-300"
                : "bg-emerald-950/90 border-emerald-500 text-emerald-300"
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-gray-400 hover:text-white text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* DIRECT INLINE TEXT EDIT POPOVER MODAL */}
      {isInlineEditing && selectedTarget && (
        <div className="self-center pointer-events-auto bg-[#141416]/95 backdrop-blur-lg border border-yellow-400 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 w-96 font-mono text-xs">
          <div className="flex items-center justify-between pb-1.5 border-b border-[#27272A]">
            <span className="text-yellow-400 font-bold">✏️ Direct On-Canvas Edit</span>
            <button
              onClick={() => setIsInlineEditing(false)}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-400 font-bold uppercase">
              {selectedTarget.blockType} Text / Value
            </label>
            <textarea
              rows={3}
              value={inlineEditText}
              onChange={(e) => setInlineEditText(e.target.value)}
              className="w-full bg-black/80 border border-[#333] rounded-lg p-2 text-white outline-none focus:border-yellow-400 font-sans text-xs"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsInlineEditing(false)}
              className="px-3 py-1.5 rounded bg-[#27272A] text-gray-300 hover:text-white text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveInlineText}
              className="px-3 py-1.5 rounded bg-yellow-400 text-black font-bold hover:bg-yellow-300 text-xs shadow"
            >
              ✓ Save to Frame
            </button>
          </div>
        </div>
      )}

      {/* BOTTOM GOOGLE STITCH-STYLE FLOATING AI PROMPT BAR */}
      <div className="self-center w-full max-w-2xl pointer-events-auto mb-2">
        <form
          onSubmit={handleAiSubmit}
          className="bg-[#121214]/95 backdrop-blur-xl border border-[#333] hover:border-[#635BFF]/80 focus-within:border-[#635BFF] focus-within:ring-2 focus-within:ring-[#635BFF]/30 rounded-2xl p-2 shadow-2xl flex items-center gap-2 transition-all"
        >
          {/* Target Chip */}
          {selectedTarget ? (
            <div className="flex items-center gap-1.5 bg-yellow-400/10 border border-yellow-400/40 text-yellow-300 px-2.5 py-1 rounded-xl text-xs font-mono shrink-0">
              <span className="text-xs">🎯</span>
              <span className="font-bold truncate max-w-[150px]">{selectedTarget.label}</span>
              <button
                type="button"
                onClick={() => setIsInlineEditing(true)}
                className="ml-1 text-[10px] bg-yellow-400 text-black px-1.5 py-0.5 rounded font-bold hover:bg-yellow-300 transition-colors"
                title="Edit text directly"
              >
                ✏️ Edit
              </button>
              <button
                type="button"
                onClick={() => setSelectedTarget(null)}
                className="text-yellow-400 hover:text-white text-xs ml-0.5 font-bold"
                title="Clear selected target"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-gray-400 text-xs font-mono px-2 shrink-0">
              <span>✨</span>
              <span className="text-[11px]">Edit with AI</span>
            </div>
          )}

          {/* Natural Language Prompt Input */}
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder={
              selectedTarget
                ? `Tell AI what to change (e.g. "Change 2,018 to 2018", "Make text bolder", "Make actor wave")...`
                : `Tell AI what to change (e.g. "Fix year to 2018 in shot 2", "Switch theme to blueprint")...`
            }
            className="flex-1 bg-transparent text-xs text-white placeholder-gray-500 outline-none font-sans px-2 min-w-0"
          />

          {/* Submit Wand Button */}
          <button
            type="submit"
            disabled={isProcessing || !promptInput.trim()}
            className="px-3.5 py-1.5 rounded-xl bg-[#635BFF] hover:bg-[#5248E5] text-white font-bold text-xs shadow-lg shadow-[#635BFF]/30 flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shrink-0"
          >
            <span>{isProcessing ? "⏳" : "✨"}</span>
            <span>{isProcessing ? "Applying..." : "Edit with AI"}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
