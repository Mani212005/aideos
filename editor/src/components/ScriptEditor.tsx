/**
 * File Description: Script & Narration Studio component for editing a director screenplay and synthesizing multi-provider voiceover audio directly from its spoken dialogue.
 */

import { useState, useEffect, useRef } from "react";
import {
  FileEdit,
  FileText,
  Mic,
  Save,
  Sparkles,
  Loader2,
  X,
  Volume2,
  Download,
  Film as FilmIcon,
  Play,
  Pause,
  Clapperboard,
  CheckCircle2,
  LayoutGrid,
  Plus,
  Trash2,
  Eye,
  Camera,
  Bot,
  Copy,
  Check,
  ArrowRight,
} from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import {
  parseClaudeScript,
  serializeSegmentsToScript,
  extractSpokenBlocks as extractSpokenBlocksShared,
  hasScreenplayTags,
  generateAgentPrompt,
} from "../../../backend/scriptIntake";
import type { ScriptSegment, BeatType } from "../../../backend/scriptIntake";

interface ScriptEditorProps {
  film: Film;
  onUpdateFilm: (film: Film) => void;
  onNavigateToVideo?: () => void;
}

const VOICES = [
  // KOKORO LOCAL NEURAL VOICES (ONNX)
  {
    id: "kokoro-am_adam",
    name: "Kokoro: Adam (Crisp Explainer - Male)",
    provider: "Kokoro Neural",
  },
  {
    id: "kokoro-af_bella",
    name: "Kokoro: Bella (Warm Narrative - Female)",
    provider: "Kokoro Neural",
  },
  {
    id: "kokoro-af_sarah",
    name: "Kokoro: Sarah (Clear Professional - Female)",
    provider: "Kokoro Neural",
  },
  {
    id: "kokoro-am_michael",
    name: "Kokoro: Michael (Deep Narrative - Male)",
    provider: "Kokoro Neural",
  },
  {
    id: "kokoro-af_nicole",
    name: "Kokoro: Nicole (Dynamic Tech - Female)",
    provider: "Kokoro Neural",
  },
  {
    id: "kokoro-am_echo",
    name: "Kokoro: Echo (Cinematic - Male)",
    provider: "Kokoro Neural",
  },

  // DEEPGRAM AURA NEURAL VOICES
  {
    id: "aura-helios-en",
    name: "Deepgram: Helios (Tech Lead - Male)",
    provider: "Deepgram Aura",
  },
  {
    id: "aura-asteria-en",
    name: "Deepgram: Asteria (Clear Narrative - Female)",
    provider: "Deepgram Aura",
  },
  {
    id: "aura-luna-en",
    name: "Deepgram: Luna (Warm Explainer - Female)",
    provider: "Deepgram Aura",
  },
  {
    id: "aura-orion-en",
    name: "Deepgram: Orion (Deep Narrative - Male)",
    provider: "Deepgram Aura",
  },
  {
    id: "aura-arcas-en",
    name: "Deepgram: Arcas (Calm Technical - Male)",
    provider: "Deepgram Aura",
  },
  {
    id: "aura-angus-en",
    name: "Deepgram: Angus (Dynamic Fast - Male)",
    provider: "Deepgram Aura",
  },
  {
    id: "aura-athena-en",
    name: "Deepgram: Athena (Polished Corporate - Female)",
    provider: "Deepgram Aura",
  },

  // MACOS SYSTEM VOICES
  {
    id: "macos-daniel",
    name: "macOS: Daniel (UK English Male)",
    provider: "macOS System",
  },
  {
    id: "macos-samantha",
    name: "macOS: Samantha (US English Female)",
    provider: "macOS System",
  },
  {
    id: "macos-alex",
    name: "macOS: Alex (US Classic Male)",
    provider: "macOS System",
  },
  {
    id: "macos-eddy",
    name: "macOS: Eddy (UK English Male)",
    provider: "macOS System",
  },
  {
    id: "macos-flo",
    name: "macOS: Flo (UK English Female)",
    provider: "macOS System",
  },
];

/**
 * Extracts strictly the spoken dialogue from a director screenplay text as separate per-scene/shot paragraphs.
 */
export function extractSpokenBlocks(raw: string): string[] {
  return extractSpokenBlocksShared(raw);
}

