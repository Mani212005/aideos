/**
 * File Description: Unified, intuitive Shot & Clip Inspector for Aideos Studio.
 * Replaces text-heavy stacked inspectors with a sleek, tabbed, visual control center
 * covering Visual Metaphors, SVG Character Rigs, Numeric Timing, Camera, and Screenplay Narration.
 */

import React, { useState } from "react";
import {
  Trash2,
  X,
  Layers,
  Clock,
  FileText,
  User,
  Type,
  Film as FilmIcon,
  Mic,
  Sparkles,
} from "lucide-react";
import type { Film, Shot, Block } from "../../../src/dl/schema";
import { getShotDuration } from "../../../backend/timeline/timeline";
import { POSE_PRESETS, getAllCharacterRigs } from "../../../src/dl/characters";
import { TransitionEditor } from "./TransitionEditor";
import { ShotDesignPanel } from "./ShotDesignPanel";
import { TRANSITION_PRESETS, type TransitionType } from "../transitions";

interface ShotInspectorProps {
  film: Film;
  selectedShotId: string;
  onUpdateShot: (
    shotIndex: number,
    updatedShot: Partial<Shot>,
    label: string,
  ) => void;
  onDeleteShot?: (shotIndex: number) => void;
  onClose: () => void;
}

type InspectorTab = "visuals" | "timing" | "narration";

const METAPHOR_OPTIONS = [
  { id: "none", name: "Clean Scene", desc: "Pure character rig & typography" },
  {
    id: "glowing-cluster",
    name: "Latent Embeddings",
    desc: "Multi-dimensional latent space",
  },
  { id: "balance-scale", name: "Balance Scale", desc: "Trade-off equilibrium" },
  { id: "clock-gears", name: "Latency Gears", desc: "Pipeline throughput" },
  { id: "liquid-bucket", name: "Buffer Reservoir", desc: "Memory capacity" },
  {
    id: "typing-cursor-quote",
    name: "Terminal Code",
    desc: "Code & command quotes",
  },
  {
    id: "rocket-launch",
    name: "Scale & Deploy",
    desc: "Scalability trajectory",
  },
];

const MOTIONS = [
  { id: "cut", name: "Cut (Instant)" },
  { id: "pan", name: "Pan" },
  { id: "zoom-in", name: "Zoom In" },
  { id: "zoom-out", name: "Zoom Out" },
];

