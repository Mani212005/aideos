/**
 * File Description: Story-first Script & Narration Studio. The script is shown as the plain story, one block per
 * paragraph, with the agent's visual and on-screen notes as collapsible notes beside each paragraph (the
 * [VISUAL]/[NARRATION]/[ON SCREEN] tags stay internal). It also lists every narration change made by the user or
 * the agent, shows which lines still need recording, and synthesizes the voiceover line by line.
 * Inputs and outputs: the project's script text and narration change list -> editable story, saved tagged script, voiceover audio.
 * Used by: editor/src/screens/ScriptStage.tsx.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import {
  FileEdit,
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
  Plus,
  Trash2,
  Bot,
  Copy,
  Check,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  History,
  StickyNote,
} from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { Badge } from "./ui";
import { usePaneDelivery, type PaneDeliveryView } from "../state/paneDelivery";
import { generateAgentPrompt } from "../../../backend/scriptIntake";
import { narrationLines, scriptToStory, storyToScript } from "../../../backend/storyScript";
import type { StoryParagraph, StorySection } from "../../../backend/storyScript";

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

/** One entry of the narration change list, as the server returns it. */
interface NarrationEntry {
  id: number;
  at: string;
  source: "user" | "agent";
  kind: "added" | "edited" | "removed";
  before?: string;
  after?: string;
}

/** The server's view of the narration: the change list plus which lines already have a recording. */
interface NarrationState {
  revision: string;
  entries: NarrationEntry[];
  lines: Array<{ text: string; recorded: boolean }>;
}

/** True when a section's title is just the opening words of its first paragraph, so it need not be shown twice. */
function isDerivedTitle(section: StorySection): boolean {
  const first = section.paragraphs[0]?.narration.replace(/\s+/g, " ").trim() ?? "";
  return !section.title || first.startsWith(section.title.replace(/[.?!]+$/, ""));
}

/** Splits a notes textarea into its lines as typed (blank ones are dropped when the script is written, not while typing). */
function noteLines(value: string): string[] {
  return value.split("\n");
}

