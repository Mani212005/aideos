/**
 * File Description: Edit stage for Aideos Studio.
 * The non-linear editing surface: a preview player sitting in the one dark matte the product
 * allows (so footage exposure reads true), a resizable split, and the layer-model timeline below
 * it. Also owns the format switcher, the media bin that feeds drag and drop into the timeline, and
 * the guidance shown before a voiceover exists to lock the timeline to.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { EyeOff, FileText, GripHorizontal, Mic, RefreshCw } from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import { FilmView } from "../../../src/dl/Film";
import { buildTimeline, totalFrames } from "../../../src/dl/camera";
import { generateWordsFromFilm } from "../../../src/dl/captionsParser";
import type { FilmProject } from "../state/useFilmProject";
import type { LayeredTimelineApi } from "../state/useLayeredTimeline";
import { Button, EmptyState, SegmentedTabs, Toolbar, ToolbarDivider, ToolbarGroup, ToolbarLabel, cn } from "../components/ui";
import { TimelineEditor } from "../components/TimelineEditor";
import { AssetBin, type MediaAsset } from "../components/AssetBin";
import { OnCanvasAiEditor } from "../components/OnCanvasAiEditor";
import { FORMATS, type Format } from "../App";

/** Bounds for the draggable split between the preview and the timeline. */
const MIN_TIMELINE_PX = 160;
const MAX_TIMELINE_RATIO = 0.72;

export interface EditStageProps {
  film: Film;
  project: FilmProject;
  api: LayeredTimelineApi;
  accent: string;
  format: Format;
  onFormatChange: (format: Format) => void;
  playerRef: React.RefObject<PlayerRef | null>;
  currentFrame: number;
  isPlaying: boolean;
  onSeekFrame: (frame: number) => void;
  onTogglePlay: () => void;
  selectedClipIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onReject: (message: string) => void;
  onGoToScript: () => void;
}

