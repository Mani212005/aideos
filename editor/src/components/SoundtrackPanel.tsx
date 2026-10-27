/**
 * File Description: Studio music swaps, cached previews, mix levels and soundtrack credits.
 * Inputs and outputs: Open film and owner commit -> checked soundtrack edits and a compact mix panel.
 * Used by: editor/src/screens/EditStage.tsx.
 */

import { useEffect, useRef, useState } from "react";
import { Pause, Play, X } from "lucide-react";
import { z } from "zod";
import library from "../../../audio/library.json";
import { filmSchema, type Film } from "../../../src/dl/schema";
import type { SoundtrackEdit } from "../../../backend/designSpec/soundtrackStudio";
import { Button, Range } from "./ui";

interface SoundtrackPanelProps {
  film: Film;
  selectedSection: { index: number } | null;
  onCommit: (film: Film, label: string) => void;
  onClose: () => void;
  onPreview: () => void;
}

// Formats the section's timeline range without letting long track names squeeze it out.
function timeLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

// Exposes the existing per-item volume controls as a single conservative bed or effects level.
function channelLevel(entries: Array<{ volume?: number }>): number {
  return Math.min(1, Math.max(0, entries[0]?.volume ?? 1));
}

// Shows the soundtrack and applies one checked rebuild per owner gesture.
export function SoundtrackPanel({ film, selectedSection, onCommit, onClose, onPreview }: SoundtrackPanelProps) {
  const [swapping, setSwapping] = useState<number | null>(selectedSection?.index ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [draftMusic, setDraftMusic] = useState<number | null>(null);
  const [draftEffects, setDraftEffects] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const previewRequest = useRef(0);
  const mounted = useRef(true);
  const currentFilm = useRef(film);
  currentFilm.current = film;
  const soundtrack = film.soundtrack;
  const sections = soundtrack?.sections ?? [];
  const effects = soundtrack?.sfx ?? [];
  const music = channelLevel(sections);
  const sfx = channelLevel(effects);

  // Opens the section chosen by double-clicking its Music lane clip.
  useEffect(() => { setSwapping(selectedSection?.index ?? null); }, [selectedSection]);
  // Stops audition audio and ignores late requests when the panel or project closes.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; previewRequest.current++; audio.current?.pause(); };
  }, []);

  // Builds a proposal without touching disk, then commits it through the owner's undo history.
  async function apply(edit: SoundtrackEdit): Promise<void> {
    setBusy(true);
    setError("");
    const base = film;
    try {
      const response = await fetch(`/api/soundtrack/${film.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ film, edit }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(z.object({ error: z.string() }).parse(payload).error);
      const next = z.object({ film: filmSchema }).parse(payload).film;
      if (!mounted.current) return;
      if (currentFilm.current !== base) throw new Error("The film changed during the rebuild. Try this edit again.");
      onCommit(next, edit.kind === "swap" ? "Swap music track" : `Set ${edit.channel === "music" ? "music bed" : "effects"} level`);
      setSwapping(null);
      previewRequest.current++;
      audio.current?.pause();
      setPreviewing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      setDraftMusic(null);
      setDraftEffects(null);
    }
  }

  // Auditions one verified asset from the same cache URL the shared render mixer uses.
  async function preview(item: string): Promise<void> {
    onPreview();
    const request = ++previewRequest.current;
    audio.current?.pause();
    if (previewing === item) { setPreviewing(null); setPreviewLoading(null); return; }
    setPreviewing(null);
    setPreviewLoading(item);
    setError("");
    try {
      const response = await fetch(`/api/audio-library/${encodeURIComponent(item)}/preview`, { method: "POST" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(z.object({ error: z.string() }).parse(payload).error);
      const { src } = z.object({ src: z.string() }).parse(payload);
      if (request !== previewRequest.current) return;
      const player = new Audio(src);
      audio.current = player;
      player.volume = 0.35;
      // Resets the audition control when a track finishes naturally.
      player.onended = () => { if (request === previewRequest.current) setPreviewing(null); };
      // Makes cache or decode errors visible instead of leaving a stuck pause button.
      player.onerror = () => { if (request === previewRequest.current) { setPreviewing(null); setError("This track could not be played from the audio cache."); } };
      await player.play();
      if (request === previewRequest.current) setPreviewing(item);
      else player.pause();
    } catch (reason) {
      if (request === previewRequest.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === previewRequest.current) setPreviewLoading(null);
    }
  }

  // Commits a slider on release or keyboard completion, preserving one undo step per gesture.
  function finishLevel(channel: "music" | "sfx", value: number): void {
    const previous = channel === "music" ? music : sfx;
    if (value !== previous) void apply({ kind: "level", channel, volume: value });
  }

  const credits = soundtrack?.credits ?? [];
  const creditsText = Array.isArray(credits) ? credits.join("\n") : credits;
  return (
    <aside aria-label="Soundtrack mix" className="absolute inset-y-0 right-0 z-[80] flex w-72 shrink-0 flex-col border-l-2 border-ink bg-paper text-ink xl:static">
      <div className="flex items-center justify-between border-b-2 border-ink px-3 py-2">
        <h2 className="font-sans text-xs font-black uppercase tracking-wider">Mix</h2>
        <Button size="sm" aria-label="Close mix panel" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="space-y-5 overflow-y-auto p-3">
        <p className="text-[11px] leading-relaxed text-muted">Music and effects stay under the narration. Changes save with your film.</p>
        {error ? <p role="alert" className="whitespace-pre-wrap border-2 border-ink bg-paper-2 p-2 text-xs leading-relaxed">{error}</p> : null}
        {(["music", "sfx"] as const).map((channel) => {
          const value = channel === "music" ? draftMusic ?? music : draftEffects ?? sfx;
          const label = channel === "music" ? "Music bed level" : "Effects level";
          const disabled = busy || (channel === "music" ? !sections.length : !effects.length);
          return <label key={channel} className="block space-y-2 text-xs font-bold">
            <span className="flex justify-between gap-2"><span>{label}</span><output className="font-mono tabular-nums">{Math.round(value * 100)}%</output></span>
            <Range className="w-full" name={channel === "music" ? "music-bed-level" : "effects-level"} aria-label={label} min={0} max={1} step={0.01} value={value} disabled={disabled}
              onChange={(event) => channel === "music" ? setDraftMusic(Number(event.target.value)) : setDraftEffects(Number(event.target.value))}
              onPointerUp={(event) => finishLevel(channel, Number(event.currentTarget.value))}
              onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) finishLevel(channel, Number(event.currentTarget.value)); }} />
          </label>;
        })}
        <section aria-label="Music sections" className="space-y-2">
          <h3 className="text-[10px] font-black uppercase tracking-wider">Music</h3>
          {!sections.length ? <p className="text-xs text-muted">No music sections. Add a soundtrack in Look.</p> : sections.map((section, index) => {
            const title = library.items.find((item) => item.id === section.item)?.title ?? section.item;
            const choices = library.items.filter((item) => item.kind === "music" && item.roles.includes(section.role));
            return <div key={`${index}-${section.item}`} className="border-2 border-ink bg-paper-2 p-2">
              <div className="flex justify-between gap-2 font-mono text-[10px] uppercase"><span>{section.role}</span><span className="shrink-0">{timeLabel(section.from)} - {timeLabel(section.to)}</span></div>
              <p className="my-1 break-words text-xs font-bold leading-relaxed" title={title}>{title}</p>
              <Button size="sm" disabled={busy} aria-expanded={swapping === index} onClick={() => setSwapping(swapping === index ? null : index)}>Swap track</Button>
              {swapping === index ? <div className="mt-2 space-y-2 border-t border-ink/20 pt-2">
                {!choices.length ? <p className="text-xs text-muted">No library tracks match this role.</p> : choices.map((item) => <div key={item.id} className="flex items-start gap-1">
                  <Button size="sm" disabled={busy || previewLoading !== null} aria-label={`${previewing === item.id ? "Stop" : "Preview"} ${item.title}`} onClick={() => void preview(item.id)}>
                    {previewing === item.id ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  </Button>
                  <button type="button" disabled={busy || item.id === section.item} onClick={() => void apply({ kind: "swap", section: index, item: item.id })}
                    className="min-w-0 flex-1 break-words border border-transparent px-1 py-1 text-left text-xs leading-relaxed hover:border-ink hover:bg-paper disabled:opacity-50">
                    {item.title}<span className="mt-0.5 block font-mono text-[9px] text-muted">{previewLoading === item.id ? "Loading preview..." : item.id === section.item ? "Current track" : `${timeLabel(item.durationSec)} / ${item.artist}`}</span>
                  </button>
                </div>)}
              </div> : null}
            </div>;
          })}
        </section>
        <section aria-label="Sound effect events" className="space-y-2">
          <h3 className="text-[10px] font-black uppercase tracking-wider">Sound effects</h3>
          {!effects.length ? <p className="text-xs text-muted">No sound effects.</p> : effects.map((effect, index) => <div key={index} className="flex items-start justify-between gap-2 text-xs">
            <span className="min-w-0 break-words" title={effect.item}>{effect.event ?? "Unbound event"}</span><span className="shrink-0 font-mono text-[10px]">{timeLabel(effect.timeSec)}</span>
          </div>)}
        </section>
        <label className="block space-y-2 text-[10px] font-black uppercase tracking-wider">Credits
          <textarea name="soundtrack-credits" aria-label="Credits text" readOnly rows={3} value={creditsText} placeholder="No credits required" className="block w-full resize-none border-2 border-ink bg-paper-2 p-2 font-sans text-xs font-normal normal-case leading-relaxed tracking-normal placeholder:text-muted" />
        </label>
        {busy ? <p role="status" className="text-xs text-muted">Checking and rebuilding soundtrack...</p> : null}
      </div>
    </aside>
  );
}
