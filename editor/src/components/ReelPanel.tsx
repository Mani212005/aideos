/**
 * File Description: Studio reel status, cut review, backend checks, rebuild and vertical preview.
 * Inputs and outputs: Open film id and owner actions -> checked reel delivery information and preview.
 * Used by: editor/src/screens/EditStage.tsx.
 */

import { useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { CheckCircle2, CircleAlert, Loader2, Play, RefreshCw, X } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { captionWordsForFilm } from "../../../src/dl/captionsParser";
import { buildTimeline } from "../../../src/dl/camera";
import { deliveryTimeline } from "../../../src/dl/delivery";
import type { ReelCut } from "../../../backend/reelCut/schema";
import type { ReelCheckReport } from "../../../backend/reelCut/check";
import type { DesignFinding } from "../../../backend/designCheck/designCheck";
import { FilmView } from "../../../src/dl/Film";
import { Button, Badge, Stat } from "./ui";

interface ReelPanelData {
  filmId: string;
  maxSec: number;
  writable: boolean;
  identity: boolean;
  cut: ReelCut | null;
  report: ReelCheckReport | null;
  status: { state?: string; mode?: string; at?: string; errors?: string[]; findings?: DesignFinding[] } | null;
  current: boolean;
  durationSec: number | null;
  previewFilm: Film | null;
  sourceShots: Array<{ id: string; narration: string }>;
}

// Formats a time in seconds as a compact measured reel duration.
function timeLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

// Converts an API error response into a readable message.
async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch { /* The HTTP status remains useful when a proxy returns non-JSON. */ }
  return `Reel request failed (${response.status}).`;
}

