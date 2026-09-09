/**
 * File Description: Script & Narration Studio component for editing a director screenplay and synthesizing multi-provider voiceover audio directly from its spoken dialogue.
 */

import { useState, useEffect, useRef } from "react";
import type { Film } from "../../../src/dl/schema";

interface ScriptEditorProps {
  film: Film;
  onUpdateFilm: (film: Film) => void;
  onNavigateToVideo?: () => void;
}

const VOICES = [
  // KOKORO LOCAL NEURAL VOICES (ONNX)
  { id: "kokoro-am_adam", name: "⚡ Kokoro: Adam (Crisp Explainer - Male)", provider: "Kokoro Neural" },
  { id: "kokoro-af_bella", name: "⚡ Kokoro: Bella (Warm Narrative - Female)", provider: "Kokoro Neural" },
  { id: "kokoro-af_sarah", name: "⚡ Kokoro: Sarah (Clear Professional - Female)", provider: "Kokoro Neural" },
  { id: "kokoro-am_michael", name: "⚡ Kokoro: Michael (Deep Narrative - Male)", provider: "Kokoro Neural" },
  { id: "kokoro-af_nicole", name: "⚡ Kokoro: Nicole (Dynamic Tech - Female)", provider: "Kokoro Neural" },
  { id: "kokoro-am_echo", name: "⚡ Kokoro: Echo (Cinematic - Male)", provider: "Kokoro Neural" },

  // DEEPGRAM AURA NEURAL VOICES
  { id: "aura-helios-en", name: "⚡ Deepgram: Helios (Tech Lead - Male)", provider: "Deepgram Aura" },
  { id: "aura-asteria-en", name: "⚡ Deepgram: Asteria (Clear Narrative - Female)", provider: "Deepgram Aura" },
  { id: "aura-luna-en", name: "⚡ Deepgram: Luna (Warm Explainer - Female)", provider: "Deepgram Aura" },
  { id: "aura-orion-en", name: "⚡ Deepgram: Orion (Deep Narrative - Male)", provider: "Deepgram Aura" },
  { id: "aura-arcas-en", name: "⚡ Deepgram: Arcas (Calm Technical - Male)", provider: "Deepgram Aura" },
  { id: "aura-angus-en", name: "⚡ Deepgram: Angus (Dynamic Fast - Male)", provider: "Deepgram Aura" },
  { id: "aura-athena-en", name: "⚡ Deepgram: Athena (Polished Corporate - Female)", provider: "Deepgram Aura" },

  // MACOS SYSTEM VOICES
  { id: "macos-daniel", name: "🎙️ macOS: Daniel (UK English Male)", provider: "macOS System" },
  { id: "macos-samantha", name: "🎙️ macOS: Samantha (US English Female)", provider: "macOS System" },
  { id: "macos-alex", name: "🎙️ macOS: Alex (US Classic Male)", provider: "macOS System" },
  { id: "macos-eddy", name: "🎙️ macOS: Eddy (UK English Male)", provider: "macOS System" },
  { id: "macos-flo", name: "🎙️ macOS: Flo (UK English Female)", provider: "macOS System" },
];

/**
 * Calculates estimated speech duration in minutes and seconds from word count.
 */
