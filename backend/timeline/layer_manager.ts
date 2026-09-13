/**
 * File Description: Layer Management & Dynamic Z-Ordering Engine (Phase L-6).
 * Implements user-controlled layer operations (U-2 & U-3):
 * - Adding, deleting, renaming, and reordering layers with unique, in-range z-order numbers.
 * - Layer state controls: lock (refuses edits), hide (excludes from render), mute (excludes from
 *   the audio mix), and lane height.
 * - Multi-layer compositing resolver (sorts visible clips ascending by layer.number, stable within
 *   a layer) and the matching audio resolver that honours mute.
 */

import type { LayeredFilm, Layer, Clip } from "../../src/dl/layeredSchema";
import {
  type UpdateAction,
  generateUUID,
} from "./updates";

/**
 * Add a new user-created layer to the film (U-2).
 */
export function addLayer(
  film: LayeredFilm,
  label: string,
  targetNumber?: number
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string; newLayerId: string } {
  const newLayers = JSON.parse(JSON.stringify(film.layers)) as Layer[];
  const existingNumbers = new Set(newLayers.map((l) => l.number));

  let layerNum = Math.min(100, targetNumber ?? Math.max(0, ...newLayers.map((l) => l.number)) + 10);
  while (existingNumbers.has(layerNum) && layerNum < 100) {
    layerNum += 1;
  }
  // When the top of the range is taken, fall back to the first free slot from the bottom.
  while (existingNumbers.has(layerNum) && layerNum > 0) {
    layerNum -= 1;
  }
  if (existingNumbers.has(layerNum)) {
    throw new Error("Cannot add another layer: all 101 z-order slots are in use");
  }

  const slug = label.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 16);
  const newLayerId = `layer-${slug}-${generateUUID().slice(0, 4)}`;

  const newLayer: Layer = {
    id: newLayerId,
    number: layerNum,
    label,
    locked: false,
    hidden: false,
    muted: false,
    height: 56,
  };

  newLayers.push(newLayer);
  const txId = generateUUID();

  const actions: UpdateAction[] = [
    {
      type: "insert",
      path: ["layers", newLayers.length - 1],
      oldValue: null,
      newValue: newLayer,
      transactionId: txId,
      label: `Add layer "${label}"`,
      timestamp: Date.now(),
    },
  ];

  return {
    film: { ...film, layers: newLayers },
    actions,
    transactionId: txId,
    newLayerId,
  };
}

/**
 * Delete a layer and all clips residing on it.
 */
export function deleteLayer(
  film: LayeredFilm,
  layerId: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  if (film.layers.length <= 1) {
    throw new Error("Cannot delete the only remaining layer in the film");
  }

  const layerIdx = film.layers.findIndex((l) => l.id === layerId);
  if (layerIdx === -1) {
    throw new Error(`Layer "${layerId}" not found`);
  }

  const deletedLayer = film.layers[layerIdx];
  const newLayers = film.layers.filter((l) => l.id !== layerId);
  const newClips = film.clips.filter((c) => c.layerId !== layerId);
  const txId = generateUUID();

  const actions: UpdateAction[] = [
    {
      type: "delete",
      path: ["layers", layerIdx],
      oldValue: deletedLayer,
      newValue: null,
      transactionId: txId,
      label: `Delete layer "${deletedLayer.label}"`,
      timestamp: Date.now(),
    },
  ];

  return {
    film: { ...film, layers: newLayers, clips: newClips },
    actions,
    transactionId: txId,
  };
}

/**
 * Rename a layer.
 */
export function renameLayer(
  film: LayeredFilm,
  layerId: string,
  newLabel: string
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const layerIdx = film.layers.findIndex((l) => l.id === layerId);
  if (layerIdx === -1) {
    throw new Error(`Layer "${layerId}" not found`);
  }

  const newLayers = JSON.parse(JSON.stringify(film.layers)) as Layer[];
  const oldLabel = newLayers[layerIdx].label;
  newLayers[layerIdx].label = newLabel;

  const txId = generateUUID();
  const actions: UpdateAction[] = [
    {
      type: "update",
      path: ["layers", layerIdx, "label"],
      oldValue: oldLabel,
      newValue: newLabel,
      transactionId: txId,
      label: `Rename layer to "${newLabel}"`,
      timestamp: Date.now(),
    },
  ];

  return {
    film: { ...film, layers: newLayers },
    actions,
    transactionId: txId,
  };
}

/**
 * Reorder a layer's z-order number (U-3: higher number paints on top).
 */
export function reorderLayer(
  film: LayeredFilm,
  layerId: string,
  newNumber: number
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const layerIdx = film.layers.findIndex((l) => l.id === layerId);
  if (layerIdx === -1) {
    throw new Error(`Layer "${layerId}" not found`);
  }
  if (!Number.isInteger(newNumber) || newNumber < 0 || newNumber > 100) {
    throw new Error(`Reorder rejected: z-index ${newNumber} is outside the valid range 0..100`);
  }

  const newLayers = JSON.parse(JSON.stringify(film.layers)) as Layer[];
  const oldNum = newLayers[layerIdx].number;

  // Swap numbers with colliding layer if one exists
  const colliderIdx = newLayers.findIndex((l) => l.number === newNumber && l.id !== layerId);
  const actions: UpdateAction[] = [];
  const txId = generateUUID();

  if (colliderIdx !== -1) {
    const collider = newLayers[colliderIdx];
    collider.number = oldNum;
    actions.push({
      type: "update",
      path: ["layers", colliderIdx, "number"],
      oldValue: newNumber,
      newValue: oldNum,
      transactionId: txId,
      label: `Reorder layer "${collider.label}" to z-index ${oldNum}`,
      timestamp: Date.now(),
    });
  }

  newLayers[layerIdx].number = newNumber;

  actions.push({
    type: "update",
    path: ["layers", layerIdx, "number"],
    oldValue: oldNum,
    newValue: newNumber,
    transactionId: txId,
    label: `Reorder layer "${newLayers[layerIdx].label}" to z-index ${newNumber}`,
    timestamp: Date.now(),
  });

  return {
    film: { ...film, layers: newLayers },
    actions,
    transactionId: txId,
  };
}

