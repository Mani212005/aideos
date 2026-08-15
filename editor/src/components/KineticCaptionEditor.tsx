/**
 * ==============================================================================
 * AIDEOS 2.0: KINETIC CAPTION & PRETEXT INSPECTOR
 * ==============================================================================
 * Interactive visual inspector for kinetic subtitle pacing, word-by-word highlights,
 * and zero-DOM text layout bounds powered by @chenglou/pretext.
 * ==============================================================================
 */

import React, { useState, useMemo } from "react";
import { prepareWithSegments, layoutWithLines, type LayoutLine } from "@chenglou/pretext";

export interface CaptionWordItem {
  text: string;
  startFrame: number;
  endFrame: number;
}

interface KineticCaptionEditorProps {
  onCaptionsChange?: (words: CaptionWordItem[]) => void;
}

const DEFAULT_SAMPLE_WORDS: CaptionWordItem[] = [
  { text: "Explaining", startFrame: 0, endFrame: 20 },
  { text: "complex", startFrame: 21, endFrame: 40 },
  { text: "software", startFrame: 41, endFrame: 60 },
  { text: "architecture", startFrame: 61, endFrame: 90 },
  { text: "in", startFrame: 91, endFrame: 105 },
  { text: "sixty", startFrame: 106, endFrame: 125 },
  { text: "seconds", startFrame: 126, endFrame: 155 },
  { text: "with", startFrame: 156, endFrame: 170 },
  { text: "zero", startFrame: 171, endFrame: 195 },
  { text: "friction!", startFrame: 196, endFrame: 230 },
];

export const KineticCaptionEditor: React.FC<KineticCaptionEditorProps> = ({ onCaptionsChange }) => {
  const [, setWords] = useState<CaptionWordItem[]>(DEFAULT_SAMPLE_WORDS);
  const [inputText, setInputText] = useState(DEFAULT_SAMPLE_WORDS.map((w) => w.text).join(" "));
  const [fontSize, setFontSize] = useState(48);
  const [maxWidth, setMaxWidth] = useState(640);
  const [highlightColor, setHighlightColor] = useState("#FFD700");
  const [position, setPosition] = useState<"top" | "center" | "bottom">("bottom");

  const lineHeight = Math.round(fontSize * 1.3);

  // Pretext zero-DOM layout measurement in real time
  const pretextStats = useMemo(() => {
    try {
      const fontSpec = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
      const prep = prepareWithSegments(inputText, fontSpec);
      const res = layoutWithLines(prep, maxWidth, lineHeight);
      return {
        lineCount: res.lines.length,
        lines: res.lines.map((l: LayoutLine) => l.text),
        totalHeight: Math.round(res.height),
      };
    } catch {
      return { lineCount: 1, lines: [inputText], totalHeight: lineHeight };
    }
  }, [inputText, fontSize, maxWidth, lineHeight]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    const tokens = val.trim().split(/\s+/).filter(Boolean);
    let curFrame = 0;
    const newWords: CaptionWordItem[] = tokens.map((token) => {
      const start = curFrame;
      const end = curFrame + Math.max(15, token.length * 3);
      curFrame = end + 2;
      return { text: token, startFrame: start, endFrame: end };
    });
    setWords(newWords);
    if (onCaptionsChange) onCaptionsChange(newWords);
  };

  return (
    <div className="flex flex-col gap-4 text-sm bg-[#1A1A1B] p-4 rounded-xl border border-[#333] text-gray-200">
      <div className="flex items-center justify-between border-b border-[#333] pb-3">
        <div>
          <h3 className="font-bold text-base text-white flex items-center gap-2">
            <span>💬</span> Pretext Kinetic Subtitle Studio
          </h3>
          <p className="text-xs text-gray-400">
            Zero-DOM text layout & karaoke highlight engine
          </p>
        </div>
        <span className="text-xs px-2.5 py-1 bg-yellow-500/20 text-yellow-400 font-mono rounded-full border border-yellow-500/30">
          ⚡ Pretext Engine Active
        </span>
      </div>

      {/* Input script */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-gray-300">Spoken Speech / Captions Text:</label>
        <textarea
          className="w-full bg-[#111] border border-[#444] rounded-lg p-3 text-white text-sm focus:outline-none focus:border-yellow-500 font-sans"
          rows={3}
          value={inputText}
          onChange={handleTextChange}
          placeholder="Paste or type words to animate..."
        />
      </div>

      {/* Pretext Telemetry Box */}
      <div className="grid grid-cols-3 gap-2 bg-[#141415] p-3 rounded-lg border border-[#2a2a2b] font-mono text-xs">
        <div>
          <span className="text-gray-500 block">Lines (Pretext)</span>
          <span className="text-white font-bold text-sm">{pretextStats.lineCount} lines</span>
        </div>
        <div>
          <span className="text-gray-500 block">Box Height</span>
          <span className="text-white font-bold text-sm">{pretextStats.totalHeight} px</span>
        </div>
        <div>
          <span className="text-gray-500 block">Wrap Max-Width</span>
          <span className="text-yellow-400 font-bold text-sm">{maxWidth} px</span>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Font Size: {fontSize}px</label>
          <input
            type="range"
            min={24}
            max={72}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="accent-yellow-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Wrap Width: {maxWidth}px</label>
          <input
            type="range"
            min={320}
            max={1000}
            value={maxWidth}
            onChange={(e) => setMaxWidth(Number(e.target.value))}
            className="accent-yellow-500"
          />
        </div>
      </div>

      {/* Color & Position */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Highlight:</label>
          <input
            type="color"
            value={highlightColor}
            onChange={(e) => setHighlightColor(e.target.value)}
            className="w-7 h-7 rounded border-none cursor-pointer bg-transparent"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-400 mr-1">Position:</label>
          {(["top", "center", "bottom"] as const).map((pos) => (
            <button
              key={pos}
              onClick={() => setPosition(pos)}
              className={`px-2.5 py-1 text-xs rounded font-medium capitalize transition-colors ${
                position === pos
                  ? "bg-yellow-500 text-black font-bold"
                  : "bg-[#252526] text-gray-300 hover:bg-[#333]"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      {/* Real-time Pretext Lines Preview */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-[#333]">
        <span className="text-xs text-gray-400 font-semibold">Pretext Line-Wrapped Preview:</span>
        <div
          className="bg-[#0f172a] p-4 rounded-lg border border-slate-700/50 flex flex-col items-center justify-center text-center gap-1"
          style={{ maxWidth: `${maxWidth}px`, width: "100%", margin: "0 auto" }}
        >
          {pretextStats.lines.map((line: string, lIdx: number) => (
            <div
              key={lIdx}
              style={{
                fontSize: `${fontSize * 0.75}px`,
                fontWeight: 800,
                color: "#FFFFFF",
                lineHeight: 1.25,
              }}
            >
              {line.split(" ").map((w: string, wIdx: number) => {
                const isHighlight = wIdx % 4 === 1;
                return (
                  <span
                    key={wIdx}
                    style={{
                      color: isHighlight ? highlightColor : "#FFFFFF",
                      margin: "0 4px",
                      display: "inline-block",
                    }}
                  >
                    {w}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
