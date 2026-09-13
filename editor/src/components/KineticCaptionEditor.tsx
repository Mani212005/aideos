/*
File Description: This component implements the Kinetic Caption & Pretext Inspector tab in Aideos, rendering an interactive word column for the entire film script with real-time frame timestamp editing and Pretext zero-DOM layout measurement.
*/

import React, { useState, useMemo, useEffect } from "react";
import {
  prepareWithSegments,
  layoutWithLines,
  type LayoutLine,
} from "@chenglou/pretext";
import {
  Search,
  Play,
  Edit2,
  Sparkles,
  Clock,
  FileText,
  Subtitles,
} from "lucide-react";
import type { Film } from "../../../src/dl/schema";

export interface CaptionWordItem {
  text: string;
  startFrame: number;
  endFrame: number;
}

interface KineticCaptionEditorProps {
  film?: Film;
  words?: CaptionWordItem[];
  onCaptionsChange?: (words: CaptionWordItem[]) => void;
  onSeekToFrame?: (frame: number) => void;
}

// Renders the interactive word column, Pretext layout inspector, and frame timing controls.
export const KineticCaptionEditor: React.FC<KineticCaptionEditorProps> = ({
  film,
  words: initialWords = [],
  onCaptionsChange,
  onSeekToFrame,
}) => {
  const [localWords, setLocalWords] = useState<CaptionWordItem[]>(initialWords);
  const [searchQuery, setSearchQuery] = useState("");
  const [fontSize, setFontSize] = useState(48);
  const [maxWidth, setMaxWidth] = useState(640);
  const [highlightColor, setHighlightColor] = useState("#635BFF");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Sync local words whenever incoming words prop changes
  useEffect(() => {
    if (initialWords && initialWords.length > 0) {
      setLocalWords(initialWords);
    }
  }, [initialWords]);

  // Derives full script text from all word items in sequence
  const fullText = useMemo(() => {
    return localWords.map((w) => w.text).join(" ");
  }, [localWords]);

  const lineHeight = Math.round(fontSize * 1.3);

  // Pretext zero-DOM layout measurement in real time
  const pretextStats = useMemo(() => {
    try {
      const fontSpec = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
      const prep = prepareWithSegments(
        fullText || "Aideos kinetic video captions",
        fontSpec,
      );
      const res = layoutWithLines(prep, maxWidth, lineHeight);
      return {
        lineCount: res.lines.length,
        lines: res.lines.map((l: LayoutLine) => l.text),
        totalHeight: Math.round(res.height),
      };
    } catch {
      return { lineCount: 1, lines: [fullText], totalHeight: lineHeight };
    }
  }, [fullText, fontSize, maxWidth, lineHeight]);

  // Filters words list by search query
  const filteredWords = useMemo(() => {
    if (!searchQuery.trim()) return localWords;
    const query = searchQuery.toLowerCase();
    return localWords.filter((w) => w.text.toLowerCase().includes(query));
  }, [localWords, searchQuery]);

  // Handles updating word text or timing and propagates change upstream
  const handleWordUpdate = (index: number, updatedWord: CaptionWordItem) => {
    const updated = [...localWords];
    updated[index] = updatedWord;
    setLocalWords(updated);
    if (onCaptionsChange) onCaptionsChange(updated);
  };

  // Handles editing full script text area and re-calculating word frame timings
  const handleFullTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const tokens = val.trim().split(/\s+/).filter(Boolean);
    let curFrame = 0;
    const newWords: CaptionWordItem[] = tokens.map((token) => {
      const start = curFrame;
      const end = curFrame + Math.max(12, token.length * 3);
      curFrame = end + 2;
      return { text: token, startFrame: start, endFrame: end };
    });
    setLocalWords(newWords);
    if (onCaptionsChange) onCaptionsChange(newWords);
  };

  return (
    <div className="flex flex-col gap-4 text-sm bg-paper p-5 border-2 border-ink text-ink font-sans">
      {/* Header Info Bar */}
      <div className="flex items-center justify-between border-b-2 border-ink pb-4">
        <div>
          <h3 className="font-bold text-lg text-ink flex items-center gap-2">
            <Subtitles size={18} className="text-select-text" /> Kinetic Subtitles
          </h3>
          <p className="text-xs text-ink-soft">
            Interactive word column for {film?.title || "Active Video"} (
            {localWords.length} words total)
          </p>
        </div>
        <span className="text-xs px-3 py-1.5 bg-select/20 text-select-text font-mono border border-select/40 flex items-center gap-1.5">
          <Sparkles size={12} />
          Pretext Engine Active
        </span>
      </div>

      {/* Grid Layout: Left Interactive Word Column (Full Script) | Right Pretext Controls & Preview */}
      <div className="grid grid-cols-12 gap-5">
        {/* Left Column: Interactive Word List Column */}
        <div className="col-span-5 flex flex-col gap-3 bg-paper p-4 border-2 border-ink">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-ink uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={14} className="text-select-text" />
              Interactive Word Column
            </h4>
            <span className="text-xs text-ink-soft font-mono">
              {filteredWords.length} / {localWords.length} words
            </span>
          </div>

          {/* Search Filter Bar */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-2.5 text-ink-soft"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search words in script..."
              className="w-full bg-paper-3 border-2 border-ink pl-9 pr-3 py-1.5 text-xs text-ink focus:outline-none focus:border-select"
            />
          </div>

          {/* Interactive Scrollable Word List */}
          <div className="max-h-[380px] overflow-y-auto pr-1 flex flex-col gap-1.5">
            {filteredWords.map((wordItem, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-paper-3 border-2 border-ink hover:border-select/50 transition-colors group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() =>
                      onSeekToFrame && onSeekToFrame(wordItem.startFrame)
                    }
                    title={`Seek video to frame ${wordItem.startFrame}`}
                    className="p-1 bg-select/15 text-select-text hover:bg-select hover:text-ink transition-colors"
                  >
                    <Play size={10} />
                  </button>

                  {editingIndex === idx ? (
                    <input
                      type="text"
                      value={wordItem.text}
                      onChange={(e) =>
                        handleWordUpdate(idx, {
                          ...wordItem,
                          text: e.target.value,
                        })
                      }
                      onBlur={() => setEditingIndex(null)}
                      autoFocus
                      className="bg-paper border border-select text-xs px-1.5 py-0.5 text-ink focus:outline-none"
                    />
                  ) : (
                    <span
                      onClick={() => setEditingIndex(idx)}
                      className="text-xs font-medium text-ink truncate cursor-pointer hover:text-select-text"
                      title="Click to edit word"
                    >
                      {wordItem.text}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 font-mono text-[11px] text-ink-soft">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />f{wordItem.startFrame}-
                    {wordItem.endFrame}
                  </span>
                  <button
                    onClick={() => setEditingIndex(idx)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-soft hover:text-ink"
                  >
                    <Edit2 size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Pretext Telemetry Box & Line-Wrapped Preview */}
        <div className="col-span-7 flex flex-col gap-4">
          {/* Full Script Text Area */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-ink">
              Full Script Text:
            </label>
            <textarea
              className="w-full bg-paper-3 border-2 border-ink p-3 text-ink text-xs focus:outline-none focus:border-select font-sans"
              rows={3}
              value={fullText}
              onChange={handleFullTextChange}
              placeholder="Paste or type words to animate..."
            />
          </div>

          {/* Pretext Zero-DOM Telemetry */}
          <div className="grid grid-cols-3 gap-2 bg-paper p-3 border-2 border-ink font-mono text-xs">
            <div>
              <span className="text-ink-soft block text-[10px]">
                Lines (Pretext)
              </span>
              <span className="text-ink font-bold text-sm">
                {pretextStats.lineCount} lines
              </span>
            </div>
            <div>
              <span className="text-ink-soft block text-[10px]">
                Box Height
              </span>
              <span className="text-ink font-bold text-sm">
                {pretextStats.totalHeight} px
              </span>
            </div>
            <div>
              <span className="text-ink-soft block text-[10px]">
                Wrap Max-Width
              </span>
              <span className="text-select-text font-bold text-sm">
                {maxWidth} px
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-soft">
                Font Size: {fontSize}px
              </label>
              <input
                type="range"
                min={24}
                max={72}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="accent-select"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-soft">
                Wrap Width: {maxWidth}px
              </label>
              <input
                type="range"
                min={320}
                max={1000}
                value={maxWidth}
                onChange={(e) => setMaxWidth(Number(e.target.value))}
                className="accent-select"
              />
            </div>
          </div>

          {/* Highlight Accent */}
          <div className="flex items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-soft">Accent Highlight:</label>
              <input
                type="color"
                value={highlightColor}
                onChange={(e) => setHighlightColor(e.target.value)}
                className="w-7 h-7 border-none cursor-pointer bg-transparent"
              />
            </div>
          </div>

          {/* Real-time Pretext Lines Preview */}
          <div className="flex flex-col gap-1.5 pt-2 border-t-2 border-ink">
            <span className="text-xs text-ink-soft font-semibold">
              Pretext Line-Wrapped Kinetic Preview:
            </span>
            <div
              className="flex min-h-[100px] flex-col items-center justify-center gap-1 border-2 border-ink bg-matte p-4 text-center"
              style={{
                maxWidth: `${maxWidth}px`,
                width: "100%",
                margin: "0 auto",
              }}
            >
              {pretextStats.lines.map((line: string, lIdx: number) => (
                <div
                  key={lIdx}
                  style={{
                    fontSize: `${fontSize * 0.75}px`,
                    fontWeight: 700,
                    color: "#F5F5F5",
                    lineHeight: 1.25,
                  }}
                >
                  {line.split(" ").map((w: string, wIdx: number) => {
                    const isHighlight = wIdx % 4 === 1;
                    return (
                      <span
                        key={wIdx}
                        style={{
                          color: isHighlight ? highlightColor : "#F5F5F5",
                          margin: "0 4px",
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
      </div>
    </div>
  );
};
