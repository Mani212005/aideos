/**
 * File Description: Styleboard & Visual Keyframe Studio component providing rich scene previews,
 * SVG character animations, metaphor badges, 3D camera controls, and animated primitive specimens.
 */

import { useState, useMemo } from "react";
import type { Film, Shot, Block, BackgroundPreset, CameraAngle } from "../../../src/dl/schema";
import { BACKGROUND_THEMES } from "../../../src/dl/tokens";
import { CHARACTER_RIGS } from "../../../src/dl/characters";
import { POSE_PRESETS } from "../../../src/dl/characters/presets";

interface StyleboardProps {
  film: Film;
  accent: string;
  onAccentChange: (a: string) => void;
  storyStyle: string;
  onStoryStyleChange: (s: string) => void;
  onSelectShot: (id: string) => void;
  onUpdateFilm?: (film: Film) => void;
}

const ACCENTS = [
  { name: "Electric Indigo", hex: "#635BFF" },
  { name: "Terracotta Orange", hex: "#FF6B00" },
  { name: "Rose Neon", hex: "#F43F5E" },
  { name: "Emerald Flow", hex: "#10B981" },
  { name: "Amber Radiant", hex: "#F59E0B" },
  { name: "Cyber Cyan", hex: "#00D2D3" },
  { name: "Violet Deep", hex: "#8B5CF6" },
];

const CAMERA_ANGLES: Array<{ id: CameraAngle; name: string; icon: string }> = [
  { id: "flat", name: "Flat 2D", icon: "📐" },
  { id: "isometric", name: "Isometric 3D", icon: "🧊" },
  { id: "cinematic-tilt", name: "Cinematic Tilt", icon: "🎥" },
  { id: "low-angle", name: "Hero Low-Angle", icon: "🔺" },
  { id: "orbit", name: "Dynamic Orbit", icon: "🛰️" },
  { id: "top-down", name: "Overhead Blueprint", icon: "🗺️" },
];

/**
 * Calculates a padded bounding box containing all nodes in canvas space.
 */
function getMapBounds(film: Film) {
  const { nodes } = film.canvas;
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map(node => node.x));
  const minY = Math.min(...nodes.map(node => node.y));
  const maxX = Math.max(...nodes.map(node => node.x + node.w));
  const maxY = Math.max(...nodes.map(node => node.y + node.h));
  const padding = 80;
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * Derives a prominent visual metaphor label and emoji badge from a shot.
 */
function getMetaphorInfo(shot: Shot) {
  // Check if shot has a CharacterBeat
  const charBlock = shot.blocks.find(b => b.c === "CharacterBeat") as any;
  if (charBlock) {
    const charName = charBlock.characterId === "developer" ? "Tech Architect" : "Astro Guide";
    return { label: `SVG Character: ${charName}`, icon: "🎭", color: "#635BFF" };
  }

  if (shot.needsFootage) {
    return { label: "GPU B-Roll Video Scene", icon: "🎬", color: "#F59E0B" };
  }

  if (shot.metaphor) {
    if (shot.metaphor.includes("throw") || shot.metaphor.includes("character")) {
      return { label: "Character Action Metaphor", icon: "🤖", color: "#F43F5E" };
    }
    if (shot.metaphor.includes("matrix") || shot.metaphor.includes("grid")) {
      return { label: "Memory Matrix Grid", icon: "🔲", color: "#635BFF" };
    }
    return { label: shot.metaphor, icon: "✨", color: "#10B981" };
  }

  // Infer from standard blocks
  const hasTokenStrip = shot.blocks.some(b => b.c === "TokenStrip");
  if (hasTokenStrip) return { label: "Tokenization Sequence", icon: "🔤", color: "#F59E0B" };

  const hasMatrix = shot.blocks.some(b => b.c === "MatrixGrid");
  if (hasMatrix) return { label: "Memory Allocation Grid", icon: "🔲", color: "#635BFF" };

  const hasStat = shot.blocks.some(b => b.c === "StatCounter");
  if (hasStat) return { label: "High-Impact Metric", icon: "📊", color: "#10B981" };

  const hasDevice = shot.blocks.some(b => b.c === "DeviceCard");
  if (hasDevice) return { label: "Interactive Device UI", icon: "💻", color: "#00D2D3" };

  return { label: "Narrative & Spatial Node", icon: "🎯", color: "#8A8A8E" };
}

