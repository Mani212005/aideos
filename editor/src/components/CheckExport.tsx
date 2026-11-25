/**
 * File Description: The Export part of the Check lens. Export arms the export, Start renders (nothing renders before the user presses Start), the real frame counts from the renderer show while it runs, Cancel stops it and deletes the partial video at any time, and Download appears when the file is done. Nothing downloads by itself. A blocked export shows its reason next to a disabled Export button.
 * Inputs and outputs: the export job hook, the film on screen, the format, the delivered frames and the reason Export is blocked (or null) -> the Export controls and progress.
 * Used by: editor/src/screens/CheckStage.tsx.
 */

import { DEFAULT_FPS } from "../../../src/dl/defaults";

import { Ban, Check, Download, Play } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import type { ExportJobSnapshot } from "../../../backend/exportJobTypes";
import type { ExportJobApi } from "../state/useExportJob";
import { Button, Note, ProgressBar, cn } from "./ui";
import { formatTimecode } from "../utils/time";

export interface CheckExportProps {
  exportJob: ExportJobApi;
  film: Film;
  format: "long" | "reel";
  durationInFrames: number;
  /** Why Export is refused, or null when it may run. */
  blockedReason: string | null;
}

/** The steps of a render, each lit from what the renderer has really reported. */
const STEPS = ["Prepare", "Render", "Encode", "Finish"] as const;

/** Which step is running and which are done, from the job's status and real frame counts. */
export function stepStates(job: ExportJobSnapshot): Array<"done" | "active" | "waiting"> {
  const current =
    job.status === "preparing"
      ? 0
      : job.status === "finishing" || job.status === "done"
        ? 3
        : job.totalFrames > 0 && job.renderedFrames >= job.totalFrames
          ? 2
          : 1;
  return STEPS.map((_, i) => (job.status === "done" || i < current ? "done" : i === current ? "active" : "waiting"));
}

/** Hands the finished file to the browser. Called only from the click of the Download button. */
function downloadFile(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** An error in one short line. A long message (for example a render log) keeps its full text under a Log fold, so the lens says what happened first. */
function ErrorNote({ message, summary }: { message: string; summary: string }) {
  const long = message.length > 160 || message.includes("\n");
  return (
    <Note tone="danger">
      {long ? (
        <details>
          <summary className="cursor-pointer font-semibold">{summary}</summary>
          <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{message}</pre>
        </details>
      ) : (
        message
      )}
    </Note>
  );
}

/** The Export controls of the Check lens: Export, Start, progress, Cancel and Download. */
export function CheckExport({ exportJob, film, format, durationInFrames, blockedReason }: CheckExportProps) {
  const { job, armed, error, starting } = exportJob;
  const fps = job?.fps ?? (film.fps || DEFAULT_FPS);
  const frames = job?.durationInFrames ?? durationInFrames;
  const facts = `${format === "long" ? "1920 x 1080" : "1080 x 1920"} | ${fps} fps | ${frames.toLocaleString()} frames | ${formatTimecode(Math.round(frames / fps))}`;

  // The problem found while starting or following the export, when it is not a render failure.
  const problem = error ? <ErrorNote message={error} summary="Export did not start." /> : null;

  if (job && exportJob.active) {
    const states = stepStates(job);
    const stepName = STEPS[states.indexOf("active")] ?? "Render";
    return (
      <div className="flex flex-col gap-2" data-testid="check-export">
        {problem}
        <ProgressBar value={job.status === "preparing" ? undefined : Math.round(job.progress * 100)} label={stepName} />
        <ol className="flex flex-wrap gap-x-3 font-mono text-xs text-ink-soft">
          {STEPS.map((name, i) => (
            <li key={name} className={cn(states[i] === "active" && "font-semibold text-ink", states[i] === "done" && "text-success")}>
              {i + 1} {name}
            </li>
          ))}
        </ol>
        <p className="font-mono text-xs tabular-nums text-ink-soft">
          {job.renderedFrames.toLocaleString()} / {job.totalFrames.toLocaleString()} frames
          {" | "}
          {formatTimecode(Math.max(0, Math.round((Date.now() - job.startedAt) / 1000)))}
        </p>
        <div>
          <Button tone="danger" onClick={() => void exportJob.cancel()}>
            <Ban className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (job?.status === "done" && job.downloadUrl) {
    const { downloadUrl, filename } = job;
    return (
      <div className="flex flex-col gap-2" data-testid="check-export">
        {problem}
        <p className="flex items-center gap-1.5 font-mono text-xs text-ink">
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          {filename}
        </p>
        {job.notice ? <Note tone="warn">{job.notice}</Note> : null}
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" onClick={() => downloadFile(downloadUrl, filename)}>
            <Download className="h-4 w-4" />
            Download
          </Button>
          <Button onClick={exportJob.reset}>Export again</Button>
        </div>
      </div>
    );
  }

  if (job?.status === "failed" || job?.status === "cancelled") {
    return (
      <div className="flex flex-col gap-2" data-testid="check-export">
        {problem}
        {job.status === "failed" ? (
          <ErrorNote message={job.error ?? "Export failed."} summary="Export failed. Open the log." />
        ) : (
          <Note tone="warn">Export stopped. The partial file is deleted.</Note>
        )}
        <div>
          <Button onClick={exportJob.reset}>Export again</Button>
        </div>
      </div>
    );
  }

  if (armed && !blockedReason) {
    return (
      <div className="flex flex-col gap-2" data-testid="check-export">
        {problem}
        <p className="font-mono text-xs text-ink-soft">{facts}</p>
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" onClick={() => void exportJob.start(film, format)} disabled={starting}>
            <Play className="h-4 w-4" />
            {starting ? "Starting" : "Start"}
          </Button>
          <Button onClick={exportJob.disarm}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="check-export">
      {problem}
      <div className="flex flex-wrap items-center gap-3">
        <Button tone="primary" onClick={exportJob.arm} disabled={blockedReason !== null}>
          <Download className="h-4 w-4" />
          Export
        </Button>
        {blockedReason ? <span className="font-sans text-xs font-semibold text-danger">{blockedReason}</span> : null}
      </div>
    </div>
  );
}
