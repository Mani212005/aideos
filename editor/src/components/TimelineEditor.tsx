/**
 * File Description: Aideos Direct Manipulation Multi-Track Timeline & Trimmer.
 * Fully Implements the 5 Geometry Patterns across Video, Audio, Subtitles, and Visual Devices:
 * 1. Stored position, start, end, layer data model.
 * 2. Transaction-Grouped UpdateAction Engine (atomic multi-clip undo/redo).
 * 3. 12px Sticky Snapping with Self-Ignore.
 * 4. Explicit Drag State Machine for both Shots and Audio Clips.
 * 5. Pending Overrides 60 FPS live preview.
 * 6. Fully interactive Voiceover & Audio Clip splitting, trimming, and gap closing (Phase L-4).
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { Film, Shot, AudioClip } from "../../../src/dl/schema";
import {
  TimelineTransactionManager,
  computeShotStartTimes,
  getShotDuration,
  moveShot,
  moveMultipleShots,
  trimShotEdge,
  splitShotAtTime,
  deleteShot,
  type SnapTarget,
} from "../../../backend/timeline/timeline";
import {
  collectSnapTargets,
  calculateStickySnap,
} from "../../../backend/timeline/snap";
import {
  TimelineDragStateMachine,
  type DragContext,
} from "./timeline/state";
import { generateWordsFromFilm } from "../../../src/dl/captionsParser";
import { AssetBin, type MediaAsset } from "./AssetBin";

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
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([film.shots[0]?.id ?? ""]);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tracks" | "media" | "transcript">("tracks");

  // Pattern 4: State Machine Instance
  const stateMachine = useMemo(() => new TimelineDragStateMachine(), []);
  const [dragContext, setDragContext] = useState<DragContext>(stateMachine.getState());

  // Pattern 5: Pending Overrides for 60 FPS smooth dragging
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, { position?: number; dur?: number }>>({});

  // Active snap target & guide line
  const [activeSnapTarget, setActiveSnapTarget] = useState<SnapTarget | null>(null);

  // Pattern 2: Transaction Manager
  const txManagerRef = useRef<TimelineTransactionManager>(new TimelineTransactionManager(60));
  const [, setUndoTick] = useState(0);

  const triggerUpdateWithTx = useCallback(
    (newFilm: Film, actions: any[], label: string) => {
      txManagerRef.current.commit(film, newFilm, actions, label);
      setUndoTick((t) => t + 1);
      onUpdateFilm(newFilm);
    },
    [film, onUpdateFilm]
  );

  const handleUndo = useCallback(() => {
    const res = txManagerRef.current.undo(film);
    if (res) {
      setUndoTick((t) => t + 1);
      onUpdateFilm(res.film);
    }
  }, [film, onUpdateFilm]);

  const handleRedo = useCallback(() => {
    const res = txManagerRef.current.redo(film);
    if (res) {
      setUndoTick((t) => t + 1);
      onUpdateFilm(res.film);
    }
  }, [film, onUpdateFilm]);

  const timelineRef = useRef<HTMLDivElement>(null);
  const fps = film.fps || 30;

  // Listen to State Machine changes
  useEffect(() => {
    return stateMachine.subscribe((ctx) => {
      setDragContext(ctx);
    });
  }, [stateMachine]);

  // Sync playhead smoothly with Remotion player
  useEffect(() => {
    if (!isPlaying || dragContext.mode === "playhead-scrub" || !playerRef) return;
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
  }, [isPlaying, dragContext.mode, playerRef, fps]);

  const shotStartTimes = useMemo(() => {
    return computeShotStartTimes(film.shots);
  }, [film.shots]);

  const baseShotsDurSum = useMemo(() => {
    return film.shots.reduce((sum, s) => sum + getShotDuration(s), 0);
  }, [film.shots]);

  // Interactive Audio Clips List
  const audioClips: AudioClip[] = useMemo(() => {
    if (film.audioClips && film.audioClips.length > 0) {
      return film.audioClips;
    }
    const defaultDur = overrideTotalDurationSec && overrideTotalDurationSec > 0 ? overrideTotalDurationSec : baseShotsDurSum;
    return [
      {
        id: "clip-vo-main",
        src: film.voiceover?.src || "voiceover.wav",
        position: 0,
        start: 0,
        end: defaultDur,
        volume: film.voiceover?.volume ?? 1,
        channel: "voiceover",
      },
    ];
  }, [film.audioClips, film.voiceover, overrideTotalDurationSec, baseShotsDurSum]);

  const totalDurationSec = useMemo(() => {
    if (overrideTotalDurationSec && overrideTotalDurationSec > 0) {
      return overrideTotalDurationSec;
    }
    const maxShotEnd = film.shots.reduce((max, s, i) => {
      const start = s.position ?? s.startSec ?? shotStartTimes[i] ?? 0;
      return Math.max(max, start + getShotDuration(s));
    }, 0);
    const maxAudioEnd = audioClips.reduce((max, a) => {
      return Math.max(max, a.position + (a.end - a.start));
    }, 0);
    return Math.max(baseShotsDurSum, maxShotEnd, maxAudioEnd);
  }, [overrideTotalDurationSec, baseShotsDurSum, film.shots, shotStartTimes, audioClips]);

  // Voiceover drift calculation
  const totalAudioDuration = useMemo(() => {
    return audioClips.reduce((sum, a) => sum + (a.end - a.start), 0);
  }, [audioClips]);

  const driftSec = totalDurationSec - totalAudioDuration;
  const isSynchronized = Math.abs(driftSec) <= 0.05;

  const selectedAudioClip = selectedAudioId ? audioClips.find((a) => a.id === selectedAudioId) : null;
  const currentSpeed = selectedAudioClip?.speed ?? film.voiceover?.speed ?? 1.0;

  const handleUpdateAudioSpeed = (newSpeed: number) => {
    if (selectedAudioId) {
      const idx = audioClips.findIndex((a) => a.id === selectedAudioId);
      if (idx !== -1) {
        const updatedClips = [...audioClips];
        updatedClips[idx] = { ...updatedClips[idx], speed: newSpeed };
        triggerUpdateWithTx(
          { ...film, audioClips: updatedClips },
          [],
          `Set ${selectedAudioId} speed to ${newSpeed}x`
        );
      }
    } else {
      triggerUpdateWithTx(
        {
          ...film,
          voiceover: {
            src: film.voiceover?.src || "voiceover.wav",
            volume: film.voiceover?.volume ?? 1,
            speed: newSpeed,
          },
        },
        [],
        `Set master voiceover speed to ${newSpeed}x`
      );
    }
  };

  const handleRealignNarration = () => {
    const ratio = totalAudioDuration > 0 ? totalAudioDuration / totalDurationSec : 1;
    const realignedShots = film.shots.map((shot) => ({
      ...shot,
      position: undefined,
      startSec: undefined,
      dur: Number((getShotDuration(shot) * ratio).toFixed(3)),
    }));
    triggerUpdateWithTx(
      { ...film, shots: realignedShots },
      [],
      "Re-align timeline to voiceover"
    );
  };

  // Real Subtitle Caption Words
  const captionWords = useMemo(() => {
    return generateWordsFromFilm(film as unknown as Record<string, unknown>);
  }, [film]);

  // Candidate snap targets
  const snapTargets = useMemo(() => {
    const ignoreIds: string[] = [];
    if (dragContext.targetKind === "shot" && dragContext.shotIndex !== undefined && film.shots[dragContext.shotIndex]) {
      ignoreIds.push(film.shots[dragContext.shotIndex].id);
    }
    if (dragContext.targetKind === "audio" && dragContext.audioIndex !== undefined && audioClips[dragContext.audioIndex]) {
      ignoreIds.push(audioClips[dragContext.audioIndex].id);
    }
    return collectSnapTargets(film, playheadSec, totalDurationSec, ignoreIds);
  }, [film, audioClips, playheadSec, totalDurationSec, dragContext]);

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

  // Global mouse handlers driven by State Machine
  useEffect(() => {
    if (stateMachine.isIdle()) return;

    const handleMouseMove = (e: MouseEvent) => {
      stateMachine.updateDelta(e.clientX, zoomLevel);
      const ctx = stateMachine.getState();

      if (ctx.mode === "playhead-scrub") {
        seekFromClientX(e.clientX);
        return;
      }

      // Dragging a Shot clip
      if (ctx.mode === "drag-clip" && ctx.shotIndex !== undefined) {
        const shot = film.shots[ctx.shotIndex];
        let targetPos = (ctx.initialPositionSec ?? 0) + ctx.currentDeltaSec;

        if (!e.altKey) {
          const snapRes = calculateStickySnap(targetPos, snapTargets, zoomLevel, activeSnapTarget, 12);
          if (snapRes.hasSnapped) {
            targetPos = snapRes.snappedTimeSec;
            setActiveSnapTarget(snapRes.activeSnap);
          } else {
            setActiveSnapTarget(null);
          }
        }

        setPendingOverrides({
          [shot.id]: { position: Math.max(0, targetPos) },
        });
      }

      // Dragging an Audio clip
      if (ctx.mode === "drag-audio" && ctx.audioIndex !== undefined) {
        const aClip = audioClips[ctx.audioIndex];
        let targetPos = (ctx.initialPositionSec ?? 0) + ctx.currentDeltaSec;

        if (!e.altKey) {
          const snapRes = calculateStickySnap(targetPos, snapTargets, zoomLevel, activeSnapTarget, 12);
          if (snapRes.hasSnapped) {
            targetPos = snapRes.snappedTimeSec;
            setActiveSnapTarget(snapRes.activeSnap);
          } else {
            setActiveSnapTarget(null);
          }
        }

        setPendingOverrides({
          [aClip.id]: { position: Math.max(0, targetPos) },
        });
      }

      // Resizing a Shot clip
      if ((ctx.mode === "resize-left" || ctx.mode === "resize-right") && ctx.shotIndex !== undefined) {
        const shot = film.shots[ctx.shotIndex];
        const origStart = ctx.initialPositionSec ?? (shotStartTimes[ctx.shotIndex] ?? 0);
        const origDur = ctx.initialDur ?? getShotDuration(shot);

        let deltaSec = ctx.currentDeltaSec;
        if (!e.altKey) {
          const targetCut = ctx.mode === "resize-right" ? origStart + origDur + deltaSec : origStart + deltaSec;
          const snapRes = calculateStickySnap(targetCut, snapTargets, zoomLevel, activeSnapTarget, 12);
          if (snapRes.hasSnapped) {
            deltaSec = ctx.mode === "resize-right" ? snapRes.snappedTimeSec - (origStart + origDur) : snapRes.snappedTimeSec - origStart;
            setActiveSnapTarget(snapRes.activeSnap);
          } else {
            setActiveSnapTarget(null);
          }
        }

        if (ctx.mode === "resize-right") {
          setPendingOverrides({
            [shot.id]: { dur: Math.max(0.5, origDur + deltaSec) },
          });
        } else {
          setPendingOverrides({
            [shot.id]: {
              position: Math.max(0, origStart + deltaSec),
              dur: Math.max(0.5, origDur - deltaSec),
            },
          });
        }
      }

      // Resizing an Audio clip
      if ((ctx.mode === "resize-audio-left" || ctx.mode === "resize-audio-right") && ctx.audioIndex !== undefined) {
        const aClip = audioClips[ctx.audioIndex];
        const origPos = aClip.position;
        const origDur = aClip.end - aClip.start;
        let deltaSec = ctx.currentDeltaSec;

        if (ctx.mode === "resize-audio-right") {
          setPendingOverrides({
            [aClip.id]: { dur: Math.max(0.2, origDur + deltaSec) },
          });
        } else {
          setPendingOverrides({
            [aClip.id]: {
              position: Math.max(0, origPos + deltaSec),
              dur: Math.max(0.2, origDur - deltaSec),
            },
          });
        }
      }
    };

    const handleMouseUp = () => {
      const prevCtx = stateMachine.reset();
      setActiveSnapTarget(null);

      // Commit Shot Drag
      if (prevCtx.mode === "drag-clip" && prevCtx.shotIndex !== undefined) {
        const shot = film.shots[prevCtx.shotIndex];
        const override = pendingOverrides[shot.id];
        if (override?.position !== undefined) {
          try {
            if (prevCtx.selectedShotIds && prevCtx.selectedShotIds.length > 1 && prevCtx.selectedShotIds.includes(shot.id)) {
              const indices = prevCtx.selectedShotIds
                .map((id) => film.shots.findIndex((s) => s.id === id))
                .filter((idx) => idx !== -1);
              const delta = override.position - (prevCtx.initialPositionSec ?? 0);
              const { film: updatedFilm, actions } = moveMultipleShots(film, indices, delta);
              triggerUpdateWithTx(updatedFilm, actions, `Move ${indices.length} shots`);
            } else {
              const { film: updatedFilm, actions } = moveShot(film, prevCtx.shotIndex, override.position);
              triggerUpdateWithTx(updatedFilm, actions, `Move ${shot.id}`);
            }
          } catch (err) {
            console.warn("[Move rejected]", err);
          }
        }
      }

      // Commit Audio Drag
      if (prevCtx.mode === "drag-audio" && prevCtx.audioIndex !== undefined) {
        const aClip = audioClips[prevCtx.audioIndex];
        const override = pendingOverrides[aClip.id];
        if (override?.position !== undefined) {
          const updatedAudioClips = audioClips.map((ac, idx) => {
            if (idx === prevCtx.audioIndex) {
              return { ...ac, position: override.position! };
            }
            return ac;
          });
          triggerUpdateWithTx({ ...film, audioClips: updatedAudioClips }, [], `Move audio ${aClip.id}`);
        }
      }

      // Commit Shot Resize
      if ((prevCtx.mode === "resize-left" || prevCtx.mode === "resize-right") && prevCtx.shotIndex !== undefined) {
        const shot = film.shots[prevCtx.shotIndex];
        const override = pendingOverrides[shot.id];
        if (override) {
          const delta = prevCtx.mode === "resize-right"
            ? (override.dur ?? shot.dur) - (prevCtx.initialDur ?? shot.dur)
            : (override.position ?? 0) - (prevCtx.initialPositionSec ?? 0);
          try {
            const { film: updatedFilm, actions } = trimShotEdge(
              film,
              prevCtx.shotIndex,
              prevCtx.mode === "resize-right" ? "right" : "left",
              delta
            );
            triggerUpdateWithTx(updatedFilm, actions, `Trim ${shot.id}`);
          } catch (err) {
            console.warn("[Trim rejected]", err);
          }
        }
      }

      // Commit Audio Resize
      if ((prevCtx.mode === "resize-audio-left" || prevCtx.mode === "resize-audio-right") && prevCtx.audioIndex !== undefined) {
        const aClip = audioClips[prevCtx.audioIndex];
        const override = pendingOverrides[aClip.id];
        if (override) {
          const updatedAudioClips = audioClips.map((ac, idx) => {
            if (idx === prevCtx.audioIndex) {
              if (prevCtx.mode === "resize-audio-right") {
                const newDur = override.dur ?? (ac.end - ac.start);
                return { ...ac, end: ac.start + newDur };
              } else {
                const newPos = override.position ?? ac.position;
                const delta = newPos - ac.position;
                return { ...ac, position: newPos, start: ac.start + delta };
              }
            }
            return ac;
          });
          triggerUpdateWithTx({ ...film, audioClips: updatedAudioClips }, [], `Trim audio ${aClip.id}`);
        }
      }

      setPendingOverrides({});
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    stateMachine,
    zoomLevel,
    film,
    audioClips,
    snapTargets,
    activeSnapTarget,
    pendingOverrides,
    shotStartTimes,
    seekFromClientX,
    triggerUpdateWithTx,
  ]);

  // Audio Split & Delete Helpers
  const handleSplitAudio = useCallback(() => {
    if (!selectedAudioId) return;
    const aIdx = audioClips.findIndex((a) => a.id === selectedAudioId);
    if (aIdx === -1) return;

    const targetAudio = audioClips[aIdx];
    const dur = targetAudio.end - targetAudio.start;
    const endPos = targetAudio.position + dur;

    if (playheadSec <= targetAudio.position || playheadSec >= endPos) return;

    const splitOffset = playheadSec - targetAudio.position;
    const leftDur = Number(splitOffset.toFixed(3));

    const leftClip: AudioClip = {
      ...targetAudio,
      id: `${targetAudio.id}-part1`,
      position: targetAudio.position,
      start: targetAudio.start,
      end: targetAudio.start + leftDur,
    };

    const rightClip: AudioClip = {
      ...targetAudio,
      id: `${targetAudio.id}-part2`,
      position: playheadSec,
      start: targetAudio.start + leftDur,
      end: targetAudio.end,
    };

    const updatedAudioClips = [...audioClips];
    updatedAudioClips.splice(aIdx, 1, leftClip, rightClip);

    triggerUpdateWithTx(
      { ...film, audioClips: updatedAudioClips },
      [],
      `Split audio ${targetAudio.id}`
    );
  }, [selectedAudioId, audioClips, playheadSec, film, triggerUpdateWithTx]);

  const handleDeleteAudio = useCallback(() => {
    if (!selectedAudioId || audioClips.length <= 1) return;
    const updatedAudioClips = audioClips.filter((a) => a.id !== selectedAudioId);
    triggerUpdateWithTx(
      { ...film, audioClips: updatedAudioClips },
      [],
      `Delete audio ${selectedAudioId}`
    );
    setSelectedAudioId(null);
  }, [selectedAudioId, audioClips, film, triggerUpdateWithTx]);

  // Keyboard Shortcuts (Phase T-C)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Undo: Cmd+Z
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo: Cmd+Shift+Z
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

      // S: Split selected clip (Audio or Shot)
      if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (selectedAudioId) {
          handleSplitAudio();
        } else {
          try {
            const { film: splitFilm, actions } = splitShotAtTime(film, playheadSec);
            triggerUpdateWithTx(splitFilm, actions, `Split shot at ${playheadSec.toFixed(2)}s`);
          } catch (err) {
            console.warn("[Split Rejected]", err);
          }
        }
        return;
      }

      // Backspace / Delete: Delete selected clip (Audio or Shot)
      if (e.key === "Backspace" || e.key === "Delete") {
        if (selectedAudioId) {
          e.preventDefault();
          handleDeleteAudio();
          return;
        }

        const primarySelected = selectedShotIds[0];
        if (primarySelected && film.shots.length > 1) {
          const idx = film.shots.findIndex((s) => s.id === primarySelected);
          if (idx !== -1) {
            e.preventDefault();
            try {
              const { film: deletedFilm, actions } = deleteShot(film, idx);
              triggerUpdateWithTx(deletedFilm, actions, `Delete ${primarySelected}`);
              setSelectedShotIds([deletedFilm.shots[Math.max(0, idx - 1)]?.id ?? ""]);
            } catch (err) {
              console.warn("[Delete Rejected]", err);
            }
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    fps,
    playheadSec,
    selectedShotIds,
    selectedAudioId,
    film,
    onTogglePlay,
    handleUndo,
    handleRedo,
    handleSplitAudio,
    handleDeleteAudio,
    triggerUpdateWithTx,
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
      {/* TOP TOOLBAR: Sync Status, Undo/Redo & Precision Controls */}
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
              onClick={() => setActiveTab("media")}
              className={`text-[11px] px-2.5 py-1 rounded-md font-bold transition-colors ${
                activeTab === "media"
                  ? "bg-[#635BFF] text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              📁 Media Library
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

          {/* Play/Pause Button */}
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

          {/* Real-Time Narration Sync Status Badge */}
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
                : `Drifted by ${driftSec > 0 ? "+" : ""}${driftSec.toFixed(2)}s from voiceover. Click to Re-align.`
            }
          >
            <span>{isSynchronized ? "🟢 In Sync" : `⚠️ Drifted ${driftSec > 0 ? "+" : ""}${driftSec.toFixed(1)}s (⚡ Re-align)`}</span>
          </button>

          {/* Voiceover & Speaker Speed Control Bar */}
          <div className="flex items-center gap-1.5 bg-[#18181B] px-2 py-1 rounded border border-[#3F3F46] text-[10px] font-mono">
            <span className="text-yellow-400 font-bold">🎙️ Speed</span>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={currentSpeed}
              onChange={(e) => handleUpdateAudioSpeed(parseFloat(e.target.value) || 1.0)}
              className="w-14 accent-yellow-400 cursor-pointer"
              title={`Speech Speed: ${currentSpeed.toFixed(2)}x`}
            />
            <span className="text-yellow-300 font-bold w-9 text-right">{currentSpeed.toFixed(2)}x</span>
            <div className="flex items-center gap-0.5 ml-0.5">
              {[0.8, 1.0, 1.2, 1.5, 2.0].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleUpdateAudioSpeed(preset)}
                  className={`px-1 py-0.5 rounded text-[9px] transition-colors ${
                    Math.abs(currentSpeed - preset) < 0.01
                      ? "bg-yellow-400 text-black font-bold"
                      : "bg-[#27272A] text-gray-400 hover:text-white"
                  }`}
                >
                  {preset}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons: Undo / Redo / Split / Delete / Zoom */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUndo}
            disabled={!txManagerRef.current.canUndo()}
            className="p-1 px-2 rounded bg-[#27272A] hover:bg-[#3F3F46] disabled:opacity-30 text-xs text-gray-200 border border-[#3F3F46]"
            title="Undo (Cmd+Z)"
          >
            ↩️ Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={!txManagerRef.current.canRedo()}
            className="p-1 px-2 rounded bg-[#27272A] hover:bg-[#3F3F46] disabled:opacity-30 text-xs text-gray-200 border border-[#3F3F46]"
            title="Redo (Cmd+Shift+Z)"
          >
            ↪️ Redo
          </button>

          <div className="h-4 w-[1px] bg-[#3F3F46] mx-1" />

          {/* Split Button */}
          <button
            onClick={() => {
              if (selectedAudioId) {
                handleSplitAudio();
              } else {
                try {
                  const { film: splitFilm, actions } = splitShotAtTime(film, playheadSec);
                  triggerUpdateWithTx(splitFilm, actions, `Split shot at ${playheadSec.toFixed(2)}s`);
                } catch (err) {
                  console.warn("[Split Rejected]", err);
                }
              }
            }}
            className="text-[11px] px-2.5 py-1 rounded-md bg-[#27272A] hover:bg-[#3F3F46] text-white font-bold border border-[#3F3F46] flex items-center gap-1"
            title="Split selected shot or audio clip at playhead (S key)"
          >
            <span>✂️ Split</span>
          </button>

          {/* Delete Button */}
          <button
            onClick={() => {
              if (selectedAudioId) {
                handleDeleteAudio();
                return;
              }
              const primarySelected = selectedShotIds[0];
              if (primarySelected && film.shots.length > 1) {
                const idx = film.shots.findIndex((s) => s.id === primarySelected);
                if (idx !== -1) {
                  try {
                    const { film: deletedFilm, actions } = deleteShot(film, idx);
                    triggerUpdateWithTx(deletedFilm, actions, `Delete ${primarySelected}`);
                    setSelectedShotIds([deletedFilm.shots[Math.max(0, idx - 1)]?.id ?? ""]);
                  } catch (err) {
                    console.warn("[Delete Rejected]", err);
                  }
                }
              }
            }}
            disabled={(!selectedAudioId && selectedShotIds.length === 0) || (!selectedAudioId && film.shots.length <= 1)}
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
            {/* Left Track Headers */}
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
                      triggerUpdateWithTx(
                        {
                          ...film,
                          voiceover: {
                            src: film.voiceover?.src || "voiceover.wav",
                            volume: newVol,
                          },
                        },
                        [],
                        "Toggle voiceover mute"
                      );
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-black/70 hover:bg-black text-yellow-300 font-mono"
                  >
                    {(film.voiceover?.volume ?? 1) > 0 ? "🔊 On" : "🔇 Mute"}
                  </button>
                </div>
                <div className="text-[9px] text-gray-500 truncate">Trimmable audio</div>
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
                stateMachine.startPlayheadScrub(e.clientX);
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
              {activeSnapTarget !== null && (
                <div
                  className="absolute top-0 bottom-0 z-30 w-[1px] bg-cyan-400 shadow-[0_0_8px_cyan] pointer-events-none"
                  style={{ left: activeSnapTarget.timeSec * zoomLevel }}
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

              {/* TRACK 1: SPEECH & AUDIO TIMELINE (100% INTERACTIVELY TRIMMABLE) */}
              <div
                className="h-14 border-b border-[#27272A] relative flex items-center px-1"
                style={{ width: `${Math.max(totalDurationSec + 5, 60) * zoomLevel}px` }}
              >
                {audioClips.map((aClip, aIdx) => {
                  const override = pendingOverrides[aClip.id];
                  const aPos = override?.position !== undefined ? override.position : aClip.position;
                  const aDur = override?.dur !== undefined ? override.dur : aClip.end - aClip.start;
                  const isSelected = selectedAudioId === aClip.id;

                  return (
                    <div
                      key={aClip.id}
                      onMouseDown={(e) => {
                        if ((e.target as HTMLElement)?.dataset?.handle) return;
                        e.stopPropagation();
                        setSelectedAudioId(aClip.id);
                        setSelectedShotIds([]);
                        stateMachine.startDragAudio(aIdx, e.clientX, aPos);
                      }}
                      className={`absolute top-2 bottom-2 rounded px-2 flex items-center justify-between text-[10px] text-yellow-300 font-mono cursor-grab active:cursor-grabbing transition-all shadow-md group ${
                        isSelected
                          ? "bg-yellow-950/80 border-2 border-yellow-400 z-10 brightness-110"
                          : "bg-yellow-950/40 border border-yellow-500/50 hover:border-yellow-300"
                      }`}
                      style={{
                        left: aPos * zoomLevel,
                        width: Math.max(30, aDur * zoomLevel),
                      }}
                    >
                      {/* Left VO Trim Handle */}
                      <div
                        data-handle="vo-left"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          stateMachine.startResizeAudio(
                            aIdx,
                            "left",
                            e.clientX,
                            aClip.start,
                            aClip.end,
                            aDur,
                            aPos
                          );
                        }}
                        className="absolute top-0 bottom-0 left-0 w-2.5 bg-yellow-400/20 hover:bg-yellow-400 cursor-col-resize rounded-l opacity-0 group-hover:opacity-100 transition-opacity z-20"
                        title="Trim audio start"
                      >
                        <div className="w-[1px] h-3 bg-black/60" />
                      </div>

                      <div className="flex items-center gap-1 truncate pointer-events-none">
                        <span className="truncate">🗣️ {aClip.src}</span>
                        {(aClip.speed ?? 1.0) !== 1.0 && (
                          <span className="bg-yellow-400 text-black px-1 rounded text-[8px] font-bold shrink-0">
                            {(aClip.speed ?? 1.0).toFixed(2)}x
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] opacity-75 pointer-events-none font-mono shrink-0">{aDur.toFixed(2)}s</span>

                      {/* Right VO Trim Handle */}
                      <div
                        data-handle="vo-right"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          stateMachine.startResizeAudio(
                            aIdx,
                            "right",
                            e.clientX,
                            aClip.start,
                            aClip.end,
                            aDur,
                            aPos
                          );
                        }}
                        className="absolute top-0 bottom-0 right-0 w-2.5 bg-yellow-400/20 hover:bg-yellow-400 cursor-col-resize rounded-r opacity-0 group-hover:opacity-100 transition-opacity z-20"
                        title="Trim audio end"
                      >
                        <div className="w-[1px] h-3 bg-black/60" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* TRACK 2: VIDEO SHOTS (DIRECT MANIPULATION & PENDING PREVIEWS) */}
              <div
                className="h-20 border-b border-[#27272A] relative flex items-center"
                style={{ width: `${Math.max(totalDurationSec + 5, 60) * zoomLevel}px` }}
              >
                {(() => {
                  return film.shots.map((shot, idx) => {
                    const rawStart = shot.position ?? shot.startSec ?? shotStartTimes[idx] ?? 0;
                    const rawDur = getShotDuration(shot);

                    const override = pendingOverrides[shot.id];
                    const startSec = override?.position !== undefined ? override.position : rawStart;
                    const dur = override?.dur !== undefined ? override.dur : rawDur;

                    const isSelected = selectedShotIds.includes(shot.id);

                    return (
                      <React.Fragment key={shot.id}>
                        {/* Shot Clip Body */}
                        <div
                          onMouseDown={(e) => {
                            if ((e.target as HTMLElement)?.dataset?.handle) return;
                            e.stopPropagation();
                            setSelectedAudioId(null);
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

                            stateMachine.startDragClip(idx, e.clientX, startSec, selectedShotIds);
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
                              stateMachine.startResize(
                                idx,
                                "left",
                                e.clientX,
                                shot.start ?? 0,
                                shot.end ?? (shot.dur || 3),
                                rawDur,
                                startSec
                              );
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
                              stateMachine.startResize(
                                idx,
                                "right",
                                e.clientX,
                                shot.start ?? 0,
                                shot.end ?? (shot.dur || 3),
                                rawDur,
                                startSec
                              );
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

              {/* TRACK 3: VISUAL METAPHOR & DEVICE OVERLAY */}
              <div
                className="h-14 border-b border-[#27272A] relative flex items-center px-1"
                style={{ width: `${Math.max(totalDurationSec + 5, 60) * zoomLevel}px` }}
              >
                {film.shots.map((shot, idx) => {
                  const rawStart = shot.position ?? shot.startSec ?? shotStartTimes[idx] ?? 0;
                  const override = pendingOverrides[shot.id];
                  const startSec = override?.position !== undefined ? override.position : rawStart;
                  const dur = override?.dur !== undefined ? override.dur : getShotDuration(shot);
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
                        triggerUpdateWithTx(
                          { ...film, shots: updatedShots },
                          [],
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

              {/* TRACK 4: REAL SUBTITLES */}
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
      ) : activeTab === "media" ? (
        <AssetBin
          onInsertAssetAsShot={(asset: MediaAsset) => {
            const rawDur = asset.duration && asset.duration > 0 ? Number(asset.duration.toFixed(2)) : 5.0;
            const newShot: Shot = {
              id: `shot-${film.shots.length + 1}-${asset.filename.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`,
              stage: "frame",
              look: film.shots[film.shots.length - 1]?.look || "n1",
              move: "cut",
              drift: false,
              zoom: 1,
              position: totalDurationSec,
              startSec: totalDurationSec,
              start: 0,
              end: rawDur,
              dur: rawDur,
              blocks: [
                {
                  c: "TextReveal",
                  text: asset.filename,
                  size: "headline",
                },
              ],
            };
            const updatedFilm = { ...film, shots: [...film.shots, newShot] };
            triggerUpdateWithTx(updatedFilm, [], `Add asset ${asset.filename}`);
            setActiveTab("tracks");
          }}
        />
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
              const startSec = shot.position ?? shot.startSec ?? shotStartTimes[idx] ?? 0;
              const dur = getShotDuration(shot);
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
                      {startSec.toFixed(2)}s - {(startSec + dur).toFixed(2)}s ({dur.toFixed(2)}s)
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