export const ShotInspector: React.FC<ShotInspectorProps> = ({
  film,
  selectedShotId,
  onUpdateShot,
  onDeleteShot,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>("visuals");
  // The transition length is an editing control rather than stored film data, so it lives here and
  // starts at the chosen preset's default.
  const [transitionDurationSec, setTransitionDurationSec] = useState<number>(
    TRANSITION_PRESETS[
      (film.shots.find((sh) => sh.id === selectedShotId)?.transition as TransitionType) || "paper-rip"
    ]?.defaultDurationSec ?? 0.6,
  );

  const shotIndex = film.shots.findIndex((s) => s.id === selectedShotId);
  if (shotIndex === -1) return null;

  const shot = film.shots[shotIndex];
  const fps = film.fps || 30;
  const dur = getShotDuration(shot);
  const pos = shot.position ?? shot.startSec ?? 0;
  const characterRigs = getAllCharacterRigs();

  // Character Beat block helper
  const charBlockIdx = shot.blocks.findIndex((b) => b.c === "CharacterBeat");
  const charBlock =
    charBlockIdx >= 0 ? (shot.blocks[charBlockIdx] as any) : null;

  // Active render mode derivation
  const hasCharacter = Boolean(charBlock);
  const hasBRoll = shot.blocks.some((b) => b.c === "AnalogyInset");
  const hasMetaphor =
    Boolean(shot.metaphor) || shot.blocks.some((b) => b.c === "MetaphorViewer");
  const renderMode = hasCharacter
    ? "character"
    : hasBRoll
      ? "b-roll"
      : hasMetaphor
        ? "metaphor"
        : "standard";

  // Switch render mode macro cleanly
  const setRenderMode = (
    mode: "standard" | "character" | "metaphor" | "b-roll",
  ) => {
    const cleanBlocks = shot.blocks.filter(
      (b) =>
        b.c !== "CharacterBeat" &&
        b.c !== "AnalogyInset" &&
        b.c !== "MetaphorViewer",
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
        `Set ${shot.id} to SVG Character Rig`,
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
        `Set ${shot.id} to Metaphor Device`,
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
        `Set ${shot.id} to B-Roll`,
      );
    } else {
      onUpdateShot(
        shotIndex,
        { metaphor: undefined, blocks: cleanBlocks },
        `Set ${shot.id} to Standard Scene`,
      );
    }
  };

  // 1-Click Pose Preset Application
  const applyPosePreset = (presetKey: string) => {
    if (charBlockIdx < 0 || !charBlock) return;
    const preset = POSE_PRESETS[presetKey];
    if (!preset) return;

    const poses =
      Array.isArray(charBlock.poses) && charBlock.poses.length > 0
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
    <div className="flex flex-col gap-3 font-sans select-none text-xs text-ink">
      {/* HEADER: Shot Identity, Number & Quick Actions */}
      <div className="flex items-center justify-between bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] bg-select text-select-ink px-2 py-0.5 font-bold shrink-0">
            Shot {shotIndex + 1}
          </span>
          <span
            className="font-mono font-bold text-ink text-xs truncate"
            title={shot.id}
          >
            {shot.id}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onDeleteShot && film.shots.length > 1 && (
            <button
              onClick={() => onDeleteShot(shotIndex)}
              className="p-1 px-1.5 hover:bg-danger/25 text-ink hover:text-ink text-xs transition-colors cursor-pointer"
              title="Delete Shot"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 px-1.5 hover:bg-sunken text-ink-soft hover:text-ink text-xs transition-colors cursor-pointer"
            title="Close Inspector"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* SEGMENTED TAB SELECTOR (Visuals / Timing / Narration) */}
      <div className="grid grid-cols-3 bg-paper-3 p-1 border-2 border-ink shadow-nb-sm">
        <button
          onClick={() => setActiveTab("visuals")}
          className={`py-1.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "visuals"
              ? "bg-select text-select-ink shadow"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Visuals</span>
        </button>

        <button
          onClick={() => setActiveTab("timing")}
          className={`py-1.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "timing"
              ? "bg-select text-select-ink shadow"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Timing</span>
        </button>

        <button
          onClick={() => setActiveTab("narration")}
          className={`py-1.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "narration"
              ? "bg-select text-select-ink shadow"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Script</span>
        </button>
      </div>

      {/* TAB 1: VISUALS */}
      {activeTab === "visuals" && (
        <div className="flex flex-col gap-3">
          <ShotDesignPanel key={shot.id} film={film} shot={shot} onApply={(update, label) => onUpdateShot(shotIndex, update, label)} />

          {/* Render Mode Selector Cards */}
          <div className="flex flex-col gap-1.5 bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
            <label className="text-[10px] font-mono text-ink-soft font-bold uppercase tracking-wider">
              Render Mode
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setRenderMode("character")}
                className={`p-2 border-2 border-ink text-left flex items-center gap-2 transition-all cursor-pointer ${
                  renderMode === "character"
                    ? "bg-select/20 border-select text-ink shadow-nb-sm-nb-sm"
                    : "bg-paper-3 border-2 border-ink text-ink-soft hover:border-ink hover:text-ink"
                }`}
              >
                <User className="w-4 h-4 text-ink shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px]">Character Rig</span>
                  <span className="text-[9px] opacity-70 truncate">
                    Animated Vector Actor
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRenderMode("metaphor")}
                className={`p-2 border-2 border-ink text-left flex items-center gap-2 transition-all cursor-pointer ${
                  renderMode === "metaphor"
                    ? "bg-select/20 border-select text-ink shadow-nb-sm-nb-sm"
                    : "bg-paper-3 border-2 border-ink text-ink-soft hover:border-ink hover:text-ink"
                }`}
              >
                <Layers className="w-4 h-4 text-ink shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px]">Visual Device</span>
                  <span className="text-[9px] opacity-70 truncate">
                    Latent Space / Graphs
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRenderMode("standard")}
                className={`p-2 border-2 border-ink text-left flex items-center gap-2 transition-all cursor-pointer ${
                  renderMode === "standard"
                    ? "bg-select/20 border-select text-ink shadow-nb-sm-nb-sm"
                    : "bg-paper-3 border-2 border-ink text-ink-soft hover:border-ink hover:text-ink"
                }`}
              >
                <Type className="w-4 h-4 text-ink shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px]">Standard</span>
                  <span className="text-[9px] opacity-70 truncate">
                    Pure Typography
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRenderMode("b-roll")}
                className={`p-2 border-2 border-ink text-left flex items-center gap-2 transition-all cursor-pointer ${
                  renderMode === "b-roll"
                    ? "bg-select/20 border-select text-ink shadow-nb-sm-nb-sm"
                    : "bg-paper-3 border-2 border-ink text-ink-soft hover:border-ink hover:text-ink"
                }`}
              >
                <FilmIcon className="w-4 h-4 text-ink shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-[11px]">B-Roll</span>
                  <span className="text-[9px] opacity-70 truncate">
                    Cinematic Footage
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* SVG Character Rig Controls */}
          {renderMode === "character" && charBlock && (
            <div className="flex flex-col gap-2.5 bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono text-ink font-bold uppercase tracking-wider">
                  Character Cast
                </label>
                <select
                  value={charBlock.characterId || "developer"}
                  onChange={(e) => {
                    const newBlocks = [...shot.blocks];
                    newBlocks[charBlockIdx] = {
                      ...charBlock,
                      characterId: e.target.value,
                    };
                    onUpdateShot(
                      shotIndex,
                      { blocks: newBlocks },
                      `Switch character to ${e.target.value}`,
                    );
                  }}
                  className="bg-sunken border-2 border-ink px-2 py-1 text-xs text-ink outline-none focus:border-2 border-ink shadow-nb-sm"
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
                <span className="text-[10px] text-ink-soft">1-Click Poses</span>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { id: "neutral", label: "Rest" },
                    { id: "think", label: "Think" },
                    { id: "present-right", label: "Point R" },
                    { id: "present-left", label: "Point L" },
                    { id: "wave-left", label: "Wave" },
                    { id: "celebrate", label: "Cheer" },
                    { id: "shrug", label: "Shrug" },
                    { id: "walk", label: "Walk" },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPosePreset(preset.id)}
                      className="bg-paper-3 hover:bg-sunken text-ink text-[10px] py-1.5 px-1 border-2 border-ink hover:border-ink/80 transition-colors text-center truncate cursor-pointer shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
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
            <div className="flex flex-col gap-2 bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
              <label className="text-[10px] font-mono text-ink font-bold uppercase tracking-wider">
                Topic Visual Metaphor
              </label>

              <select
                value={shot.metaphor || "glowing-cluster"}
                onChange={(e) => {
                  const val = e.target.value;
                  const cleanBlocks = shot.blocks.filter(
                    (b) => b.c !== "MetaphorViewer",
                  );
                  const textReveal = shot.blocks.find(
                    (b) => b.c === "TextReveal",
                  );
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
                    {
                      metaphor: val as any,
                      blocks: [...cleanBlocks, newMetaphorBlock as any],
                    },
                    `Switch metaphor to ${val}`,
                  );
                }}
                className="w-full bg-sunken border-2 border-ink px-2.5 py-1.5 text-xs text-ink outline-none focus:border-2 border-ink shadow-nb-sm"
              >
                {METAPHOR_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Camera Motion & Transition */}
          <div className="flex flex-col gap-2.5 bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
            <label className="text-[10px] font-mono text-ink font-bold uppercase tracking-wider">
              Camera & Scene Dynamics
            </label>

            {/* Motion */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-ink-soft">Motion</span>
                <select
                  value={shot.move || "cut"}
                  onChange={(e) =>
                    onUpdateShot(
                      shotIndex,
                      { move: e.target.value as any },
                      `Set camera motion to ${e.target.value}`,
                    )
                  }
                  className="bg-sunken border-2 border-ink px-2 py-1 text-xs text-ink outline-none shadow-nb-sm"
                >
                  {MOTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

            </div>

            {/* Full transition inspector: preset, duration and the frame count it produces. */}
            <TransitionEditor
              selectedTransition={(shot.transition as TransitionType) || "paper-rip"}
              durationSec={transitionDurationSec}
              fps={film.fps || 30}
              onSelectTransition={(type) =>
                onUpdateShot(shotIndex, { transition: type }, `Set ${shot.id} transition to ${type}`)
              }
              onChangeDuration={setTransitionDurationSec}
              onApplyToAll={() => {
                const type = (shot.transition as TransitionType) || "paper-rip";
                film.shots.forEach((_, idx) => {
                  onUpdateShot(idx, { transition: type }, `Set every shot transition to ${type}`);
                });
              }}
            />

            {/* Cinematic Drift Toggle */}
            <div className="flex items-center justify-between pt-1 border-t-2 border-ink">
              <span className="text-[11px] text-ink">Cinematic Drift</span>
              <input
                type="checkbox"
                checked={shot.drift ?? true}
                onChange={(e) =>
                  onUpdateShot(
                    shotIndex,
                    { drift: e.target.checked },
                    `Toggle drift for ${shot.id}`,
                  )
                }
                className="accent-select cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TIMING */}
      {activeTab === "timing" && (
        <div className="flex flex-col gap-3">
          {/* Duration & Position Cards */}
          <div className="flex flex-col gap-2.5 bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono text-ink font-bold uppercase tracking-wider">
                Shot Duration
              </label>
              <span className="font-mono text-ink font-bold text-xs bg-sunken px-2 py-0.5 ">
                {dur.toFixed(2)}s ({Math.round(dur * fps)}f)
              </span>
            </div>

            <input
              aria-label="Shot duration in seconds"
              type="range"
              min="0.5"
              max="30"
              step="0.1"
              value={dur}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 1.0;
                onUpdateShot(
                  shotIndex,
                  { dur: val, end: (shot.start ?? 0) + val },
                  `Set duration to ${val}s`,
                );
              }}
              className="w-full accent-select cursor-pointer"
            />

            {/* Timeline Start Position */}
            <div className="flex items-center justify-between text-[11px] text-ink-soft pt-1 border-t-2 border-ink">
              <span>Timeline Position (Start)</span>
              <span className="font-mono text-ink font-bold">
                {pos.toFixed(2)}s
              </span>
            </div>
          </div>

          {/* Speaker Speed Control Bar */}
          <div className="flex flex-col gap-2 bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono text-ink font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Mic className="w-3 h-3 text-ink" />
                <span>Playback Speed</span>
              </label>
              <span className="font-mono text-ink font-bold text-xs bg-sunken px-2 py-0.5 ">
                {(shot.speed ?? 1.0).toFixed(2)}x
              </span>
            </div>

            <input
              aria-label="Narration speed multiplier"
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={shot.speed ?? 1.0}
              onChange={(e) => {
                const spd = parseFloat(e.target.value) || 1.0;
                onUpdateShot(shotIndex, { speed: spd }, `Set speed to ${spd}x`);
              }}
              className="w-full accent-select cursor-pointer"
            />

            {/* Preset Buttons */}
            <div className="flex items-center justify-between gap-1">
              {[0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    onUpdateShot(
                      shotIndex,
                      { speed: preset },
                      `Set speed to ${preset}x`,
                    )
                  }
                  className={`flex-1 py-1 text-[10px] font-mono transition-colors cursor-pointer ${
                    Math.abs((shot.speed ?? 1.0) - preset) < 0.01
                      ? "bg-primary text-ink font-bold"
                      : "bg-paper-3 text-ink-soft hover:text-ink"
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
        <div className="flex flex-col gap-2.5 bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-mono text-ink font-bold uppercase tracking-wider">
              Screenplay Narration
            </label>
            <span className="text-[10px] text-ink-soft font-mono">
              {(shot.scriptText || "").split(/\s+/).filter(Boolean).length}{" "}
              words
            </span>
          </div>

          <textarea
            rows={5}
            value={shot.scriptText || ""}
            onChange={(e) =>
              onUpdateShot(
                shotIndex,
                { scriptText: e.target.value },
                `Update narration script`,
              )
            }
            placeholder="Enter spoken narration for this shot..."
            className="w-full bg-sunken border-2 border-ink p-2.5 text-xs text-ink outline-none resize-none focus:border-2 border-ink leading-relaxed font-sans shadow-nb-sm"
          />

          <p className="text-[10px] text-ink-soft leading-normal flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-ink shrink-0" />
            <span>
              Words align with audio to generate phrase-locked subtitles.
            </span>
          </p>
        </div>
      )}
    </div>
  );
};