/**
 * Update layer flags: locked, hidden, muted, height.
 */
export function setLayerProperty(
  film: LayeredFilm,
  layerId: string,
  updates: Partial<Pick<Layer, "locked" | "hidden" | "muted" | "height">>
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const layerIdx = film.layers.findIndex((l) => l.id === layerId);
  if (layerIdx === -1) {
    throw new Error(`Layer "${layerId}" not found`);
  }

  const newLayers = JSON.parse(JSON.stringify(film.layers)) as Layer[];
  const layer = newLayers[layerIdx];
  const txId = generateUUID();
  const actions: UpdateAction[] = [];

  for (const [key, rawVal] of Object.entries(updates)) {
    // Lane height is clamped into the schema range so a drag cannot write an invalid film.
    const val = key === "height" ? Math.max(20, Math.min(200, Number(rawVal))) : rawVal;
    const oldVal = (layer as any)[key];
    if (oldVal === val) continue;
    (layer as any)[key] = val;
    actions.push({
      type: "update",
      path: ["layers", layerIdx, key],
      oldValue: oldVal,
      newValue: val,
      transactionId: txId,
      label: `Set layer ${layer.label} ${key}`,
      timestamp: Date.now(),
    });
  }

  return {
    film: { ...film, layers: newLayers },
    actions,
    transactionId: txId,
  };
}

/** Build a layer id to layer lookup for the composite resolvers. */
function buildLayerMap(film: LayeredFilm): Map<string, Layer> {
  const layerMap = new Map<string, Layer>();
  for (const layer of film.layers) {
    layerMap.set(layer.id, layer);
  }
  return layerMap;
}

/** True when the clip is playing at the given timeline second. */
function isClipLiveAt(clip: Clip, timeSec: number): boolean {
  const clipEnd = clip.position + (clip.end - clip.start);
  return timeSec >= clip.position && timeSec < clipEnd;
}

/**
 * Composite Resolver: Collects visible clips at a given frame, excluding hidden layers, and sorts
 * them ascending by layer.number so the topmost layer paints last. Clips sharing a layer number
 * keep their stored document order, which keeps the composite stable across re-renders.
 */
export function getRenderableClipsAtFrame(film: LayeredFilm, frame: number): Clip[] {
  const fps = film.fps || 30;
  const timeSec = frame / fps;
  const layerMap = buildLayerMap(film);

  const visible: Array<{ clip: Clip; order: number; z: number }> = [];

  film.clips.forEach((clip, order) => {
    const layer = layerMap.get(clip.layerId);
    if (!layer || layer.hidden) return; // Exclude hidden layers (L6-4)
    if (!isClipLiveAt(clip, timeSec)) return;
    visible.push({ clip, order, z: layer.number });
  });

  return visible.sort((a, b) => a.z - b.z || a.order - b.order).map((v) => v.clip);
}

/**
 * Audio Resolver: Collects audible clips at a given frame, excluding muted layers and clips whose
 * own volume is zero. Mirrors getRenderableClipsAtFrame so preview and export agree on what the
 * mute flag means.
 */
export function getAudibleClipsAtFrame(film: LayeredFilm, frame: number): Clip[] {
  const fps = film.fps || 30;
  const timeSec = frame / fps;
  const layerMap = buildLayerMap(film);

  return film.clips.filter((clip) => {
    if (clip.kind !== "audio" && clip.kind !== "video") return false;
    const layer = layerMap.get(clip.layerId);
    if (!layer || layer.muted) return false;
    if ((clip.volume ?? 1) <= 0) return false;
    return isClipLiveAt(clip, timeSec);
  });
}

/**
 * Z-order helper that moves a layer one step up or down past its nearest neighbour, swapping the
 * two stored numbers. Used by the timeline layer list so reordering never produces duplicates.
 */
export function shiftLayerOrder(
  film: LayeredFilm,
  layerId: string,
  direction: "up" | "down"
): { film: LayeredFilm; actions: UpdateAction[]; transactionId: string } {
  const layer = film.layers.find((l) => l.id === layerId);
  if (!layer) {
    throw new Error(`Layer "${layerId}" not found`);
  }

  const neighbours = film.layers
    .filter((l) => (direction === "up" ? l.number > layer.number : l.number < layer.number))
    .sort((a, b) => (direction === "up" ? a.number - b.number : b.number - a.number));

  const neighbour = neighbours[0];
  if (!neighbour) {
    return { film, actions: [], transactionId: generateUUID() };
  }

  return reorderLayer(film, layerId, neighbour.number);
}
