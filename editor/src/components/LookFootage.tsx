/**
 * File Description: The footage action of the Look lens. For a chosen shot that needs footage it shows the state of the generated clip and one button that starts the GPU job. It replaces the Styleboard B-Roll switch and the shot modal, and it is the only way to make the footage that export asks for. A clip that is on disk but not yet in the shot is wired in as one undo step.
 * Inputs and outputs: film, chosen shot -> footage state, a start request to /api/broll/generate, a film commit when a clip must be wired in.
 * Used by: editor/src/screens/LookStage.tsx.
 */

import { useCallback, useEffect, useState } from "react";
import { Film as FilmIcon } from "lucide-react";
import type { Block, Film } from "../../../src/dl/schema";
import { Badge, Button, Note, Spinner } from "./ui";

interface BrollJob {
  shotId: string;
  state: "queued" | "running" | "done" | "failed";
  progress?: number;
  error?: string;
}

interface BrollStatus {
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

/** The footage state of the chosen shot, with one button to make the clip. Renders nothing for a shot that needs none. */
export function LookFootage({ film, shotId, commit }: LookFootageProps) {
  const shot = film.shots.find((s) => s.id === shotId);
  const needsFootage = Boolean(shot?.needsFootage);
  const [status, setStatus] = useState<BrollStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = status?.jobs.find((j) => j.shotId === shotId);
  const running = job?.state === "queued" || job?.state === "running";
  const clip = status?.existingFootage[shotId];

  // Reads the job and the clips on disk. A failed read keeps the last state.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/broll/status?filmId=${encodeURIComponent(film.id)}`);
      if (!res.ok) return;
      const body = (await res.json()) as Partial<BrollStatus>;
      setStatus({ jobs: Array.isArray(body.jobs) ? body.jobs : [], existingFootage: body.existingFootage ?? {} });
    } catch {
      // The state is a convenience. A failed read keeps the last one.
    }
  }, [film.id]);

  // Poll while the shot needs footage, faster while a job runs.
  useEffect(() => {
    if (!needsFootage) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), running ? 4000 : 15000);
    return () => window.clearInterval(timer);
  }, [needsFootage, running, refresh]);

  // Wire a clip that is on disk into the shot when the shot does not hold it yet.
  useEffect(() => {
    if (!shot || !needsFootage || !clip || holdsClip(shot.blocks, clip)) return;
    const inset = {
      c: "AnalogyInset",
      caption: (shot.visualDirection || shot.scriptText || "Footage").slice(0, 60),
      src: clip,
      fullScreenHero: true,
    } as Block;
    const blocks = [inset, ...shot.blocks.filter((b) => b.c !== "AnalogyInset")];
    commit({ ...film, shots: film.shots.map((s) => (s.id === shot.id ? { ...s, blocks } : s)) }, "Add footage");
  }, [shot, needsFootage, clip, film, commit]);

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
