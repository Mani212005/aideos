/**
 * File Description: Application shell for Aideos Studio.
 * Owns the information architecture: one header, one stage rail that follows the production
 * workflow from script to review, one stage surface, and one context inspector. Holds the project
 * state, the shared layer-model timeline API, playback state and the global keyboard map, and
 * hands each stage exactly what it needs. No stage owns its own history: every edit is committed
 * through the project's single labelled undo stack.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import {
  Bot,
  Check,
  Compass,
  Download,
  FileText,
  Film as FilmIcon,
  History,
  Loader2,
  Palette,
  Plus,
  Save,
  Shapes,
  Sparkles,
  Subtitles,
  TriangleAlert,
} from "lucide-react";
import { whatIsJepaFilm } from "../../src/dl/films/what-is-jepa";
import { kvcacheFilm } from "../../src/dl/films/kvcache";
import { useFilmProject } from "./state/useFilmProject";
import { useLayeredTimeline } from "./state/useLayeredTimeline";
import { Badge, Button, Panel, RailTab, Select, Spinner, ToastStack } from "./components/ui";
import { InspectorPanel } from "./components/shell/InspectorPanel";
import { ScriptStage } from "./screens/ScriptStage";
import { StoryStage } from "./screens/StoryStage";
import { LookStage } from "./screens/LookStage";
import { MotionStage } from "./screens/MotionStage";
import { EditStage } from "./screens/EditStage";
import { CaptionsStage } from "./screens/CaptionsStage";
import { ReviewStage } from "./screens/ReviewStage";
import { ExportProgressModal } from "./components/ExportProgressModal";
import { NewProjectModal } from "./components/NewProjectModal";
import { GlobalFeedbackWidget } from "./components/GlobalFeedbackWidget";
import { AgentActivityInspector } from "./components/AgentActivityInspector";
import { AgentConnect } from "./components/AgentConnect";

/** How the header names who made the open film's design; "templates" is flagged as a fallback. */
const DESIGN_SOURCE_LABEL = {
  agent: "Designed by agent",
  "server-model": "Designed by model",
  "hand-built": "Hand-built design",
  templates: "Template fallback",
} as const;

/**
 * The project list comes from the dev server at runtime. The editor deliberately does not import
 * the generated film modules: doing so makes Vite treat every autosave (which rewrites those
 * modules) as a source change and hot-reloads the whole page out from under the user.
 */
const bundledFilmIds: string[] = [whatIsJepaFilm.id, kvcacheFilm.id];

export const FORMATS = {
  long: { width: 1920, height: 1080, label: "16:9" },
  reel: { width: 1080, height: 1920, label: "9:16" },
} as const;

export type Format = keyof typeof FORMATS;

type Stage = "script" | "story" | "look" | "motion" | "edit" | "captions" | "review";

const STAGES: Array<{ id: Stage; label: string; icon: typeof FileText; title: string }> = [
  { id: "script", label: "Script", icon: FileText, title: "Write the screenplay and synthesize the voiceover" },
  { id: "story", label: "Story", icon: Compass, title: "Lay out the spatial map the camera moves across" },
  { id: "look", label: "Look", icon: Palette, title: "Theme, typography and per-shot styling" },
  { id: "motion", label: "Motion", icon: Shapes, title: "Author custom SVG animations and place them on the timeline" },
  { id: "edit", label: "Edit", icon: FilmIcon, title: "Preview, arrange lanes and cut the film" },
  { id: "captions", label: "Captions", icon: Subtitles, title: "Tune word-level caption timing" },
  { id: "review", label: "Review", icon: Bot, title: "Project health, pacing and AI critique" },
];

export type SelectionTarget =
  | { kind: "shot"; id: string }
  | { kind: "node"; id: string }
  | { kind: "clip"; id: string }
  | { kind: "history" }
  | null;

