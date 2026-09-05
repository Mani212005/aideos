/**
 * File Description: Script & Narration Studio component with word-level speech inspection, in-place word editing/insertion with real-time visual feedback, and multi-provider voiceover re-synthesis.
 */

import { useState, useEffect, useRef } from "react";
import type { Film } from "../../../src/dl/schema";

interface ScriptEditorProps {
  film: Film;
  onUpdateFilm: (film: Film) => void;
  onNavigateToVideo?: () => void;
}

export interface TranscriptWord {
  id: string;
  word: string;
  punctuated: string;
  start: number;
  end: number;
  confidence?: number;
  deleted?: boolean;
  modified?: boolean;
  inserted?: boolean;
  sceneIndex?: number;
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
 * Synchronizes modified interactive words back into per-scene VO blocks without destroying screenplay structure.
 */
export function syncWordsIntoScreenplay(script: string, transcriptWords: TranscriptWord[]): string {
  if (!transcriptWords || transcriptWords.length === 0) {
    return script;
  }

  const activeWords = transcriptWords.filter((w) => !w.deleted);
  const hasVOTags = /^\*{0,2}(?:VO|Voiceover|Narrator)\s*(\([^)]*\))?\s*:\*{0,2}/im.test(script);

  if (hasVOTags) {
    const lines = script.split("\n");
    const newLines: string[] = [];
    let voBlockIndex = -1;
    let isCapturingVO = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for VO tag start line
      if (/^\*{0,2}(VO|Voiceover|Narrator)\s*(\([^)]*\))?\s*:\*{0,2}/i.test(line)) {
        voBlockIndex++;
        isCapturingVO = true;

        // Preserve tag prefix e.g. **VO (energetic):** or **VO:**
        const tagMatch = line.match(/^(\*{0,2}(?:VO|Voiceover|Narrator)(?:\s*\([^)]*\))?\s*:\*{0,2})/i);
        const tagPrefix = tagMatch ? tagMatch[1] : "**VO:**";

        // Get words partitioned for this specific scene / VO block
        const sceneWords = activeWords
          .filter((w) => (w.sceneIndex ?? 0) === voBlockIndex)
          .map((w) => w.punctuated)
          .join(" ");

        newLines.push(`${tagPrefix} ${sceneWords}`.trimEnd());
        continue;
      }

      // Boundary checks: VISUAL, ON-SCREEN TEXT, scene headers ##, dividers ---
      if (
        /^\*{0,2}(VISUAL|ON-SCREEN TEXT|SCREEN|GRAPHICS|AUDIO|SFX)\s*:\*{0,2}/i.test(line) ||
        /^#{1,4}\s+/.test(line) ||
        line === "---" ||
        line === "***"
      ) {
        isCapturingVO = false;
        newLines.push(line);
        continue;
      }

      // If inside an old multiline VO block, skip continuation lines since we replaced the block
      if (isCapturingVO) {
        if (line.trim().length === 0) {
          isCapturingVO = false;
          newLines.push(line);
        }
        continue;
      }

      newLines.push(line);
    }
    return newLines.join("\n");
  } else {
    // Plain script without VO tags: partition across existing paragraphs
    const paragraphs = script.split(/\n\s*\n+/);
    if (paragraphs.length > 1) {
      const updatedParagraphs = paragraphs.map((p, idx) => {
        const pWords = activeWords
          .filter((w) => (w.sceneIndex ?? 0) === idx)
          .map((w) => w.punctuated)
          .join(" ");
        return pWords || p;
      });
      return updatedParagraphs.join("\n\n");
    } else {
      return activeWords.map((w) => w.punctuated).join(" ");
    }
  }
}

/**
 * Script & Narration Editor component with screenplay parsing, word-level audio alignment, in-place word editing, and synthesis.
 */
