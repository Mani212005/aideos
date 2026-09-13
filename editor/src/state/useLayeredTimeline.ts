/**
 * File Description: Binds the Aideos layer model to the open film for the editor timeline.
 * Derives a LayeredFilm from the Film, exposes every timeline edit as a single named operation
 * that folds the result back into the Film and commits exactly one undo step, and turns a rejected
 * edit (locked lane, media bounds, minimum duration) into a readable message instead of a crash.
 */

import { useCallback, useMemo } from "react";
import type { Film } from "../../../src/dl/schema";
import type { Clip, Layer, LayeredFilm } from "../../../src/dl/layeredSchema";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../../src/dl/convertFilm";
import {
  TimelineEditError,
  importMediaAssetToLayeredFilm,
  moveLayerClip,
  moveMultipleLayerClips,
  trimLayerClipEdge,
  splitLayerClipAtTime,
  deleteLayerClip,
  unlinkClips,
  clipDuration,
  clipEndSec,
  type MediaAssetInput,
} from "../../../backend/timeline/layer_engine";
import {
  addLayer,
  deleteLayer,
  renameLayer,
  setLayerProperty,
  shiftLayerOrder,
} from "../../../backend/timeline/layer_manager";

export interface LayeredTimelineApi {
  layered: LayeredFilm;
  /**
   * The film as it will actually render and export: clips on hidden lanes are removed and clips on
   * muted lanes are silenced, so the preview, the timeline and the exported MP4 agree on what those
   * two flags mean.
   */
  renderFilm: Film;
  /** False when every lane carrying visual clips is hidden, so there is nothing to show. */
  hasVisibleVisuals: boolean;
  /** Lanes ordered topmost first, which is how a timeline stacks them on screen. */
  lanes: Layer[];
  clipsByLayer: Map<string, Clip[]>;
  /** Last moment any clip is still playing. */
  contentEndSec: number;
  moveClip: (clipId: string, positionSec: number, targetLayerId?: string) => boolean;
  moveClips: (clipIds: string[], deltaSec: number) => boolean;
  trimClip: (clipId: string, edge: "left" | "right", deltaSec: number) => boolean;
  splitClip: (clipId: string, atSec: number) => boolean;
  removeClip: (clipId: string, deleteLinked?: boolean) => boolean;
  removeClips: (clipIds: string[]) => boolean;
  unlinkClip: (clipId: string) => boolean;
  setClipVolume: (clipId: string, volume: number) => boolean;
  importAsset: (asset: MediaAssetInput, positionSec: number, layerId?: string) => boolean;
  addLane: (label: string) => boolean;
  removeLane: (layerId: string) => boolean;
  renameLane: (layerId: string, label: string) => boolean;
  setLaneFlag: (layerId: string, patch: Partial<Pick<Layer, "locked" | "hidden" | "muted" | "height">>) => boolean;
  shiftLane: (layerId: string, direction: "up" | "down") => boolean;
}

export interface UseLayeredTimelineOptions {
  film: Film;
  commit: (next: Film, label: string) => void;
  onReject: (message: string) => void;
}