function estimateDuration(wordCount: number): string {
  const totalSeconds = Math.round((wordCount / 150) * 60);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Extracts strictly the spoken dialogue from a director screenplay text as separate per-scene/shot paragraphs.
 */
export function extractSpokenBlocks(raw: string): string[] {
  const lines = raw.split("\n");
  const spokenParagraphs: string[] = [];
  let isCapturingVO = false;
  let currentVO: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.toLowerCase().startsWith("### production notes") ||
      line.toLowerCase().startsWith("## production notes") ||
      line.toLowerCase().startsWith("### notes") ||
      line.toLowerCase().startsWith("## notes")
    ) {
      break;
    }

    if (
      /^\*{0,2}VO\s*(\([^)]*\))?\s*:\*{0,2}/i.test(line) ||
      /^\*{0,2}Voiceover\s*(\([^)]*\))?\s*:\*{0,2}/i.test(line) ||
      /^\*{0,2}Narrator\s*(\([^)]*\))?\s*:\*{0,2}/i.test(line)
    ) {
      if (currentVO.length > 0) {
        spokenParagraphs.push(currentVO.join(" "));
        currentVO = [];
      }
      isCapturingVO = true;
      const afterTag = line
        .replace(/^\*{0,2}(VO|Voiceover|Narrator)\s*(\([^)]*\))?\s*:\*{0,2}\s*/i, "")
        .trim();
      if (afterTag) currentVO.push(afterTag);
      continue;
    }

    if (
      /^\*{0,2}(VISUAL|ON-SCREEN TEXT|SCREEN|GRAPHICS|AUDIO|SFX)\s*:\*{0,2}/i.test(line) ||
      /^#{1,4}\s+/.test(line) ||
      line === "---" ||
      line === "***"
    ) {
      if (isCapturingVO && currentVO.length > 0) {
        spokenParagraphs.push(currentVO.join(" "));
        currentVO = [];
      }
      isCapturingVO = false;
      continue;
    }

    if (isCapturingVO && line.length > 0) {
      currentVO.push(line);
    }
  }

  if (currentVO.length > 0) {
    spokenParagraphs.push(currentVO.join(" "));
  }

  if (spokenParagraphs.length > 0) {
    return spokenParagraphs
      .map((p) =>
        p
          .replace(/["“”]/g, "")
          .replace(/\*+/g, "")
          .replace(/\u2014/g, " - ")
          .replace(/\u2013/g, " - ")
          .trim()
      )
      .filter(Boolean);
  }

  const fallback = raw
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\u2014/g, " - ")
    .replace(/\u2013/g, " - ")
    .trim();

  return fallback.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Extracts strictly the spoken dialogue from a director screenplay text as single joined string.
 */
function extractSpokenPreview(raw: string): string {
  return extractSpokenBlocks(raw).join("\n\n");
}

/**
 * Script & Narration Editor component with screenplay parsing and direct voiceover synthesis from the screenplay's spoken dialogue.
 */
export function ScriptEditor({ film, onUpdateFilm, onNavigateToVideo }: ScriptEditorProps) {
  const [script, setScript] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [buildingScenes, setBuildingScenes] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("kokoro-am_adam");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"screenplay" | "spoken">("screenplay");
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);

  // Load existing script and audio on mount or when active film changes
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetch(`/api/scripts/${film.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.ok && data.script) {
          setScript(data.script);
        } else {
          const defaultScript = `# ${film.title}\n\n` +
            film.shots.map((s, idx) => {
              const body = s.blocks.map(b => "text" in b ? b.text : "label" in b ? b.label : "").filter(Boolean).join(" ");
              return `## Scene ${idx + 1} (${s.id})\n${body || "Describe the visual action and narration for this shot."}\n`;
            }).join("\n");
          setScript(defaultScript);
        }
        setLoading(false);
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    // Check if voiceover audio already exists on disk
    const existingAudio = film.voiceover?.src || `/voiceover_${film.id}.wav`;
    fetch(existingAudio, { method: "HEAD" })
      .then((res) => {
        if (isMounted && res.ok) {
          setAudioUrl(`${existingAudio}?t=${Date.now()}`);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [film.id]);

  // Compute word counts and duration
  const spokenText = extractSpokenPreview(script);
  const spokenWords = spokenText.split(/\s+/).filter(Boolean);
  const totalWords = script.split(/\s+/).filter(Boolean);
  const hasVOTags = /^\*{0,2}(?:VO|Voiceover|Narrator)\s*(\([^)]*\))?\s*:\*{0,2}/im.test(script);

  /**
   * Saves the current script text to disk under scripts/<projectId>.md.
   */
  const handleSaveScript = async () => {
    setSaving(true);
    setStatusMsg({ type: "info", text: "Saving screenplay script to disk..." });
    try {
      const res = await fetch(`/api/scripts/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save script");
      setStatusMsg({ type: "success", text: `✓ Script saved to ${data.file}` });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `Error: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Parses director timestamps, on-screen text, and visual directions into Remotion shots.
   */
  const handleAutoBuildScenes = async () => {
    if (!script.trim()) {
      setStatusMsg({ type: "error", text: "Please enter a script before building scenes." });
      return;
    }
    setBuildingScenes(true);
    setStatusMsg({ type: "info", text: "✨ Parsing screenplay into video scenes, visual metaphors, and canvas nodes..." });
    try {
      const res = await fetch("/api/parse-script-scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, filmTitle: film.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse scenes");

      const updatedFilm: Film = {
        ...film,
        canvas: {
          nodes: data.nodes.length > 0 ? data.nodes : film.canvas.nodes,
          edges: data.edges.length > 0 ? data.edges : film.canvas.edges,
        },
        shots: data.shots.length > 0 ? data.shots : film.shots,
      };

      onUpdateFilm(updatedFilm);

      await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film: updatedFilm }),
      });

      setStatusMsg({
        type: "success",
        text: `🎉 Successfully built ${data.shots.length} video scenes and graph nodes from screenplay!`,
      });
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `Scene parsing error: ${err.message}` });
    } finally {
      setBuildingScenes(false);
    }
  };

  /**
   * Synthesizes ONLY the spoken dialogue lines from the screenplay into a studio-grade .wav audio file.
   */
  const handleGenerateVoiceover = async () => {
    if (!script.trim()) {
      setStatusMsg({ type: "error", text: "Please enter some script text before generating voiceover." });
      return;
    }
    setGenerating(true);
    setStatusMsg({
      type: "info",
      text: `🎙️ Synthesizing voiceover (${spokenWords.length} words, ~${estimateDuration(spokenWords.length)}) using ${selectedVoice}...`,
    });
    try {
      const res = await fetch("/api/generate-voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          voice: selectedVoice,
          projectId: film.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Voice synthesis failed");

      setAudioUrl(data.audioSrc);
      setViewMode("spoken");
      setStatusMsg({
        type: "success",
        text: `🎉 Voiceover synthesized from screenplay (${data.spokenWordCount} spoken words, ${data.estimatedDurationSec}s)!`,
      });

      const updatedFilm: Film = data.film || {
        ...film,
        shots: data.shots || film.shots,
        voiceover: {
          src: data.filename,
          volume: 1.0,
          version: Date.now().toString(),
          speed: film.voiceover?.speed ?? 1.0,
        },
        audioClips: undefined, // Clear stale clip overrides so fresh voiceover spine takes effect across the player
      };
      onUpdateFilm(updatedFilm);

      if (audioRef.current) {
        audioRef.current.load();
        audioRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `Synthesis error: ${err.message}` });
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Toggles audio playback for the generated voiceover track.
   */
  const togglePlayAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  /**
   * Formats seconds into mm:ss timestamp format.
   */
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds === 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full h-full bg-[#0A0A0B] text-[#F5F5F5] flex flex-col p-6 overflow-y-auto font-sans">
      
      {/* Top Header & Project Metadata */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#222]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📝</span>
            <h2 className="text-xl font-bold tracking-tight">Script & Voiceover Studio</h2>
            <span className="text-xs bg-[#1E1E24] text-[#8A8A8E] border border-[#333] px-2.5 py-0.5 rounded-full font-mono">
              {film.id}
            </span>
          </div>
          <p className="text-xs text-[#8A8A8E] mt-1">
            Write or paste your director screenplay, then generate voiceover directly from its spoken dialogue.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleSaveScript}
            disabled={saving || loading}
            className="text-xs px-3.5 py-1.5 rounded bg-[#1A1A1E] hover:bg-[#25252D] border border-[#333] text-white font-bold transition-all disabled:opacity-50"
          >
            {saving ? "Saving..." : "💾 Save Script"}
          </button>
          
          <button
            onClick={handleAutoBuildScenes}
            disabled={buildingScenes || loading || !script.trim()}
            className="text-xs px-3.5 py-1.5 rounded bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
            title="Automatically parse timestamped scenes, visual cues, and on-screen text into video shots"
          >
            <span>{buildingScenes ? "⏳" : "✨"}</span>
            <span>{buildingScenes ? "Parsing Scenes..." : "Auto-Build Scenes from Script"}</span>
          </button>

          <button
            onClick={handleGenerateVoiceover}
            disabled={generating || loading || !script.trim()}
            className="text-xs px-4 py-1.5 rounded font-bold flex items-center gap-1.5 shadow-lg transition-all disabled:opacity-50 active:scale-95 bg-[#635BFF] hover:bg-[#5249e6] text-white shadow-[#635BFF]/20"
          >
            <span className={generating ? "animate-spin" : ""}>🎙️</span>
            <span>{generating ? "Synthesizing Audio..." : "Generate Voiceover (.wav)"}</span>
          </button>
        </div>
      </div>

      {/* Status banner */}
      {statusMsg && (
        <div
          className={`mt-4 p-3 rounded-lg border text-xs font-medium flex items-center justify-between transition-all ${
            statusMsg.type === "success"
              ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
              : statusMsg.type === "error"
              ? "bg-red-950/40 border-red-800 text-red-300"
              : "bg-blue-950/40 border-blue-800 text-blue-300"
          }`}
        >
          <span>{statusMsg.text}</span>
          <button onClick={() => setStatusMsg(null)} className="text-gray-400 hover:text-white px-2">×</button>
        </div>
      )}

      {/* Main Grid: Script Editor + Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6 flex-1 min-h-0">
        
        {/* LEFT 3 COLS: Big Screenplay Editor */}
        <div className="lg:col-span-3 flex flex-col gap-3 min-h-[420px]">
          
          {/* Editor Header Bar with Multi-View Switcher */}
          <div className="flex items-center justify-between bg-[#121216] border border-[#26262E] px-4 py-2 rounded-t-lg flex-wrap gap-2">
            <div className="flex items-center gap-4 text-xs text-[#8A8A8E]">
              <span>
                <strong>Spoken VO:</strong>{" "}
                <span className="text-emerald-400 font-mono font-bold">{spokenWords.length} words</span>
              </span>
              <span>
                <strong>Total Script:</strong>{" "}
                <span className="text-gray-300 font-mono font-bold">{totalWords.length} words</span>
              </span>
              <span>
                <strong>Duration:</strong>{" "}
                <span className="text-[#635BFF] font-mono font-bold">{estimateDuration(spokenWords.length)}</span>
              </span>
              {hasVOTags && (
                <span className="text-[11px] bg-emerald-950/60 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800 font-medium">
                  ✓ Screenplay Separated
                </span>
              )}
            </div>

            {/* View Mode Toggle: Screenplay vs Spoken Text */}
            <div className="flex items-center gap-1 bg-[#1A1A22] p-0.5 rounded border border-[#333]">
              <button
                onClick={() => setViewMode("screenplay")}
                className={`text-[11px] px-2.5 py-1 rounded font-medium transition-all ${
                  viewMode === "screenplay" ? "bg-[#635BFF] text-white font-bold" : "text-gray-400 hover:text-white"
                }`}
                title="Full director screenplay editor with visual cues and scene headers"
              >
                📝 Full Screenplay
              </button>
              <button
                onClick={() => setViewMode("spoken")}
                className={`text-[11px] px-2.5 py-1 rounded font-medium transition-all ${
                  viewMode === "spoken" ? "bg-[#635BFF] text-white font-bold" : "text-gray-400 hover:text-white"
                }`}
                title="Preview strictly the dialogue lines that will be spoken by AI"
              >
                🎙️ Spoken Text
              </button>
            </div>
          </div>

          {/* Text / Spoken Preview Area */}
          <div className="flex-1 relative bg-[#121216] border-x border-b border-[#26262E] rounded-b-lg overflow-hidden flex flex-col">

            {/* VIEW MODE 1: FULL SCREENPLAY EDITOR */}
            {viewMode === "screenplay" && (
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your director script here with ## [timestamp] headers, **VISUAL:** notes, **ON-SCREEN TEXT:** and **VO:** dialogue..."
                className="w-full h-full min-h-[380px] p-4 bg-transparent text-[#F5F5F5] font-mono text-sm leading-relaxed outline-none resize-none selection:bg-[#635BFF]/30 placeholder:text-gray-600"
                spellCheck={false}
              />
            )}

            {/* VIEW MODE 2: SPOKEN TEXT ONLY */}
            {viewMode === "spoken" && (
              <div className="w-full h-full min-h-[380px] p-4 bg-[#0E0E12] text-[#F5F5F5] font-mono text-sm leading-relaxed overflow-y-auto">
                <div className="p-3 bg-emerald-950/30 border border-emerald-900/60 rounded-lg text-xs text-emerald-300 mb-4">
                  💡 This is the exact dialogue synthesized by the voice engine. Visual directions and notes are excluded from speech.
                </div>
                <div className="whitespace-pre-wrap text-gray-200">
                  {spokenText || "No spoken dialogue detected. Add **VO:** blocks or plain script text."}
                </div>
              </div>
            )}

          </div>

          {/* AUDIO PLAYER EMBEDDED BELOW SCRIPT */}
          {audioUrl && (
            <div className="mt-2 bg-[#121216] border border-[#2E2E38] rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#635BFF]/20 text-[#635BFF] flex items-center justify-center font-bold text-sm">
                    🔊
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Generated Voiceover Audio</h4>
                    <p className="text-xs text-[#8A8A8E] font-mono">
                      public/voiceover_{film.id}.wav ({formatTime(duration)}) · {spokenWords.length} spoken words
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={audioUrl}
                    download={`voiceover_${film.id}.wav`}
                    className="text-xs px-3 py-1.5 rounded bg-[#1A1A22] hover:bg-[#252530] border border-[#333] text-gray-300 hover:text-white font-medium flex items-center gap-1"
                  >
                    <span>📥</span> Download .wav
                  </a>
                  {onNavigateToVideo && (
                    <button
                      onClick={() => {
                        if (audioRef.current) {
                          audioRef.current.pause();
                          setIsPlaying(false);
                        }
                        onNavigateToVideo();
                      }}
                      className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1"
                    >
                      <span>🎬</span> View in Video Player
                    </button>
                  )}
                </div>
              </div>

              {/* Hidden Native Audio Element */}
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={() => {
                  if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
                }}
                onLoadedMetadata={() => {
                  if (audioRef.current) setDuration(audioRef.current.duration);
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  setIsPlaying(false);
                  setCurrentTime(0);
                }}
              />

              {/* Custom High-Fidelity Audio Controls */}
              <div className="flex items-center gap-4 bg-[#0A0A0E] border border-[#222] p-3 rounded-lg">
                <button
                  onClick={togglePlayAudio}
                  className="w-10 h-10 rounded-full bg-[#635BFF] hover:bg-[#5249e6] text-white flex items-center justify-center font-bold text-sm shadow-md transition-all active:scale-95 shrink-0"
                  title={isPlaying ? "Pause audio" : "Play voiceover"}
                >
                  {isPlaying ? "⏸" : "▶"}
                </button>

                <span className="text-xs font-mono text-[#8A8A8E] w-12 text-right">
                  {formatTime(currentTime)}
                </span>

                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => {
                    const newTime = parseFloat(e.target.value);
                    setCurrentTime(newTime);
                    if (audioRef.current) audioRef.current.currentTime = newTime;
                  }}
                  className="flex-1 accent-[#635BFF] cursor-pointer h-1.5 bg-[#222] rounded-lg"
                />

                <span className="text-xs font-mono text-white w-12">
                  {formatTime(duration)}
                </span>

                <div className="flex items-center gap-1 bg-[#1A1A20] p-0.5 rounded border border-[#333]">
                  {[1.0, 1.25, 1.5].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => {
                        setPlaybackRate(speed);
                        if (audioRef.current) audioRef.current.playbackRate = speed;
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                        playbackRate === speed ? "bg-[#635BFF] text-white font-bold" : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT 1 COL: Voice Settings & Workflow Guide */}
        <div className="flex flex-col gap-4">
          
          {/* Voice Model Selector Card */}
          <div className="bg-[#121216] border border-[#26262E] rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>🎙️</span> AI Voice Synthesis Engine
            </h3>
            <p className="text-xs text-[#8A8A8E]">
              Select from Kokoro ONNX, Deepgram Aura, or macOS neural voices:
            </p>

            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="w-full bg-[#1A1A20] border border-[#333] rounded-lg p-2.5 text-xs text-white outline-none focus:border-[#635BFF] font-medium"
            >
              <optgroup label="Kokoro Local Neural (ONNX)">
                {VOICES.filter(v => v.provider === "Kokoro Neural").map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </optgroup>
              <optgroup label="Deepgram Aura Neural">
                {VOICES.filter(v => v.provider === "Deepgram Aura").map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </optgroup>
              <optgroup label="macOS System High-Definition">
                {VOICES.filter(v => v.provider === "macOS System").map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </optgroup>
            </select>

            <div className="p-2.5 rounded bg-[#181820] border border-[#2A2A35] text-[11px] text-[#8A8A8E] space-y-1">
              <div>• <strong>Pacing:</strong> Spoken only at ~150 wpm (~{estimateDuration(spokenWords.length)})</div>
              <div>• <strong>Location:</strong> <code className="text-gray-300">public/voiceover_{film.id}.wav</code></div>
            </div>
          </div>

          {/* Screenplay Workflow Card */}
          <div className="bg-[#121216] border border-[#26262E] rounded-xl p-4 flex flex-col gap-3 text-xs text-[#8A8A8E]">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>🎬</span> Screenplay Workflow Guide
            </h3>
            <ul className="space-y-2 list-disc list-inside text-[11px]">
              <li><strong>Write dialogue:</strong> Use **VO:**, **Voiceover:**, or **Narrator:** tags per scene.</li>
              <li><strong>Preview:</strong> Switch to Spoken Text to see exactly what will be synthesized.</li>
              <li><strong>Generate Voiceover:</strong> Synthesizes the screenplay's spoken dialogue directly.</li>
            </ul>
          </div>
        </div>

      </div>

    </div>
  );
}
