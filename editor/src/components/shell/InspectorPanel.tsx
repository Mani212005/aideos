/**
 * File Description: Context inspector for Aideos Studio.
 * The single right-hand column that always answers "what am I looking at and what can I change".
 * It switches on the current selection: a timeline clip, a shot, a canvas node, the edit history,
 * or, with nothing selected, a project overview with the shot list. Collapsing it gives the stage
 * its full width without hiding anything the user cannot get back.
 */

import React from "react";
import { ChevronLeft, ChevronRight, Clapperboard, History, Layers, ListTree, Undo2 } from "lucide-react";
import type { Film } from "../../../../src/dl/schema";
import type { FilmProject } from "../../state/useFilmProject";
import type { LayeredTimelineApi } from "../../state/useLayeredTimeline";
import type { SelectionTarget } from "../../App";
import { Badge, Button, Card, Panel, PanelBody, PanelHeader, Stat, cn } from "../ui";
import { ClipInspector } from "../ClipInspector";
import { ShotInspector } from "../ShotInspector";
import { NodeEditor } from "../NodeEditor";

export interface InspectorPanelProps {
  open: boolean;
  onToggle: () => void;
  film: Film;
  project: FilmProject;
  api: LayeredTimelineApi;
  selection: SelectionTarget;
  onSelectionChange: (next: SelectionTarget) => void;
  onSeekFrame: (frame: number) => void;
}

