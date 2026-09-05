/**
 * File Description: Layer Management & Dynamic Z-Ordering Engine (Phase L-6).
 * Implements user-controlled layer operations (U-2 & U-3):
 * - Adding, deleting, renaming, and reordering layers.
 * - Layer state controls: lock (refuses edits), hide (excludes from render), mute, height.
 * - Multi-layer compositing resolver (sorts visible clips ascending by layer.number).
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

  let layerNum = targetNumber ?? (Math.max(0, ...newLayers.map((l) => l.number)) + 10);
  while (existingNumbers.has(layerNum)) {
    layerNum += 1;
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

  for (const [key, val] of Object.entries(updates)) {
    const oldVal = (layer as any)[key];
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

/**
 * Composite Resolver: Collects visible clips at a given frame,
 * excluding hidden layers, and sorts them ascending by layer.number (topmost paints last).
 */
export function getRenderableClipsAtFrame(film: LayeredFilm, frame: number): Clip[] {
  const fps = film.fps || 30;
  const timeSec = frame / fps;

  // Build layer lookup
  const layerMap = new Map<string, Layer>();
  for (const layer of film.layers) {
    layerMap.set(layer.id, layer);
  }

  const visibleClips: Clip[] = [];

  for (const clip of film.clips) {
    const layer = layerMap.get(clip.layerId);
    if (!layer || layer.hidden) continue; // Exclude hidden layers (L6-4)

    const dur = clip.end - clip.start;
    const clipEnd = clip.position + dur;

    if (timeSec >= clip.position && timeSec < clipEnd) {
      visibleClips.push(clip);
    }
  }

  // Sort ascending by layer.number (higher layer paints over lower layer)
  return visibleClips.sort((a, b) => {
    const numA = layerMap.get(a.layerId)?.number ?? 0;
    const numB = layerMap.get(b.layerId)?.number ?? 0;
    return numA - numB;
  });
}
