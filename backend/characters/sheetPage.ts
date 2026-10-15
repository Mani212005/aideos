/**
 * File Description: Browser entry that renders a character's model sheet, expression sheet and receive stills with the stage's own builder, cel treatment and projection.
 * Inputs and outputs: window.__sheetRequest (spec, retargeted receive, placement) -> window.__sheet promise of named PNG data URLs.
 * Used by: backend/characters/sheet.ts, which bundles this file with esbuild into a static page for headless Chrome.
 */
import { Box3, Group, MeshBasicMaterial, NoToneMapping, OrthographicCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Material } from "three";
import { buildCharacter, addCelLights, type CharacterArt } from "../../src/dl/scene/characters/build";
import { applyCharacter } from "../../src/dl/scene/characters/apply";
import { applyProp, buildProp } from "../../src/dl/scene/props/paperGlider";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import { characterRigId } from "../../src/dl/characters/hash";
import { stageViewport, SCENE_SIZE } from "../../src/dl/scene/projection";
import { CEL_TREATMENT } from "../../src/dl/scene/rigs/registry";
import type { CharacterSpec } from "../../src/dl/characters/schema";
import type { ReceiveAction } from "../../src/dl/performance/types";

export interface SheetRequest {
  spec: CharacterSpec;
  /** Retargeted receive, or null when the character cannot perform it. */
  action: ReceiveAction | null;
  placement: { position: [number, number]; unitsToStage: number };
  hashStatus: string;
}
export interface SheetImage { name: string; width: number; height: number; dataUrl: string }

const PAPER = "#e9e2d2", INK = "#101826", CANVAS = 0x0a0a0b;

// Creates one drawing-buffer-preserving renderer with the stage's colour pipeline.
function createRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: CEL_TREATMENT.antialias, preserveDrawingBuffer: true, alpha: true });
  renderer.setPixelRatio(CEL_TREATMENT.dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  return renderer;
}

// Renders a scene through an orthographic camera into a w x h canvas.
function draw(renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera, w: number, h: number, clear: number | null): HTMLCanvasElement {
  renderer.setSize(w, h, false);
  renderer.setClearColor(clear ?? 0, clear === null ? 0 : 1);
  renderer.render(scene, camera);
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  out.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
  return out;
}

// Frames a world-space box in an orthographic camera looking down -z, keeping the tile's aspect.
function frameBox(center: Vector3, halfHeight: number, w: number, h: number): OrthographicCamera {
  const halfWidth = halfHeight * w / h;
  const camera = new OrthographicCamera(center.x - halfWidth, center.x + halfWidth, center.y + halfHeight, center.y - halfHeight, 0.1, 1000);
  camera.position.set(0, 0, 100); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return camera;
}

// Starts a labelled paper sheet canvas.
function sheetCanvas(w: number, h: number, title: string, subtitle: string): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
  c.fillStyle = INK; c.font = "600 30px ui-monospace, Menlo, monospace"; c.fillText(title, 32, 50);
  c.font = "18px ui-monospace, Menlo, monospace"; c.globalAlpha = .7; c.fillText(subtitle, 32, 80); c.globalAlpha = 1;
  return c;
}

// Converts a canvas into a named PNG image record.
const image = (name: string, canvas: HTMLCanvasElement): SheetImage => ({ name, width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL("image/png") });

// Renders front, three-quarter, side (and back) views plus a silhouette at one shared scale.
function modelSheet(renderer: WebGLRenderer, art: CharacterArt, request: SheetRequest): SheetImage {
  const { spec } = request;
  const scene = new Scene(), lights = new Group(); addCelLights(lights); scene.add(lights, art.rig.root);
  art.setExpression("neutral");
  const views: Array<[string, number, boolean]> = [["front", spec.views.front, false], ["three-quarter", spec.views.threequarter, false], ["side", spec.views.side, false], ...(spec.views.back !== undefined ? [["back", spec.views.back, false] as [string, number, boolean]] : []), ["silhouette", spec.views.threequarter, true]];
  const box = new Box3();
  for (const [, yaw] of views) { art.rig.root.rotation.set(0, yaw, 0); art.rig.root.updateMatrixWorld(true); box.union(new Box3().setFromObject(art.rig.root)); }
  const size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
  const tileW = 520, tileH = 820, top = 110;
  const c = sheetCanvas(tileW * views.length, top + tileH + 60, `${spec.name}  model sheet`, `${characterRigId(spec)}  ${request.hashStatus}  height ${size.y.toFixed(2)} units`);
  const silhouette = new MeshBasicMaterial({ color: spec.silhouette.fill });
  views.forEach(([label, yaw, flat], i) => {
    art.rig.root.rotation.set(0, yaw, 0); art.rig.root.updateMatrixWorld(true);
    for (const mesh of Object.values(art.parts.meshes)) mesh.material = flat ? silhouette : (mesh.userData.base as Material);
    const half = size.y * 0.56, tile = draw(renderer, scene, frameBox(center, half, tileW, tileH), tileW, tileH, null);
    const x = i * tileW, feet = top + (center.y + half - box.min.y) / (2 * half) * tileH, pixelsPerUnit = tileH / (2 * half);
    c.fillStyle = "rgba(16,24,38,0.12)"; c.beginPath(); c.ellipse(x + tileW / 2, feet, Math.min(tileW * 0.45, size.x * 0.4 * pixelsPerUnit), 12, 0, 0, Math.PI * 2); c.fill();
    c.drawImage(tile, x, top);
    c.fillStyle = INK; c.font = "600 18px ui-monospace, Menlo, monospace"; c.fillText(label.toUpperCase(), x + 24, top + tileH + 36);
  });
  for (const mesh of Object.values(art.parts.meshes)) mesh.material = mesh.userData.base as Material;
  silhouette.dispose();
  art.rig.root.rotation.set(0, 0, 0);
  scene.remove(art.rig.root);
  return image("model-sheet", c.canvas);
}

