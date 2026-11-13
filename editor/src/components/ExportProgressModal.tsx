/**
 * File Description: Export dialog for Aideos Studio. Clicking Export opens it on a Start screen and nothing
 * renders until Start is pressed. While rendering it shows the real frame counts from the renderer (never a
 * time estimate) and a Cancel button that stops the render and deletes the partial video. The close cross is
 * always present: while rendering it only hides the dialog (a header chip reopens it). A finished export
 * offers a Download button and is never downloaded automatically.
 * Inputs and outputs: the export job snapshot and film facts -> dialog with Start, Cancel, Close and Download actions.
 * Used by: editor/src/App.tsx.
 */

import React, { useEffect, useState } from "react";
import type { Film } from "../../../src/dl/schema";
import type { ExportJobSnapshot } from "../../../backend/exportJobTypes";
import type { AcceptanceSummary } from "../../../backend/filmAcceptance/machine";
import { Check, AlertTriangle, Ban, Download, FileVideo, Play } from "lucide-react";
import { Button, Modal, Note, ProgressBar, Stat, cn } from "./ui";

export interface ExportProgressModalProps {
  isOpen: boolean;
  film: Film;
  format: "long" | "reel";
  durationInFrames: number;
  job: ExportJobSnapshot | null;
  /** A problem starting or following the export that is not a render failure. */
  error: string | null;
  starting: boolean;
  onStart: () => void;
  onCancel: () => void;
  /** The cross, Escape and the overlay: hides the dialog while a render runs. */
  onClose: () => void;
  onReset: () => void;
}

/** The steps of a render, each lit from what the renderer has really reported. */
const STEPS = [
  { id: "prepare", title: "Preparing", desc: "Attaching the end card voice and bundling the film" },
  { id: "render", title: "Rendering frames", desc: "Headless Chrome drawing every frame of the film" },
  { id: "encode", title: "Encoding video", desc: "H.264 and audio into the MP4 file" },
  { id: "finish", title: "Finishing", desc: "Mastering the audio and writing the credits" },
] as const;

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

