// File Description: Customization and Theme Studio Editor for selecting paper textures, typography fonts, video types, storytelling styles, accent colors, saving themes, and directing script-to-visual metaphors.

import React, { useState } from "react";
import type { Film, BackgroundPreset, FontPreset, VideoType, StoryStyle, CameraAngle, Shot } from "../../../src/dl/schema";
import { BACKGROUND_THEMES } from "../../../src/dl/tokens";

export interface CustomizationEditorProps {
  film: Film;
  onUpdateFilm: (updated: Film) => void;
  accent: string;
  onAccentChange: (color: string) => void;
  onSave?: () => Promise<void> | void;
}

const FONTS: Array<{ id: FontPreset; name: string; category: string; preview: string; style: string }> = [
  { id: "geist", name: "Geist Sans", category: "Modern Editorial", preview: "The attention network connects tokens across the canvas.", style: "font-sans font-medium" },
  { id: "mono", name: "JetBrains Mono", category: "Technical & Code", preview: "kv_cache.shape = [batch, seq_len, num_heads, head_dim]", style: "font-mono" },
  { id: "serif", name: "Source Serif 4", category: "Academic & Mathematical", preview: "Attention(Q, K, V) = softmax(QKᵀ / √dₖ) V", style: "italic font-serif" },
  { id: "space-grotesk", name: "Space Grotesk", category: "Expressive Modernist", preview: "Scale compute linearly across distributed clusters.", style: "font-sans font-bold tracking-tight" },
  { id: "inter", name: "Inter", category: "Clean Functional UI", preview: "Optimized memory throughput and zero-copy buffers.", style: "font-sans" },
];

const VIDEO_TYPES: Array<{ id: VideoType; name: string; icon: string; desc: string }> = [
  { id: "educational", name: "Educational Deep-Dive", icon: "🎓", desc: "Layered concept breakdown with visual hierarchy and deliberate pacing." },
  { id: "fact", name: "60s Quick Fact / Reel", icon: "⚡", desc: "High-energy micro-lesson with kinetic motion and rapid payoff zooms." },
  { id: "case-study", name: "Architecture Case Study", icon: "🏗️", desc: "Real-world engineering topologies, benchmark graphs, and data flows." },
  { id: "tutorial", name: "Step-by-Step Tutorial", icon: "🛠️", desc: "Chronological walkthrough with code blocks and parameter inspects." },
];

const STORY_STYLES: Array<{ id: StoryStyle; name: string; icon: string; desc: string; sample: string }> = [
  {
    id: "spatial-map",
    name: "Spatial Mind-Map & Flowchart",
    icon: "🗺️",
    desc: "Concepts are connected nodes in a continuous 2D spatial canvas. The camera smoothly zooms into nodes to reveal animated stages.",
    sample: "Continuous camera navigation · Reversible zoom-in/out frames",
  },
  {
    id: "script-metaphor",
    name: "Script-Driven Visual Metaphors",
    icon: "✨",
    desc: "Visual animations are generated directly from the narration script cues (e.g. spider webs, liquid containers, balance scales, escapement gears).",
    sample: "Spider Web Weaving · Fluid Reservoirs · Physical Balance Scales",
  },
];

const METAPHOR_OPTIONS: Array<{ id: NonNullable<Shot["metaphor"]> | "none" | "character-beat" | "b-roll"; label: string; icon: string }> = [
  { id: "none", label: "Default Spatial Node", icon: "🗺️" },
  { id: "character-beat", label: "SVG Character Rig (Astronaut / Developer)", icon: "🎭" },
  { id: "character-throw", label: "Sleeping Computer Reads & Throws Script", icon: "💻" },
  { id: "b-roll", label: "GPU B-Roll Scene (AI Generated)", icon: "🎬" },
  { id: "spider-web", label: "Spider Web Weaving", icon: "🕸️" },
  { id: "liquid-bucket", label: "Liquid Buffer Reservoir", icon: "🚰" },
  { id: "balance-scale", label: "Balance Scale Equilibrium", icon: "⚖️" },
  { id: "clock-gears", label: "Escapement Clock Gears", icon: "⏱️" },
  { id: "rocket-launch", label: "Scale & Throughput Rocket", icon: "🚀" },
];