export function ScriptEditor({ film, onUpdateFilm, onNavigateToVideo }: ScriptEditorProps) {
  const [script, setScript] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [buildingScenes, setBuildingScenes] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("kokoro-am_adam");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"screenplay" | "words" | "spoken">("screenplay");
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Word-level audio alignment transcript state
  const [transcriptWords, setTranscriptWords] = useState<TranscriptWord[]>([]);
  const [loadingWords, setLoadingWords] = useState<boolean>(false);
  const [activeWordId, setActiveWordId] = useState<string | null>(null);
  const [selectedWord, setSelectedWord] = useState<TranscriptWord | null>(null);
  const [editingWordText, setEditingWordText] = useState<string>("");
  const [insertText, setInsertText] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [replaceTerm, setReplaceTerm] = useState<string>("");
  const [hasTranscriptEdits, setHasTranscriptEdits] = useState<boolean>(false);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);

  // Load existing script and transcript on mount or when active film changes
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

    // Check if voiceover audio exists and load word timestamps
    const existingAudio = film.voiceover?.src || `/voiceover_${film.id}.wav`;
    fetch(existingAudio, { method: "HEAD" })
      .then((res) => {
        if (isMounted && res.ok) {
          setAudioUrl(`${existingAudio}?t=${Date.now()}`);
          loadAudioTranscript(film.id);
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

  // Sync active highlighted word with playback playhead time
  useEffect(() => {
    if (transcriptWords.length === 0) return;
    const current = transcriptWords.find((w) => currentTime >= w.start && currentTime <= w.end);
    if (current && current.id !== activeWordId) {
      setActiveWordId(current.id);
    }
  }, [currentTime, transcriptWords, activeWordId]);
  // Generates interactive word objects from screenplay preserving per-scene indices
  const generateFullScriptWords = (rawScript: string): TranscriptWord[] => {
    const blocks = extractSpokenBlocks(rawScript);
    const allWords: TranscriptWord[] = [];
    let globalIdx = 0;
    const totalWords = blocks.reduce((acc, b) => acc + b.split(/\s+/).filter(Boolean).length, 0);
    const estTotalSec = Math.max(15, Math.round((totalWords / 150) * 60));
    const secPerWord = estTotalSec / (totalWords || 1);

    for (let sceneIdx = 0; sceneIdx < blocks.length; sceneIdx++) {
      const wordsArr = blocks[sceneIdx].split(/\s+/).filter(Boolean);
      for (const w of wordsArr) {
        allWords.push({
          id: `w-${globalIdx}`,
          word: w.replace(/[^\w]/g, "").toLowerCase(),
          punctuated: w,
          start: Number((globalIdx * secPerWord).toFixed(2)),
          end: Number(((globalIdx + 1) * secPerWord).toFixed(2)),
          confidence: 0.95,
          sceneIndex: sceneIdx,
        });
        globalIdx++;
      }
    }
    return allWords;
  };

  /**
   * Fetches word-level timestamps from backend for interactive voiceover editing.
   */
  const loadAudioTranscript = async (projectId: string, force = false) => {
    setLoadingWords(true);
    try {
      const res = await fetch(`/api/audio-transcript/${projectId}${force ? `?force=1&t=${Date.now()}` : ""}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.words) && data.words.length >= Math.min(spokenWords.length * 0.7, 800)) {
        setTranscriptWords(data.words);
        if (force) {
          setStatusMsg({ type: "success", text: "✓ Interactive words re-synced directly from audio!" });
          setTimeout(() => setStatusMsg(null), 3000);
        }
      } else {
        // Fallback: Generate full alignment for all spoken words so interactive words never truncate
        if (script) {
          setTranscriptWords(generateFullScriptWords(script));
        }
      }
    } catch (_) {
      if (script) {
        setTranscriptWords(generateFullScriptWords(script));
      }
    }
    setLoadingWords(false);
  };

  /**
   * Synchronizes modified, inserted, and non-deleted interactive words back into spoken text & script.
   */
  const handleSyncSpokenTextFromWords = async () => {
    if (transcriptWords.length === 0) return;

    const activeWords = transcriptWords.filter((w) => !w.deleted);
    const updatedScript = syncWordsIntoScreenplay(script, transcriptWords);

    setScript(updatedScript);

    try {
      await fetch(`/api/scripts/${film.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: updatedScript }),
      });
    } catch (_) {}

    setViewMode("spoken");
    setHasTranscriptEdits(false);
    setStatusMsg({
      type: "success",
      text: `✨ Spoken text updated from modified words (${activeWords.length} words)! Switched to Spoken Text tab to review.`,
    });
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
   * Synthesizes ONLY the spoken dialogue lines into a studio-grade .wav audio file and updates transcript.
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
      // If user has customized words in the interactive word stream, synthesize exact word sequence!
      let spokenTextOverride: string | undefined = undefined;
      if (hasTranscriptEdits && transcriptWords.length > 0) {
        spokenTextOverride = transcriptWords
          .filter((w) => !w.deleted)
          .map((w) => w.punctuated)
          .join(" ");
      }

      const res = await fetch("/api/generate-voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          spokenTextOverride,
          voice: selectedVoice,
          projectId: film.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Voice synthesis failed");

      setAudioUrl(data.audioSrc);
      setHasTranscriptEdits(false);
      setViewMode("words");
      setStatusMsg({
        type: "success",
        text: `🎉 Voiceover synthesized from screenplay (${data.spokenWordCount} spoken words, ${data.estimatedDurationSec}s)! Switched to Interactive Words below to review and tweak.`,
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

      // Force-reload fresh word alignment from the newly synthesized audio
      await loadAudioTranscript(film.id, true);

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
   * Opens the inline word editor without auto-playing audio.
   */
  const handleOpenWordEditor = (word: TranscriptWord) => {
    setSelectedWord(word);
    setEditingWordText(word.punctuated);
    setInsertText("");

    // Jump playhead to word position but DO NOT start playback automatically
    if (audioRef.current) {
      audioRef.current.currentTime = word.start;
      setCurrentTime(word.start);
    }
  };

  /**
   * Plays a 1.5s audio snippet around the selected word.
   */
  const handlePlayWordSnippet = (word: TranscriptWord) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, word.start - 0.1);
    audioRef.current.play().catch(() => {});
    const durationMs = Math.max(800, (word.end - word.start + 0.8) * 1000);
    setTimeout(() => {
      if (audioRef.current) audioRef.current.pause();
    }, durationMs);
  };

  /**
   * Replaces a specific word in the transcript stream by exact ID.
   */
  const handleApplyWordEdit = () => {
    if (!selectedWord || !editingWordText.trim()) return;

    const oldWordText = selectedWord.punctuated;
    const newWordText = editingWordText.trim();

    // 1. Update transcript words array directly by ID
    const updatedWords = transcriptWords.map((w) =>
      w.id === selectedWord.id
        ? { ...w, punctuated: newWordText, word: newWordText.toLowerCase(), modified: true }
        : w
    );
    setTranscriptWords(updatedWords);
    setHasTranscriptEdits(true);

    setStatusMsg({
      type: "success",
      text: `✏️ Changed "${oldWordText}" → "${newWordText}". Click "🔄 Re-synthesize with Word Edits" to generate audio!`,
    });
    setSelectedWord(null);
  };

  /**
   * Strikes through / removes a word from the voiceover transcript.
   */
  const handleDeleteWord = () => {
    if (!selectedWord) return;

    const targetText = selectedWord.punctuated;
    const updatedWords = transcriptWords.map((w) =>
      w.id === selectedWord.id ? { ...w, deleted: true } : w
    );
    setTranscriptWords(updatedWords);
    setHasTranscriptEdits(true);

    setStatusMsg({
      type: "success",
      text: `❌ Struck out "${targetText}". Click "🔄 Re-synthesize with Word Edits" to update audio!`,
    });
    setSelectedWord(null);
  };

  /**
   * Inserts new words directly after the selected word with bright yellow visual feedback.
   */
  const handleInsertWordsAfter = () => {
    if (!selectedWord || !insertText.trim()) return;

    const targetText = selectedWord.punctuated;
    const insertedPhrase = insertText.trim();

    const parentSceneIndex = selectedWord.sceneIndex ?? 0;

    // 1. Splice new word chips into transcriptWords marked with `inserted: true` and matching sceneIndex
    const targetIdx = transcriptWords.findIndex((w) => w.id === selectedWord.id);
    const newWordsArr: TranscriptWord[] = insertedPhrase
      .split(/\s+/)
      .filter(Boolean)
      .map((text, i) => ({
        id: `ins-${Date.now()}-${i}`,
        word: text.toLowerCase().replace(/[^\w]/g, ""),
        punctuated: text,
        start: selectedWord.end + i * 0.35,
        end: selectedWord.end + (i + 1) * 0.35,
        inserted: true,
        sceneIndex: parentSceneIndex,
      }));

    let updatedWords: TranscriptWord[] = [];
    if (targetIdx !== -1) {
      updatedWords = [
        ...transcriptWords.slice(0, targetIdx + 1),
        ...newWordsArr,
        ...transcriptWords.slice(targetIdx + 1),
      ];
    } else {
      updatedWords = [...transcriptWords, ...newWordsArr];
    }
    setTranscriptWords(updatedWords);
    setHasTranscriptEdits(true);

    setStatusMsg({
      type: "success",
      text: `✨ Inserted "${insertedPhrase}" after "${targetText}". Highlighted in yellow below! Click "🔄 Re-synthesize" to update audio.`,
    });
    setSelectedWord(null);
    setInsertText("");
  };

  /**
   * Global Search & Replace for phonetic and word tuning (e.g. charge -> ChatGPT).
   */
  const handleSearchReplace = () => {
    if (!searchTerm.trim()) return;

    const target = searchTerm.trim().toLowerCase();
    const replacement = replaceTerm.trim();

    const updatedWords = transcriptWords.map((w) => {
      if (w.word === target || w.punctuated.toLowerCase() === target) {
        return {
          ...w,
          punctuated: replacement,
          word: replacement.toLowerCase(),
          modified: true,
        };
      }
      return w;
    });

    setTranscriptWords(updatedWords);
    setHasTranscriptEdits(true);

    setStatusMsg({
      type: "success",
      text: `🔄 Replaced all occurrences of "${searchTerm}" with "${replaceTerm}" in Interactive Words. Click "🔄 Re-synthesize" when ready!`,
    });
    setSearchTerm("");
    setReplaceTerm("");
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
            Write or paste your director screenplay. Click any word below to edit or insert phrases with instant visual feedback.
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
            className={`text-xs px-4 py-1.5 rounded font-bold flex items-center gap-1.5 shadow-lg transition-all disabled:opacity-50 active:scale-95 ${
              hasTranscriptEdits
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 animate-pulse"
                : "bg-[#635BFF] hover:bg-[#5249e6] text-white shadow-[#635BFF]/20"
            }`}
          >
            <span className={generating ? "animate-spin" : ""}>🎙️</span>
            <span>
              {generating
                ? "Synthesizing Audio..."
                : hasTranscriptEdits
                ? "🔄 Re-synthesize with Word Edits"
                : "Generate Voiceover (.wav)"}
            </span>
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

      {/* Unsaved Edits Alert Banner */}
      {hasTranscriptEdits && (
        <div className="mt-3 p-3 rounded-lg bg-amber-950/40 border border-amber-800/80 text-amber-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              You modified words in the voiceover transcript. Click <strong>"🔄 Re-synthesize with Word Edits"</strong> to regenerate the voiceover audio with your changes.
            </span>
          </div>
          <button
            onClick={handleGenerateVoiceover}
            disabled={generating}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded text-xs transition-all shrink-0"
          >
            {generating ? "Synthesizing..." : "Re-synthesize Now"}
          </button>
        </div>
      )}

      {/* Main Grid: Script Editor + Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6 flex-1 min-h-0">
        
        {/* LEFT 3 COLS: Big Script / Word Inspector Editor */}
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

            {/* View Mode Toggle: Screenplay first, then Interactive Words, then Spoken Text */}
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
                onClick={() => setViewMode("words")}
                className={`text-[11px] px-2.5 py-1 rounded font-medium transition-all ${
                  viewMode === "words" ? "bg-[#635BFF] text-white font-bold" : "text-gray-400 hover:text-white"
                }`}
                title="Interactive word-level audio transcript: click any word to inspect, tweak, or insert phrases"
              >
                🔤 Interactive Words {transcriptWords.length > 0 ? `(${transcriptWords.length})` : ""}
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

          {/* Text / Interactive Transcript Area */}
          <div className="flex-1 relative bg-[#121216] border-x border-b border-[#26262E] rounded-b-lg overflow-hidden flex flex-col">
            
            {/* VIEW MODE 1: INTERACTIVE WORD-LEVEL AUDIO INSPECTOR (Luma / Descript style) */}
            {viewMode === "words" && (
              <div className="w-full h-full min-h-[380px] p-5 bg-[#0E0E12] text-[#F5F5F5] overflow-y-auto flex flex-col gap-4">
                
                {/* Search & Replace / Quick Correction Bar */}
                <div className="flex items-center gap-2 p-2 bg-[#16161D] border border-[#2A2A35] rounded-lg text-xs">
                  <span className="text-gray-400 font-medium">🔍 Quick Fix:</span>
                  <input
                    type="text"
                    placeholder="Find word (e.g. charge)..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-[#0D0D11] border border-[#333] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#635BFF] flex-1"
                  />
                  <span className="text-gray-500">→</span>
                  <input
                    type="text"
                    placeholder="Replace with (e.g. ChatGPT)..."
                    value={replaceTerm}
                    onChange={(e) => setReplaceTerm(e.target.value)}
                    className="bg-[#0D0D11] border border-[#333] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#635BFF] flex-1"
                  />
                  <button
                    onClick={handleSearchReplace}
                    disabled={!searchTerm.trim()}
                    className="px-3 py-1 bg-[#635BFF] hover:bg-[#5249e6] text-white font-bold rounded text-xs transition-all disabled:opacity-40 shrink-0"
                  >
                    Replace All
                  </button>
                  <button
                    onClick={() => loadAudioTranscript(film.id, true)}
                    disabled={loadingWords}
                    className="px-3 py-1 bg-[#1A1A22] hover:bg-[#252530] border border-[#333] text-gray-300 hover:text-white font-medium rounded text-xs transition-all flex items-center gap-1 shrink-0"
                    title="Re-sync and fetch fresh word timestamps directly from current audio"
                  >
                    <span>{loadingWords ? "⏳" : "🔄"}</span>
                    <span>Re-sync from Audio</span>
                  </button>

                  <button
                    onClick={handleSyncSpokenTextFromWords}
                    className="px-3.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs transition-all flex items-center gap-1.5 shrink-0 shadow-md shadow-emerald-900/30"
                    title="Update spoken text screenplay blocks with all insertions, edits, and deletions made here"
                  >
                    <span>✨</span>
                    <span>Sync Spoken Text from Modified Words</span>
                  </button>
                </div>

                {/* Instructions Bar with Legend */}
                <div className="flex items-center justify-between text-[11px] text-[#8A8A8E] bg-[#14141A] px-3 py-1.5 rounded border border-[#222] flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span>💡 <strong>Click</strong> word to inspect/edit without auto-playing audio.</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/40 font-bold">
                      ● Yellow = Inserted
                    </span>
                    <span className="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/40 font-bold">
                      ● Green = Modified
                    </span>
                    <span className="inline-flex items-center gap-1 bg-red-950/40 text-red-400 line-through px-1.5 py-0.5 rounded border border-red-800 font-bold">
                      ● Strikethrough = Deleted
                    </span>
                  </div>
                </div>

                {/* Interactive Word Flow Stream */}
                {loadingWords ? (
                  <div className="flex items-center justify-center py-16 text-xs text-gray-400">
                    <span className="animate-spin mr-2">⏳</span> Loading word-level transcript alignment...
                  </div>
                ) : transcriptWords.length > 0 ? (
                  <div className="leading-loose flex flex-wrap gap-x-1.5 gap-y-2 p-2 selection:bg-[#635BFF]/30">
                    {transcriptWords.map((w) => {
                      const isActive = activeWordId === w.id;
                      const isDeleted = w.deleted;
                      const isModified = w.modified;
                      const isInserted = w.inserted;
                      return (
                        <span
                          key={w.id}
                          onClick={() => handleOpenWordEditor(w)}
                          title={`[${formatTime(w.start)}] Click to edit or insert words`}
                          className={`cursor-pointer px-2 py-0.5 rounded text-sm transition-all inline-flex items-center gap-1 font-sans ${
                            isDeleted
                              ? "line-through text-red-400/70 bg-red-950/40 border border-red-800/60 opacity-60"
                              : isInserted
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/60 font-bold shadow-sm ring-1 ring-amber-500/30"
                              : isActive
                              ? "bg-[#635BFF] text-white font-bold shadow-lg shadow-[#635BFF]/40 scale-105 ring-2 ring-white/50"
                              : isModified
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/60 font-bold"
                              : "text-gray-200 hover:text-white hover:bg-[#252530] hover:border hover:border-[#444]"
                          }`}
                        >
                          {isInserted && <span className="text-[10px] text-amber-400">➕</span>}
                          {w.punctuated}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-gray-500 flex flex-col items-center gap-3">
                    <p>No audio transcript synced yet. Click "Generate Voiceover" to create speech audio & word alignment.</p>
                    <button
                      onClick={handleGenerateVoiceover}
                      disabled={generating}
                      className="px-4 py-1.5 bg-[#635BFF] hover:bg-[#5249e6] text-white font-bold rounded text-xs"
                    >
                      Generate Voiceover
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* VIEW MODE 2: FULL SCREENPLAY EDITOR */}
            {viewMode === "screenplay" && (
              <textarea
                value={script}
                onChange={(e) => {
                  setScript(e.target.value);
                  setHasTranscriptEdits(true);
                }}
                placeholder="Paste your director script here with ## [timestamp] headers, **VISUAL:** notes, **ON-SCREEN TEXT:** and **VO:** dialogue..."
                className="w-full h-full min-h-[380px] p-4 bg-transparent text-[#F5F5F5] font-mono text-sm leading-relaxed outline-none resize-none selection:bg-[#635BFF]/30 placeholder:text-gray-600"
                spellCheck={false}
              />
            )}

            {/* VIEW MODE 3: SPOKEN TEXT ONLY */}
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
              <div>• <strong>Interactive:</strong> Click any word to edit speech and re-synthesize</div>
            </div>
          </div>

          {/* Screenplay Workflow Card */}
          <div className="bg-[#121216] border border-[#26262E] rounded-xl p-4 flex flex-col gap-3 text-xs text-[#8A8A8E]">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>🎬</span> Word-Level Directing Guide
            </h3>
            <ul className="space-y-2 list-disc list-inside text-[11px]">
              <li><strong>Click word:</strong> Opens inspector & jumps playhead (audio stays paused).</li>
              <li><strong>Insert words:</strong> Spliced words appear in bright yellow.</li>
              <li><strong>Edit text:</strong> Fix pronunciation (e.g. "charge" → "ChatGPT").</li>
              <li><strong>Delete:</strong> Strikes word out from spoken audio.</li>
              <li><strong>Re-synthesize:</strong> Regenerates audio with your corrections.</li>
            </ul>
          </div>
        </div>

      </div>

      {/* FLOATING INLINE WORD EDITOR POPUP MODAL */}
      {selectedWord && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121216] border border-[#333] rounded-xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in duration-150">
            
            <div className="flex items-center justify-between border-b border-[#222] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">✏️</span>
                <h3 className="text-sm font-bold text-white">Edit Spoken Word / Feedback</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePlayWordSnippet(selectedWord)}
                  className="text-xs px-2.5 py-1 rounded bg-[#635BFF]/20 hover:bg-[#635BFF]/30 text-[#635BFF] border border-[#635BFF]/40 font-bold flex items-center gap-1"
                  title="Play 1.5s audio snippet around this word"
                >
                  <span>▶</span> Play Snippet
                </button>
                <span className="text-xs bg-[#1E1E24] text-[#8A8A8E] border border-[#333] px-2 py-0.5 rounded font-mono">
                  {formatTime(selectedWord.start)}
                </span>
              </div>
            </div>

            {/* Word Edit Field */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                Current Word in Speech:
              </label>
              <div className="text-sm font-mono font-bold text-emerald-400 bg-[#0E0E12] p-2.5 rounded border border-[#222]">
                "{selectedWord.punctuated}"
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                Replace / Correct Word:
              </label>
              <input
                type="text"
                value={editingWordText}
                onChange={(e) => setEditingWordText(e.target.value)}
                placeholder="e.g. ChatGPT, G-P-T, smarter than GPT..."
                className="w-full bg-[#181820] border border-[#333] rounded p-2.5 text-sm text-white font-mono outline-none focus:border-[#635BFF]"
                autoFocus
              />
              <p className="text-[11px] text-gray-500">
                Tip: You can replace with multiple words or phonetic spellings (e.g. "G P T").
              </p>
            </div>

            {/* Insert After Section with Yellow Highlight Preview */}
            <div className="flex flex-col gap-2 bg-[#16161D] p-3 rounded-lg border border-[#2A2A35]">
              <div className="flex items-center justify-between">
                <label className="text-xs text-amber-300 font-bold flex items-center gap-1">
                  <span>➕</span> Insert Words Immediately After:
                </label>
                {insertText.trim() && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-mono font-bold">
                    Will appear in Yellow
                  </span>
                )}
              </div>
              <input
                type="text"
                value={insertText}
                onChange={(e) => setInsertText(e.target.value)}
                placeholder="e.g. smarter than ChatGPT..."
                className="w-full bg-[#0D0D11] border border-[#333] rounded p-2 text-xs text-white font-mono outline-none focus:border-amber-400"
              />
              {insertText.trim() && (
                <div className="text-[11px] text-gray-400 flex items-center gap-1.5 p-1.5 bg-[#0A0A0E] rounded border border-[#222]">
                  <span>Preview:</span>
                  <span className="text-gray-300 font-mono">"{selectedWord.punctuated}"</span>
                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/50 px-1.5 py-0.5 rounded font-mono font-bold">
                    + "{insertText.trim()}"
                  </span>
                </div>
              )}
              <button
                onClick={handleInsertWordsAfter}
                disabled={!insertText.trim()}
                className="mt-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded text-xs transition-all disabled:opacity-40 self-end flex items-center gap-1"
              >
                <span>➕</span> Apply Inserted Words (Yellow)
              </button>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-[#222]">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteWord}
                  className="text-xs px-3 py-1.5 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800 font-bold transition-all"
                  title="Remove this word from the voiceover"
                >
                  ❌ Delete Word
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedWord(null)}
                  className="text-xs px-3 py-1.5 rounded bg-[#1A1A20] hover:bg-[#222] text-gray-400 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyWordEdit}
                  className="text-xs px-4 py-1.5 rounded bg-[#635BFF] hover:bg-[#5249e6] text-white font-bold transition-all shadow-md"
                >
                  Apply Word Edit
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
