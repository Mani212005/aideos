/**
 * File Description: Application shell for Aideos Studio.
 * Owns the information architecture: one header (Films, Undo, Redo, Agent, Save, Export), one lens bar that follows the production
 * workflow from Words to Check (Check holds the verdict and Export), and one surface: the Films home or the open lens. Holds the project
 * state, the shared layer-model timeline API, playback state and the global keyboard map, and
 * hands each lens exactly what it needs. No lens owns its own history: every edit is committed
 * through the project's single labelled undo stack.
 * Inputs and outputs: application props and state -> rendered single-page studio application with navigation.
 * Used by: editor/src/main.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import {
  Bot,
  Download,
  FileText,
  Film as FilmIcon,
  Loader2,
  Palette,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import { PLACEHOLDER_FILM } from "./state/placeholderFilm";
import { deliveryTimeline } from "../../src/dl/delivery";
import { useFilmProject } from "./state/useFilmProject";
import { FilmSaveContext } from "./state/FilmSaveContext";
import { useLayeredTimeline } from "./state/useLayeredTimeline";
import { Button, Panel, Spinner, ToastStack } from "./components/ui";
import { LensBar } from "./components/shell/LensBar";
import { FilmsHome } from "./components/shell/FilmsHome";
import { AgentSheet } from "./components/shell/AgentSheet";
import { ScriptStage } from "./screens/ScriptStage";
import { LookStage } from "./screens/LookStage";
import { EditStage } from "./screens/EditStage";
import { CheckStage } from "./screens/CheckStage";
import { useExportJob } from "./state/useExportJob";
import type { ExportJobSnapshot } from "../../backend/exportJobTypes";
import { DEFAULT_PROJECT_ACCENT } from "../../src/projectTheme";

/**
 * The project list comes from the dev server at runtime. The editor deliberately does not import
 * the generated film modules: doing so makes Vite treat every autosave (which rewrites those
 * modules) as a source change and hot-reloads the whole page out from under the user.
 */
const bundledFilmIds: string[] = [PLACEHOLDER_FILM.id];

export const FORMATS = {
  long: { width: 1920, height: 1080, label: "16:9" },
  reel: { width: 1080, height: 1920, label: "9:16" },
} as const;

export type Format = keyof typeof FORMATS;

type Stage = "script" | "look" | "cut" | "review";

/** What the surface shows: one lens, or the Films home. */
type View = Stage | "films";

const STAGES: Array<{ id: Stage; label: string; icon: typeof FileText; title: string }> = [
  { id: "script", label: "Words", icon: FileText, title: "Edit the words. Record the voice." },
  { id: "look", label: "Look", icon: Palette, title: "Set how the film looks. Ask the agent for a change." },
  { id: "cut", label: "Cut", icon: FilmIcon, title: "Set time and order. Edit caption words." },
  { id: "review", label: "Check", icon: Bot, title: "Test the film quality." },
];

/** Old links that now open the lens that took over their work: Edit became Cut. */
const LEGACY_STAGE_HASH: Record<string, Stage> = { motion: "look", captions: "cut", edit: "cut" };

