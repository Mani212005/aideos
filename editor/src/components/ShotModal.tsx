// File Description: Full-screen intuitive Scene & Character Inspector Modal covering 80% viewport.
// Translates complex animation keyframes into plain-English timeline moments (Start, Midpoint, End)
// with live gesture selection highlights and real-time SVG rig preview.

import React, { useState } from "react";
import type { Film, Shot, Block } from "../../../src/dl/schema";
import { POSE_PRESETS, getAllCharacterRigs } from "../../../src/dl/characters";
import { CharacterRigView } from "../../../src/dl/CharacterRig";

export interface ShotModalProps {
  isOpen: boolean;
  film: Film;
  shotIndex: number;
  onClose: () => void;
  onUpdateFilm: (updated: Film) => void;
  onSelectShotIndex?: (index: number) => void;
}

const RIG_ICONS: Record<string, string> = {
  astronaut: "👨‍🚀",
  developer: "🧑‍💻",
  robot: "🤖",
  scientist: "🔬",
  executive: "👔",
  "data-engineer": "🎧",
  educator: "📚",
  mascot: "💠",
};

const PRESET_GESTURES = [
  { id: "neutral", label: "Rest / Attentive", icon: "🧍", desc: "Natural relaxed posture" },
  { id: "present-right", label: "Point Right", icon: "👉", desc: "Points to charts & cards on the right" },
  { id: "present-left", label: "Point Left", icon: "👈", desc: "Points to headlines on the left" },
  { id: "think", label: "Thinking", icon: "🤔", desc: "Hand on chin / problem analysis" },
  { id: "shrug", label: "Shrug / Tradeoff", icon: "🤷", desc: "Explaining complexity & dilemmas" },
  { id: "wave", label: "Wave Greeting", icon: "👋", desc: "Friendly intro greeting" },
  { id: "crossed-arms", label: "Authoritative", icon: "💪", desc: "Confident architecture stance" },
  { id: "celebrate", label: "Celebrate", icon: "🙌", desc: "Both arms up / payoff milestone" },
];

