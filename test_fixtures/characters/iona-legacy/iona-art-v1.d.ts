/**
 * File Description: Typed boundary for the frozen procedural Iona art asset.
 * Inputs and outputs: optional face canvas -> typed independent art instance.
 * Used by: Iona adapter and geometry measurement.
 */
import type { BufferGeometry, Group, Mesh, ShaderMaterial } from "three";
import type { ExpressionBlend } from "../../../src/dl/performance/types";
export interface IonaArt {
  rig: Record<string, Group>;
  parts: { meshes: Record<string, Mesh>; geometries: BufferGeometry[]; inks: Array<[ShaderMaterial, number]> };
  palette: Record<string, number>;
  dispose: () => void;
  setExpression: (expression: ExpressionBlend) => void;
}
// Creates geometry and private textures for one actor; absent canvas permits CPU geometry measurements.
export function createIonaArt(faceCanvas?: HTMLCanvasElement): IonaArt;
