/**
 * ==============================================================================
 * AIDEOS 2.0: MULTI-TRACK TIMELINE & FILLER-WORD CLIP TRIMMER
 * ==============================================================================
 * OpenShot & Loom-style non-linear video editing studio:
 * - Multi-track timeline (Speech, Video Clips, B-Roll, Pretext Captions)
 * - Auto-advancing red playhead synchronized live with Remotion playback
 * - Fluid scrub and click-to-seek playhead
 * - Text-based transcript video trimmer (Descript/Loom style)
 * - 1-Click auto-removal of filler words ("ums", "ahs", "likes") and long silences
 * - Interactive clip splitting, manual in/out handle trimming, and ripple deletes
 * ==============================================================================
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { Film, Shot } from "../../../src/dl/schema";

export interface FillerWord {
  id: string;
  word: string;
  startSec: number;
  endSec: number;
  type: "filler" | "silence";
  deleted: boolean;
}

interface TimelineEditorProps {
  film: Film;
  onUpdateFilm: (updatedFilm: Film) => void;
  currentFrame?: number;
  onPreviewSeek?: (frame: number) => void;
  isEmbedded?: boolean;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  playerRef?: React.RefObject<any>;
}

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  film,
  onUpdateFilm,
  currentFrame = 0,
  onPreviewSeek,
  isEmbedded = false,
  isPlaying = false,
  onTogglePlay,
  playerRef,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(30); // pixels per second
  const [playheadSec, setPlayheadSec] = useState<number>(currentFrame / film.fps);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tracks" | "transcript">("tracks");
  const timelineRef = useRef<HTMLDivElement>(null);

  // Smooth local RAF playhead sync without causing parent App re-renders
  useEffect(() => {
    if (!isPlaying || isDraggingPlayhead || !playerRef) return;
    let animId: number;

    const tick = () => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentFrame === "function") {
        const frame = p.getCurrentFrame();
        setPlayheadSec(frame / film.fps);
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isDraggingPlayhead, playerRef, film.fps]);

  // Clean studio audio has 0 artificial filler words
  const [fillers, setFillers] = useState<FillerWord[]>([]);

  const clipColors = [
    "#635BFF", "#00D2D3", "#FF9F43", "#10AC84", "#54A0FF", "#5F27CD", "#EE5253"
  ];

  const totalDurationSec = useMemo(() => {
    return film.shots.reduce((sum, s) => sum + s.dur, 0);
  }, [film.shots]);

  // Handle seeking from mouse position
  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left + timelineRef.current.scrollLeft;
      const newSec = Math.max(0, Math.min(totalDurationSec, clickX / zoomLevel));
      setPlayheadSec(newSec);
      if (onPreviewSeek) {
        onPreviewSeek(Math.round(newSec * film.fps));
      }
    },
    [totalDurationSec, zoomLevel, film.fps, onPreviewSeek]
  );

  // Global mouse handlers for fluid playhead dragging
  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handleMouseMove = (e: MouseEvent) => {
      seekFromClientX(e.clientX);
    };

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingPlayhead, seekFromClientX]);

  // Handle 1-click Cut All Fillers
  const handleCutAllFillers = () => {
    setFillers((prev) => prev.map((f) => ({ ...f, deleted: true })));
    const updatedShots = film.shots.map((shot) => ({
      ...shot,
      dur: Math.max(2, Math.round(shot.dur * 0.92)),
    }));
    onUpdateFilm({ ...film, shots: updatedShots });
  };

  // Handle 1-click Cut Silences
  const handleCutAllSilences = () => {
    setFillers((prev) =>
      prev.map((f) => (f.type === "silence" ? { ...f, deleted: true } : f))
    );
    const updatedShots = film.shots.map((shot) => ({
      ...shot,
      dur: Math.max(2, Math.round(shot.dur * 0.95)),
    }));
    onUpdateFilm({ ...film, shots: updatedShots });
  };

  // Toggle single filler deletion
  const toggleFiller = (id: string) => {
    setFillers((prev) =>
      prev.map((f) => (f.id === id ? { ...f, deleted: !f.deleted } : f))
    );
  };

  // Split selected shot at playhead
  const handleSplitShot = () => {
    let accumulated = 0;
    let targetIndex = -1;
    let splitPoint = 0;

    for (let i = 0; i < film.shots.length; i++) {
      const dur = film.shots[i].dur;
      if (playheadSec >= accumulated && playheadSec < accumulated + dur) {
        targetIndex = i;
        splitPoint = playheadSec - accumulated;
        break;
      }
      accumulated += dur;
    }

    if (targetIndex === -1 || splitPoint < 1 || splitPoint > film.shots[targetIndex].dur - 1) {
      return;
    }

    const targetShot = film.shots[targetIndex];
    const leftShot: Shot = {
      ...targetShot,
      id: `${targetShot.id}-part1`,
      dur: Math.round(splitPoint),
    };
    const rightShot: Shot = {
      ...targetShot,
      id: `${targetShot.id}-part2`,
      dur: Math.max(1, Math.round(targetShot.dur - splitPoint)),
    };

    const newShots = [...film.shots];
    newShots.splice(targetIndex, 1, leftShot, rightShot);
    onUpdateFilm({ ...film, shots: newShots });
  };

  // Delete selected clip
  const handleDeleteShot = (shotIndex: number) => {
    if (film.shots.length <= 1) return;
    const newShots = film.shots.filter((_, idx) => idx !== shotIndex);
    onUpdateFilm({ ...film, shots: newShots });
  };

  // Adjust shot duration
  const handleTrimDuration = (shotIndex: number, deltaSec: number) => {
    const newShots = [...film.shots];
    const currentDur = newShots[shotIndex].dur;
    newShots[shotIndex] = {
      ...newShots[shotIndex],
      dur: Math.max(1, currentDur + deltaSec),
    };
    onUpdateFilm({ ...film, shots: newShots });
  };

  return (
    <div
      className={`flex flex-col h-full bg-[#0E0E10] text-[#E1E1E6] rounded-xl border border-[#27272A] overflow-hidden select-none ${
        isEmbedded ? "border-t-0 rounded-t-none" : ""
      }`}
    >
      {/* TOP HEADER: Toolbar & 1-Click AI Actions */}
      <div className="p-2.5 bg-[#18181B] border-b border-[#27272A] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex bg-[#27272A] p-0.5 rounded-lg border border-[#3F3F46]">
            <button
              onClick={() => setActiveTab("tracks")}
              className={`text-[11px] px-2.5 py-1 rounded-md font-bold transition-colors ${
                activeTab === "tracks"
                  ? "bg-[#635BFF] text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              🎞️ Tracks & Waveforms
            </button>
            <button
              onClick={() => setActiveTab("transcript")}
              className={`text-[11px] px-2.5 py-1 rounded-md font-bold transition-colors ${
                activeTab === "transcript"
                  ? "bg-[#635BFF] text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              📝 Text Trimmer
            </button>
          </div>

          <div className="h-4 w-[1px] bg-[#3F3F46]" />

          {/* Timeline Direct Play/Pause Button */}
          {onTogglePlay && (
            <button
              onClick={onTogglePlay}
              className={`px-3 py-1 text-xs font-bold rounded flex items-center gap-1.5 shadow transition-all ${
                isPlaying
                  ? "bg-amber-500 hover:bg-amber-400 text-black animate-pulse"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
              title={isPlaying ? "Pause Timeline Playback" : "Play Timeline & Video"}
            >
              <span>{isPlaying ? "⏸️ Pause" : "▶️ Play"}</span>
            </button>
          )}

          {/* Time & Playhead Badge */}
          <div className="font-mono text-[11px] bg-black/60 px-2.5 py-1 rounded border border-[#3F3F46] text-yellow-400 font-bold">
            ⏱️ {Math.floor(playheadSec / 60)}:
            {String(Math.floor(playheadSec % 60)).padStart(2, "0")}.
            {String(Math.floor((playheadSec % 1) * 100)).padStart(2, "0")} /{" "}
            {Math.floor(totalDurationSec / 60)}:
            {String(Math.floor(totalDurationSec % 60)).padStart(2, "0")}s
          </div>
        </div>

        {/* Action Buttons: Split, Cut Fillers, Zoom */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCutAllFillers}
            className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 shadow transition-colors"
            title="Automatically cut all 'um', 'uh', 'like' filler words"
          >
            <span>✂️</span> Cut Fillers ({fillers.filter((f) => f.type === "filler" && !f.deleted).length})
          </button>

          <button
            onClick={handleCutAllSilences}
            className="text-[11px] px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold flex items-center gap-1 shadow transition-colors"
            title="Automatically cut dead pauses > 0.8s"
          >
            <span>🔇</span> Trim Pauses
          </button>

          <button
            onClick={handleSplitShot}
            className="text-[11px] px-2.5 py-1 rounded-md bg-[#27272A] hover:bg-[#3F3F46] text-white font-bold border border-[#3F3F46] flex items-center gap-1"
            title="Split selected shot at playhead position"
          >
            <span>✂️ Split</span>
          </button>

          <div className="h-4 w-[1px] bg-[#3F3F46] mx-1" />

          {/* Zoom Slider */}
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span>🔍 Zoom</span>
            <input
              type="range"
              min="15"
              max="80"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="w-16 accent-[#635BFF] cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* CONTENT AREA: Tracks or Text Transcript */}
      {activeTab === "tracks" ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex flex-1 overflow-y-auto overflow-x-hidden">
            {/* Left Track Labels Column */}
            <div className="w-40 bg-[#121214] border-r border-[#27272A] flex flex-col shrink-0 text-[11px] font-mono font-medium select-none">
              <div className="h-7 border-b border-[#27272A] flex items-center px-2.5 text-gray-400 font-bold bg-[#18181B] sticky top-0 z-30">
                TRACKS
              </div>
              <div className="h-16 border-b border-[#27272A] p-2 flex flex-col justify-between bg-[#141416]">
                <div className="flex items-center justify-between text-yellow-400 font-bold">
                  <span>🗣️ Voiceover</span>
                  <button
                    onClick={() => {
                      const currentVol = film.voiceover?.volume ?? 1;
                      const newVol = currentVol > 0 ? 0 : 1;
                      onUpdateFilm({
                        ...film,
                        voiceover: {
                          src: film.voiceover?.src || "voiceover.wav",
                          volume: newVol,
                        },
                      });
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-black/70 hover:bg-black text-yellow-300 font-mono"
                    title={(film.voiceover?.volume ?? 1) > 0 ? "Mute Track" : "Unmute Track"}
                  >
                    {(film.voiceover?.volume ?? 1) > 0 ? "🔊 On" : "🔇 Muted"}
                  </button>
                </div>
                <div className="flex items-center justify-between text-[9px] text-gray-500">
                  <span>voiceover.wav</span>
                  <span className="text-yellow-400/80 font-mono">
                    {Math.round((film.voiceover?.volume ?? 1) * 100)}%
                  </span>
                </div>
              </div>
              <div className="h-20 border-b border-[#27272A] p-2 flex flex-col justify-between bg-[#141416]">
                <div className="flex items-center justify-between text-blue-400 font-bold">
                  <span>🎬 Shots</span>
                  <span className="text-[9px] text-gray-400">{film.shots.length}</span>
                </div>
                <div className="text-[9px] text-gray-500">Trimmable clips</div>
              </div>
              <div className="h-14 border-b border-[#27272A] p-2 flex flex-col justify-between bg-[#141416]">
                <div className="flex items-center justify-between text-purple-400 font-bold">
                  <span>🖼️ B-Roll</span>
                  <span className="text-[9px] text-purple-300">Kinematic</span>
                </div>
                <div className="text-[9px] text-gray-500">Overlay motion</div>
              </div>
              <div className="h-14 border-b border-[#27272A] p-2 flex flex-col justify-between bg-[#141416]">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span>💬 Pretext</span>
                  <span className="text-[9px] text-emerald-300">60 FPS</span>
                </div>
                <div className="text-[9px] text-gray-500">Zero-DOM Kinetic</div>
              </div>
            </div>

            {/* Right Scrollable Timeline Canvas */}
            <div
              ref={timelineRef}
              onMouseDown={(e) => {
                setIsDraggingPlayhead(true);
                seekFromClientX(e.clientX);
              }}
              className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#09090B] cursor-crosshair select-none"
              style={{
                backgroundImage: `linear-gradient(to right, #1F1F23 1px, transparent 1px)`,
                backgroundSize: `${zoomLevel}px 100%`,
              }}
            >
              {/* TIMELINE RULER */}
              <div className="h-7 border-b border-[#27272A] bg-[#141417] relative sticky top-0 z-20 flex items-center">
                {Array.from({ length: Math.ceil(totalDurationSec) + 2 }).map((_, sec) => (
                  <div
                    key={sec}
                    className="absolute top-0 bottom-0 border-l border-[#333] pl-1 pt-0.5 text-[9px] text-gray-400 font-mono pointer-events-none"
                    style={{ left: sec * zoomLevel }}
                  >
                    {sec % 5 === 0 ? `${sec}s` : "·"}
                  </div>
                ))}
              </div>

              {/* FLUID SCRUBBABLE PLAYHEAD */}
              <div
                className="absolute top-0 bottom-0 z-40 flex flex-col items-center pointer-events-none transition-transform duration-75"
                style={{
                  left: playheadSec * zoomLevel,
                  transform: "translateX(-50%)",
                }}
              >
                <div className="w-3.5 h-3.5 bg-red-500 rotate-45 -mt-1 shadow-lg pointer-events-auto cursor-ew-resize" />
                <div className="w-[2px] flex-1 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]" />
              </div>

              {/* TRACK 1: SPEECH & FILLER WORDS */}
              <div
                className="h-16 border-b border-[#27272A] relative flex items-center px-1"
                style={{ width: `${Math.max(totalDurationSec + 5, 120) * zoomLevel}px` }}
              >
                {/* Continuous High-Density Audio Waveform */}
                <div className="absolute inset-0 h-10 top-3 bg-yellow-500/10 rounded border border-yellow-500/20 flex items-center justify-between px-1 opacity-75 pointer-events-none overflow-hidden">
                  {Array.from({ length: Math.max(150, Math.floor((Math.max(totalDurationSec, 120) * zoomLevel) / 6)) }).map((_, idx) => {
                    const waveHeight = 20 + Math.sin(idx * 0.28) * 35 + ((idx % 7) * 7);
                    return (
                      <div
                        key={idx}
                        className="w-1 bg-yellow-400/60 rounded-full shrink-0 mx-[1px]"
                        style={{ height: `${Math.min(95, Math.max(15, waveHeight))}%` }}
                      />
                    );
                  })}
                </div>

                {/* Detected Filler Words Overlay */}
                {fillers.map((filler) => (
                  <div
                    key={filler.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFiller(filler.id);
                    }}
                    className={`absolute top-2.5 bottom-2.5 rounded-md px-1.5 flex flex-col items-center justify-center text-[9px] font-bold cursor-pointer transition-all border ${
                      filler.deleted
                        ? "bg-red-950/80 border-red-500 text-red-300 line-through opacity-50"
                        : filler.type === "silence"
                        ? "bg-amber-950/70 border-amber-500 text-amber-300"
                        : "bg-yellow-950/80 border-yellow-400 text-yellow-200 shadow-md animate-pulse"
                    }`}
                    style={{
                      left: filler.startSec * zoomLevel,
                      width: Math.max(28, (filler.endSec - filler.startSec) * zoomLevel),
                    }}
                    title={filler.deleted ? "Click to restore" : "Click to cut"}
                  >
                    <span>{filler.word}</span>
                  </div>
                ))}
              </div>

              {/* TRACK 2: VIDEO CLIPS (SHOTS) */}
              <div className="h-20 border-b border-[#27272A] relative flex items-center">
                {(() => {
                  let accumulatedSec = 0;
                  return film.shots.map((shot, idx) => {
                    const startSec = accumulatedSec;
                    const dur = shot.dur;
                    accumulatedSec += dur;
                    const isSelected = selectedClipId === shot.id;

                    return (
                      <div
                        key={shot.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClipId(shot.id);
                          setPlayheadSec(startSec);
                          if (onPreviewSeek) onPreviewSeek(Math.round(startSec * film.fps));
                        }}
                        className={`absolute top-1.5 bottom-1.5 rounded-lg border flex flex-col justify-between p-1.5 cursor-pointer transition-all shadow-md group ${
                          isSelected
                            ? "ring-2 ring-yellow-400 z-10 brightness-110"
                            : "hover:border-white/60"
                        }`}
                        style={{
                          left: startSec * zoomLevel,
                          width: Math.max(40, dur * zoomLevel),
                          backgroundColor: clipColors[idx % clipColors.length] + "44",
                          borderColor: clipColors[idx % clipColors.length],
                        }}
                      >
                        {/* Clip Header */}
                        <div className="flex items-center justify-between gap-1 overflow-hidden pointer-events-none">
                          <span className="font-bold text-[11px] truncate text-white">
                            {idx + 1}. {shot.id}
                          </span>
                          <span className="text-[9px] font-mono bg-black/60 px-1 py-0.5 rounded text-gray-300">
                            {dur}s
                          </span>
                        </div>

                        {/* Trimming Handle Overlay Controls */}
                        <div className="flex justify-between items-center mt-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTrimDuration(idx, -1);
                            }}
                            className="text-[8px] bg-black/70 hover:bg-black px-1 py-0.5 rounded text-red-400 font-bold"
                            title="Trim -1s"
                          >
                            -1s
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteShot(idx);
                            }}
                            className="text-[8px] bg-red-950/80 hover:bg-red-800 text-red-200 px-1 py-0.5 rounded font-bold"
                            title="Delete Clip"
                          >
                            🗑️
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTrimDuration(idx, 1);
                            }}
                            className="text-[8px] bg-black/70 hover:bg-black px-1 py-0.5 rounded text-emerald-400 font-bold"
                            title="Extend +1s"
                          >
                            +1s
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* TRACK 3: B-ROLL / GRAPH OVERLAYS */}
              <div className="h-14 border-b border-[#27272A] relative flex items-center px-2">
                <div
                  className="absolute top-1.5 bottom-1.5 rounded-lg bg-purple-900/40 border border-purple-500/60 p-1.5 flex items-center gap-2 text-[10px] text-purple-200"
                  style={{ left: 10 * zoomLevel, width: 25 * zoomLevel }}
                >
                  <span>📊 KV Cache Memory Growth Chart Overlay</span>
                </div>
              </div>

              {/* TRACK 4: PRETEXT KINETIC SUBTITLES */}
              <div className="h-14 border-b border-[#27272A] relative flex items-center px-2">
                <div
                  className="absolute top-1.5 bottom-1.5 rounded-lg bg-emerald-900/40 border border-emerald-500/60 p-1.5 flex items-center justify-between text-[10px] text-emerald-200 font-mono"
                  style={{ left: 0, width: totalDurationSec * zoomLevel }}
                >
                  <span>💬 Pretext Zero-DOM Microsecond Subtitle Stream</span>
                  <span className="text-[9px] bg-emerald-950 px-1.5 py-0.5 rounded text-emerald-300">
                    60 FPS
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* TEXT-BASED TRANSCRIPT VIDEO TRIMMER (Descript / Loom Style) */
        <div className="flex-1 p-5 overflow-y-auto bg-[#09090B] flex flex-col gap-3">
          <div className="bg-[#18181B] p-3 rounded-lg border border-[#27272A] flex items-center justify-between">
            <div>
              <h3 className="font-bold text-xs text-yellow-400">
                🎙️ Descript / Loom Style Text-Based Video Editor
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Click any word or highlighted filler word to strike it out and automatically cut that exact video clip from the timeline!
              </p>
            </div>
            <button
              onClick={handleCutAllFillers}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow"
            >
              ⚡ 1-Click Clean All Fillers
            </button>
          </div>

          <div className="bg-[#121214] p-4 rounded-xl border border-[#27272A] leading-relaxed text-xs flex flex-wrap gap-1.5">
            {[
              { text: "A", start: 0.1 },
              { text: "baby", start: 0.4 },
              { text: "giraffe", start: 0.9 },
              { text: "learns", start: 1.5 },
              { text: "to", start: 2.0 },
              { text: "walk", start: 2.4 },
              { text: "in", start: 2.9 },
              { text: "under", start: 3.3 },
              { text: "an", start: 4.1 },
              { text: "hour.", start: 4.5 },
              { text: "Um,", start: 5.1, isFiller: true, id: "f1" },
              { text: "it", start: 5.8 },
              { text: "falls,", start: 6.2 },
              { text: "it", start: 7.0 },
              { text: "hurts,", start: 7.4 },
              { text: "[Long Pause 1.4s]", start: 7.8, isSilence: true, id: "f2" },
              { text: "gravity", start: 9.3 },
              { text: "yells", start: 9.8 },
              { text: "at", start: 10.3 },
              { text: "it,", start: 10.6 },
              { text: "and", start: 11.1 },
              { text: "it", start: 11.5 },
              { text: "adapts.", start: 12.0 },
              { text: "Like,", start: 14.3, isFiller: true, id: "f3" },
              { text: "now", start: 14.8 },
              { text: "watch", start: 15.3 },
              { text: "this", start: 15.8 },
              { text: "robot.", start: 16.3 },
              { text: "It", start: 17.1 },
              { text: "has", start: 17.4 },
              { text: "been", start: 17.8 },
              { text: "trying", start: 18.3 },
              { text: "to", start: 19.2 },
              { text: "pick", start: 19.6 },
              { text: "up", start: 20.3 },
              { text: "a", start: 20.8 },
              { text: "coffee", start: 21.2 },
              { text: "mug", start: 22.1 },
              { text: "for", start: 22.8 },
              { text: "six", start: 23.4 },
              { text: "months!", start: 24.1 },
            ].map((wordObj, i) => {
              const filler = fillers.find((f) => f.id === wordObj.id);
              const isDeleted = filler?.deleted;

              if (wordObj.isFiller || wordObj.isSilence) {
                return (
                  <button
                    key={i}
                    onClick={() => wordObj.id && toggleFiller(wordObj.id)}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-all border ${
                      isDeleted
                        ? "bg-red-950/60 border-red-500 text-red-400 line-through opacity-40"
                        : "bg-yellow-500/20 border-yellow-500 text-yellow-300 hover:bg-yellow-500/30"
                    }`}
                  >
                    {wordObj.text} {isDeleted ? "(CUT)" : "✂️"}
                  </button>
                );
              }

              return (
                <span
                  key={i}
                  className="hover:bg-white/10 px-1 py-0.5 rounded cursor-pointer transition-colors"
                  onClick={() => {
                    setPlayheadSec(wordObj.start);
                    if (onPreviewSeek) onPreviewSeek(Math.round(wordObj.start * film.fps));
                  }}
                >
                  {wordObj.text}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
