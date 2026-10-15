/**
 * File Description: Browser test page comparing real cel pixels: legacy stage alias, spec-built Iona, and production-rendered character stills.
 * Inputs and outputs: window.__pixelRequest (specs, actions and production PNG references) -> window.__pixels promise of pixel comparisons and PNG data URLs.
 * Used by: backend/characters/pixels.test.ts, which bundles this file with esbuild for headless Chrome. Never part of production.
 */
import { Euler, Group, NoToneMapping, OrthographicCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { createIonaArt, type IonaArt } from "../../test_fixtures/characters/iona-legacy/iona-art-v1.js";
import { addCelLights, buildCharacter } from "../../src/dl/scene/characters/build";
import { applyCharacter } from "../../src/dl/scene/characters/apply";
import { applyProp, buildProp } from "../../src/dl/scene/props/paperGlider";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import { IONA_RIG } from "../../src/dl/performance/iona";
import { CEL_TREATMENT } from "../../src/dl/scene/rigs/registry";
import { resolveCharacterSpec, type CharacterReference } from "../../src/dl/characters/resolve";
import type { CharacterSpec } from "../../src/dl/characters/schema";
import type { PerformanceState, ReceiveAction } from "../../src/dl/performance/types";

export interface PixelRequest {
  iona: { spec: CharacterSpec; action: ReceiveAction; frames: number[] };
  golden: { frame: number; dataUrl: string | null };
  cast: Array<{ id: string; stills: Array<{ format: "wide" | "reel"; rendered: string; reference: string }> }>;
  legacyAlias: { cast: CharacterReference; action: ReceiveAction; frame: number };
}
export interface PixelResult {
  ab: Array<{ frame: number; differing: number; maxDelta: number }>;
  golden: { png: string; differing: number; meanDelta: number; otherFrameDiffering: number } | null;
  goldenPng: string;
  legacyGolden: { differing: number; meanDelta: number } | null;
  cast: Array<{ id: string; format: "wide" | "reel"; coverage: number; stillDifference: number; png: string }>;
}

const SIZE = 360;

// Applies one state to the frozen legacy art exactly as the merged P0 adapter did.
function applyLegacy(art: IonaArt, state: PerformanceState): void {
  art.rig.root.position.fromArray(state.root.position);
  art.rig.root.quaternion.fromArray(state.root.rotation);
  for (const joint of IONA_RIG.joints) { art.rig[joint.id].position.fromArray(state.local[joint.id].position); art.rig[joint.id].quaternion.copy(new Quaternion(...state.local[joint.id].rotation)); }
  const swing = (names: string[], pivot: Vector3, rotation: Euler) => { for (const n of names) { const m = art.parts.meshes[n]; m.rotation.copy(rotation); m.position.copy(pivot).sub(pivot.clone().applyEuler(rotation)); } };
  const { coat, tuft, side } = state.secondary;
  for (const s of [1, -1]) swing([s === 1 ? "coatTailL" : "coatTailR"], new Vector3(0.2 * s, 0, -0.2), new Euler(coat[0] + s * 0.02, 0, s * coat[1]));
  swing(["hair_tuft", "hairHi_tuft"], new Vector3(0, 0.1, -0.55), new Euler(tuft[0], 0, tuft[1]));
  swing(["hair_sideLong", "hairHi_sideLong"], new Vector3(0.38, 0.28, 0.15), new Euler(0, 0, side[1] + side[0] * 0.5));
  const prop = art.rig.glider;
  prop.position.fromArray(state.prop.position); prop.quaternion.fromArray(state.prop.rotation); prop.scale.setScalar(state.prop.scale); prop.visible = true;
  art.setExpression(state.expression);
  art.rig.root.updateMatrixWorld(true); prop.updateMatrixWorld(true);
}

// Draws a scene and returns its RGBA pixels and PNG.
function capture(renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera, w: number, h: number): { pixels: Uint8ClampedArray; png: string } {
  renderer.setSize(w, h, false); renderer.setClearColor(0x0a0a0b, 1); renderer.render(scene, camera);
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const c = canvas.getContext("2d")!; c.drawImage(renderer.domElement, 0, 0);
  return { pixels: c.getImageData(0, 0, w, h).data, png: canvas.toDataURL("image/png") };
}

// Counts pixels whose channels differ by more than a tolerance, with the largest channel delta.
function compare(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance = 0): { differing: number; maxDelta: number; meanDelta: number } {
  let differing = 0, maxDelta = 0, sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    sum += d; maxDelta = Math.max(maxDelta, d); if (d > tolerance) differing++;
  }
  return { differing, maxDelta, meanDelta: sum / (a.length / 4) };
}

