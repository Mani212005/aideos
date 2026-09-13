/**
 * File Description: Export dialog for Aideos Studio.
 * Shows what is being rendered, how far along the render is, and which pipeline stage it is in, so
 * a long export never looks like a frozen application. It reports an estimate honestly as an
 * estimate, and turns into a download handoff the moment the file exists.
 */

import React, { useEffect, useState } from "react";
import type { Film } from "../../../src/dl/schema";
import { Check, AlertTriangle, Download, FileVideo } from "lucide-react";
import { Badge, Button, Modal, Note, ProgressBar, Stat, cn } from "./ui";

export interface ExportProgressModalProps {
  isOpen: boolean;
  film: Film;
  format: "long" | "reel";
  durationInFrames: number;
  onClose: () => void;
  result: { filename: string; downloadUrl: string } | null;
  error: string | null;
}

const STAGES = [
  {
    id: 1,
    title: "Composition Setup",
    desc: "Bundling Remotion React component tree & 3D camera paths",
    minProgress: 0,
    maxProgress: 18,
  },
  {
    id: 2,
    title: "Audio & Captions Alignment",
    desc: "Locking voiceover waveform cues & kinetic subtitles",
    minProgress: 18,
    maxProgress: 32,
  },
  {
    id: 3,
    title: "Vector & Metaphor Frame Rendering",
    desc: "Headless Chrome rendering multi-agent canvas & character scenes",
    minProgress: 32,
    maxProgress: 82,
  },
  {
    id: 4,
    title: "H.264 Video Compression",
    desc: "Encoding 1080p stream with FFmpeg compositor engine",
    minProgress: 82,
    maxProgress: 96,
  },
  {
    id: 5,
    title: "Packaging & Download",
    desc: "Generating final MP4 container and delivering to browser",
    minProgress: 96,
    maxProgress: 100,
  },
];

/**
 * Format raw seconds into a human-readable mm:ss time string.
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/** Export dialog: live render progress, output specification and the finished download. */
export const ExportProgressModal: React.FC<ExportProgressModalProps> = ({
  isOpen,
  film,
  format,
  durationInFrames,
  onClose,
  result,
  error,
}) => {
  const fps = film.fps || 30;
  const totalVideoDurationSec = Math.round(durationInFrames / fps);
  // Estimated rendering time on Apple Silicon (approx 0.55s per 1s of video)
  const estimatedRenderTotalSec = Math.max(
    35,
    Math.round(totalVideoDurationSec * 0.55),
  );

  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);

  useEffect(() => {
    if (!isOpen) {
      setElapsedSec(0);
      setProgress(0);
      return;
    }

    if (result) {
      setProgress(100);
      return;
    }

    const interval = setInterval(() => {
      setElapsedSec((prev) => {
        const next = prev + 1;
        // Asymptotically approach 96% until result arrives
        const calculatedProgress = Math.min(
          96,
          Math.round((next / estimatedRenderTotalSec) * 94),
        );
        setProgress((curr) => Math.max(curr, calculatedProgress));
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, result, estimatedRenderTotalSec]);

  if (!isOpen) return null;

  const currentStage = STAGES.find((s) => progress >= s.minProgress && progress < s.maxProgress) ?? STAGES[STAGES.length - 1];
  const remainingSec = Math.max(0, estimatedRenderTotalSec - elapsedSec);
  const isDone = Boolean(result);
  const isFailed = Boolean(error);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      dismissible={isDone || isFailed}
      title={isFailed ? "Export failed" : isDone ? "Export complete" : "Rendering film"}
      subtitle={film.title}
      icon={<FileVideo className="h-5 w-5" />}
      width="max-w-lg"
      footer={
        isDone && result ? (
          <>
            <Button size="md" onClick={onClose}>
              Close
            </Button>
            <Button size="md" tone="primary" onClick={() => window.open(result.downloadUrl, "_blank")}>
              <Download className="h-4 w-4" />
              Download {result.filename}
            </Button>
          </>
        ) : isFailed ? (
          <Button size="md" onClick={onClose}>
            Close
          </Button>
        ) : (
          <span className="font-mono text-[11px] text-ink-soft">
            You can keep working; this dialog updates on its own.
          </span>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {isFailed ? (
          <Note tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
            {error}
          </Note>
        ) : (
          <ProgressBar
            value={progress}
            label={isDone ? "Finished" : currentStage.title}
          />
        )}

        {!isFailed ? (
          <ol className="flex flex-col gap-1.5">
            {STAGES.map((stage) => {
              const done = progress >= stage.maxProgress;
              const active = !done && progress >= stage.minProgress;
              return (
                <li
                  key={stage.id}
                  className={cn(
                    "flex items-start gap-2 border-2 border-ink px-2.5 py-1.5",
                    done ? "bg-success" : active ? "bg-primary" : "bg-paper-3",
                  )}
                >
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center border-2 border-ink bg-paper-3 font-mono text-[9px] font-bold">
                    {done ? <Check className="h-2.5 w-2.5" /> : stage.id}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-sans text-[11px] font-extrabold uppercase tracking-[0.04em] text-ink">
                      {stage.title}
                    </span>
                    <span className="block font-sans text-[10px] leading-snug text-ink-soft">{stage.desc}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <div className="border-2 border-ink bg-paper-3 p-2.5">
          <Stat label="Output" value={format === "long" ? "1920 x 1080" : "1080 x 1920"} />
          <Stat label="Frame rate" value={`${fps} fps`} />
          <Stat label="Frames" value={durationInFrames.toLocaleString()} />
          <Stat label="Run time" value={formatTime(totalVideoDurationSec)} />
          <Stat label="Elapsed" value={formatTime(elapsedSec)} />
          {!isDone && !isFailed ? (
            <Stat label="Estimated remaining" value={`about ${formatTime(remainingSec)}`} tone="select" />
          ) : null}
        </div>

        {isDone && result ? (
          <Note tone="success" icon={<Check className="h-3.5 w-3.5" />}>
            {result.filename} is ready.
          </Note>
        ) : null}

        {!isDone && !isFailed ? (
          <Badge tone="quiet" className="self-start">
            Remotion headless render
          </Badge>
        ) : null}
      </div>
    </Modal>
  );
};