/** Format raw seconds into a human-readable mm:ss time string. */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/** Hands the finished file to the browser. Called only from the Download button's click. */
function downloadFile(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Export dialog: Start gate, real progress, Cancel, and the finished Download. */
export const ExportProgressModal: React.FC<ExportProgressModalProps> = ({
  isOpen,
  film,
  format,
  durationInFrames,
  job,
  error,
  starting,
  onStart,
  onCancel,
  onClose,
  onReset,
}) => {
  const facts = job ?? { filmTitle: film.title, fps: film.fps || 30, format, durationInFrames };
  const runningStatus = job !== null && ["preparing", "rendering", "finishing"].includes(job.status);

  // Elapsed time is a clock, not an estimate: it counts from the moment the server began the job.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isOpen || !runningStatus) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isOpen, runningStatus]);

  // Whether the film about to be exported is the film that was reviewed, asked of the acceptance record each time the Start screen opens.
  const [acceptance, setAcceptance] = useState<AcceptanceSummary | null>(null);
  const idleOpen = isOpen && job === null;
  useEffect(() => {
    if (!idleOpen) return;
    let alive = true;
    setAcceptance(null);
    fetch(`/api/acceptance/${encodeURIComponent(film.id)}?format=${format}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.message) setAcceptance(data as AcceptanceSummary);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [idleOpen, film.id, format]);

  if (!isOpen) return null;

  const status = job?.status ?? "idle";
  const pct = job ? Math.round(job.progress * 100) : 0;
  const elapsedSec = job ? Math.max(0, Math.round(((job.finishedAt ?? nowMs) - job.startedAt) / 1000)) : 0;
  const states = job ? stepStates(job) : [];
  const total = job && job.totalFrames > 0 ? job.totalFrames : facts.durationInFrames;
  const title =
    status === "idle"
      ? "Export film"
      : status === "done"
        ? "Export complete"
        : status === "failed"
          ? "Export failed"
          : status === "cancelled"
            ? "Export cancelled"
            : "Rendering film";

  let footer: React.ReactNode;
  if (status === "idle") {
    footer = (
      <Button size="md" tone="primary" onClick={onStart} disabled={starting}>
        <Play className="h-4 w-4" />
        {starting ? "Starting" : "Start export"}
      </Button>
    );
  } else if (status === "done" && job?.downloadUrl) {
    const { downloadUrl } = job;
    footer = (
      <>
        <Button size="md" onClick={onReset}>
          New export
        </Button>
        <Button size="md" tone="primary" onClick={() => downloadFile(downloadUrl, job.filename)}>
          <Download className="h-4 w-4" />
          Download {job.filename}
        </Button>
      </>
    );
  } else if (status === "failed" || status === "cancelled") {
    footer = (
      <Button size="md" onClick={onReset}>
        Start over
      </Button>
    );
  } else {
    footer = (
      <>
        <span className="mr-auto font-mono text-[11px] text-ink-soft">
          The cross only hides this dialog.
        </span>
        <Button size="md" tone="danger" onClick={onCancel}>
          <Ban className="h-4 w-4" />
          Cancel export
        </Button>
      </>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={facts.filmTitle}
      icon={<FileVideo className="h-5 w-5" />}
      width="max-w-lg"
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <Note tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
            {error}
          </Note>
        ) : null}

        {status === "idle" ? (
          <Note tone="info">Nothing is rendered until you press Start. You can cancel at any time.</Note>
        ) : null}

        {status === "idle" && acceptance ? (
          <Note
            tone={acceptance.reviewed ? "success" : "warn"}
            icon={acceptance.reviewed ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-4 w-4" />}
          >
            {acceptance.message}
          </Note>
        ) : null}

        {status === "failed" && job?.error ? (
          <Note tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
            {job.error}
          </Note>
        ) : null}

        {status === "cancelled" ? (
          <Note tone="warn" icon={<Ban className="h-4 w-4" />}>
            The render was stopped and the partial video was deleted.
          </Note>
        ) : null}

        {job && (runningStatus || status === "done") ? (
          <ProgressBar
            value={status === "done" ? 100 : job.status === "preparing" ? undefined : pct}
            label={status === "done" ? "Finished" : STEPS[states.indexOf("active")]?.title ?? "Rendering"}
          />
        ) : null}

        {job && (runningStatus || status === "done") ? (
          <ol className="flex flex-col gap-1.5">
            {STEPS.map((step, i) => {
              const state = states[i];
              return (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-start gap-2 border-2 border-ink px-2.5 py-1.5",
                    state === "done" ? "bg-success" : state === "active" ? "bg-primary" : "bg-paper-3",
                  )}
                >
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center border-2 border-ink bg-paper-3 font-mono text-[9px] font-bold">
                    {state === "done" ? <Check className="h-2.5 w-2.5" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-sans text-[11px] font-extrabold uppercase tracking-[0.04em] text-ink">
                      {step.title}
                    </span>
                    <span className="block font-sans text-[10px] leading-snug text-ink-soft">{step.desc}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <div className="border-2 border-ink bg-paper-3 p-2.5">
          <Stat label="Output" value={facts.format === "long" ? "1920 x 1080" : "1080 x 1920"} />
          <Stat label="Frame rate" value={`${facts.fps} fps`} />
          <Stat label="Frames" value={total.toLocaleString()} />
          <Stat label="Run time" value={formatTime(Math.round(facts.durationInFrames / facts.fps))} />
          {job && (runningStatus || status === "done") ? (
            <>
              <Stat label="Frames rendered" value={`${job.renderedFrames.toLocaleString()} / ${job.totalFrames.toLocaleString()}`} />
              <Stat label="Elapsed" value={formatTime(elapsedSec)} />
            </>
          ) : null}
        </div>

        {status === "done" && job ? (
          <Note tone="success" icon={<Check className="h-3.5 w-3.5" />}>
            {job.filename} is ready. Press Download to save it.
          </Note>
        ) : null}
        {status === "done" && job?.notice ? <Note tone="warn">{job.notice}</Note> : null}
      </div>
    </Modal>
  );
};