// Decodes a PNG data URL into RGBA pixels.
async function decode(dataUrl: string, w: number, h: number): Promise<Uint8ClampedArray> {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const c = canvas.getContext("2d")!; c.drawImage(img, 0, 0); return c.getImageData(0, 0, w, h).data;
}

// Runs every comparison the pixel test asserts.
async function run(request: PixelRequest): Promise<PixelResult> {
  const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: CEL_TREATMENT.antialias, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = NoToneMapping;
  const camera = new OrthographicCamera(-4.8, 4.4, 8.4, -0.8, 0.1, 100); camera.position.set(0, 0, 50); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const legacy = createIonaArt(document.createElement("canvas")), art = buildCharacter(request.iona.spec, document.createElement("canvas")), prop = buildProp("paper-glider-v1");
  const legacyScene = new Scene(), lightsA = new Group(); addCelLights(lightsA); legacyScene.add(lightsA, legacy.rig.root, legacy.rig.glider);
  const specScene = new Scene(), lightsB = new Group(); addCelLights(lightsB); specScene.add(lightsB, art.rig.root, prop.root);
  const evaluate = createPerformanceEvaluator(rigFromCharacter(request.iona.spec), request.iona.action);
  const ab: PixelResult["ab"] = [];
  let goldenPng = "", golden: PixelResult["golden"] = null, legacyGolden: PixelResult["legacyGolden"] = null, firstFrame: Uint8ClampedArray | null = null;
  for (const frame of request.iona.frames) {
    const state = evaluate(frame);
    applyLegacy(legacy, state);
    const before = capture(renderer, legacyScene, camera, SIZE, SIZE);
    applyCharacter(art, state); applyProp(prop, state);
    const after = capture(renderer, specScene, camera, SIZE, SIZE);
    const diff = compare(before.pixels, after.pixels);
    ab.push({ frame, differing: diff.differing, maxDelta: diff.maxDelta });
    firstFrame ??= after.pixels;
    if (frame === request.golden.frame) {
      goldenPng = before.png;
      if (request.golden.dataUrl) {
        const reference = await decode(request.golden.dataUrl, SIZE, SIZE), g = compare(reference, after.pixels, 24);
        // The same tolerance must reject a genuinely different picture, or the golden proves nothing.
        const other = compare(reference, firstFrame, 24);
        golden = { png: after.png, differing: g.differing / (SIZE * SIZE), meanDelta: g.meanDelta, otherFrameDiffering: other.differing / (SIZE * SIZE) };
      }
    }
  }
  const aliasCharacter = resolveCharacterSpec(request.legacyAlias.cast);
  if (!aliasCharacter) throw new Error("legacy stage cast did not resolve to a character spec");
  const aliasArt = buildCharacter(aliasCharacter, document.createElement("canvas")), aliasProp = buildProp("paper-glider-v1");
  const aliasScene = new Scene(), aliasLights = new Group(); addCelLights(aliasLights); aliasScene.add(aliasLights, aliasArt.rig.root, aliasProp.root);
  const aliasState = createPerformanceEvaluator(rigFromCharacter(aliasCharacter), request.legacyAlias.action)(request.legacyAlias.frame);
  applyCharacter(aliasArt, aliasState); applyProp(aliasProp, aliasState);
  const aliasImage = capture(renderer, aliasScene, camera, SIZE, SIZE);
  if (request.golden.dataUrl) {
    const reference = await decode(request.golden.dataUrl, SIZE, SIZE), diff = compare(reference, aliasImage.pixels, 24);
    legacyGolden = { differing: diff.differing / (SIZE * SIZE), meanDelta: diff.meanDelta };
  }
  aliasArt.dispose(); aliasProp.dispose();
  legacy.dispose(); art.dispose(); prop.dispose();
  const cast: PixelResult["cast"] = [];
  for (const entry of request.cast) {
    for (const still of entry.stills) {
      const dimensions = still.format === "wide" ? [1920, 1080] as const : [1080, 1920] as const;
      const pixels = await decode(still.rendered, dimensions[0], dimensions[1]);
      const referencePixels = await decode(still.reference, dimensions[0], dimensions[1]);
      let drawn = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 10) + Math.abs(pixels[i + 1] - 10) + Math.abs(pixels[i + 2] - 11) > 12) drawn++;
      cast.push({ id: entry.id, format: still.format, coverage: drawn / (dimensions[0] * dimensions[1]), stillDifference: compare(referencePixels, pixels, 24).differing / (dimensions[0] * dimensions[1]), png: still.rendered });
    }
  }
  renderer.dispose();
  return { ab, golden, goldenPng, legacyGolden, cast };
}

declare global { interface Window { __pixelRequest?: PixelRequest; __pixels?: Promise<PixelResult> } }
if (typeof window !== "undefined" && window.__pixelRequest) window.__pixels = run(window.__pixelRequest);
