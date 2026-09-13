/**
 * File Description: Review stage for Aideos Studio.
 * The "is this ready" screen. It answers four questions with data rather than prose: how healthy is
 * the project, where is the time going shot by shot, which script beats actually reached the
 * timeline, and how much of the run time is narration versus silence. The AI critique studio sits
 * underneath so a reviewer can act on what the numbers show without changing screens.
 */

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { generateWordsFromFilm } from "../../../src/dl/captionsParser";
import { calculateSyncDrift } from "../../../backend/timeline/voiceover_engine";
import type { FilmProject } from "../state/useFilmProject";
import type { LayeredTimelineApi } from "../state/useLayeredTimeline";
import {
  BarChart,
  CoverageMap,
  DensityStrip,
  HealthGauge,
  Note,
  Panel,
  PanelBody,
  PanelHeader,
  Stat,
} from "../components/ui";
import { CritiqueStudio } from "../components/CritiqueStudio";

export interface ReviewStageProps {
  film: Film;
  project: FilmProject;
  api: LayeredTimelineApi;
  onSelectShot: (id: string) => void;
  onSeekFrame: (frame: number) => void;
}

/** Project readiness: health score, pacing, script coverage and narration density. */
export function ReviewStage({ film, project, api, onSelectShot, onSeekFrame }: ReviewStageProps) {
  const fps = film.fps || 30;

  const pacing = useMemo(
    () =>
      film.shots.map((shot, idx) => ({
        label: `${idx + 1}`,
        value: Number((shot.dur ?? 0).toFixed(2)),
        title: `Shot ${idx + 1}: ${shot.id} runs ${(shot.dur ?? 0).toFixed(2)}s`,
        color:
          (shot.dur ?? 0) > 25
            ? "var(--nb-danger)"
            : (shot.dur ?? 0) < 3
              ? "var(--nb-warn)"
              : "var(--nb-select)",
      })),
    [film.shots],
  );

  const meanShotSec = useMemo(
    () => (film.shots.length ? film.shots.reduce((a, s) => a + (s.dur ?? 0), 0) / film.shots.length : 0),
    [film.shots],
  );

  const coverage = useMemo(
    () =>
      film.shots.map((shot) => ({
        label: shot.id,
        covered: Boolean((shot.scriptText ?? "").trim().length > 0),
        detail: (shot.scriptText ?? "").trim()
          ? `${shot.id} carries narration`
          : `${shot.id} has no narration text, so it will play silent`,
      })),
    [film.shots],
  );

  const narrationSpans = useMemo(() => {
    const words = generateWordsFromFilm(film as unknown as Record<string, unknown>);
    return words.map((w) => ({ startSec: w.startFrame / fps, endSec: w.endFrame / fps, label: w.text }));
  }, [film, fps]);

  const drift = useMemo(() => calculateSyncDrift(api.layered), [api.layered]);

  const health = useMemo(() => {
    let score = 100;
    if (!project.validation.ok) score -= 35;
    if (!film.voiceover?.src) score -= 25;
    const silentShots = coverage.filter((c) => !c.covered).length;
    score -= Math.min(20, silentShots * 4);
    if (!drift.isSynchronized) score -= Math.min(15, Math.abs(drift.driftSec));
    const longShots = film.shots.filter((s) => (s.dur ?? 0) > 30).length;
    score -= Math.min(10, longShots * 5);
    return Math.max(0, Math.round(score));
  }, [coverage, drift, film.shots, film.voiceover?.src, project.validation.ok]);

  const issues = useMemo(() => {
    const list: string[] = [];
    if (!project.validation.ok) list.push(project.validation.message);
    if (!film.voiceover?.src) list.push("No voiceover has been generated, so the timeline has nothing to lock to.");
    const silent = coverage.filter((c) => !c.covered);
    if (silent.length > 0) list.push(`${silent.length} shot(s) carry no narration text: ${silent.map((s) => s.label).join(", ")}`);
    if (!drift.isSynchronized) list.push(`Visuals and narration differ by ${drift.driftSec.toFixed(2)}s.`);
    const pending = film.shots.filter((s) => s.needsFootage).length;
    if (pending > 0) list.push(`${pending} shot(s) are still waiting on generated B-roll footage.`);
    return list;
  }, [coverage, drift, film.shots, project.validation]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pb-6">
      <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <PanelHeader title="Readiness" accent />
          <PanelBody scroll={false} className="flex flex-col items-center gap-3 p-3">
            <HealthGauge value={health} label="Ready to export" />
            <div className="w-full">
              <Stat label="Shots" value={film.shots.length} />
              <Stat label="Run time" value={`${project.durationSec.toFixed(1)}s`} />
              <Stat label="Mean shot" value={`${meanShotSec.toFixed(1)}s`} />
              <Stat
                label="Narration drift"
                value={`${drift.driftSec > 0 ? "+" : ""}${drift.driftSec.toFixed(2)}s`}
                tone={drift.isSynchronized ? "ink" : "danger"}
              />
            </div>
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader title="What needs attention" />
          <PanelBody scroll className="flex flex-col gap-1.5 p-3">
            {issues.length === 0 ? (
              <Note tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                Nothing is blocking an export. Every shot carries narration and the timeline matches the voiceover.
              </Note>
            ) : (
              issues.map((issue, i) => (
                <Note key={i} tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                  {issue}
                </Note>
              ))
            )}
          </PanelBody>
        </Panel>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Pacing by shot" />
          <PanelBody scroll={false} className="p-3">
            <p className="mb-2 font-sans text-[11px] leading-snug text-ink-soft">
              Each bar is one shot's run time. The dashed line is the average. Bars in red run over
              thirty seconds, which usually reads as a stall; bars in orange are under three seconds.
              Click a bar to inspect that shot.
            </p>
            <BarChart
              data={pacing}
              unit="s"
              height={130}
              reference={meanShotSec}
              referenceLabel={`avg ${meanShotSec.toFixed(1)}s`}
              onSelect={(idx) => {
                const shot = film.shots[idx];
                if (!shot) return;
                onSelectShot(shot.id);
                onSeekFrame(Math.round((shot.position ?? shot.startSec ?? 0) * fps));
              }}
              emptyLabel="No shots yet"
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Script coverage" />
          <PanelBody scroll={false} className="p-3">
            <p className="mb-2 font-sans text-[11px] leading-snug text-ink-soft">
              One square per shot. Filled squares carry narration; hatched squares will play silent.
            </p>
            <CoverageMap cells={coverage} />
          </PanelBody>
        </Panel>
      </div>

      <Panel className="shrink-0">
        <PanelHeader title="Narration versus silence" />
        <PanelBody scroll={false} className="p-3">
          <DensityStrip
            spans={narrationSpans}
            totalSec={Math.max(project.durationSec, 1)}
            height={30}
          />
        </PanelBody>
      </Panel>

      <Panel className="h-[520px] shrink-0">
        <PanelHeader title="AI critique" />
        <PanelBody bare className="min-h-0 overflow-hidden">
          <CritiqueStudio
            film={film}
            onUpdateFilm={(next) => project.commit(next, "AI critique edit")}
            canUndo={project.canUndo}
            onUndo={project.undo}
            validationStatus={project.validation}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
