/**
 * File Description: Client state for the studio export: whether the dialog is open, the live job the dev
 * server reports, and the Start, Cancel, hide and reset actions. Nothing starts until start() is called
 * from the Start button, and a finished job is never downloaded here: the dialog's Download button does that.
 * Inputs and outputs: the film and format to export -> job snapshot, dialog visibility and actions.
 * Used by: editor/src/App.tsx.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Film } from "../../../src/dl/schema";
import type { ExportJobSnapshot } from "../../../backend/exportJobTypes";

/** True while a job still occupies the renderer. */
export function isExportActive(job: ExportJobSnapshot | null): boolean {
  return job !== null && ["preparing", "rendering", "finishing"].includes(job.status);
}

/** Shown when the dev server no longer knows the job, for example after it restarted. */
const LOST_JOB = "Lost track of the export: the studio server restarted, so the render stopped. Start it again.";

/** Polling cadence for a running export, in milliseconds. */
const POLL_MS = 700;

/** Owns the export dialog and the one export job it shows. */
export function useExportJob(onFinished: (job: ExportJobSnapshot) => void) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [job, setJob] = useState<ExportJobSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const reported = useRef<string | null>(null);

  const active = isExportActive(job);
  const jobId = job?.id;

  /** Picks up an export that was already running when the page loaded, so the chip comes back after a reload. */
  useEffect(() => {
    let alive = true;
    fetch("/api/export/current")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.job) setJob(data.job as ExportJobSnapshot);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /** Follows the running job with the renderer's own numbers until it settles. */
  useEffect(() => {
    if (!jobId || !active) return;
    const id = jobId;
    const timer = setInterval(() => {
      fetch(`/api/export/${id}`)
        .then(async (r) => {
          if (r.status === 404) {
            setJob(null);
            setError(LOST_JOB);
            return;
          }
          if (!r.ok) throw new Error(`Export status check failed (${r.status})`);
          const data = await r.json();
          setJob(data.job as ExportJobSnapshot);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, active]);

  /** Tells the app once when a job reaches a final state, even while the dialog is hidden. */
  useEffect(() => {
    if (job && !active && reported.current !== job.id) {
      reported.current = job.id;
      finishedRef.current(job);
    }
  }, [job, active]);

  /** Opens the dialog; an export already running is shown again rather than a second one offered. */
  const open = useCallback(() => setDialogOpen(true), []);

  /** Starts the render. Called only by the Start button. */
  const start = useCallback(async (film: Film, format: "long" | "reel") => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ film, format }),
      });
      const data = await res.json();
      if (data.job) setJob(data.job as ExportJobSnapshot);
      if (!res.ok && !data.job) throw new Error(data.error || "Export failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, []);

  /** Stops the render for good; the server deletes the partial video. */
  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      const res = await fetch(`/api/export/${job.id}/cancel`, { method: "POST" });
      if (res.status === 404) {
        setJob(null);
        setError(LOST_JOB);
        return;
      }
      const data = await res.json();
      if (data.job) setJob(data.job as ExportJobSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [job]);

  /** The cross: hides the dialog while a render continues, keeps a finished video for Download, and clears a failed or cancelled job. */
  const close = useCallback(() => {
    setDialogOpen(false);
    setError(null);
    if (job?.status === "failed" || job?.status === "cancelled") setJob(null);
  }, [job]);

  /** Back to the Start screen after a finished, failed or cancelled export. */
  const reset = useCallback(() => {
    setJob(null);
    setError(null);
  }, []);

  return { dialogOpen, job, error, starting, active, open, start, cancel, close, reset };
}
