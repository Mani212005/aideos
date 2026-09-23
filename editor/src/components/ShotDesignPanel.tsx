/**
 * File Description: The shot inspector's "why this visual" panel.
 * Says what the design stage chose for this shot and why (Jev's pick and confidence, or the rule
 * that decided), whether its chart data was drawn or refused, and offers two actions: swap to one
 * of Jev's runner-ups (redrawn through the same honest path, so a swap can be refused with the
 * reason) and ask the connected agent to redesign just this shot.
 */

import { useMemo, useState } from "react";
import { Bot, Repeat } from "lucide-react";
import type { Block, Film, Shot } from "../../../src/dl/schema";
import { Badge, Button, Note, Textarea } from "./ui";
import { ChoiceChip } from "./DesignView";
import { postDesignAction, useDesignOverview } from "../state/useDesignOverview";

const SWAPPABLE = ["Text", "StatCounter", "TokenStrip", "Plot", "MatrixGrid", "Distribution", "LayerStack", "ScaleBar"];

export interface ShotDesignPanelProps {
  film: Film;
  shot: Shot;
  onApply: (update: Partial<Shot>, label: string) => void;
}

/** Why this shot shows what it shows, with swap and redesign actions. */
export function ShotDesignPanel({ film, shot, onApply }: ShotDesignPanelProps) {
  const { overview } = useDesignOverview(film.id, film.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [note, setNote] = useState("");
  const choice = overview?.shots.find((s) => s.id === shot.id)?.choice;
  const current = shot.blocks.find((b) => SWAPPABLE.includes(b.c) && b.c !== "Text")?.c ?? "Text";

  // Jev's runner-ups that it gave any real weight, plus plain text, never the one already shown.
  // Without a recorded choice every kind is offered, since nothing ranks them.
  const options = useMemo(() => {
    const probs = choice?.probabilities;
    const ranked = probs
      ? Object.entries(probs)
          .filter(([k, p]) => SWAPPABLE.includes(k) && p >= 0.01)
          .sort((a, b) => b[1] - a[1])
          .map(([k, p]) => ({ kind: k, p: p as number | undefined }))
      : SWAPPABLE.map((k) => ({ kind: k, p: undefined as number | undefined }));
    if (!ranked.some((o) => o.kind === "Text")) ranked.push({ kind: "Text", p: probs ? 0 : undefined });
    return ranked.filter((o) => o.kind !== current).slice(0, 4);
  }, [choice, current]);

  const swap = async (kind: string) => {
    setBusy(kind);
    setMessage(null);
    try {
      const out = await postDesignAction<{ blocks: Block[]; stage: Shot["stage"] }>(`${film.id}/shots/${shot.id}/visual`, { visual: kind, film });
      onApply({ blocks: out.blocks, stage: out.stage }, `Swap ${shot.id} to ${kind}`);
      setMessage({ tone: "success", text: `Now shown as ${kind}.` });
    } catch (err) {
      setMessage({ tone: "danger", text: `${kind} not drawn: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  };

  const redesign = async () => {
    setBusy("redesign");
    setMessage(null);
    try {
      const out = await postDesignAction<{ channels: string[] }>(`${film.id}/shots/${shot.id}/redesign`, { note, film });
      setMessage({ tone: "success", text: `Sent to the agent (${out.channels.join(", ")}). The film reloads when the new design builds.` });
      setNote("");
    } catch (err) {
      setMessage({ tone: "danger", text: `Could not send: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-2 border-ink bg-paper-3 p-2.5 shadow-nb-sm">
      <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-soft">Why this visual</label>
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone="neutral">{current}</Badge>
        {choice ? <ChoiceChip choice={choice} /> : null}
      </div>
      <p className="text-[11px] leading-snug text-ink-soft">
        {!choice
          ? "The design stage did not choose a chart for this shot (footage, a bare canvas beat, or a film made before choices were recorded)."
          : choice.source === "jev"
            ? `Jev read the narration and picked ${choice.visual}${choice.confidence !== undefined ? ` with ${Math.round(choice.confidence * 100)}% confidence` : ""}.`
            : `Chosen by rule: ${choice.fallbackReason ?? "Jev was not confident enough"}.`}
        {choice?.device?.state === "authored" ? " Its data was written from the narration and checked." : ""}
        {choice?.device && choice.device.state !== "authored" ? ` ${choice.device.kind} was not drawn: ${choice.device.reason}.` : ""}
      </p>

      {options.length ? (
        <div className="grid grid-cols-2 gap-1.5">
          {options.map((o) => (
            <Button key={o.kind} size="xs" block onClick={() => swap(o.kind)} disabled={busy !== null} title={`Redraw this shot as ${o.kind}`}>
              <Repeat className="h-3 w-3 shrink-0" />
              <span className="truncate">{busy === o.kind ? "Drawing..." : o.kind}</span>
              {o.p !== undefined && busy !== o.kind ? <span className="ml-auto font-mono text-ink-soft">{Math.round(o.p * 100)}%</span> : null}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5 border-t-2 border-ink pt-2">
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What should change? (optional)"
          aria-label="Redesign note"
        />
        <Button size="sm" tone="primary" onClick={redesign} disabled={busy !== null}>
          <Bot className="h-3.5 w-3.5" />
          {busy === "redesign" ? "Sending..." : "Redesign this shot"}
        </Button>
      </div>
      {message ? <Note tone={message.tone}>{message.text}</Note> : null}
    </div>
  );
}