const CAMERA_ANGLES: Array<{ id: CameraAngle; name: string; icon: string; desc: string }> = [
  { id: "flat", name: "2D Direct Orthogonal", icon: "📐", desc: "Classic flat direct face-on view with maximum geometric clarity." },
  { id: "isometric", name: "3D Isometric Technical", icon: "🧊", desc: "26° technical CAD perspective with dimensional floating depth." },
  { id: "cinematic-tilt", name: "Cinematic Dutch Tilt", icon: "🎥", desc: "Subtle rolling pitch angle for high-production dynamic feel." },
  { id: "low-angle", name: "Dramatic Low-Angle Hero", icon: "🔺", desc: "Looking upward at system topology from below." },
  { id: "orbit", name: "Continuous 3D Orbit", icon: "🛰️", desc: "Gyroscopic floating orbit with continuous camera movement." },
  { id: "top-down", name: "Overhead Blueprint", icon: "🗺️", desc: "Architectural top-down master blueprint inspect." },
];

const ACCENT_COLORS = [
  { name: "Terracotta", hex: "#FF6B00" },
  { name: "Electric Indigo", hex: "#635BFF" },
  { name: "Emerald Mint", hex: "#10B981" },
  { name: "Cyber Cyan", hex: "#00D2D3" },
  { name: "Rose Gold", hex: "#F43F5E" },
  { name: "Solar Amber", hex: "#F59E0B" },
];

