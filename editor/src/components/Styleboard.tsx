/**
 * File Description: Styleboard & Visual Keyframe Studio component providing rich scene previews, metaphor badges, 3D camera controls, and animated primitive specimens.
 */

import { useState, useMemo } from "react";
import type { Film, Shot, Block } from "../../../src/dl/schema";

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
  { name: "Indigo Tech", hex: "#635BFF" },
  { name: "Rose Neon", hex: "#F43F5E" },
  { name: "Emerald Flow", hex: "#10B981" },
  { name: "Amber Radiant", hex: "#F59E0B" },
  { name: "Cyan Quantum", hex: "#06B6D4" },
  { name: "Violet Deep", hex: "#8B5CF6" },
];

const BACKGROUNDS = [
  { id: "dot-grid", name: "Dot Grid Pattern", icon: "⁘" },
  { id: "blueprint", name: "Subtle Blueprint", icon: "▦" },
  { id: "minimal", name: "Clean Pure Dark", icon: "◼" },
];

const CAMERA_ANGLES = [
  { id: "isometric", name: "Isometric 35° (High Tech)", icon: "📐" },
  { id: "hero-tilt", name: "Low-Angle Hero 25° (Cinematic)", icon: "🎬" },
  { id: "top-down", name: "Top-Down 90° (Architecture)", icon: "🗺️" },
  { id: "orbit", name: "Dynamic Orbit (Continuous)", icon: "🪐" },
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
  if (shot.metaphor) {
    if (shot.metaphor.includes("throw") || shot.metaphor.includes("character")) {
      return { label: "Character Throw Metaphor", icon: "🤖", color: "#F43F5E" };
    }
    if (shot.metaphor.includes("matrix") || shot.metaphor.includes("grid")) {
      return { label: "Memory Matrix Grid", icon: "🔲", color: "#635BFF" };
    }
    return { label: shot.metaphor, icon: "✨", color: "#10B981" };
  }

  // Infer from blocks
  const hasTokenStrip = shot.blocks.some(b => b.c === "TokenStrip");
  if (hasTokenStrip) return { label: "Tokenization Sequence", icon: "🔤", color: "#F59E0B" };

  const hasMatrix = shot.blocks.some(b => b.c === "MatrixGrid");
  if (hasMatrix) return { label: "Memory Allocation Grid", icon: "🔲", color: "#635BFF" };

  const hasStat = shot.blocks.some(b => b.c === "StatCounter");
  if (hasStat) return { label: "High-Impact Metric", icon: "📊", color: "#10B981" };

  const hasArcs = shot.blocks.some(b => b.c === "AttentionArcs");
  if (hasArcs) return { label: "Attention Network Arcs", icon: "⚡", color: "#8B5CF6" };

  return { label: "Narrative Anchor", icon: "🎯", color: "#8A8A8E" };
}

/**
 * Renders an interactive simulated preview of a single block primitive inside the keyframe card.
 */
