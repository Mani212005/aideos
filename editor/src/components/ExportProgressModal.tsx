// File Description: Glassmorphic Export & Render Progress Modal displaying real-time video specifications, estimated render time countdown, stage pipeline, and download triggers.

import React, { useEffect, useState } from "react";
import type { Film } from "../../../src/dl/schema";

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
  { id: 1, title: "Composition Setup", desc: "Bundling Remotion React component tree & 3D camera paths", minProgress: 0, maxProgress: 18 },
  { id: 2, title: "Audio & Captions Alignment", desc: "Locking voiceover waveform cues & kinetic subtitles", minProgress: 18, maxProgress: 32 },
  { id: 3, title: "Vector & Metaphor Frame Rendering", desc: "Headless Chrome rendering multi-agent canvas & character scenes", minProgress: 32, maxProgress: 82 },
  { id: 4, title: "H.264 Video Compression", desc: "Encoding 1080p stream with FFmpeg compositor engine", minProgress: 82, maxProgress: 96 },
  { id: 5, title: "Packaging & Download", desc: "Generating final MP4 container and delivering to browser", minProgress: 96, maxProgress: 100 },
];

/**
 * Format raw seconds into a human-readable mm:ss time string.
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/**
 * Glassmorphic Export Modal displaying live render progress, video specs, and estimated completion time.
 */
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
  const estimatedRenderTotalSec = Math.max(35, Math.round(totalVideoDurationSec * 0.55));

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
        const calculatedProgress = Math.min(96, Math.round((next / estimatedRenderTotalSec) * 94));
        setProgress((curr) => Math.max(curr, calculatedProgress));
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, result, estimatedRenderTotalSec]);

  if (!isOpen) return null;

  const currentStage = result
    ? STAGES[4]
    : STAGES.find((s) => progress >= s.minProgress && progress <= s.maxProgress) || STAGES[2];

  const remainingSec = Math.max(1, estimatedRenderTotalSec - elapsedSec);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl border border-[#27272A] bg-[#101013]/95 shadow-2xl p-6 md:p-8 flex flex-col gap-6 text-white">
        {/* Modal Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#635BFF]/15 border border-[#635BFF]/30 flex items-center justify-center text-xl">
              {result ? "🎉" : error ? "⚠️" : "🎬"}
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                {result ? "Export Complete!" : error ? "Export Encountered an Error" : "Rendering High-Definition Video"}
              </h2>
              <p className="text-xs text-gray-400">
                {result
                  ? "Your video has been rendered and downloaded to your disk."
                  : error
                  ? "Rendering failed. Please check the logs."
                  : "Rendering 1080p video with spatial camera moves, voiceover, and animations."}
              </p>
            </div>
          </div>
          {(result || error) && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-[#333] hover:border-gray-500 bg-[#18181B] text-xs text-gray-300 hover:text-white transition-all"
            >
              Close
            </button>
          )}
        </div>

        {/* Video Specifications Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[#141417] border border-[#27272A] text-xs">
          <div>
            <span className="text-[10px] uppercase font-mono text-gray-500 block">Total Duration</span>
            <span className="font-bold text-white text-sm">{formatTime(totalVideoDurationSec)}</span>
            <span className="text-[10px] text-gray-400 block font-mono">({durationInFrames} frames)</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono text-gray-500 block">Resolution</span>
            <span className="font-bold text-white text-sm">
              {format === "reel" ? "1080 × 1920" : "1920 × 1080"}
            </span>
            <span className="text-[10px] text-gray-400 block font-mono">Full HD @ 30fps</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono text-gray-500 block">Audio Track</span>
            <span className="font-bold text-white text-sm">Neural Voice</span>
            <span className="text-[10px] text-emerald-400 block font-mono">Synced Cues</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono text-gray-500 block">Camera Mode</span>
            <span className="font-bold text-white text-sm capitalize">
              {film.theme?.cameraAngle || "Isometric 3D"}
            </span>
            <span className="text-[10px] text-gray-400 block font-mono">Dynamic Depth</span>
          </div>
        </div>

        {/* Live Progress Bar & Timers */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-gray-200 flex items-center gap-1.5">
              {!result && !error && <span className="inline-block w-2 h-2 rounded-full bg-[#635BFF] animate-ping" />}
              {result ? "100% Completed" : error ? "Halted" : `Processing: ${progress}%`}
            </span>
            <div className="flex items-center gap-4 text-xs font-mono text-gray-400">
              <span>⏱️ Elapsed: {formatTime(elapsedSec)}</span>
              {!result && !error && (
                <span className="text-[#635BFF] font-bold">
                  ⏳ Est. remaining: ~{formatTime(remainingSec)}
                </span>
              )}
            </div>
          </div>

          {/* Glowing Animated Progress Bar */}
          <div className="w-full h-3 rounded-full bg-[#18181B] border border-[#27272A] overflow-hidden p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                error
                  ? "bg-red-500"
                  : result
                  ? "bg-emerald-500"
                  : "bg-gradient-to-r from-[#635BFF] to-[#00D2D3] shadow-[0_0_12px_rgba(99,91,255,0.8)]"
              }`}
              style={{ width: `${error ? 100 : progress}%` }}
            />
          </div>
        </div>

        {/* Current Active Pipeline Stage */}
        <div className="p-4 rounded-xl border border-[#27272A] bg-[#141417]/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#222] border border-[#333] flex items-center justify-center font-mono text-xs font-bold text-[#635BFF]">
              {result ? "✓" : currentStage.id}
            </div>
            <div>
              <h4 className="text-xs font-bold text-white">{currentStage.title}</h4>
              <p className="text-[11px] text-gray-400">{currentStage.desc}</p>
            </div>
          </div>
          {!result && !error && (
            <span className="text-[11px] font-mono text-gray-500 flex items-center gap-1.5">
              <span className="animate-spin text-sm">⚙️</span> Rendering...
            </span>
          )}
        </div>

        {/* Success Action or Notice Footer */}
        {result ? (
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30">
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <span>💾</span>
              <span className="font-mono font-bold truncate max-w-sm">{result.filename}</span>
            </div>
            <a
              href={result.downloadUrl}
              download={result.filename}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-lg transition-all flex items-center gap-1.5"
            >
              <span>📥</span> Download Again
            </a>
          </div>
        ) : error ? (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-300 font-mono">
            {error}
          </div>
        ) : (
          <p className="text-[11px] text-gray-500 text-center font-mono">
            💡 You can keep this browser tab open while Remotion renders all frames safely in the background.
          </p>
        )}
      </div>
    </div>
  );
};
