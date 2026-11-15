/**
 * File Description: The footage action of the Look lens. For the chosen shot that needs footage it shows the state of the generated clip and one button that starts the GPU job. It replaces only the Generate Video button and the clip wiring of the old Styleboard and shot modal. It does not replace the B-Roll on/off switch (ShotInspector has it until P6, and the pipeline design stage sets needsFootage), narration (Words lens), duration (Cut) or visual direction (Ask). While the lens is mounted, a clip that is on disk is wired into every shot that needs footage, in one undo step per poll result, so the export gate never waits on a clip that finished for another shot.
 * Inputs and outputs: film, chosen shot -> footage state, a start request to /api/broll/generate, a film commit when clips must be wired in.
 * Used by: editor/src/screens/LookStage.tsx.
 */

import { useCallback, useEffect, useState } from "react";
import { Film as FilmIcon } from "lucide-react";
import type { Block, Film, Shot } from "../../../src/dl/schema";
import { Badge, Button, Note, Spinner } from "./ui";

interface BrollJob {
  shotId: string;
  state: "queued" | "running" | "done" | "failed";
  progress?: number;
  error?: string;
}

interface BrollStatus {
  filmId: string;
  jobs: BrollJob[];
  existingFootage: Record<string, string>;
}

export interface LookFootageProps {
  film: Film;
  shotId: string;
  commit: (next: Film, label: string) => void;
}

// True when the shot already holds a clip block that points at this source.
function holdsClip(blocks: Block[], src: string): boolean {
  return blocks.some((b) => b.c === "AnalogyInset" && (b as { src?: string }).src === src);
}

// True when the shot holds a clip block with any source.
function holdsAnyClip(blocks: Block[]): boolean {
  return blocks.some((b) => b.c === "AnalogyInset" && Boolean((b as { src?: string }).src));
}

// True when the shot at this index needs a clip, has none, and its previous shot does not hold one. The film schema rejects two clip blocks in a row, so a shot after a clip stays unwired.
function awaitsClip(shots: Shot[], index: number): boolean {
  const s = shots[index];
  if (!s.needsFootage || holdsAnyClip(s.blocks)) return false;
  return index === 0 || !holdsAnyClip(shots[index - 1].blocks);
}

// Puts the clip block first in the shot and drops any older one.
function withClip(shot: Shot, src: string): Shot {
  const inset = {
    c: "AnalogyInset",
    caption: (shot.visualDirection || shot.scriptText || "Footage").slice(0, 60),
    src,
    fullScreenHero: true,
  } as Block;
  return { ...shot, blocks: [inset, ...shot.blocks.filter((b) => b.c !== "AnalogyInset")] };
}

/** The footage state of the chosen shot, with one button to make the clip. A new film starts with fresh state. */
export function LookFootage(props: LookFootageProps) {
  return <LookFootageForFilm key={props.film.id} {...props} />;
}

// The footage state of one film. It is remounted when the film changes, and it ignores a status that names another film.
function LookFootageForFilm({ film, shotId, commit }: LookFootageProps) {
  const shot = film.shots.find((s) => s.id === shotId);
  const needsFootage = Boolean(shot?.needsFootage);
  const anyUnwired = film.shots.some((_, i) => awaitsClip(film.shots, i));
  const [status, setStatus] = useState<BrollStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = status?.filmId === film.id ? status : null;
  const job = current?.jobs.find((j) => j.shotId === shotId);
  const running = job?.state === "queued" || job?.state === "running";
  const clip = current?.existingFootage[shotId];

  // Reads the job and the clips on disk. A failed read keeps the last state.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/broll/status?filmId=${encodeURIComponent(film.id)}`);
      if (!res.ok) return;
      const body = (await res.json()) as Partial<BrollStatus>;
      setStatus({ filmId: film.id, jobs: Array.isArray(body.jobs) ? body.jobs : [], existingFootage: body.existingFootage ?? {} });
    } catch {
      // The state is a convenience. A failed read keeps the last one.
    }
  }, [film.id]);

  // Poll while the chosen shot needs footage or any shot waits for its clip, faster while a job runs.
  const polling = needsFootage || anyUnwired;
  useEffect(() => {
    if (!polling) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), running ? 4000 : 15000);
    return () => window.clearInterval(timer);
  }, [polling, running, refresh]);

  // Wire every clip that is on disk into its shot, all in one commit. A shot right after a clip shot stays unwired, because the film schema forbids two clips in a row.
  useEffect(() => {
    if (!current) return;
    let changed = false;
    const shots: Shot[] = [];
    film.shots.forEach((s, i) => {
      const src = current.existingFootage[s.id];
      const prev = i > 0 ? shots[i - 1] : null;
      if (!s.needsFootage || !src || holdsClip(s.blocks, src) || (prev && holdsAnyClip(prev.blocks))) {
        shots.push(s);
        return;
      }
      changed = true;
      shots.push(withClip(s, src));
    });
    if (changed) commit({ ...film, shots }, "Add footage");
  }, [current, film, commit]);

  // Starts the GPU job for this shot.
  const start = async () => {
    if (!shot || starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/broll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filmId: film.id, shotId: shot.id, prompt: shot.visualDirection || shot.scriptText }),
      });
      const body = await res.json();
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  if (!shot || !needsFootage) return null;
  const percent = Math.round((job?.progress ?? 0) * 100);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper-2 p-2">
      <FilmIcon className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
      {running ? (
        <Badge tone="info">
          <Spinner /> Footage {percent}%
        </Badge>
      ) : job?.state === "failed" ? (
        <Badge tone="danger">Footage failed</Badge>
      ) : clip ? (
        <Badge tone="success">Footage ready</Badge>
      ) : (
        <Badge tone="warn">Needs footage</Badge>
      )}
      <Button size="xs" className="ml-auto" onClick={() => void start()} disabled={starting || running}>
        {clip ? "Make again" : "Make footage"}
      </Button>
      {job?.state === "failed" && job.error ? <Note tone="danger" className="w-full">{job.error}</Note> : null}
      {error ? <Note tone="danger" className="w-full">{error}</Note> : null}
    </div>
  );
}
