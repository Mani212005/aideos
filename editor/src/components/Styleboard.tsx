/**
 * File Description: Styleboard & Visual Keyframe Studio component providing rich scene previews,
 * SVG character animations, metaphor badges, 3D camera controls, and animated primitive specimens.
 */

import React, { useState, useMemo, useEffect, useRef } from "react";
import type {
  Film,
  Shot,
  Block,
  BackgroundPreset,
  CameraAngle,
} from "../../../src/dl/schema";
import { BACKGROUND_THEMES } from "../../../src/dl/tokens";
import { CHARACTER_RIGS } from "../../../src/dl/characters";
import { ShotModal } from "./ShotModal";
import {
  User,
  Code,
  Bot,
  FlaskConical,
  Briefcase,
  Headphones,
  BookOpen,
  Cpu,
  Square,
  Box,
  Video,
  Maximize2,
  Orbit,
  Compass,
  Film as FilmIcon,
  Sparkles,
  Type,
  Grid,
  BarChart3,
  Target,
  Check,
  RotateCw,
  Loader2,
  Save,
  Bell,
  Edit3,
  Layers,
} from "lucide-react";

interface StyleboardProps {
  film: Film;
  accent: string;
  onAccentChange: (a: string) => void;
  storyStyle?: string;
  onStoryStyleChange?: (s: string) => void;
  onSelectShot?: (id: string) => void;
  onUpdateFilm?: (film: Film) => void;
}

const RIG_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  astronaut: User,
  developer: Code,
  robot: Bot,
  scientist: FlaskConical,
  executive: Briefcase,
  "data-engineer": Headphones,
  educator: BookOpen,
  mascot: Cpu,
};

const ACCENTS = [
  { name: "Electric Indigo", hex: "#635BFF" },
  { name: "Terracotta Orange", hex: "#FF6B00" },
  { name: "Rose Neon", hex: "#F43F5E" },
  { name: "Emerald Flow", hex: "#10B981" },
  { name: "Amber Radiant", hex: "#F59E0B" },
  { name: "Cyber Cyan", hex: "#00D2D3" },
  { name: "Violet Deep", hex: "#8B5CF6" },
];

const CAMERA_ANGLES: Array<{
  id: CameraAngle;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "flat", name: "Flat 2D", icon: Square },
  { id: "isometric", name: "Isometric 3D", icon: Box },
  { id: "cinematic-tilt", name: "Cinematic Tilt", icon: Video },
  { id: "low-angle", name: "Hero Low-Angle", icon: Maximize2 },
  { id: "orbit", name: "Dynamic Orbit", icon: Orbit },
  { id: "top-down", name: "Overhead Blueprint", icon: Compass },
];

/**
 * Calculates a padded bounding box containing all nodes in canvas space.
 */
function getMapBounds(film: Film) {
  const { nodes } = film.canvas;
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.w));
  const maxY = Math.max(...nodes.map((node) => node.y + node.h));
  const padding = 80;
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * Derives a prominent visual metaphor label and Lucide icon from a shot.
 */
function getMetaphorInfo(shot: Shot) {
  // Check if shot has a CharacterBeat
  const charBlock = shot.blocks.find((b) => b.c === "CharacterBeat") as any;
  if (charBlock) {
    const charName =
      charBlock.characterId === "developer" ? "Tech Architect" : "Astro Guide";
    return { label: `Character: ${charName}`, icon: User, color: "#635BFF" };
  }

  if (shot.needsFootage) {
    return { label: "GPU B-Roll Scene", icon: FilmIcon, color: "#F59E0B" };
  }

  if (shot.metaphor) {
    if (
      shot.metaphor.includes("throw") ||
      shot.metaphor.includes("character")
    ) {
      return { label: "Character Metaphor", icon: Bot, color: "#F43F5E" };
    }
    if (shot.metaphor.includes("matrix") || shot.metaphor.includes("grid")) {
      return { label: "Memory Matrix", icon: Grid, color: "#635BFF" };
    }
    return { label: shot.metaphor, icon: Sparkles, color: "#10B981" };
  }

  // Infer from standard blocks
  const hasTokenStrip = shot.blocks.some((b) => b.c === "TokenStrip");
  if (hasTokenStrip)
    return { label: "Token Sequence", icon: Type, color: "#F59E0B" };

  const hasMatrix = shot.blocks.some((b) => b.c === "MatrixGrid");
  if (hasMatrix) return { label: "Memory Grid", icon: Grid, color: "#635BFF" };

  const hasStat = shot.blocks.some((b) => b.c === "StatCounter");
  if (hasStat)
    return { label: "Metric Card", icon: BarChart3, color: "#10B981" };

  return { label: "Spatial Node", icon: Target, color: "#8A8A8E" };
}