/** Preview plus timeline: the stage where the film is actually cut. */
export function EditStage({
  film,
  project,
  api,
  accent,
  format,
  onFormatChange,
  playerRef,
  currentFrame,
  isPlaying,
  onSeekFrame,
  onTogglePlay,
  selectedClipIds,
  onSelectionChange,
  onReject,
  onGoToScript,
}: EditStageProps) {
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  // The media bin is the first thing to fold away on a narrow window, because the preview and the
  // timeline are what the Edit stage is for.
  const [binOpen, setBinOpen] = useState(() => window.innerWidth >= 1280);
  const [previewKey, setPreviewKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const captionWords = useMemo(
    () => generateWordsFromFilm(film as unknown as Record<string, unknown>),
    [film],
  );

  // The preview plays exactly what an export would produce, so hidden lanes disappear from it and
  // muted lanes go silent rather than only looking different on the timeline.
  const previewTimeline = useMemo(() => {
    try {
      return buildTimeline(api.renderFilm, api.renderFilm.voiceover?.durationSec);
    } catch {
      return null;
    }
  }, [api.renderFilm]);

  const previewFrames = previewTimeline ? totalFrames(previewTimeline) : project.durationFrames;

  const playerInputProps = useMemo(
    () => ({
      film: api.renderFilm,
      timeline: previewTimeline ?? [],
      accent,
      showGrid: film.theme?.videoType === "case-study",
      showRail: true,
      captionWords,
    }),
    [accent, api.renderFilm, captionWords, film.theme?.videoType, previewTimeline],
  );

  // Drag the horizontal split between the preview and the timeline.
  useEffect(() => {
    if (!isResizing) return;
    /** Resize the timeline pane to follow the pointer, clamped to usable bounds. */
    const onMove = (e: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = rect.bottom - e.clientY;
      setTimelineHeight(Math.max(MIN_TIMELINE_PX, Math.min(rect.height * MAX_TIMELINE_RATIO, next)));
    };
    /** End the resize gesture however the pointer is released. */
    const onUp = () => setIsResizing(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isResizing]);

  /** Add a media asset from the bin at the playhead on its natural lane. */
  const insertAsset = useCallback(
    (asset: MediaAsset) => {
      const kind: "video" | "audio" | "image" =
        asset.type === "audio" ? "audio" : asset.type === "image" ? "image" : "video";
      api.importAsset(
        {
          filename: asset.filename,
          src: asset.src,
          type: kind,
          duration: asset.duration && asset.duration > 0 ? asset.duration : 5,
          width: asset.width,
          height: asset.height,
        },
        currentFrame / (film.fps || 30),
      );
    },
    [api, currentFrame, film.fps],
  );

  if (!film.voiceover?.src) {
    return (
      <EmptyState
        icon={<Mic className="h-6 w-6" />}
        title="This film has no voiceover yet"
        description="The timeline locks to the narration track, so Aideos needs a voiceover before it can lay shots out in time."
        steps={[
          "Open the Script stage and write or paste your screenplay.",
          "Pick a voice and generate the voiceover (.wav).",
          "Come back here to arrange lanes, trim clips and export.",
        ]}
        action={
          <Button tone="primary" size="md" onClick={onGoToScript}>
            <FileText className="h-4 w-4" />
            Go to Script
          </Button>
        }
      />
    );
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Toolbar seam="bottom">
        <ToolbarGroup>
          <ToolbarLabel>Format</ToolbarLabel>
          <SegmentedTabs
            size="sm"
            ariaLabel="Output format"
            value={format}
            onChange={onFormatChange}
            items={(Object.keys(FORMATS) as Format[]).map((f) => ({
              value: f,
              label: f === "long" ? "Wide" : "Reel",
              suffix: FORMATS[f].label,
              title: `${FORMATS[f].width} by ${FORMATS[f].height}`,
            }))}
          />
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <Button
            size="sm"
            onClick={() => setPreviewKey((k) => k + 1)}
            title="Rebuild the preview from the current film"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh preview
          </Button>
        </ToolbarGroup>

        <div className="ml-auto">
          <Button size="sm" active={binOpen} onClick={() => setBinOpen((p) => !p)} title="Show or hide the media bin">
            Media bin
          </Button>
        </div>
      </Toolbar>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {binOpen ? (
          <div className="w-56 shrink-0 overflow-y-auto border-r-2 border-ink bg-paper-2">
            <AssetBin onInsertAssetAsShot={insertAsset} />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* The one dark surface in the product: the matte behind the video frame. */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-matte">
            {!api.hasVisibleVisuals ? (
              <div className="flex max-w-sm flex-col items-center gap-2 p-6 text-center">
                <EyeOff className="h-6 w-6 text-matte-text" />
                <p className="font-sans text-xs font-bold uppercase tracking-[0.08em] text-matte-text">
                  Every visual lane is hidden
                </p>
                <p className="font-sans text-[11px] leading-relaxed text-matte-text/70">
                  Turn a lane back on with the eye control in the lane header to see the film again.
                </p>
              </div>
            ) : previewTimeline ? (
              <>
                <Player
                  ref={playerRef}
                  key={previewKey}
                  component={FilmView}
                  inputProps={playerInputProps}
                  durationInFrames={Math.max(1, previewFrames)}
                  fps={film.fps}
                  compositionWidth={FORMATS[format].width}
                  compositionHeight={FORMATS[format].height}
                  style={{ width: "100%", height: "100%", maxHeight: "100%" }}
                  controls
                  clickToPlay
                  acknowledgeRemotionLicense
                />
                <OnCanvasAiEditor
                  film={film}
                  timeline={previewTimeline}
                  currentFrame={currentFrame}
                  onUpdateFilm={(next) => project.commit(next, "On-canvas AI edit")}
                  accent={accent}
                />
              </>
            ) : (
              <p className="p-6 text-center font-mono text-xs text-matte-text">
                The timeline could not be built from this film. Check the Review stage for the validation error.
              </p>
            )}
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the timeline"
            onPointerDown={() => setIsResizing(true)}
            className={cn(
              "flex h-3 shrink-0 cursor-row-resize items-center justify-center border-y-2 border-ink bg-paper",
              isResizing ? "bg-select" : "hover:bg-primary",
            )}
          >
            <GripHorizontal className="h-3 w-3 text-ink" />
          </div>

          <div style={{ height: timelineHeight }} className="min-h-0 shrink-0 overflow-hidden">
            <TimelineEditor
              film={film}
              api={api}
              durationSec={project.durationSec}
              currentFrame={currentFrame}
              isPlaying={isPlaying}
              selectedClipIds={selectedClipIds}
              onSelectionChange={onSelectionChange}
              onSeekFrame={onSeekFrame}
              onTogglePlay={onTogglePlay}
              canUndo={project.canUndo}
              canRedo={project.canRedo}
              onUndo={project.undo}
              onRedo={project.redo}
              onReject={onReject}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