function renderBlockPreview(block: Block, accent: string) {
  switch (block.c) {
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
  const [selectedBg, setSelectedBg] = useState<string>(film.theme?.background || "dot-grid");
  const [selectedCamera, setSelectedCamera] = useState<string>(film.theme?.cameraAngle || "isometric");
  const bounds = useMemo(() => getMapBounds(film), [film]);

  /**
   * Updates a theme property on the active film object.
   */
  const handleThemeChange = (key: string, value: string) => {
    if (key === "background") setSelectedBg(value);
    if (key === "cameraAngle") setSelectedCamera(value);

    if (onUpdateFilm) {
      onUpdateFilm({
        ...film,
        theme: {
          ...film.theme,
          [key]: value,
        },
      });
    }
  };

  return (
    <div className="w-full h-full bg-[#0A0A0B] text-[#F5F5F5] flex flex-col overflow-hidden font-sans">
      
      {/* TOP ART DIRECTION CONTROLS */}
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
                  selectedCamera === cam.id
                    ? "bg-[#635BFF] text-white font-bold shadow"
                    : "text-gray-400 hover:text-white"
                }`}
                title={cam.name}
              >
                <span>{cam.icon}</span>
                <span className="capitalize">{cam.id.replace("-", " ")}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Background Texture Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-[#8A8A8E] font-bold uppercase tracking-wider">
            Background Canvas
          </label>
          <div className="flex items-center gap-1.5 bg-[#1A1A22] p-1 rounded-lg border border-[#333]">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                onClick={() => handleThemeChange("background", bg.id)}
                className={`text-xs px-2.5 py-1 rounded font-medium flex items-center gap-1 transition-all ${
                  selectedBg === bg.id
                    ? "bg-[#2A2A35] text-white font-bold border border-[#444]"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <span>{bg.icon}</span>
                <span>{bg.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Storytelling Style Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-[#8A8A8E] font-bold uppercase tracking-wider">
            Storytelling Style
          </label>
          <div className="flex items-center gap-1.5 bg-[#1A1A22] p-1 rounded-lg border border-[#333]">
            {[
              { id: "default", name: "Standard" },
              { id: "minimal", name: "Minimal" },
              { id: "technical", name: "Technical" },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => onStoryStyleChange(s.id)}
                className={`text-xs px-2.5 py-1 rounded font-medium transition-all ${
                  storyStyle === s.id
                    ? "bg-[#635BFF] text-white font-bold shadow"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 bg-[#1A1A20] p-1 rounded-lg border border-[#333]">
          <button
            onClick={() => setActiveTab("storyboard")}
            className={`text-xs px-3 py-1.5 rounded-md font-bold transition-all ${
              activeTab === "storyboard" ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            🎬 Keyframe Gallery ({film.shots.length})
          </button>
          <button
            onClick={() => setActiveTab("primitives")}
            className={`text-xs px-3 py-1.5 rounded-md font-bold transition-all ${
              activeTab === "primitives" ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            🧩 Primitives Specimen
          </button>
          <button
            onClick={() => setActiveTab("spatial")}
            className={`text-xs px-3 py-1.5 rounded-md font-bold transition-all ${
              activeTab === "spatial" ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            🗺️ Spatial Topology
          </button>
        </div>
      </div>

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
                  Visual representation of each scene, kinetic layout, and metaphor blueprint before rendering.
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
                return (
                  <div
                    key={shot.id}
                    onClick={() => onSelectShot(shot.id)}
                    className="bg-[#121216] border border-[#26262E] hover:border-[#635BFF] rounded-2xl overflow-hidden shadow-xl flex flex-col cursor-pointer transition-all hover:scale-[1.01] hover:shadow-[#635BFF]/10 group"
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
                          {shot.stage}
                        </span>
                      </div>
                    </div>

                    {/* Metaphor & Creative Direction Banner */}
                    <div
                      className="px-4 py-2 flex items-center gap-2 text-xs font-medium border-b border-[#222]"
                      style={{ backgroundColor: `${metaphor.color}15`, color: metaphor.color }}
                    >
                      <span>{metaphor.icon}</span>
                      <span className="font-bold">{metaphor.label}</span>
                    </div>

                    {/* Simulated Remotion Visual Frame */}
                    <div className="p-4 bg-[#0A0A0E] flex-1 flex flex-col gap-3 min-h-[160px] relative">
                      
                      {/* Background dot pattern preview */}
                      <div className="absolute inset-0 opacity-15 pointer-events-none" style={{
                        backgroundImage: selectedBg === "dot-grid" ? "radial-gradient(#888 1px, transparent 1px)" : "none",
                        backgroundSize: "16px 16px"
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
                <span>🧩</span> 7 Core Animated Primitives Specimen
              </h3>
              <p className="text-xs text-[#8A8A8E] mt-0.5">
                Every video scene is constructed strictly using these 7 mathematically refined, accessible primitives.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
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