/** One narration paragraph with its collapsible visual and on-screen notes beside it. */
function StoryParagraphRow({
  paragraph,
  needsRecording,
  onChange,
  onAddBelow,
  onRemove,
}: {
  paragraph: StoryParagraph;
  needsRecording: boolean;
  onChange: (patch: Partial<StoryParagraph>) => void;
  onAddBelow: () => void;
  onRemove: () => void;
}) {
  const noteCount = [...paragraph.visual, ...paragraph.onScreen].filter((note) => note.trim()).length;
  const [open, setOpen] = useState<boolean>(noteCount > 0);
  const words = paragraph.narration.split(/\s+/).filter(Boolean).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)] gap-3 items-start" data-testid="story-paragraph">
      <div className="flex flex-col gap-1">
        <textarea
          value={paragraph.narration}
          onChange={(e) => onChange({ narration: e.target.value.replace(/\s*\n+\s*/g, " ") })}
          placeholder="Write what the narrator says..."
          aria-label="Narration paragraph"
          rows={Math.max(2, Math.ceil(paragraph.narration.length / 90))}
          className="w-full bg-paper border-2 border-ink p-3 text-sm leading-relaxed text-ink outline-none resize-none focus:border-select placeholder:text-ink-mute font-sans"
        />
        <div className="flex items-center gap-3 text-[11px] text-ink-soft">
          <span className="font-mono">{words} words</span>
          {needsRecording && paragraph.narration.trim() && (
            <span className="font-mono font-bold text-ink bg-warn/40 border border-ink px-1.5">needs recording</span>
          )}
          <button onClick={onAddBelow} className="inline-flex items-center gap-1 hover:text-ink" title="Add a paragraph below">
            <Plus size={11} /> paragraph
          </button>
          <button onClick={onRemove} className="inline-flex items-center gap-1 hover:text-ink" title="Remove this paragraph">
            <Trash2 size={11} /> remove
          </button>
        </div>
      </div>

      <div className="border-2 border-ink bg-paper-3 shadow-nb-sm">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <StickyNote size={12} /> Notes
          <span className="ml-auto font-mono font-normal text-ink-soft">{noteCount === 0 ? "empty" : `${noteCount}`}</span>
        </button>
        {open && (
          <div className="flex flex-col gap-2 px-2.5 pb-2.5">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
              Visual
              <textarea
                value={paragraph.visual.join("\n")}
                onChange={(e) => onChange({ visual: noteLines(e.target.value) })}
                placeholder="Your agent fills this in"
                rows={2}
                className="w-full bg-paper border border-ink/60 p-1.5 text-xs font-normal normal-case tracking-normal text-ink outline-none resize-none placeholder:text-ink-mute"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
              On screen
              <textarea
                value={paragraph.onScreen.join("\n")}
                onChange={(e) => onChange({ onScreen: noteLines(e.target.value) })}
                placeholder="Your agent fills this in"
                rows={2}
                className="w-full bg-paper border border-ink/60 p-1.5 text-xs font-normal normal-case tracking-normal text-ink outline-none resize-none placeholder:text-ink-mute"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Script & Narration Editor component with screenplay parsing and direct voiceover synthesis from the screenplay's spoken dialogue.
 */
export function ScriptEditor({
  film,
  onUpdateFilm,
  onNavigateToVideo,
}: ScriptEditorProps) {
  // The story is the editable model; the tagged script is derived from it only when saving or recording,
  // so typing never round-trips through the parser (which would trim a trailing space as it is typed).
  const [story, setStory] = useState<StorySection[]>([]);
  const [dirty, setDirty] = useState<boolean>(false);
  const [narration, setNarration] = useState<NarrationState | null>(null);
  const [diskChanged, setDiskChanged] = useState<boolean>(false);
  const [pasteText, setPasteText] = useState<string>("");
  const script = useMemo(() => storyToScript(story), [story]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [buildingScenes, setBuildingScenes] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("kokoro-am_adam");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
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
    pane?: PaneDeliveryView;
  } | null>(null);
  const paneDelivery = usePaneDelivery(lastDispatchResult?.pane);

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
          text: data.dispatch.pane
            ? "⚡ Auto-prompter has the task: its progress shows in the AUTO-PROMPTER bar above"
            : `⚡ ${data.dispatch.message || "Auto-prompted active coding agent in terminal!"}`,
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
    setDiskChanged(false);
    fetch(`/api/scripts/${film.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        setStory(data.ok && data.script ? scriptToStory(data.script) : []);
        setDirty(false);
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
        // The dev server answers an unknown path with the app page, so only an audio response counts as a recording.
        if (isMounted && res.ok && (res.headers.get("content-type") ?? "").startsWith("audio")) {
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

  // Narration lines, in order: exactly what the voiceover will speak.
  const spokenBlocks = narrationLines(script);
  const spokenWords = spokenBlocks.join(" ").split(/\s+/).filter(Boolean);
  const paragraphCount = story.reduce((sum, section) => sum + section.paragraphs.length, 0);
  const unrecordedCount = narration ? narration.lines.filter((line) => !line.recorded).length : 0;
  // What the voiceover would actually say for each paragraph (quotes and markup removed), to tell whether it is recorded.
  const spokenByParagraph = useMemo(
    () =>
      new Map(
        story.flatMap((section) =>
          section.paragraphs.map((p): [string, string] => [
            p.id,
            narrationLines(storyToScript([{ id: "p", title: "p", paragraphs: [{ ...p, visual: [], onScreen: [] }] }]))[0] ?? "",
          ]),
        ),
      ),
    [story],
  );
  const recordedLines = new Set(narration ? narration.lines.filter((line) => line.recorded).map((line) => line.text) : []);

  const revisionRef = useRef<string>("");
  const dirtyRef = useRef<boolean>(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  /**
   * Fetches the narration change list and recording status. A script that changed on disk behind the
   * editor's back (the agent wrote it) reloads into the story when nothing here is unsaved, and is
   * flagged otherwise.
   */
  const refreshNarration = async (adopt = false) => {
    try {
      const res = await fetch(`/api/narration/${film.id}?voice=${encodeURIComponent(selectedVoice)}`);
      if (!res.ok) return;
      const data: NarrationState & { ok: boolean } = await res.json();
      setNarration({ revision: data.revision, entries: data.entries, lines: data.lines });
      if (adopt || !revisionRef.current) {
        revisionRef.current = data.revision;
        return;
      }
      if (data.revision !== revisionRef.current) {
        if (dirtyRef.current) {
          setDiskChanged(true);
        } else {
          const scriptRes = await fetch(`/api/scripts/${film.id}`);
          const scriptData = await scriptRes.json();
          setStory(scriptData.ok && scriptData.script ? scriptToStory(scriptData.script) : []);
          revisionRef.current = data.revision;
          setDiskChanged(false);
        }
      }
    } catch {
      // The change list is an aid; the editor works without it.
    }
  };

  // Load the change list when the project or voice changes, and keep it fresh while the stage is open.
  useEffect(() => {
    revisionRef.current = "";
    void refreshNarration();
    const timer = setInterval(() => void refreshNarration(), 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [film.id, selectedVoice]);

  /** Replaces the story's edited paragraph and marks the script as having unsaved edits. */
  const updateParagraph = (sectionIdx: number, paraIdx: number, patch: Partial<StoryParagraph>) => {
    setStory((current) =>
      current.map((section, si) =>
        si !== sectionIdx ? section : { ...section, paragraphs: section.paragraphs.map((p, pi) => (pi === paraIdx ? { ...p, ...patch } : p)) },
      ),
    );
    setDirty(true);
  };

  /** Adds an empty paragraph below the given one (or a first section when the story is empty). */
  const addParagraphBelow = (sectionIdx: number, paraIdx: number) => {
    setStory((current) => {
      if (current.length === 0) {
        return [{ id: "part-1", title: "Part 1", paragraphs: [{ id: "part-1-1", narration: "", visual: [], onScreen: [] }] }];
      }
      return current.map((section, si) => {
        if (si !== sectionIdx) return section;
        const next = [...section.paragraphs];
        next.splice(paraIdx + 1, 0, { id: `${section.id}-new-${Date.now()}`, narration: "", visual: [], onScreen: [] });
        return { ...section, paragraphs: next };
      });
    });
    setDirty(true);
  };

  /** Removes a paragraph, and its section when it was the last one in it. */
  const removeParagraph = (sectionIdx: number, paraIdx: number) => {
    setStory((current) =>
      current
        .map((section, si) => (si !== sectionIdx ? section : { ...section, paragraphs: section.paragraphs.filter((_, pi) => pi !== paraIdx) }))
        .filter((section) => section.paragraphs.length > 0),
    );
    setDirty(true);
  };

  /** Turns pasted text (a plain story or an already tagged script) into story paragraphs. */
  const addPastedStory = () => {
    const pasted = scriptToStory(pasteText);
    if (pasted.length === 0) return;
    setStory((current) => [...current, ...pasted]);
    setPasteText("");
    setDirty(true);
  };

  /** Reloads the story from disk, discarding unsaved edits. */
  const reloadFromDisk = async () => {
    const res = await fetch(`/api/scripts/${film.id}`);
    const data = await res.json();
    setStory(data.ok && data.script ? scriptToStory(data.script) : []);
    setDirty(false);
    setDiskChanged(false);
    await refreshNarration(true);
  };

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
      setDirty(false);
      setDiskChanged(false);
      await refreshNarration(true);
      setStatusMsg({ type: "success", text: `Script saved to ${data.file}` });
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
          projectId: film.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to parse scenes");

      if (!data.shots || data.shots.length === 0) {
        setStatusMsg({
          type: "error",
          text: "No video scenes were generated from the script. Please check your script content.",
        });
        return;
      }

      const updatedFilm: Film = {
        ...film,
        canvas: {
          nodes: data.nodes.length > 0 ? data.nodes : film.canvas.nodes,
          edges: data.edges.length > 0 ? data.edges : film.canvas.edges,
        },
        shots: data.shots,
      };

      onUpdateFilm(updatedFilm);

      await fetch(`/api/films/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film: updatedFilm }),
      });

      const prompt = data.agentPrompt || generateAgentPrompt({
        projectId: film.id,
        filmTitle: film.title,
        shotCount: data.shots.length,
        durationSec: data.durationSec || film.voiceover?.durationSec,
      });

      setAgentDirective({
        prompt,
        taskFile: data.taskFile || `videos/${film.id}/director_task.md`,
        shotCount: data.shots.length,
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
      text: `Recording ${unrecordedCount > 0 ? `${unrecordedCount} new or changed line${unrecordedCount === 1 ? "" : "s"}` : "the narration"} (${spokenWords.length} spoken words) using ${selectedVoice}...`,
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
      if (!res.ok) throw new Error([data.error || "Voice synthesis failed", data.detail].filter(Boolean).join(" "));

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
          : `Voiceover ready (${data.spokenWordCount} spoken words, ${data.actualDurationSec ? data.actualDurationSec.toFixed(1) : data.estimatedDurationSec}s)${
              data.lines ? `: ${data.lines.recorded} line${data.lines.recorded === 1 ? "" : "s"} recorded, ${data.lines.reused} kept as they were` : ""
            }.`,
      });
      setDirty(false);
      void refreshNarration(true);

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
            Write your story as paragraphs. Your agent adds the visuals and
            on-screen text beside them; the voiceover is recorded line by line.
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
            <span className="text-ink">
              {paneDelivery?.state === "sent" && !paneDelivery.duplicate
                ? `Prompt sent to your ${paneDelivery.agent} agent`
                : lastDispatchResult.message}
            </span>
            {paneDelivery && <PaneDeliveryBadge delivery={paneDelivery} />}
            {paneDelivery?.state === "failed" && <span className="text-ink-soft">{paneDelivery.error}</span>}
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
          {/* Story header bar */}
          <div className="flex items-center justify-between bg-paper-3 border-2 border-ink px-4 py-2 flex-wrap gap-2 shadow-nb-sm">
            <div className="flex items-center gap-4 text-xs text-ink-soft">
              <span>
                <strong>Paragraphs:</strong>{" "}
                <span className="text-ink font-mono font-bold">{paragraphCount}</span>
              </span>
              <span>
                <strong>Spoken:</strong>{" "}
                <span className="text-ink font-mono font-bold">{spokenWords.length} words</span>
              </span>
              <span>
                <strong>Duration:</strong>{" "}
                {duration > 0 ? (
                  <span className="text-ink font-mono font-bold">{formatTime(duration)}</span>
                ) : (
                  <span className="text-ink-soft font-mono italic">--:-- (Pending VO)</span>
                )}
              </span>
              {dirty && (
                <span className="text-[11px] bg-warn/40 text-ink px-2 py-0.5 border-2 border-ink font-medium shadow-nb-sm">
                  Unsaved edits
                </span>
              )}
            </div>
          </div>

          {diskChanged && (
            <div className="px-3.5 py-2.5 bg-info/25 border-2 border-ink text-xs flex items-center justify-between gap-3" role="status">
              <span>Your agent changed the script while you had unsaved edits here. Save to keep yours, or reload to see the agent's version.</span>
              <button onClick={reloadFromDisk} className="border-2 border-ink px-2.5 py-1 font-bold uppercase text-[11px] bg-paper-3 shadow-nb-sm">
                Reload
              </button>
            </div>
          )}

          {/* The story: one block per paragraph, notes beside it */}
          <div className="flex-1 relative bg-paper-3 border-x border-b-2 border-ink overflow-hidden flex flex-col">
            <div className="w-full h-full min-h-[380px] p-4 bg-paper overflow-y-auto flex flex-col gap-5" data-testid="story-editor">
              {loading && <p className="text-xs text-ink-soft">Loading the story...</p>}

              {!loading && story.length === 0 && (
                <div className="flex flex-col gap-3" data-testid="story-empty">
                  <p className="text-sm text-ink">
                    This project has no script yet. Write or paste your story below (paragraphs, and markers like
                    <code className="mx-1 text-ink">#Start</code> or <code className="mx-1 text-ink">#Conclusion</code> if you like),
                    or ask your agent to write it for you.
                  </p>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={"#Start\nOne idea per paragraph...\n\n#Conclusion\nHow it ends."}
                    aria-label="Paste your story"
                    rows={8}
                    className="w-full bg-paper-3 border-2 border-ink p-3 text-sm text-ink outline-none focus:border-select resize-y placeholder:text-ink-mute"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={addPastedStory}
                      disabled={!pasteText.trim()}
                      className="inline-flex h-8 items-center gap-1.5 border-2 border-ink px-3 text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm bg-primary text-ink disabled:opacity-40"
                    >
                      <Plus size={13} /> Add to story
                    </button>
                    <button
                      onClick={() => addParagraphBelow(0, 0)}
                      className="inline-flex h-8 items-center gap-1.5 border-2 border-ink px-3 text-[11px] font-bold uppercase tracking-[0.06em] shadow-nb-sm bg-paper-3 text-ink"
                    >
                      Start with a blank paragraph
                    </button>
                  </div>
                </div>
              )}

              {story.map((section, si) => (
                <section key={section.id} className="flex flex-col gap-3" data-testid="story-section">
                  {(!isDerivedTitle(section) || section.timeStart) && (
                    <div className="flex items-center gap-2 border-b-2 border-ink pb-1">
                      {!isDerivedTitle(section) && <h3 className="text-sm font-extrabold tracking-tight text-ink">{section.title}</h3>}
                      {section.timeStart && section.timeEnd && (
                        <span className="text-[10px] bg-paper-3 text-ink-soft border-2 border-ink px-2 py-0.5 font-mono shadow-nb-sm">
                          {section.timeStart}-{section.timeEnd}
                        </span>
                      )}
                    </div>
                  )}
                  {section.paragraphs.map((paragraph, pi) => (
                    <StoryParagraphRow
                      key={paragraph.id}
                      paragraph={paragraph}
                      needsRecording={narration !== null && Boolean(spokenByParagraph.get(paragraph.id)) && !recordedLines.has(spokenByParagraph.get(paragraph.id) ?? "")}
                      onChange={(patch) => updateParagraph(si, pi, patch)}
                      onAddBelow={() => addParagraphBelow(si, pi)}
                      onRemove={() => removeParagraph(si, pi)}
                    />
                  ))}
                </section>
              ))}
            </div>
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
                    <p className="text-xs text-ink-soft font-mono break-all">
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
                <code className="text-ink break-all">
                  videos/{film.id}/voiceover.wav
                </code>
              </div>
            </div>
          </div>

          {/* Narration change list */}
          <div className="bg-paper-3 border-2 border-ink p-4 flex flex-col gap-3 shadow-nb-sm" data-testid="narration-changes">
            <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
              <History size={15} className="text-select-text" /> Narration changes
            </h3>
            <p className="text-[11px] text-ink-soft">
              {narration
                ? unrecordedCount === 0
                  ? "Every narration line has a recording."
                  : `${unrecordedCount} of ${narration.lines.length} line${narration.lines.length === 1 ? "" : "s"} need recording. Only those are recorded next time.`
                : "Loading..."}
            </p>
            {narration && narration.entries.length === 0 && (
              <p className="text-[11px] text-ink-soft border-t-2 border-ink pt-2">
                No changes yet. Edits you or your agent make to the narration are listed here.
              </p>
            )}
            {narration && narration.entries.length > 0 && (
              <ul className="flex flex-col gap-2 border-t-2 border-ink pt-2 max-h-72 overflow-y-auto">
                {narration.entries.map((entry) => (
                  <li key={entry.id} className="text-[11px] text-ink flex flex-col gap-0.5" data-testid="narration-change">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono font-bold uppercase px-1.5 border border-ink ${entry.source === "agent" ? "bg-info/40" : "bg-success/30"}`}>
                        {entry.source === "agent" ? "Agent" : "You"}
                      </span>
                      <span className="font-bold uppercase tracking-wide">{entry.kind}</span>
                      <span className="ml-auto font-mono text-ink-soft">{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    {entry.before !== undefined && <div className="text-ink-soft line-through break-words">{entry.before}</div>}
                    {entry.after !== undefined && <div className="break-words">{entry.after}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* How it works */}
          <div className="bg-paper-3 border-2 border-ink p-4 flex flex-col gap-3 text-xs text-ink-soft shadow-nb-sm">
            <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
              <Clapperboard size={15} className="text-select-text" /> How the script works
            </h3>
            <ul className="space-y-2 list-disc list-inside text-[11px]">
              <li>
                <strong>Your words stay yours:</strong> write the story as paragraphs. Nothing reformats
                it; your agent only fills in the notes beside each paragraph.
              </li>
              <li>
                <strong>Agent edits are tracked:</strong> if your agent changes or writes narration, every change
                shows in the list above.
              </li>
              <li>
                <strong>Auto-Build:</strong> constructs video shots and canvas nodes from the story.
              </li>
              <li>
                <strong>Generate Voiceover:</strong> records each narration line once; later runs re-record
                only the lines that changed.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The badge that says where an Auto-Prompt stands: queued behind a busy agent, sending, sent, or not sent. */
function PaneDeliveryBadge({ delivery }: { delivery: PaneDeliveryView }) {
  if (delivery.duplicate) return <Badge tone="quiet">Already queued</Badge>;
  if (delivery.state === "queued") return <Badge tone="warn" title={`Sent when your ${delivery.agent} agent is idle at an empty prompt`}>Queued</Badge>;
  if (delivery.state === "sending") return <Badge tone="info">Sending</Badge>;
  if (delivery.state === "sent") return <Badge tone="success">Sent</Badge>;
  return <Badge tone="danger" title={delivery.error}>Not sent</Badge>;
}