/** Derive the layer model for a film and expose every timeline edit as one undoable operation. */
export function useLayeredTimeline({ film, commit, onReject }: UseLayeredTimelineOptions): LayeredTimelineApi {
  const layered = useMemo(() => convertFilmToLayeredFilm(film), [film]);

  const lanes = useMemo(() => [...layered.layers].sort((a, b) => b.number - a.number), [layered.layers]);

  const clipsByLayer = useMemo(() => {
    const map = new Map<string, Clip[]>();
    for (const lane of layered.layers) map.set(lane.id, []);
    for (const clip of layered.clips) {
      const bucket = map.get(clip.layerId);
      if (bucket) bucket.push(clip);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.position - b.position);
    return map;
  }, [layered]);

  const contentEndSec = useMemo(
    () => layered.clips.reduce((max, c) => Math.max(max, clipEndSec(c)), 0),
    [layered.clips],
  );

  const hiddenLayerIds = useMemo(
    () => new Set(layered.layers.filter((l) => l.hidden).map((l) => l.id)),
    [layered.layers],
  );
  const mutedLayerIds = useMemo(
    () => new Set(layered.layers.filter((l) => l.muted).map((l) => l.id)),
    [layered.layers],
  );

  const hasVisibleVisuals = useMemo(
    () =>
      layered.clips.some(
        (c) => (c.kind === "animation" || c.kind === "video" || c.kind === "image") && !hiddenLayerIds.has(c.layerId),
      ),
    [hiddenLayerIds, layered.clips],
  );

  const renderFilm = useMemo(() => {
    if (hiddenLayerIds.size === 0 && mutedLayerIds.size === 0) return film;
    const visible = layered.clips
      .filter((c) => !hiddenLayerIds.has(c.layerId))
      .map((c) => (mutedLayerIds.has(c.layerId) ? { ...c, volume: 0 } : c));
    // A film with no shots at all cannot be built into a timeline, so the original shot list is
    // kept and the caller shows an explicit "everything is hidden" state instead.
    if (!visible.some((c) => c.kind === "animation")) return film;
    return convertLayeredFilmToFilm({ ...layered, clips: visible }, film);
  }, [film, hiddenLayerIds, layered, mutedLayerIds]);

  /**
   * Run one layer-engine operation, fold the result back into the Film and commit it.
   * Returns false and surfaces a readable reason when the model refuses the edit.
   */
  const apply = useCallback(
    (label: string, operation: () => { film: LayeredFilm }): boolean => {
      try {
        const { film: nextLayered } = operation();
        commit(convertLayeredFilmToFilm(nextLayered, film), label);
        return true;
      } catch (err) {
        if (err instanceof TimelineEditError) {
          onReject(err.message);
        } else {
          onReject(err instanceof Error ? err.message : String(err));
        }
        return false;
      }
    },
    [commit, film, onReject],
  );

  const moveClip = useCallback(
    (clipId: string, positionSec: number, targetLayerId?: string) =>
      apply(`Move ${clipId}`, () => moveLayerClip(layered, clipId, positionSec, targetLayerId)),
    [apply, layered],
  );

  const moveClips = useCallback(
    (clipIds: string[], deltaSec: number) =>
      apply(
        clipIds.length > 1 ? `Move ${clipIds.length} clips` : `Move ${clipIds[0] ?? "clip"}`,
        () => moveMultipleLayerClips(layered, clipIds, deltaSec),
      ),
    [apply, layered],
  );

  const trimClip = useCallback(
    (clipId: string, edge: "left" | "right", deltaSec: number) =>
      apply(`Trim ${clipId} ${edge === "left" ? "in" : "out"}`, () =>
        trimLayerClipEdge(layered, clipId, edge, deltaSec),
      ),
    [apply, layered],
  );

  const splitClip = useCallback(
    (clipId: string, atSec: number) =>
      apply(`Split ${clipId}`, () => splitLayerClipAtTime(layered, clipId, atSec)),
    [apply, layered],
  );

  const removeClip = useCallback(
    (clipId: string, deleteLinked = true) =>
      apply(`Delete ${clipId}`, () => deleteLayerClip(layered, clipId, { deleteLinked })),
    [apply, layered],
  );

  const removeClips = useCallback(
    (clipIds: string[]) => {
      if (clipIds.length === 0) return false;
      if (clipIds.length === 1) {
        return apply(`Delete ${clipIds[0]}`, () => deleteLayerClip(layered, clipIds[0], { deleteLinked: true }));
      }
      // Every removal is applied to the same working copy so the whole selection is one undo step.
      return apply(`Delete ${clipIds.length} clips`, () => {
        let working = layered;
        for (const id of clipIds) {
          if (!working.clips.some((c) => c.id === id)) continue;
          working = deleteLayerClip(working, id, { deleteLinked: true }).film;
        }
        return { film: working };
      });
    },
    [apply, layered],
  );

  const unlinkClip = useCallback(
    (clipId: string) => apply(`Unlink ${clipId}`, () => unlinkClips(layered, clipId)),
    [apply, layered],
  );

  const setClipVolume = useCallback(
    (clipId: string, volume: number) =>
      apply(`Set ${clipId} volume`, () => ({
        film: {
          ...layered,
          clips: layered.clips.map((c) =>
            c.id === clipId ? { ...c, volume: Math.max(0, Math.min(1, volume)) } : c,
          ),
        },
      })),
    [apply, layered],
  );

  const importAsset = useCallback(
    (asset: MediaAssetInput, positionSec: number, layerId?: string) =>
      apply(`Add ${asset.filename}`, () =>
        importMediaAssetToLayeredFilm(layered, asset, positionSec, layerId),
      ),
    [apply, layered],
  );

  const addLane = useCallback(
    (label: string) => apply(`Add lane "${label}"`, () => addLayer(layered, label)),
    [apply, layered],
  );

  const removeLane = useCallback(
    (layerId: string) => apply("Delete lane", () => deleteLayer(layered, layerId)),
    [apply, layered],
  );

  const renameLane = useCallback(
    (layerId: string, label: string) => apply(`Rename lane to "${label}"`, () => renameLayer(layered, layerId, label)),
    [apply, layered],
  );

  const setLaneFlag = useCallback(
    (layerId: string, patch: Partial<Pick<Layer, "locked" | "hidden" | "muted" | "height">>) => {
      const key = Object.keys(patch)[0] ?? "property";
      return apply(`Set lane ${key}`, () => setLayerProperty(layered, layerId, patch));
    },
    [apply, layered],
  );

  const shiftLane = useCallback(
    (layerId: string, direction: "up" | "down") =>
      apply(`Move lane ${direction}`, () => shiftLayerOrder(layered, layerId, direction)),
    [apply, layered],
  );

  return {
    layered,
    renderFilm,
    hasVisibleVisuals,
    lanes,
    clipsByLayer,
    contentEndSec,
    moveClip,
    moveClips,
    trimClip,
    splitClip,
    removeClip,
    removeClips,
    unlinkClip,
    setClipVolume,
    importAsset,
    addLane,
    removeLane,
    renameLane,
    setLaneFlag,
    shiftLane,
  };
}

/** Human-readable duration of a clip, used by inspectors and lane labels. */
export function formatClipDuration(clip: Clip): string {
  return `${clipDuration(clip).toFixed(2)}s`;
}