// Renders a head close-up for every expression preset the character defines.
function expressionSheet(renderer: WebGLRenderer, art: CharacterArt, request: SheetRequest): SheetImage {
  const { spec } = request;
  const scene = new Scene(), lights = new Group(); addCelLights(lights); scene.add(lights, art.rig.root);
  art.rig.root.rotation.set(0, spec.views.threequarter * 0.45, 0); art.rig.root.updateMatrixWorld(true);
  const head = art.parts.resolved.find((p) => p.geometry.kind === "head")!;
  // Frame from the chin to the top of everything riding on the head joint (hair, hats), centred on the face.
  const headBox = new Box3().setFromObject(art.parts.meshes[head.id]);
  const crown = new Box3().setFromObject(art.rig[head.joint]);
  const chin = headBox.min.y, crownTop = crown.max.y, half = (crownTop - chin) * 0.56;
  const center = new Vector3(headBox.getCenter(new Vector3()).x, (crownTop + chin) / 2 - (crownTop - chin) * 0.04, 0);
  const names = Object.keys(spec.expressions), tile = 420, top = 110;
  const c = sheetCanvas(tile * names.length, top + tile + 60, `${spec.name}  expressions`, `${characterRigId(spec)}  ${names.length} presets, painted face texture`);
  names.forEach((name, i) => {
    art.setExpression(name);
    c.drawImage(draw(renderer, scene, frameBox(center, half, tile, tile), tile, tile, null), i * tile, top);
    c.fillStyle = INK; c.font = "600 18px ui-monospace, Menlo, monospace"; c.fillText(name.toUpperCase(), i * tile + 24, top + tile + 36);
  });
  art.setExpression("neutral");
  art.rig.root.rotation.set(0, 0, 0);
  scene.remove(art.rig.root);
  return image("expression-sheet", c.canvas);
}

// Renders the retargeted receive on the stage projection: wide and reel at contact, and a six-phase strip.
function receiveStills(renderer: WebGLRenderer, art: CharacterArt, request: SheetRequest): SheetImage[] {
  const action = request.action!;
  const evaluate = createPerformanceEvaluator(rigFromCharacter(request.spec), action);
  const prop = buildProp("paper-glider-v1");
  const scene = new Scene(), root = new Group(), placement = new Group();
  addCelLights(root);
  const [px, py] = request.placement.position, units = request.placement.unitsToStage;
  placement.position.set(px - SCENE_SIZE.w / 2, SCENE_SIZE.h / 2 - py, 0);
  placement.scale.setScalar(units);
  placement.add(art.rig.root, prop.root); root.add(placement); scene.add(root);
  // Poses one absolute frame exactly as the stage does.
  const pose = (frame: number) => { const state = evaluate(frame); applyCharacter(art, state); applyProp(prop, state); scene.updateMatrixWorld(true); return state; };
  const stageCamera = (w: number, h: number) => {
    const vp = stageViewport(w, h);
    const camera = new OrthographicCamera(-vp.halfWidth, vp.halfWidth, vp.halfHeight, -vp.halfHeight, 0.1, 10000);
    camera.position.set(0, 0, 2000); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    return camera;
  };
  const out: SheetImage[] = [];
  pose(action.contact.frame);
  for (const [name, w, h] of [["receive-wide", 1920, 1080], ["receive-reel", 1080, 1920]] as const) out.push(image(name, draw(renderer, scene, stageCamera(w, h), w, h, CANVAS)));
  const tile = 560, top = 110;
  const c = sheetCanvas(tile * action.anchors.length, top + tile + 60, `${request.spec.name}  receive-v1`, `retargeted onto ${action.rigId}; contact at frame ${action.contact.frame}`);
  const box = new Box3();
  for (const anchor of action.anchors) { pose(anchor.frame); box.union(new Box3().setFromObject(placement)); }
  const center = box.getCenter(new Vector3()), half = Math.max(box.getSize(new Vector3()).y, box.getSize(new Vector3()).x) * 0.54;
  action.anchors.forEach((anchor, i) => {
    pose(anchor.frame);
    const strip = draw(renderer, scene, frameBox(center, half, tile, tile), tile, tile, CANVAS);
    c.drawImage(strip, i * tile, top);
    c.fillStyle = INK; c.font = "600 18px ui-monospace, Menlo, monospace"; c.fillText(`${anchor.phase.toUpperCase()}  f${Math.round(anchor.frame)}`, i * tile + 24, top + tile + 36);
  });
  out.push(image("receive-strip", c.canvas));
  placement.remove(art.rig.root);
  prop.dispose();
  return out;
}

// Renders every sheet for the requested character and resolves with their PNGs.
async function renderSheets(request: SheetRequest): Promise<SheetImage[]> {
  const renderer = createRenderer();
  const art = buildCharacter(request.spec, document.createElement("canvas"));
  try {
    const images = [modelSheet(renderer, art, request), expressionSheet(renderer, art, request)];
    if (request.action) images.push(...receiveStills(renderer, art, request));
    return images;
  } finally {
    art.dispose();
    renderer.dispose();
  }
}

declare global { interface Window { __sheetRequest?: SheetRequest; __sheet?: Promise<SheetImage[]> } }
if (typeof window !== "undefined" && window.__sheetRequest) window.__sheet = renderSheets(window.__sheetRequest);
