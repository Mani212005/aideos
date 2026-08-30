/**
 * File Description: Unified, intuitive Shot & Clip Inspector for Aideos Studio.
 * Replaces text-heavy stacked inspectors with a sleek, tabbed, visual control center
 * covering Visual Metaphors, SVG Character Rigs, Numeric Timing, Camera, and Screenplay Narration.
 */

import React, { useState } from "react";
import type { Film, Shot, Block } from "../../../src/dl/schema";
import { getShotDuration } from "../../../backend/timeline/timeline";
import { POSE_PRESETS, getAllCharacterRigs } from "../../../src/dl/characters";

interface ShotInspectorProps {
  film: Film;
  selectedShotId: string;
  onUpdateShot: (shotIndex: number, updatedShot: Partial<Shot>, label: string) => void;
  onDeleteShot?: (shotIndex: number) => void;
  onClose: () => void;
}

type InspectorTab = "visuals" | "timing" | "narration";

const METAPHOR_OPTIONS = [
  { id: "none", name: "Clean Scene", icon: "🚫", desc: "Pure character rig & typography" },
  { id: "glowing-cluster", name: "Latent Embeddings", icon: "🪐", desc: "Multi-dimensional latent space" },
  { id: "balance-scale", name: "Balance Scale", icon: "⚖️", desc: "Trade-off equilibrium" },
  { id: "clock-gears", name: "Latency Gears", icon: "⚙️", desc: "Pipeline throughput" },
  { id: "liquid-bucket", name: "Buffer Reservoir", icon: "🧪", desc: "Memory capacity" },
  { id: "typing-cursor-quote", name: "Terminal Code", icon: "💬", desc: "Code & command quotes" },
  { id: "rocket-launch", name: "Scale & Deploy", icon: "🚀", desc: "Scalability trajectory" },
];

const TRANSITIONS = [
  { id: "paper-rip", name: "Paper Rip" },
  { id: "zoom-morph", name: "Zoom Morph" },
  { id: "matrix-glitch", name: "Matrix Glitch" },
  { id: "whip-pan", name: "Whip Pan" },
  { id: "film-burn", name: "Film Burn" },
];

const MOTIONS = [
  { id: "cut", name: "Cut (Instant)", icon: "✂️" },
  { id: "pan", name: "Cinematic Pan", icon: "↔️" },
  { id: "zoom-in", name: "Zoom In", icon: "🔍" },
  { id: "zoom-out", name: "Zoom Out", icon: "🔎" },
];

