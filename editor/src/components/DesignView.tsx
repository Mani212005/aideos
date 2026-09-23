/**
 * File Description: The Look stage's Design view: the film's own design rather than a theme.
 * Shows who designed it and the idea behind it, the artwork its scene is drawn from, and shot by
 * shot what is said, what is on screen, why that visual was chosen and which motion lands there.
 * A film still on the template design gets one action instead: send it to the connected agent.
 */

import { useState } from "react";
import { Bot, Image as ImageIcon, RefreshCw, Sparkles } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { Badge, Button, EmptyState, Note, Panel, PanelBody, PanelHeader, Spinner } from "./ui";
import { postDesignAction, useDesignOverview, type DesignOverview } from "../state/useDesignOverview";

const SOURCE_LABEL: Record<string, string> = {
  agent: "Designed by agent",
  "server-model": "Designed by model",
  "hand-built": "Hand-built design",
  templates: "Template fallback",
};

// Formats seconds as m:ss.
function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Jev's pick for a shot, as a compact chip. */
export function ChoiceChip({ choice }: { choice: NonNullable<DesignOverview["shots"][number]["choice"]> }) {
  const pct = choice.confidence !== undefined ? ` ${Math.round(choice.confidence * 100)}%` : "";
  const tone = choice.source === "jev" ? "info" : "quiet";
  const title =
    choice.source === "jev"
      ? `Jev picked ${choice.visual}${pct}`
      : `${choice.visual} by rule (${choice.fallbackReason ?? choice.source})`;
  return (
    <Badge tone={tone} title={title}>
      {choice.source === "jev" ? "Jev" : "Rule"} · {choice.visual}
      {pct}
    </Badge>
  );
}

export interface DesignViewProps {
  film: Film;
  onSelectShot: (id: string) => void;
}

