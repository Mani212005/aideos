/**
 * File Description: Optional surface-attached monochrome stippling for the existing posed stage meshes.
 * Inputs and outputs: character or prop mesh root -> switchable dots materials, fixed samples and owned disposal.
 * Used by: ThreeStage and character sheets. Captions and SVG planes never pass through this treatment.
 */
import { Color, DoubleSide, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshToonMaterial, Points, ShaderMaterial, type Material } from "three";
import { sampleDotSurface } from "./dotSamples";

/** Dot ink is white on a black depth surface; retained face lines and geometry outlines provide phone-scale structure. */
export const DOT_TREATMENT = { id: "dots-v1", ink: 0xffffff, paper: 0x0a0a0b, minPixels: 2, maxPixels: 4.6 } as const;

const vertexShader = `
attribute float rank;
uniform float viewportHeight;
uniform float tone;
uniform float faceSpan;
uniform float doubleSided;
varying float coverage;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec3 key = normalize(vec3(3.0, 6.0, 5.0));
  float light = dot(n, key);
  float band = light > 0.65 ? 0.25 : light > 0.1 ? 0.58 : 0.93;
  float pixelsPerUnit = viewportHeight * projectionMatrix[1][1] * length(modelMatrix[1].xyz) * 0.5;
  if (projectionMatrix[3][3] == 0.0) pixelsPerUnit /= max(0.1, -view.z);
  float lod = clamp(pixelsPerUnit / 100.0, 0.18, 1.0);
  float density = clamp((0.2 + tone * 0.45 + band * 0.4) * lod, 0.08, 1.0);
  coverage = smoothstep(rank - 0.1, rank + 0.1, density);
  // Keep the entire painted head clear: eyes and mouth stay continuous lines in every expression.
  if (faceSpan > 0.0) coverage = 0.0;
  if (doubleSided < 0.5 && dot(n, normalize(-view.xyz)) < 0.04) coverage = 0.0;
  gl_Position = projectionMatrix * view;
  // Bias in clip depth only: samples stay attached, and other surfaces still occlude them.
  gl_Position.z -= 0.000002 * gl_Position.w;
  gl_PointSize = clamp(pixelsPerUnit * 0.024, ${DOT_TREATMENT.minPixels.toFixed(1)}, ${DOT_TREATMENT.maxPixels.toFixed(1)}) * sqrt(coverage);
}`;
const fragmentShader = `
varying float coverage;
void main() {
  if (coverage < 0.005) discard;
  float r = length(gl_PointCoord - vec2(0.5));
  float edge = max(fwidth(r), 0.04);
  float alpha = 1.0 - smoothstep(0.5 - edge, 0.5, r);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0), alpha);
  #include <colorspace_fragment>
}`;

export interface DotsArt {
  setEnabled: (enabled: boolean, viewportHeight: number) => void;
  dispose: () => void;
}

// Preserves authored light flat details, including the nose, as continuous white fills with dark ink.
function keepsLightFill(material: Material | Material[]): boolean {
  return material instanceof MeshBasicMaterial && !material.map && material.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.2;
}

// Adds stable child samples to the actual meshes, leaving every original cel material recoverable.
export function buildDots(root: Group, faceMeshes: ReadonlySet<Mesh> = new Set(), propEdges = false): DotsArt {
  const entries: Array<{ mesh: Mesh; original: Material; paper: MeshBasicMaterial; points: Points; edges?: LineSegments }> = [];
  const outlines: Array<{ material: ShaderMaterial; original: Color; dots: Color }> = [];
  root.traverse((object) => {
    if (object instanceof Mesh && object.material instanceof ShaderMaterial && object.material.uniforms.c?.value instanceof Color) outlines.push({ material: object.material, original: object.material.uniforms.c.value.clone(), dots: new Color(object.parent instanceof Mesh && keepsLightFill(object.parent.material) ? 0x000000 : DOT_TREATMENT.ink) });
  });
  const meshes: Mesh[] = [];
  root.traverse((object) => { if (object instanceof Mesh && (object.material instanceof MeshBasicMaterial || object.material instanceof MeshToonMaterial)) meshes.push(object); });
  for (const mesh of meshes) {
    if (!(mesh.material instanceof MeshBasicMaterial || mesh.material instanceof MeshToonMaterial)) continue;
    const original = mesh.material;
    const lightFill = keepsLightFill(original);
    const paper = new MeshBasicMaterial({ color: faceMeshes.has(mesh) || lightFill ? 0xffffff : DOT_TREATMENT.paper, side: original.side, map: faceMeshes.has(mesh) ? original.map : null });
    if (faceMeshes.has(mesh)) {
      // Preserve dark painted features while removing chroma from the face texture.
      paper.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\nfloat luma = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722));\ndiffuseColor.rgb = vec3(smoothstep(0.06, 0.4, luma));`); };
      paper.customProgramCacheKey = () => "dots-face-v1";
    }
    const color = original.color;
    const material = new ShaderMaterial({
      uniforms: { viewportHeight: { value: 1080 }, tone: { value: 1 - color.getHSL({ h: 0, s: 0, l: 0 }).l }, faceSpan: { value: faceMeshes.has(mesh) || lightFill ? 1 : 0 }, doubleSided: { value: original.side === DoubleSide ? 1 : 0 } },
      vertexShader, fragmentShader, transparent: true, depthTest: true, depthWrite: false,
    });
    const points = new Points(sampleDotSurface(mesh.geometry), material);
    points.name = `${mesh.name}-dots`; points.renderOrder = 2; points.visible = false; points.frustumCulled = false;
    mesh.add(points);
    let edges: LineSegments | undefined;
    if (propEdges) {
      edges = new LineSegments(new EdgesGeometry(mesh.geometry, 24), new LineBasicMaterial({ color: DOT_TREATMENT.ink }));
      edges.visible = false; mesh.add(edges);
    }
    entries.push({ mesh, original, paper, points, edges });
  }
  // Switches all owned treatment state absolutely, including viewport changes and reverse shot seeks.
  function setEnabled(enabled: boolean, viewportHeight: number): void {
    for (const { mesh, original, paper, points, edges } of entries) {
      mesh.material = enabled ? paper : original;
      points.visible = enabled;
      if (points.material instanceof ShaderMaterial) points.material.uniforms.viewportHeight.value = viewportHeight;
      if (edges) edges.visible = enabled;
    }
    for (const outline of outlines) outline.material.uniforms.c.value.copy(enabled ? outline.dots : outline.original);
  }
  // Restores original resources and disposes only resources owned by the dots adapter.
  function dispose(): void {
    setEnabled(false, 1080);
    for (const { mesh, paper, points, edges } of entries) {
      mesh.remove(points); points.geometry.dispose();
      if (points.material instanceof ShaderMaterial) points.material.dispose();
      paper.dispose();
      if (edges) { mesh.remove(edges); edges.geometry.dispose(); if (edges.material instanceof LineBasicMaterial) edges.material.dispose(); }
    }
  }
  return { setEnabled, dispose };
}
