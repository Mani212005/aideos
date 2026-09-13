// File Description: Customization and Theme Studio Editor for selecting paper textures, typography fonts, video types, storytelling styles, accent colors, saving themes, and directing script-to-visual metaphors.

import React, { useState } from "react";
import {
  Palette,
  Save,
  Bell,
  ScrollText,
  Type,
  Film as FilmIcon,
  Check,
  Sparkles,
  Lightbulb,
  Video,
  Target,
  GraduationCap,
  Zap,
  Building2,
  Wrench,
  Compass,
  Box,
  Maximize2,
  Orbit,
  Map,
  Loader2,
} from "lucide-react";
import type {
  Film,
  BackgroundPreset,
  FontPreset,
  VideoType,
  StoryStyle,
  CameraAngle,
  Shot,
} from "../../../src/dl/schema";
import { BACKGROUND_THEMES } from "../../../src/dl/tokens";

export interface CustomizationEditorProps {
  film: Film;
  onUpdateFilm: (updated: Film) => void;
  accent: string;
  onAccentChange: (color: string) => void;
  onSave?: () => Promise<void> | void;
}

const FONTS: Array<{
  id: FontPreset;
  name: string;
  category: string;
  preview: string;
  style: string;
}> = [
  {
    id: "geist",
    name: "Geist Sans",
    category: "Modern Editorial",
    preview: "The attention network connects tokens across the canvas.",
    style: "font-sans font-medium",
  },
  {
    id: "mono",
    name: "JetBrains Mono",
    category: "Technical & Code",
    preview: "kv_cache.shape = [batch, seq_len, num_heads, head_dim]",
    style: "font-mono",
  },
  {
    id: "serif",
    name: "Source Serif 4",
    category: "Academic & Mathematical",
    preview: "Attention(Q, K, V) = softmax(QKᵀ / √dₖ) V",
    style: "italic font-serif",
  },
  {
    id: "space-grotesk",
    name: "Space Grotesk",
    category: "Expressive Modernist",
    preview: "Scale compute linearly across distributed clusters.",
    style: "font-sans font-extrabold tracking-[-0.02em]",
  },
  {
    id: "inter",
    name: "Inter",
    category: "Clean Functional UI",
    preview: "Optimized memory throughput and zero-copy buffers.",
    style: "font-sans",
  },
];

const VIDEO_TYPES: Array<{
  id: VideoType;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}> = [
  {
    id: "educational",
    name: "Educational",
    icon: GraduationCap,
    desc: "Layered concept breakdown with visual hierarchy and deliberate pacing.",
  },
  {
    id: "fact",
    name: "60s Quick Fact",
    icon: Zap,
    desc: "High-energy micro-lesson with kinetic motion and rapid payoff zooms.",
  },
  {
    id: "case-study",
    name: "Architecture Case Study",
    icon: Building2,
    desc: "Engineering topologies, benchmark graphs, and data flows.",
  },
  {
    id: "tutorial",
    name: "Step-by-Step Tutorial",
    icon: Wrench,
    desc: "Walkthrough with code blocks and parameter inspects.",
  },
];

const STORY_STYLES: Array<{
  id: StoryStyle;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  sample: string;
}> = [
  {
    id: "spatial-map",
    name: "Spatial Mind-Map",
    icon: Compass,
    desc: "Concepts are connected nodes in a continuous 2D spatial canvas. The camera smoothly zooms into nodes to reveal animated stages.",
    sample: "Continuous camera navigation · Reversible zoom frames",
  },
  {
    id: "script-metaphor",
    name: "Visual Metaphors",
    icon: Sparkles,
    desc: "Visual animations are generated directly from the narration script cues.",
    sample: "Spider Web Weaving · Fluid Reservoirs · Physical Balance Scales",
  },
];

const METAPHOR_OPTIONS: Array<{
  id: NonNullable<Shot["metaphor"]> | "none" | "character-beat" | "b-roll";
  label: string;
}> = [
  { id: "none", label: "Default Spatial Node" },
  { id: "character-beat", label: "Character Rig (Astronaut / Developer)" },
  { id: "character-throw", label: "Reading & Discarding Script" },
  { id: "b-roll", label: "B-Roll Scene (AI Generated)" },
  { id: "spider-web", label: "Spider Web Weaving" },
  { id: "liquid-bucket", label: "Liquid Buffer Reservoir" },
  { id: "balance-scale", label: "Balance Scale Equilibrium" },
  { id: "clock-gears", label: "Escapement Clock Gears" },
  { id: "rocket-launch", label: "Scale & Throughput Rocket" },
];