export const ShotModal: React.FC<ShotModalProps> = ({
  isOpen,
  film,
  shotIndex,
  onClose,
  onUpdateFilm,
  onSelectShotIndex,
}) => {
  const [activeGestureIdx, setActiveGestureIdx] = useState(0);

  if (!isOpen || shotIndex < 0 || shotIndex >= film.shots.length) return null;

  const shot = film.shots[shotIndex];
  const allRigs = getAllCharacterRigs();

  // Find active character block if one exists
  const charBlock = shot.blocks.find((b) => b.c === "CharacterBeat") as any;
  const isCharacterMode = !!charBlock;
  const isBrollMode = !!shot.needsFootage;
  const activeMode = isCharacterMode ? "character" : isBrollMode ? "b-roll" : "standard";

  // Selected character ID & timeline gestures
  const activeCharId = charBlock?.characterId || "astronaut";
  const poses = charBlock?.poses || charBlock?.keyframes || [
    { t: 0, pose: "neutral", groups: { ...POSE_PRESETS.neutral.groups } },
    { t: 0.5, pose: "present-right", groups: { ...POSE_PRESETS["present-right"].groups } },
  ];

  // Determine active gesture ID for the current selected moment
  const currentMoment = poses[activeGestureIdx] || poses[0] || { t: 0, pose: "neutral" };
  const currentActiveGestureId = currentMoment.pose || (activeGestureIdx === 0 ? "neutral" : "present-right");

  // Helper to update current shot
  const updateCurrentShot = (partial: Partial<Shot>) => {
    const updatedShots = [...film.shots];
    updatedShots[shotIndex] = { ...shot, ...partial };
    onUpdateFilm({ ...film, shots: updatedShots });
  };

  // Helper to switch visual mode
  const setVisualMode = (mode: "standard" | "character" | "b-roll") => {
    if (mode === "character") {
      const filteredBlocks = shot.blocks.filter(
        (b) => b.c !== "CharacterBeat" && b.c !== "MetaphorViewer"
      );
      const newCharBlock: Block = {
        c: "CharacterBeat",
        characterId: "astronaut",
        stage: "frame",
        poses: [
          { t: 0, pose: "neutral", groups: { ...POSE_PRESETS.neutral.groups } },
          { t: 0.5, pose: "present-right", groups: { ...POSE_PRESETS["present-right"].groups } },
        ],
      } as any;

      updateCurrentShot({
        needsFootage: false,
        blocks: [newCharBlock, ...filteredBlocks],
      });
    } else if (mode === "b-roll") {
      const filteredBlocks = shot.blocks.filter((b) => b.c !== "CharacterBeat");
      updateCurrentShot({
        needsFootage: true,
        blocks: filteredBlocks,
      });
    } else {
      const filteredBlocks = shot.blocks.filter((b) => b.c !== "CharacterBeat");
      updateCurrentShot({
        needsFootage: false,
        blocks:
          filteredBlocks.length > 0
            ? filteredBlocks
            : [{ c: "Body", text: shot.scriptText || "Scene narrative content" }],
      });
    }
  };

  // Helper to apply a one-click gesture preset to the active timeline moment
  const applyGesturePreset = (presetId: string) => {
    const preset = POSE_PRESETS[presetId as keyof typeof POSE_PRESETS];
    if (!preset || !charBlock) return;

    const updatedPoses = [...poses];
    const momentToUpdate = updatedPoses[activeGestureIdx] || { t: 0, groups: {} };

    updatedPoses[activeGestureIdx] = {
      ...momentToUpdate,
      pose: presetId,
      groups: { ...preset.groups },
    };

    const updatedBlocks = shot.blocks.map((b) =>
      b.c === "CharacterBeat" ? { ...b, poses: updatedPoses } : b
    );

    updateCurrentShot({ blocks: updatedBlocks });
  };

  // Helper to change character rig (Astro Guide vs Tech Architect)
  const setCharacterRig = (rigId: string) => {
    if (!charBlock) return;
    const updatedBlocks = shot.blocks.map((b) =>
      b.c === "CharacterBeat" ? { ...b, characterId: rigId } : b
    );
    updateCurrentShot({ blocks: updatedBlocks });
  };

  // Helper to change stage layout (Full-Screen Hero vs Card Anchor)
  const setStageLayout = (stage: "frame" | "anchor") => {
    updateCurrentShot({ stage });
  };

  // Helper to add a new gesture shift moment
  const addGestureMoment = () => {
    const nextT = Number(((poses.length * 0.3) % 1).toFixed(2));
    const newMoment = {
      t: nextT,
      pose: "present-right",
      groups: { ...POSE_PRESETS["present-right"].groups },
    };
    const updatedPoses = [...poses, newMoment].sort((a: any, b: any) => a.t - b.t);
    const updatedBlocks = shot.blocks.map((b) =>
      b.c === "CharacterBeat" ? { ...b, poses: updatedPoses } : b
    );
    updateCurrentShot({ blocks: updatedBlocks });
    setActiveGestureIdx(updatedPoses.length - 1);
  };

  // Helper to remove a gesture moment
  const removeGestureMoment = (idx: number) => {
    if (poses.length <= 1) return;
    const updatedPoses = poses.filter((_: any, i: number) => i !== idx);
    const updatedBlocks = shot.blocks.map((b) =>
      b.c === "CharacterBeat" ? { ...b, poses: updatedPoses } : b
    );
    updateCurrentShot({ blocks: updatedBlocks });
    setActiveGestureIdx(Math.max(0, idx - 1));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6 animate-fade-in">
      {/* 80% VIEWPORT MAIN CONTAINER */}
      <div className="relative w-full max-w-6xl h-[88vh] bg-[#0E0E12] border border-[#272732] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#F5F5F5] font-sans">
        
        {/* TOP MODAL HEADER */}
        <div className="h-16 px-6 bg-[#14141A] border-b border-[#262632] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-[#635BFF]/20 text-[#635BFF] border border-[#635BFF]/40">
              Scene {shotIndex + 1} of {film.shots.length}
            </span>
            <h2 className="text-base font-bold text-white truncate max-w-md">
              {shot.id}
            </h2>
            <span className="text-xs font-mono text-gray-400 bg-black/40 px-2 py-0.5 rounded border border-white/5">
              ⏱️ {shot.dur} seconds
            </span>
          </div>

          {/* Quick Scene Navigation & Close */}
          <div className="flex items-center gap-3">
            {onSelectShotIndex && (
              <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10">
                <button
                  onClick={() => onSelectShotIndex(Math.max(0, shotIndex - 1))}
                  disabled={shotIndex === 0}
                  className="px-2.5 py-1 text-xs font-mono text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Previous
                </button>
                <span className="text-gray-600">|</span>
                <button
                  onClick={() => onSelectShotIndex(Math.min(film.shots.length - 1, shotIndex + 1))}
                  disabled={shotIndex === film.shots.length - 1}
                  className="px-2.5 py-1 text-xs font-mono text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white flex items-center justify-center text-lg transition-colors"
              title="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* MODAL BODY: 2-COLUMN SPACIOUS LAYOUT */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden min-h-0">
          
          {/* LEFT COLUMN: LIVE SCENE PREVIEW & SCRIPT (5 Columns) */}
          <div className="lg:col-span-5 bg-[#0A0A0E] border-r border-[#262632] p-6 flex flex-col gap-5 overflow-y-auto">
            
            {/* Live Character Visual Preview Box */}
            {isCharacterMode && (
              <div className="bg-[#121218] border border-[#272732] rounded-2xl p-4 flex flex-col items-center justify-center min-h-[190px] relative overflow-hidden shadow-inner">
                <div className="absolute top-2.5 left-3 text-[10px] font-mono text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Live Pose: {currentActiveGestureId}</span>
                </div>
                <div className="w-full h-36 flex items-center justify-center pt-3">
                  <CharacterRigView
                    characterId={activeCharId}
                    poses={poses}
                    durationInFrames={1}
                    start={0}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2">
                <span>🎙️</span> Voiceover Narration (Spoken Text)
              </label>
              <textarea
                value={shot.scriptText || ""}
                onChange={(e) => updateCurrentShot({ scriptText: e.target.value })}
                rows={3}
                placeholder="Type the exact narration spoken during this scene..."
                className="w-full bg-[#121218] border border-[#272732] focus:border-[#635BFF] rounded-xl p-3 text-xs text-gray-200 placeholder-gray-600 focus:outline-none transition-colors font-sans leading-relaxed"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                The AI voice synthesizer reads this sentence aloud to establish scene duration.
              </p>
            </div>

            {/* Scene Visual Idea / Direction Prompt */}
            <div>
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2">
                <span>💡</span> Visual Action & Direction Note
              </label>
              <input
                type="text"
                value={shot.visualDirection || ""}
                onChange={(e) => updateCurrentShot({ visualDirection: e.target.value })}
                placeholder="e.g. Astro character greets user, points to architecture node"
                className="w-full bg-[#121218] border border-[#272732] focus:border-[#635BFF] rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none transition-colors font-mono"
              />
            </div>

            {/* Scene Duration & Camera Move */}
            <div className="grid grid-cols-2 gap-3 bg-[#121218] p-3.5 rounded-xl border border-[#272732]">
              <div>
                <label className="text-[10px] font-mono uppercase text-gray-400 font-bold block mb-1">
                  Scene Duration
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={2}
                    max={30}
                    step={0.5}
                    value={shot.dur}
                    onChange={(e) => updateCurrentShot({ dur: parseFloat(e.target.value) || 5 })}
                    className="w-20 bg-black/60 border border-[#333] rounded px-2 py-1 text-xs font-mono text-white text-center"
                  />
                  <span className="text-xs text-gray-400 font-mono">seconds</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase text-gray-400 font-bold block mb-1">
                  Camera Move
                </label>
                <select
                  value={shot.move}
                  onChange={(e) => updateCurrentShot({ move: e.target.value as any })}
                  className="w-full bg-black/60 border border-[#333] rounded px-2 py-1 text-xs font-mono text-white"
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

          {/* RIGHT COLUMN: 3-WAY VISUAL MODE & INTUITIVE CONTROLS (7 Columns) */}
          <div className="lg:col-span-7 bg-[#101014] p-6 flex flex-col gap-6 overflow-y-auto">
            
            {/* 1. VISUAL MODE MACRO SELECTOR */}
            <div>
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2.5">
                <span>🎨</span> Step 1: Choose What Visuals Appear in This Scene
              </label>

              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setVisualMode("standard")}
                  className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between h-24 ${
                    activeMode === "standard"
                      ? "bg-[#1C1C24] border-white text-white shadow-lg ring-2 ring-white/10"
                      : "bg-[#141418] border-[#272732] text-gray-400 hover:border-gray-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📝</span>
                    <span className="text-xs font-bold">Standard Card</span>
                  </div>
                  <span className="text-[10px] text-gray-400 leading-tight">
                    Clean typography, metric counters, or device frames
                  </span>
                </button>

                <button
                  onClick={() => setVisualMode("character")}
                  className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between h-24 ${
                    activeMode === "character"
                      ? "bg-[#635BFF]/15 border-[#635BFF] text-white shadow-lg ring-2 ring-[#635BFF]/30"
                      : "bg-[#141418] border-[#272732] text-gray-400 hover:border-gray-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🎭</span>
                    <span className="text-xs font-bold text-[#635BFF]">SVG Character</span>
                  </div>
                  <span className="text-[10px] text-gray-400 leading-tight">
                    Animated human/space guide with one-click gestures
                  </span>
                </button>

                <button
                  onClick={() => setVisualMode("b-roll")}
                  className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between h-24 ${
                    activeMode === "b-roll"
                      ? "bg-amber-950/30 border-amber-500 text-white shadow-lg ring-2 ring-amber-500/30"
                      : "bg-[#141418] border-[#272732] text-gray-400 hover:border-gray-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🎬</span>
                    <span className="text-xs font-bold text-amber-400">GPU B-Roll</span>
                  </div>
                  <span className="text-[10px] text-gray-400 leading-tight">
                    Cinematic AI generated video footage overlay
                  </span>
                </button>
              </div>
            </div>

            {/* 2. MODE-SPECIFIC CONTROLS */}
            
            {/* --- SVG CHARACTER MODE --- */}
            {activeMode === "character" && (
              <div className="space-y-6 bg-[#14141A] p-5 rounded-2xl border border-[#272732]">
                
                {/* 2A. Character Picker */}
                <div>
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-300 block mb-2">
                    A. Select Animated Character (8 Diverse Models)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {allRigs.map((rig) => (
                      <button
                        key={rig.id}
                        onClick={() => setCharacterRig(rig.id)}
                        className={`p-2.5 rounded-xl border text-left flex flex-col justify-between h-20 transition-all ${
                          activeCharId === rig.id
                            ? "bg-[#635BFF]/20 border-[#635BFF] ring-2 ring-[#635BFF]/40 text-white shadow-md shadow-[#635BFF]/15"
                            : "bg-[#101014] border-[#272732] text-gray-400 hover:border-gray-500 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xl">{RIG_ICONS[rig.id] || "🧍"}</span>
                          {activeCharId === rig.id && (
                            <span className="text-[8px] font-mono text-[#635BFF] font-bold bg-[#635BFF]/20 px-1 py-0.5 rounded">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white truncate">{rig.name}</div>
                          <div className="text-[9px] text-gray-400 truncate">{rig.description || "Vector rig"}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2B. Timeline Moments (Human Friendly!) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-300">
                      B. Timeline Moments (Click a moment, then pick its gesture below)
                    </label>
                    <button
                      onClick={addGestureMoment}
                      className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-[#635BFF] hover:bg-[#5248E5] text-white font-bold transition-colors"
                    >
                      + Add Gesture Moment
                    </button>
                  </div>

                  {/* Horizontal Moment Track */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {poses.map((p: any, idx: number) => {
                      const isSelected = activeGestureIdx === idx;
                      const timeSec = (p.t * shot.dur).toFixed(1);
                      const timeLabel = p.t === 0 ? "Start (0.0s)" : p.t >= 0.9 ? "End" : `${timeSec}s`;
                      const gestureName = PRESET_GESTURES.find((g) => g.id === (p.pose || "neutral"))?.label || "Pose";
                      const gestureIcon = PRESET_GESTURES.find((g) => g.id === (p.pose || "neutral"))?.icon || "🧍";

                      return (
                        <button
                          key={idx}
                          onClick={() => setActiveGestureIdx(idx)}
                          className={`px-3.5 py-2.5 rounded-xl border text-xs font-mono flex items-center gap-2 shrink-0 transition-all ${
                            isSelected
                              ? "bg-[#635BFF] text-white font-bold border-white shadow-lg ring-2 ring-white/20 scale-105"
                              : "bg-[#101014] text-gray-300 border-[#333] hover:border-gray-500 hover:text-white"
                          }`}
                        >
                          <span>{gestureIcon} Moment {idx + 1} ({timeLabel}): <strong className="underline">{gestureName}</strong></span>
                          {poses.length > 1 && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                removeGestureMoment(idx);
                              }}
                              className="text-white/60 hover:text-red-400 font-bold ml-1 text-sm"
                              title="Delete this moment"
                            >
                              ×
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2C. 1-Click Gesture Presets (With Active Selection Highlight!) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-300">
                      C. Choose Gesture for Moment {activeGestureIdx + 1}
                    </label>
                    <span className="text-[10px] font-mono text-[#635BFF] bg-[#635BFF]/10 px-2 py-0.5 rounded border border-[#635BFF]/30">
                      Active: {PRESET_GESTURES.find((g) => g.id === currentActiveGestureId)?.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {PRESET_GESTURES.map((g) => {
                      const isGestureSelected = currentActiveGestureId === g.id;

                      return (
                        <button
                          key={g.id}
                          onClick={() => applyGesturePreset(g.id)}
                          className={`p-3 rounded-xl border text-left transition-all group flex flex-col justify-between h-24 ${
                            isGestureSelected
                              ? "bg-[#635BFF]/25 border-[#635BFF] ring-2 ring-[#635BFF]/40 text-white shadow-lg shadow-[#635BFF]/15 scale-[1.02]"
                              : "bg-[#101014] border-[#272732] hover:border-[#635BFF]/60 hover:bg-[#635BFF]/5 text-gray-300"
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-xl">{g.icon}</span>
                            {isGestureSelected ? (
                              <span className="text-[9px] font-mono font-bold bg-[#635BFF] text-white px-1.5 py-0.5 rounded">
                                ✓ ACTIVE
                              </span>
                            ) : (
                              <span className="text-[9px] font-mono text-gray-500 group-hover:text-[#635BFF]">
                                SELECT
                              </span>
                            )}
                          </div>
                          <div>
                            <div className={`text-xs font-bold ${isGestureSelected ? "text-white" : "text-gray-200 group-hover:text-white"}`}>
                              {g.label}
                            </div>
                            <div className="text-[9px] text-gray-400 truncate mt-0.5">
                              {g.desc}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2D. Stage Layout (Hero Full Frame vs Anchored Beside Text) */}
                <div>
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-300 block mb-2">
                    D. Character Framing on Screen
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setStageLayout("frame")}
                      className={`p-3.5 rounded-xl border text-left transition-all ${
                        shot.stage === "frame"
                          ? "bg-white/10 border-white text-white font-bold ring-2 ring-white/20"
                          : "bg-[#101014] border-[#272732] text-gray-400 hover:text-white"
                      }`}
                    >
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>🌟</span> Hero Full Screen
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1 leading-snug">
                        Character takes center stage scaled to 65% frame height
                      </div>
                    </button>

                    <button
                      onClick={() => setStageLayout("anchor")}
                      className={`p-3.5 rounded-xl border text-left transition-all ${
                        shot.stage === "anchor"
                          ? "bg-white/10 border-white text-white font-bold ring-2 ring-white/20"
                          : "bg-[#101014] border-[#272732] text-gray-400 hover:text-white"
                      }`}
                    >
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>🪟</span> Anchored Card
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1 leading-snug">
                        Character stands beside headline text in floating card panel
                      </div>
                    </button>
                  </div>
                </div>

              </div>
            )}

            {/* --- STANDARD CARD MODE --- */}
            {activeMode === "standard" && (
              <div className="space-y-4 bg-[#14141A] p-5 rounded-2xl border border-[#272732]">
                <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                  Standard Scene Blocks
                </h4>
                <p className="text-xs text-gray-400">
                  This scene displays clean kinetic text reveals and concept cards on the 2D spatial canvas.
                </p>

                <div className="space-y-2">
                  {shot.blocks.map((b, i) => (
                    <div key={i} className="p-3 bg-[#101014] rounded-xl border border-[#272732] flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-white font-mono">{b.c}</span>: <span className="text-gray-300">{(b as any).text || (b as any).label || "Standard Block"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* --- GPU B-ROLL MODE --- */}
            {activeMode === "b-roll" && (
              <div className="space-y-4 bg-[#14141A] p-5 rounded-2xl border border-[#272732]">
                <h4 className="text-xs font-bold text-amber-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <span>🎬</span> Cinematic AI Video Footage Scene
                </h4>
                <p className="text-xs text-gray-400 leading-relaxed">
                  This scene renders full-bleed AI video footage generated from Wan2.1 / Recraft V4 based on your visual direction prompt.
                </p>
                <div className="p-3 bg-amber-950/20 border border-amber-500/30 rounded-xl text-amber-200 text-xs font-mono">
                  ✓ B-Roll footage generation spec ready for this scene
                </div>
              </div>
            )}

          </div>

        </div>

        {/* MODAL FOOTER */}
        <div className="h-16 px-6 bg-[#14141A] border-t border-[#262632] flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg font-mono text-xs text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-[#10B981] hover:bg-[#059669] text-black font-bold text-xs flex items-center gap-2 shadow-lg transition-all active:scale-95"
          >
            <span>✓</span>
            <span>Apply to Scene & Save</span>
          </button>
        </div>

      </div>
    </div>
  );
};