/** Right-hand context inspector whose contents follow the current selection. */
export function InspectorPanel({
  open,
  onToggle,
  film,
  project,
  api,
  selection,
  onSelectionChange,
  onSeekFrame,
}: InspectorPanelProps) {
  if (!open) {
    return (
      <div className="flex w-8 shrink-0 flex-col items-center border-l-2 border-ink bg-paper py-2">
        <Button tone="ghost" size="xs" iconOnly onClick={onToggle} title="Show the inspector">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const fps = film.fps || 30;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l-2 border-ink bg-paper">
      <PanelHeader
        title={titleFor(selection)}
        icon={iconFor(selection)}
        className="border-b-2"
        actions={
          <Button tone="ghost" size="xs" iconOnly onClick={onToggle} title="Hide the inspector">
            <ChevronRight className="h-4 w-4" />
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selection?.kind === "clip" ? (
          <ClipInspector
            api={api}
            clipId={selection.id}
            fps={fps}
            onSeekFrame={onSeekFrame}
            onClose={() => onSelectionChange(null)}
          />
        ) : null}

        {selection?.kind === "shot" ? (
          <div className="p-2">
            <ShotInspector
              film={film}
              selectedShotId={selection.id}
              onUpdateShot={(idx, updated, label) => {
                const shots = [...film.shots];
                shots[idx] = { ...shots[idx], ...updated };
                project.commit({ ...film, shots }, label || `Update ${shots[idx].id}`);
              }}
              onDeleteShot={(idx) => {
                if (film.shots.length <= 1) return;
                const removed = film.shots[idx];
                project.commit(
                  { ...film, shots: film.shots.filter((_, i) => i !== idx) },
                  `Delete shot ${removed.id}`,
                );
                onSelectionChange(null);
              }}
              onClose={() => onSelectionChange(null)}
            />
          </div>
        ) : null}

        {selection?.kind === "node" ? (
          <div className="p-2">
            <NodeEditor
              film={film}
              nodeId={selection.id}
              onChange={(next) => project.commit(next, "Edit canvas node")}
              onSelectShot={(id) => onSelectionChange({ kind: "shot", id })}
              onNodeIdChange={(id) => onSelectionChange({ kind: "node", id })}
              onClearSelection={() => onSelectionChange(null)}
            />
          </div>
        ) : null}

        {selection?.kind === "history" ? (
          <HistoryList project={project} />
        ) : null}

        {selection === null ? (
          <ProjectOverview
            film={film}
            project={project}
            api={api}
            onSelectShot={(id) => onSelectionChange({ kind: "shot", id })}
            onSeekFrame={onSeekFrame}
          />
        ) : null}
      </div>
    </aside>
  );
}

/** Inspector title for the current selection. */
function titleFor(selection: SelectionTarget): string {
  if (selection?.kind === "clip") return "Clip";
  if (selection?.kind === "shot") return "Shot";
  if (selection?.kind === "node") return "Canvas node";
  if (selection?.kind === "history") return "Edit history";
  return "Project";
}

/** Inspector icon for the current selection. */
function iconFor(selection: SelectionTarget): React.ReactNode {
  if (selection?.kind === "clip") return <Layers className="h-3.5 w-3.5" />;
  if (selection?.kind === "shot") return <Clapperboard className="h-3.5 w-3.5" />;
  if (selection?.kind === "node") return <ListTree className="h-3.5 w-3.5" />;
  if (selection?.kind === "history") return <History className="h-3.5 w-3.5" />;
  return <ListTree className="h-3.5 w-3.5" />;
}

interface HistoryListProps {
  project: FilmProject;
}

/** Scrollable list of every labelled edit, with the current position marked. */
function HistoryList({ project }: HistoryListProps) {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      <p className="font-sans text-[10px] leading-snug text-ink-mute">
        Every edit is one step. Click any step to jump the project back or forward to it.
      </p>
      {[...project.history].map((entry, idx) => {
        const isCurrent = idx === project.historyIndex;
        const isFuture = idx > project.historyIndex;
        return (
          <Card
            key={`${entry.at}-${idx}`}
            interactive
            selected={isCurrent}
            onClick={() => project.jumpTo(idx)}
            className={cn("flex items-center justify-between gap-2 px-2 py-1.5", isFuture && "opacity-50")}
          >
            <span className="min-w-0 truncate font-sans text-[11px] font-bold">{entry.label}</span>
            <span className="shrink-0 font-mono text-[9px] tabular-nums opacity-75">
              {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </Card>
        );
      }).reverse()}
      <Button size="sm" block disabled={!project.canUndo} onClick={project.undo} className="mt-1">
        <Undo2 className="h-3.5 w-3.5" />
        Undo {project.undoLabel ?? ""}
      </Button>
    </div>
  );
}

interface ProjectOverviewProps {
  film: Film;
  project: FilmProject;
  api: LayeredTimelineApi;
  onSelectShot: (id: string) => void;
  onSeekFrame: (frame: number) => void;
}

/** Default inspector view: the numbers that describe the project plus its shot list. */
function ProjectOverview({ film, project, api, onSelectShot, onSeekFrame }: ProjectOverviewProps) {
  const fps = film.fps || 30;

  return (
    <div className="flex flex-col gap-3 p-2">
      <Panel tone="flat" className="border-2">
        <PanelHeader title="Numbers" />
        <PanelBody scroll={false} className="p-2">
          <Stat label="Duration" value={`${project.durationSec.toFixed(1)}s`} />
          <Stat label="Frames" value={project.durationFrames.toLocaleString()} />
          <Stat label="FPS" value={fps} />
          <Stat label="Shots" value={film.shots.length} />
          <Stat label="Lanes" value={api.lanes.length} />
          <Stat label="Clips" value={api.layered.clips.length} />
          <Stat label="Canvas nodes" value={film.canvas.nodes.length} />
          <Stat
            label="Voiceover"
            value={film.voiceover?.src ? `${(film.voiceover.durationSec ?? 0).toFixed(1)}s` : "none"}
            tone={film.voiceover?.src ? "ink" : "warn"}
          />
        </PanelBody>
      </Panel>

      <Panel tone="flat" className="border-2">
        <PanelHeader
          title="Shots"
          actions={<Badge tone="quiet">{film.shots.length}</Badge>}
        />
        <PanelBody scroll={false} className="flex flex-col gap-1 p-2">
          {film.shots.map((shot, idx) => {
            const start = shot.position ?? shot.startSec ?? 0;
            return (
              <Card
                key={shot.id}
                interactive
                onClick={() => {
                  onSelectShot(shot.id);
                  onSeekFrame(Math.round(start * fps));
                }}
                className="flex items-center justify-between gap-2 px-2 py-1.5"
              >
                <span className="min-w-0 truncate font-sans text-[11px] font-bold">
                  {idx + 1}. {shot.id}
                </span>
                <span className="shrink-0 font-mono text-[9px] tabular-nums text-ink-mute">
                  {(shot.dur ?? 0).toFixed(1)}s
                </span>
              </Card>
            );
          })}
        </PanelBody>
      </Panel>
    </div>
  );
}
