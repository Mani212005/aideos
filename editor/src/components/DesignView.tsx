/**
 * File Description: The body of the Look lens: the film's look plan (stage, cast, approval) and the shots, each with the pictures it is drawn from. Cast and shots show the film's own artwork. A film still on the template design gets one action instead: send it to the connected agent. The Ask box and the accent and background choices are passed in as slots, so this file holds no edit controls of its own.
 * Inputs and outputs: active film, the design overview from the server, the chosen shot -> look plan panel, shot list with pictures and the slot panels.
 * Used by: editor/src/screens/LookStage.tsx.
 */

import { useState, type ReactNode } from "react";
import { Bot, Check, FileText } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { Badge, Button, EmptyState, Note, Panel, PanelBody, PanelHeader, Spinner, cn } from "./ui";
import { postDesignAction, useDesignOverview } from "../state/useDesignOverview";
import { formatTimecode } from "../utils/time";

// A small picture of one piece of the film's artwork.
function Thumb({ src, label, className }: { src: string; label: string; className?: string }) {
  return (
    <img
      src={`/${src}`}
      alt={label}
      title={label}
      loading="lazy"
      className={cn("aspect-[3/2] rounded-md border border-line bg-matte object-contain", className)}
    />
  );
}

export interface DesignViewProps {
  film: Film;
  onSelectShot: (id: string) => void;
  /** The shot the Look lens's Ask applies to, marked in the shot list. */
  selectedShotId?: string;
  /** Shown at the top of the left column (the Look lens puts the picture and Ask here). */
  topPanel?: ReactNode;
  /** Shown under the look plan in the left column (the Look lens puts the accent and background here). */
  choicesPanel?: ReactNode;
}

