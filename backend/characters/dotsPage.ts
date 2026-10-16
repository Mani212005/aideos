/**
 * File Description: Raster evidence for dots occlusion, held poses, independent contexts and phone-scale facial features.
 * Inputs and outputs: real character spec and fitted action -> PNGs and measured equality/feature pixel counts.
 * Used by: dotsPixels.test.ts; test-only browser entry bundled with esbuild.
 */
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, NoToneMapping, OrthographicCamera, Points, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { buildCharacter, addCelLights } from "../../src/dl/scene/characters/build";
import { applyCharacter } from "../../src/dl/scene/characters/apply";
import { buildDots } from "../../src/dl/scene/materials/dots";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import type { CharacterSpec } from "../../src/dl/characters/schema";
import type { ReceiveAction } from "../../src/dl/performance/types";

export interface DotsPixelRequest { spec: CharacterSpec; action: ReceiveAction }
export interface DotsPixelResult { dots: string; cel: string; held: string[]; heldCel: string[]; repeatDifferent: number; dotPixels: number; noseLuma: number | null; motionDifferent: number; occludedDifferent: number; visibleDifferent: number; face: Array<{ feature: string; dark: number; light: number }> }

// Counts unequal RGBA bytes between actual drawing buffers.
function changed(a: Uint8ClampedArray, b: Uint8ClampedArray): number { return a.reduce((count, value, i) => count + Number(Math.abs(value - b[i]) > 1), 0); }

// Captures one private renderer's complete drawing buffer through a 2D canvas.
function capture(renderer: WebGLRenderer) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 360;
  const context = canvas.getContext("2d")!; context.drawImage(renderer.domElement, 0, 0);
  return { png: canvas.toDataURL("image/png"), pixels: context.getImageData(0, 0, 360, 360).data };
}

// Renders actual character poses and a front/back occluder with the same treatment used by production.
export function dotsPixels(request: DotsPixelRequest): DotsPixelResult {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(360, 360); renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = NoToneMapping; renderer.setClearColor(0xeeeeee);
  const scene = new Scene(), root = new Group(); addCelLights(root); scene.add(root);
  const art = buildCharacter(request.spec, document.createElement("canvas")); root.add(art.rig.root);
  const head = art.parts.resolved.find((part) => part.geometry.kind === "head")!;
  const headMesh = art.parts.meshes[head.id];
  const dots = buildDots(art.rig.root, new Set([headMesh]));
  const evaluate = createPerformanceEvaluator(rigFromCharacter(request.spec), request.action);
  applyCharacter(art, evaluate(request.action.contact.frame));
  const bounds = new Box3().setFromObject(art.rig.root), center = bounds.getCenter(new Vector3());
  const half = Math.max(bounds.getSize(new Vector3()).y, bounds.getSize(new Vector3()).x) * .56;
  const camera = new OrthographicCamera(center.x - half, center.x + half, center.y + half, center.y - half, .1, 1000);
  camera.position.z = 100; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  // Draws a fully assigned absolute pose and captures its pixels, with no clock or render-loop state.
  const draw = (frame: number, enabled = true) => { applyCharacter(art, evaluate(frame)); dots.setEnabled(enabled, 360); scene.updateMatrixWorld(true); renderer.render(scene, camera); renderer.getContext().finish(); return capture(renderer); };
  const contact = request.action.contact.frame;
  const first = draw(contact);
  // Ablates only the points so a missing dot layer cannot pass the raster checks on its opaque fill alone.
  art.rig.root.traverse((node) => { if (node instanceof Points) node.visible = false; });
  renderer.render(scene, camera); renderer.getContext().finish();
  const dotPixels = changed(first.pixels, capture(renderer).pixels);
  const cel = draw(contact, false), other = draw(contact - 25);
  draw(contact + 10); draw(0); const repeat = draw(contact);
  const face: DotsPixelResult["face"] = [];
  headMesh.geometry.computeBoundingBox();
  const z = headMesh.geometry.boundingBox!.max.z;
  for (const [feature, x, y] of [["left-eye", -request.spec.face.eyes.at[0], request.spec.face.eyes.at[1]], ["right-eye", request.spec.face.eyes.at[0], request.spec.face.eyes.at[1]], ["mouth", 0, request.spec.face.mouth.y]] as const) {
    const p = headMesh.localToWorld(new Vector3(x * request.spec.face.span, y * request.spec.face.span, z)).project(camera);
    const px = Math.round((p.x + 1) * 180), py = Math.round((1 - p.y) * 180);
    let dark = 0, light = 0;
    for (let yy = py - 3; yy <= py + 3; yy++) for (let xx = px - 3; xx <= px + 3; xx++) {
      const i = (yy * 360 + xx) * 4, luma = repeat.pixels[i] * .2126 + repeat.pixels[i + 1] * .7152 + repeat.pixels[i + 2] * .0722;
      if (luma < 110) dark++; if (luma > 180) light++;
    }
    face.push({ feature, dark, light });
  }
  const nose = art.parts.meshes.nose;
  let noseLuma: number | null = null;
  if (nose) {
    nose.geometry.computeBoundingBox();
    const point = nose.geometry.boundingBox!.getCenter(new Vector3());
    point.z = nose.geometry.boundingBox!.max.z;
    const projected = nose.localToWorld(point).project(camera);
    const i = (Math.round((1 - projected.y) * 180) * 360 + Math.round((projected.x + 1) * 180)) * 4;
    noseLuma = repeat.pixels[i] * .2126 + repeat.pixels[i + 1] * .7152 + repeat.pixels[i + 2] * .0722;
  }
  const held = Array.from({ length: 12 }, (_, i) => draw(request.action.toFrame + i).png);
  const heldCel = Array.from({ length: 12 }, (_, i) => draw(request.action.toFrame + i, false).png);
  // A fully covering opaque front plane must hide both fills and dots, while a rear plane must not.
  const blocker = new Mesh(new BoxGeometry(half * 2.1, half * 2.1, 1), new MeshBasicMaterial({ color: 0x778899 }));
  blocker.position.set(center.x, center.y, 30); scene.add(blocker);
  const front = draw(contact); art.rig.root.visible = false; const hidden = draw(contact);
  art.rig.root.visible = true; blocker.position.z = -30; const back = draw(contact);
  art.rig.root.visible = false; const backHidden = draw(contact);
  const result = { dots: first.png, cel: cel.png, held, heldCel, dotPixels, noseLuma, repeatDifferent: changed(first.pixels, repeat.pixels), motionDifferent: changed(first.pixels, other.pixels), occludedDifferent: changed(front.pixels, hidden.pixels), visibleDifferent: changed(back.pixels, backHidden.pixels), face };
  dots.dispose(); art.dispose(); blocker.geometry.dispose(); blocker.material.dispose(); renderer.dispose();
  return result;
}

declare global { interface Window { __dotsRequest?: DotsPixelRequest[]; __dotsResult?: DotsPixelResult[] } }
if (typeof window !== "undefined" && window.__dotsRequest) window.__dotsResult = window.__dotsRequest.map(dotsPixels);