/**
 * Renders an interactive simulated preview of a single block primitive inside the keyframe card.
 */
function renderBlockPreview(block: Block, accent: string) {
  switch (block.c) {
    case "CharacterBeat":
      const charBlock = block as any;
      const rig =
        CHARACTER_RIGS[charBlock.characterId as keyof typeof CHARACTER_RIGS] ||
        CHARACTER_RIGS.astronaut;
      const poseKeyframes = charBlock.keyframes || [{ t: 0, pose: "neutral" }];
      const RigIcon = RIG_ICONS[charBlock.characterId] || User;
      return (
        <div className="bg-paper-3 p-3 border border-select/40 flex items-center justify-between shadow-nb-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-select/20 border border-select/50 flex items-center justify-center text-select-text">
              <RigIcon size={20} />
            </div>
            <div>
              <div className="text-xs font-bold text-ink flex items-center gap-1.5">
                <span>{rig.name}</span>
                <span className="badge badge-xs badge-primary font-mono">
                  {charBlock.stage || "frame"}
                </span>
              </div>
              <div className="text-[10px] text-ink-soft font-mono mt-0.5">
                Pose:{" "}
                <span className="text-select-text font-bold">
                  {poseKeyframes[0]?.pose || "neutral"}
                </span>{" "}
                ({poseKeyframes.length} keyframes)
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono text-ink bg-success/25 border-2 border-ink/30 px-2 py-0.5  shadow-nb-sm">
            60 FPS SVG
          </span>
        </div>
      );

    case "TextReveal":
      return (
        <div className="py-1">
          <div
            className={`font-bold text-ink tracking-tight ${block.size === "display" ? "text-base" : "text-sm"}`}
          >
            {block.text}
          </div>
          {block.accentWord && (
            <div
              className="text-[11px] font-mono mt-0.5"
              style={{ color: accent }}
            >
              Key Accent:{" "}
              <span className="underline decoration-2">{block.accentWord}</span>
            </div>
          )}
        </div>
      );

    case "Body":
      return (
        <p className="text-xs text-ink-soft leading-relaxed line-clamp-2">
          {block.text}
        </p>
      );

    case "Kicker":
      return (
        <span className="text-[10px] font-mono uppercase tracking-widest text-ink-soft bg-paper-3 px-2 py-0.5 border-2 border-ink shadow-nb-sm">
          {block.text}
        </span>
      );

    case "StatCounter":
      return (
        <div className="flex items-baseline gap-2 bg-paper-3 p-2.5 border-2 border-ink shadow-nb-sm">
          <span
            className="text-xl font-bold font-mono"
            style={{ color: accent }}
          >
            {block.to}
            {block.suffix || ""}
          </span>
          <span className="text-xs text-ink-soft uppercase tracking-wider">
            {block.label}
          </span>
        </div>
      );

    case "TokenStrip":
      return (
        <div className="flex flex-wrap gap-1 bg-paper-3 p-2 border-2 border-ink shadow-nb-sm">
          {block.tokens.slice(0, 6).map((tok, i) => (
            <span
              key={i}
              className="text-[10px] font-mono px-1.5 py-0.5 border"
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
            <span className="text-[10px] text-ink-soft font-mono self-center">
              +{block.tokens.length - 6} more
            </span>
          )}
        </div>
      );

    case "MatrixGrid":
      return (
        <div className="bg-paper-3 p-2 border-2 border-ink flex items-center justify-between shadow-nb-sm">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((cell) => (
              <div
                key={cell}
                className="w-4 h-4 border flex items-center justify-center text-[9px] font-mono"
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
          <span className="text-[10px] text-ink-soft font-mono">
            KV Cache Cells
          </span>
        </div>
      );

    case "ProgressBar":
      return (
        <div className="w-full bg-paper-3 p-2 border-2 border-ink flex flex-col gap-1 shadow-nb-sm">
          <div className="flex justify-between text-[10px] text-ink-soft">
            <span>{block.label || "Progress"}</span>
            <span className="font-mono">{Math.round(block.value * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-sunken overflow-hidden">
            <div
              className="h-full "
              style={{
                width: `${block.value * 100}%`,
                backgroundColor: accent,
              }}
            />
          </div>
        </div>
      );

    default:
      return (
        <div className="text-[11px] font-mono text-ink-soft bg-paper-3 px-2 py-1 border-2 border-ink shadow-nb-sm">
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
  onUpdateFilm,
}: StyleboardProps) {
  const [activeTab, setActiveTab] = useState<
    "storyboard" | "primitives" | "spatial"
  >("storyboard");
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [editingShotIdx, setEditingShotIdx] = useState<number | null>(null);

  // B-Roll GPU job tracking state
  const [brollJobStatus, setBrollJobStatus] = useState<
    Record<
      string,
      { state: string; progress?: number; footageSrc?: string; error?: string }
    >
  >({});
  const [existingFootage, setExistingFootage] = useState<
    Record<string, string>
  >({});
  const [isTriggeringBroll, setIsTriggeringBroll] = useState<
    Record<string, boolean>
  >({});

  // Keep the latest onUpdateFilm callback available to the polling effect without resetting its interval on every parent render
  const onUpdateFilmRef = useRef(onUpdateFilm);
  useEffect(() => {
    onUpdateFilmRef.current = onUpdateFilm;
  }, [onUpdateFilm]);

  // Poll B-roll status on mount and periodically while in Styleboard
  useEffect(() => {
    let timer: any;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/broll/status?filmId=${film.id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.existingFootage) {
            setExistingFootage(data.existingFootage);
            let hasNewWiring = false;
            const updatedShots = film.shots.map((s) => {
              const src = data.existingFootage[s.id];
              if (s.needsFootage && src) {
                const hasInset = s.blocks.some(
                  (b) => b.c === "AnalogyInset" && (b as any).src === src,
                );
                if (!hasInset) {
                  hasNewWiring = true;
                  const filtered = s.blocks.filter(
                    (b) => b.c !== "CharacterBeat" && b.c !== "AnalogyInset",
                  );
                  return {
                    ...s,
                    blocks: [
                      {
                        c: "AnalogyInset",
                        caption: (
                          s.visualDirection ||
                          s.scriptText ||
                          "GPU B-Roll"
                        ).slice(0, 60),
                        src,
                        fullScreenHero: true,
                      } as Block,
                      ...filtered,
                    ],
                  };
                }
              }
              return s;
            });
            if (hasNewWiring && onUpdateFilmRef.current) {
              onUpdateFilmRef.current({ ...film, shots: updatedShots });
            }
          }
          if (data.jobs && Array.isArray(data.jobs)) {
            const map: Record<string, any> = {};
            data.jobs.forEach((j: any) => {
              map[j.shotId] = j;
            });
            setBrollJobStatus(map);
          }
        }
      } catch (_) {}
    };

    fetchStatus();
    timer = setInterval(fetchStatus, 4000);
    return () => clearInterval(timer);
  }, [film]);

  const handleTriggerBroll = async (
    shotId: string,
    currentFilmState?: Film,
  ) => {
    const targetFilm = currentFilmState || film;
    const shot = targetFilm.shots.find((s) => s.id === shotId);
    if (!shot) return;
    setIsTriggeringBroll((prev) => ({ ...prev, [shotId]: true }));
    try {
      const res = await fetch("/api/broll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filmId: targetFilm.id,
          shotId: shot.id,
          prompt: shot.visualDirection || shot.scriptText,
          film: targetFilm,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveToast(`Started GPU video generation for ${shotId} on NVIDIA L4`);
        setTimeout(() => setSaveToast(null), 5000);
      } else {
        alert(`B-Roll generation error: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Network error: ${e?.message || e}`);
    } finally {
      setIsTriggeringBroll((prev) => ({ ...prev, [shotId]: false }));
    }
  };

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
        accent: accent === "#635BFF" ? film.theme?.accent || undefined : accent,
        theme: {
          ...(film.theme || {}),
          background: currentBg,
          cameraAngle: currentCamera,
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
          data.error || `HTTP ${res.status}: Failed to save film`,
        );
      }

      setSaveToast(`Saved Storyboard & Themes to ${film.id}.ts`);
      setTimeout(() => setSaveToast(null), 4000);
    } catch (err: any) {
      setSaveToast("Error: " + (err.message || "Failed to save"));
      setTimeout(() => setSaveToast(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Toggles or changes a shot's visual mode (Standard, SVG Character, or B-Roll).
   */
  const handleSetShotMode = (
    shotIdx: number,
    mode: "standard" | "character" | "b-roll",
  ) => {
    if (!onUpdateFilm) return;
    const updatedShots = [...film.shots];
    const shot = updatedShots[shotIdx];
    if (!shot) return;

    if (mode === "character") {
      // Remove other device blocks and add CharacterBeat
      const filteredBlocks = shot.blocks.filter(
        (b) => b.c !== "CharacterBeat" && b.c !== "MetaphorViewer",
      );
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
      // Set needsFootage flag and attach AnalogyInset block
      const filteredBlocks = shot.blocks.filter(
        (b) => b.c !== "CharacterBeat" && b.c !== "AnalogyInset",
      );
      const footageSrc =
        existingFootage[shot.id] || `footage/${film.id}_${shot.id}.mp4`;
      const analogyBlock: Block = {
        c: "AnalogyInset",
        caption: (
          shot.visualDirection ||
          shot.scriptText ||
          "GPU B-Roll"
        ).slice(0, 60),
        src: footageSrc,
        fullScreenHero: true,
      } as any;
      const updatedShot = {
        ...shot,
        needsFootage: true,
        blocks: [analogyBlock, ...filteredBlocks],
      };
      updatedShots[shotIdx] = updatedShot;
      const updatedFilm = {
        ...film,
        shots: updatedShots,
      };
      onUpdateFilm(updatedFilm);

      // Whenever B-roll is selected, start making video immediately on GPU
      void handleTriggerBroll(shot.id, updatedFilm);
      return;
    } else {
      // Standard narrative text / devices
      const filteredBlocks = shot.blocks.filter((b) => b.c !== "CharacterBeat");
      updatedShots[shotIdx] = {
        ...shot,
        needsFootage: false,
        blocks:
          filteredBlocks.length > 0
            ? filteredBlocks
            : [{ c: "Body", text: shot.scriptText || "Scene narrative" }],
      };
    }

    onUpdateFilm({
      ...film,
      shots: updatedShots,
    });
  };

  return (
    <div className="w-full h-full bg-paper text-ink flex flex-col overflow-hidden font-sans">
      {/* TOP ART DIRECTION & PERSISTENCE HEADER */}
      <div className="bg-paper-3 border-b-2 border-ink p-4 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-nb-sm">
        {/* Brand Accent Palette */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-ink-soft font-bold uppercase tracking-wider">
            Accent Token
          </label>
          <div className="flex items-center gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                onClick={() => {
                  onAccentChange(a.hex);
                  handleThemeChange("accent", a.hex);
                }}
                className={`w-7 h-7 border-2 transition-all flex items-center justify-center ${
                  accent === a.hex
                    ? "border-2 border-ink scale-110 shadow-nb-sm shadow-white/10"
                    : "border-transparent opacity-80 hover:opacity-100"
                }`}
                style={{ backgroundColor: a.hex }}
                title={a.name}
              >
                {accent === a.hex && <Check size={12} className="text-ink" />}
              </button>
            ))}
          </div>
        </div>

        {/* 3D Camera Perspective Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-ink-soft font-bold uppercase tracking-wider">
            Camera Perspective
          </label>
          <div className="flex items-center gap-1.5 bg-paper-3 p-1 border-2 border-ink shadow-nb-sm">
            {CAMERA_ANGLES.map((cam) => {
              const CamIcon = cam.icon;
              return (
                <button
                  key={cam.id}
                  onClick={() => handleThemeChange("cameraAngle", cam.id)}
                  className={`text-xs px-2.5 py-1 font-medium flex items-center gap-1.5 transition-all ${
                    currentCamera === cam.id
                      ? "bg-select text-select-ink font-bold shadow"
                      : "text-ink-soft hover:text-ink"
                  }`}
                  title={cam.name}
                >
                  <CamIcon size={12} />
                  <span className="capitalize">{cam.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Background Canvas Selector (Connected to BACKGROUND_THEMES) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-ink-soft font-bold uppercase tracking-wider">
            Canvas Background
          </label>
          <div className="flex items-center gap-1.5 bg-paper-3 p-1 border-2 border-ink shadow-nb-sm">
            {Object.values(BACKGROUND_THEMES).map((bg) => (
              <button
                key={bg.id}
                onClick={() => handleThemeChange("background", bg.id)}
                className={`text-xs px-2.5 py-1 font-medium flex items-center gap-1 transition-all ${
                  currentBg === bg.id
                    ? "bg-select text-select-ink font-bold shadow"
                    : "text-ink-soft hover:text-ink"
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
          <div className="flex items-center gap-1 bg-paper-3 p-1 border-2 border-ink shadow-nb-sm">
            <button
              onClick={() => setActiveTab("storyboard")}
              className={`text-xs px-3 py-1.5 font-bold transition-all flex items-center gap-1.5 ${
                activeTab === "storyboard"
                  ? "bg-select text-select-ink shadow"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              <FilmIcon size={12} /> Storyboard ({film.shots.length})
            </button>
            <button
              onClick={() => setActiveTab("primitives")}
              className={`text-xs px-3 py-1.5 font-bold transition-all flex items-center gap-1.5 ${
                activeTab === "primitives"
                  ? "bg-select text-select-ink shadow"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              <Layers size={12} /> Primitives
            </button>
            <button
              onClick={() => setActiveTab("spatial")}
              className={`text-xs px-3 py-1.5 font-bold transition-all flex items-center gap-1.5 ${
                activeTab === "spatial"
                  ? "bg-select text-select-ink shadow"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              <Compass size={12} /> Topology
            </button>
          </div>

          <button
            onClick={handleSaveStoryboard}
            disabled={isSaving}
            className={`px-4 py-1.5 font-bold text-xs flex items-center gap-1.5 shadow-nb-sm transition-all ${
              isSaving
                ? "bg-sunken text-ink-soft cursor-not-allowed"
                : "bg-success hover:bg-success text-ink active:scale-95"
            }`}
          >
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            <span>{isSaving ? "Saving..." : "Save Storyboard"}</span>
          </button>
        </div>
      </div>

      {/* Save Toast Feedback */}
      {saveToast && (
        <div className="mx-6 mt-4 p-3 bg-success/25 border-2 border-ink text-ink text-xs font-mono flex items-center gap-2 shadow-nb-sm animate-fade-in">
          <Bell size={14} /> {saveToast}
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* VIEW 1: RICH KEYFRAME STORYBOARD GALLERY */}
        {activeTab === "storyboard" && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-ink tracking-tight flex items-center gap-2">
                  <FilmIcon size={16} /> Keyframe Storyboard
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  Select a card to edit the timeline, or switch visual modes.
                </p>
              </div>
              <div className="text-xs text-ink-soft font-mono">
                Duration:{" "}
                <span className="text-ink font-bold">
                  {film.shots.reduce((acc, s) => acc + s.dur, 0).toFixed(1)}s
                </span>
              </div>
            </div>

            {/* Grid of Keyframe Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {film.shots.map((shot, idx) => {
                const metaphor = getMetaphorInfo(shot);
                const hasChar = shot.blocks.some(
                  (b) => b.c === "CharacterBeat",
                );
                const hasBroll = !!shot.needsFootage;
                const activeMode = hasChar
                  ? "character"
                  : hasBroll
                    ? "b-roll"
                    : "standard";

                return (
                  <div
                    key={shot.id}
                    className="bg-paper-3 border-2 border-ink hover:border-select overflow-hidden shadow-nb-sm flex flex-col transition-all hover:scale-[1.01] shadow-nb-sm group"
                  >
                    {/* Keyframe Card Header */}
                    <div
                      onClick={() => setEditingShotIdx(idx)}
                      className="bg-paper-3 px-4 py-2.5 border-b-2 border-ink flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold bg-paper-3 text-ink px-2 py-0.5 border-2 border-ink shadow-nb-sm">
                          Shot {idx + 1}
                        </span>
                        <span className="text-xs font-mono text-ink font-bold">
                          {shot.id}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono bg-paper-3 text-ink-soft px-2 py-0.5 border-2 border-ink shadow-nb-sm">
                          {shot.dur}s
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingShotIdx(idx);
                          }}
                          className="text-[10px] font-mono font-bold px-2 py-0.5 bg-select hover:bg-select text-select-ink transition-colors flex items-center gap-1"
                        >
                          <Edit3 size={10} />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>

                    {/* Metaphor & Creative Direction Banner */}
                    <div
                      className="px-4 py-2 flex items-center justify-between text-xs font-medium border-b-2 border-ink"
                      style={{
                        backgroundColor: `${metaphor.color}15`,
                        color: metaphor.color,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <metaphor.icon size={13} />
                        <span className="font-bold">{metaphor.label}</span>
                      </div>

                      {/* 1-Click Render Mode Switcher */}
                      <div className="flex items-center gap-1 bg-sunken p-0.5 border-2 border-ink shadow-nb-sm">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetShotMode(idx, "standard");
                          }}
                          className={`text-[10px] px-2 py-0.5 font-mono transition-all ${
                            activeMode === "standard"
                              ? "bg-paper-3 text-ink font-bold"
                              : "text-ink-soft hover:text-ink"
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
                          className={`text-[10px] px-2 py-0.5 font-mono transition-all flex items-center gap-1 ${
                            activeMode === "character"
                              ? "bg-select text-select-ink font-bold"
                              : "text-ink-soft hover:text-ink"
                          }`}
                          title="SVG Character Rig Animation"
                        >
                          <User size={10} /> Character
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetShotMode(idx, "b-roll");
                          }}
                          className={`text-[10px] px-2 py-0.5 font-mono transition-all flex items-center gap-1 ${
                            activeMode === "b-roll"
                              ? "bg-warn text-ink font-bold"
                              : "text-ink-soft hover:text-ink"
                          }`}
                          title="GPU B-Roll Scene"
                        >
                          <FilmIcon size={10} /> B-Roll
                        </button>
                      </div>
                    </div>

                    {/* B-Roll GPU Generation Live Banner */}
                    {hasBroll && (
                      <div className="px-4 py-2 bg-paper-3 border-b-2 border-ink flex items-center justify-between text-xs">
                        {brollJobStatus[shot.id]?.state === "running" ||
                        brollJobStatus[shot.id]?.state === "queued" ? (
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2 text-ink font-mono">
                              <Loader2 size={12} className="animate-spin" />
                              <span>
                                GPU Generating...{" "}
                                {Math.round(
                                  (brollJobStatus[shot.id]?.progress ?? 0) *
                                    100,
                                )}
                                %
                              </span>
                            </div>
                            <span className="text-[10px] text-ink font-mono">
                              NVIDIA L4 · Wan2.1
                            </span>
                          </div>
                        ) : existingFootage[shot.id] ||
                          shot.blocks.some(
                            (b) => b.c === "AnalogyInset" && (b as any).src,
                          ) ? (
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-1.5 text-ink font-mono">
                              <Check size={12} />
                              <span className="truncate max-w-[180px]">
                                Footage Ready (
                                {existingFootage[shot.id] ||
                                  (
                                    shot.blocks.find(
                                      (b) => b.c === "AnalogyInset",
                                    ) as any
                                  )?.src}
                                )
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTriggerBroll(shot.id);
                              }}
                              disabled={isTriggeringBroll[shot.id]}
                              className="text-[10px] font-mono bg-success/20 hover:bg-success/30 text-ink px-2 py-0.5 transition-colors cursor-pointer flex items-center gap-1"
                              title="Re-render footage with Wan2.1 on GPU"
                            >
                              <RotateCw size={10} /> Regenerate
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between w-full">
                            <span className="text-ink-soft font-mono flex items-center gap-1.5">
                              <FilmIcon size={11} /> Footage Pending
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTriggerBroll(shot.id);
                              }}
                              disabled={isTriggeringBroll[shot.id]}
                              className="text-[10px] font-mono font-bold bg-warn hover:bg-warn text-ink px-2.5 py-0.5 transition-all shadow cursor-pointer"
                              title="Generate photoreal diffusion video with Wan2.1 on remote GPU"
                            >
                              {isTriggeringBroll[shot.id]
                                ? "Connecting..."
                                : "Generate Video"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Simulated Remotion Visual Frame */}
                    <div
                      onClick={() => setEditingShotIdx(idx)}
                      className="p-4 bg-paper flex-1 flex flex-col gap-3 min-h-[160px] relative cursor-pointer"
                    >
                      {/* Background texture preview */}
                      <div
                        className="absolute inset-0 opacity-15 pointer-events-none"
                        style={{
                          backgroundColor:
                            BACKGROUND_THEMES[currentBg]?.canvas || "#0A0A0B",
                        }}
                      />

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
                        <div className="mt-auto pt-2 border-t-2 border-ink text-[11px] italic text-ink-soft line-clamp-2">
                          "{shot.scriptText}"
                        </div>
                      )}
                    </div>

                    {/* Card Footer: Camera & Spatial Anchoring */}
                    <div className="bg-paper-3 px-4 py-2 border-t-2 border-ink flex items-center justify-between text-[11px] text-ink-soft">
                      <div className="flex items-center gap-1.5">
                        <span>Look:</span>
                        <span className="font-mono text-ink">
                          {Array.isArray(shot.look)
                            ? shot.look.join(" -> ")
                            : shot.look}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono">
                        <span>Move:</span>
                        <span className="text-ink capitalize">
                          {shot.move} ({shot.zoom || 1}x)
                        </span>
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
              <h3 className="text-base font-bold text-ink tracking-tight flex items-center gap-2">
                <Layers size={16} /> Primitives Specimen
              </h3>
              <p className="text-xs text-ink-soft mt-0.5">
                Scene construction primitives.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Primitive 0: CharacterBeat */}
              <div className="bg-paper-3 border border-select/40 p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="text-xs font-mono font-bold text-ink">
                    00 · CharacterBeat
                  </span>
                  <span className="badge badge-xs badge-primary font-mono">
                    SVG Rig
                  </span>
                </div>
                <div className="p-3 bg-paper border-2 border-ink flex items-center gap-3 shadow-nb-sm">
                  <div className="w-8 h-8 bg-select/20 border border-select/40 flex items-center justify-center text-select-text">
                    <User size={18} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-ink">
                      Astro Guide / Tech Architect
                    </div>
                    <div className="text-[10px] text-ink-soft">
                      8 Presets · Kinematics
                    </div>
                  </div>
                </div>
              </div>

              {/* Primitive 1: TextReveal */}
              <div className="bg-paper-3 border-2 border-ink p-5 flex flex-col gap-3 shadow-nb-sm">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="text-xs font-mono font-bold text-ink">
                    01 · TextReveal
                  </span>
                  <span className="text-[10px] text-ink-soft font-mono">
                    Display & Subhead
                  </span>
                </div>
                <div className="p-3 bg-paper border-2 border-ink shadow-nb-sm">
                  <h4 className="text-base font-bold text-ink leading-snug">
                    A model never re-reads your{" "}
                    <span
                      style={{ color: accent }}
                      className="underline decoration-2"
                    >
                      prompt
                    </span>
                    .
                  </h4>
                  <p className="text-xs text-ink-soft mt-2">
                    Kinetic word-by-word reveal with cubic-bezier easing and
                    landing underline.
                  </p>
                </div>
              </div>

              {/* Primitive 2: StatCounter */}
              <div className="bg-paper-3 border-2 border-ink p-5 flex flex-col gap-3 shadow-nb-sm">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="text-xs font-mono font-bold text-ink">
                    02 · StatCounter
                  </span>
                  <span className="text-[10px] text-ink-soft font-mono">
                    Animated Numbers
                  </span>
                </div>
                <div className="p-3 bg-paper border-2 border-ink flex items-center gap-3 shadow-nb-sm">
                  <span
                    className="text-3xl font-mono font-extrabold"
                    style={{ color: accent }}
                  >
                    10x
                  </span>
                  <div className="text-xs">
                    <div className="text-ink font-bold">Throughput Gain</div>
                    <div className="text-[10px] text-ink-soft">
                      High-impact metric card
                    </div>
                  </div>
                </div>
              </div>

              {/* Primitive 3: MatrixGrid */}
              <div className="bg-paper-3 border-2 border-ink p-5 flex flex-col gap-3 shadow-nb-sm">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="text-xs font-mono font-bold text-ink">
                    03 · MatrixGrid
                  </span>
                  <span className="text-[10px] text-ink-soft font-mono">
                    Memory Allocation
                  </span>
                </div>
                <div className="p-3 bg-paper border-2 border-ink flex flex-col gap-2 shadow-nb-sm">
                  <div className="grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
                      <div
                        key={c}
                        className="h-6 border flex items-center justify-center text-[10px] font-mono"
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
              <div className="bg-paper-3 border-2 border-ink p-5 flex flex-col gap-3 shadow-nb-sm">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="text-xs font-mono font-bold text-ink">
                    04 · TokenStrip
                  </span>
                  <span className="text-[10px] text-ink-soft font-mono">
                    Sequence IDs
                  </span>
                </div>
                <div className="p-3 bg-paper border-2 border-ink flex flex-wrap gap-1.5 shadow-nb-sm">
                  {["Write", "a", "prompt", "about", "caching"].map(
                    (t, idx) => (
                      <span
                        key={idx}
                        className="text-xs font-mono px-2 py-1 border"
                        style={{
                          borderColor: idx === 2 ? accent : "#333",
                          backgroundColor:
                            idx === 2 ? `${accent}30` : "#16161E",
                          color: idx === 2 ? "white" : "#8A8A8E",
                        }}
                      >
                        {t}
                      </span>
                    ),
                  )}
                </div>
              </div>

              {/* Primitive 5: ProgressBar */}
              <div className="bg-paper-3 border-2 border-ink p-5 flex flex-col gap-3 shadow-nb-sm">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="text-xs font-mono font-bold text-ink">
                    05 · ProgressBar
                  </span>
                  <span className="text-[10px] text-ink-soft font-mono">
                    Chapter Timeline
                  </span>
                </div>
                <div className="p-3 bg-paper border-2 border-ink flex flex-col gap-2 shadow-nb-sm">
                  <div className="flex justify-between text-xs text-ink-soft">
                    <span>Chapter 2: Decode Phase</span>
                    <span className="font-mono text-ink">65%</span>
                  </div>
                  <div className="w-full h-2 bg-sunken overflow-hidden">
                    <div
                      className="h-full "
                      style={{ width: "65%", backgroundColor: accent }}
                    />
                  </div>
                </div>
              </div>

              {/* Primitive 6: CodeBlock */}
              <div className="bg-paper-3 border-2 border-ink p-5 flex flex-col gap-3 shadow-nb-sm">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="text-xs font-mono font-bold text-ink">
                    06 · CodeBlock
                  </span>
                  <span className="text-[10px] text-ink-soft font-mono">
                    JetBrains Mono
                  </span>
                </div>
                <div className="p-3 bg-paper border-2 border-ink font-mono text-[11px] leading-relaxed text-ink shadow-nb-sm">
                  <div>
                    <span className="text-ink">const</span> kvCache ={" "}
                    <span className="text-ink">new</span> Map();
                  </div>
                  <div>
                    kvCache.<span className="text-ink">set</span>(tokenId, [k,
                    v]);
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: SPATIAL TOPOLOGY OVERLAY */}
        {activeTab === "spatial" && (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-bold text-ink tracking-tight flex items-center gap-2">
                <Compass size={16} /> Spatial Canvas Topology
              </h3>
              <p className="text-xs text-ink-soft mt-0.5">
                Node coordinates and camera traversal paths.
              </p>
            </div>

            <div className="relative aspect-video max-h-[500px] bg-paper border-2 border-ink overflow-hidden flex items-center justify-center shadow-nb-sm">
              <svg
                className="w-full h-full p-4"
                viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Edges */}
                {film.canvas.edges.map((edge, i) => {
                  const from = film.canvas.nodes.find(
                    (n) => n.id === edge.from,
                  );
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

      {/* Spacious 80% Viewport Scene Inspector Modal */}
      {editingShotIdx !== null && (
        <ShotModal
          isOpen={editingShotIdx !== null}
          film={film}
          shotIndex={editingShotIdx}
          onClose={() => setEditingShotIdx(null)}
          onUpdateFilm={(updatedFilm) => {
            if (onUpdateFilm) onUpdateFilm(updatedFilm);
          }}
          onSelectShotIndex={(idx) => setEditingShotIdx(idx)}
        />
      )}
    </div>
  );
}