/** Root application shell: header, lens bar and the Films home or the open lens. */
export default function App() {
  const project = useFilmProject(PLACEHOLDER_FILM, bundledFilmIds);
  const { film, commit, notify } = project;

  // The view lives in the URL hash, so a reload (Vite hot-reloads the page when an agent's design
  // build adds artwork) keeps the user where they were, and a lens can be linked to directly.
  const [stage, setStageState] = useState<View>(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    if (fromHash === "films") return "films";
    // The Motion, Captions and Edit names are gone: their work moved into Look (Ask) and Cut.
    const linked = LEGACY_STAGE_HASH[fromHash] ?? fromHash;
    return (STAGES.some((s) => s.id === linked) ? linked : "script") as View;
  });
  const setStage = useCallback((next: View) => {
    setStageState(next);
    window.history.replaceState(null, "", `#${next}`);
  }, []);
  const [format, setFormat] = useState<Format>("long");
  // A finished render is announced, never downloaded: the user presses Download in the export dialog.
  const exportJob = useExportJob(
    useCallback(
      (job: ExportJobSnapshot) => {
        if (job.status === "done") notify("success", `Export ready: ${job.filename}`);
        else if (job.status === "failed") notify("danger", "Export failed. Open Check.");
      },
      [notify],
    ),
  );
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<PlayerRef>(null);
  const [mountedPlayer, setMountedPlayer] = useState<PlayerRef | null>(null);
  // Lets a newly mounted Player start where the timeline already is, instead of at frame 0.
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;
  // Attach playback observers whenever a Player mounts or is replaced.
  const attachPlayer = useCallback((player: PlayerRef | null) => {
    playerRef.current = player;
    setMountedPlayer(player);
  }, []);

  /** Surface a rejected timeline edit as a readable, non-blocking message. */
  const handleReject = useCallback((message: string) => notify("warn", message), [notify]);

  const timelineApi = useLayeredTimeline({ film, commit, onReject: handleReject });

  const accent = film.accent || film.theme?.accent || DEFAULT_PROJECT_ACCENT;

  /** Change the accent colour on the film itself rather than holding a parallel copy in the shell. */
  const setAccent = useCallback(
    (next: string) => {
      commit({ ...film, accent: next, theme: { ...(film.theme ?? {}), accent: next } }, "Change accent colour");
    },
    [commit, film],
  );

  // The delivered length of the format on screen: the story plus its compulsory end card (src/dl/delivery.ts).
  const deliveredFrames = useMemo(() => {
    try {
      return deliveryTimeline(film, format).totalFrames;
    } catch {
      return project.durationFrames;
    }
  }, [film, format, project.durationFrames]);

  /** Seek the preview player and keep the timeline playhead in step. */
  const seekFrame = useCallback(
    (frame: number) => {
      const clamped = Math.max(0, Math.min(deliveredFrames - 1, Math.round(frame)));
      setCurrentFrame(clamped);
      playerRef.current?.seekTo(clamped);
    },
    [deliveredFrames],
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
    const player = mountedPlayer;
    if (!player) return;

    const onFrame = (e: { detail: { frame: number } }) => setCurrentFrame(e.detail.frame);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    // A Player remounted by a stage switch or a preview refresh shows frame 0 until told otherwise.
    if (currentFrameRef.current > 0) player.seekTo(currentFrameRef.current);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
    };
  }, [mountedPlayer]);

  // Global shortcuts that are not timeline-specific.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (project.isLoading) return;
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
        setStage(STAGES[Math.max(0, next)].id);
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        e.preventDefault();
        setStage(STAGES[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [project, stage, setStage]);

  /** Opens the Check lens, where Export, Start, Cancel and Download live. Nothing renders until the user presses Start there. */
  const handleExport = useCallback(() => setStage("review"), [setStage]);

  const hasVoiceover = Boolean(film.voiceover?.src);

  const stageFlags = useMemo<Partial<Record<Stage, "warn" | "success">>>(
    () => ({
      script: hasVoiceover ? "success" : "warn",
      ...(hasVoiceover ? {} : { cut: "warn" as const }),
      ...(project.validation.ok ? {} : { review: "warn" as const }),
    }),
    [hasVoiceover, project.validation.ok],
  );

  /** Opens a film from the Films home in Words. */
  const openFilm = useCallback(
    async (id: string) => {
      if (id !== film.id && !(await project.selectFilm(id))) return;
      setStage("script");
    },
    [film.id, project, setStage],
  );

  return (
    <FilmSaveContext.Provider value={project.saveFilm}>
    <fieldset disabled={project.isLoading} className="contents">
    <div inert={project.isLoading} className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-paper-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            size="sm"
            tone={stage === "films" ? "select" : "default"}
            onClick={() => setStage("films")}
            title="Films"
            aria-pressed={stage === "films"}
          >
            Films
          </Button>
          <span className="min-w-0 truncate font-mono text-xs text-ink-soft" title={film.title}>
            {film.id}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" iconOnly onClick={project.undo} disabled={!project.canUndo} title={project.undoLabel ? `Undo ${project.undoLabel}` : "Undo"} aria-label="Undo">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" iconOnly onClick={project.redo} disabled={!project.canRedo} title={project.redoLabel ? `Redo ${project.redoLabel}` : "Redo"} aria-label="Redo">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>

          <AgentSheet />

          <Button
            size="sm"
            onClick={() => void project.save()}
            disabled={project.saving}
            title="Save the project to disk (Cmd+S)"
          >
            {project.saving ? <Spinner /> : <Save className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{project.saving ? "Saving" : project.isDirty ? "Save" : "Saved"}</span>
          </Button>

          {exportJob.job && stage !== "review" ? (
            <Button
              size="sm"
              tone={exportJob.job.status === "done" ? "success" : exportJob.job.status === "failed" ? "danger" : "select"}
              onClick={handleExport}
              title="Export"
              aria-label="Export"
            >
              {exportJob.active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span className="font-mono tabular-nums">
                {exportJob.active
                  ? `Exporting ${Math.round(exportJob.job.progress * 100)}%`
                  : exportJob.job.status === "done"
                    ? "Export ready"
                    : exportJob.job.status === "failed"
                      ? "Export failed"
                      : "Export cancelled"}
              </span>
            </Button>
          ) : null}

          <Button size="sm" tone="primary" onClick={handleExport} title="Export">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </header>

      <LensBar
        lenses={STAGES.map((s) => ({ id: s.id, label: s.label, icon: <s.icon className="h-4 w-4" />, title: s.title }))}
        active={stage === "films" ? null : stage}
        flags={stageFlags}
        onSelect={setStage}
      />

      {project.conflict ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-warn/10 px-3 py-1.5"
        >
          <p className="min-w-0 font-sans text-xs font-semibold text-ink">
            Film changed elsewhere. Your edits stay open.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={project.keepMine} title="Keep your version. It replaces the other on next save.">
              Keep mine
            </Button>
            <Button size="sm" onClick={project.takeTheirs} title="Open the other version. Yours stays in Undo.">
              Use theirs
            </Button>
          </div>
        </div>
      ) : null}

      {/* Surface */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-paper">
        {project.isLoading ? (
          <Panel tone="flat" className="m-3 flex-1 items-center justify-center border">
            <div className="flex flex-col items-center gap-2 p-8">
              <Loader2 className="h-6 w-6 animate-spin text-ink-soft" />
              <p className="font-sans text-xs font-semibold text-ink-soft">
                Loading
              </p>
            </div>
          </Panel>
        ) : (
          <>
            {stage === "script" && (
              <ScriptStage film={film} commit={commit} notify={notify} onGoToCut={() => setStage("cut")} />
            )}
            {stage === "look" && (
              <LookStage
                film={film}
                commit={commit}
                accent={accent}
                onAccentChange={setAccent}
                notify={notify}
              />
            )}
            {stage === "cut" && (
              <EditStage
                film={film}
                project={project}
                api={timelineApi}
                accent={accent}
                format={format}
                onFormatChange={setFormat}
                playerRef={playerRef}
                onPlayerMount={attachPlayer}
                currentFrame={currentFrame}
                isPlaying={isPlaying}
                onSeekFrame={seekFrame}
                onTogglePlay={togglePlay}
                selectedClipIds={selectedClipIds}
                onSelectionChange={setSelectedClipIds}
                onReject={handleReject}
                onGoToScript={() => setStage("script")}
              />
            )}
            {stage === "films" && (
              <FilmsHome
                filmIds={project.filmIds}
                openId={film.id}
                onOpen={(id) => void openFilm(id)}
                onStarted={async (newFilm) => {
                  if (!(await project.registerFilm(newFilm))) return false;
                  setStage("script");
                  notify("success", `Film started: ${newFilm.id}`);
                  return true;
                }}
              />
            )}
            {stage === "review" && (
              <CheckStage
                film={film}
                renderFilm={timelineApi.renderFilm}
                format={format}
                durationInFrames={deliveredFrames}
                validation={project.validation}
                hasVisibleVisuals={timelineApi.hasVisibleVisuals}
                exportJob={exportJob}
                onGoTo={setStage}
              />
            )}
          </>
        )}
      </main>

      <ToastStack toasts={project.toasts} onDismiss={project.dismissToast} />
    </div>
    </fieldset>
    </FilmSaveContext.Provider>
  );
}
