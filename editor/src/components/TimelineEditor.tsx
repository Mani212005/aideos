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
import type { Film, AudioClip, Shot } from "../../../src/dl/schema";
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
  type UpdateAction,
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

// Computes timeline duration of an audio clip accounting for playback speed.
function getAudioEffectiveDuration(ac: AudioClip): number {
  const speed = ac.speed ?? 1.0;
  return (ac.end - ac.start) / speed;
}

interface TimelineEditorProps {
  film: Film;
  onUpdateFilm: (updatedFilm: Film) => void;
  currentFrame?: number;
  onPreviewSeek?: (frame: number) => void;
  onSelectShot?: (shotId: string | null) => void;
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
  onSelectShot,
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
  const [activeTab, setActiveTab] = useState<"tracks" | "transcript">("tracks");
  const [isDragOverTimeline, setIsDragOverTimeline] = useState(false);

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
    (newFilm: Film, actions: UpdateAction[], label: string) => {
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
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const fps = film.fps || 30;

  // Listen to State Machine changes
  useEffect(() => {
    return stateMachine.subscribe((ctx) => {
      setDragContext(ctx);
    });
  }, [stateMachine]);

  // Sync playhead smoothly with Remotion player at 60fps with zero React component re-renders
  useEffect(() => {
    if (!isPlaying || dragContext.mode === "playhead-scrub" || !playerRef) return;
    let animId: number;

    const tick = () => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentFrame === "function") {
        const frame = p.getCurrentFrame();
        const sec = frame / fps;
        if (playheadRef.current) {
          playheadRef.current.style.left = `${sec * zoomLevel}px`;
        }
        if (timeDisplayRef.current) {
          const m = Math.floor(sec / 60);
          const s = String(Math.floor(sec % 60)).padStart(2, "0");
          const f = String(Math.round((sec % 1) * fps)).padStart(2, "0");
          timeDisplayRef.current.textContent = `${m}:${s}.${f}f`;
        }
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animId);
      const p = playerRef.current;
      if (p && typeof p.getCurrentFrame === "function") {
        setPlayheadSec(p.getCurrentFrame() / fps);
      }
    };
  }, [isPlaying, dragContext.mode, playerRef, fps, zoomLevel]);

  // Keep DOM refs in sync on state updates when paused or scrubbing
  useEffect(() => {
    if (isPlaying) return;
    if (playheadRef.current) {
      playheadRef.current.style.left = `${playheadSec * zoomLevel}px`;
    }
    if (timeDisplayRef.current) {
      const m = Math.floor(playheadSec / 60);
      const s = String(Math.floor(playheadSec % 60)).padStart(2, "0");
      const f = String(Math.round((playheadSec % 1) * fps)).padStart(2, "0");
      timeDisplayRef.current.textContent = `${m}:${s}.${f}f`;
    }
  }, [playheadSec, zoomLevel, fps, isPlaying]);

  useEffect(() => {
    if (!isPlaying && dragContext.mode === "idle") {
      setPlayheadSec(currentFrame / fps);
    }
  }, [currentFrame, fps, isPlaying, dragContext.mode]);

  // Derived Shot & Audio Geometries
  const shotStartTimes = useMemo(() => computeShotStartTimes(film.shots), [film.shots]);

  const baseShotsDurSum = useMemo(() => {
    return film.shots.reduce((acc, s) => acc + getShotDuration(s), 0);
  }, [film.shots]);

  const audioClips: AudioClip[] = useMemo(() => {
    if (film.audioClips && film.audioClips.length > 0) {
      return film.audioClips;
    }
    const totalVoDur = overrideTotalDurationSec && overrideTotalDurationSec > 0
      ? overrideTotalDurationSec
      : baseShotsDurSum;
    return [
      {
        id: "clip-voiceover-master",
        src: film.voiceover?.src || "voiceover.wav",
        position: 0,
        start: 0,
        end: totalVoDur,
        volume: film.voiceover?.volume ?? 1,
        speed: film.voiceover?.speed ?? 1.0,
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
      return Math.max(max, a.position + getAudioEffectiveDuration(a));
    }, 0);
    return Math.max(baseShotsDurSum, maxShotEnd, maxAudioEnd);
  }, [overrideTotalDurationSec, baseShotsDurSum, film.shots, shotStartTimes, audioClips]);

  // Voiceover drift calculation
  const totalAudioDuration = useMemo(() => {
    return audioClips.reduce((sum, a) => sum + getAudioEffectiveDuration(a), 0);
  }, [audioClips]);

  const driftSec = totalDurationSec - totalAudioDuration;
  const isSynchronized = Math.abs(driftSec) <= 0.05;

  const selectedAudioClip = selectedAudioId ? audioClips.find((a) => a.id === selectedAudioId) : null;
  const currentSpeed = selectedAudioClip?.speed ?? film.voiceover?.speed ?? 1.0;

  const handleUpdateAudioSpeed = (newSpeed: number) => {
    const txId = crypto.randomUUID();
    if (selectedAudioId) {
      const idx = audioClips.findIndex((a) => a.id === selectedAudioId);
      if (idx !== -1) {
        const oldSpeed = audioClips[idx].speed ?? 1.0;
        const updatedClips = [...audioClips];
        updatedClips[idx] = { ...updatedClips[idx], speed: newSpeed };
        const actions: UpdateAction[] = [
          {
            type: "update",
            path: ["audioClips", idx, "speed"],
            oldValue: oldSpeed,
            newValue: newSpeed,
            transactionId: txId,
            label: `Set ${selectedAudioId} speed to ${newSpeed}x`,
            timestamp: Date.now(),
          },
        ];
        triggerUpdateWithTx(
          { ...film, audioClips: updatedClips },
          actions,
          `Set ${selectedAudioId} speed to ${newSpeed}x`
        );
      }
    } else {
      const oldSpeed = film.voiceover?.speed ?? 1.0;
      const actions: UpdateAction[] = [
        {
          type: "update",
          path: ["voiceover", "speed"],
          oldValue: oldSpeed,
          newValue: newSpeed,
          transactionId: txId,
          label: `Set master voiceover speed to ${newSpeed}x`,
          timestamp: Date.now(),
        },
      ];
      triggerUpdateWithTx(
        {
          ...film,
          voiceover: {
            src: film.voiceover?.src || "voiceover.wav",
            volume: film.voiceover?.volume ?? 1,
            speed: newSpeed,
          },
        },
        actions,
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
        const speed = aClip.speed ?? 1.0;
        const origPos = aClip.position;
        const origDur = (aClip.end - aClip.start) / speed;
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
          const txId = crypto.randomUUID();
          const updatedAudioClips = audioClips.map((ac, idx) => {
            if (idx === prevCtx.audioIndex) {
              return { ...ac, position: override.position! };
            }
            return ac;
          });
          const actions: UpdateAction[] = [
            {
              type: "update",
              path: ["audioClips", prevCtx.audioIndex, "position"],
              oldValue: aClip.position,
              newValue: override.position!,
              transactionId: txId,
              label: `Move audio ${aClip.id} to ${override.position!.toFixed(2)}s`,
              timestamp: Date.now(),
            },
          ];
          triggerUpdateWithTx({ ...film, audioClips: updatedAudioClips }, actions, `Move audio ${aClip.id}`);
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
          const txId = crypto.randomUUID();
          const speed = aClip.speed ?? 1.0;
          const actions: UpdateAction[] = [];
          const updatedAudioClips = audioClips.map((ac, idx) => {
            if (idx === prevCtx.audioIndex) {
              if (prevCtx.mode === "resize-audio-right") {
                const newDur = override.dur ?? ((ac.end - ac.start) / speed);
                const newEnd = Number((ac.start + newDur * speed).toFixed(3));
                actions.push({
                  type: "update",
                  path: ["audioClips", prevCtx.audioIndex, "end"],
                  oldValue: ac.end,
                  newValue: newEnd,
                  transactionId: txId,
                  label: `Trim audio ${ac.id} end to ${newEnd.toFixed(2)}s`,
                  timestamp: Date.now(),
                });
                return { ...ac, end: newEnd };
              } else {
                const newPos = override.position ?? ac.position;
                const deltaTimeline = newPos - ac.position;
                const deltaSource = deltaTimeline * speed;
                const clampedDeltaSource = Math.max(-ac.start, deltaSource);
                const clampedDeltaTimeline = clampedDeltaSource / speed;
                const finalPos = Number((ac.position + clampedDeltaTimeline).toFixed(3));
                const finalStart = Number((ac.start + clampedDeltaSource).toFixed(3));

                actions.push(
                  {
                    type: "update",
                    path: ["audioClips", prevCtx.audioIndex, "position"],
                    oldValue: ac.position,
                    newValue: finalPos,
                    transactionId: txId,
                    label: `Trim audio ${ac.id} position to ${finalPos.toFixed(2)}s`,
                    timestamp: Date.now(),
                  },
                  {
                    type: "update",
                    path: ["audioClips", prevCtx.audioIndex, "start"],
                    oldValue: ac.start,
                    newValue: finalStart,
                    transactionId: txId,
                    label: `Trim audio ${ac.id} start to ${finalStart.toFixed(2)}s`,
                    timestamp: Date.now(),
                  }
                );
                return { ...ac, position: finalPos, start: finalStart };
              }
            }
            return ac;
          });
          triggerUpdateWithTx({ ...film, audioClips: updatedAudioClips }, actions, `Trim audio ${aClip.id}`);
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
    const speed = targetAudio.speed ?? 1.0;
    const dur = (targetAudio.end - targetAudio.start) / speed;
    const endPos = targetAudio.position + dur;

    if (playheadSec <= targetAudio.position || playheadSec >= endPos) return;

    const splitOffsetTimeline = playheadSec - targetAudio.position;
    const splitOffsetSource = splitOffsetTimeline * speed;

    const leftClip: AudioClip = {
      ...targetAudio,
      id: `${targetAudio.id}-part1`,
      position: targetAudio.position,
      start: targetAudio.start,
      end: Number((targetAudio.start + splitOffsetSource).toFixed(3)),
    };

    const rightClip: AudioClip = {
      ...targetAudio,
      id: `${targetAudio.id}-part2`,
      position: playheadSec,
      start: Number((targetAudio.start + splitOffsetSource).toFixed(3)),
      end: targetAudio.end,
    };

    const updatedAudioClips = [...audioClips];
    updatedAudioClips.splice(aIdx, 1, leftClip, rightClip);

    const txId = crypto.randomUUID();
    const actions: UpdateAction[] = [
      {
        type: "delete",
        path: ["audioClips", aIdx],
        oldValue: targetAudio,
        newValue: null,
        transactionId: txId,
        label: `Split audio ${targetAudio.id}`,
        timestamp: Date.now(),
      },
      {
        type: "insert",
        path: ["audioClips", aIdx],
        oldValue: null,
        newValue: leftClip,
        transactionId: txId,
        label: `Insert ${leftClip.id}`,
        timestamp: Date.now(),
      },
      {
        type: "insert",
        path: ["audioClips", aIdx + 1],
        oldValue: null,
        newValue: rightClip,
        transactionId: txId,
        label: `Insert ${rightClip.id}`,
        timestamp: Date.now(),
      },
    ];

    triggerUpdateWithTx(
      { ...film, audioClips: updatedAudioClips },
      actions,
      `Split audio ${targetAudio.id}`
    );
  }, [selectedAudioId, audioClips, playheadSec, film, triggerUpdateWithTx]);

  const handleDeleteAudio = useCallback(() => {
    if (!selectedAudioId || audioClips.length <= 1) return;
    const delIdx = audioClips.findIndex((a) => a.id === selectedAudioId);
    if (delIdx === -1) return;
    const deletedClip = audioClips[delIdx];
    const updatedAudioClips = audioClips.filter((a) => a.id !== selectedAudioId);
    const txId = crypto.randomUUID();
    const actions: UpdateAction[] = [
      {
        type: "delete",
        path: ["audioClips", delIdx],
        oldValue: deletedClip,
        newValue: null,
        transactionId: txId,
        label: `Delete audio ${selectedAudioId}`,
        timestamp: Date.now(),
      },
    ];
    triggerUpdateWithTx(
      { ...film, audioClips: updatedAudioClips },
      actions,
      `Delete audio ${selectedAudioId}`
    );
    setSelectedAudioId(null);
  }, [selectedAudioId, audioClips, film, triggerUpdateWithTx]);

  const handleTimelineDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverTimeline(false);

    try {
      const data = e.dataTransfer.getData("application/json");
      if (!data) return;
      const asset = JSON.parse(data);

      const rect = timelineRef.current?.getBoundingClientRect();
      const scrollLeft = timelineRef.current?.scrollLeft || 0;
      const x = e.clientX - (rect?.left || 0) + scrollLeft;
      const dropTimeSec = Math.max(0, parseFloat((x / zoomLevel).toFixed(2)));

      if (asset.type === "audio") {
        const dur = asset.duration || 5.0;
        const newClip: AudioClip = {
          id: `clip-audio-${Date.now()}`,
          src: asset.src,
          position: dropTimeSec,
          start: 0,
          end: dur,
          volume: 1,
          channel: "voiceover",
        };
        const updatedClips = [...audioClips, newClip];
        triggerUpdateWithTx({ ...film, audioClips: updatedClips }, [], `Add audio ${asset.filename}`);
      } else if (asset.type === "video") {
        const dur = asset.duration || 5.0;
        const newShotId = `shot-${asset.id.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 16)}-${Date.now().toString().slice(-4)}`;
        const newShot: Shot = {
          id: newShotId,
          dur,
          stage: "frame",
          look: film.shots[0]?.look || "intro",
          move: "cut",
          drift: true,
          zoom: 1,
          visualDirection: `B-roll video: ${asset.filename}`,
          blocks: [
            { c: "TextReveal", text: asset.filename.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "), size: "headline" },
            { c: "Body", text: `Imported video clip (${dur.toFixed(1)}s)` },
          ],
        };
        const updatedShots = [...film.shots, newShot];
        triggerUpdateWithTx({ ...film, shots: updatedShots }, [], `Insert video clip ${asset.filename}`);
      } else if (asset.type === "image") {
        let targetIdx = film.shots.length - 1;
        let cumulative = 0;
        for (let i = 0; i < film.shots.length; i++) {
          const sDur = getShotDuration(film.shots[i]);
          if (dropTimeSec >= cumulative && dropTimeSec < cumulative + sDur) {
            targetIdx = i;
            break;
          }
          cumulative += sDur;
        }
        const targetShot = film.shots[targetIdx];
        if (targetShot) {
          const updatedBlocks = [
            ...targetShot.blocks,
            { c: "Card", text: `Image: ${asset.filename}` } as any,
          ];
          const updatedShots = film.shots.map((s, idx) => idx === targetIdx ? { ...s, blocks: updatedBlocks } : s);
          triggerUpdateWithTx({ ...film, shots: updatedShots }, [], `Attach image ${asset.filename} to ${targetShot.id}`);
        }
      }
    } catch (err) {
      console.warn("Drop handling failed:", err);
    }
  };

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
            <span ref={timeDisplayRef}>
              {Math.floor(playheadSec / 60)}:
              {String(Math.floor(playheadSec % 60)).padStart(2, "0")}.
              {String(Math.round((playheadSec % 1) * fps)).padStart(2, "0")}f
            </span>{" "}
            /{" "}
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
                      const txId = crypto.randomUUID();
                      const actions: UpdateAction[] = [
                        {
                          type: "update",
                          path: ["voiceover", "volume"],
                          oldValue: currentVol,
                          newValue: newVol,
                          transactionId: txId,
                          label: newVol === 0 ? "Mute voiceover" : "Unmute voiceover",
                          timestamp: Date.now(),
                        },
                      ];
                      triggerUpdateWithTx(
                        {
                          ...film,
                          voiceover: {
                            src: film.voiceover?.src || "voiceover.wav",
                            volume: newVol,
                          },
                        },
                        actions,
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
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (!isDragOverTimeline) setIsDragOverTimeline(true);
              }}
              onDragLeave={() => setIsDragOverTimeline(false)}
              onDrop={handleTimelineDrop}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement)?.dataset?.handle) return;
                stateMachine.startPlayheadScrub(e.clientX);
                seekFromClientX(e.clientX);
              }}
              className={`flex-1 overflow-x-auto overflow-y-auto relative bg-[#09090B] cursor-crosshair select-none transition-colors ${
                isDragOverTimeline ? "ring-2 ring-yellow-400 bg-yellow-950/20" : ""
              }`}
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
                ref={playheadRef}
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
                  const aDur = override?.dur !== undefined ? override.dur : getAudioEffectiveDuration(aClip);
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
                            onSelectShot?.(shot.id);
                            setPlayheadSec(startSec);
                            if (onPreviewSeek) onPreviewSeek(Math.round(startSec * fps));
                            if (playerRef?.current) playerRef.current.seekTo(Math.round(startSec * fps));

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
                  const label = shot.metaphor || shot.blocks?.find((b) => b.c === "MetaphorViewer")?.metaphorType || "Clean Scene";

                  return (
                    <div
                      key={shot.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAudioId(null);
                        setSelectedShotIds([shot.id]);
                        onSelectShot?.(shot.id);
                        setPlayheadSec(startSec);
                        if (onPreviewSeek) onPreviewSeek(Math.round(startSec * fps));
                        if (playerRef?.current) playerRef.current.seekTo(Math.round(startSec * fps));

                        // Cycle through meaningful metaphors non-destructively
                        const metaphorOptions: Array<NonNullable<typeof shot.metaphor> | "none"> = [
                          "none",
                          "glowing-cluster",
                          "balance-scale",
                          "clock-gears",
                          "liquid-bucket",
                          "typing-cursor-quote",
                          "rocket-launch",
                        ];
                        const currentVal = shot.metaphor || "none";
                        const nextIdx = (metaphorOptions.indexOf(currentVal) + 1) % metaphorOptions.length;
                        const nextVal = metaphorOptions[nextIdx];

                        const cleanBlocks = shot.blocks.filter((b) => b.c !== "MetaphorViewer");
                        const updatedShots = [...film.shots];

                        if (nextVal === "none") {
                          updatedShots[idx] = {
                            ...shot,
                            metaphor: undefined,
                            blocks: cleanBlocks,
                          };
                        } else {
                          const textReveal = shot.blocks.find((b) => b.c === "TextReveal");
                          const newMetaphorBlock = {
                            c: "MetaphorViewer",
                            metaphorType: nextVal,
                            content: {
                              kind: nextVal,
                              title: textReveal?.text || "Latent Architecture",
                              subtitle: "Multi-Dimensional Space",
                              caption: shot.scriptText || "System Architecture",
                            },
                          };
                          updatedShots[idx] = {
                            ...shot,
                            metaphor: nextVal as any,
                            blocks: [...cleanBlocks, newMetaphorBlock as any],
                          };
                        }

                        const txId = crypto.randomUUID();
                        const actions: UpdateAction[] = [
                          {
                            type: "update",
                            path: ["shots", idx, "metaphor"],
                            oldValue: shot.metaphor,
                            newValue: nextVal,
                            transactionId: txId,
                            label: `Switch ${shot.id} visual device to ${nextVal}`,
                            timestamp: Date.now(),
                          },
                        ];

                        triggerUpdateWithTx(
                          { ...film, shots: updatedShots },
                          actions,
                          `Switch ${shot.id} visual device to ${nextVal}`
                        );
                      }}
                      className="absolute top-2 bottom-2 rounded bg-purple-950/50 border border-purple-500/50 hover:border-purple-400 px-2 flex items-center gap-1.5 text-[10px] text-purple-200 truncate cursor-pointer transition-all shadow hover:scale-[1.01]"
                      style={{ left: startSec * zoomLevel, width: Math.max(20, dur * zoomLevel) }}
                      title={`Visual Device: ${label} (Click to cycle / inspect)`}
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
