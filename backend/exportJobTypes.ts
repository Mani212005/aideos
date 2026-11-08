/**
 * File Description: The shape of a studio export job as the dev server reports it and the editor shows it.
 * Kept free of Node imports so the browser bundle can share it with backend/exportJobs.ts.
 * Inputs and outputs: none (types only) -> ExportStatus and ExportJobSnapshot.
 * Used by: backend/exportJobs.ts, editor/src/state/useExportJob.ts, editor/src/components/ExportProgressModal.tsx.
 */

/** Where a job is in its life. Only `done` has a video; `cancelled` and `failed` leave none behind. */
export type ExportStatus = "preparing" | "rendering" | "finishing" | "done" | "failed" | "cancelled";

/** What the dialog and the header chip show for a job. */
export interface ExportJobSnapshot {
  id: string;
  filmId: string;
  format: "long" | "reel";
  status: ExportStatus;
  /** Whole-job progress from 0 to 1, from rendered and encoded frame counts. */
  progress: number;
  renderedFrames: number;
  encodedFrames: number;
  /** Frames the renderer reported, or 0 until its first progress line. */
  totalFrames: number;
  filename: string;
  /** Present only once the job is done. */
  downloadUrl?: string;
  error?: string;
  notice?: string;
  startedAt: number;
  finishedAt?: number;
}
