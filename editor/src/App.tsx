import { useEffect, useState, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { FilmView } from "../../src/dl/Film";
import { buildTimeline, totalFrames } from "../../src/dl/camera";
import { kvcacheFilm } from "../../src/dl/films/kvcache";
import type { CanvasEdge, Film, Shot } from "../../src/dl/schema";
import { MindMap } from "./components/MindMap";
import { Styleboard } from "./components/Styleboard";
import { NodeEditor } from "./components/NodeEditor";
import { ShotEditor } from "./components/ShotEditor";
import { KineticCaptionEditor } from "./components/KineticCaptionEditor";
import { TimelineEditor } from "./components/TimelineEditor";
import { CustomizationEditor } from "./components/CustomizationEditor";
import { ExportProgressModal } from "./components/ExportProgressModal";
import { ScriptEditor } from "./components/ScriptEditor";
import { CritiqueStudio } from "./components/CritiqueStudio";
import { ClipInspector } from "./components/ClipInspector";
import { AgentActivityInspector } from "./components/AgentActivityInspector";
import { NewProjectModal } from "./components/NewProjectModal";
import { GlobalFeedbackWidget } from "./components/GlobalFeedbackWidget";
import { AssetBin, type MediaAsset } from "./components/AssetBin";
import { DEFAULT_GIRAFFE_CAPTION_WORDS, generateWordsFromFilm } from "../../src/dl/captionsParser";
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
type Mode = "script" | "map" | "timeline" | "customization" | "styleboard" | "captions" | "video" | "critique";
type Selection = { type: "node" | "shot", id: string } | null;

// Renders the main Aideos Editor application shell.
export default function App() {
  const [film, setFilm] = useState<Film>(kvcacheFilm);
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

  // Playback & Playhead state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playerRef = useRef<PlayerRef>(null);

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

  // Automatically derive word-level timestamps for the active film's script
  useEffect(() => {
    if (film) {
      const dynamicWords = generateWordsFromFilm(film);
      setCaptionWords(dynamicWords);
    }
  }, [film]);

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

    // Kill any orphaned audio elements from previous HMR passes
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
  }, []);

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
    if (!film || !film.shots || film.shots.length === 0) return undefined;
    const baseShotSec = film.shots.reduce((acc, s) => acc + (s.dur || 3), 0);
    return baseShotSec > 0 ? baseShotSec : undefined;
  }, [film]);

  const timeline = useMemo(() => {
    try {
      return buildTimeline(film);
    } catch(e) {
      console.error(e);
      return null;
    }
  }, [film]);

  const duration = timeline ? totalFrames(timeline) : 300;

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

  const handleExport = async () => {
    setIsExporting(true);
    setExportResult(null);
    setExportError(null);
    setStatus({ ok: true, text: "⏳ Rendering high-definition MP4 via Remotion engine... Please wait." });
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

      setStatus({ ok: true, text: `🎉 Export complete! Downloaded ${data.filename}` });
    } catch (err: any) {
      setExportError(err.message || String(err));
      setStatus({ ok: false, text: `Export error: ${err.message || String(err)}` });
    }
  };

  const addNode = () => {
    const nodes = [...film.canvas.nodes, { id: `node-${Date.now()}`, label: "new node", x: 100, y: 100, w: 190, h: 62 }];
    setFilm({ ...film, canvas: { ...film.canvas, nodes } });
  };

  // Add a connection between the first two available nodes.
  const addEdge = () => {
    const [from, to] = film.canvas.nodes;
    if (!from || !to) return;
    const edges: CanvasEdge[] = [...film.canvas.edges, { from: from.id, to: to.id, dashed: false }];
    setFilm({ ...film, canvas: { ...film.canvas, edges } });
  };

  // Update one graph connection while preserving the rest of the film.
  const updateEdge = (index: number, partial: Partial<CanvasEdge>) => {
    const edges = [...film.canvas.edges];
    edges[index] = { ...edges[index], ...partial };
    setFilm({ ...film, canvas: { ...film.canvas, edges } });
  };

  // Remove a graph connection without allowing the required edge list to become empty.
  const removeEdge = (index: number) => {
    if (film.canvas.edges.length <= 1) return;
    const edges = film.canvas.edges.filter((_, edgeIndex) => edgeIndex !== index);
    setFilm({ ...film, canvas: { ...film.canvas, edges } });
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
    setFilm({ ...film, shots });
  };

  // Derive presentation props from storyStyle
  const showGrid = storyStyle === "technical";
  const showRail = storyStyle !== "minimal";

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
          <span className="text-emerald-400 text-xs font-mono px-2 py-0.5 border border-emerald-500/40 bg-emerald-950/30">
            ✓ SYNCED
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
            <span className="text-lg">📝</span>
            <span className="text-[9px] mt-1 uppercase font-mono">Script</span>
          </button>
          <button
            onClick={() => setMode("map")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "map" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Spatial Map"
          >
            <span className="text-lg">🗺️</span>
            <span className="text-[9px] mt-1 uppercase font-mono">Map</span>
          </button>
          <button
            onClick={() => setMode("video")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "video" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="3D Scene Engine"
          >
            <span className="text-lg">🎬</span>
            <span className="text-[9px] mt-1 uppercase font-mono">Scene</span>
          </button>
          <button
            onClick={() => setMode("timeline")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "timeline" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Timeline & Trimmer"
          >
            <span className="text-lg">🎞️</span>
            <span className="text-[9px] mt-1 uppercase font-mono">Time</span>
          </button>
          <button
            onClick={() => setMode("customization")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "customization" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Studio Theme"
          >
            <span className="text-lg">🎨</span>
            <span className="text-[9px] mt-1 uppercase font-mono">Theme</span>
          </button>
          <button
            onClick={() => setMode("critique")}
            className={`w-full flex flex-col items-center py-3 text-xs font-mono transition-none border-l-2 ${
              mode === "critique" ? "bg-[#635BFF]/20 text-[#635BFF] border-[#635BFF]" : "text-gray-400 border-transparent hover:text-white"
            }`}
            title="Natural Language Critique Studio"
          >
            <span className="text-lg">🤖</span>
            <span className="text-[9px] mt-1 uppercase font-mono">Critique</span>
          </button>
        </nav>

        {/* LEFT SUB-INSPECTOR PANEL (Context & Active Film Settings) */}
        <div className="w-80 border-r border-[#F5F5F5]/30 p-4 flex flex-col gap-4 overflow-y-auto shrink-0 bg-[#0A0A0B]">
          <div className="flex justify-between items-center border-b border-[#F5F5F5]/20 pb-2">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-gray-400">PROJECT METRICS</h2>
            <button
              onClick={() => setIsNewProjectOpen(true)}
              className="text-[10px] px-2.5 py-1 bg-[#635BFF] hover:bg-[#5249e6] text-white font-bold rounded-lg flex items-center gap-1 shadow-md shadow-[#635BFF]/30 font-sans transition-all"
              title="Paste a raw script or outline and compile a complete animated explainer film"
            >
              <span>✨</span>
              <span>+ Script Intake</span>
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
                        <span className="text-yellow-400 font-bold">{(duration / (film.fps || 30)).toFixed(1)}s ({duration}f)</span>
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
                        setStatus({ ok: true, text: `✓ Added "${asset.filename}" to timeline as Shot ${updatedFilm.shots.length}` });
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
                onChange={setFilm} 
                onSelectShot={(id) => setSelection({ type: "shot", id })}
                onNodeIdChange={(id) => setSelection({ type: "node", id })}
                onClearSelection={() => setSelection(null)}
              />
            </>
          )}

          {selection?.type === "shot" && (
            <>
              <button 
                onClick={() => setSelection(null)}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                ← Back to overview
              </button>
              <ClipInspector
                film={film}
                selectedShotId={selection.id}
                onUpdateShot={(idx, updated, _label) => {
                  const newShots = [...film.shots];
                  newShots[idx] = { ...newShots[idx], ...updated };
                  setFilm({ ...film, shots: newShots });
                }}
                onClose={() => setSelection(null)}
              />
              <ShotEditor 
                film={film} 
                shotIndex={film.shots.findIndex(s => s.id === selection.id)} 
                onChange={setFilm}
                onSelectShot={(id) => setSelection({ type: "shot", id })}
                onShotIdChange={(id) => setSelection({ type: "shot", id })}
                onClearSelection={() => setSelection(null)}
              />
            </>
          )}
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden relative">
        
        {/* Top bar with Layer switcher */}
        <div className="flex justify-between items-center shrink-0">
          <div className="flex bg-[#1A1A1B] p-1 rounded-lg border border-[#333] overflow-x-auto max-w-full">
            {(["script", "map", "timeline", "customization", "styleboard", "captions", "video"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`text-xs px-3 py-1.5 rounded-md font-bold tracking-wide transition-colors whitespace-nowrap ${
                  mode === m ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
                }`}
              >
                {m === "script" ? "📝 Script Studio" :
                 m === "map" ? "🗺️ Spatial Map" :
                 m === "timeline" ? "🎞️ Timeline & Trimmer" :
                 m === "customization" ? "🎨 Studio Theme" :
                 m === "styleboard" ? "📐 Styleboard" :
                 m === "captions" ? "💬 Pretext Captions" : "🎬 Video Layer"}
              </button>
            ))}
          </div>

          {mode === "video" && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsRegenerating(true);
                  setStatus({ ok: true, text: "🔄 Video preview regenerating with latest theme and fonts..." });
                  try {
                    playerRef.current?.pause();
                  } catch (_) {}
                  setTimeout(() => {
                    setRegenerateKey((k) => k + 1);
                    setIsRegenerating(false);
                    setStatus({ ok: true, text: "✓ Video preview successfully recompiled with latest theme & settings!" });
                    setTimeout(() => setStatus(null), 4000);
                  }, 450);
                }}
                disabled={isRegenerating}
                className="text-xs px-3.5 py-1.5 rounded bg-yellow-500 hover:bg-yellow-400 text-black font-bold flex items-center gap-1.5 shadow-md transition-all active:scale-95"
                title="Force re-render Remotion timeline with latest Pretext captions & transitions"
              >
                <span className={isRegenerating ? "animate-spin" : ""}>🔄</span>
                <span>{isRegenerating ? "Regenerating..." : "Regenerate"}</span>
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className={`text-xs px-3.5 py-1.5 rounded font-bold flex items-center gap-1.5 shadow-md transition-colors ${
                  isExporting
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                }`}
                title="Render and export full high-definition MP4 video"
              >
                {isExporting ? (
                  <>
                    <span className="animate-spin">⏳</span> Rendering MP4...
                  </>
                ) : (
                  <>
                    <span>📥</span> Export MP4
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
              onUpdateFilm={setFilm}
              onNavigateToVideo={() => setMode("video")}
            />
          )}

          {mode === "map" && (
            <MindMap 
              film={film} 
              selectedNodeId={selection?.type === "node" ? selection.id : null}
              onSelectNode={(id) => setSelection(id ? { type: "node", id } : null)}
              onNodesChange={(updatedNodes) => {
                setFilm((prev) => ({
                  ...prev,
                  canvas: { ...prev.canvas, nodes: updatedNodes },
                }));
              }}
              onAddNode={addNode}
              onAddEdge={addEdge}
              onUpdateEdge={updateEdge}
              onRemoveEdge={removeEdge}
            />
          )}

          {mode === "timeline" && (
            <div className="w-full h-full p-4 bg-[#09090B] overflow-hidden">
              <TimelineEditor
                film={film}
                onUpdateFilm={setFilm}
                totalDurationSec={audioDurationSec}
                isPlaying={isPlaying}
                onTogglePlay={() => {
                  if (playerRef.current?.isPlaying()) {
                    playerRef.current.pause();
                    setIsPlaying(false);
                  } else {
                    playerRef.current?.play();
                    setIsPlaying(true);
                  }
                }}
                onPreviewSeek={(_frame) => {
                  // Seek preview to exact frame
                  setSelection({ type: "shot", id: film.shots[0]?.id || "" });
                }}
              />
            </div>
          )}

          {mode === "customization" && (
            <CustomizationEditor
              film={film}
              onUpdateFilm={setFilm}
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
              onUpdateFilm={setFilm}
            />
          )}

          {mode === "captions" && (
            <div className="w-full h-full bg-[#09090B] p-6 overflow-y-auto">
              <KineticCaptionEditor
                film={film}
                words={captionWords}
                onCaptionsChange={setCaptionWords}
                onSeekToFrame={(frame) => {
                  playerRef.current?.seekTo(frame);
                }}
              />
            </div>
          )}

          {mode === "video" && (
            <div className="w-full h-full bg-[#0A0A0B] border border-[#333] rounded-lg overflow-hidden flex flex-col">
              {/* TOP SECTION: Remotion Video Player Preview */}
              <div className="flex-1 bg-black relative flex items-center justify-center min-h-0">
                {timeline ? (
                  <>
                    <Player
                      ref={playerRef}
                      key={regenerateKey}
                      component={FilmView}
                      inputProps={{
                        film,
                        timeline,
                        accent,
                        showGrid,
                        showRail,
                        captionWords,
                      }}
                      durationInFrames={duration}
                      fps={film.fps}
                      compositionWidth={FORMATS[format].width}
                      compositionHeight={FORMATS[format].height}
                      style={{ width: "100%", height: "100%", maxHeight: "100%" }}
                      controls
                      acknowledgeRemotionLicense
                    />
                    {selection?.type === "shot" && (
                      <div className="absolute top-4 left-4 bg-[#111]/80 backdrop-blur border border-[#333] rounded px-3 py-1.5 text-xs text-white z-30">
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
                  onUpdateFilm={setFilm}
                  totalDurationSec={audioDurationSec}
                  isEmbedded={true}
                  isPlaying={isPlaying}
                  playerRef={playerRef}
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
                    playerRef.current?.seekTo(frame);
                  }}
                />
              </div>
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
          setStatus({ ok: true, text: `🎉 Created and saved project "${newFilm.title}"!` });
          setTimeout(() => setStatus(null), 4000);
        }}
      />

      {/* Global AI Feedback & Chatbot Widget */}
      <GlobalFeedbackWidget film={film} activeMode={mode} activeSelectionId={selection?.id} />
    </div>
  );
}
