/**
 * File Description: Aideos Direct Manipulation Multi-Track Timeline & Trimmer.
 * Implements Phase T-B (Move along track, left/right trim, multi-select with offset preservation,
 * collision resolution, snap guide lines, sub-second precision) and Phase T-C (Universal undo/redo, shortcuts).
 * Features real-time Narration Sync Drift Badge with 1-click Re-alignment and interactive Voiceover/Subtitle/Metaphor tracks.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { Film } from "../../../src/dl/schema";
import {
  type SnapTarget,
  TimelineUndoStack,
  computeShotStartTimes,
  calculateSnap,
  moveShot,
  moveMultipleShots,
  trimShotEdge,
  splitShotAtTime,
  deleteShot,
} from "../../../backend/timeline/timeline";
import { generateWordsFromFilm } from "../../../src/dl/captionsParser";
import type { TransitionType } from "../transitions";

interface TimelineEditorProps {
  film: Film;
  onUpdateFilm: (updatedFilm: Film) => void;
  currentFrame?: number;
  onPreviewSeek?: (frame: number) => void;
  isEmbedded?: boolean;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  playerRef?: React.RefObject<any>;
  totalDurationSec?: number;
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
  totalDurationSec: overrideTotalDurationSec,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(35); // pixels per second
  const [playheadSec, setPlayheadSec] = useState<number>(currentFrame / (film.fps || 30));
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([film.shots[0]?.id ?? ""]);
  const [activeTab, setActiveTab] = useState<"tracks" | "transcript">("tracks");

  // Drag-to-move state
  const [movingClip, setMovingClip] = useState<{
    shotIndex: number;
    startX: number;
    initialStartSec: number;
    currentDeltaSec: number;
  } | null>(null);

  // Drag-to-trim state (for Shots)
  const [trimming, setTrimming] = useState<{
    shotIndex: number;
    edge: "left" | "right";
    startX: number;
    initialDur: number;
    currentDelta: number;
  } | null>(null);

  // Drag-to-trim state (for Voiceover)
  const [voTrimming, setVoTrimming] = useState<{
    edge: "left" | "right";
    startX: number;
    initialInSec: number;
    initialDur: number;
    currentDelta: number;
  } | null>(null);

  // Active snap guide timestamp
  const [activeSnapTime, setActiveSnapTime] = useState<number | null>(null);

  // Undo / Redo Stack (Phase T-C)
  const undoStackRef = useRef<TimelineUndoStack>(new TimelineUndoStack(60));
  const [, setUndoTick] = useState(0);

  const triggerUpdateWithUndo = useCallback(
    (newFilm: Film, label: string) => {
      undoStackRef.current.push(film, label);
      setUndoTick((t) => t + 1);
      onUpdateFilm(newFilm);
    },
    [film, onUpdateFilm]
  );

  const handleUndo = useCallback(() => {
    const res = undoStackRef.current.undo(film);
    if (res) {
      setUndoTick((t) => t + 1);
      onUpdateFilm(res.film);
    }
  }, [film, onUpdateFilm]);

  const handleRedo = useCallback(() => {
    const res = undoStackRef.current.redo(film);
    if (res) {
      setUndoTick((t) => t + 1);
      onUpdateFilm(res.film);
    }
  }, [film, onUpdateFilm]);

  const timelineRef = useRef<HTMLDivElement>(null);
  const fps = film.fps || 30;

  // Sync playhead smoothly with Remotion player
  useEffect(() => {
    if (!isPlaying || isDraggingPlayhead || !playerRef) return;
    let animId: number;

    const tick = () => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentFrame === "function") {
        const frame = p.getCurrentFrame();
        setPlayheadSec(frame / fps);
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isDraggingPlayhead, playerRef, fps]);

  const shotStartTimes = useMemo(() => {
    return computeShotStartTimes(film.shots);
  }, [film.shots]);

  const baseShotsDurSum = useMemo(() => {
    return film.shots.reduce((sum, s) => sum + (s.dur || 3), 0);
  }, [film.shots]);

  const totalDurationSec = useMemo(() => {
    if (overrideTotalDurationSec && overrideTotalDurationSec > 0) {
      return overrideTotalDurationSec;
    }
    const maxEnd = film.shots.reduce((max, s, i) => {
      const start = shotStartTimes[i] ?? 0;
      return Math.max(max, start + s.dur);
    }, 0);
    return Math.max(baseShotsDurSum, maxEnd);
  }, [overrideTotalDurationSec, baseShotsDurSum, film.shots, shotStartTimes]);

  // Voiceover Timing & Drift Calculation
  const voiceoverTargetSec = overrideTotalDurationSec && overrideTotalDurationSec > 0 ? overrideTotalDurationSec : baseShotsDurSum;
  const driftSec = totalDurationSec - voiceoverTargetSec;
  const isSynchronized = Math.abs(driftSec) <= 0.05;

  const handleRealignNarration = () => {
    const ratio = voiceoverTargetSec > 0 ? voiceoverTargetSec / totalDurationSec : 1;
    const realignedShots = film.shots.map((shot) => ({
      ...shot,
      startSec: undefined, // restore tight sequential alignment
      dur: Number((shot.dur * ratio).toFixed(3)),
    }));
    triggerUpdateWithUndo({ ...film, shots: realignedShots }, "Re-align timeline to voiceover");
  };

  // Real Subtitle Caption Words derived from film data / VTT
  const captionWords = useMemo(() => {
    return generateWordsFromFilm(film as unknown as Record<string, unknown>);
  }, [film]);

  // Snap targets collection
  const snapTargets = useMemo<SnapTarget[]>(() => {
    const targets: SnapTarget[] = [
      { timeSec: 0, type: "grid", label: "0s" },
      { timeSec: totalDurationSec, type: "grid", label: `${totalDurationSec.toFixed(1)}s` },
      { timeSec: playheadSec, type: "playhead", label: "playhead" },
    ];
    for (let i = 0; i < film.shots.length; i++) {
      const start = shotStartTimes[i] ?? 0;
      targets.push({ timeSec: start, type: "boundary", label: `${film.shots[i].id} start` });
      targets.push({ timeSec: start + film.shots[i].dur, type: "boundary", label: `${film.shots[i].id} cut` });
    }
    for (let s = 1; s < totalDurationSec; s += 1) {
      targets.push({ timeSec: s, type: "grid" });
    }
    return targets;
  }, [film.shots, shotStartTimes, totalDurationSec, playheadSec]);

  // Seek helper
  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left + timelineRef.current.scrollLeft;
      const rawSec = Math.max(0, Math.min(totalDurationSec, clickX / zoomLevel));
      const frameAlignedSec = Math.round(rawSec * fps) / fps;
      setPlayheadSec(frameAlignedSec);
      if (onPreviewSeek) {
        onPreviewSeek(Math.round(frameAlignedSec * fps));
      }
    },
    [totalDurationSec, zoomLevel, fps, onPreviewSeek]
  );

  // Playhead scrubbing global mouse handlers
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

  // Global Drag-to-Move Handler (TB-1 & TB-6)
  useEffect(() => {
    if (!movingClip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - movingClip.startX;
      let deltaSec = deltaPx / zoomLevel;

      if (!e.altKey) {
        const targetStart = movingClip.initialStartSec + deltaSec;
        const { snappedTimeSec, activeSnap } = calculateSnap(targetStart, snapTargets, zoomLevel, 8);
        if (activeSnap) {
          deltaSec = snappedTimeSec - movingClip.initialStartSec;
          setActiveSnapTime(snappedTimeSec);
        } else {
          setActiveSnapTime(null);
        }
      } else {
        setActiveSnapTime(null);
      }

      setMovingClip((prev) => (prev ? { ...prev, currentDeltaSec: deltaSec } : null));
    };

    const handleMouseUp = () => {
      if (movingClip && Math.abs(movingClip.currentDeltaSec) > 0.01) {
        try {
          const selectedIndices = selectedShotIds
            .map((id) => film.shots.findIndex((s) => s.id === id))
            .filter((idx) => idx !== -1);

          if (selectedIndices.length > 1 && selectedIndices.includes(movingClip.shotIndex)) {
            const updatedFilm = moveMultipleShots(film, selectedIndices, movingClip.currentDeltaSec);
            triggerUpdateWithUndo(updatedFilm, `Move ${selectedIndices.length} shots`);
          } else {
            const newStart = Math.max(0, movingClip.initialStartSec + movingClip.currentDeltaSec);
            const updatedFilm = moveShot(film, movingClip.shotIndex, newStart);
            triggerUpdateWithUndo(updatedFilm, `Move ${film.shots[movingClip.shotIndex]?.id}`);
          }
        } catch (err) {
          console.warn("[Timeline Move Rejected]", (err as Error).message);
        }
      }
      setMovingClip(null);
      setActiveSnapTime(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [movingClip, zoomLevel, film, snapTargets, selectedShotIds, triggerUpdateWithUndo]);

  // Global Trimming Drag Handler (TB-2)
  useEffect(() => {
    if (!trimming) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - trimming.startX;
      let deltaSec = deltaPx / zoomLevel;

      if (!e.altKey) {
        const shot = film.shots[trimming.shotIndex];
        const startSec = shotStartTimes[trimming.shotIndex] ?? 0;
        const targetCutTime = trimming.edge === "right" ? startSec + shot.dur + deltaSec : startSec + deltaSec;
        const { snappedTimeSec, activeSnap } = calculateSnap(targetCutTime, snapTargets, zoomLevel, 8);
        if (activeSnap) {
          deltaSec = trimming.edge === "right" ? snappedTimeSec - (startSec + shot.dur) : snappedTimeSec - startSec;
          setActiveSnapTime(snappedTimeSec);
        } else {
          setActiveSnapTime(null);
        }
      } else {
        setActiveSnapTime(null);
      }

      setTrimming((prev) => (prev ? { ...prev, currentDelta: deltaSec } : null));
    };

    const handleMouseUp = () => {
      if (trimming && Math.abs(trimming.currentDelta) > 0.01) {
        try {
          const updatedFilm = trimShotEdge(
            film,
            trimming.shotIndex,
            trimming.edge,
            trimming.currentDelta,
            "free-edit"
          );
          triggerUpdateWithUndo(
            updatedFilm,
            `Trim ${film.shots[trimming.shotIndex]?.id} ${trimming.edge} edge`
          );
        } catch (err) {
          console.warn("[Timeline Trim Rejected]", (err as Error).message);
        }
      }
      setTrimming(null);
      setActiveSnapTime(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [trimming, zoomLevel, film, snapTargets, shotStartTimes, triggerUpdateWithUndo]);

  // Voiceover Trimming Handler
  useEffect(() => {
    if (!voTrimming) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - voTrimming.startX;
      const deltaSec = deltaPx / zoomLevel;
      setVoTrimming((prev) => (prev ? { ...prev, currentDelta: deltaSec } : null));
    };

    const handleMouseUp = () => {
      if (voTrimming && Math.abs(voTrimming.currentDelta) > 0.01) {
        const currentIn = voTrimming.initialInSec;
        const newIn = Math.max(0, currentIn + (voTrimming.edge === "left" ? voTrimming.currentDelta : 0));
        triggerUpdateWithUndo(
          {
            ...film,
            voiceover: {
              src: film.voiceover?.src || "voiceover.wav",
              volume: film.voiceover?.volume ?? 1,
              ...(newIn > 0 ? { inSec: Number(newIn.toFixed(2)) } : {}),
            } as any,
          },
          `Trim voiceover audio`
        );
      }
      setVoTrimming(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [voTrimming, zoomLevel, film, triggerUpdateWithUndo]);

  // Keyboard Navigation & Shortcuts (Phase T-C)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Undo: Cmd+Z (or Ctrl+Z)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo: Cmd+Shift+Z or Ctrl+Y
      if (
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "z") ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y")
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Space: Play / Pause
      if (e.code === "Space") {
        e.preventDefault();
        if (onTogglePlay) onTogglePlay();
        return;
      }

      // Left / Right: 1 frame step
      if (e.key === "ArrowLeft" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const delta = e.shiftKey ? 1.0 : 1 / fps;
        const newSec = Math.max(0, playheadSec - delta);
        setPlayheadSec(newSec);
        if (onPreviewSeek) onPreviewSeek(Math.round(newSec * fps));
        return;
      }
      if (e.key === "ArrowRight" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const delta = e.shiftKey ? 1.0 : 1 / fps;
        const newSec = Math.min(totalDurationSec, playheadSec + delta);
        setPlayheadSec(newSec);
        if (onPreviewSeek) onPreviewSeek(Math.round(newSec * fps));
        return;
      }

      // Cmd + Left / Right: Jump to previous / next shot cut boundary
      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowLeft") {
        e.preventDefault();
        for (let i = shotStartTimes.length - 1; i >= 0; i--) {
          if (shotStartTimes[i] < playheadSec - 0.05) {
            setPlayheadSec(shotStartTimes[i]);
            if (onPreviewSeek) onPreviewSeek(Math.round(shotStartTimes[i] * fps));
            break;
          }
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowRight") {
        e.preventDefault();
        for (let i = 0; i < shotStartTimes.length; i++) {
          if (shotStartTimes[i] > playheadSec + 0.05) {
            setPlayheadSec(shotStartTimes[i]);
            if (onPreviewSeek) onPreviewSeek(Math.round(shotStartTimes[i] * fps));
            break;
          }
        }
        return;
      }

      // S: Split selected clip at playhead
      if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        try {
          const splitFilm = splitShotAtTime(film, playheadSec);
          triggerUpdateWithUndo(splitFilm, `Split shot at ${playheadSec.toFixed(2)}s`);
        } catch (err) {
          console.warn("[Split Rejected]", (err as Error).message);
        }
        return;
      }

      // Backspace / Delete: Delete selected shot
      if (e.key === "Backspace" || e.key === "Delete") {
        const primarySelected = selectedShotIds[0];
        if (primarySelected && film.shots.length > 1) {
          const idx = film.shots.findIndex((s) => s.id === primarySelected);
          if (idx !== -1) {
            e.preventDefault();
            try {
              const deletedFilm = deleteShot(film, idx, "free-edit");
              triggerUpdateWithUndo(deletedFilm, `Delete ${primarySelected}`);
              setSelectedShotIds([deletedFilm.shots[Math.max(0, idx - 1)]?.id ?? ""]);
            } catch (err) {
              console.warn("[Delete Rejected]", (err as Error).message);
            }
          }
        }
        return;
      }

      // Zoom keys: + and -
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setZoomLevel((z) => Math.min(120, z + 5));
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        setZoomLevel((z) => Math.max(15, z - 5));
        return;
      }

      // Shift + Z: Zoom to fit whole film
      if (e.shiftKey && e.key.toLowerCase() === "z" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (timelineRef.current && totalDurationSec > 0) {
          const availableWidth = timelineRef.current.clientWidth - 40;
          setZoomLevel(Math.max(15, Math.min(120, Math.floor(availableWidth / totalDurationSec))));
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    fps,
    playheadSec,
    totalDurationSec,
    shotStartTimes,
    selectedShotIds,
    film,
    onTogglePlay,
    onPreviewSeek,
    handleUndo,
    handleRedo,
    triggerUpdateWithUndo,
  ]);

  const clipColors = [
    "#635BFF", "#00D2D3", "#FF9F43", "#10AC84", "#54A0FF", "#5F27CD", "#EE5253"
  ];

  return (
    <div
      className={`flex flex-col h-full bg-[#0E0E10] text-[#E1E1E6] rounded-xl border border-[#27272A] overflow-hidden select-none ${
        isEmbedded ? "border-t-0 rounded-t-none" : ""
      }`}
    >
      {/* TOP HEADER: Toolbar, Sync Status Badge, Undo/Redo & Precision Controls */}
      <div className="p-2 bg-[#18181B] border-b border-[#27272A] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2">
          {/* Tabs */}
          <div className="flex bg-[#27272A] p-0.5 rounded-lg border border-[#3F3F46]">
            <button
              onClick={() => setActiveTab("tracks")}
              className={`text-[11px] px-2.5 py-1 rounded-md font-bold transition-colors ${
                activeTab === "tracks"
                  ? "bg-[#635BFF] text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              🎞️ Tracks
            </button>
            <button
              onClick={() => setActiveTab("transcript")}
              className={`text-[11px] px-2.5 py-1 rounded-md font-bold transition-colors ${
                activeTab === "transcript"
                  ? "bg-[#635BFF] text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              📝 Script & Words
            </button>
          </div>

          <div className="h-4 w-[1px] bg-[#3F3F46]" />

          {/* Direct Play/Pause Button */}
          {onTogglePlay && (
            <button
              onClick={onTogglePlay}
              className={`px-3 py-1 text-xs font-bold rounded flex items-center gap-1.5 shadow transition-all ${
                isPlaying
                  ? "bg-amber-500 hover:bg-amber-400 text-black"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
              title={isPlaying ? "Pause Timeline (Space)" : "Play Timeline (Space)"}
            >
              <span>{isPlaying ? "⏸️" : "▶️"}</span>
            </button>
          )}

          {/* Timecode Display (mm:ss.ff) */}
          <div className="font-mono text-[11px] bg-black/60 px-2.5 py-1 rounded border border-[#3F3F46] text-yellow-400 font-bold">
            {Math.floor(playheadSec / 60)}:
            {String(Math.floor(playheadSec % 60)).padStart(2, "0")}.
            {String(Math.round((playheadSec % 1) * fps)).padStart(2, "0")}f /{" "}
            {Math.floor(totalDurationSec / 60)}:
            {String(Math.floor(totalDurationSec % 60)).padStart(2, "0")}s
          </div>

          {/* Real-Time Narration Sync Status Badge with 1-Click Re-align Action */}
          <button
            onClick={handleRealignNarration}
            className={`text-[10px] font-mono px-2.5 py-1 rounded border font-bold transition-all shadow flex items-center gap-1.5 cursor-pointer ${
              isSynchronized
                ? "bg-emerald-950/90 border-emerald-500 text-emerald-300 hover:bg-emerald-900"
                : "bg-amber-950/90 border-amber-500 text-amber-300 hover:bg-amber-900"
            }`}
            title={
              isSynchronized
                ? "Timeline in sync with voiceover (±0.0s)"
                : `Drifted by ${driftSec > 0 ? "+" : ""}${driftSec.toFixed(2)}s from voiceover. Click for 1-Click Re-alignment.`
            }
          >
            <span>{isSynchronized ? "🟢 In Sync" : `⚠️ Drifted ${driftSec > 0 ? "+" : ""}${driftSec.toFixed(1)}s (⚡ Re-align)`}</span>
          </button>
        </div>

        {/* Undo / Redo & Split & Zoom */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUndo}
            disabled={!undoStackRef.current.canUndo()}
            className="p-1 px-2 rounded bg-[#27272A] hover:bg-[#3F3F46] disabled:opacity-30 text-xs text-gray-200 border border-[#3F3F46]"
            title="Undo (Cmd+Z)"
          >
            ↩️ Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={!undoStackRef.current.canRedo()}
            className="p-1 px-2 rounded bg-[#27272A] hover:bg-[#3F3F46] disabled:opacity-30 text-xs text-gray-200 border border-[#3F3F46]"
            title="Redo (Cmd+Shift+Z)"
          >
            ↪️ Redo
          </button>

          <div className="h-4 w-[1px] bg-[#3F3F46] mx-1" />

          {/* Split Button */}
          <button
            onClick={() => {
              try {
                const splitFilm = splitShotAtTime(film, playheadSec);
                triggerUpdateWithUndo(splitFilm, `Split shot at ${playheadSec.toFixed(2)}s`);
              } catch (err) {
                console.warn("[Split Rejected]", (err as Error).message);
              }
            }}
            className="text-[11px] px-2.5 py-1 rounded-md bg-[#27272A] hover:bg-[#3F3F46] text-white font-bold border border-[#3F3F46] flex items-center gap-1"
            title="Split selected shot at playhead (S key)"
          >
            <span>✂️ Split</span>
          </button>

          {/* Delete Button */}
          <button
            onClick={() => {
              const primarySelected = selectedShotIds[0];
              if (primarySelected && film.shots.length > 1) {
                const idx = film.shots.findIndex((s) => s.id === primarySelected);
                if (idx !== -1) {
                  try {
                    const deletedFilm = deleteShot(film, idx, "free-edit");
                    triggerUpdateWithUndo(deletedFilm, `Delete ${primarySelected}`);
                    setSelectedShotIds([deletedFilm.shots[Math.max(0, idx - 1)]?.id ?? ""]);
                  } catch (err) {
                    console.warn("[Delete Rejected]", (err as Error).message);
                  }
                }
              }
            }}
            disabled={selectedShotIds.length === 0 || film.shots.length <= 1}
            className="text-[11px] px-2 py-1 rounded-md bg-red-950/60 hover:bg-red-900 border border-red-800 disabled:opacity-30 text-red-200"
            title="Delete Selected Clip (Backspace)"
          >
            🗑️
          </button>

          <div className="h-4 w-[1px] bg-[#3F3F46] mx-1" />

          {/* Zoom Slider */}
          <div className="flex items-center gap-1 text-[10px] text-gray-400 font-mono">
            <span>Zoom</span>
            <input
              type="range"
              min="15"
              max="100"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="w-16 accent-[#635BFF] cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* CONTENT AREA */}
      {activeTab === "tracks" ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex flex-1 overflow-y-auto overflow-x-hidden">
            {/* Left Track Labels Column */}
            <div className="w-36 bg-[#121214] border-r border-[#27272A] flex flex-col shrink-0 text-[11px] font-mono select-none">
              <div className="h-7 border-b border-[#27272A] flex items-center px-2.5 text-gray-400 font-bold bg-[#18181B] sticky top-0 z-30">
                TRACKS
              </div>
              <div className="h-14 border-b border-[#27272A] p-2 flex flex-col justify-between bg-[#141416]">
                <div className="flex items-center justify-between text-yellow-400 font-bold">
                  <span>🗣️ Voiceover</span>
                  <button
                    onClick={() => {
                      const currentVol = film.voiceover?.volume ?? 1;
                      const newVol = currentVol > 0 ? 0 : 1;
                      triggerUpdateWithUndo(
                        {
                          ...film,
                          voiceover: {
                            src: film.voiceover?.src || "voiceover.wav",
                            volume: newVol,
                          },
                        },
                        "Toggle voiceover mute"
                      );
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-black/70 hover:bg-black text-yellow-300 font-mono"
                  >
                    {(film.voiceover?.volume ?? 1) > 0 ? "🔊 On" : "🔇 Mute"}
                  </button>
                </div>
                <div className="text-[9px] text-gray-500 truncate">{film.voiceover?.src || "voiceover.wav"}</div>
              </div>
              <div className="h-20 border-b border-[#27272A] p-2 flex flex-col justify-between bg-[#141416]">
                <div className="flex items-center justify-between text-blue-400 font-bold">
                  <span>🎬 Shots</span>
                  <span className="text-[9px] text-gray-400">{film.shots.length}</span>
                </div>
                <div className="text-[9px] text-gray-500">Drag to move/trim</div>
              </div>
              <div className="h-14 border-b border-[#27272A] p-2 flex flex-col justify-between bg-[#141416]">
                <div className="flex items-center justify-between text-purple-400 font-bold">
                  <span>🖼️ Visual Device</span>
                </div>
                <div className="text-[9px] text-gray-500">Click to change</div>
              </div>
              <div className="h-14 border-b border-[#27272A] p-2 flex flex-col justify-between bg-[#141416]">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span>💬 Subtitles</span>
                </div>
                <div className="text-[9px] text-gray-500">Phrase-locked</div>
              </div>
            </div>

            {/* Right Scrollable Timeline Canvas */}
            <div
              ref={timelineRef}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement)?.dataset?.handle) return;
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

              {/* SNAP GUIDE LINE */}
              {activeSnapTime !== null && (
                <div
                  className="absolute top-0 bottom-0 z-30 w-[1px] bg-cyan-400 shadow-[0_0_8px_cyan] pointer-events-none"
                  style={{ left: activeSnapTime * zoomLevel }}
                />
              )}

              {/* PLAYHEAD */}
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

              {/* TRACK 1: SPEECH & AUDIO TIMELINE (TRIMMABLE VOICEOVER CLIP) */}
              <div
                className="h-14 border-b border-[#27272A] relative flex items-center px-1"
                style={{ width: `${Math.max(totalDurationSec + 5, 60) * zoomLevel}px` }}
              >
                <div
                  className="absolute top-2 bottom-2 rounded bg-yellow-950/40 border border-yellow-500/50 px-2 flex items-center justify-between text-[10px] text-yellow-300 font-mono group"
                  style={{
                    left: 0,
                    width: Math.max(30, (voiceoverTargetSec + (voTrimming?.currentDelta ?? 0)) * zoomLevel),
                  }}
                >
                  <div
                    data-handle="vo-left"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setVoTrimming({
                        edge: "left",
                        startX: e.clientX,
                        initialInSec: 0,
                        initialDur: voiceoverTargetSec,
                        currentDelta: 0,
                      });
                    }}
                    className="absolute top-0 bottom-0 left-0 w-2 bg-yellow-400/30 hover:bg-yellow-400 cursor-col-resize rounded-l opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Trim Voiceover In-Point"
                  />
                  <span className="truncate pointer-events-none">🗣️ {film.voiceover?.src || "Voiceover Audio Spine"}</span>
                  <span className="text-[9px] opacity-75 pointer-events-none">{voiceoverTargetSec.toFixed(2)}s</span>
                  <div
                    data-handle="vo-right"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setVoTrimming({
                        edge: "right",
                        startX: e.clientX,
                        initialInSec: 0,
                        initialDur: voiceoverTargetSec,
                        currentDelta: 0,
                      });
                    }}
                    className="absolute top-0 bottom-0 right-0 w-2 bg-yellow-400/30 hover:bg-yellow-400 cursor-col-resize rounded-r opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Trim Voiceover Duration"
                  />
                </div>
              </div>

              {/* TRACK 2: VIDEO SHOTS (DIRECT MANIPULATION: MOVE & TRIM) */}
              <div
                className="h-20 border-b border-[#27272A] relative flex items-center"
                style={{ width: `${Math.max(totalDurationSec + 5, 60) * zoomLevel}px` }}
              >
                {(() => {
                  const transitionTypes: TransitionType[] = ["paper-rip", "zoom-morph", "matrix-glitch", "whip-pan", "film-burn"];
                  const transitionIcons: Record<TransitionType, string> = {
                    "paper-rip": "📄",
                    "zoom-morph": "🔍",
                    "matrix-glitch": "⚡",
                    "whip-pan": "🌀",
                    "film-burn": "🔥",
                  };

                  return film.shots.map((shot, idx) => {
                    let startSec = shotStartTimes[idx] ?? 0;
                    let dur = shot.dur;

                    // Apply visual movement delta during move
                    if (movingClip && movingClip.shotIndex === idx) {
                      startSec = Math.max(0, movingClip.initialStartSec + movingClip.currentDeltaSec);
                    }

                    // Apply visual delta during trim
                    if (trimming && trimming.shotIndex === idx) {
                      if (trimming.edge === "right") {
                        dur = Math.max(0.5, shot.dur + trimming.currentDelta);
                      } else {
                        dur = Math.max(0.5, shot.dur - trimming.currentDelta);
                        startSec += trimming.currentDelta;
                      }
                    }

                    const isSelected = selectedShotIds.includes(shot.id);
                    const currentTrans = shot.transition || "paper-rip";

                    return (
                      <React.Fragment key={shot.id}>
                        {/* Transition Cut Badge */}
                        {idx > 0 && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextTransIdx = (transitionTypes.indexOf(currentTrans) + 1) % transitionTypes.length;
                              const nextTrans = transitionTypes[nextTransIdx];
                              const updatedShots = [...film.shots];
                              updatedShots[idx] = { ...shot, transition: nextTrans };
                              triggerUpdateWithUndo(
                                { ...film, shots: updatedShots },
                                `Set ${shot.id} transition to ${nextTrans}`
                              );
                            }}
                            className="absolute -top-1 z-30 -ml-2.5 w-5 h-5 rounded-full bg-[#18181B] border border-yellow-500/80 hover:scale-125 hover:border-yellow-300 flex items-center justify-center text-[10px] cursor-pointer shadow-lg transition-transform"
                            style={{ left: startSec * zoomLevel }}
                            title={`Transition: ${currentTrans} (Click to cycle)`}
                          >
                            <span>{transitionIcons[currentTrans]}</span>
                          </div>
                        )}

                        {/* Shot Clip Body (Draggable to Move) */}
                        <div
                          onMouseDown={(e) => {
                            if ((e.target as HTMLElement)?.dataset?.handle) return;
                            e.stopPropagation();
                            if (e.shiftKey) {
                              setSelectedShotIds((prev) =>
                                prev.includes(shot.id)
                                  ? prev.filter((id) => id !== shot.id)
                                  : [...prev, shot.id]
                              );
                            } else {
                              setSelectedShotIds([shot.id]);
                            }
                            setPlayheadSec(startSec);
                            if (onPreviewSeek) onPreviewSeek(Math.round(startSec * fps));

                            // Initiate drag-to-move
                            setMovingClip({
                              shotIndex: idx,
                              startX: e.clientX,
                              initialStartSec: startSec,
                              currentDeltaSec: 0,
                            });
                          }}
                          className={`absolute top-1.5 bottom-1.5 rounded-lg border flex flex-col justify-between p-1.5 cursor-grab active:cursor-grabbing transition-all shadow-md group select-none ${
                            isSelected
                              ? "ring-2 ring-yellow-400 z-10 brightness-110"
                              : "hover:border-white/60"
                          }`}
                          style={{
                            left: startSec * zoomLevel,
                            width: Math.max(20, dur * zoomLevel),
                            backgroundColor: clipColors[idx % clipColors.length] + "33",
                            borderColor: clipColors[idx % clipColors.length],
                          }}
                        >
                          {/* Left Trim Handle */}
                          <div
                            data-handle="left"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setTrimming({
                                shotIndex: idx,
                                edge: "left",
                                startX: e.clientX,
                                initialDur: shot.dur,
                                currentDelta: 0,
                              });
                            }}
                            className="absolute top-0 bottom-0 left-0 w-2.5 bg-white/20 hover:bg-yellow-400 cursor-col-resize rounded-l flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20"
                            title="Drag to trim start (Alt to bypass snap)"
                          >
                            <div className="w-[1px] h-3 bg-black/60" />
                          </div>

                          {/* Clip Header */}
                          <div className="flex items-center justify-between gap-1 overflow-hidden pointer-events-none">
                            <span className="font-bold text-[11px] truncate text-white">
                              {idx + 1}. {shot.id}
                            </span>
                            <span className="text-[9px] font-mono bg-black/60 px-1 py-0.5 rounded text-gray-300">
                              {dur.toFixed(2)}s
                            </span>
                          </div>

                          {/* Script Snippet */}
                          <div className="text-[9px] text-gray-400 truncate pointer-events-none">
                            {shot.scriptText || shot.visualDirection || shot.look}
                          </div>

                          {/* Right Trim Handle */}
                          <div
                            data-handle="right"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setTrimming({
                                shotIndex: idx,
                                edge: "right",
                                startX: e.clientX,
                                initialDur: shot.dur,
                                currentDelta: 0,
                              });
                            }}
                            className="absolute top-0 bottom-0 right-0 w-2.5 bg-white/20 hover:bg-yellow-400 cursor-col-resize rounded-r flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20"
                            title="Drag to trim duration (Alt to bypass snap)"
                          >
                            <div className="w-[1px] h-3 bg-black/60" />
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  });
                })()}
              </div>

              {/* TRACK 3: VISUAL METAPHOR & DEVICE OVERLAY (CLICK TO OVERRIDE) */}
              <div
                className="h-14 border-b border-[#27272A] relative flex items-center px-1"
                style={{ width: `${Math.max(totalDurationSec + 5, 60) * zoomLevel}px` }}
              >
                {film.shots.map((shot, idx) => {
                  const startSec = shotStartTimes[idx] ?? 0;
                  const dur = shot.dur;
                  const label = shot.metaphor || shot.blocks?.[0]?.c || "Typography";

                  return (
                    <div
                      key={shot.id}
                      onClick={() => {
                        const metaphors: Array<NonNullable<typeof shot.metaphor>> = [
                          "spider-web", "liquid-bucket", "balance-scale", "clock-gears", "rocket-launch", "glowing-cluster"
                        ];
                        const currentMetaphor = shot.metaphor || "balance-scale";
                        const nextIdx = (metaphors.indexOf(currentMetaphor) + 1) % metaphors.length;
                        const nextMetaphor = metaphors[nextIdx];
                        const updatedShots = [...film.shots];
                        updatedShots[idx] = {
                          ...shot,
                          metaphor: nextMetaphor,
                          blocks: [
                            {
                              c: "MetaphorViewer",
                              metaphorType: nextMetaphor,
                              content: {
                                kind: nextMetaphor,
                                leftLabel: "Baseline",
                                rightLabel: "Optimized",
                                state: "balanced",
                              } as any,
                            },
                          ],
                        };
                        triggerUpdateWithUndo(
                          { ...film, shots: updatedShots },
                          `Switch ${shot.id} metaphor to ${nextMetaphor}`
                        );
                      }}
                      className="absolute top-2 bottom-2 rounded bg-purple-950/50 border border-purple-500/50 hover:border-purple-400 px-2 flex items-center gap-1.5 text-[10px] text-purple-200 truncate cursor-pointer transition-all shadow"
                      style={{ left: startSec * zoomLevel, width: Math.max(20, dur * zoomLevel) }}
                      title={`Visual Device: ${label} (Click to cycle metaphor)`}
                    >
                      <span>📊</span>
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })}
              </div>

              {/* TRACK 4: REAL SUBTITLES (CLICK WORD TO SEEK) */}
              <div
                className="h-14 border-b border-[#27272A] relative flex items-center px-1 overflow-hidden"
                style={{ width: `${Math.max(totalDurationSec + 5, 60) * zoomLevel}px` }}
              >
                {captionWords.map((cw, wIdx) => {
                  const wordStartSec = cw.startFrame / fps;
                  const wordEndSec = cw.endFrame / fps;
                  const isCurrentWord = playheadSec >= wordStartSec && playheadSec < wordEndSec;

                  return (
                    <div
                      key={wIdx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlayheadSec(wordStartSec);
                        if (onPreviewSeek) onPreviewSeek(cw.startFrame);
                      }}
                      className={`absolute top-2.5 bottom-2.5 rounded px-1 flex items-center text-[9px] font-mono cursor-pointer transition-all border ${
                        isCurrentWord
                          ? "bg-emerald-500 text-black font-bold border-emerald-300 z-10"
                          : "bg-emerald-950/40 border-emerald-600/40 text-emerald-300 hover:border-emerald-400"
                      }`}
                      style={{
                        left: wordStartSec * zoomLevel,
                        width: Math.max(16, (wordEndSec - wordStartSec) * zoomLevel),
                      }}
                      title={`${cw.text} (${wordStartSec.toFixed(2)}s)`}
                    >
                      <span className="truncate">{cw.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* SCRIPT & SHOT BREAKDOWN */
        <div className="flex-1 p-4 overflow-y-auto bg-[#09090B] flex flex-col gap-3">
          <div className="bg-[#18181B] p-3 rounded-lg border border-[#27272A] flex items-center justify-between">
            <div>
              <h3 className="font-bold text-xs text-yellow-400">
                🎙️ Screenplay & Shot Breakdown
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Click any shot card or dialogue phrase to seek the timeline directly to that scene.
              </p>
            </div>
            <div className="text-xs text-gray-400 font-mono">
              Total Shots: {film.shots.length}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {film.shots.map((shot, idx) => {
              const startSec = shotStartTimes[idx] ?? 0;
              const isSelected = selectedShotIds.includes(shot.id);

              return (
                <div
                  key={shot.id}
                  onClick={() => {
                    setSelectedShotIds([shot.id]);
                    setPlayheadSec(startSec);
                    if (onPreviewSeek) onPreviewSeek(Math.round(startSec * fps));
                  }}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? "bg-[#1E1E24] border-yellow-400 ring-1 ring-yellow-400"
                      : "bg-[#141416] border-[#27272A] hover:border-gray-500"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                    <span className="text-blue-400">
                      Shot {idx + 1}: {shot.id}
                    </span>
                    <span className="font-mono text-gray-400">
                      {startSec.toFixed(2)}s - {(startSec + shot.dur).toFixed(2)}s ({shot.dur.toFixed(2)}s)
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-200 leading-relaxed font-sans">
                    {shot.scriptText || "(No narration text provided for this shot)"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