/** The film's design: idea, artwork, and motion and visual choice per shot. */
export function DesignView({ film, onSelectShot }: DesignViewProps) {
  // What is said and shown comes from the film being edited, so a swap shows at once; the
  // overview adds what only the server knows (choices, artwork, motion, build status).
  const { overview, error, refresh } = useDesignOverview(film.id, film.design?.source ?? null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  if (error) return <Note tone="danger" className="m-4">Could not load the design: {error}</Note>;
  if (!overview) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const design = film.design ?? overview.design;
  const serverShots = new Map(overview.shots.map((s) => [s.id, s]));
  let cursor = 0;
  const shots = film.shots.map((shot) => {
    const startSec = cursor;
    cursor += shot.dur;
    const known = serverShots.get(shot.id);
    return {
      id: shot.id,
      startSec,
      endSec: cursor,
      says: shot.scriptText ?? "",
      shown: shot.blocks.map((b) => b.c),
      motion: known?.motion ?? [],
      choice: known?.choice,
    };
  });
  const bespoke = design && design.source !== "templates" && overview.artwork.length > 0;

  const designWithAgent = async () => {
    setSending(true);
    try {
      const out = await postDesignAction<{ channels: string[] }>(film.id, { film });
      setSent(`Sent to the agent (${out.channels.join(", ")}). The film reloads when its design build passes.`);
    } catch (err) {
      setSent(`Could not send: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto">
        <Panel>
          <PanelHeader
            title="Idea"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            actions={
              <Button size="xs" tone="ghost" iconOnly aria-label="Reload design" title="Reload design" onClick={refresh}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            }
          />
          <PanelBody scroll={false} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={design?.source === "templates" || !design ? "warn" : "success"}>
                {design ? SOURCE_LABEL[design.source] : "Template design"}
              </Badge>
              <span
                className="inline-flex items-center gap-1 border-2 border-ink bg-paper-3 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase leading-none"
                title="The film's accent colour"
              >
                <span className="h-2.5 w-2.5 border border-ink" style={{ background: overview.accent }} />
                {overview.accent}
              </span>
            </div>
            {design?.brief ? (
              <>
                <p className="font-sans text-[13px] leading-snug text-ink">{design.brief.concept}</p>
                {design.brief.throughLine ? (
                  <p className="font-sans text-[12px] leading-snug text-ink-soft">
                    <span className="font-bold text-ink">Through-line: </span>
                    {design.brief.throughLine}
                  </p>
                ) : null}
                {design.brief.motifs?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {design.brief.motifs.map((m) => (
                      <Badge key={m} tone="quiet">
                        {m}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="font-sans text-[12px] leading-snug text-ink-soft">
                {design?.note ??
                  "This film is drawn from the shared templates: a node graph with text cards and charts, not a design of its own."}
              </p>
            )}
            {!bespoke ? (
              <div className="flex flex-col gap-2">
                <Button tone="primary" size="sm" onClick={designWithAgent} disabled={sending}>
                  <Bot className="h-3.5 w-3.5" />
                  {sending ? "Sending..." : "Design this film with the agent"}
                </Button>
                {sent ? <Note tone={sent.startsWith("Could not") ? "danger" : "success"}>{sent}</Note> : null}
              </div>
            ) : null}
            {overview.status?.state === "failed" ? (
              <Note tone="warn">
                The last design build failed ({overview.status.source}): {overview.status.errors[0] ?? overview.status.findings[0]?.message}
              </Note>
            ) : null}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Artwork" icon={<ImageIcon className="h-3.5 w-3.5" />}>
            <Badge tone="quiet">{overview.artwork.length}</Badge>
          </PanelHeader>
          <PanelBody scroll={false}>
            {overview.artwork.length ? (
              <div className="grid grid-cols-2 gap-2">
                {overview.artwork.map((a) => (
                  <figure key={a.id} className="min-w-0 border-2 border-ink bg-[#0A0A0B]">
                    <img src={`/${a.src}`} alt={a.id} className="aspect-[3/2] w-full object-contain" loading="lazy" />
                    <figcaption className="truncate border-t-2 border-ink bg-paper-3 px-1.5 py-1 font-mono text-[10px] text-ink">
                      {a.id}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="font-sans text-[12px] text-ink-soft">No artwork: the template design draws its charts and cards in code.</p>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel className="min-h-[320px] lg:min-h-0">
        <PanelHeader title="Shot by shot">
          <Badge tone="quiet">{shots.length}</Badge>
        </PanelHeader>
        <PanelBody bare>
          {shots.length === 0 ? (
            <EmptyState title="No shots yet" />
          ) : (
            <ol className="divide-y-2 divide-ink">
              {shots.map((shot) => (
                <li key={shot.id}>
                  <button
                    type="button"
                    onClick={() => onSelectShot(shot.id)}
                    className="grid w-full grid-cols-[64px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-left hover:bg-paper-3 focus-visible:bg-paper-3 focus-visible:outline-none"
                  >
                    <div className="font-mono text-[10px] leading-tight text-ink-soft">
                      <div className="font-bold text-ink">{shot.id}</div>
                      <div>
                        {clock(shot.startSec)}-{clock(shot.endSec)}
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <p className="font-sans text-[12px] leading-snug text-ink">{shot.says || "(no narration)"}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        {shot.shown.map((c, i) => (
                          <Badge key={`${c}-${i}`} tone="neutral">
                            {c}
                          </Badge>
                        ))}
                        {shot.choice ? <ChoiceChip choice={shot.choice} /> : null}
                        {shot.choice?.device && shot.choice.device.state !== "authored" ? (
                          <span className="font-sans text-[10px] text-ink-mute" title={shot.choice.device.reason}>
                            {shot.choice.device.kind} not drawn: {shot.choice.device.reason}
                          </span>
                        ) : null}
                      </div>
                      {shot.motion.length ? (
                        <ul className="flex flex-col gap-0.5">
                          {shot.motion.map((m) => (
                            <li key={`${m.asset}-${m.clip}`} className="truncate font-mono text-[10px] text-ink-soft" title={m.targets.join(", ")}>
                              <span className="text-ink">{clock(m.startSec)}</span> {m.asset} · {m.clip} · {m.property}
                              {m.targets.length > 1 ? ` ×${m.targets.length}` : ""}
                            </li>
                          ))}
                        </ul>
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