/**
 * Renders an interactive simulated preview of a single block primitive inside the keyframe card.
 */
function renderBlockPreview(block: Block, accent: string) {
  switch (block.c) {
    case "CharacterBeat":
      const charBlock = block as any;
      const rig = CHARACTER_RIGS[charBlock.characterId as keyof typeof CHARACTER_RIGS] || CHARACTER_RIGS.astronaut;
      const poseKeyframes = charBlock.keyframes || [{ t: 0, pose: "neutral" }];
      return (
        <div className="bg-[#121218] p-3 rounded-xl border border-[#635BFF]/40 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#635BFF]/20 border border-[#635BFF]/50 flex items-center justify-center text-xl">
              {charBlock.characterId === "developer" ? "🧑‍💻" : "👨‍🚀"}
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>{rig.name}</span>
                <span className="badge badge-xs badge-primary font-mono">{charBlock.stage || "frame"}</span>
              </div>
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                Pose: <span className="text-[#635BFF] font-bold">{poseKeyframes[0]?.pose || "neutral"}</span> ({poseKeyframes.length} keyframes)
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded">
            60 FPS SVG
          </span>
        </div>
      );

    case "DeviceCard":
      const devBlock = block as any;
      return (
        <div className="bg-[#121218] p-2.5 rounded-lg border border-[#262632] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">{devBlock.variant === "terminal" ? "📟" : "💻"}</span>
            <div>
              <div className="text-xs font-bold text-white">{devBlock.title || "Device Window"}</div>
              <div className="text-[10px] text-[#8A8A8E] font-mono">{devBlock.url || "localhost"}</div>
            </div>
          </div>
          <span className="text-[10px] text-gray-500 font-mono">{devBlock.variant}</span>
        </div>
      );

    case "TextReveal":
      return (
        <div className="py-1">
          <div className={`font-bold text-white tracking-tight ${block.size === "display" ? "text-base" : "text-sm"}`}>
            {block.text}
          </div>
          {block.accentWord && (
            <div className="text-[11px] font-mono mt-0.5" style={{ color: accent }}>
              Key Accent: <span className="underline decoration-2">{block.accentWord}</span>
            </div>
          )}
        </div>
      );

    case "Body":
      return (
        <p className="text-xs text-[#8A8A8E] leading-relaxed line-clamp-2">
          {block.text}
        </p>
      );

    case "Kicker":
      return (
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#8A8A8E] bg-[#1E1E24] px-2 py-0.5 rounded border border-[#333]">
          {block.text}
        </span>
      );

    case "StatCounter":
      return (
        <div className="flex items-baseline gap-2 bg-[#121218] p-2.5 rounded-lg border border-[#262632]">
          <span className="text-xl font-bold font-mono" style={{ color: accent }}>
            {block.to}{block.suffix || ""}
          </span>
          <span className="text-xs text-[#8A8A8E] uppercase tracking-wider">{block.label}</span>
        </div>
      );

    case "TokenStrip":
      return (
        <div className="flex flex-wrap gap-1 bg-[#121218] p-2 rounded-lg border border-[#262632]">
          {block.tokens.slice(0, 6).map((tok, i) => (
            <span
              key={i}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
              style={{
                borderColor: i === 0 ? accent : "#333",
                backgroundColor: i === 0 ? `${accent}20` : "#1A1A22",
                color: i === 0 ? "white" : "#8A8A8E",
              }}
            >
              {tok}
            </span>
          ))}
          {block.tokens.length > 6 && (
            <span className="text-[10px] text-gray-500 font-mono self-center">+{block.tokens.length - 6} more</span>
          )}
        </div>
      );

    case "MatrixGrid":
      return (
        <div className="bg-[#121218] p-2 rounded-lg border border-[#262632] flex items-center justify-between">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((cell) => (
              <div
                key={cell}
                className="w-4 h-4 rounded-sm border flex items-center justify-center text-[9px] font-mono"
                style={{
                  borderColor: cell <= 3 ? accent : "#333",
                  backgroundColor: cell <= 3 ? `${accent}30` : "#161620",
                  color: cell <= 3 ? "white" : "#555",
                }}
              >
                {cell}
              </div>
            ))}
          </div>
          <span className="text-[10px] text-[#8A8A8E] font-mono">KV Cache Cells</span>
        </div>
      );

    case "ProgressBar":
      return (
        <div className="w-full bg-[#121218] p-2 rounded-lg border border-[#262632] flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-[#8A8A8E]">
            <span>{block.label || "Progress"}</span>
            <span className="font-mono">{Math.round(block.value * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-[#222] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${block.value * 100}%`, backgroundColor: accent }} />
          </div>
        </div>
      );

    default:
      return (
        <div className="text-[11px] font-mono text-gray-400 bg-[#16161E] px-2 py-1 rounded border border-[#2A2A35]">
          {block.c} primitive
        </div>
      );
  }
}

/**
 * Main Styleboard and Keyframe Gallery component.
 */
export function Styleboard({
  film,
  accent,
  onAccentChange,
  storyStyle,
  onStoryStyleChange,
  onSelectShot,
  onUpdateFilm,
}: StyleboardProps) {
  const [activeTab, setActiveTab] = useState<"storyboard" | "primitives" | "spatial">("storyboard");
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Derive active theme directly from film.theme (single source of truth)
  const currentBg: BackgroundPreset = film.theme?.background || "paper-white";
  const currentCamera: CameraAngle = film.theme?.cameraAngle || "isometric";
  const bounds = useMemo(() => getMapBounds(film), [film]);

  /**
   * Updates a theme property on the active film object.
   */
  const handleThemeChange = (key: string, value: string) => {
    if (onUpdateFilm) {
      onUpdateFilm({
        ...film,
        theme: {
          ...(film.theme || {}),
          [key]: value,
        },
      });
    }
  };

  /**
   * Explicitly saves the current storyboard and theme settings to disk.
   */
  const handleSaveStoryboard = async () => {
    setIsSaving(true);
    setSaveToast(null);
    try {
      const filmToSave = {
        ...film,
        accent: accent === "#635BFF" ? (film.theme?.accent || undefined) : accent,
        theme: {
          ...(film.theme || {}),
          background: currentBg,
          cameraAngle: currentCamera,
          accent: accent === "#635BFF" ? (film.theme?.accent || undefined) : accent,
        },
      };

      const res = await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film: filmToSave }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}: Failed to save film`);
      }

      setSaveToast(`✓ Saved Storyboard & Themes to ${film.id}.ts!`);
      setTimeout(() => setSaveToast(null), 4000);
    } catch (err: any) {
      setSaveToast("⚠️ " + (err.message || "Failed to save"));
      setTimeout(() => setSaveToast(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Toggles or changes a shot's visual mode (Standard, SVG Character, or B-Roll).
   */
  const handleSetShotMode = (shotIdx: number, mode: "standard" | "character" | "b-roll") => {
    if (!onUpdateFilm) return;
    const updatedShots = [...film.shots];
    const shot = updatedShots[shotIdx];
    if (!shot) return;

    if (mode === "character") {
      // Remove other device blocks and add CharacterBeat
      const filteredBlocks = shot.blocks.filter(b => b.c !== "CharacterBeat" && b.c !== "DeviceCard" && b.c !== "MetaphorViewer");
      const charBlock: Block = {
        c: "CharacterBeat",
        characterId: "astronaut",
        stage: "frame",
        keyframes: [
          { t: 0, pose: "neutral" },
          { t: 0.5, pose: "present-right" },
        ],
      } as any;

      updatedShots[shotIdx] = {
        ...shot,
        needsFootage: false,
        blocks: [charBlock, ...filteredBlocks],
      };
    } else if (mode === "b-roll") {
      // Set needsFootage flag
      const filteredBlocks = shot.blocks.filter(b => b.c !== "CharacterBeat");
      updatedShots[shotIdx] = {
        ...shot,
        needsFootage: true,
        blocks: filteredBlocks,
      };
    } else {
      // Standard narrative text / devices
      const filteredBlocks = shot.blocks.filter(b => b.c !== "CharacterBeat");
      updatedShots[shotIdx] = {
        ...shot,
        needsFootage: false,
        blocks: filteredBlocks.length > 0 ? filteredBlocks : [{ c: "Body", text: shot.scriptText || "Scene narrative" }],
      };
    }

    onUpdateFilm({
      ...film,
      shots: updatedShots,
    });
  };

  return (
    <div className="w-full h-full bg-[#0A0A0B] text-[#F5F5F5] flex flex-col overflow-hidden font-sans">
      
      {/* TOP ART DIRECTION & PERSISTENCE HEADER */}
      <div className="bg-[#121216] border-b border-[#26262E] p-4 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-md">
        
        {/* Brand Accent Palette */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-[#8A8A8E] font-bold uppercase tracking-wider">
            Brand Accent Token
          </label>
          <div className="flex items-center gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                onClick={() => {
                  onAccentChange(a.hex);
                  handleThemeChange("accent", a.hex);
                }}
                className={`w-7 h-7 rounded-full border-2 transition-all flex items-center justify-center ${
                  accent === a.hex ? "border-white scale-110 shadow-lg shadow-white/10" : "border-transparent opacity-80 hover:opacity-100"
                }`}
                style={{ backgroundColor: a.hex }}
                title={a.name}
              >
                {accent === a.hex && <span className="text-[10px] text-white font-bold">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* 3D Camera Perspective Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-[#8A8A8E] font-bold uppercase tracking-wider">
            3D Camera Perspective
          </label>
          <div className="flex items-center gap-1.5 bg-[#1A1A22] p-1 rounded-lg border border-[#333]">
            {CAMERA_ANGLES.map((cam) => (
              <button
                key={cam.id}
                onClick={() => handleThemeChange("cameraAngle", cam.id)}
                className={`text-xs px-2.5 py-1 rounded font-medium flex items-center gap-1 transition-all ${
                  currentCamera === cam.id
                    ? "bg-[#635BFF] text-white font-bold shadow"
                    : "text-gray-400 hover:text-white"
                }`}
                title={cam.name}
              >
                <span>{cam.icon}</span>
                <span className="capitalize">{cam.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Background Canvas Selector (Connected to BACKGROUND_THEMES) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-[#8A8A8E] font-bold uppercase tracking-wider">
            Background Canvas
          </label>
          <div className="flex items-center gap-1.5 bg-[#1A1A22] p-1 rounded-lg border border-[#333]">
            {Object.values(BACKGROUND_THEMES).map((bg) => (
              <button
                key={bg.id}
                onClick={() => handleThemeChange("background", bg.id)}
                className={`text-xs px-2.5 py-1 rounded font-medium flex items-center gap-1 transition-all ${
                  currentBg === bg.id
                    ? "bg-[#635BFF] text-white font-bold shadow"
                    : "text-gray-400 hover:text-white"
                }`}
                title={bg.description}
              >
                <span>{bg.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* View Tabs & Save Storyboard Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[#1A1A20] p-1 rounded-lg border border-[#333]">
            <button
              onClick={() => setActiveTab("storyboard")}
              className={`text-xs px-3 py-1.5 rounded-md font-bold transition-all ${
                activeTab === "storyboard" ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              🎬 Storyboard ({film.shots.length})
            </button>
            <button
              onClick={() => setActiveTab("primitives")}
              className={`text-xs px-3 py-1.5 rounded-md font-bold transition-all ${
                activeTab === "primitives" ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              🧩 Primitives
            </button>
            <button
              onClick={() => setActiveTab("spatial")}
              className={`text-xs px-3 py-1.5 rounded-md font-bold transition-all ${
                activeTab === "spatial" ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              🗺️ Topology
            </button>
          </div>

          <button
            onClick={handleSaveStoryboard}
            disabled={isSaving}
            className={`px-4 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-lg transition-all ${
              isSaving
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-emerald-500 hover:bg-emerald-400 text-black active:scale-95"
            }`}
          >
            <span>{isSaving ? "⏳" : "💾"}</span>
            <span>{isSaving ? "Saving..." : "Save Storyboard & Apply"}</span>
          </button>
        </div>
      </div>

      {/* Save Toast Feedback */}
      {saveToast && (
        <div className="mx-6 mt-4 p-3 bg-emerald-950/90 border border-emerald-500 rounded-lg text-emerald-200 text-xs font-mono flex items-center gap-2 shadow-xl animate-fade-in">
          <span>🔔</span> {saveToast}
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 overflow-y-auto p-6">
        
        {/* VIEW 1: RICH KEYFRAME STORYBOARD GALLERY */}
        {activeTab === "storyboard" && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <span>🎬</span> Visual Keyframe Storyboard
                </h3>
                <p className="text-xs text-[#8A8A8E] mt-0.5">
                  Click any card to select for timeline editing, or switch visual modes (Standard, SVG Character, GPU B-Roll) directly below.
                </p>
              </div>
              <div className="text-xs text-[#8A8A8E] font-mono">
                Total Film Duration: <span className="text-white font-bold">{film.shots.reduce((acc, s) => acc + s.dur, 0).toFixed(1)}s</span>
              </div>
            </div>

            {/* Grid of Keyframe Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {film.shots.map((shot, idx) => {
                const metaphor = getMetaphorInfo(shot);
                const hasChar = shot.blocks.some(b => b.c === "CharacterBeat");
                const hasBroll = !!shot.needsFootage;
                const activeMode = hasChar ? "character" : hasBroll ? "b-roll" : "standard";

                return (
                  <div
                    key={shot.id}
                    className="bg-[#121216] border border-[#26262E] hover:border-[#635BFF] rounded-2xl overflow-hidden shadow-xl flex flex-col transition-all hover:scale-[1.01] hover:shadow-[#635BFF]/10 group"
                  >
                    {/* Keyframe Card Header */}
                    <div className="bg-[#16161D] px-4 py-2.5 border-b border-[#26262E] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold bg-[#20202A] text-gray-300 px-2 py-0.5 rounded border border-[#333]">
                          Shot {idx + 1}
                        </span>
                        <span className="text-xs font-mono text-white font-bold">{shot.id}</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono bg-[#1E1E24] text-[#8A8A8E] px-2 py-0.5 rounded border border-[#333]">
                          ⏱️ {shot.dur}s
                        </span>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#635BFF]/15 text-[#635BFF] border border-[#635BFF]/30 font-bold">
                          {shot.stage || "frame"}
                        </span>
                      </div>
                    </div>

                    {/* Metaphor & Creative Direction Banner */}
                    <div
                      className="px-4 py-2 flex items-center justify-between text-xs font-medium border-b border-[#222]"
                      style={{ backgroundColor: `${metaphor.color}15`, color: metaphor.color }}
                    >
                      <div className="flex items-center gap-2">
                        <span>{metaphor.icon}</span>
                        <span className="font-bold">{metaphor.label}</span>
                      </div>

                      {/* 1-Click Render Mode Switcher */}
                      <div className="flex items-center gap-1 bg-black/60 p-0.5 rounded-lg border border-white/10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetShotMode(idx, "standard");
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${
                            activeMode === "standard" ? "bg-white/20 text-white font-bold" : "text-gray-400 hover:text-white"
                          }`}
                          title="Standard Device / Text Mode"
                        >
                          Standard
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetShotMode(idx, "character");
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${
                            activeMode === "character" ? "bg-[#635BFF] text-white font-bold" : "text-gray-400 hover:text-white"
                          }`}
                          title="SVG Character Rig Animation"
                        >
                          🎭 Character
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetShotMode(idx, "b-roll");
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${
                            activeMode === "b-roll" ? "bg-amber-600 text-white font-bold" : "text-gray-400 hover:text-white"
                          }`}
                          title="GPU B-Roll Scene"
                        >
                          🎬 B-Roll
                        </button>
                      </div>
                    </div>

                    {/* Simulated Remotion Visual Frame */}
                    <div 
                      onClick={() => onSelectShot(shot.id)}
                      className="p-4 bg-[#0A0A0E] flex-1 flex flex-col gap-3 min-h-[160px] relative cursor-pointer"
                    >
                      {/* Background texture preview */}
                      <div className="absolute inset-0 opacity-15 pointer-events-none" style={{
                        backgroundColor: BACKGROUND_THEMES[currentBg]?.canvas || "#0A0A0B",
                      }} />

                      {/* Render Shot Blocks */}
                      <div className="relative z-10 flex flex-col gap-2">
                        {shot.blocks.map((block, bi) => (
                          <div key={bi}>
                            {renderBlockPreview(block, accent)}
                          </div>
                        ))}
                      </div>

                      {/* Script Narration Text Excerpt */}
                      {shot.scriptText && (
                        <div className="mt-auto pt-2 border-t border-[#1C1C24] text-[11px] italic text-gray-400 line-clamp-2">
                          "{shot.scriptText}"
                        </div>
                      )}
                    </div>

                    {/* Card Footer: Camera & Spatial Anchoring */}
                    <div className="bg-[#14141A] px-4 py-2 border-t border-[#222] flex items-center justify-between text-[11px] text-[#8A8A8E]">
                      <div className="flex items-center gap-1.5">
                        <span>🎯 Look:</span>
                        <span className="font-mono text-white">
                          {Array.isArray(shot.look) ? shot.look.join(" -> ") : shot.look}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono">
                        <span>📷 Move:</span>
                        <span className="text-white capitalize">{shot.move} ({shot.zoom || 1}x)</span>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 2: ANIMATED PRIMITIVES SPECIMEN BOARD */}
        {activeTab === "primitives" && (
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>🧩</span> Core Animated Primitives Specimen
              </h3>
              <p className="text-xs text-[#8A8A8E] mt-0.5">
                Every video scene is constructed strictly using these mathematically refined, accessible primitives.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* Primitive 0: CharacterBeat */}
              <div className="bg-[#121216] border border-[#635BFF]/40 rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#26262E] pb-2">
                  <span className="text-xs font-mono font-bold text-white">00 · CharacterBeat</span>
                  <span className="badge badge-xs badge-primary font-mono">SVG 2-Level Rig</span>
                </div>
                <div className="p-3 bg-[#0A0A0E] rounded-xl border border-[#222] flex items-center gap-3">
                  <span className="text-2xl">👨‍🚀</span>
                  <div>
                    <div className="text-xs font-bold text-white">Astro Guide / Tech Architect</div>
                    <div className="text-[10px] text-[#8A8A8E]">8 Presets · Ease-Out-Expo Kinematics</div>
                  </div>
                </div>
              </div>

              {/* Primitive 1: TextReveal */}
              <div className="bg-[#121216] border border-[#26262E] rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#26262E] pb-2">
                  <span className="text-xs font-mono font-bold text-white">01 · TextReveal</span>
                  <span className="text-[10px] text-gray-400 font-mono">Display & Subhead</span>
                </div>
                <div className="p-3 bg-[#0A0A0E] rounded-xl border border-[#222]">
                  <h4 className="text-base font-bold text-white leading-snug">
                    A model never re-reads your <span style={{ color: accent }} className="underline decoration-2">prompt</span>.
                  </h4>
                  <p className="text-xs text-[#8A8A8E] mt-2">
                    Kinetic word-by-word reveal with cubic-bezier easing and landing underline.
                  </p>
                </div>
              </div>

              {/* Primitive 2: StatCounter */}
              <div className="bg-[#121216] border border-[#26262E] rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#26262E] pb-2">
                  <span className="text-xs font-mono font-bold text-white">02 · StatCounter</span>
                  <span className="text-[10px] text-gray-400 font-mono">Animated Numbers</span>
                </div>
                <div className="p-3 bg-[#0A0A0E] rounded-xl border border-[#222] flex items-center gap-3">
                  <span className="text-3xl font-mono font-extrabold" style={{ color: accent }}>
                    10x
                  </span>
                  <div className="text-xs">
                    <div className="text-white font-bold">Throughput Gain</div>
                    <div className="text-[10px] text-[#8A8A8E]">High-impact metric card</div>
                  </div>
                </div>
              </div>

              {/* Primitive 3: MatrixGrid */}
              <div className="bg-[#121216] border border-[#26262E] rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#26262E] pb-2">
                  <span className="text-xs font-mono font-bold text-white">03 · MatrixGrid</span>
                  <span className="text-[10px] text-gray-400 font-mono">Memory Allocation</span>
                </div>
                <div className="p-3 bg-[#0A0A0E] rounded-xl border border-[#222] flex flex-col gap-2">
                  <div className="grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
                      <div
                        key={c}
                        className="h-6 rounded border flex items-center justify-center text-[10px] font-mono"
                        style={{
                          borderColor: c <= 4 ? accent : "#333",
                          backgroundColor: c <= 4 ? `${accent}25` : "#14141C",
                          color: c <= 4 ? "white" : "#666",
                        }}
                      >
                        K{c}V{c}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Primitive 4: TokenStrip */}
              <div className="bg-[#121216] border border-[#26262E] rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#26262E] pb-2">
                  <span className="text-xs font-mono font-bold text-white">04 · TokenStrip</span>
                  <span className="text-[10px] text-gray-400 font-mono">Sequence IDs</span>
                </div>
                <div className="p-3 bg-[#0A0A0E] rounded-xl border border-[#222] flex flex-wrap gap-1.5">
                  {["Write", "a", "prompt", "about", "caching"].map((t, idx) => (
                    <span
                      key={idx}
                      className="text-xs font-mono px-2 py-1 rounded border"
                      style={{
                        borderColor: idx === 2 ? accent : "#333",
                        backgroundColor: idx === 2 ? `${accent}30` : "#16161E",
                        color: idx === 2 ? "white" : "#8A8A8E",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Primitive 5: ProgressBar */}
              <div className="bg-[#121216] border border-[#26262E] rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#26262E] pb-2">
                  <span className="text-xs font-mono font-bold text-white">05 · ProgressBar</span>
                  <span className="text-[10px] text-gray-400 font-mono">Chapter Timeline</span>
                </div>
                <div className="p-3 bg-[#0A0A0E] rounded-xl border border-[#222] flex flex-col gap-2">
                  <div className="flex justify-between text-xs text-[#8A8A8E]">
                    <span>Chapter 2: Decode Phase</span>
                    <span className="font-mono text-white">65%</span>
                  </div>
                  <div className="w-full h-2 bg-[#222] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: "65%", backgroundColor: accent }} />
                  </div>
                </div>
              </div>

              {/* Primitive 6: CodeBlock */}
              <div className="bg-[#121216] border border-[#26262E] rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#26262E] pb-2">
                  <span className="text-xs font-mono font-bold text-white">06 · CodeBlock</span>
                  <span className="text-[10px] text-gray-400 font-mono">JetBrains Mono</span>
                </div>
                <div className="p-3 bg-[#0A0A0E] rounded-xl border border-[#222] font-mono text-[11px] leading-relaxed text-gray-300">
                  <div><span className="text-purple-400">const</span> kvCache = <span className="text-yellow-400">new</span> Map();</div>
                  <div>kvCache.<span className="text-blue-400">set</span>(tokenId, [k, v]);</div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* VIEW 3: SPATIAL TOPOLOGY OVERLAY */}
        {activeTab === "spatial" && (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>🗺️</span> 2D Infinite Canvas Topology
              </h3>
              <p className="text-xs text-[#8A8A8E] mt-0.5">
                Node coordinate space and camera traversal paths across the continuous 2D spatial canvas.
              </p>
            </div>

            <div className="relative aspect-video max-h-[500px] bg-[#0C0C10] border border-[#26262E] rounded-2xl overflow-hidden flex items-center justify-center shadow-2xl">
              <svg
                className="w-full h-full p-4"
                viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Edges */}
                {film.canvas.edges.map((edge, i) => {
                  const from = film.canvas.nodes.find((n) => n.id === edge.from);
                  const to = film.canvas.nodes.find((n) => n.id === edge.to);
                  if (!from || !to) return null;
                  return (
                    <line
                      key={i}
                      x1={from.x + from.w / 2}
                      y1={from.y + from.h / 2}
                      x2={to.x + to.w / 2}
                      y2={to.y + to.h / 2}
                      stroke={edge.dashed ? "#444" : accent}
                      strokeWidth={3}
                      strokeDasharray={edge.dashed ? "6 6" : "none"}
                      opacity={0.8}
                    />
                  );
                })}

                {/* Nodes */}
                {film.canvas.nodes.map((node) => (
                  <g key={node.id}>
                    <rect
                      x={node.x}
                      y={node.y}
                      width={node.w}
                      height={node.h}
                      rx={8}
                      fill="#14141C"
                      stroke={accent}
                      strokeWidth={2}
                    />
                    <text
                      x={node.x + node.w / 2}
                      y={node.y + node.h / 2 - 4}
                      fill="white"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={16}
                      fontWeight="bold"
                      fontFamily="sans-serif"
                    >
                      {node.label}
                    </text>
                    {node.sub && (
                      <text
                        x={node.x + node.w / 2}
                        y={node.y + node.h / 2 + 14}
                        fill="#8A8A8E"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontFamily="sans-serif"
                      >
                        {node.sub}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
            </div>
          </div>
        )}

      </div>

    </div>
  );
}