/** The look plan of the film and its shots with their pictures. */
export function DesignView({ film, onSelectShot, selectedShotId, topPanel, choicesPanel }: DesignViewProps) {
  // What is said and shown comes from the film being edited, so a swap shows at once; the
  // overview adds what only the server knows (artwork, motion, look plan, build status).
  const { overview, error } = useDesignOverview(film.id, film.design?.source ?? null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<{ filmId: string; message: string } | null>(null);
  const [localApproval, setLocalApproval] = useState<{ filmId: string; approvedBy: string } | null>(null);

  if (error) return <Note tone="danger" className="m-4">Look did not load. {error}</Note>;
  if (!overview) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const design = film.design ?? overview.design;
  const serverShots = new Map(overview.shots.map((s) => [s.id, s]));
  const artwork = new Map(overview.artwork.map((a) => [a.id, a.src]));
  let cursor = 0;
  const shots = film.shots.map((shot) => {
    const startSec = cursor;
    cursor += shot.dur;
    const known = serverShots.get(shot.id);
    const planned = overview.look?.plan.shots.find((p) => p.id === shot.id);
    // The pictures of a shot are the artwork its motion moves, each once.
    const pictures = [...new Set((known?.motion ?? []).map((m) => m.asset))].filter((id) => artwork.has(id));
    return {
      id: shot.id,
      startSec,
      endSec: cursor,
      says: shot.scriptText ?? "",
      pictures,
      treatment: planned?.treatment,
      needsFootage: Boolean(shot.needsFootage),
    };
  });
  const currentApproval =
    (localApproval?.filmId === film.id ? localApproval.approvedBy : null) ?? overview.look?.plan.approval?.captain ?? null;
  const bespoke = design && design.source !== "templates" && overview.artwork.length > 0;

  // Sends a template film to the connected agent for a design of its own.
  const designWithAgent = async () => {
    setSending(true);
    try {
      const out = await postDesignAction<{ channels: string[] }>(film.id, { film });
      setSent(`Sent (${out.channels.join(", ")}). The film reloads when the build passes.`);
    } catch (err) {
      setSent(`Not sent. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  };

  // Persists the captain's approval in the package look plan.
  const approveLook = async () => {
    setApproving(true);
    setApprovalError(null);
    try {
      const out = await postDesignAction<{ approval: string }>(`${film.id}/approve-look`, {});
      setLocalApproval({ filmId: film.id, approvedBy: out.approval });
    } catch (err) {
      setApprovalError({ filmId: film.id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 auto-rows-max grid-cols-1 gap-3 overflow-y-auto p-3 lg:auto-rows-auto lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto [&>*]:shrink-0">
        {topPanel}
        <Panel>
          <PanelHeader title="Look" icon={<FileText className="h-3.5 w-3.5" />}>
            <Badge tone={overview.look ? "success" : "quiet"}>{overview.look ? "Ready" : "No plan"}</Badge>
          </PanelHeader>
          <PanelBody scroll={false} className="flex flex-col gap-3">
            {overview.lookError ? (
              <Note tone="danger">look.json is not valid. {overview.lookError}</Note>
            ) : overview.look ? (
              <>
                <div>
                  <h3 className="mb-1 font-mono text-xs font-semibold text-ink-soft">Stage</h3>
                  <p className="break-words font-sans text-xs leading-snug text-ink">{overview.look.plan.film.stage}</p>
                </div>
                <div>
                  <h3 className="mb-1.5 font-mono text-xs font-semibold text-ink-soft">Cast</h3>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
                    {overview.look.plan.film.cast.map((member) => {
                      const src = artwork.get(member.id);
                      return (
                        <li key={member.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-paper-3 p-1.5">
                          {src ? <Thumb src={src} label={member.id} className="w-12 shrink-0" /> : null}
                          <div className="min-w-0">
                            <p className="truncate font-sans text-xs font-semibold text-ink">{member.id}</p>
                            <p className="nb-clamp-2 break-words font-sans text-xs leading-snug text-ink-soft" title={member.what}>
                              {member.what}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {currentApproval ? (
                    <Badge tone="success" title={`Approved by ${currentApproval}`}>
                      <Check className="mr-1 inline h-3 w-3" />
                      Approved
                    </Badge>
                  ) : (
                    <Button tone="primary" size="xs" onClick={() => void approveLook()} disabled={approving}>
                      <Check className="h-3 w-3" />
                      {approving ? "Approving..." : "Approve"}
                    </Button>
                  )}
                  {approvalError?.filmId === film.id ? <Note tone="danger">Not approved. {approvalError.message}</Note> : null}
                </div>
              </>
            ) : (
              <EmptyState title="No look plan." className="min-h-20 p-3" />
            )}
            {!bespoke ? (
              <div className="flex flex-col gap-2">
                <Button tone="primary" size="sm" onClick={designWithAgent} disabled={sending}>
                  <Bot className="h-3.5 w-3.5" />
                  {sending ? "Sending..." : "Design with agent"}
                </Button>
                {sent ? <Note tone={sent.startsWith("Not sent") ? "danger" : "success"}>{sent}</Note> : null}
              </div>
            ) : null}
            {overview.status?.state === "failed" ? (
              <Note tone="warn">Build failed ({overview.status.source}). {overview.status.errors[0] ?? overview.status.findings[0]?.message}</Note>
            ) : null}
          </PanelBody>
        </Panel>
        {choicesPanel}
      </div>

      <Panel className="min-h-[320px] lg:min-h-0">
        <PanelHeader title="Shots">
          <Badge tone="quiet">{shots.length}</Badge>
        </PanelHeader>
        <PanelBody bare>
          {shots.length === 0 ? (
            <EmptyState title="No shots." />
          ) : (
            <ol className="divide-y divide-line">
              {shots.map((shot) => (
                <li key={shot.id}>
                  <button
                    type="button"
                    onClick={() => onSelectShot(shot.id)}
                    aria-current={shot.id === selectedShotId ? "true" : undefined}
                    className={cn(
                      "grid w-full grid-cols-[64px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-left hover:bg-paper-3 focus-visible:bg-paper-3 focus-visible:outline-none",
                      shot.id === selectedShotId && "bg-select-tint",
                    )}
                  >
                    <div className="font-mono text-xs leading-tight text-ink-soft">
                      <div className="font-semibold text-ink">{shot.id}</div>
                      <div>
                        {formatTimecode(shot.startSec)}-{formatTimecode(shot.endSec)}
                      </div>
                      {shot.treatment ? <Badge tone={shot.treatment === "device" ? "warn" : "info"}>{shot.treatment}</Badge> : null}
                      {shot.needsFootage ? <Badge tone="warn">Footage</Badge> : null}
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <p className="font-sans text-xs leading-snug text-ink">{shot.says || "(no words)"}</p>
                      {shot.pictures.length ? (
                        <div className="flex flex-wrap gap-1">
                          {shot.pictures.map((id) => (
                            <Thumb key={id} src={artwork.get(id) ?? ""} label={id} className="w-14" />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
