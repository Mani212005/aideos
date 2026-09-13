/**
 * File Description: Captions stage for Aideos Studio.
 * The one place caption timing is authored. The timeline shows caption cues as a read-only
 * reference lane, so this stage owns editing them: word text, per-word frame ranges, and the
 * kinetic layout used when they are burned into the film. Edits are written back as a VTT track on
 * the film, which is what both the renderer and the timeline read.
 */

import { useMemo } from "react";
import type { Film } from "../../../src/dl/schema";
import { captionWordsToVtt, generateWordsFromFilm } from "../../../src/dl/captionsParser";
import { DensityStrip, Panel, PanelBody, PanelHeader } from "../components/ui";
import { KineticCaptionEditor } from "../components/KineticCaptionEditor";

export interface CaptionsStageProps {
  film: Film;
  commit: (next: Film, label: string) => void;
  onSeekFrame: (frame: number) => void;
}

/** Word-level caption authoring with a narration density overview. */
export function CaptionsStage({ film, commit, onSeekFrame }: CaptionsStageProps) {
  const fps = film.fps || 30;
  const words = useMemo(() => generateWordsFromFilm(film as unknown as Record<string, unknown>), [film]);

  const spans = useMemo(
    () =>
      words.map((w) => ({
        startSec: w.startFrame / fps,
        endSec: w.endFrame / fps,
        label: w.text,
      })),
    [fps, words],
  );

  const totalSec = useMemo(
    () => Math.max(film.voiceover?.durationSec ?? 0, ...spans.map((s) => s.endSec), 1),
    [film.voiceover?.durationSec, spans],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
      <Panel tone="flat" className="shrink-0">
        <PanelHeader title="Narration density" />
        <PanelBody scroll={false} className="p-3">
          <p className="mb-2 font-sans text-[11px] leading-snug text-ink-soft">
            Green is spoken narration, the gap behind it is silence. Long silences usually mean a shot is
            longer than the line it carries.
          </p>
          <DensityStrip spans={spans} totalSec={totalSec} height={30} />
        </PanelBody>
      </Panel>

      <Panel className="min-h-0 flex-1">
        <PanelHeader title="Caption words" accent />
        <PanelBody bare className="min-h-0">
          <KineticCaptionEditor
            film={film}
            words={words}
            onCaptionsChange={(next) => commit({ ...film, captions: captionWordsToVtt(next, fps) }, "Edit captions")}
            onSeekToFrame={onSeekFrame}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
