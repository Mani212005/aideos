/**
 * File Description: Full-screen intuitive Scene Inspector Modal covering 80% viewport.
 * Translates timeline settings, voiceover narration, visual direction, and GPU B-roll configuration.
 * Inputs and outputs: shot details and film canvas -> modal dialog for inspecting and modifying shot parameters.
 * Used by: editor/src/App.tsx.
 */

import React from "react";
import type { Film, Shot, Block } from "../../../src/dl/schema";

import {
  Mic,
  Sparkles,
  Palette,
  LayoutGrid,
  Video,
  Film as FilmIcon,
  Check,
  Zap,
  X,
  Clock,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

export interface ShotModalProps {
  isOpen: boolean;
  film: Film;
  shotIndex: number;
  onClose: () => void;
  onUpdateFilm: (updated: Film) => void;
  onSelectShotIndex?: (index: number) => void;
}

// Full-screen modal inspector for reviewing and editing an individual scene shot.
export const ShotModal: React.FC<ShotModalProps> = ({
  isOpen,
  film,
  shotIndex,
  onClose,
  onUpdateFilm,
  onSelectShotIndex,
}) => {
  if (!isOpen || shotIndex < 0 || shotIndex >= film.shots.length) return null;

  const shot = film.shots[shotIndex];
  const analogyBlock = shot.blocks.find((b) => b.c === "AnalogyInset") as any;
  const isBrollMode = !!shot.needsFootage || !!analogyBlock;
  const activeMode = isBrollMode ? "b-roll" : "standard";

  // Updates current shot properties and emits updated film to parent.
  const updateCurrentShot = (partial: Partial<Shot>) => {
    const updatedShots = [...film.shots];
    updatedShots[shotIndex] = { ...shot, ...partial };
    onUpdateFilm({ ...film, shots: updatedShots });
  };

  // Switches visual mode between standard card and b-roll footage.
  const setVisualMode = (mode: "standard" | "b-roll") => {
    if (mode === "b-roll") {
      const filteredBlocks = shot.blocks.filter(
        (b) => b.c !== "AnalogyInset",
      );
      const footageSrc =
        analogyBlock?.src || `footage/${film.id}_${shot.id}.mp4`;
      const newAnalogyBlock: Block = {
        c: "AnalogyInset",
        caption: (
          shot.visualDirection ||
          shot.scriptText ||
          "GPU B-Roll"
        ).slice(0, 60),
        src: footageSrc,
        fullScreenHero: true,
      } as any;

      updateCurrentShot({
        needsFootage: true,
        blocks: [newAnalogyBlock, ...filteredBlocks],
      });

      // Immediately trigger GPU B-roll generation on the remote GPU box
      fetch("/api/broll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filmId: film.id,
          shotId: shot.id,
          prompt: shot.visualDirection || shot.scriptText,
        }),
      }).catch((err) => console.error("Failed to trigger B-roll:", err));
    } else {
      const filteredBlocks = shot.blocks.filter(
        (b) => b.c !== "AnalogyInset",
      );
      updateCurrentShot({
        needsFootage: false,
        blocks:
          filteredBlocks.length > 0
            ? filteredBlocks
            : [
                {
                  c: "Body",
                  text: shot.scriptText || "Scene narrative content",
                },
              ],
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sunken p-4 sm:p-6 animate-fade-in">
      {/* 80% VIEWPORT MAIN CONTAINER */}
      <div className="relative w-full max-w-6xl h-[88vh] bg-paper border-2 border-ink shadow-nb-sm flex flex-col overflow-hidden text-ink font-sans">
        {/* TOP MODAL HEADER */}
        <div className="h-16 px-6 bg-paper-3 border-b-2 border-ink flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-bold px-2.5 py-1 bg-select/20 text-select-text border border-select/40">
              Scene {shotIndex + 1} of {film.shots.length}
            </span>
            <h2 className="text-base font-bold text-ink truncate max-w-md">
              {shot.id}
            </h2>
            <span className="text-xs font-mono text-ink-soft bg-sunken px-2 py-0.5 border-2 border-ink flex items-center gap-1.5 shadow-nb-sm">
              <Clock className="w-3 h-3 text-ink-soft" /> {shot.dur}s
            </span>
          </div>

          {/* Quick Scene Navigation & Close */}
          <div className="flex items-center gap-3">
            {onSelectShotIndex && (
              <div className="flex items-center gap-1 bg-sunken p-1 border-2 border-ink shadow-nb-sm">
                <button
                  onClick={() => onSelectShotIndex(Math.max(0, shotIndex - 1))}
                  disabled={shotIndex === 0}
                  className="px-2.5 py-1 text-xs font-mono text-ink hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <ArrowLeft className="w-3 h-3" /> Previous
                </button>
                <span className="text-ink-mute">|</span>
                <button
                  onClick={() =>
                    onSelectShotIndex(
                      Math.min(film.shots.length - 1, shotIndex + 1),
                    )
                  }
                  disabled={shotIndex === film.shots.length - 1}
                  className="px-2.5 py-1 text-xs font-mono text-ink hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  Next <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-8 h-8 bg-paper-3 hover:bg-paper-3 text-ink-soft hover:text-ink flex items-center justify-center text-lg transition-colors"
              title="Close modal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* MODAL BODY: 2-COLUMN SPACIOUS LAYOUT */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden min-h-0">
          {/* LEFT COLUMN: LIVE SCENE PREVIEW & SCRIPT (5 Columns) */}
          <div className="lg:col-span-5 bg-paper border-r-2 border-ink p-6 flex flex-col gap-5 overflow-y-auto">
            {/* Live GPU B-Roll Preview Box */}
            {isBrollMode && (
              <div className="bg-paper-3 border-2 border-ink/30 p-4 flex flex-col items-center justify-center min-h-[190px] relative overflow-hidden shadow-nb-sm">
                <div className="absolute top-2.5 left-3 text-[10px] font-mono text-ink uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-warn animate-pulse" />
                  <span>GPU B-Roll : Wan2.1 Diffusion</span>
                </div>
                <div className="w-full flex flex-col items-center justify-center pt-5 gap-2">
                  {analogyBlock?.src ? (
                    <div className="w-full flex flex-col items-center gap-2">
                      <video
                        src={`/${analogyBlock.src.replace(/^\//, "")}`}
                        controls
                        className="w-full max-h-48 object-contain bg-sunken border-2 border-ink/40 shadow-nb-sm"
                      />
                      <span className="text-[10px] font-mono text-ink flex items-center gap-1">
                        <Check size={12} />
                        <span>B-Roll footage attached</span>
                      </span>
                    </div>
                  ) : (
                    <Video size={28} className="text-ink" />
                  )}
                  <p className="text-[11px] text-ink font-mono text-center max-w-xs">
                    {shot.visualDirection
                      ? `"${shot.visualDirection}"`
                      : "Cinematic scene prompt"}
                  </p>
                  <button
                    onClick={() => {
                      fetch("/api/broll/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          filmId: film.id,
                          shotId: shot.id,
                          prompt: shot.visualDirection || shot.scriptText,
                        }),
                      }).catch(() => {});
                    }}
                    className="mt-1 px-3 py-1 bg-warn hover:bg-warn text-ink text-xs font-mono font-bold transition-colors shadow flex items-center gap-1.5 cursor-pointer"
                  >
                    <Zap size={12} />
                    <span>
                      {analogyBlock?.src
                        ? "Re-generate Video"
                        : "Generate Video"}
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5 mb-2">
                <Mic size={14} />
                <span>Voiceover Narration</span>
              </label>
              <textarea
                value={shot.scriptText || ""}
                onChange={(e) =>
                  updateCurrentShot({ scriptText: e.target.value })
                }
                rows={3}
                placeholder="Narration spoken during this scene..."
                className="w-full bg-paper-3 border-2 border-ink focus:border-select p-3 text-xs text-ink placeholder-ink focus:outline-none transition-colors font-sans leading-relaxed shadow-nb-sm"
              />
            </div>

            {/* Scene Visual Idea / Direction Prompt */}
            <div>
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5 mb-2">
                <Sparkles size={14} />
                <span>Visual Direction</span>
              </label>
              <input
                type="text"
                value={shot.visualDirection || ""}
                onChange={(e) =>
                  updateCurrentShot({ visualDirection: e.target.value })
                }
                placeholder="e.g. Visual scene prompt or concept description"
                className="w-full bg-paper-3 border-2 border-ink focus:border-select px-3 py-2 text-xs text-ink placeholder-ink focus:outline-none transition-colors font-mono shadow-nb-sm"
              />
            </div>

            {/* Scene Duration & Camera Move */}
            <div className="grid grid-cols-2 gap-3 bg-paper-3 p-3.5 border-2 border-ink shadow-nb-sm">
              <div>
                <label className="text-[10px] font-mono uppercase text-ink-soft font-bold block mb-1">
                  Scene Duration
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={2}
                    max={30}
                    step={0.5}
                    value={shot.dur}
                    onChange={(e) =>
                      updateCurrentShot({
                        dur: parseFloat(e.target.value) || 5,
                      })
                    }
                    className="w-20 bg-sunken border-2 border-ink px-2 py-1 text-xs font-mono text-ink text-center shadow-nb-sm"
                  />
                  <span className="text-xs text-ink-soft font-mono">
                    seconds
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase text-ink-soft font-bold block mb-1">
                  Camera Move
                </label>
                <select
                  value={shot.move}
                  onChange={(e) =>
                    updateCurrentShot({ move: e.target.value as any })
                  }
                  className="w-full bg-sunken border-2 border-ink px-2 py-1 text-xs font-mono text-ink shadow-nb-sm"
                >
                  <option value="cut">Direct Cut</option>
                  <option value="pan">Smooth Pan</option>
                  <option value="zoom-in">Zoom In Focus</option>
                  <option value="zoom-out">Zoom Out Overview</option>
                  <option value="hold">Static Hold</option>
                </select>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: VISUAL MODE & INTUITIVE CONTROLS (7 Columns) */}
          <div className="lg:col-span-7 bg-paper p-6 flex flex-col gap-6 overflow-y-auto">
            {/* 1. VISUAL MODE MACRO SELECTOR */}
            <div>
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5 mb-2.5">
                <Palette size={14} /> Visual Mode
              </label>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setVisualMode("standard")}
                  className={`p-3.5 border-2 border-ink text-left transition-all flex flex-col justify-between h-24 ${
                    activeMode === "standard"
                      ? "bg-paper-3 border-2 border-ink text-ink shadow-nb-sm ring-2 ring-select"
                      : "bg-paper-3 border-2 border-ink text-ink-soft hover:border-ink"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <LayoutGrid size={16} className="text-ink" />
                    <span className="text-xs font-bold">Standard Card</span>
                  </div>
                  <span className="text-[10px] text-ink-soft leading-tight">
                    Typography, metrics, or device frames
                  </span>
                </button>

                <button
                  onClick={() => setVisualMode("b-roll")}
                  className={`p-3.5 border-2 border-ink text-left transition-all flex flex-col justify-between h-24 ${
                    activeMode === "b-roll"
                      ? "bg-warn/25 border-2 border-ink text-ink shadow-nb-sm ring-2 ring-select/30"
                      : "bg-paper-3 border-2 border-ink text-ink-soft hover:border-ink"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FilmIcon size={16} className="text-ink" />
                    <span className="text-xs font-bold text-ink">
                      GPU B-Roll
                    </span>
                  </div>
                  <span className="text-[10px] text-ink-soft leading-tight">
                    AI generated video footage overlay
                  </span>
                </button>
              </div>
            </div>

            {/* 2. MODE-SPECIFIC CONTROLS */}

            {/* --- STANDARD CARD MODE --- */}
            {activeMode === "standard" && (
              <div className="space-y-4 bg-paper-3 p-5 border-2 border-ink shadow-nb-sm">
                <h4 className="text-xs font-bold text-ink font-mono uppercase tracking-wider">
                  Standard Scene Blocks
                </h4>
                <p className="text-xs text-ink-soft">
                  Displays kinetic text reveals and concept cards on the spatial
                  canvas.
                </p>

                <div className="space-y-2">
                  {shot.blocks.map((b, i) => (
                    <div
                      key={i}
                      className="p-3 bg-paper border-2 border-ink flex items-center justify-between text-xs shadow-nb-sm"
                    >
                      <div>
                        <span className="font-bold text-ink font-mono">
                          {b.c}
                        </span>
                        :{" "}
                        <span className="text-ink">
                          {(b as any).text ||
                            (b as any).label ||
                            "Standard Block"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* --- GPU B-ROLL MODE --- */}
            {activeMode === "b-roll" && (
              <div className="space-y-4 bg-paper-3 p-5 border-2 border-ink shadow-nb-sm">
                <h4 className="text-xs font-bold text-ink font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <FilmIcon size={14} /> AI Video Footage
                </h4>
                <p className="text-xs text-ink-soft leading-relaxed">
                  Renders full-bleed AI video footage generated from Wan2.1 /
                  Recraft V4 based on visual direction.
                </p>
                <div className="p-3 bg-warn/25 border-2 border-ink/30 text-ink text-xs font-mono flex items-center gap-1.5 shadow-nb-sm">
                  <Check size={12} /> B-Roll footage specification ready
                </div>
              </div>
            )}
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="h-16 px-6 bg-paper-3 border-t-2 border-ink flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 font-mono text-xs text-ink-soft hover:text-ink transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={onClose}
            className="px-6 py-2 bg-paper-3 hover:bg-paper-3 text-ink font-bold text-xs flex items-center gap-1.5 shadow-nb-sm transition-all active:scale-95"
          >
            <Check size={14} />
            <span>Save</span>
          </button>
        </div>
      </div>
    </div>
  );
};
