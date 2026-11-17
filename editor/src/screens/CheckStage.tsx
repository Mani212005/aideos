/**
 * File Description: Check lens for Aideos Studio. One answer to "can this film go out": the state of the film (Draft, Fail, Pass, Old, OK), the 6 hard gates and the reviewer score against the 9.0 bar from acceptance.json, a fix list, and Export in the same lens (Export, Start, Cancel, Download). It replaces the Review charts, the Critique studio and the Export dialog. The fix list holds what refuses an export (footage, a hidden visual lane, missing music, sound effects or end card) and what a director can still fix (no voice, failed gates), so Export and the list never disagree.
 * Inputs and outputs: film, film on screen, format, validation and the export job -> the Check lens with the gate list, fix list and Export controls.
 * Used by: editor/src/App.tsx.
 */

import { useMemo } from "react";
import type { Film } from "../../../src/dl/schema";
import { deliveryGaps } from "../../../backend/deliveryGate";
import type { CheckResult, CheckView } from "../../../backend/filmAcceptance/checkView";
import type { ProjectValidation } from "../state/useFilmProject";
import { useAcceptanceCheck } from "../state/useAcceptanceCheck";
import type { ExportJobApi } from "../state/useExportJob";
import { CheckExport } from "../components/CheckExport";
import { StateChip } from "../components/StateChip";
import { Button, Note, Panel, PanelBody, PanelHeader, cn } from "../components/ui";

/** The lens a fix item opens. */
export type CheckTarget = "script" | "look" | "cut";

export interface CheckStageProps {
  /** The open film, as the shots and the voice are read from it. */
  film: Film;
  /** The film the preview plays and the export renders; the verdict is read for exactly this film. */
  renderFilm: Film;
  format: "long" | "reel";
  durationInFrames: number;
  validation: ProjectValidation;
  hasVisibleVisuals: boolean;
  exportJob: ExportJobApi;
  onGoTo: (target: CheckTarget) => void;
}

/** One line of the fix list. A blocking item refuses Export. */
interface FixItem {
  id: string;
  text: string;
  blocks: boolean;
  detail?: string;
  go?: { target: CheckTarget; label: string };
}

const RESULT_TEXT: Record<CheckResult, string> = {
  pass: "Pass",
  fail: "Fail",
  none: "Not run",
};
const RESULT_DOT: Record<CheckResult, string> = {
  pass: "bg-success",
  fail: "bg-danger",
  none: "bg-ink-mute",
};
const RESULT_TEXT_CLASS: Record<CheckResult, string> = {
  pass: "text-success",
  fail: "font-semibold text-danger",
  none: "text-ink-soft",
};

/** The shots that still wait for a clip: they need footage and hold no clip block with a source. */
export function shotsNeedingFootage(film: Film): number[] {
  const waiting: number[] = [];
  film.shots.forEach((s, i) => {
    if (s.needsFootage && !s.blocks.some((b) => b.c === "AnalogyInset" && Boolean((b as { src?: string }).src))) waiting.push(i + 1);
  });
  return waiting;
}

/** What the delivery gate says the cut lacks, as fix items: music, sound effects and the end card. The export refuses a film that lacks any of them. */
function deliveryItems(film: Film, format: "long" | "reel"): FixItem[] {
  let gaps: ReturnType<typeof deliveryGaps> = [];
  try {
    gaps = deliveryGaps(film, format);
  } catch {
    // A film the timeline cannot measure has no delivery answer here; the validation item says why.
    return [];
  }
  const items: FixItem[] = [];
  const sound = gaps.filter((g) => g.requirement !== "end-card").map((g) => g.requirement);
  if (sound.length > 0) {
    const text = sound.length === 2 ? "No music or sound effects." : sound[0] === "music" ? "No music." : "No sound effects.";
    items.push({ id: "sound", text, blocks: true, detail: `aideos design build ${film.id}` });
  }
  if (gaps.some((g) => g.requirement === "end-card"))
    items.push({ id: "end-card", text: "No end card.", blocks: true, detail: "aideos.config.json" });
  return items;
}

/** Plural of "shot" with its verb, for example "1 shot needs footage." */
function footageText(count: number): string {
  return count === 1 ? "1 shot needs footage." : `${count} shots need footage.`;
}

/** The short line beside the state chip. */
function verdictHint(view: CheckView): string {
  const failed = view.gates.filter((g) => g.result === "fail").length;
  switch (view.state) {
    case "draft":
      return "Not checked.";
    case "old":
      return "Film changed. Check again.";
    case "fail":
      if (failed > 0) return "Gates fail.";
      if (view.reviewerGatesFail) return "Reviewer gate fails.";
      return `Score ${view.score.text}. Bar ${view.score.bar}.`;
    case "pass":
      return view.score.text ? `Gates and score pass. Score ${view.score.text}.` : "Gates pass.";
    case "ok":
      return view.score.text ? `Accepted. Score ${view.score.text}.` : "Accepted.";
  }
}

