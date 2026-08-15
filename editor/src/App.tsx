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
import { TransitionEditor } from "./components/TransitionEditor";
import { KineticCaptionEditor } from "./components/KineticCaptionEditor";
import { TimelineEditor } from "./components/TimelineEditor";
import { DEFAULT_GIRAFFE_CAPTION_WORDS } from "../../src/dl/captionsParser";
import type { TransitionType } from "./transitions";

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
type Mode = "map" | "timeline" | "styleboard" | "transitions" | "captions" | "video";
type Selection = { type: "node" | "shot", id: string } | null;

// Renders the main Aideos Editor application shell.
export default function App() {
  const [film, setFilm] = useState<Film>(kvcacheFilm);
  const [format, setFormat] = useState<Format>("long");
  const [mode, setMode] = useState<Mode>("map");
  const [selection, setSelection] = useState<Selection>(null);
  const [filmIds, setFilmIds] = useState<string[]>([...filmsById.keys()]);
  const [saving, setSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Playback & Playhead state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playerRef = useRef<PlayerRef>(null);

  // Transition Inspector state
  const [transitionType, setTransitionType] = useState<TransitionType>("paper-rip");
  const [transitionDuration, setTransitionDuration] = useState<number>(0.6);

  // Styleboard / presentation state
  const [accent, setAccent] = useState(film.accent || "#635BFF");
  const [storyStyle, setStoryStyle] = useState("default");

  // Regenerate video preview key & Pretext captions state
  const [regenerateKey, setRegenerateKey] = useState<number>(0);
  const [captionWords, setCaptionWords] = useState<any[]>(DEFAULT_GIRAFFE_CAPTION_WORDS);

  // Adjustable timeline height state (vertical split resizer)
  const [timelineHeight, setTimelineHeight] = useState<number>(320);
  const [isResizingTimeline, setIsResizingTimeline] = useState<boolean>(false);

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
      // Ensure we push accent into film before saving if they changed it
      const filmToSave = { ...film, accent: accent === "#635BFF" ? undefined : accent };
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
    setStatus({ ok: true, text: "⏳ Rendering high-definition MP4 via Remotion engine... Please wait." });
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film, format }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");

      // Auto-trigger browser file download
      const link = document.createElement("a");
      link.href = data.downloadUrl;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setStatus({ ok: true, text: `🎉 Export complete! Downloaded ${data.filename}` });
    } catch (err: any) {
      setStatus({ ok: false, text: `Export error: ${err.message || String(err)}` });
    } finally {
      setIsExporting(false);
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
    <div className="flex h-screen bg-[#0A0A0B] text-[#F5F5F5] overflow-hidden font-sans">
      
      {/* LEFT SIDEBAR (Context & Editing) */}
      <div className="w-80 border-r border-[#333] p-4 flex flex-col gap-4 overflow-y-auto shrink-0 bg-[#0A0A0B]">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight">Aideos Editor</h1>
          <button
            className="bg-[#635BFF] hover:bg-[#5249e6] text-white px-3 py-1 rounded text-xs font-bold disabled:opacity-50 transition-colors"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "SAVING..." : "SAVE"}
          </button>
        </div>

        {status ? (
          <pre
            className={`whitespace-pre-wrap text-[10px] rounded p-2 border ${
              status.ok
                ? "border-[#333] text-gray-400"
                : "border-red-900 text-red-400 bg-[#1A0F10]"
            }`}
          >
            {status.text}
          </pre>
        ) : null}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Film</label>
          <select
            className="bg-[#1A1A1B] border border-[#333] rounded px-2 py-1.5 text-sm outline-none focus:border-[#635BFF]"
            value={film.id}
            onChange={e => {
              const next = filmsById.get(e.target.value);
              if (!next) return;
              setFilm(next);
              setAccent(next.accent || "#635BFF");
              setStatus(null);
              setSelection(null);
            }}
          >
            {filmIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>

        {/* Dynamic Context Editor */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4">
          {!selection && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Title</label>
                <input
                  className="bg-[#1A1A1B] border border-[#333] rounded px-2 py-1.5 text-sm outline-none focus:border-[#635BFF]"
                  value={film.title}
                  onChange={e => setFilm({...film, title: e.target.value})}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Actions</label>
                <button onClick={addNode} className="text-left text-sm bg-[#1A1A1B] hover:bg-[#222] border border-[#333] p-2 rounded">Add Node to Map</button>
                <button onClick={addEdge} className="text-left text-sm bg-[#1A1A1B] hover:bg-[#222] border border-[#333] p-2 rounded">Add Edge to Map</button>
                <button onClick={addShot} className="text-left text-sm bg-[#1A1A1B] hover:bg-[#222] border border-[#333] p-2 rounded">Add Shot to Sequence</button>
                <button onClick={generateVoiceover} className="text-left text-sm bg-[#635BFF]/10 text-[#635BFF] hover:bg-[#635BFF]/20 border border-[#635BFF]/30 p-2 rounded">
                  Generate Voiceover
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Connections</label>
                {film.canvas.edges.map((edge, edgeIndex) => (
                  <div key={`${edge.from}-${edge.to}-${edgeIndex}`} className="flex items-center gap-1 text-xs">
                    <select
                      className="min-w-0 flex-1 bg-[#1A1A1B] border border-[#333] rounded px-1.5 py-1"
                      value={edge.from}
                      onChange={e => updateEdge(edgeIndex, { from: e.target.value })}
                    >
                      {film.canvas.nodes.map(node => <option key={node.id} value={node.id}>{node.id}</option>)}
                    </select>
                    <span className="text-gray-500">-&gt;</span>
                    <select
                      className="min-w-0 flex-1 bg-[#1A1A1B] border border-[#333] rounded px-1.5 py-1"
                      value={edge.to}
                      onChange={e => updateEdge(edgeIndex, { to: e.target.value })}
                    >
                      {film.canvas.nodes.map(node => <option key={node.id} value={node.id}>{node.id}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-gray-400" title="Render this connection as dashed">
                      <input type="checkbox" checked={edge.dashed} onChange={e => updateEdge(edgeIndex, { dashed: e.target.checked })} />
                      <span className="sr-only">Dashed</span>
                    </label>
                    <button
                      onClick={() => removeEdge(edgeIndex)}
                      disabled={film.canvas.edges.length <= 1}
                      className="px-1 text-red-500 disabled:opacity-30"
                      aria-label={`Delete connection ${edgeIndex + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
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
          <div className="flex bg-[#1A1A1B] p-1 rounded-lg border border-[#333]">
            {(["map", "timeline", "styleboard", "transitions", "captions", "video"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`text-xs px-3.5 py-1.5 rounded-md capitalize font-bold tracking-wide transition-colors ${
                  mode === m ? "bg-[#635BFF] text-white shadow" : "text-gray-400 hover:text-white"
                }`}
              >
                {m === "timeline" ? "🎞️ Timeline & Trimmer" : m === "captions" ? "💬 Pretext Captions" : `${m} Layer`}
              </button>
            ))}
          </div>

          {mode === "video" && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  try {
                    playerRef.current?.pause();
                  } catch (_) {}
                  setRegenerateKey((k) => k + 1);
                  setStatus({ ok: true, text: "🔄 Video preview recompiled and regenerated with latest settings!" });
                }}
                className="text-xs px-3.5 py-1.5 rounded bg-yellow-500 hover:bg-yellow-400 text-black font-bold flex items-center gap-1.5 shadow-md transition-colors"
                title="Force re-render Remotion timeline with latest Pretext captions & transitions"
              >
                <span>🔄</span> Regenerate
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
            />
          )}

          {mode === "timeline" && (
            <div className="w-full h-full p-4 bg-[#09090B] overflow-hidden">
              <TimelineEditor
                film={film}
                onUpdateFilm={setFilm}
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
            />
          )}

          {mode === "transitions" && (
            <div className="w-full h-full bg-[#09090B] p-6 overflow-y-auto">
              <TransitionEditor
                selectedTransition={transitionType}
                durationSec={transitionDuration}
                onSelectTransition={setTransitionType}
                onChangeDuration={setTransitionDuration}
                onApplyToAll={() => {
                  setStatus({ ok: true, text: `Applied ${transitionType} (${transitionDuration}s) to all cut boundaries!` });
                }}
              />
            </div>
          )}

          {mode === "captions" && (
            <div className="w-full h-full bg-[#09090B] p-6 overflow-y-auto">
              <KineticCaptionEditor onCaptionsChange={setCaptionWords} />
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
                        transitionType,
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
        </div>
      </div>

    </div>
  );
}