export const ShotInspector: React.FC<ShotInspectorProps> = ({
  film,
  selectedShotId,
  onUpdateShot,
  onDeleteShot,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>("visuals");

  const shotIndex = film.shots.findIndex((s) => s.id === selectedShotId);
  if (shotIndex === -1) return null;

  const shot = film.shots[shotIndex];
  const fps = film.fps || 30;
  const dur = getShotDuration(shot);
  const pos = shot.position ?? shot.startSec ?? 0;
  const characterRigs = getAllCharacterRigs();

  // Character Beat block helper
  const charBlockIdx = shot.blocks.findIndex((b) => b.c === "CharacterBeat");
  const charBlock = charBlockIdx >= 0 ? (shot.blocks[charBlockIdx] as any) : null;

  // Active render mode derivation
  const hasCharacter = Boolean(charBlock);
  const hasBRoll = shot.blocks.some((b) => b.c === "AnalogyInset");
  const hasMetaphor = Boolean(shot.metaphor) || shot.blocks.some((b) => b.c === "MetaphorViewer");
  const renderMode = hasCharacter ? "character" : hasBRoll ? "b-roll" : hasMetaphor ? "metaphor" : "standard";

  // Switch render mode macro cleanly
  const setRenderMode = (mode: "standard" | "character" | "metaphor" | "b-roll") => {
    const cleanBlocks = shot.blocks.filter(
      (b) => b.c !== "CharacterBeat" && b.c !== "AnalogyInset" && b.c !== "MetaphorViewer"
    );

    if (mode === "character") {
      onUpdateShot(
        shotIndex,
        {
          metaphor: undefined,
          blocks: [
            ...cleanBlocks,
            {
              c: "CharacterBeat",
              characterId: "developer",
              poses: [{ t: 0, groups: { ...POSE_PRESETS.neutral.groups } }],
            } as Block,
          ],
        },
        `Set ${shot.id} to SVG Character Rig`
      );
    } else if (mode === "metaphor") {
      const textBlock = shot.blocks.find((b) => b.c === "TextReveal");
      onUpdateShot(
        shotIndex,
        {
          metaphor: "glowing-cluster",
          blocks: [
            ...cleanBlocks,
            {
              c: "MetaphorViewer",
              metaphorType: "glowing-cluster",
              content: {
                kind: "glowing-cluster",
                title: textBlock?.text || "Latent Architecture",
                subtitle: "Multi-Dimensional Space",
                caption: shot.scriptText || "System Architecture",
              },
            } as Block,
          ],
        },
        `Set ${shot.id} to Metaphor Device`
      );
    } else if (mode === "b-roll") {
      onUpdateShot(
        shotIndex,
        {
          metaphor: undefined,
          blocks: [
            ...cleanBlocks,
            {
              c: "AnalogyInset",
              caption: shot.scriptText?.slice(0, 40) || "Visual B-Roll",
            } as Block,
          ],
        },
        `Set ${shot.id} to B-Roll`
      );
    } else {
      onUpdateShot(
        shotIndex,
        { metaphor: undefined, blocks: cleanBlocks },
        `Set ${shot.id} to Standard Scene`
      );
    }
  };

  // 1-Click Pose Preset Application
  const applyPosePreset = (presetKey: string) => {
    if (charBlockIdx < 0 || !charBlock) return;
    const preset = POSE_PRESETS[presetKey];
    if (!preset) return;

    const poses = Array.isArray(charBlock.poses) && charBlock.poses.length > 0
      ? [...charBlock.poses]
      : [{ t: 0, groups: {} }];

    const targetIdx = poses.length - 1;
    poses[targetIdx] = {
      t: poses[targetIdx]?.t ?? 0,
      groups: { ...preset.groups },
    };

    const newBlocks = [...shot.blocks];
    newBlocks[charBlockIdx] = { ...charBlock, poses };
    onUpdateShot(shotIndex, { blocks: newBlocks }, `Apply pose ${preset.name}`);
  };

  return (
    <div className="flex flex-col gap-3 font-sans select-none text-xs text-[#E1E1E6]">
      {/* HEADER: Shot Identity, Number & Quick Actions */}
      <div className="flex items-center justify-between bg-[#141417] p-2.5 rounded-xl border border-[#27272A] shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] bg-[#635BFF] text-white px-2 py-0.5 rounded-md font-bold shrink-0">
            Shot {shotIndex + 1}
          </span>
          <span className="font-mono font-bold text-white text-xs truncate" title={shot.id}>
            {shot.id}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onDeleteShot && film.shots.length > 1 && (
            <button
              onClick={() => onDeleteShot(shotIndex)}
              className="p-1 px-1.5 rounded hover:bg-red-950/80 text-red-400 hover:text-red-300 text-xs transition-colors"
              title="Delete Shot"
            >
              🗑️
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 px-1.5 rounded hover:bg-[#27272A] text-gray-400 hover:text-white text-xs transition-colors"
            title="Close Inspector"
          >
            ✕
          </button>
        </div>
      </div>

      {/* SEGMENTED TAB SELECTOR (Visuals / Timing / Narration) */}
      <div className="grid grid-cols-3 bg-[#141417] p-1 rounded-xl border border-[#27272A]">
        <button
          onClick={() => setActiveTab("visuals")}
          className={`py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === "visuals"
              ? "bg-[#635BFF] text-white shadow"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <span>🎭</span>
          <span>Visuals</span>
        </button>

        <button
          onClick={() => setActiveTab("timing")}
          className={`py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === "timing"
              ? "bg-[#635BFF] text-white shadow"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <span>⏱️</span>
          <span>Timing</span>
        </button>

        <button
          onClick={() => setActiveTab("narration")}
          className={`py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === "narration"
              ? "bg-[#635BFF] text-white shadow"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <span>🎙️</span>
          <span>Script</span>
        </button>
      </div>

      {/* TAB 1: VISUALS */}
      {activeTab === "visuals" && (
        <div className="flex flex-col gap-3">
          {/* Render Mode Selector Cards */}
          <div className="flex flex-col gap-1.5 bg-[#141417] p-2.5 rounded-xl border border-[#27272A]">
            <label className="text-[10px] font-mono text-gray-400 font-bold uppercase tracking-wider">
              Render Mode
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setRenderMode("character")}
                className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                  renderMode === "character"
                    ? "bg-[#635BFF]/20 border-[#635BFF] text-white shadow"
                    : "bg-[#1C1C1F] border-[#27272A] text-gray-400 hover:border-gray-500 hover:text-gray-200"
                }`}
              >
                <span className="text-base">🧑‍🚀</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px]">Character Rig</span>
                  <span className="text-[9px] opacity-70 truncate">Animated Vector Actor</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRenderMode("metaphor")}
                className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                  renderMode === "metaphor"
                    ? "bg-[#635BFF]/20 border-[#635BFF] text-white shadow"
                    : "bg-[#1C1C1F] border-[#27272A] text-gray-400 hover:border-gray-500 hover:text-gray-200"
                }`}
              >
                <span className="text-base">🪐</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px]">Visual Device</span>
                  <span className="text-[9px] opacity-70 truncate">Latent Space / Graphs</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRenderMode("standard")}
                className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                  renderMode === "standard"
                    ? "bg-[#635BFF]/20 border-[#635BFF] text-white shadow"
                    : "bg-[#1C1C1F] border-[#27272A] text-gray-400 hover:border-gray-500 hover:text-gray-200"
                }`}
              >
                <span className="text-base">📝</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px]">Standard</span>
                  <span className="text-[9px] opacity-70 truncate">Pure Typography</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRenderMode("b-roll")}
                className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                  renderMode === "b-roll"
                    ? "bg-[#635BFF]/20 border-[#635BFF] text-white shadow"
                    : "bg-[#1C1C1F] border-[#27272A] text-gray-400 hover:border-gray-500 hover:text-gray-200"
                }`}
              >
                <span className="text-base">🎞️</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px]">GPU B-Roll</span>
                  <span className="text-[9px] opacity-70 truncate">Cinematic Footage</span>
                </div>
              </button>
            </div>
          </div>

          {/* SVG Character Rig Controls */}
          {renderMode === "character" && charBlock && (
            <div className="flex flex-col gap-2.5 bg-[#141417] p-2.5 rounded-xl border border-[#27272A]">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono text-yellow-400 font-bold uppercase tracking-wider">
                  Character Cast
                </label>
                <select
                  value={charBlock.characterId || "developer"}
                  onChange={(e) => {
                    const newBlocks = [...shot.blocks];
                    newBlocks[charBlockIdx] = { ...charBlock, characterId: e.target.value };
                    onUpdateShot(shotIndex, { blocks: newBlocks }, `Switch character to ${e.target.value}`);
                  }}
                  className="bg-black/60 border border-[#3F3F46] rounded-md px-2 py-1 text-xs text-white outline-none focus:border-yellow-400"
                >
                  {characterRigs.map((rig) => (
                    <option key={rig.id} value={rig.id}>
                      {rig.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 1-Click Pose Chips */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-gray-400">1-Click Poses</span>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { id: "neutral", label: "Rest 🧍" },
                    { id: "think", label: "Think 🤔" },
                    { id: "present-right", label: "Point 👉" },
                    { id: "present-left", label: "Point 👈" },
                    { id: "wave-left", label: "Wave 👋" },
                    { id: "celebrate", label: "Cheer 🎉" },
                    { id: "shrug", label: "Shrug 🤷" },
                    { id: "walk", label: "Walk 🚶" },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPosePreset(preset.id)}
                      className="bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 text-[10px] py-1.5 px-1 rounded-md border border-[#27272A] hover:border-yellow-400/80 transition-colors text-center truncate cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Visual Metaphor Device Picker */}
          {renderMode === "metaphor" && (
            <div className="flex flex-col gap-2 bg-[#141417] p-2.5 rounded-xl border border-[#27272A]">
              <label className="text-[10px] font-mono text-purple-400 font-bold uppercase tracking-wider">
                Topic Visual Metaphor
              </label>

              <select
                value={shot.metaphor || "glowing-cluster"}
                onChange={(e) => {
                  const val = e.target.value;
                  const cleanBlocks = shot.blocks.filter((b) => b.c !== "MetaphorViewer");
                  const textReveal = shot.blocks.find((b) => b.c === "TextReveal");
                  const newMetaphorBlock = {
                    c: "MetaphorViewer",
                    metaphorType: val,
                    content: {
                      kind: val,
                      title: textReveal?.text || "Latent Representation",
                      subtitle: "Multi-Dimensional Space",
                      caption: shot.scriptText || "System Architecture",
                    },
                  };
                  onUpdateShot(
                    shotIndex,
                    { metaphor: val as any, blocks: [...cleanBlocks, newMetaphorBlock as any] },
                    `Switch metaphor to ${val}`
                  );
                }}
                className="w-full bg-black/60 border border-[#3F3F46] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-purple-400"
              >
                {METAPHOR_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.icon} {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Camera Motion & Transition */}
          <div className="flex flex-col gap-2.5 bg-[#141417] p-2.5 rounded-xl border border-[#27272A]">
            <label className="text-[10px] font-mono text-blue-400 font-bold uppercase tracking-wider">
              Camera & Scene Dynamics
            </label>

            {/* Motion */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400">Motion</span>
                <select
                  value={shot.move || "cut"}
                  onChange={(e) => onUpdateShot(shotIndex, { move: e.target.value as any }, `Set camera motion to ${e.target.value}`)}
                  className="bg-black/60 border border-[#3F3F46] rounded-md px-2 py-1 text-xs text-white outline-none"
                >
                  {MOTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.icon} {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Transition */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400">Transition</span>
                <select
                  value={shot.transition || "paper-rip"}
                  onChange={(e) => onUpdateShot(shotIndex, { transition: e.target.value as any }, `Set transition to ${e.target.value}`)}
                  className="bg-black/60 border border-[#3F3F46] rounded-md px-2 py-1 text-xs text-white outline-none"
                >
                  {TRANSITIONS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Cinematic Drift Toggle */}
            <div className="flex items-center justify-between pt-1 border-t border-[#27272A]">
              <span className="text-[11px] text-gray-300">Cinematic Drift (100% → 104%)</span>
              <input
                type="checkbox"
                checked={shot.drift ?? true}
                onChange={(e) => onUpdateShot(shotIndex, { drift: e.target.checked }, `Toggle drift for ${shot.id}`)}
                className="accent-[#635BFF] cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TIMING */}
      {activeTab === "timing" && (
        <div className="flex flex-col gap-3">
          {/* Duration & Position Cards */}
          <div className="flex flex-col gap-2.5 bg-[#141417] p-2.5 rounded-xl border border-[#27272A]">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono text-yellow-400 font-bold uppercase tracking-wider">
                Shot Duration
              </label>
              <span className="font-mono text-yellow-300 font-bold text-xs bg-black/60 px-2 py-0.5 rounded">
                {dur.toFixed(2)}s ({Math.round(dur * fps)}f)
              </span>
            </div>

            <input
              type="range"
              min="0.5"
              max="30"
              step="0.1"
              value={dur}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 1.0;
                onUpdateShot(shotIndex, { dur: val, end: (shot.start ?? 0) + val }, `Set duration to ${val}s`);
              }}
              className="w-full accent-yellow-400 cursor-pointer"
            />

            {/* Timeline Start Position */}
            <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1 border-t border-[#27272A]">
              <span>Timeline Position (Start)</span>
              <span className="font-mono text-white font-bold">{pos.toFixed(2)}s</span>
            </div>
          </div>

          {/* Speaker Speed Control Bar */}
          <div className="flex flex-col gap-2 bg-[#141417] p-2.5 rounded-xl border border-[#27272A]">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono text-yellow-400 font-bold uppercase tracking-wider">
                🎙️ Speaker Playback Speed
              </label>
              <span className="font-mono text-yellow-300 font-bold text-xs bg-black/60 px-2 py-0.5 rounded">
                {(shot.speed ?? 1.0).toFixed(2)}x
              </span>
            </div>

            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={shot.speed ?? 1.0}
              onChange={(e) => {
                const spd = parseFloat(e.target.value) || 1.0;
                onUpdateShot(shotIndex, { speed: spd }, `Set speed to ${spd}x`);
              }}
              className="w-full accent-yellow-400 cursor-pointer"
            />

            {/* Preset Buttons */}
            <div className="flex items-center justify-between gap-1">
              {[0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onUpdateShot(shotIndex, { speed: preset }, `Set speed to ${preset}x`)}
                  className={`flex-1 py-1 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                    Math.abs((shot.speed ?? 1.0) - preset) < 0.01
                      ? "bg-yellow-400 text-black font-bold"
                      : "bg-[#1C1C1F] text-gray-400 hover:text-white"
                  }`}
                >
                  {preset}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: NARRATION */}
      {activeTab === "narration" && (
        <div className="flex flex-col gap-2.5 bg-[#141417] p-2.5 rounded-xl border border-[#27272A]">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-mono text-yellow-400 font-bold uppercase tracking-wider">
              Screenplay Narration
            </label>
            <span className="text-[10px] text-gray-400 font-mono">
              {(shot.scriptText || "").split(/\s+/).filter(Boolean).length} words
            </span>
          </div>

          <textarea
            rows={5}
            value={shot.scriptText || ""}
            onChange={(e) => onUpdateShot(shotIndex, { scriptText: e.target.value }, `Update narration script`)}
            placeholder="Enter spoken narration for this shot..."
            className="w-full bg-black/60 border border-[#3F3F46] rounded-lg p-2.5 text-xs text-white outline-none resize-none focus:border-yellow-400 leading-relaxed font-sans"
          />

          <p className="text-[10px] text-gray-400 leading-normal">
            💡 Words typed here automatically align to the audio track and generate phrase-locked karaoke subtitles.
          </p>
        </div>
      )}
    </div>
  );
};