/** The Check lens: verdict, gates, fix list and Export. */
export function CheckStage({ film, renderFilm, format, durationInFrames, validation, hasVisibleVisuals, exportJob, onGoTo }: CheckStageProps) {
  const load = useAcceptanceCheck(renderFilm, format);
  const view = load.status === "ready" ? load.view : null;

  const items = useMemo<FixItem[]>(() => {
    const list: FixItem[] = [];
    if (!validation.ok)
      list.push({
        id: "valid",
        text: "Film is not valid.",
        blocks: false,
        detail: validation.message,
      });
    const waiting = shotsNeedingFootage(film);
    if (waiting.length > 0) {
      list.push({
        id: "footage",
        text: footageText(waiting.length),
        blocks: true,
        detail: waiting.join(", "),
        go: { target: "look", label: "Look" },
      });
    }
    if (!hasVisibleVisuals)
      list.push({
        id: "lane",
        text: "Show a visual lane.",
        blocks: true,
        go: { target: "cut", label: "Cut" },
      });
    list.push(...deliveryItems(renderFilm, format));
    if (!film.voiceover?.src)
      list.push({
        id: "voice",
        text: "No voice.",
        blocks: false,
        go: { target: "script", label: "Words" },
      });
    const failed = (view?.gates ?? []).filter((g) => g.result === "fail");
    if (failed.length > 0) {
      list.push({
        id: "gates",
        text: failed.length === 1 ? "1 gate fails." : `${failed.length} gates fail.`,
        blocks: false,
        detail: failed.map((g) => g.label).join(", "),
      });
    }
    return list;
  }, [film, renderFilm, format, hasVisibleVisuals, validation, view]);

  // Export is refused for the first blocking item, with its own words.
  const blocking = items.find((i) => i.blocks);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pb-6">
      <div className="flex w-full max-w-[1040px] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" data-testid="check-verdict">
          {view ? (
            <>
              <StateChip state={view.state} />
              <span className="font-sans text-sm text-ink">{verdictHint(view)}</span>
            </>
          ) : load.status === "unavailable" ? (
            <Note tone="warn">Check did not load. Reload the page.</Note>
          ) : (
            <span className="font-sans text-sm text-ink-soft">Loading</span>
          )}
          <span className="ml-auto font-mono text-xs text-ink-soft">{format === "long" ? "16:9" : "9:16"}</span>
        </div>
        {view && (view.state === "draft" || view.state === "old") ? (
          <p className="font-mono text-xs text-ink-soft">aideos all-check {film.id}</p>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Gates" />
            <PanelBody scroll={false} className="p-0">
              <ul data-testid="check-gates">
                {(view?.gates ?? []).map((gate) => (
                  <li key={gate.key} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", RESULT_DOT[gate.result])} aria-hidden />
                    <span className="font-sans text-sm text-ink">{gate.label}</span>
                    <span className={cn("ml-auto font-mono text-xs", RESULT_TEXT_CLASS[gate.result])}>{RESULT_TEXT[gate.result]}</span>
                  </li>
                ))}
                {view ? (
                  <li className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0" data-testid="check-score">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", RESULT_DOT[view.score.result])} aria-hidden />
                    <span className="font-sans text-sm text-ink">Score</span>
                    <span className={cn("ml-auto font-mono text-xs", RESULT_TEXT_CLASS[view.score.result])}>
                      {view.score.text ? `${view.score.text} (bar ${view.score.bar})` : `Not run (bar ${view.score.bar})`}
                    </span>
                  </li>
                ) : null}
              </ul>
            </PanelBody>
          </Panel>

          <div className="flex min-w-0 flex-col gap-3">
            {items.length > 0 ? (
              <Panel>
                <PanelHeader title="Fix" />
                <PanelBody scroll={false} className="p-0">
                  <ul data-testid="check-fix">
                    {items.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                        <span className="font-sans text-sm font-semibold text-ink">{item.text}</span>
                        {item.detail ? <span className="min-w-0 break-words font-mono text-xs text-ink-soft">{item.detail}</span> : null}
                        {item.go ? (
                          <Button size="xs" className="ml-auto" onClick={() => onGoTo(item.go!.target)}>
                            {item.go.label}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </PanelBody>
              </Panel>
            ) : null}

            <Panel>
              <PanelHeader title="Export" />
              <PanelBody scroll={false} className="p-3">
                <CheckExport
                  exportJob={exportJob}
                  film={renderFilm}
                  format={format}
                  durationInFrames={durationInFrames}
                  blockedReason={blocking?.text ?? null}
                />
              </PanelBody>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