const CAMERA_ANGLES: Array<{
  id: CameraAngle;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}> = [
  {
    id: "flat",
    name: "2D Direct Orthogonal",
    icon: Box,
    desc: "Classic flat direct face-on view with maximum geometric clarity.",
  },
  {
    id: "isometric",
    name: "3D Isometric Technical",
    icon: Box,
    desc: "26° technical CAD perspective with dimensional floating depth.",
  },
  {
    id: "cinematic-tilt",
    name: "Cinematic Dutch Tilt",
    icon: Video,
    desc: "Subtle rolling pitch angle for high-production dynamic feel.",
  },
  {
    id: "low-angle",
    name: "Dramatic Low-Angle Hero",
    icon: Maximize2,
    desc: "Looking upward at system topology from below.",
  },
  {
    id: "orbit",
    name: "Continuous 3D Orbit",
    icon: Orbit,
    desc: "Gyroscopic floating orbit with continuous camera movement.",
  },
  {
    id: "top-down",
    name: "Overhead Blueprint",
    icon: Map,
    desc: "Architectural top-down master blueprint inspect.",
  },
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
        accent: accent === "#635BFF" ? film.theme?.accent || undefined : accent,
        theme: {
          ...(film.theme || {}),
          background: currentBg,
          fontFamily: currentFont,
          videoType: currentVideoType,
          storyStyle: currentStoryStyle,
          cameraAngle: currentCameraAngle,
          accent:
            accent === "#635BFF" ? film.theme?.accent || undefined : accent,
        },
      };

      const res = await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film: filmToSave }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error || `HTTP ${res.status}: Failed to save film theme to disk`,
        );
      }
      setSaveToast(`Saved theme & visual directions to ${film.id}.ts`);
      setTimeout(() => setSaveToast(null), 4000);
    } catch (err: any) {
      setSaveToast(err.message || "Failed to save");
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
      const filteredBlocks = shot.blocks.filter(
        (b) => b.c !== "CharacterBeat" && b.c !== "MetaphorViewer",
      );
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
      const filteredBlocks = shot.blocks.filter((b) => b.c !== "CharacterBeat");
      updatedShots[shotIdx] = {
        ...shot,
        metaphor: undefined,
        needsFootage: true,
        blocks: filteredBlocks,
      };
    } else if (metaphor === "none") {
      const filteredBlocks = shot.blocks.filter((b) => b.c !== "CharacterBeat");
      updatedShots[shotIdx] = {
        ...shot,
        metaphor: undefined,
        needsFootage: false,
        blocks:
          filteredBlocks.length > 0
            ? filteredBlocks
            : [{ c: "Body", text: shot.scriptText || "Scene narrative" }],
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
    if (
      lower.includes("computer") ||
      lower.includes("character") ||
      lower.includes("sleep") ||
      lower.includes("throw") ||
      lower.includes("window")
    ) {
      autoMetaphor = "character-throw";
    } else if (lower.includes("spider") || lower.includes("web")) {
      autoMetaphor = "spider-web";
    } else if (
      lower.includes("liquid") ||
      lower.includes("bucket") ||
      lower.includes("reservoir")
    ) {
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
    <div className="w-full h-full bg-paper text-ink overflow-y-auto p-6 space-y-8 relative">
      {/* Sticky Header with Save Button */}
      <div className="sticky top-0 z-30 bg-paper/95 border-b-2 border-ink pb-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-ink">
            <Palette className="w-5 h-5 text-select-text" /> Customization Studio
          </h2>
          <p className="text-xs text-ink-soft mt-1">
            Theme, typography, storytelling style, and visual directions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Current Theme Summary Pill */}
          <div className="hidden lg:flex items-center gap-2 bg-paper-3 border-2 border-ink px-3 py-1.5 text-xs font-mono text-ink shadow-nb-sm">
            <span
              className="w-2.5 h-2.5 "
              style={{ backgroundColor: accent }}
            />
            <span>{BACKGROUND_THEMES[currentBg]?.name}</span>
            <span className="text-ink-soft">/</span>
            <span>{currentFont}</span>
            <span className="text-ink-soft">/</span>
            <span className="text-select-text">{currentStoryStyle}</span>
          </div>

          {/* Explicit Save Button */}
          <button
            onClick={handleSaveTheme}
            disabled={isSaving}
            className={`px-4 py-2 font-bold text-xs flex items-center gap-1.5 shadow-nb-sm transition-all ${
              isSaving
                ? "bg-sunken text-ink-soft cursor-not-allowed"
                : "bg-paper-3 hover:bg-paper-3 text-ink hover:scale-105"
            }`}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{isSaving ? "Saving..." : "Save Theme"}</span>
          </button>
        </div>
      </div>

      {/* Save Toast Feedback */}
      {saveToast && (
        <div className="p-3 bg-success/25 border-2 border-ink text-ink text-xs font-mono flex items-center gap-2 shadow-nb-sm animate-fade-in">
          <Bell className="w-3.5 h-3.5 text-ink" /> {saveToast}
        </div>
      )}

      {/* 1. PAPER BACKGROUND & TEXTURE LIBRARY */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <ScrollText className="w-3.5 h-3.5 text-ink-soft" /> 1. Paper
            Library & Background
          </label>
          <span className="text-[11px] text-ink-soft font-mono">
            6 Textures
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.values(BACKGROUND_THEMES).map((theme) => {
            const isSelected = currentBg === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => updateTheme({ background: theme.id })}
                className={`flex h-32 flex-col overflow-hidden border-2 border-ink bg-paper-3 text-left shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${
                  isSelected ? "outline outline-3 outline-offset-0 outline-select" : ""
                }`}
                title={`${theme.name}: ${theme.description}`}
              >
                {/* The swatch is painted in the video theme's own colours so the user sees what
                    they are choosing; the description below is editor copy in editor ink. */}
                <div
                  className="flex h-14 shrink-0 items-start justify-between border-b-2 border-ink p-2"
                  style={{ backgroundColor: theme.canvas }}
                >
                  <span
                    className="border px-1.5 py-0.5 font-mono text-[10px] font-bold"
                    style={{ color: theme.ink, borderColor: theme.hairline, backgroundColor: theme.surface }}
                  >
                    {theme.id}
                  </span>
                  {isSelected ? <span className="h-3 w-3 border-2 border-ink bg-select" /> : null}
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-0.5 p-2">
                  <h4 className="truncate font-sans text-[11px] font-extrabold text-ink">{theme.name}</h4>
                  <p className="nb-clamp-2 font-sans text-[10px] leading-snug text-ink-soft">{theme.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. TYPOGRAPHY & FONT SELECTION */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-ink-soft" /> 2. Typography & Font
          </label>
          <span className="text-[11px] text-ink-soft font-mono">
            Google Fonts
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {FONTS.map((f) => {
            const isSelected = currentFont === f.id;
            return (
              <button
                key={f.id}
                onClick={() => updateTheme({ fontFamily: f.id })}
                className={`p-3.5 border-2 border-ink text-left transition-all flex flex-col justify-between h-28 bg-paper-3 ${
                  isSelected
                    ? "border-select ring-2 ring-select/30 shadow-nb-sm bg-paper-3"
                    : "border-2 border-ink hover:border-ink"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div>
                    <h4 className="text-xs font-bold text-ink">{f.name}</h4>
                    <span className="text-[10px] text-ink-soft">
                      {f.category}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="text-[11px] font-mono text-select-text font-bold">
                      Active
                    </span>
                  )}
                </div>

                <div className={`text-xs text-ink mt-2 truncate ${f.style}`}>
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
          <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <FilmIcon className="w-3.5 h-3.5 text-ink-soft" /> 3. Storytelling
            Style
          </label>
          <span className="text-[11px] text-ink-soft font-mono">
            Visual Engine
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {STORY_STYLES.map((style) => {
            const isSelected = currentStoryStyle === style.id;
            return (
              <button
                key={style.id}
                onClick={() => updateTheme({ storyStyle: style.id })}
                className={`p-4 border-2 border-ink text-left transition-all flex flex-col justify-between space-y-3 bg-paper-3 ${
                  isSelected
                    ? "border-select ring-2 ring-select/30 shadow-nb-sm bg-paper-3"
                    : "border-2 border-ink hover:border-ink"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <style.icon className="w-4 h-4 text-select-text" />
                    <h4 className="text-sm font-bold text-ink">{style.name}</h4>
                  </div>
                  {isSelected && (
                    <span className="text-xs font-mono text-select-text font-bold">
                      Selected
                    </span>
                  )}
                </div>

                <p className="text-xs text-ink-soft leading-relaxed">
                  {style.desc}
                </p>

                <div className="px-2.5 py-1.5 bg-sunken border-2 border-ink text-[11px] font-mono text-ink flex items-center gap-2 shadow-nb-sm">
                  <Check className="w-3 h-3 text-ink shrink-0" /> {style.sample}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. SCRIPT METAPHOR DIRECTOR */}
      <div className="space-y-4 bg-paper-3 p-5 border-2 border-ink shadow-nb-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b-2 border-ink pb-3">
          <div>
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-select-text" /> Script Metaphor
              Director
            </h3>
            <p className="text-xs text-ink-soft mt-0.5">
              Configure visual metaphors and direction for each script line.
            </p>
          </div>
          <span className="text-[11px] font-mono text-ink bg-primary/25 border-2 border-ink/30 px-2 py-0.5  shadow-nb-sm">
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
                className="p-3.5 bg-paper-3 border-2 border-ink hover:border-ink transition-all flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
              >
                {/* Left: Script Sentence */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-sunken text-ink-soft border-2 border-ink shadow-nb-sm">
                      Line {idx + 1} · {shot.dur}s
                    </span>
                    <span className="text-xs font-mono text-ink-soft truncate">
                      {shot.id}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-ink mt-1.5 leading-snug">
                    "{scriptLine}"
                  </p>
                </div>

                {/* Right: Visual Cue Selector & Direction */}
                <div className="flex flex-col gap-2 shrink-0 w-full md:w-auto">
                  <div className="flex items-center gap-2">
                    <select
                      value={activeMetaphor}
                      onChange={(e) =>
                        handleUpdateShotMetaphor(
                          idx,
                          e.target.value as
                            | NonNullable<Shot["metaphor"]>
                            | "none",
                        )
                      }
                      className="bg-sunken border-2 border-ink hover:border-select px-2.5 py-1.5 text-xs text-ink font-mono focus:outline-none focus:ring-1 focus:ring-select shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                    >
                      {METAPHOR_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      placeholder="Custom visual idea..."
                      value={shot.visualDirection || ""}
                      onChange={(e) =>
                        handleUpdateShotVisualDirection(idx, e.target.value)
                      }
                      className="bg-sunken border-2 border-ink focus:border-2 border-ink px-2.5 py-1.5 text-xs text-ink placeholder-ink w-full sm:w-80 font-mono focus:outline-none shadow-nb-sm"
                      title="Provide custom visual direction for this line"
                    />
                  </div>

                  {idx === 0 && !shot.visualDirection && (
                    <button
                      onClick={() =>
                        handleUpdateShotVisualDirection(
                          idx,
                          "Make a computer or character that reads the script once while sleeping, opens its eyes, and throws it out of the window.",
                        )
                      }
                      className="text-[11px] text-left text-ink hover:text-ink flex items-center gap-1 font-mono transition-colors"
                    >
                      <Lightbulb className="w-3 h-3 text-ink shrink-0" />
                      <span>
                        Apply: "Computer reads script while sleeping & throws it
                        out window"
                      </span>
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
          <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <Video className="w-3.5 h-3.5 text-ink-soft" /> 5. Camera Angles &
            Perspectives
          </label>
          <span className="text-[11px] text-ink-soft font-mono">
            Spatial Framing
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {CAMERA_ANGLES.map((ca) => {
            const isSelected = currentCameraAngle === ca.id;
            return (
              <button
                key={ca.id}
                onClick={() => updateTheme({ cameraAngle: ca.id })}
                className={`p-3.5 border-2 border-ink text-left transition-all flex flex-col justify-between h-28 bg-paper-3 ${
                  isSelected
                    ? "border-select ring-2 ring-select/30 shadow-nb-sm bg-paper-3"
                    : "border-2 border-ink hover:border-ink"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <ca.icon className="w-4 h-4 text-select-text" />
                    <h4 className="text-xs font-bold text-ink">{ca.name}</h4>
                  </div>
                  {isSelected && (
                    <span className="text-[10px] font-mono text-select-text font-bold">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-soft leading-snug mt-1">
                  {ca.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 6. VIDEO TYPE & INTENT */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-ink-soft" /> 6. Video Category
          </label>
          <span className="text-[11px] text-ink-soft font-mono">
            Pacing Optimizer
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {VIDEO_TYPES.map((vt) => {
            const isSelected = currentVideoType === vt.id;
            return (
              <button
                key={vt.id}
                onClick={() => updateTheme({ videoType: vt.id })}
                className={`p-3 border-2 border-ink text-left transition-all flex flex-col justify-between h-28 bg-paper-3 ${
                  isSelected
                    ? "border-select ring-2 ring-select/30 bg-paper-3"
                    : "border-2 border-ink hover:border-ink"
                }`}
              >
                <div className="flex items-center gap-2">
                  <vt.icon className="w-4 h-4 text-select-text" />
                  <h4 className="text-xs font-bold text-ink">{vt.name}</h4>
                </div>
                <p className="text-[10px] text-ink-soft leading-tight mt-1">
                  {vt.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 7. ACCENT COLOR PALETTE */}
      <div className="space-y-3">
        <label className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-ink-soft" /> 7. Accent Color
        </label>
        <div className="flex flex-wrap gap-3">
          {ACCENT_COLORS.map((a) => (
            <button
              key={a.hex}
              onClick={() => {
                onAccentChange(a.hex);
                updateTheme({ accent: a.hex });
              }}
              className={`flex items-center gap-2 px-3 py-1.5 border text-xs font-medium transition-all ${
                accent === a.hex
                  ? "border-2 border-ink bg-paper-3 text-ink ring-2 ring-select"
                  : "border-2 border-ink bg-paper-3 text-ink-soft hover:text-ink"
              }`}
            >
              <span
                className="w-3.5 h-3.5 "
                style={{ backgroundColor: a.hex }}
              />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
