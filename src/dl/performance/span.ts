/**
 * File Description: Offsets every timed receive channel into an absolute film span.
 * Inputs and outputs: local receive and start frame -> independent absolute receive.
 * Used by: backend/performance/bindReceive.ts and span regression tests.
 */
import type { ReceiveAction, VectorTrack } from "./types";

// Shifts all time-bearing fields without changing pose, duration or input data.
export function shiftReceive(action: ReceiveAction, startFrame: number): ReceiveAction {
  if (!Number.isInteger(startFrame) || startFrame < 0) throw new Error("Receive start must be a nonnegative integer frame.");
  // Copies a sparse channel with its keys shifted into film time.
  const track = (keys: VectorTrack): VectorTrack => keys.map((key) => ({ ...key, frame: key.frame + startFrame, value: [...key.value] }));
  // Copies all named channels using the same offset.
  const channels = (record: Readonly<Record<string, VectorTrack>>) => Object.fromEntries(Object.entries(record).map(([id, keys]) => [id, track(keys)]));
  return {
    ...structuredClone(action),
    fromFrame: action.fromFrame + startFrame,
    toFrame: action.toFrame + startFrame,
    holdFromFrame: action.holdFromFrame + startFrame,
    anchors: action.anchors.map((key) => ({ ...key, frame: key.frame + startFrame })),
    root: { position: track(action.root.position), rotation: track(action.root.rotation) },
    positions: channels(action.positions), rotations: channels(action.rotations), secondary: channels(action.secondary),
    constraints: action.constraints.map((c) => ({ ...c, target: track(c.target), pole: track(c.pole), ...(c.tipRotation ? { tipRotation: track(c.tipRotation) } : {}) })),
    expressions: action.expressions.map((key) => ({ ...key, frame: key.frame + startFrame })),
    contact: { ...structuredClone(action.contact), frame: action.contact.frame + startFrame },
  };
}