/**
 * Script & Narration Editor component with screenplay parsing and direct voiceover synthesis from the screenplay's spoken dialogue.
 */
export function ScriptEditor({
  film,
  onUpdateFilm,
  onNavigateToVideo,
}: ScriptEditorProps) {
  const [script, setScript] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [buildingScenes, setBuildingScenes] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("kokoro-am_adam");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"screenplay" | "studio">(
    "screenplay",
  );
  const [segments, setSegments] = useState<ScriptSegment[]>([]);
  const [statusMsg, setStatusMsg] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Agent Directing Directive & Prompt state
  const [agentDirective, setAgentDirective] = useState<{
    prompt: string;
    taskFile?: string;
    shotCount?: number;
    durationSec?: number;
  } | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [promptingAgent, setPromptingAgent] = useState<boolean>(false);
  const [lastDispatchResult, setLastDispatchResult] = useState<{
    channel: string;
    message: string;
    session?: string;
  } | null>(null);

  const copyToClipboard = (text: string) => {
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 3000);
    }
  };

  const handlePromptAgentDirectly = async (customInstruction?: string) => {
    setPromptingAgent(true);
    setStatusMsg({
      type: "info",
      text: "⚡ Auto-prompter is transmitting directing instructions to your terminal coding agent...",
    });

    try {
      const res = await fetch("/api/prompt-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filmId: film.id,
          filmTitle: film.title,
          event: customInstruction ? "custom_directive" : "auto_build_scenes",
          customInstruction,
          script,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to prompt agent");

      if (data.dispatch) {
        setLastDispatchResult(data.dispatch);
        setStatusMsg({
          type: "success",
          text: `⚡ ${data.dispatch.message || "Auto-prompted active coding agent in terminal!"}`,
        });
      }
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: `Auto-prompter error: ${err.message}`,
      });
    } finally {
      setPromptingAgent(false);
    }
  };

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);

  // Keep the latest film available to the film-switch effect without forcing it to re-run on every edit
  const filmRef = useRef(film);
  useEffect(() => {
    filmRef.current = film;
  }, [film]);

  // Load existing script and audio on mount or when active film changes
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    const currentFilm = filmRef.current;
    fetch(`/api/scripts/${film.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.ok && data.script) {
          setScript(data.script);
        } else {
          const defaultScript =
            `# ${currentFilm.title}\n\n` +
            currentFilm.shots
              .map((s, idx) => {
                const body = s.blocks
                  .map((b) =>
                    "text" in b ? b.text : "label" in b ? b.label : "",
                  )
                  .filter(Boolean)
                  .join(" ");
                return `## Scene ${idx + 1} (${s.id})\n${body || "Describe the visual action and narration for this shot."}\n`;
              })
              .join("\n");
          setScript(defaultScript);
        }
        setLoading(false);
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    // Check if voiceover audio already exists on disk
    const existingAudio =
      currentFilm.voiceover?.src || `videos/${film.id}/voiceover.wav`;
    fetch(existingAudio, { method: "HEAD" })
      .then((res) => {
        if (isMounted && res.ok) {
          setAudioUrl(`${existingAudio}?t=${Date.now()}`);
        }
      })
      .catch(() => {});

    const audio = audioRef.current;
    return () => {
      isMounted = false;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, [film.id]);

  // Compute word counts and structured screenplay status
  const spokenBlocks = extractSpokenBlocks(script);
  const spokenText = spokenBlocks.join(" ");
  const spokenWords = spokenText.split(/\s+/).filter(Boolean);
  const totalWords = script.split(/\s+/).filter(Boolean);
  const isStructured = hasScreenplayTags(script);

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
      setStatusMsg({ type: "success", text: `Script saved to ${data.file}` });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `Error: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Re-parses the raw screenplay markdown into segment cards and switches to Visual Studio view.
   */
  const switchToStudio = () => {
    setSegments(parseClaudeScript(script));
    setViewMode("studio");
  };

  /**
   * Applies a new segment list to state and immediately re-serializes it back into the raw markdown script.
   */
  const updateSegments = (next: ScriptSegment[]) => {
    setSegments(next);
    setScript(serializeSegmentsToScript(next));
  };

  /**
   * Updates a segment's title text and keeps the raw markdown in sync.
   */
  const updateSegmentTitle = (segIdx: number, title: string) => {
    updateSegments(
      segments.map((s, i) => (i === segIdx ? { ...s, title } : s)),
    );
  };

  /**
   * Updates one beat's body text within a segment and keeps the raw markdown in sync.
   */
  const updateBeatText = (segIdx: number, beatIdx: number, text: string) => {
    updateSegments(
      segments.map((s, si) =>
        si !== segIdx
          ? s
          : {
              ...s,
              beats: s.beats.map((b, bi) =>
                bi === beatIdx ? { ...b, text } : b,
              ),
            },
      ),
    );
  };

  /**
   * Appends a new empty beat of the given type to a segment.
   */
  const addBeat = (segIdx: number, type: BeatType) => {
    updateSegments(
      segments.map((s, si) =>
        si !== segIdx ? s : { ...s, beats: [...s.beats, { type, text: "" }] },
      ),
    );
  };

  /**
   * Removes one beat from a segment.
   */
  const removeBeat = (segIdx: number, beatIdx: number) => {
    updateSegments(
      segments.map((s, si) =>
        si !== segIdx
          ? s
          : { ...s, beats: s.beats.filter((_, bi) => bi !== beatIdx) },
      ),
    );
  };

  /**
   * Appends a fresh, empty segment card to the screenplay.
   */
  const addSegment = () => {
    const nextIndex = segments.length + 1;
    updateSegments([
      ...segments,
      { id: `segment-${nextIndex}`, title: `Segment ${nextIndex}`, beats: [] },
    ]);
  };

  /**
   * Removes a segment card entirely from the screenplay.
   */
  const removeSegment = (segIdx: number) => {
    updateSegments(segments.filter((_, i) => i !== segIdx));
  };

  /**
   * Parses director timestamps, on-screen text, and visual directions into Remotion shots.
   */
  const handleAutoBuildScenes = async () => {
    if (!script.trim()) {
      setStatusMsg({
        type: "error",
        text: "Please enter a script before building scenes.",
      });
      return;
    }
    setBuildingScenes(true);
    setStatusMsg({
      type: "info",
      text: "Parsing screenplay into video scenes, visual metaphors, and canvas nodes...",
    });
    try {
      const res = await fetch("/api/parse-script-scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          filmTitle: film.title,
          targetDurationSec: film.voiceover?.durationSec,
        }),
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
      setSegments(parseClaudeScript(script));

      await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film: updatedFilm }),
      });

      const prompt = data.agentPrompt || generateAgentPrompt({
        projectId: film.id,
        filmTitle: film.title,
        shotCount: data.shots?.length || film.shots.length,
        durationSec: data.durationSec || film.voiceover?.durationSec,
      });

      setAgentDirective({
        prompt,
        taskFile: data.taskFile || `videos/${film.id}/director_task.md`,
        shotCount: data.shots?.length || film.shots.length,
        durationSec: data.durationSec || film.voiceover?.durationSec,
      });

      if (data.dispatch) {
        setLastDispatchResult(data.dispatch);
      }

      setStatusMsg({
        type: "success",
        text: data.dispatch?.ok
          ? `⚡ Built ${data.shots.length} scenes & ${data.dispatch.message}`
          : `Successfully built ${data.shots.length} video scenes and graph nodes from screenplay!`,
      });
      setTimeout(() => setStatusMsg(null), 6000);
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: `Scene parsing error: ${err.message}`,
      });
    } finally {
      setBuildingScenes(false);
    }
  };

  /**
   * Synthesizes ONLY the spoken dialogue lines from the screenplay into a studio-grade .wav audio file.
   */
  const handleGenerateVoiceover = async () => {
    if (!script.trim()) {
      setStatusMsg({
        type: "error",
        text: "Please enter some script text before generating voiceover.",
      });
      return;
    }
    setGenerating(true);
    setStatusMsg({
      type: "info",
      text: `Synthesizing voiceover (${spokenWords.length} spoken words) using ${selectedVoice}...`,
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
      if (data.actualDurationSec) {
        setDuration(data.actualDurationSec);
      }

      const updatedFilm: Film = data.film || {
        ...film,
        shots: data.shots || film.shots,
        voiceover: {
          src: data.filename,
          volume: 1.0,
          version: Date.now().toString(),
          speed: film.voiceover?.speed ?? 1.0,
          durationSec: data.actualDurationSec || data.estimatedDurationSec,
        },
        audioClips: undefined, // Clear stale clip overrides so fresh voiceover spine takes effect across the player
      };
      onUpdateFilm(updatedFilm);

      const prompt = data.agentPrompt || generateAgentPrompt({
        projectId: film.id,
        filmTitle: film.title,
        shotCount: data.shots?.length || updatedFilm.shots.length,
        durationSec: data.actualDurationSec || data.estimatedDurationSec,
      });

      setAgentDirective({
        prompt,
        taskFile: data.taskFile || `videos/${film.id}/director_task.md`,
        shotCount: data.shots?.length || updatedFilm.shots.length,
        durationSec: data.actualDurationSec || data.estimatedDurationSec,
      });

      if (data.dispatch) {
        setLastDispatchResult(data.dispatch);
      }

      setStatusMsg({
        type: "success",
        text: data.dispatch?.ok
          ? `⚡ Synthesized voiceover (${data.actualDurationSec ? data.actualDurationSec.toFixed(1) : data.estimatedDurationSec}s) & ${data.dispatch.message}`
          : `Voiceover synthesized from screenplay (${data.spokenWordCount} spoken words, ${data.actualDurationSec ? data.actualDurationSec.toFixed(1) : data.estimatedDurationSec}s actual duration)!`,
      });

      // Persist the updated film with voiceover to server
      await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film: updatedFilm }),
      }).catch(() => {});

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
    <div className="w-full h-full bg-paper text-ink flex flex-col p-6 overflow-y-auto font-sans">
      {/* Top Header & Project Metadata */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b-2 border-ink">
        <div>
          <div className="flex items-center gap-2">
            <FileEdit size={18} className="text-select-text" />
            <h2 className="text-xl font-extrabold tracking-[-0.02em]">
              Script & Voiceover Studio
            </h2>
            <span className="text-xs bg-paper-3 text-ink-soft border-2 border-ink px-2.5 py-0.5 font-mono shadow-nb-sm">
              {film.id}
            </span>
          </div>
          <p className="text-xs text-ink-soft mt-1">
            Write or paste your director screenplay, then generate voiceover
            and auto-prompt the terminal AI coding agent.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={handleSaveScript}
            disabled={saving || loading}
            className="inline-flex h-8 items-center gap-1.5 border-2 border-ink px-3 font-sans text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:pointer-events-none disabled:opacity-40 bg-paper-3 text-ink"
          >
            {saving ? (
              "Saving..."
            ) : (
              <>
                <Save size={13} /> Save Script
              </>
            )}
          </button>

          <button
            onClick={handleAutoBuildScenes}
            disabled={buildingScenes || loading || !script.trim()}
            className="inline-flex h-8 items-center gap-1.5 border-2 border-ink px-3 font-sans text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:pointer-events-none disabled:opacity-40 bg-warn text-ink"
            title="Automatically parse timestamped scenes into video shots and dispatch to terminal AI agent"
          >
            {buildingScenes ? (
              <Loader2 size={13} className="animate-spin text-ink" />
            ) : (
              <Sparkles size={13} className="text-ink" />
            )}
            <span>
              {buildingScenes
                ? "Parsing & Prompting..."
                : "Auto-Build Scenes from Script"}
            </span>
          </button>

          <button
            onClick={() => handlePromptAgentDirectly()}
            disabled={promptingAgent || loading}
            className="inline-flex h-8 items-center gap-1.5 border-2 border-ink px-3 font-sans text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:pointer-events-none disabled:opacity-40 bg-info/40 text-ink"
            title="Automatically dispatch current directing prompt into active terminal coding agent in tmux session"
          >
            {promptingAgent ? (
              <Loader2 size={13} className="animate-spin text-ink" />
            ) : (
              <Bot size={13} className="text-ink" />
            )}
            <span>{promptingAgent ? "Prompting..." : "⚡ Auto-Prompt Agent"}</span>
          </button>

          <button
            onClick={handleGenerateVoiceover}
            disabled={generating || loading || !script.trim()}
            className="inline-flex h-8 items-center gap-1.5 border-2 border-ink px-3 font-sans text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:pointer-events-none disabled:opacity-40 bg-primary text-ink"
          >
            <Mic size={13} className={generating ? "animate-pulse" : ""} />
            <span>
              {generating
                ? "Synthesizing Audio..."
                : "Generate Voiceover (.wav)"}
            </span>
          </button>
        </div>
      </div>

      {/* Live Auto-Prompter Dispatch Status */}
      {lastDispatchResult && (
        <div className="mt-3 px-3.5 py-2.5 bg-success/20 border-2 border-ink flex items-center justify-between font-mono text-xs shadow-nb-sm animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-success animate-ping" />
            <span className="font-bold text-ink">AUTO-PROMPTER:</span>
            <span className="text-ink">{lastDispatchResult.message}</span>
          </div>
          <button
            onClick={() => setLastDispatchResult(null)}
            className="text-ink-soft hover:text-ink text-xs ml-2 p-0.5"
            title="Dismiss status"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Agent Directing Bridge Banner */}
      {agentDirective && (
        <div className="mt-4 bg-paper-2 border-2 border-ink p-4 shadow-nb flex flex-col gap-3 font-sans animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-primary border-2 border-ink text-ink shadow-nb-sm">
                <Bot size={18} />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-ink tracking-tight flex items-center gap-2">
                  <span>🎬 Agent Directing Prompt Ready</span>
                  <span className="text-[10px] font-mono bg-success/25 border border-ink text-ink px-1.5 py-0.5 font-bold">
                    ACTIVE DIRECTIVE
                  </span>
                </h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  Narration audio spine and base scene timing are compiled. Pass this directive to the coding agent in your terminal to design the visual metaphors, custom SVGs, and B-roll.
                </p>
              </div>
            </div>
            <button
              onClick={() => setAgentDirective(null)}
              className="text-ink-soft hover:text-ink p-1"
              title="Dismiss directive banner"
            >
              <X size={16} />
            </button>
          </div>

          <div className="relative bg-sunken border-2 border-ink p-3 rounded-none">
            <pre className="text-xs font-mono text-ink whitespace-pre-wrap select-all leading-relaxed overflow-x-auto max-h-36">
              {agentDirective.prompt}
            </pre>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => copyToClipboard(agentDirective.prompt)}
                className="inline-flex h-8 items-center gap-1.5 border-2 border-ink px-3 font-sans text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none bg-primary text-ink"
              >
                {copiedPrompt ? (
                  <>
                    <Check size={13} className="text-ink" />
                    <span>Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} className="text-ink" />
                    <span>Copy Agent Prompt</span>
                  </>
                )}
              </button>
              {agentDirective.taskFile && (
                <span className="text-[11px] font-mono text-ink-soft">
                  Saved: <span className="font-bold text-ink">{agentDirective.taskFile}</span> & <span className="font-bold text-ink">.aideos_task.md</span>
                </span>
              )}
            </div>

            {onNavigateToVideo && (
              <button
                onClick={onNavigateToVideo}
                className="inline-flex h-8 items-center gap-1.5 border-2 border-ink px-3 font-sans text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none bg-paper-3 text-ink"
              >
                <span>Open Studio Timeline</span>
                <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status banner */}
      {statusMsg && (
        <div
          className={`mt-4 p-3 border text-xs font-medium flex items-center justify-between transition-all ${
            statusMsg.type === "success"
              ? "bg-success/25 border-2 border-ink text-ink"
              : statusMsg.type === "error"
                ? "bg-danger/25 border-2 border-ink text-ink"
                : "bg-info/25 border-2 border-ink text-ink"
          }`}
        >
          <span>{statusMsg.text}</span>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-ink-soft hover:text-ink px-2"
          >
            <X size={14} className="hover:text-ink" />
          </button>
        </div>
      )}

      {/* Main Grid: Script Editor + Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6 flex-1 min-h-0">
        {/* LEFT 3 COLS: Big Screenplay Editor */}
        <div className="lg:col-span-3 flex flex-col gap-3 min-h-[420px]">
          {/* Editor Header Bar with Multi-View Switcher */}
          <div className="flex items-center justify-between bg-paper-3 border-2 border-ink px-4 py-2 flex-wrap gap-2 shadow-nb-sm">
            <div className="flex items-center gap-4 text-xs text-ink-soft">
              <span>
                <strong>Spoken VO:</strong>{" "}
                <span className="text-ink font-mono font-bold">
                  {spokenWords.length} words
                </span>
              </span>
              <span>
                <strong>Total Script:</strong>{" "}
                <span className="text-ink font-mono font-bold">
                  {totalWords.length} words
                </span>
              </span>
              <span>
                <strong>Duration:</strong>{" "}
                {duration > 0 ? (
                  <span className="text-ink font-mono font-bold">
                    {formatTime(duration)}
                  </span>
                ) : (
                  <span className="text-ink-soft font-mono italic">
                    --:-- (Pending VO)
                  </span>
                )}
              </span>
              {isStructured && (
                <span className="text-[11px] bg-success/25 text-ink px-2 py-0.5 border-2 border-ink font-medium flex items-center gap-1 shadow-nb-sm">
                  <CheckCircle2 size={12} /> Screenplay Structured
                </span>
              )}
            </div>

            {/* View Mode Toggle: Screenplay vs Visual Studio */}
            <div className="flex items-center gap-1 bg-paper-3 p-0.5 border-2 border-ink shadow-nb-sm">
              <button
                onClick={() => setViewMode("screenplay")}
                className={`text-[11px] px-2.5 py-1 font-medium flex items-center gap-1.5 transition-all ${
                  viewMode === "screenplay"
                    ? "bg-select text-select-ink font-bold"
                    : "text-ink-soft hover:text-ink"
                }`}
                title="Full director screenplay editor with visual cues and scene headers"
              >
                <FileText size={13} /> Full Screenplay
              </button>
              <button
                onClick={switchToStudio}
                className={`text-[11px] px-2.5 py-1 font-medium flex items-center gap-1.5 transition-all ${
                  viewMode === "studio"
                    ? "bg-select text-select-ink font-bold"
                    : "text-ink-soft hover:text-ink"
                }`}
                title="Interactive segment cards for editing Narration, Visual, and On-Screen beats"
              >
                <LayoutGrid size={13} /> Visual Studio
              </button>
            </div>
          </div>

          {/* Text / Spoken Preview Area */}
          <div className="flex-1 relative bg-paper-3 border-x border-b-2 border-ink overflow-hidden flex flex-col">
            {/* VIEW MODE 1: FULL SCREENPLAY EDITOR */}
            {viewMode === "screenplay" && (
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your Claude screenplay here with ## 0:00-0:20 - TITLE headers, [VISUAL], [NARRATION], and [ON SCREEN] tag blocks..."
                aria-label="Screenplay text" className="w-full h-full min-h-[380px] p-4 bg-transparent text-ink font-mono text-sm leading-relaxed outline-none resize-none selection:bg-select/30 placeholder:text-ink-mute"
                spellCheck={false}
              />
            )}

            {/* VIEW MODE 1.5: VISUAL STUDIO SEGMENT CARDS */}
            {viewMode === "studio" && (
              <div className="w-full h-full min-h-[380px] p-4 bg-paper overflow-y-auto flex flex-col gap-4">
                {segments.length === 0 && (
                  <div className="p-3 bg-info/25 border-2 border-ink/60 text-xs text-ink shadow-nb-sm">
                    No segments detected yet. Add a segment below or paste a
                    screenplay with{" "}
                    <code className="text-ink">## timestamp - Title</code>{" "}
                    headers in Full Screenplay.
                  </div>
                )}

                {segments.map((seg, segIdx) => (
                  <div
                    key={seg.id}
                    className="bg-paper-3 border-2 border-ink p-4 flex flex-col gap-3 shadow-nb-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        {(seg.timeStart || seg.timeEnd) && (
                          <span className="text-[10px] bg-paper-3 text-ink-soft border-2 border-ink px-2 py-0.5 font-mono shrink-0 shadow-nb-sm">
                            {seg.timeStart}-{seg.timeEnd}
                          </span>
                        )}
                        <input
                          value={seg.title}
                          onChange={(e) =>
                            updateSegmentTitle(segIdx, e.target.value)
                          }
                          placeholder="Segment title"
                          className="flex-1 bg-transparent text-sm font-bold text-ink outline-none border-b border-transparent focus:border-select py-0.5"
                        />
                      </div>
                      <button
                        onClick={() => removeSegment(segIdx)}
                        className="text-ink-soft hover:text-ink p-1 shrink-0"
                        title="Delete segment"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      {seg.beats.map((beat, beatIdx) => {
                        const beatMeta =
                          beat.type === "narration"
                            ? {
                                label: "Narration",
                                icon: <Mic size={11} />,
                                color:
                                  "text-ink border-2 border-ink/60 bg-success/25",
                              }
                            : beat.type === "visual"
                              ? {
                                  label: "Visual",
                                  icon: <Camera size={11} />,
                                  color:
                                    "text-ink border-2 border-ink/60 bg-warn/25",
                                }
                              : {
                                  label: "On-Screen",
                                  icon: <Eye size={11} />,
                                  color:
                                    "text-select-text border-select/40 bg-select/10",
                                };
                        const beatWords = beat.text
                          .split(/\s+/)
                          .filter(Boolean);
                        return (
                          <div
                            key={beatIdx}
                            className={`border p-2.5 ${beatMeta.color}`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5">
                                {beatMeta.icon} {beatMeta.label}
                                {beat.type === "narration" &&
                                  beatWords.length > 0 && (
                                    <span className="font-mono font-normal opacity-70">
                                      ({beatWords.length}w)
                                    </span>
                                  )}
                              </span>
                              <button
                                onClick={() => removeBeat(segIdx, beatIdx)}
                                className="opacity-60 hover:opacity-100"
                                title="Remove beat"
                              >
                                <X size={12} />
                              </button>
                            </div>
                            <textarea
                              value={beat.text}
                              onChange={(e) =>
                                updateBeatText(segIdx, beatIdx, e.target.value)
                              }
                              placeholder={
                                beat.type === "narration"
                                  ? "Spoken voiceover dialogue..."
                                  : beat.type === "visual"
                                    ? "Camera, animation, or diagram direction..."
                                    : "Text overlay or headline..."
                              }
                              rows={2}
                              className="w-full bg-transparent text-xs text-ink outline-none resize-none placeholder:text-ink-mute font-sans"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-1.5 pt-1 border-t-2 border-ink">
                      <button
                        onClick={() => addBeat(segIdx, "narration")}
                        className="text-[10px] px-2 py-1 bg-success/25 hover:bg-success/25 border-2 border-ink/60 text-ink font-medium flex items-center gap-1 shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                      >
                        <Plus size={10} /> Narration
                      </button>
                      <button
                        onClick={() => addBeat(segIdx, "visual")}
                        className="text-[10px] px-2 py-1 bg-warn/25 hover:bg-warn/25 border-2 border-ink/60 text-ink font-medium flex items-center gap-1 shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                      >
                        <Plus size={10} /> Visual
                      </button>
                      <button
                        onClick={() => addBeat(segIdx, "onscreen")}
                        className="text-[10px] px-2 py-1 bg-select/10 hover:bg-select/20 border border-select/40 text-select-text font-medium flex items-center gap-1"
                      >
                        <Plus size={10} /> On-Screen
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={addSegment}
                  className="text-xs px-3 py-2 border border-dashed border-2 border-ink text-ink-soft hover:text-ink hover:border-select flex items-center justify-center gap-1.5 transition-all shadow-nb-sm transition-[transform,box-shadow] duration-nb ease-nb hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                >
                  <Plus size={13} /> Add Segment
                </button>
              </div>
            )}
          </div>

          {/* AUDIO PLAYER EMBEDDED BELOW SCRIPT */}
          {audioUrl && (
            <div className="mt-2 bg-paper-3 border-2 border-ink p-4 flex flex-col gap-3 shadow-nb-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-select/20 text-select-text flex items-center justify-center font-bold text-sm">
                    <Volume2 size={16} className="text-select-text" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-ink">
                      Generated Voiceover Audio
                    </h4>
                    <p className="text-xs text-ink-soft font-mono">
                      videos/{film.id}/voiceover.wav ({formatTime(duration)}) ·{" "}
                      {spokenWords.length} spoken words
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={audioUrl}
                    download={`voiceover_${film.id}.wav`}
                    className="text-xs px-3 py-1.5 bg-paper-3 hover:bg-sunken border-2 border-ink text-ink hover:text-ink font-medium flex items-center gap-1.5 shadow-nb-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-nb active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                  >
                    <Download size={13} /> Download .wav
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
                      className="text-xs px-3 py-1.5 bg-success hover:bg-success text-ink font-bold flex items-center gap-1.5"
                    >
                      <FilmIcon size={13} /> View in Video Player
                    </button>
                  )}
                </div>
              </div>

              {/* Hidden Native Audio Element */}
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={() => {
                  if (audioRef.current)
                    setCurrentTime(audioRef.current.currentTime);
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
              <div className="flex items-center gap-4 bg-paper border-2 border-ink p-3  shadow-nb-sm">
                <button
                  onClick={togglePlayAudio}
                  className="w-10 h-10 bg-select hover:bg-select text-select-ink flex items-center justify-center font-bold text-sm shadow-nb-sm transition-all active:scale-95 shrink-0"
                  title={isPlaying ? "Pause audio" : "Play voiceover"}
                >
                  {isPlaying ? (
                    <Pause size={14} className="fill-current" />
                  ) : (
                    <Play size={14} className="fill-current" />
                  )}
                </button>

                <span className="text-xs font-mono text-ink-soft w-12 text-right">
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
                    if (audioRef.current)
                      audioRef.current.currentTime = newTime;
                  }}
                  aria-label="Voiceover playback position"
                  className="flex-1 accent-select cursor-pointer h-1.5 bg-sunken"
                />

                <span className="text-xs font-mono text-ink w-12">
                  {formatTime(duration)}
                </span>

                <div className="flex items-center gap-1 bg-paper-3 p-0.5 border-2 border-ink shadow-nb-sm">
                  {[1.0, 1.25, 1.5].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => {
                        setPlaybackRate(speed);
                        if (audioRef.current)
                          audioRef.current.playbackRate = speed;
                      }}
                      className={`text-[11px] px-2 py-0.5 font-mono ${
                        playbackRate === speed
                          ? "bg-select text-select-ink font-bold"
                          : "text-ink-soft hover:text-ink"
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
          <div className="bg-paper-3 border-2 border-ink p-4 flex flex-col gap-3 shadow-nb-sm">
            <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
              <Mic size={15} className="text-select-text" /> AI Voice Synthesis
              Engine
            </h3>
            <p className="text-xs text-ink-soft">
              Select from Kokoro ONNX, Deepgram Aura, or macOS neural voices:
            </p>

            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              aria-label="Narration voice"
              className="w-full bg-paper-3 border-2 border-ink p-2.5 text-xs text-ink outline-none focus:border-select font-medium shadow-nb-sm"
            >
              <optgroup label="Kokoro Local Neural (ONNX)">
                {VOICES.filter((v) => v.provider === "Kokoro Neural").map(
                  (v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ),
                )}
              </optgroup>
              <optgroup label="Deepgram Aura Neural">
                {VOICES.filter((v) => v.provider === "Deepgram Aura").map(
                  (v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ),
                )}
              </optgroup>
              <optgroup label="macOS System High-Definition">
                {VOICES.filter((v) => v.provider === "macOS System").map(
                  (v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ),
                )}
              </optgroup>
            </select>

            <div className="p-2.5 bg-paper-3 border-2 border-ink text-[11px] text-ink-soft space-y-1 shadow-nb-sm">
              <div>
                • <strong>Spoken Narration:</strong> {spokenWords.length} spoken
                dialogue words
              </div>
              <div>
                • <strong>Location:</strong>{" "}
                <code className="text-ink">videos/{film.id}/voiceover.wav</code>
              </div>
            </div>
          </div>

          {/* Screenplay Workflow Card */}
          <div className="bg-paper-3 border-2 border-ink p-4 flex flex-col gap-3 text-xs text-ink-soft shadow-nb-sm">
            <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
              <Clapperboard size={15} className="text-select-text" /> Screenplay
              Workflow Guide
            </h3>
            <ul className="space-y-2 list-disc list-inside text-[11px]">
              <li>
                <strong>Write dialogue:</strong> Use [VISUAL], [NARRATION], and
                [ON SCREEN] tag blocks per scene (legacy
                VO:/Voiceover:/Narrator: still work).
              </li>
              <li>
                <strong>Edit visually:</strong> Switch to Visual Studio to edit
                each beat as a card, two-way synced with the raw markdown.
              </li>
              <li>
                <strong>Auto-Build:</strong> Automatically constructs video
                shots, visual metaphors, and canvas nodes directly from the
                script.
              </li>
              <li>
                <strong>Generate Voiceover:</strong> Synthesizes strictly the
                screenplay's spoken dialogue into audio.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
