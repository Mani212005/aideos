/**
 * File Description: Dedicated Clip Inspector & Numeric Precision Panel (Phase T-F).
 * Provides frame-accurate and sub-second numeric editing for clip position,
 * in/out points, duration, layer, transition, camera zoom, and visual properties.
 */

import React from "react";
import type { Film, Shot } from "../../../src/dl/schema";
import { getShotDuration } from "../../../backend/timeline/timeline";
import type { TransitionType } from "../transitions";

interface ClipInspectorProps {
  film: Film;
  selectedShotId: string | null;
  onUpdateShot: (shotIndex: number, updatedShot: Partial<Shot>, label: string) => void;
  onClose: () => void;
}

export const ClipInspector: React.FC<ClipInspectorProps> = ({
  film,
  selectedShotId,
  onUpdateShot,
  onClose,
}) => {
  if (!selectedShotId) return null;

  const shotIndex = film.shots.findIndex((s) => s.id === selectedShotId);
  if (shotIndex === -1) return null;

  const shot = film.shots[shotIndex];
  const fps = film.fps || 30;
  const dur = getShotDuration(shot);
  const pos = shot.position ?? shot.startSec ?? 0;
  const startIn = shot.start ?? shot.inSec ?? 0;
  const endOut = shot.end ?? (startIn + dur);

  const transitionTypes: TransitionType[] = [
    "paper-rip",
    "zoom-morph",
    "matrix-glitch",
    "whip-pan",
    "film-burn",
  ];

  return (
    <div className="w-80 bg-[#121214] border-l border-[#27272A] p-4 flex flex-col gap-4 overflow-y-auto text-xs select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#27272A]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-yellow-400">⚙️ CLIP INSPECTOR</span>
          <span className="text-[10px] font-mono bg-black/60 px-1.5 py-0.5 rounded text-gray-400">
            Shot {shotIndex + 1}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1 rounded"
          title="Close Inspector"
        >
          ✕
        </button>
      </div>

      {/* Clip Identity */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono text-gray-400 uppercase font-bold">Clip ID</label>
        <input
          type="text"
          value={shot.id}
          onChange={(e) => {
            const clean = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
            onUpdateShot(shotIndex, { id: clean }, `Rename shot to ${clean}`);
          }}
          className="bg-[#18181B] border border-[#333] rounded px-2 py-1 text-xs text-white font-mono focus:border-yellow-400 outline-none"
        />
      </div>

      {/* Numeric Timeline Timing (Position, In, Out, Duration) */}
      <div className="flex flex-col gap-2.5 bg-[#18181B] p-3 rounded-xl border border-[#27272A]">
        <span className="text-[10px] font-mono text-yellow-400 font-bold uppercase tracking-wider">
          ⏱️ Timeline Timing
        </span>

        {/* Position */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-gray-300">Position (Start)</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min="0"
              value={Number(pos.toFixed(2))}
              onChange={(e) => {
                const val = Math.max(0, parseFloat(e.target.value) || 0);
                onUpdateShot(shotIndex, { position: val, startSec: val }, `Set ${shot.id} position to ${val}s`);
              }}
              className="w-20 bg-black/60 border border-[#333] rounded px-1.5 py-1 text-right font-mono text-xs text-yellow-300"
            />
            <span className="text-[10px] text-gray-500 font-mono">s ({Math.round(pos * fps)}f)</span>
          </div>
        </div>

        {/* Duration */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-gray-300">Duration</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min="0.5"
              max="90"
              value={Number(dur.toFixed(2))}
              onChange={(e) => {
                const val = Math.max(0.5, Math.min(90, parseFloat(e.target.value) || 0.5));
                onUpdateShot(
                  shotIndex,
                  { dur: val, end: startIn + val },
                  `Set ${shot.id} duration to ${val}s`
                );
              }}
              className="w-20 bg-black/60 border border-[#333] rounded px-1.5 py-1 text-right font-mono text-xs text-yellow-300"
            />
            <span className="text-[10px] text-gray-500 font-mono">s ({Math.round(dur * fps)}f)</span>
          </div>
        </div>

        {/* Source In-Point */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-gray-300">Source In</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min="0"
              value={Number(startIn.toFixed(2))}
              onChange={(e) => {
                const val = Math.max(0, parseFloat(e.target.value) || 0);
                onUpdateShot(shotIndex, { start: val, inSec: val }, `Set ${shot.id} source in to ${val}s`);
              }}
              className="w-20 bg-black/60 border border-[#333] rounded px-1.5 py-1 text-right font-mono text-xs text-gray-200"
            />
            <span className="text-[10px] text-gray-500 font-mono">s</span>
          </div>
        </div>

        {/* Source Out-Point */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-gray-300">Source Out</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min="0.5"
              value={Number(endOut.toFixed(2))}
              onChange={(e) => {
                const val = Math.max(startIn + 0.5, parseFloat(e.target.value) || startIn + 0.5);
                onUpdateShot(
                  shotIndex,
                  { end: val, dur: val - startIn },
                  `Set ${shot.id} source out to ${val}s`
                );
              }}
              className="w-20 bg-black/60 border border-[#333] rounded px-1.5 py-1 text-right font-mono text-xs text-gray-200"
            />
            <span className="text-[10px] text-gray-500 font-mono">s</span>
          </div>
        </div>
      </div>

      {/* Transition & Camera Framing */}
      <div className="flex flex-col gap-2.5 bg-[#18181B] p-3 rounded-xl border border-[#27272A]">
        <span className="text-[10px] font-mono text-yellow-400 font-bold uppercase tracking-wider">
          🎬 Transition & Camera
        </span>

        {/* Transition Selector */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-gray-300">Transition</label>
          <select
            value={shot.transition || "paper-rip"}
            onChange={(e) => {
              const trans = e.target.value as TransitionType;
              onUpdateShot(shotIndex, { transition: trans }, `Set transition to ${trans}`);
            }}
            className="bg-black/60 border border-[#333] rounded px-2 py-1 text-xs text-white font-mono outline-none"
          >
            {transitionTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Camera Zoom */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-gray-300">Camera Zoom</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.05"
              value={shot.zoom ?? 1}
              onChange={(e) => {
                const z = parseFloat(e.target.value);
                onUpdateShot(shotIndex, { zoom: z }, `Set camera zoom to ${z}x`);
              }}
              className="w-20 accent-yellow-400 cursor-pointer"
            />
            <span className="text-[10px] font-mono text-gray-300 w-8 text-right">
              {(shot.zoom ?? 1).toFixed(2)}x
            </span>
          </div>
        </div>

        {/* Camera Drift Toggle */}
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-gray-300">Cinematic Drift</label>
          <input
            type="checkbox"
            checked={shot.drift ?? false}
            onChange={(e) => {
              onUpdateShot(shotIndex, { drift: e.target.checked }, `Toggle drift for ${shot.id}`);
            }}
            className="accent-yellow-400 cursor-pointer"
          />
        </div>
      </div>

      {/* Screenplay Narration & Speaker Speed */}
      <div className="flex flex-col gap-2.5 bg-[#18181B] p-3 rounded-xl border border-[#27272A]">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-mono text-yellow-400 font-bold uppercase tracking-wider">
            🎙️ Narration & Speaker Speed
          </label>
          <span className="text-[10px] font-mono bg-yellow-950/80 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/40 font-bold">
            {(shot.speed ?? 1.0).toFixed(2)}x
          </span>
        </div>

        {/* Speaker Speed Control Slider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] text-gray-300">
            <span>Playback Speed</span>
            <span className="font-mono text-yellow-300 font-bold">{(shot.speed ?? 1.0).toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            value={shot.speed ?? 1.0}
            onChange={(e) => {
              const spd = parseFloat(e.target.value) || 1.0;
              onUpdateShot(shotIndex, { speed: spd }, `Set speaker speed to ${spd}x`);
            }}
            className="w-full accent-yellow-400 cursor-pointer"
          />
          {/* Quick Speed Preset Buttons */}
          <div className="flex items-center justify-between gap-1 mt-0.5">
            {[0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onUpdateShot(shotIndex, { speed: preset }, `Set speaker speed to ${preset}x`)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  Math.abs((shot.speed ?? 1.0) - preset) < 0.01
                    ? "bg-yellow-400 text-black font-bold"
                    : "bg-[#27272A] text-gray-400 hover:text-white"
                }`}
              >
                {preset}x
              </button>
            ))}
          </div>
        </div>

        <textarea
          rows={3}
          value={shot.scriptText || ""}
          onChange={(e) => {
            onUpdateShot(shotIndex, { scriptText: e.target.value }, `Edit ${shot.id} script text`);
          }}
          placeholder="Spoken narration for this shot..."
          className="w-full bg-black/60 border border-[#333] rounded p-2 text-xs text-gray-200 outline-none resize-none focus:border-yellow-400 font-sans leading-relaxed mt-1"
        />
      </div>
    </div>
  );
};
