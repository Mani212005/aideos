/**
 * File Description: Builds one independent cel-shaded character instance from its aideos.character/1 spec.
 * Inputs and outputs: validated CharacterSpec and optional face canvas -> named joint groups, meshes, outlines, face texture and disposal.
 * Used by: ThreeStage, stage facts (CPU geometry without a canvas), the character sheet page and character tests.
 */
import {
  AmbientLight, BackSide, BufferGeometry, CanvasTexture, Color, DataTexture, DirectionalLight, DoubleSide, FrontSide, Group, LinearFilter,
  Mesh, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RGBAFormat, ShaderMaterial, SRGBColorSpace, Texture, type Material,
} from "three";
import { expandParts, type ResolvedPart } from "../../characters/expand";
import { characterJoints } from "../../characters/rig";
import type { CharacterSpec } from "../../characters/schema";
import type { ExpressionBlend } from "../../performance/types";
import { CEL_TREATMENT } from "../rigs/registry";
import { addHeadUv, facetsGeometry, panelGeometry, tubeGeometry } from "./geometry";
import { faceValues, paintFace, type FaceValues } from "./face";

/** One character's private Three resources. Never share an instance between characters or contexts. */
export interface CharacterArt {
  spec: CharacterSpec;
  rig: Record<string, Group>;
  parts: { meshes: Record<string, Mesh>; geometries: BufferGeometry[]; inks: Array<[ShaderMaterial, number]>; resolved: ResolvedPart[] };
  palette: Record<string, number>;
  dispose: () => void;
  setExpression: (expression: ExpressionBlend | string) => FaceValues;
}

// Creates the treatment's restrained three-band toon gradient texture.
export function celRamp(): DataTexture {
  const [a, b, c] = CEL_TREATMENT.ramp;
  const t = new DataTexture(new Uint8Array([a, a, a, 255, b, b, b, 255, c, c, c, 255]), 3, 1, RGBAFormat);
  t.minFilter = t.magFilter = NearestFilter; t.needsUpdate = true; return t;
}

// Builds the normal-extruded backface ink outline material.
export function inkMaterial(width: number, color: number): ShaderMaterial {
  return new ShaderMaterial({ side: BackSide, uniforms: { w: { value: width }, c: { value: new Color(color) } },
    vertexShader: "uniform float w; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * w, 1.0); }",
    fragmentShader: "uniform vec3 c;\nvoid main(){\n gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}" });
}

// Adds the treatment's fixed key and fill lights to a host group.
export function addCelLights(host: Group): void {
  const sun = new DirectionalLight(0xffffff, CEL_TREATMENT.directionalIntensity);
  sun.position.set(3, 6, 5);
  host.add(sun, new AmbientLight(0xffffff, CEL_TREATMENT.ambientIntensity));
}

// Builds a primitive's geometry.
function geometryFor(part: ResolvedPart, faceSpan: number): BufferGeometry {
  const g = part.geometry;
  if (g.kind === "panel") return panelGeometry(g.surface, g.a, g.b, g.lift, g.steps);
  if (g.kind === "facets") return facetsGeometry(g.triangles);
  const tube = tubeGeometry(g.points, g.radii, g.origin, g.segments, g.radial, g.caps);
  return g.kind === "head" ? addHeadUv(tube, faceSpan) : tube;
}

// Creates geometry, materials and a private face texture for one character; an absent canvas permits CPU-only measurement.
export function buildCharacter(spec: CharacterSpec, faceCanvas?: HTMLCanvasElement): CharacterArt {
  const palette = Object.fromEntries(Object.entries(spec.palette).map(([token, hex]) => [token, parseInt(hex.slice(1), 16)]));
  const fc = faceCanvas;
  if (fc) fc.width = fc.height = spec.face.size;
  const fx = fc?.getContext("2d") ?? undefined;
  const tex = fc ? new CanvasTexture(fc) : new Texture();
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  const ramp = celRamp();
  const rig: Record<string, Group> = {};
  const root = rig.root = new Group(); root.name = "root";
  for (const joint of characterJoints(spec)) {
    const group = new Group(); group.name = joint.id; group.position.set(joint.offset[0], joint.offset[1], joint.offset[2]);
    (joint.parent === null ? root : rig[joint.parent]).add(group);
    rig[joint.id] = group;
  }
  const { parts: resolved } = expandParts(spec);
  const parts: CharacterArt["parts"] = { meshes: {}, geometries: [], inks: [], resolved };
  const inkColor = palette[spec.outline.color];
  for (const part of resolved) {
    const geometry = geometryFor(part, spec.face.span);
    const side = part.doubleSided ? DoubleSide : FrontSide;
    let material: Material;
    if (part.geometry.kind === "head") material = new MeshBasicMaterial({ map: tex });
    else if (part.shading === "flat") material = new MeshBasicMaterial({ color: palette[part.material!], side });
    else material = new MeshToonMaterial({ color: palette[part.material!], gradientMap: ramp, side });
    const mesh = new Mesh(geometry, material); mesh.name = part.id; mesh.userData.base = material;
    rig[part.joint].add(mesh);
    if (part.ink) { const ink = inkMaterial(part.ink, inkColor), outline = new Mesh(geometry, ink); outline.name = `${part.id}Ink`; mesh.add(outline); parts.inks.push([ink, part.ink]); }
    parts.meshes[part.id] = mesh; parts.geometries.push(geometry);
  }
  const presets = spec.expressions;
  // Repaints the face from a preset name or a numeric blend {a, b, t} without touching poses or camera.
  function setExpression(expression: ExpressionBlend | string = "neutral"): FaceValues {
    const get = (name: string): FaceValues => faceValues(presets[name] ?? presets.neutral);
    const blend = typeof expression === "string" ? { a: expression, b: expression, t: 0 } : expression;
    const a = get(blend.a), b = get(blend.b ?? blend.a), w = Math.min(1, Math.max(0, blend.t ?? 0));
    const e = { o: a.o + (b.o - a.o) * w, bt: a.bt + (b.bt - a.bt) * w, br: a.br + (b.br - a.br) * w, mc: a.mc + (b.mc - a.mc) * w, mo: a.mo + (b.mo - a.mo) * w };
    if (e.mo < .02) e.mo = 0;
    if (fx) { paintFace(fx, spec.face, spec.palette, e); tex.needsUpdate = true; }
    return e;
  }
  // Releases owned geometry, materials and textures exactly once.
  function dispose(): void {
    const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
    root.traverse((o) => { if (o instanceof Mesh) { geometries.add(o.geometry); materials.add(o.material as Material); } });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    tex.dispose(); ramp.dispose();
  }
  return { spec, rig, parts, palette, dispose, setExpression };
}