export const CustomizationEditor: React.FC<CustomizationEditorProps> = ({
  film,
  onUpdateFilm,
  accent,
  onAccentChange,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const currentBg: BackgroundPreset = film.theme?.background || "paper-white";
  const currentFont: FontPreset = film.theme?.fontFamily || "geist";
  const currentVideoType: VideoType = film.theme?.videoType || "educational";
  const currentStoryStyle: StoryStyle = film.theme?.storyStyle || "spatial-map";
  const currentCameraAngle: CameraAngle = film.theme?.cameraAngle || "flat";

  const updateTheme = (patch: Partial<NonNullable<Film["theme"]>>) => {
    const updatedTheme = {
      ...(film.theme || {}),
      ...patch,
    };
    onUpdateFilm({
      ...film,
      theme: updatedTheme,
    });
  };

  // Explicit Save Theme Handler
  const handleSaveTheme = async () => {
    setIsSaving(true);
    setSaveToast(null);
    try {
      const filmToSave = {
        ...film,
        accent: accent === "#635BFF" ? (film.theme?.accent || undefined) : accent,
        theme: {
          ...(film.theme || {}),
          background: currentBg,
          fontFamily: currentFont,
          videoType: currentVideoType,
          storyStyle: currentStoryStyle,
          cameraAngle: currentCameraAngle,
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
        throw new Error(data.error || `HTTP ${res.status}: Failed to save film theme to disk`);
      }
      setSaveToast(`✓ Saved theme & visual directions to ${film.id}.ts!`);
      setTimeout(() => setSaveToast(null), 4000);
    } catch (err: any) {
      setSaveToast("⚠️ " + (err.message || "Failed to save"));
      setTimeout(() => setSaveToast(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  // Update shot metaphor cue and configure matching blocks
  const handleUpdateShotMetaphor = (shotIdx: number, metaphor: string) => {
    const updatedShots = [...film.shots];
    const shot = updatedShots[shotIdx];
    if (!shot) return;

    if (metaphor === "character-beat") {
      const filteredBlocks = shot.blocks.filter(b => b.c !== "CharacterBeat" && b.c !== "MetaphorViewer");
      const charBlock = {
        c: "CharacterBeat",
        characterId: "astronaut",
        stage: "frame",
        keyframes: [
          { t: 0, pose: "neutral" },
          { t: 0.5, pose: "present-right" },
        ],
      };
      updatedShots[shotIdx] = {
        ...shot,
        metaphor: "character-throw",
        needsFootage: false,
        blocks: [charBlock as any, ...filteredBlocks],
      };
    } else if (metaphor === "b-roll") {
      const filteredBlocks = shot.blocks.filter(b => b.c !== "CharacterBeat");
      updatedShots[shotIdx] = {
        ...shot,
        metaphor: undefined,
        needsFootage: true,
        blocks: filteredBlocks,
      };
    } else if (metaphor === "none") {
      const filteredBlocks = shot.blocks.filter(b => b.c !== "CharacterBeat");
      updatedShots[shotIdx] = {
        ...shot,
        metaphor: undefined,
        needsFootage: false,
        blocks: filteredBlocks.length > 0 ? filteredBlocks : [{ c: "Body", text: shot.scriptText || "Scene narrative" }],
      };
    } else {
      updatedShots[shotIdx] = {
        ...shot,
        metaphor: metaphor as any,
      };
    }

    onUpdateFilm({
      ...film,
      shots: updatedShots,
    });
  };

  // Update shot human visual direction prompt
  const handleUpdateShotVisualDirection = (shotIdx: number, text: string) => {
    const updatedShots = [...film.shots];
    const lower = text.toLowerCase();
    let autoMetaphor = updatedShots[shotIdx].metaphor;
    if (lower.includes("computer") || lower.includes("character") || lower.includes("sleep") || lower.includes("throw") || lower.includes("window")) {
      autoMetaphor = "character-throw";
    } else if (lower.includes("spider") || lower.includes("web")) {
      autoMetaphor = "spider-web";
    } else if (lower.includes("liquid") || lower.includes("bucket") || lower.includes("reservoir")) {
      autoMetaphor = "liquid-bucket";
    } else if (lower.includes("balance") || lower.includes("scale")) {
      autoMetaphor = "balance-scale";
    } else if (lower.includes("gear") || lower.includes("clock")) {
      autoMetaphor = "clock-gears";
    }

    updatedShots[shotIdx] = {
      ...updatedShots[shotIdx],
      visualDirection: text,
      metaphor: autoMetaphor,
    };
    onUpdateFilm({
      ...film,
      shots: updatedShots,
    });
  };

  return (
    <div className="w-full h-full bg-[#0A0A0B] text-[#F5F5F5] overflow-y-auto p-6 space-y-8 relative">
      {/* Sticky Header with Save Button */}
      <div className="sticky top-0 z-30 bg-[#0A0A0B]/95 backdrop-blur border-b border-[#27272A] pb-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-white">
            <span>🎨</span> Video Customization & Design System Studio
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Customize paper textures, typography, storytelling architecture, and video output categories.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Current Theme Summary Pill */}
          <div className="hidden lg:flex items-center gap-2 bg-[#18181B] border border-[#333] px-3 py-1.5 rounded-full text-xs font-mono text-gray-300">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: accent }} />
            <span>{BACKGROUND_THEMES[currentBg]?.name}</span>
            <span className="text-gray-500">/</span>
            <span>{currentFont}</span>
            <span className="text-gray-500">/</span>
            <span className="text-[#635BFF]">{currentStoryStyle}</span>
          </div>

          {/* Explicit Save Button */}
          <button
            onClick={handleSaveTheme}
            disabled={isSaving}
            className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-lg transition-all ${
              isSaving
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-[#10B981] hover:bg-[#059669] text-black hover:scale-105"
            }`}
          >
            <span>{isSaving ? "⏳" : "💾"}</span>
            <span>{isSaving ? "Saving Theme..." : "Save Theme & Apply"}</span>
          </button>
        </div>
      </div>

      {/* Save Toast Feedback */}
      {saveToast && (
        <div className="p-3 bg-emerald-950/90 border border-emerald-500 rounded-lg text-emerald-200 text-xs font-mono flex items-center gap-2 shadow-xl animate-fade-in">
          <span>🔔</span> {saveToast}
        </div>
      )}

      {/* 1. PAPER BACKGROUND & TEXTURE LIBRARY */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>📜</span> 1. Paper Library & Video Background
          </label>
          <span className="text-[11px] text-gray-500 font-mono">6 Tactile Canvas Textures</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.values(BACKGROUND_THEMES).map((theme) => {
            const isSelected = currentBg === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => updateTheme({ background: theme.id })}
                className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between h-32 group ${
                  isSelected
                    ? "border-[#635BFF] ring-2 ring-[#635BFF]/30 shadow-lg scale-[1.02]"
                    : "border-[#27272A] hover:border-gray-500 bg-[#121214]"
                }`}
                style={{ backgroundColor: theme.canvas }}
              >
                {/* Mini Swatch Preview */}
                <div className="w-full flex items-center justify-between">
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
                    style={{
                      color: theme.ink,
                      borderColor: theme.hairline,
                      backgroundColor: theme.surface,
                    }}
                  >
                    {theme.id}
                  </span>
                  {isSelected && (
                    <span className="w-2 h-2 rounded-full bg-[#635BFF] ring-2 ring-white" />
                  )}
                </div>

                <div>
                  <h4
                    className="text-xs font-bold truncate mt-2"
                    style={{ color: theme.ink }}
                  >
                    {theme.name}
                  </h4>
                  <p
                    className="text-[10px] line-clamp-2 mt-1 leading-snug"
                    style={{ color: theme.muted }}
                  >
                    {theme.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. TYPOGRAPHY & FONT SELECTION */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>🔤</span> 2. Video Typography & Narrative Font
          </label>
          <span className="text-[11px] text-gray-500 font-mono">Google Fonts Ready</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {FONTS.map((f) => {
            const isSelected = currentFont === f.id;
            return (
              <button
                key={f.id}
                onClick={() => updateTheme({ fontFamily: f.id })}
                className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between h-28 bg-[#121214] ${
                  isSelected
                    ? "border-[#635BFF] ring-2 ring-[#635BFF]/30 shadow-lg bg-[#18181B]"
                    : "border-[#27272A] hover:border-gray-600"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div>
                    <h4 className="text-xs font-bold text-white">{f.name}</h4>
                    <span className="text-[10px] text-gray-400">{f.category}</span>
                  </div>
                  {isSelected && (
                    <span className="text-[11px] font-mono text-[#635BFF] font-bold">Active</span>
                  )}
                </div>

                <div className={`text-xs text-gray-300 mt-2 truncate ${f.style}`}>
                  "{f.preview}"
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. STORYTELLING / VIDEO EDITING STYLE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>🎬</span> 3. Storytelling & Editing Architecture
          </label>
          <span className="text-[11px] text-gray-500 font-mono">Visual Rendering Engine</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {STORY_STYLES.map((style) => {
            const isSelected = currentStoryStyle === style.id;
            return (
              <button
                key={style.id}
                onClick={() => updateTheme({ storyStyle: style.id })}
                className={`p-4 rounded-xl border text-left transition-all flex flex-col justify-between space-y-3 bg-[#121214] ${
                  isSelected
                    ? "border-[#635BFF] ring-2 ring-[#635BFF]/30 shadow-lg bg-[#151518]"
                    : "border-[#27272A] hover:border-gray-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{style.icon}</span>
                    <h4 className="text-sm font-bold text-white">{style.name}</h4>
                  </div>
                  {isSelected && (
                    <span className="text-xs font-mono text-[#635BFF] font-bold">Selected</span>
                  )}
                </div>

                <p className="text-xs text-gray-400 leading-relaxed">{style.desc}</p>

                <div className="px-2.5 py-1.5 rounded bg-black/40 border border-white/5 text-[11px] font-mono text-gray-300 flex items-center gap-2">
                  <span className="text-green-400">✓</span> {style.sample}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. SCRIPT ➔ VISUAL METAPHOR DIRECTOR (HUMAN & AI CO-PILOT) */}
      <div className="space-y-4 bg-[#121214] p-5 rounded-2xl border border-[#27272A]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#27272A] pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>✨</span> Script ➔ Visual Metaphor Director (Human & AI Co-Pilot)
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Inspect how each script sentence will be visually depicted. Customize the visual metaphor or provide your direct visual instructions.
            </p>
          </div>
          <span className="text-[11px] font-mono text-yellow-400 bg-yellow-950/60 border border-yellow-500/30 px-2 py-0.5 rounded">
            {film.shots.filter((s) => s.metaphor).length} Metaphors Assigned
          </span>
        </div>

        <div className="space-y-3">
          {film.shots.map((shot, idx) => {
            const scriptLine =
              shot.scriptText ||
              shot.blocks.find((b) => b.c === "TextReveal")?.text ||
              `Shot ${idx + 1}: ${shot.id}`;
            const activeMetaphor = shot.metaphor || "none";

            return (
              <div
                key={shot.id}
                className="p-3.5 rounded-xl bg-[#18181B] border border-[#27272A] hover:border-gray-600 transition-all flex flex-col md:flex-row gap-4 items-start md:items-center justify-between"
              >
                {/* Left: Script Sentence */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/60 text-gray-400 border border-white/10">
                      Line {idx + 1} · {shot.dur}s
                    </span>
                    <span className="text-xs font-mono text-gray-400 truncate">
                      {shot.id}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-gray-200 mt-1.5 leading-snug">
                    "{scriptLine}"
                  </p>
                </div>

                {/* Right: AI Visual Cue Selector & Human Direction */}
                <div className="flex flex-col gap-2 shrink-0 w-full md:w-auto">
                  <div className="flex items-center gap-2">
                    <select
                      value={activeMetaphor}
                      onChange={(e) =>
                        handleUpdateShotMetaphor(
                          idx,
                          e.target.value as NonNullable<Shot["metaphor"]> | "none"
                        )
                      }
                      className="bg-black/70 border border-[#333] hover:border-[#635BFF] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-[#635BFF]"
                    >
                      {METAPHOR_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.icon} {opt.label}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      placeholder="Type custom visual idea for this line..."
                      value={shot.visualDirection || ""}
                      onChange={(e) => handleUpdateShotVisualDirection(idx, e.target.value)}
                      className="bg-black/50 border border-[#27272A] focus:border-yellow-400 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 w-full sm:w-80 font-mono focus:outline-none"
                      title="Provide your custom visual direction for this specific line"
                    />
                  </div>

                  {idx === 0 && !shot.visualDirection && (
                    <button
                      onClick={() =>
                        handleUpdateShotVisualDirection(
                          idx,
                          "Make a computer or character that reads the script once while sleeping, opens its eyes, and throws it out of the window."
                        )
                      }
                      className="text-[11px] text-left text-yellow-400/90 hover:text-yellow-300 flex items-center gap-1 font-mono transition-colors"
                    >
                      <span>💡</span> Quick Apply: "Computer reads script once while sleeping & throws it out window"
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. DYNAMIC 3D CAMERA ANGLES & PERSPECTIVES */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>🎥</span> 5. Dynamic 3D Camera Angles & Perspectives
          </label>
          <span className="text-[11px] text-gray-500 font-mono">Real-Time 3D Spatial Framing</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {CAMERA_ANGLES.map((ca) => {
            const isSelected = currentCameraAngle === ca.id;
            return (
              <button
                key={ca.id}
                onClick={() => updateTheme({ cameraAngle: ca.id })}
                className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between h-28 bg-[#121214] ${
                  isSelected
                    ? "border-[#635BFF] ring-2 ring-[#635BFF]/30 shadow-lg bg-[#18181B]"
                    : "border-[#27272A] hover:border-gray-600"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{ca.icon}</span>
                    <h4 className="text-xs font-bold text-white">{ca.name}</h4>
                  </div>
                  {isSelected && (
                    <span className="text-[10px] font-mono text-[#635BFF] font-bold">Active</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 leading-snug mt-1">{ca.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 6. VIDEO TYPE & INTENT */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>🎯</span> 6. Video Category & Output Intent
          </label>
          <span className="text-[11px] text-gray-500 font-mono">Pacing & Structure Optimizer</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {VIDEO_TYPES.map((vt) => {
            const isSelected = currentVideoType === vt.id;
            return (
              <button
                key={vt.id}
                onClick={() => updateTheme({ videoType: vt.id })}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between h-28 bg-[#121214] ${
                  isSelected
                    ? "border-[#635BFF] ring-2 ring-[#635BFF]/30 bg-[#18181B]"
                    : "border-[#27272A] hover:border-gray-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{vt.icon}</span>
                  <h4 className="text-xs font-bold text-white">{vt.name}</h4>
                </div>
                <p className="text-[10px] text-gray-400 leading-tight mt-1">{vt.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 6. ACCENT COLOR PALETTE */}
      <div className="space-y-3">
        <label className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
          <span>🎨</span> 6. Studio Accent Color
        </label>
        <div className="flex flex-wrap gap-3">
          {ACCENT_COLORS.map((a) => (
            <button
              key={a.hex}
              onClick={() => {
                onAccentChange(a.hex);
                updateTheme({ accent: a.hex });
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                accent === a.hex
                  ? "border-white bg-[#18181B] text-white ring-2 ring-white/20"
                  : "border-[#333] bg-[#121214] text-gray-400 hover:text-white"
              }`}
            >
              <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: a.hex }} />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