/** Root application shell: header, stage rail, active stage and the context inspector. */
export default function App() {
  const project = useFilmProject(whatIsJepaFilm || kvcacheFilm, bundledFilmIds);
  const { film, commit, notify } = project;

  // The stage lives in the URL hash, so a reload (Vite hot-reloads the page when an agent's design
  // build adds artwork) keeps the user where they were, and a stage can be linked to directly.
  const [stage, setStageState] = useState<Stage>(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    return (STAGES.some((s) => s.id === fromHash) ? fromHash : "script") as Stage;
  });
  const setStage = useCallback((next: Stage) => {
    setStageState(next);
    window.history.replaceState(null, "", `#${next}`);
  }, []);
  const [selection, setSelection] = useState<SelectionTarget>(null);
  const [format, setFormat] = useState<Format>("long");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ filename: string; downloadUrl: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // On a narrow window the inspector starts collapsed so the stage keeps a usable width. The user
  // can open it at any time and that choice is then respected for the rest of the session.
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1180);
  const playerRef = useRef<PlayerRef>(null);

  /** Surface a rejected timeline edit as a readable, non-blocking message. */
  const handleReject = useCallback((message: string) => notify("warn", message), [notify]);

  const timelineApi = useLayeredTimeline({ film, commit, onReject: handleReject });

  const accent = film.accent || film.theme?.accent || "#635BFF";

  /** Change the accent colour on the film itself rather than holding a parallel copy in the shell. */
  const setAccent = useCallback(
    (next: string) => {
      commit({ ...film, accent: next, theme: { ...(film.theme ?? {}), accent: next } }, "Change accent colour");
    },
    [commit, film],
  );

  /** Seek the preview player and keep the timeline playhead in step. */
  const seekFrame = useCallback(
    (frame: number) => {
      const clamped = Math.max(0, Math.min(project.durationFrames - 1, Math.round(frame)));
      setCurrentFrame(clamped);
      playerRef.current?.seekTo(clamped);
    },
    [project.durationFrames],
  );

  /** Toggle preview playback from anywhere in the shell. */
  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
  }, []);

  // Keep the shell's frame and playing state in step with the Remotion player.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onFrame = (e: { detail: { frame: number } }) => setCurrentFrame(e.detail.frame);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
    };
  }, [stage]);

  // Global shortcuts that are not timeline-specific.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void project.save();
        return;
      }
      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) project.redo();
        else project.undo();
        return;
      }
      if (e.key === "]" || e.key === "[") {
        e.preventDefault();
        const idx = STAGES.findIndex((s) => s.id === stage);
        const next = e.key === "]" ? Math.min(STAGES.length - 1, idx + 1) : Math.max(0, idx - 1);
        setStage(STAGES[next].id);
        return;
      }
      if (/^[1-7]$/.test(e.key)) {
        e.preventDefault();
        setStage(STAGES[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [project, stage]);

  const pendingBrollCount = useMemo(
    () =>
      film.shots.filter(
        (s) => s.needsFootage && !s.blocks.some((b) => b.c === "AnalogyInset" && Boolean((b as { src?: string }).src)),
      ).length,
    [film.shots],
  );

  /** Render the film to an MP4 through the dev server and hand the user the download. */
  const handleExport = useCallback(async () => {
    if (pendingBrollCount > 0) {
      notify("warn", `${pendingBrollCount} shot(s) still need generated footage. Generate B-roll before exporting.`);
      return;
    }
    setIsExporting(true);
    setExportResult(null);
    setExportError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Export the same film the preview plays, so hidden and muted lanes are honoured.
        body: JSON.stringify({ film: timelineApi.renderFilm, format }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");
      setExportResult({ filename: data.filename, downloadUrl: data.downloadUrl });
      notify("success", `Export complete: ${data.filename}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportError(message);
      notify("danger", `Export failed: ${message}`);
    }
  }, [format, notify, pendingBrollCount, timelineApi.renderFilm]);

  const hasVoiceover = Boolean(film.voiceover?.src);

  const stageFlags = useMemo<Record<Stage, "none" | "warn" | "success">>(
    () => ({
      script: hasVoiceover ? "success" : "warn",
      story: film.canvas.nodes.length > 1 ? "none" : "warn",
      look: "none",
      motion: "none",
      edit: hasVoiceover ? "none" : "warn",
      captions: film.captions ? "success" : "none",
      review: project.validation.ok ? "none" : "warn",
    }),
    [film.canvas.nodes.length, film.captions, hasVoiceover, project.validation.ok],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b-2 border-ink bg-paper-2 px-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 border-2 border-ink bg-primary px-2 py-1 font-sans text-[13px] font-black uppercase leading-none tracking-[-0.02em] text-ink shadow-nb-sm">
            Aideos
          </span>
          <div className="flex min-w-0 items-center gap-1.5">
            <label htmlFor="project-switcher" className="sr-only">
              Active project
            </label>
            <Select
              id="project-switcher"
              value={film.id}
              onChange={(e) => void project.selectFilm(e.target.value)}
              className="h-8 w-[clamp(140px,22vw,320px)] py-0 text-[11px]"
              title="Switch project"
            >
              {project.filmIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
            <Button size="sm" iconOnly onClick={() => setIsNewProjectOpen(true)} title="Create a new project">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Badge
            tone={project.validation.ok ? "success" : "warn"}
            icon={project.validation.ok ? <Check className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
            title={project.validation.message}
            className="hidden md:inline-flex"
          >
            {project.validation.ok ? "Valid" : "Check"}
          </Badge>

          {project.film.design && (
            <Badge
              tone={project.film.design.source === "templates" ? "warn" : "select"}
              icon={project.film.design.source === "templates" ? <TriangleAlert className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              title={project.film.design.brief?.concept ?? project.film.design.note ?? ""}
              className="hidden lg:inline-flex"
            >
              {DESIGN_SOURCE_LABEL[project.film.design.source]}
            </Badge>
          )}

          <AgentConnect />

          <AgentActivityInspector />

          <Button
            size="sm"
            onClick={() => void project.save()}
            disabled={project.saving}
            title="Save the project to disk (Cmd+S)"
          >
            {project.saving ? <Spinner /> : <Save className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{project.isDirty ? "Save" : "Saved"}</span>
          </Button>

          <Button
            size="sm"
            tone="primary"
            onClick={() => void handleExport()}
            disabled={isExporting}
            title="Render the film to an MP4"
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Stage rail */}
        <nav
          aria-label="Production stages"
          className="flex w-[68px] shrink-0 flex-col overflow-y-auto border-r-2 border-ink bg-paper"
        >
          {STAGES.map((s, i) => (
            <RailTab
              key={s.id}
              label={s.label}
              title={`${s.title} (${i + 1})`}
              index={i + 1}
              icon={<s.icon className="h-4 w-4" />}
              active={stage === s.id}
              flag={stageFlags[s.id]}
              onClick={() => setStage(s.id)}
            />
          ))}
          <div className="mt-auto border-t-2 border-ink p-1.5">
            <Button
              size="xs"
              block
              tone={selection?.kind === "history" ? "select" : "default"}
              onClick={() => {
                setSelection(selection?.kind === "history" ? null : { kind: "history" });
                setInspectorOpen(true);
              }}
              title="Show the edit history"
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          </div>
        </nav>

        {/* Stage surface */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-paper">
          {project.isLoading ? (
            <Panel tone="flat" className="m-3 flex-1 items-center justify-center border-2">
              <div className="flex flex-col items-center gap-2 p-8">
                <Loader2 className="h-6 w-6 animate-spin text-ink-soft" />
                <p className="font-sans text-xs font-bold uppercase tracking-[0.1em] text-ink-soft">
                  Loading project
                </p>
              </div>
            </Panel>
          ) : (
            <>
              {stage === "script" && (
                <ScriptStage film={film} commit={commit} notify={notify} onGoToEdit={() => setStage("edit")} />
              )}
              {stage === "story" && (
                <StoryStage
                  film={film}
                  commit={commit}
                  selectedNodeId={selection?.kind === "node" ? selection.id : null}
                  onSelectNode={(id) => setSelection(id ? { kind: "node", id } : null)}
                />
              )}
              {stage === "look" && (
                <LookStage
                  film={film}
                  commit={commit}
                  accent={accent}
                  onAccentChange={setAccent}
                  onSelectShot={(id) => setSelection({ kind: "shot", id })}
                />
              )}
              {stage === "motion" && <MotionStage film={film} commit={commit} notify={notify} />}
              {stage === "edit" && (
                <EditStage
                  film={film}
                  project={project}
                  api={timelineApi}
                  accent={accent}
                  format={format}
                  onFormatChange={setFormat}
                  playerRef={playerRef}
                  currentFrame={currentFrame}
                  isPlaying={isPlaying}
                  onSeekFrame={seekFrame}
                  onTogglePlay={togglePlay}
                  selectedClipIds={selectedClipIds}
                  onSelectionChange={(ids) => {
                    setSelectedClipIds(ids);
                    setSelection(ids.length > 0 ? { kind: "clip", id: ids[0] } : null);
                  }}
                  onReject={handleReject}
                  onGoToScript={() => setStage("script")}
                />
              )}
              {stage === "captions" && (
                <CaptionsStage film={film} commit={commit} onSeekFrame={seekFrame} />
              )}
              {stage === "review" && (
                <ReviewStage
                  film={film}
                  project={project}
                  api={timelineApi}
                  onSelectShot={(id) => setSelection({ kind: "shot", id })}
                  onSeekFrame={seekFrame}
                />
              )}
            </>
          )}
        </main>

        {/* Context inspector */}
        <InspectorPanel
          open={inspectorOpen}
          onToggle={() => setInspectorOpen((prev) => !prev)}
          film={film}
          project={project}
          api={timelineApi}
          selection={selection}
          onSelectionChange={setSelection}
          onSeekFrame={seekFrame}
        />
      </div>

      <ToastStack toasts={project.toasts} onDismiss={project.dismissToast} />

      <ExportProgressModal
        isOpen={isExporting}
        film={film}
        format={format}
        durationInFrames={project.durationFrames}
        result={exportResult}
        error={exportError}
        onClose={() => {
          setIsExporting(false);
          setExportResult(null);
          setExportError(null);
        }}
      />

      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onProjectCreated={(newFilm) => {
          project.registerFilm(newFilm);
          setStage("script");
          notify("success", `Created project "${newFilm.title}"`);
        }}
      />

      <GlobalFeedbackWidget
        film={film}
        activeMode={stage}
        activeSelectionId={selection && selection.kind !== "history" ? selection.id : undefined}
        onUpdateFilm={(next) => commit(next, "AI assistant edit")}
      />
    </div>
  );
}