// Shows the authoritative reel state and lets the owner rebuild or preview it.
export function ReelPanel({ filmId, onClose, onPreviewStart }: { filmId: string; onClose: () => void; onPreviewStart: () => void }) {
  const [data, setData] = useState<ReelPanelData | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");

  // Loads the package's current cut and check state without copying it into the long film.
  async function refresh(): Promise<void> {
    try {
      const response = await fetch(`/api/reel/${encodeURIComponent(filmId)}`);
      if (!response.ok) throw new Error(await responseError(response));
      setData(await response.json() as ReelPanelData);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  // Rebuilds through the same inline backend reel delivery used by the CLI.
  async function rebuild(): Promise<void> {
    setBusy(true);
    setPreviewing(false);
    setError("");
    onPreviewStart();
    try {
      const response = await fetch(`/api/reel/${encodeURIComponent(filmId)}`, { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response));
      setData(await response.json() as ReelPanelData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // Refreshes when the panel opens or the selected project changes.
  useEffect(() => { void refresh(); }, [filmId]);

  const preview = data?.previewFilm ?? null;
  const timeline = useMemo(() => {
    if (!preview) return null;
    try { return buildTimeline(preview, preview.voiceover?.durationSec); } catch { return null; }
  }, [preview]);
  const words = useMemo(() => preview ? captionWordsForFilm(preview) : [], [preview]);
  const durationFrames = useMemo(() => {
    if (!preview || !timeline) return 1;
    return deliveryTimeline(preview, "reel", { timeline }).totalFrames;
  }, [preview, timeline]);
  const shotNarration = new Map((data?.sourceShots ?? []).map((shot) => [shot.id, shot.narration]));
  const errors = data?.status?.errors ?? [];
  const designFindings = data?.status?.findings ?? [];
  const report = data?.report;

  return (
    <aside aria-label="Reel controls" className="absolute inset-y-0 right-0 z-[80] flex w-80 max-w-[calc(100vw-3rem)] shrink-0 flex-col border-l-2 border-ink bg-paper text-ink xl:static">
      <div className="flex items-center justify-between border-b-2 border-ink px-3 py-2">
        <h2 className="font-sans text-xs font-black uppercase tracking-wider">Reel</h2>
        <Button size="sm" aria-label="Close reel panel" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="space-y-4 overflow-y-auto p-3">
        {error ? <p role="alert" className="whitespace-pre-wrap border-2 border-danger bg-paper-2 p-2 text-xs leading-relaxed">{error}</p> : null}
        {!data && !error ? <div role="status" className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading reel checks...</div> : null}
        {data ? <>
          <section aria-label="Reel status" className="space-y-2 border-2 border-ink bg-paper-2 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold">{data.current ? "Reel ready" : data.status?.state === "failed" ? "Build failed" : "Reel needs a build"}</span>
              <Badge tone={data.current ? "success" : data.status?.state === "failed" ? "danger" : "warn"}>{data.current ? data.identity ? "Identity" : "Current" : data.status?.state ?? "Missing"}</Badge>
            </div>
            <Stat label="Delivered length" value={`${data.durationSec === null ? "--" : `${timeLabel(data.durationSec)} / ${data.durationSec.toFixed(1)}s`} · ${data.maxSec}s cap`} tone={data.durationSec !== null && data.durationSec > data.maxSec ? "danger" : "ink"} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" tone="primary" disabled={busy || !data.writable} title={!data.writable ? "Example films are read-only" : undefined} onClick={() => void rebuild()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {busy ? "Rebuilding..." : "Rebuild reel"}
              </Button>
              <Button size="sm" disabled={!data.current || !preview || !timeline} active={previewing} onClick={() => { onPreviewStart(); setPreviewing((shown) => !shown); }}>
                <Play className="h-3.5 w-3.5" />{previewing ? "Hide preview" : "Preview 9:16"}
              </Button>
            </div>
            {!data.writable ? <p className="text-[11px] leading-relaxed text-muted">Example films are read-only. Copy this film into your videos folder to rebuild its reel.</p> : null}
            {data.status?.state === "passed" ? <p className="text-[11px] leading-relaxed text-muted">Last build passed{data.status.at ? ` · ${new Date(data.status.at).toLocaleString()}` : ""}.</p> : null}
            {busy ? <p role="status" className="text-[11px] leading-relaxed text-muted">Checking the cut, synthesizing narration and rebuilding the reel.</p> : null}
          </section>

          {previewing && preview && timeline ? <section aria-label="Reel format preview" className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="text-[10px] font-black uppercase tracking-wider">9:16 preview</h3><span className="font-mono text-[10px] text-muted">{timeLabel(data.durationSec ?? 0)}</span></div>
            <div className="mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden border-2 border-ink bg-matte shadow-nb">
              <Player
                component={FilmView}
                inputProps={{ film: preview, timeline, accent: preview.accent || preview.theme?.accent || "var(--nb-primary)", showGrid: preview.theme?.videoType === "case-study", showRail: true, captionWords: words }}
                durationInFrames={Math.max(1, durationFrames)}
                initialFrame={Math.min(preview.fps, Math.max(0, durationFrames - 1))}
                fps={preview.fps}
                compositionWidth={1080}
                compositionHeight={1920}
                style={{ width: "100%", height: "100%" }}
                controls
                clickToPlay
                acknowledgeRemotionLicense
              />
            </div>
          </section> : null}

          <section aria-label="Reel cut" className="space-y-2">
            <h3 className="text-[10px] font-black uppercase tracking-wider">Shot cut and condensed narration</h3>
            {data.identity ? <p className="text-xs leading-relaxed text-muted">This film fits the cap, so its reel keeps the full narration and every shot.</p> : !data.cut ? <p className="text-xs leading-relaxed text-muted">No reel cut is available yet. Rebuild uses the saved cut and reports what needs attention.</p> : <ol className="space-y-2">
              {data.cut.shots.map((entry, index) => "drop" in entry ? <li key={entry.id} className="border-2 border-ink bg-sunken p-2 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{index + 1}. {entry.id}</span><Badge tone="quiet">Dropped</Badge></div>
                <p className="mt-1 text-muted">{entry.reason}</p>
              </li> : <li key={entry.id} className="border-2 border-ink bg-paper-2 p-2 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{index + 1}. {entry.id}</span><Badge tone="success">Kept</Badge></div>
                <p className="mt-1 leading-relaxed">{entry.narration}</p>
              </li>)}
            </ol>}
            {data.identity ? data.sourceShots.map((shot, index) => <div key={shot.id} className="border-2 border-ink bg-paper-2 p-2 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{index + 1}. {shot.id}</span><Badge tone="success">Kept</Badge></div>
              <p className="mt-1 leading-relaxed">{shotNarration.get(shot.id) || "No narration text"}</p>
            </div>) : null}
          </section>

          <section aria-label="Reel checks" className="space-y-2 border-t-2 border-ink pt-3">
            <h3 className="text-[10px] font-black uppercase tracking-wider">Checks</h3>
            {data.identity ? <p className="flex items-center gap-1.5 text-xs"><CheckCircle2 className="h-3.5 w-3.5 text-success" />No separate narration cut required.</p> : report ? <p className="flex items-center gap-1.5 text-xs">
              {report.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <CircleAlert className="h-3.5 w-3.5 text-danger" />}
              Reel cut check: {report.ok ? "pass" : "needs attention"}
            </p> : <p className="text-xs text-muted">Cut checks are unavailable until a reel cut exists.</p>}
            {report?.findings.map((finding, index) => <div key={`${finding.rule}-${finding.shotId ?? "film"}-${index}`} className="border-2 border-ink bg-paper-2 p-2 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{finding.rule}{finding.shotId ? ` · ${finding.shotId}` : ""}</span><Badge tone={finding.severity === "error" ? "danger" : "warn"}>{finding.severity}</Badge></div>
              <p className="mt-1 leading-relaxed">{finding.message}</p>
            </div>)}
            {designFindings.map((finding, index) => <div key={`design-${finding.rule}-${index}`} className="border-2 border-ink bg-paper-2 p-2 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">Design · {finding.rule} · {finding.where}</span><Badge tone={finding.severity === "error" ? "danger" : "warn"}>{finding.severity}</Badge></div>
              <p className="mt-1 leading-relaxed">{finding.message}</p>
            </div>)}
            {errors.map((message, index) => <p key={`error-${index}`} className="border-2 border-danger bg-paper-2 p-2 text-xs leading-relaxed">{message}</p>)}
            {!report?.findings.length && !designFindings.length && !errors.length && report?.ok ? <p className="text-xs text-muted">No reel cut or design findings.</p> : null}
          </section>
        </> : null}
      </div>
    </aside>
  );
}
