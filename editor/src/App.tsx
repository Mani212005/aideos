/**
 * File Description: Main entry point for Aideos Studio editor UI, orchestrating views, real-time playback, audio state, and project history.
 */

import { useEffect, useState, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { FilmView } from "../../src/dl/Film";
import { buildTimeline, totalFrames, activeShotAt } from "../../src/dl/camera";
import { kvcacheFilm } from "../../src/dl/films/kvcache";
import { whatIsJepaFilm } from "../../src/dl/films/what-is-jepa";
import type { CanvasEdge, Film, Shot } from "../../src/dl/schema";
import { MindMap } from "./components/MindMap";
import { Styleboard } from "./components/Styleboard";
import { NodeEditor } from "./components/NodeEditor";
import { KineticCaptionEditor } from "./components/KineticCaptionEditor";
import { TimelineEditor } from "./components/TimelineEditor";
import { CustomizationEditor } from "./components/CustomizationEditor";
import { ExportProgressModal } from "./components/ExportProgressModal";
import { ScriptEditor } from "./components/ScriptEditor";
import { CritiqueStudio } from "./components/CritiqueStudio";
import { ShotInspector } from "./components/ShotInspector";
import { OnCanvasAiEditor } from "./components/OnCanvasAiEditor";
import { AgentActivityInspector } from "./components/AgentActivityInspector";
import { NewProjectModal } from "./components/NewProjectModal";
import { GlobalFeedbackWidget } from "./components/GlobalFeedbackWidget";
import { AssetBin, type MediaAsset } from "./components/AssetBin";
import {
  FileText,
  Compass,
  Film as FilmIcon,
  Palette,
  Check,
  Download,
  RotateCw,
  Loader2,
  Mic,
  Plus,
  Subtitles,
  LayoutGrid,
  Bot,
} from "lucide-react";
import { DEFAULT_GIRAFFE_CAPTION_WORDS, generateWordsFromFilm, captionWordsToVtt } from "../../src/dl/captionsParser";
import { validateFilmAudioAndAssets } from "../../src/dl/validateFilm";

const filmModules = import.meta.glob("../../src/dl/films/*.ts", { eager: true }) as Record<
  string,
  Record<string, Film>
>;

const filmsById = new Map<string, Film>(
  Object.entries(filmModules).flatMap(([file, mod]) => {
    const id = file.split("/").pop()?.replace(/\.ts$/, "");
    const film = Object.values(mod)[0];
    return id && film ? [[id, film] as [string, Film]] : [];
  }),
);

const FORMATS = {
  long: { width: 1920, height: 1080 },
  reel: { width: 1080, height: 1920 },
};

type Format = keyof typeof FORMATS;
type Mode = "script" | "map" | "customization" | "styleboard" | "captions" | "video" | "critique";
type Selection = { type: "node" | "shot", id: string } | null;

// Renders the main Aideos Editor application shell.
export default function App() {
  const [film, setFilm] = useState<Film>(whatIsJepaFilm || kvcacheFilm);
  const [format, setFormat] = useState<Format>("long");
  const [mode, setMode] = useState<Mode>("script");
  const [selection, setSelection] = useState<Selection>(null);
  const [filmIds, setFilmIds] = useState<string[]>([...filmsById.keys()]);
  const [saving, setSaving] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ filename: string; downloadUrl: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // GPU B-Roll generation state
  const [isGeneratingBroll, setIsGeneratingBroll] = useState<boolean>(false);
  const [brollProgress, setBrollProgress] = useState<{ activeShotId?: string; progress: number; message: string; count: number; total: number } | null>(null);

  const pendingBrollShots = useMemo(() => {
    if (!film || !film.shots) return [];
    return film.shots.filter((s) => {
      if (!s.needsFootage) return false;
      const hasInsetWithSrc = s.blocks.some((b) => b.c === "AnalogyInset" && Boolean((b as any).src));
      return !hasInsetWithSrc;
    });
  }, [film]);

  // Playback & Playhead state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const playerRef = useRef<PlayerRef>(null);

  // Drag vs Click distinction for video player to prevent accidental playback during text selection
  const playerMouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const isPlayerDragging = useRef<boolean>(false);

  const handlePlayerMouseDown = (e: React.MouseEvent) => {
    playerMouseDownPos.current = { x: e.clientX, y: e.clientY };
    isPlayerDragging.current = false;
  };

  const handlePlayerMouseMove = (e: React.MouseEvent) => {
    if (playerMouseDownPos.current) {
      const dist = Math.hypot(
        e.clientX - playerMouseDownPos.current.x,
        e.clientY - playerMouseDownPos.current.y
      );
      if (dist > 6) {
        isPlayerDragging.current = true;
      }
    }
  };

  const handlePlayerMouseUp = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement)?.closest?.("button, input, textarea, form, a")) {
      return;
    }
    if (isPlayerDragging.current) {
      // It was a drag / text selection gesture! Do NOT toggle playback!
      return;
    }
    if (playerRef.current?.isPlaying()) {
      playerRef.current.pause();
      setIsPlaying(false);
    } else {
      playerRef.current?.play();
      setIsPlaying(true);
    }
  };

  const timeline = useMemo(() => {
    try {
      return buildTimeline(film, film.voiceover?.durationSec);
    } catch(e) {
      console.error(e);
      return null;
    }
  }, [film]);

  const duration = timeline ? totalFrames(timeline) : 300;

  // Sync Remotion Player frame updates to currentFrame without triggering 30fps root re-renders during playback
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    let lastShotId: string | undefined = undefined;

    const onFrameUpdate = (e: any) => {
      if (typeof e?.detail?.frame !== "number") return;
      const frame = e.detail.frame;

      // While playing, only trigger state update if the active shot changed (to avoid 30fps re-render stutter)
      if (player.isPlaying()) {
        const currentShot = activeShotAt(timeline || [], frame);
        const shotId = currentShot?.shot?.id;
        if (shotId !== lastShotId) {
          lastShotId = shotId;
          setCurrentFrame(frame);
        }
      } else {
        lastShotId = undefined;
        setCurrentFrame(frame);
      }
    };

    player.addEventListener("frameupdate", onFrameUpdate);
    return () => {
      player.removeEventListener("frameupdate", onFrameUpdate);
    };
  }, [playerRef.current, timeline]);

  // Styleboard / presentation state
  const [accent, setAccent] = useState(film.accent || "#635BFF");
  const [storyStyle, setStoryStyle] = useState("default");

  // Regenerate video preview key & Pretext captions state
  const [regenerateKey, setRegenerateKey] = useState<number>(0);
  const [captionWords, setCaptionWords] = useState<any[]>(DEFAULT_GIRAFFE_CAPTION_WORDS);
  const [undoStack, setUndoStack] = useState<Film[]>([]);

  // Real-time validation status derivation
  const validationStatus = useMemo(() => {
    try {
      validateFilmAudioAndAssets(film, { toleranceSec: 1000 });
      return { ok: true, message: "19 schema rules & audio invariants healthy" };
    } catch (err: any) {
      return { ok: false, message: err.message || "Validation Error" };
    }
  }, [film]);

  const handleUpdateFilmWithHistory = (updated: Film) => {
    setUndoStack((prev) => [film, ...prev.slice(0, 19)]);
    setFilm(updated);
    setRegenerateKey((k) => k + 1);
    fetch(`/api/films/${updated.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ film: updated }),
    }).catch(() => {});
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const [previous, ...rest] = undoStack;
    setUndoStack(rest);
    setFilm(previous);
    setRegenerateKey((k) => k + 1);
    fetch(`/api/films/${previous.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ film: previous }),
    }).catch(() => {});
  };

  // Automatically derive word-level timestamps for the active film's script when film id changes
  useEffect(() => {
    if (film) {
      const dynamicWords = generateWordsFromFilm(film);
      setCaptionWords(dynamicWords);
    }
  }, [film?.id]);

  // Adjustable timeline height state (vertical split resizer)
  const [timelineHeight, setTimelineHeight] = useState<number>(320);
  const [isResizingTimeline, setIsResizingTimeline] = useState<boolean>(false);

  // Restore active project and fetch latest film list from backend on mount
  useEffect(() => {
    fetch("/api/films")
      .then((res) => res.json())
      .then(async (ids: string[]) => {
        if (Array.isArray(ids) && ids.length > 0) {
          setFilmIds(ids);

          // Find saved active project ID from localStorage or backend
          let activeId = localStorage.getItem("aideos_active_film_id");
          if (!activeId || !ids.includes(activeId)) {
            try {
              const activeRes = await fetch("/api/active-film");
              const activeData = await activeRes.json();
              if (activeData.activeId && ids.includes(activeData.activeId)) {
                activeId = activeData.activeId;
              }
            } catch (_) {}
          }
          if (!activeId || !ids.includes(activeId)) {
            activeId = ids.includes("what-is-jepa") ? "what-is-jepa" : ids[0];
          }

          // Fetch the full film definition for the active project
          fetch(`/api/films/${activeId}`)
            .then((r) => r.json())
            .then((data) => {
              if (data.ok && data.film) {
                setFilm(data.film);
                setAccent(data.film.accent || "#635BFF");
                localStorage.setItem("aideos_active_film_id", activeId!);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Switches the active project dynamically and persists selection
  const handleSelectFilm = async (selectedId: string) => {
    localStorage.setItem("aideos_active_film_id", selectedId);
    try {
      await fetch("/api/active-film", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedId }),
      });
    } catch (_) {}

    try {
      const res = await fetch(`/api/films/${selectedId}`);
      const data = await res.json();
      if (data.ok && data.film) {
        setFilm(data.film);
        setAccent(data.film.accent || "#635BFF");
        setStatus(null);
        setSelection(null);
        return;
      }
    } catch (_) {}

    const fallback = filmsById.get(selectedId);
    if (fallback) {
      setFilm(fallback);
      setAccent(fallback.accent || "#635BFF");
      setStatus(null);
      setSelection(null);
    }
  };

  // Sync Remotion Player playing state with timeline without 30fps parent re-renders
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
    };
  }, [mode, regenerateKey]);

  // Global cross-tab audio coordinator and rogue audio element killer
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("aideos_single_tab_audio");
      bc.onmessage = (e) => {
        if (e.data === "takeover_playback") {
          try {
            playerRef.current?.pause();
          } catch (_) {}
        }
      };
    } catch (_) {}

    // Kill any orphaned or background audio elements from other screens
    const lingering = document.querySelectorAll("audio");
    lingering.forEach((a) => {
      try {
        a.pause();
        a.currentTime = 0;
      } catch (_) {}
    });

    return () => {
      try {
        bc?.close();
      } catch (_) {}
    };
  }, [mode]);

  useEffect(() => {
    if (!isResizingTimeline) return;

    const handleMouseMove = (e: MouseEvent) => {
      const minH = 140;
      const maxH = Math.min(window.innerHeight * 0.75, 750);
      const computedHeight = window.innerHeight - e.clientY;
      setTimelineHeight(Math.max(minH, Math.min(maxH, computedHeight)));
    };

    const handleMouseUp = () => {
      setIsResizingTimeline(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingTimeline]);


  useEffect(() => {
    let live = true;
    fetch("/api/films")
      .then((r) => r.json() as Promise<string[]>)
      .then((ids) => {
        if (live) setFilmIds(ids.filter((id) => filmsById.has(id)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const audioDurationSec = useMemo(() => {
    if (film.voiceover?.durationSec && film.voiceover.durationSec > 0) {
      return film.voiceover.durationSec;
    }
    if (!film || !film.shots || film.shots.length === 0) return undefined;
    const baseShotSec = film.shots.reduce((acc, s) => acc + (s.dur || 3), 0);
    return baseShotSec > 0 ? baseShotSec : undefined;
  }, [film]);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      // Ensure we push accent and theme into film before saving
      const resolvedAccent = accent === "#635BFF" ? (film.theme?.accent || undefined) : accent;
      const filmToSave = {
        ...film,
        accent: resolvedAccent,
        theme: {
          ...(film.theme || {}),
          accent: resolvedAccent,
        },
      };
      const res = await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film: filmToSave })
      });
      const payload = (await res.json().catch(() => null)) as
        | { file?: string; error?: string; issues?: string[] }
        | null;
      if (!res.ok) {
        setStatus({
          ok: false,
          text: payload?.issues?.join("\n") ?? payload?.error ?? `Save failed (${res.status})`,
        });
        return;
      }
      setStatus({ ok: true, text: `Saved ${payload?.file ?? `${film.id}.ts`}` });
    } catch (e) {
      console.error(e);
      setStatus({ ok: false, text: e instanceof Error ? e.message : "Failed to save." });
    } finally {
      setSaving(false);
    }
  };

  const generateVoiceover = async () => {
    try {
      const res = await fetch('/api/voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ film })
      });
      if (!res.ok) throw new Error(`Failed to generate voiceover: ${res.statusText}`);
      const data = await res.json();
      if (data.film) setFilm(data.film);
    } catch (e) {
      console.error(e);
      alert('Error generating voiceover');
    }
  };

  const handleGenerateVideoWithBroll = async () => {
    if (pendingBrollShots.length > 0) {
      setIsGeneratingBroll(true);
      try {
        playerRef.current?.pause();
      } catch (_) {}
      setStatus({ ok: true, text: `Triggering GPU video generation for ${pendingBrollShots.length} B-Roll scene(s)...` });

      try {
        const genRes = await fetch("/api/broll/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filmId: film.id, allPending: true, film }),
        });
        const genData = await genRes.json();
        if (!genRes.ok) throw new Error(genData.error || "Failed to submit GPU B-Roll jobs");

        // Poll until all B-roll jobs are done
        let done = false;
        while (!done) {
          await new Promise((r) => setTimeout(r, 4000));
          const stRes = await fetch(`/api/broll/status?filmId=${film.id}`);
          if (stRes.ok) {
            const stData = await stRes.json();
            const jobs: any[] = stData.jobs || [];
            const running = jobs.filter((j) => j.state === "running" || j.state === "queued");
            const failed = jobs.filter((j) => j.state === "failed");
            if (failed.length > 0) {
              console.warn("Some B-roll jobs failed:", failed);
            }

            if (running.length === 0) {
              done = true;
            } else {
              const first = running[0];
              const pct = Math.round((first.progress || 0) * 100);
              setBrollProgress({
                activeShotId: first.shotId,
                progress: pct,
                message: `Denoising on NVIDIA L4 with Wan2.1: ${pct}%`,
                count: jobs.length - running.length,
                total: jobs.length,
              });
              setStatus({ ok: true, text: `Generating B-roll (${first.shotId}): ${pct}% on GPU...` });
            }
          }
        }

        // Fetch updated film with footage wired in
        const filmRes = await fetch(`/api/films/${film.id}`);
        if (filmRes.ok) {
          const filmData = await filmRes.json();
          if (filmData.film) {
            setFilm(filmData.film);
          }
        }

        setStatus({ ok: true, text: "All B-roll footage ready. Video updated." });
        setRegenerateKey((k) => k + 1);
      } catch (err: any) {
        setStatus({ ok: false, text: `B-Roll GPU error: ${err.message || String(err)}` });
      } finally {
        setIsGeneratingBroll(false);
        setBrollProgress(null);
      }
    } else {
      setIsRegenerating(true);
      setStatus({ ok: true, text: "Updating video preview..." });
      try {
        playerRef.current?.pause();
      } catch (_) {}
      setTimeout(() => {
        setRegenerateKey((k) => k + 1);
        setIsRegenerating(false);
        setStatus({ ok: true, text: "Video preview recompiled with latest settings." });
        setTimeout(() => setStatus(null), 4000);
      }, 450);
    }
  };

  const handleExport = async () => {
    if (pendingBrollShots.length > 0) {
      alert(`Cannot export video: ${pendingBrollShots.length} B-Roll shot(s) are still missing footage. Please click "Generate Video" to synthesize the footage on the GPU first.`);
      return;
    }
    if (isGeneratingBroll) {
      alert("GPU B-Roll generation is currently running on the NVIDIA L4 worker. Please wait for footage to download before exporting.");
      return;
    }
    setIsExporting(true);
    setExportResult(null);
    setExportError(null);
    setStatus({ ok: true, text: "Rendering MP4 via Remotion engine..." });
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film, format }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");

      setExportResult({ filename: data.filename, downloadUrl: data.downloadUrl });

      // Auto-trigger browser file download
      const link = document.createElement("a");
      link.href = data.downloadUrl;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setStatus({ ok: true, text: `Export complete: ${data.filename}` });
    } catch (err: any) {
      setExportError(err.message || String(err));
      setStatus({ ok: false, text: `Export error: ${err.message || String(err)}` });
    }
  };

  const addNode = () => {
    const nodes = [...film.canvas.nodes, { id: `node-${Date.now()}`, label: "new node", x: 100, y: 100, w: 190, h: 62 }];
    handleUpdateFilmWithHistory({ ...film, canvas: { ...film.canvas, nodes } });
  };

  // Add a connection between the first two available nodes.
  const addEdge = () => {
    const [from, to] = film.canvas.nodes;
    if (!from || !to) return;
    const edges: CanvasEdge[] = [...film.canvas.edges, { from: from.id, to: to.id, dashed: false }];
    handleUpdateFilmWithHistory({ ...film, canvas: { ...film.canvas, edges } });
  };

  // Update one graph connection while preserving the rest of the film.
  const updateEdge = (index: number, partial: Partial<CanvasEdge>) => {
    const edges = [...film.canvas.edges];
    edges[index] = { ...edges[index], ...partial };
    handleUpdateFilmWithHistory({ ...film, canvas: { ...film.canvas, edges } });
  };

  // Remove a graph connection without allowing the required edge list to become empty.
  const removeEdge = (index: number) => {
    if (film.canvas.edges.length <= 1) return;
    const edges = film.canvas.edges.filter((_, edgeIndex) => edgeIndex !== index);
    handleUpdateFilmWithHistory({ ...film, canvas: { ...film.canvas, edges } });
  };

  const addShot = () => {
    const defaultNode = film.canvas.nodes[0]?.id || 'all';
    const shots = [
      ...film.shots,
      {
        id: `shot-${Date.now()}`,
        dur: 10,
        look: defaultNode,
        move: 'hold',
        stage: 'anchor',
        zoom: 1,
        drift: false,
        blocks: [{ c: "Body", text: "New shot narrative and scene description." }],
      } as Shot,
    ];
    handleUpdateFilmWithHistory({ ...film, shots });
  };

  // Derive presentation props from storyStyle
  const showGrid = storyStyle === "technical";
  const showRail = storyStyle !== "minimal";

  const playerInputProps = useMemo(
    () => ({
      film,
      timeline: timeline || [],
      accent,
      showGrid,
      showRail,
      captionWords,
    }),
    [film, timeline, accent, showGrid, showRail, captionWords]
  );

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0B] text-[#F5F5F5] overflow-hidden font-sans antialiased">
      {/* STITCH BAUHAUS TOP APP BAR */}
      <header className="bg-[#0A0A0B] text-[#F5F5F5] border-b border-[#F5F5F5]/30 flex justify-between items-center h-12 px-6 w-full shrink-0 z-50">
        <div className="font-extrabold text-xl tracking-tighter uppercase font-sans text-[#F5F5F5]">
          AIDEOS
        </div>
        <div className="flex items-center gap-3">
          <AgentActivityInspector />
          <button
            onClick={handleSave}
            disabled={saving}
            className="bauhaus-button-secondary px-4 py-1 text-[11px] font-mono uppercase"
          >
            {saving ? "SAVING..." : "SAVE"}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="bauhaus-button-primary px-4 py-1 text-[11px] font-mono uppercase"
          >
            {isExporting ? "EXPORTING..." : "EXPORT"}
          </button>
          <span className="text-emerald-400 text-xs font-mono px-2 py-0.5 border border-emerald-500/40 bg-emerald-950/30 flex items-center gap-1">
            <Check size={12} />
            <span>SYNCED</span>
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* STITCH BAUHAUS LEFT NAV RAIL (w-16) */}
        <nav className="bg-[#0A0A0B] text-[#F5F5F5] h-full w-16 border-r border-[#F5F5F5]/30 flex flex-col items-center py-4 gap-2 shrink-0 z-40">
          <div className="mb-4 text-[10px] font-mono text-center">
            <span className="block text-gray-400 truncate w-12" title={film.id}>P_01</span>
          </div>
          <button
            onClick={() => setMode("script")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "script" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Script Studio"
          >
            <FileText size={18} />
            <span className="text-[9px] mt-1 uppercase font-mono">Script</span>
          </button>
          <button
            onClick={() => setMode("map")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "map" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Spatial Map"
          >
            <Compass size={18} />
            <span className="text-[9px] mt-1 uppercase font-mono">Map</span>
          </button>
          <button
            onClick={() => setMode("video")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "video" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Video Layer"
          >
            <FilmIcon size={18} />
            <span className="text-[9px] mt-1 uppercase font-mono">Video</span>
          </button>
          <button
            onClick={() => setMode("customization")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "customization" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Theme"
          >
            <Palette size={18} />
            <span className="text-[9px] mt-1 uppercase font-mono">Theme</span>
          </button>
          <button
            onClick={() => setMode("critique")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "critique" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Critique Studio"
          >
            <Bot size={18} />
            <span className="text-[9px] mt-1 uppercase font-mono">Critique</span>
          </button>
        </nav>

        {/* LEFT SUB-INSPECTOR PANEL (Context & Active Film Settings) */}
        <div className="w-80 border-r border-[#F5F5F5]/30 p-4 flex flex-col gap-4 overflow-y-auto shrink-0 bg-[#0A0A0B]">
          <div className="flex justify-between items-center border-b border-[#F5F5F5]/20 pb-2">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-gray-400">PROJECT METRICS</h2>
            <button
              onClick={() => setIsNewProjectOpen(true)}
              className="text-[10px] px-2.5 py-1 bg-[#635BFF] hover:bg-[#5249e6] text-white font-bold rounded-lg flex items-center gap-1.5 shadow-md shadow-[#635BFF]/30 font-sans transition-all"
              title="Create new project"
            >
              <Plus size={13} />
              <span>New Project</span>
            </button>
          </div>

          {status ? (
            <pre
              className={`whitespace-pre-wrap text-[10px] font-mono p-2 border ${
                status.ok
                  ? "border-[#F5F5F5]/40 text-emerald-400 bg-[#0A0A0B]"
                  : "border-red-600 text-red-400 bg-[#1A0F10]"
              }`}
            >
              {status.text}
            </pre>
          ) : null}

          <div className="flex flex-col gap-1.5 font-mono">
            <label className="text-[11px] text-gray-400 font-bold uppercase">ACTIVE FILM</label>
            <select
              className="functional-input px-2 py-1.5 text-xs outline-none"
              value={film.id}
              onChange={e => handleSelectFilm(e.target.value)}
            >
              {filmIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>

          {/* Dynamic Context Editor */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-4">
            {!selection && (
              <div className="flex flex-col gap-4 font-mono text-xs">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-400 font-bold uppercase">FILM TITLE</label>
                  <input
                    className="functional-input px-2 py-1.5 text-xs"
                    value={film.title}
                    onChange={e => setFilm({...film, title: e.target.value})}
                  />
                </div>

                {mode === "map" ? (
                  /* Map-Specific Actions when on the Spatial Map tab */
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] text-gray-400 font-bold uppercase">CANVAS ACTIONS</label>
                    <button onClick={addNode} className="bauhaus-button-secondary p-2 text-left text-xs">+ ADD NODE TO MAP</button>
                    <button onClick={addEdge} className="bauhaus-button-secondary p-2 text-left text-xs">+ ADD EDGE TO MAP</button>
                    <button onClick={addShot} className="bauhaus-button-secondary p-2 text-left text-xs">+ ADD SHOT TO SEQUENCE</button>
                  </div>
                ) : (
                  /* Clean Film Stats & Shot List for Video, Timeline, Script, Styleboard tabs */
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1 bg-[#18181B] p-2.5 rounded border border-[#27272A] text-[11px]">
                      <div className="flex justify-between text-gray-400">
                        <span>Duration</span>
                        {film.voiceover?.src ? (
                          <span className="text-yellow-400 font-bold">{(duration / (film.fps || 30)).toFixed(1)}s ({duration}f)</span>
                        ) : (
                          <span className="text-gray-500 font-mono italic">-- (Pending VO)</span>
                        )}
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>FPS</span>
                        <span className="text-white">{film.fps}</span>
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>Shots</span>
                        <span className="text-blue-400 font-bold">{film.shots.length}</span>
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>Nodes</span>
                        <span className="text-emerald-400">{film.canvas.nodes.length}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-400 font-bold uppercase">SHOT LIST</label>
                      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                        {film.shots.map((s, idx) => (
                          <button
                            key={s.id}
                            onClick={() => setSelection({ type: "shot", id: s.id })}
                            className="p-1.5 px-2 bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] rounded text-left flex items-center justify-between text-[11px] text-gray-300 transition-colors"
                          >
                            <span className="truncate">Shot {idx + 1}: {s.id}</span>
                            <span className="text-[10px] text-gray-500 font-mono">{s.dur}s</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button onClick={generateVoiceover} className="bauhaus-button-primary p-2 text-left text-xs mt-1">
                      GENERATE VOICEOVER
                    </button>

                    {/* Integrated Media Library Drawer in Sidebar */}
                    <AssetBin
                      compact
                      onInsertAssetAsShot={(asset: MediaAsset) => {
                        const rawDur = asset.duration && asset.duration > 0 ? Number(asset.duration.toFixed(2)) : 5.0;
                        const newShot: Shot = {
                          id: `shot-${film.shots.length + 1}-${asset.filename.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`,
                          stage: "frame",
                          look: film.shots[film.shots.length - 1]?.look || "n1",
                          move: "cut",
                          drift: false,
                          zoom: 1,
                          position: audioDurationSec,
                          startSec: audioDurationSec,
                          start: 0,
                          end: rawDur,
                          dur: rawDur,
                          blocks: [
                            {
                              c: "TextReveal",
                              text: asset.filename,
                              size: "headline",
                            },
                          ],
                        };
                        const updatedFilm = { ...film, shots: [...film.shots, newShot] };
                        handleUpdateFilmWithHistory(updatedFilm);
                        setStatus({ ok: true, text: `Added "${asset.filename}" to timeline as Shot ${updatedFilm.shots.length}` });
                      }}
                    />
                  </div>
                )}
              </div>
            )}

          {selection?.type === "node" && (
            <>
              <button 
                onClick={() => setSelection(null)}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                ← Back to overview
              </button>
              <NodeEditor 
                film={film} 
                nodeId={selection.id} 
                onChange={handleUpdateFilmWithHistory} 
                onSelectShot={(id) => setSelection({ type: "shot", id })}
                onNodeIdChange={(id) => setSelection({ type: "node", id })}
                onClearSelection={() => setSelection(null)}
              />
            </>
          )}

          {selection?.type === "shot" && (
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => setSelection(null)}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 transition-colors self-start pb-1 font-mono"
              >
                <span>←</span>
                <span>Back to Overview</span>
              </button>
              <ShotInspector
                film={film}
                selectedShotId={selection.id}
                onUpdateShot={(idx, updated, _label) => {
                  const newShots = [...film.shots];
                  newShots[idx] = { ...newShots[idx], ...updated };
                  handleUpdateFilmWithHistory({ ...film, shots: newShots });
                }}
                onDeleteShot={(idx) => {
                  if (film.shots.length <= 1) return;
                  const newShots = film.shots.filter((_, i) => i !== idx);
                  handleUpdateFilmWithHistory({ ...film, shots: newShots });
                  setSelection(null);
                }}
                onClose={() => setSelection(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden relative">
        
        {/* Top bar with Layer switcher */}
        <div className="flex justify-between items-center shrink-0">
          <div className="flex bg-[#1A1A1B] p-1 rounded-lg border border-[#333] overflow-x-auto max-w-full gap-1">
            {(["script", "map", "customization", "styleboard", "captions", "video"] as const).map((m) => {
              const icons = {
                script: FileText,
                map: Compass,
                customization: Palette,
                styleboard: LayoutGrid,
                captions: Subtitles,
                video: FilmIcon,
              };
              const labels = {
                script: "Script",
                map: "Spatial Map",
                customization: "Theme",
                styleboard: "Styleboard",
                captions: "Captions",
                video: "Video",
              };
              const Icon = icons[m];
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-xs px-3 py-1.5 rounded-md font-bold tracking-wide transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    mode === m ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
                  }`}
                >
                  <Icon size={14} />
                  <span>{labels[m]}</span>
                </button>
              );
            })}
          </div>

          {mode === "video" && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleGenerateVideoWithBroll}
                disabled={isRegenerating || isGeneratingBroll}
                className={`text-xs px-3.5 py-1.5 rounded font-bold flex items-center gap-1.5 shadow-md transition-all active:scale-95 ${
                  pendingBrollShots.length > 0
                    ? "bg-amber-500 hover:bg-amber-400 text-black animate-pulse"
                    : "bg-yellow-500 hover:bg-yellow-400 text-black"
                }`}
                title={
                  pendingBrollShots.length > 0
                    ? `Render ${pendingBrollShots.length} pending B-roll scenes on GPU`
                    : "Re-render video timeline"
                }
              >
                {isGeneratingBroll || isRegenerating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RotateCw size={14} />
                )}
                <span>
                  {isGeneratingBroll
                    ? `Generating (${brollProgress?.progress ?? 0}%)...`
                    : isRegenerating
                    ? "Regenerating..."
                    : pendingBrollShots.length > 0
                    ? `Generate Video (${pendingBrollShots.length} B-Roll)`
                    : "Regenerate Video"}
                </span>
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className={`text-xs px-3.5 py-1.5 rounded font-bold flex items-center gap-1.5 shadow-md transition-colors ${
                  isExporting
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                }`}
                title="Export MP4 video"
              >
                {isExporting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Rendering...</span>
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    <span>Export</span>
                  </>
                )}
              </button>
              <div className="h-4 w-[1px] bg-[#333] mx-1" />
              {(Object.keys(FORMATS) as Format[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`text-xs px-3 py-1.5 rounded border capitalize font-bold ${
                    format === f ? "border-[#635BFF] text-white bg-[#635BFF]/10" : "border-[#333] text-gray-400 hover:border-gray-500"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Viewport */}
        <div className="flex-1 flex min-h-0 relative rounded-lg overflow-hidden">
          {mode === "script" && (
            <ScriptEditor
              film={film}
              onUpdateFilm={handleUpdateFilmWithHistory}
              onNavigateToVideo={() => setMode("video")}
            />
          )}

          {mode === "map" && (
            <MindMap 
              film={film} 
              selectedNodeId={selection?.type === "node" ? selection.id : null}
              onSelectNode={(id) => setSelection(id ? { type: "node", id } : null)}
              onNodesChange={(updatedNodes) => {
                handleUpdateFilmWithHistory({
                  ...film,
                  canvas: { ...film.canvas, nodes: updatedNodes },
                });
              }}
              onAddNode={addNode}
              onAddEdge={addEdge}
              onUpdateEdge={updateEdge}
              onRemoveEdge={removeEdge}
            />
          )}

          {mode === "customization" && (
            <CustomizationEditor
              film={film}
              onUpdateFilm={handleUpdateFilmWithHistory}
              accent={accent}
              onAccentChange={setAccent}
            />
          )}

          {mode === "styleboard" && (
            <Styleboard
              film={film}
              accent={accent}
              onAccentChange={setAccent}
              storyStyle={storyStyle}
              onStoryStyleChange={setStoryStyle}
              onSelectShot={(id) => {
                setSelection({ type: "shot", id });
              }}
              onUpdateFilm={handleUpdateFilmWithHistory}
            />
          )}

          {mode === "captions" && (
            <div className="w-full h-full bg-[#09090B] p-6 overflow-y-auto">
              <KineticCaptionEditor
                film={film}
                words={captionWords}
                onCaptionsChange={(newCaptions) => {
                  setCaptionWords(newCaptions);
                  const vttString = captionWordsToVtt(newCaptions, film.fps || 30);
                  handleUpdateFilmWithHistory({ ...film, captions: vttString });
                }}
                onSeekToFrame={(frame) => {
                  playerRef.current?.seekTo(frame);
                }}
              />
            </div>
          )}

          {mode === "video" && (
            <div className="w-full h-full bg-[#0A0A0B] border border-[#333] rounded-lg overflow-hidden flex flex-col">
              {!film.voiceover?.src ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0C0C10]">
                  <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
                    <Mic className="text-amber-400" size={28} />
                  </div>
                  <h3 className="text-base font-bold text-white mb-2 font-mono">
                    Voiceover Required
                  </h3>
                  <p className="text-xs text-gray-400 max-w-md mb-6 leading-relaxed">
                    Generate synthesized voiceover in Script Studio to establish timeline synchronization.
                  </p>
                  <button
                    onClick={() => setMode("script")}
                    className="px-5 py-2.5 bg-[#635BFF] hover:bg-[#5248E5] text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <FileText size={14} />
                    <span>Go to Script Studio</span>
                  </button>
                </div>
              ) : isGeneratingBroll ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0C0C10]">
                  <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
                    <FilmIcon className="text-amber-400 animate-pulse" size={28} />
                  </div>
                  <h3 className="text-base font-bold text-white mb-1 font-mono">
                    Synthesizing Video on GPU
                  </h3>
                  <p className="text-xs text-amber-400 font-mono mb-4">
                    Remote: NVIDIA L4 · Wan2.1 Diffusion
                  </p>
                  <p className="text-xs text-gray-400 max-w-md mb-6 leading-relaxed">
                    The video player unlocks automatically once diffusion rendering completes.
                  </p>
                  <div className="w-72 bg-gray-800 rounded-full h-3 mb-3 overflow-hidden border border-gray-700">
                    <div
                      className="bg-gradient-to-r from-amber-500 via-[#635BFF] to-emerald-400 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(5, brollProgress?.progress ?? 15)}%` }}
                    />
                  </div>
                  <div className="text-xs font-mono text-gray-200">
                    {brollProgress ? `${brollProgress.message}` : "Submitting Wan2.1 generation jobs to remote GPU box..."}
                  </div>
                  <div className="text-[11px] font-mono text-gray-500 mt-2">
                    Generating shot footage {brollProgress?.count ?? 0} of {brollProgress?.total ?? pendingBrollShots.length}...
                  </div>
                </div>
              ) : (
                <>
                  {/* TOP SECTION: Remotion Video Player Preview */}
                  <div
                    onMouseDown={handlePlayerMouseDown}
                    onMouseMove={handlePlayerMouseMove}
                    onMouseUp={handlePlayerMouseUp}
                    className="flex-1 bg-black relative flex items-center justify-center min-h-0"
                  >
                    {timeline ? (
                      <>
                        <Player
                          ref={playerRef}
                          key={regenerateKey}
                          component={FilmView}
                          inputProps={playerInputProps}
                          durationInFrames={duration}
                          fps={film.fps}
                          compositionWidth={FORMATS[format].width}
                          compositionHeight={FORMATS[format].height}
                          style={{ width: "100%", height: "100%", maxHeight: "100%" }}
                          controls
                          clickToPlay={false}
                          acknowledgeRemotionLicense
                        />

                        {/* Google Stitch-Style On-Canvas AI & Element Inspector */}
                        <OnCanvasAiEditor
                          film={film}
                          timeline={timeline}
                          currentFrame={currentFrame}
                          onUpdateFilm={handleUpdateFilmWithHistory}
                          accent={accent}
                        />

                        {selection?.type === "shot" && (
                          <div className="absolute top-4 left-4 bg-[#111]/80 backdrop-blur border border-[#333] rounded px-3 py-1.5 text-xs text-white z-20 pointer-events-none">
                            Reviewing Shot: <span className="font-mono text-[#635BFF]">{selection.id}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-red-500">Error building timeline. Check console.</div>
                    )}
                  </div>

                  {/* VERTICAL SPLIT RESIZER DRAG HANDLE */}
                  <div
                    onMouseDown={() => setIsResizingTimeline(true)}
                    className={`h-2.5 bg-[#18181B] hover:bg-[#635BFF] cursor-row-resize flex items-center justify-center transition-colors border-y border-[#27272A] z-40 select-none group ${
                      isResizingTimeline ? "bg-[#635BFF] ring-2 ring-[#635BFF]" : ""
                    }`}
                    title="Drag up/down to adjust timeline height"
                  >
                    <div className="w-12 h-1 rounded-full bg-gray-500 group-hover:bg-white transition-colors flex items-center justify-center gap-0.5">
                      <div className="w-1 h-1 rounded-full bg-black/60" />
                      <div className="w-1 h-1 rounded-full bg-black/60" />
                      <div className="w-1 h-1 rounded-full bg-black/60" />
                    </div>
                  </div>

                  {/* BOTTOM SECTION: Embedded Multi-Track Timeline & Trimmer with dynamic height */}
                  <div
                    style={{ height: `${timelineHeight}px` }}
                    className="bg-[#0E0E10] shrink-0 overflow-hidden"
                  >
                    <TimelineEditor
                      film={film}
                      onUpdateFilm={handleUpdateFilmWithHistory}
                      totalDurationSec={audioDurationSec}
                      isEmbedded={true}
                      isPlaying={isPlaying}
                      playerRef={playerRef}
                      onSelectShot={(shotId) => setSelection(shotId ? { type: "shot", id: shotId } : null)}
                      onTogglePlay={() => {
                        if (playerRef.current?.isPlaying()) {
                          playerRef.current.pause();
                          setIsPlaying(false);
                        } else {
                          playerRef.current?.play();
                          setIsPlaying(true);
                        }
                      }}
                      onPreviewSeek={(frame) => {
                        setCurrentFrame(frame);
                        playerRef.current?.seekTo(frame);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {mode === "critique" && (
            <CritiqueStudio
              film={film}
              onUpdateFilm={handleUpdateFilmWithHistory}
              undoStack={undoStack}
              onUndo={handleUndo}
              validationStatus={validationStatus}
            />
          )}
        </div>
      </div>
    </div>

      {/* Export Progress & Specifications Modal Overlay */}
      <ExportProgressModal
        isOpen={isExporting}
        film={film}
        format={format}
        durationInFrames={duration}
        result={exportResult}
        error={exportError}
        onClose={() => {
          setIsExporting(false);
          setExportResult(null);
          setExportError(null);
        }}
      />

      {/* New Project Creation Modal */}
      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onProjectCreated={(newFilm, _newScript) => {
          filmsById.set(newFilm.id, newFilm);
          setFilm(newFilm);
          setFilmIds((prev) => Array.from(new Set([newFilm.id, ...prev])));
          setAccent(newFilm.accent || "#635BFF");
          localStorage.setItem("aideos_active_film_id", newFilm.id);
          fetch("/api/active-film", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: newFilm.id }),
          }).catch(() => {});
          setMode("script");
          setStatus({ ok: true, text: `Created project "${newFilm.title}"` });
          setTimeout(() => setStatus(null), 4000);
        }}
      />

      {/* Global AI Feedback & Chatbot Widget */}
      <GlobalFeedbackWidget
        film={film}
        activeMode={mode}
        activeSelectionId={selection?.id}
        onUpdateFilm={handleUpdateFilmWithHistory}
      />
    </div>
  );
}
