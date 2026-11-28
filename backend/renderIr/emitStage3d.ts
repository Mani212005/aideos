/**
 * File Description: Emits the Three stage of a character film as an `aideos.render/2` `stage3d` node plus its binary mesh file. It builds each performer exactly as ThreeStage does (placement, frozen character and prop builders), evaluates the frozen performance evaluator for every sample frame, and reads back three's own local transforms, materials, lights and texture settings, so the IR carries data and never a second copy of the builders, the evaluator or the face painter. Face paint is recorded as Canvas 2D programs through a recording context and deduplicated. Nothing here draws.
 * The dots-v1 treatment (P4.4) is carried the same way: for every performer whose scene uses dots anywhere the emitter runs the real `buildDots` (as ThreeStage does), reads back from three's own objects the paper materials, the ink colours, the sort keys (three's material creation ids), the frozen Poisson sample fields (points parts) and the prop edge lines (lines parts), and writes the scene's treatment spans and each cast member's resolved treatment, so the native rasterizer never decides what a look means. A film without dots-v1 emits exactly the document it did before.
 * Inputs and outputs: a validated Three-stage scene and the number of sample frames -> the stage3d node, the mesh asset declaration and the mesh file bytes; or a list of reasons the IR cannot carry the stage.
 * Used by: backend/renderIr/emit.ts (build).
 */

import { AmbientLight, BackSide, DirectionalLight, DoubleSide, FrontSide, Group, LinearFilter, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshToonMaterial, Points, ShaderMaterial, SRGBColorSpace, type BufferGeometry, type Color, type Material, type Object3D, type Side } from "three";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import { resolveStageCharacter } from "../../src/dl/characters/resolve";
import { addCelLights, buildCharacter } from "../../src/dl/scene/characters/build";
import { applyCharacter } from "../../src/dl/scene/characters/apply";
import { paintFace, type FaceContext } from "../../src/dl/scene/characters/face";
import { applyProp, buildProp } from "../../src/dl/scene/props/paperGlider";
import { buildDots, type DotsArt } from "../../src/dl/scene/materials/dots";
import { CEL_TREATMENT } from "../../src/dl/scene/rigs/registry";
import { STAGE_CAMERA_DEPTH, STAGE_CAMERA_FAR, STAGE_CAMERA_NEAR } from "../../src/dl/scene/projection";
import type { Scene } from "../../src/dl/scene/types";
import { encodeMesh, type MeshPartData } from "./mesh";
import { ID_PATTERN, type FaceOp, type MeshAsset, type Stage3dNode, type StageMaterial } from "./schema";

/** One drawable's dots-v1 look as the schema holds it. */
type DotsLook = NonNullable<Stage3dNode["drawables"][number]["dots"]>;
/** The stage treatments by name. */
type Treatment = Stage3dNode["treatment"];

/** Where the emitter writes the stage's mesh file inside the render package. */
export const STAGE_MESH_PATH = "meshes/stage.mesh";
/** The mesh asset's id. */
export const STAGE_MESH_ID = "stage-mesh";

/** What the emitter produces for one Three stage. */
export interface EmittedStage3d {
  node: Stage3dNode;
  mesh: MeshAsset;
  meshBytes: Uint8Array;
}

/** Lists every treatment the scene uses anywhere: the scene default, its spans and each cast's own. */
export function stageTreatments(scene: Scene): string[] {
  return [...new Set([scene.treatment ?? "cel-v1", ...(scene.treatments ?? []).map((s) => s.treatment), ...(scene.cast ?? []).map((c) => c.treatment ?? "cel-v1")])];
}

/** Reasons the IR cannot carry this Three stage yet; empty means `emitStage3d` can write it. */
export function stage3dCarryReasons(scene: Scene): string[] {
  const reasons: string[] = [];
  if (!scene.performances?.length) reasons.push("a Three stage with no performances has nothing to draw");
  return reasons;
}

const ID = new RegExp(ID_PATTERN);

// Returns an IR id, refusing a name that the id pattern does not allow.
function irId(prefix: string, name: string): string {
  const out = `${prefix}.${name}`;
  if (!ID.test(out) || name === "") throw new Error(`stage object ${JSON.stringify(out)} has no usable IR id`);
  return out;
}

// Names three's face sidedness in IR words.
function sideName(s: Side): "front" | "back" | "double" {
  if (s === FrontSide) return "front";
  if (s === BackSide) return "back";
  if (s === DoubleSide) return "double";
  throw new Error(`unknown material side ${String(s)}`);
}

// Reads a material colour as three holds it (linear floats).
function rgb(c: Color): [number, number, number] {
  return [c.r, c.g, c.b];
}

// Maps one three material onto the IR's closed material kinds, refusing anything the stage does not use.
function stageMaterial(material: Material, texture: string | undefined): StageMaterial {
  const offset = material.polygonOffset ? { polygonOffset: { factor: material.polygonOffsetFactor, units: material.polygonOffsetUnits } } : {};
  if (material instanceof ShaderMaterial) {
    const width = material.uniforms.w?.value as number | undefined, colour = material.uniforms.c?.value as Color | undefined;
    if (typeof width !== "number" || !colour) throw new Error("a shader material other than the ink outline is on the stage");
    return { kind: "ink", color: rgb(colour), width, side: sideName(material.side), ...offset };
  }
  if (material instanceof MeshToonMaterial) return { kind: "toon", color: rgb(material.color), side: sideName(material.side), ...offset };
  if (material instanceof MeshBasicMaterial) {
    if (material.map) {
      if (!texture) throw new Error("a textured material is not the face");
      return { kind: "face", texture, color: rgb(material.color), side: sideName(material.side), ...offset };
    }
    return { kind: "basic", color: rgb(material.color), side: sideName(material.side), ...offset };
  }
  throw new Error(`material ${material.type} is not drawn by the cel stage`);
}

/** The few CSS colour forms the face painter writes, as `#RRGGBB` plus an exact alpha. */
export function parsePaintColor(css: string): { color: string; alpha: number } {
  const s = css.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) return { color: `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`, alpha: 1 };
  if (/^#[0-9a-f]{6}$/.test(s)) return { color: s, alpha: 1 };
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(s);
  if (fn) {
    const [r, g, b] = [fn[1], fn[2], fn[3]].map(Number);
    const alpha = fn[4] === undefined ? 1 : Number(fn[4]);
    if ([r, g, b].some((v) => v > 255) || !(alpha >= 0 && alpha <= 1)) throw new Error(`face colour ${css} is out of range`);
    return { color: `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`, alpha };
  }
  throw new Error(`face colour ${css} is not a colour the IR carries`);
}

type Paint = Extract<FaceOp, { op: "fillStyle" }>["paint"];
interface RecordedGradient { x0: number; y0: number; x1: number; y1: number; stops: Array<{ offset: number; color: string; alpha: number }>; addColorStop(offset: number, color: string): void }

// Turns a fill or stroke style value into an IR paint.
function paintOf(value: unknown): Paint {
  if (typeof value === "string") return { kind: "color", ...parsePaintColor(value) };
  const g = value as RecordedGradient;
  if (g && Array.isArray(g.stops)) return { kind: "linearGradient", x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, stops: g.stops.map((s) => ({ ...s })) };
  throw new Error("the face painter set a style the IR does not carry");
}

/** A Canvas 2D context that records every call the face painter makes, in order, as IR face ops. */
export class FaceRecorder implements FaceContext {
  readonly ops: FaceOp[] = [];
  private state = { fillStyle: "#000" as unknown, strokeStyle: "#000" as unknown, lineWidth: 1, lineCap: "butt", lineJoin: "miter", globalAlpha: 1 };
  get fillStyle(): unknown { return this.state.fillStyle; }
  set fillStyle(v: unknown) { this.state.fillStyle = v; this.ops.push({ op: "fillStyle", paint: paintOf(v) }); }
  get strokeStyle(): unknown { return this.state.strokeStyle; }
  set strokeStyle(v: unknown) { this.state.strokeStyle = v; this.ops.push({ op: "strokeStyle", paint: paintOf(v) }); }
  get lineWidth(): number { return this.state.lineWidth; }
  set lineWidth(v: number) { this.state.lineWidth = v; this.ops.push({ op: "lineWidth", value: v }); }
  get lineCap(): string { return this.state.lineCap; }
  set lineCap(v: string) { this.state.lineCap = v; this.ops.push({ op: "lineCap", value: v as "butt" | "round" | "square" }); }
  get lineJoin(): string { return this.state.lineJoin; }
  set lineJoin(v: string) { this.state.lineJoin = v; this.ops.push({ op: "lineJoin", value: v as "miter" | "round" | "bevel" }); }
  get globalAlpha(): number { return this.state.globalAlpha; }
  set globalAlpha(v: number) { this.state.globalAlpha = v; this.ops.push({ op: "globalAlpha", value: v }); }
  /** Records setTransform. */
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.ops.push({ op: "setTransform", args: [a, b, c, d, e, f] }); }
  /** Records fillRect. */
  fillRect(x: number, y: number, w: number, h: number): void { this.ops.push({ op: "fillRect", args: [x, y, w, h] }); }
  /** Records beginPath. */
  beginPath(): void { this.ops.push({ op: "beginPath" }); }
  /** Records moveTo. */
  moveTo(x: number, y: number): void { this.ops.push({ op: "moveTo", args: [x, y] }); }
  /** Records lineTo. */
  lineTo(x: number, y: number): void { this.ops.push({ op: "lineTo", args: [x, y] }); }
  /** Records quadraticCurveTo. */
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void { this.ops.push({ op: "quadraticCurveTo", args: [cx, cy, x, y] }); }
  /** Records bezierCurveTo. */
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void { this.ops.push({ op: "bezierCurveTo", args: [c1x, c1y, c2x, c2y, x, y] }); }
  /** Records a clockwise ellipse. */
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void { this.ops.push({ op: "ellipse", args: [x, y, rx, ry, rotation, start, end] }); }
  /** Records a clockwise arc. */
  arc(x: number, y: number, r: number, start: number, end: number): void { this.ops.push({ op: "arc", args: [x, y, r, start, end] }); }
  /** Records fill. */
  fill(): void { this.ops.push({ op: "fill" }); }
  /** Records stroke. */
  stroke(): void { this.ops.push({ op: "stroke" }); }
  /** Records clip. */
  clip(): void { this.ops.push({ op: "clip" }); }
  /** Records save. */
  save(): void { this.ops.push({ op: "save" }); }
  /** Records restore. */
  restore(): void { this.ops.push({ op: "restore" }); }
  /** Records scale. */
  scale(x: number, y: number): void { this.ops.push({ op: "scale", args: [x, y] }); }
  /** Records translate. */
  translate(x: number, y: number): void { this.ops.push({ op: "translate", args: [x, y] }); }
  /** Returns a gradient that collects its stops; it is recorded when assigned as a style. */
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): RecordedGradient {
    const g: RecordedGradient = { x0, y0, x1, y1, stops: [], addColorStop(offset, css) { g.stops.push({ offset, ...parsePaintColor(css) }); } };
    return g;
  }
}

/** One performer's private three objects, built as ThreeStage builds them. */
interface Performer {
  placement: Group;
  objects: Array<{ object: Object3D; id: string; group: string }>;
  /** The dots-v1 art of the actor and of the prop, built when the scene uses dots anywhere (as ThreeStage builds it). */
  dots?: { actor: DotsArt; prop: DotsArt };
  /** The actor's and the prop's cast ids with their own treatments (before the scene's spans). */
  casts: { actor: { id: string; treatment: Treatment }; prop: { id: string; treatment: Treatment } };
  evaluate: ReturnType<typeof createPerformanceEvaluator>;
  art: ReturnType<typeof buildCharacter>;
  prop: ReturnType<typeof buildProp>;
  face: { id: string; size: number; paint: (values: ReturnType<ReturnType<typeof buildCharacter>["setExpression"]>) => FaceOp[] };
  dispose: () => void;
}

// Builds one performer's graph and lists its objects in traversal order (parents first) with their IR ids.
function buildPerformer(scene: Scene, performance: NonNullable<Scene["performances"]>[number]): Performer {
  const actor = scene.cast?.find((c) => c.id === performance.actor);
  const resolved = actor?.kind === "character" ? resolveStageCharacter(actor) : undefined;
  if (!resolved) throw new Error(`performance ${performance.id}: missing character ${performance.actor}`);
  const propCast = scene.cast?.find((c) => c.id === performance.prop);
  if (!propCast || propCast.kind !== "prop") throw new Error(`performance ${performance.id}: missing prop ${performance.prop}`);
  const { cast, spec } = resolved;
  const art = buildCharacter(spec);
  const prop = buildProp(propCast.asset);
  const placement = new Group();
  placement.name = "placement";
  placement.position.set(cast.position[0] - scene.sceneSize.w / 2, scene.sceneSize.h / 2 - cast.position[1], cast.depth);
  placement.scale.setScalar(cast.unitsToStage);
  placement.add(art.rig.root, prop.root);
  const objects: Performer["objects"] = [];
  const propObjects = new Set<Object3D>();
  prop.root.traverse((o) => propObjects.add(o));
  // A joint and a part may share a name (the head joint carries the head part), so meshes and groups have their own id spaces.
  placement.traverse((o) => objects.push({ object: o, id: irId(`${propObjects.has(o) ? propCast.id : cast.id}.${o instanceof Mesh ? "mesh" : "group"}`, o.name), group: propObjects.has(o) ? propCast.id : cast.id }));
  const seen = new Set<string>();
  for (const { id } of objects) {
    if (seen.has(id)) throw new Error(`stage object id ${id} is used twice`);
    seen.add(id);
  }
  // The same condition and the same calls as ThreeStage: the dots art of both is built when any treatment of this performer or the scene is dots-v1, after the cel art and before anything draws.
  const usesDots = [cast.treatment, propCast.treatment, scene.treatment, ...(scene.treatments ?? []).map((span) => span.treatment)].includes("dots-v1");
  const faceMeshes = new Set(art.parts.resolved.filter((part) => part.geometry.kind === "head").map((part) => art.parts.meshes[part.id]));
  const dots = usesDots ? { actor: buildDots(art.rig.root, faceMeshes), prop: buildDots(prop.root, undefined, true) } : undefined;
  const sceneTreatment: Treatment = scene.treatment ?? "cel-v1";
  return {
    placement, objects, art, prop, dots,
    casts: { actor: { id: cast.id, treatment: cast.treatment ?? sceneTreatment }, prop: { id: propCast.id, treatment: propCast.treatment ?? sceneTreatment } },
    evaluate: createPerformanceEvaluator(rigFromCharacter(spec), performance.data),
    face: { id: irId(cast.id, "face"), size: spec.face.size, paint: (values) => { const r = new FaceRecorder(); paintFace(r, spec.face, spec.palette, values); return r.ops; } },
    dispose: () => { dots?.actor.dispose(); dots?.prop.dispose(); art.dispose(); prop.dispose(); },
  };
}

// Reads the creation counter three gives every material (its runtime `id`, absent from the type declarations).
function materialId(mesh: Mesh): number {
  const id = (mesh.material as unknown as { id?: unknown }).id;
  if (typeof id !== "number") throw new Error(`mesh ${mesh.name}: its material has no creation id`);
  return id;
}

// Compares two transform samples exactly (bit for bit, so 0 and -0 differ as three's arithmetic would see them).
function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/** Emits the stage3d node and its mesh file for a validated Three-stage scene, sampling frames 0 to `sampleFrames - 1`. */
export function emitStage3d(scene: Scene, sampleFrames: number, id = "stage3d"): EmittedStage3d {
  const reasons = stage3dCarryReasons(scene);
  if (reasons.length) throw new Error(reasons.join("; "));
  if (!Number.isInteger(sampleFrames) || sampleFrames < 1) throw new Error(`sampleFrames ${sampleFrames} is not a positive whole number`);
  if (CEL_TREATMENT.colorSpace !== "srgb" || CEL_TREATMENT.toneMapping !== "none") throw new Error("the cel treatment's output is not the one the IR describes");
  const performers = (scene.performances ?? []).map((p) => buildPerformer(scene, p));
  try {
    const objects = performers.flatMap((p) => p.objects);
    const parentOf = new Map(objects.map(({ object }) => [object, objects.find((o) => o.object === object.parent)?.id]));
    // Per object: every sample's position, quaternion and scale; per face: every sample's program.
    const samples = objects.map(() => ({ position: [] as number[][], quaternion: [] as number[][], scale: [] as number[] }));
    const programs: FaceOp[][] = [];
    const programIndex = new Map<string, number>();
    const faces = performers.map(() => [] as number[]);
    for (let f = 0; f < sampleFrames; f++) {
      performers.forEach((p, i) => {
        const state = p.evaluate(f);
        applyCharacter(p.art, state);
        applyProp(p.prop, state);
        const ops = p.face.paint(p.art.setExpression(state.expression));
        const key = JSON.stringify(ops);
        let index = programIndex.get(key);
        if (index === undefined) { index = programs.length; programIndex.set(key, index); programs.push(ops); }
        faces[i].push(index);
      });
      objects.forEach(({ object, id: objectId }, i) => {
        if (!object.visible) throw new Error(`stage object ${objectId} is hidden at frame ${f}; the IR draws every object`);
        const s = object.scale;
        if (!(s.x === s.y && s.y === s.z)) throw new Error(`stage object ${objectId} has a non-uniform scale`);
        samples[i].position.push(object.position.toArray());
        samples[i].quaternion.push(object.quaternion.toArray());
        samples[i].scale.push(s.x);
      });
    }
    const nodes: Stage3dNode["nodes"] = [];
    const channels: Stage3dNode["channels"] = [];
    objects.forEach(({ object, id: objectId }, i) => {
      const { position, quaternion, scale } = samples[i];
      const parent = parentOf.get(object);
      nodes.push({ id: objectId, ...(parent ? { parent } : {}), position: position[0] as [number, number, number], quaternion: quaternion[0] as [number, number, number, number], scale: scale[0] });
      const channel: Stage3dNode["channels"][number] = { node: objectId };
      if (position.some((p) => !same(p, position[0]))) channel.position = position.flat();
      if (quaternion.some((q) => !same(q, quaternion[0]))) channel.quaternion = quaternion.flat();
      if (scale.some((v) => !Object.is(v, scale[0]))) channel.scale = scale;
      if (channel.position || channel.quaternion || channel.scale) channels.push(channel);
    });

    // Every mesh owns its material, so three's opaque sort (material id first) is material creation order.
    const ids = new Map(objects.map(({ object, id: objectId }) => [object, objectId]));
    const faceOf = new Map<Mesh, string>();
    performers.forEach((p) => p.placement.traverse((o) => { if (o instanceof Mesh && o.material instanceof MeshBasicMaterial && o.material.map) faceOf.set(o, p.face.id); }));
    const meshes = objects.map(({ object }) => object).filter((o): o is Mesh => o instanceof Mesh);
    const order = [...meshes].sort((a, b) => materialId(a) - materialId(b));
    const partOf = new Map<BufferGeometry, string>();
    const parts: MeshPartData[] = [];
    const drawables: Stage3dNode["drawables"] = order.map((mesh) => {
      if (Array.isArray(mesh.material)) throw new Error(`mesh ${mesh.name} has several materials`);
      let part = partOf.get(mesh.geometry);
      if (part === undefined) {
        part = ids.get(mesh)!;
        partOf.set(mesh.geometry, part);
        parts.push(meshPart(part, mesh.geometry));
      }
      return { id: ids.get(mesh)!, node: ids.get(mesh)!, part, material: stageMaterial(mesh.material, faceOf.get(mesh)) };
    });

    // The dots-v1 looks. The cel state is read above; every key of the cel look is read before the dots art is switched on.
    const usesDots = performers.some((p) => p.dots);
    const groups: NonNullable<Stage3dNode["groups"]> = [];
    if (usesDots) {
      const celOrder = new Map(order.map((m) => [m, materialId(m)]));
      const groupOf = new Map(objects.map(({ object, group }) => [object, group]));
      const dotted = new Set<string>();
      for (const p of performers) {
        if (!p.dots) continue;
        p.dots.actor.setEnabled(true, 1080);
        p.dots.prop.setEnabled(true, 1080);
        groups.push({ id: p.casts.actor.id, treatment: p.casts.actor.treatment }, { id: p.casts.prop.id, treatment: p.casts.prop.treatment });
        for (const g of [p.casts.actor.id, p.casts.prop.id]) dotted.add(g);
      }
      const samplePart = new Map<BufferGeometry, string>();
      const edgePart = new Map<BufferGeometry, string>();
      order.forEach((mesh, i) => {
        const group = groupOf.get(mesh)!;
        const d = drawables[i];
        d.order = celOrder.get(mesh)!;
        if (!dotted.has(group)) return;
        d.group = group;
        d.dots = readDotsLook(mesh, d.id, faceOf.get(mesh), parts, samplePart, edgePart);
      });
      // three's creation ids depend on how many materials this process made before; only their order matters, so write each key's rank among all of them (the document is the same bytes in any process).
      const keys = drawables.flatMap((d) => [d.order!, d.dots?.order, d.dots?.edges?.order].filter((k): k is number => k !== undefined));
      const rank = new Map([...new Set(keys)].sort((a, b) => a - b).map((k, i) => [k, i]));
      for (const d of drawables) {
        d.order = rank.get(d.order!)!;
        if (d.dots) {
          d.dots.order = rank.get(d.dots.order)!;
          if (d.dots.edges) d.dots.edges.order = rank.get(d.dots.edges.order)!;
        }
      }
    }

    const faceTextures: Stage3dNode["faceTextures"] = performers.map((p, i) => {
      const head = [...faceOf.keys()].find((m) => faceOf.get(m) === p.face.id);
      const map = (head?.material as MeshBasicMaterial | undefined)?.map;
      if (!map) throw new Error(`performer ${p.face.id} has no face texture`);
      if (map.minFilter !== LinearFilter || map.magFilter !== LinearFilter || map.colorSpace !== SRGBColorSpace) throw new Error(`face ${p.face.id}: texture sampling is not the linear sRGB the IR describes`);
      return { id: p.face.id, size: p.face.size, flipY: map.flipY, filter: "linear", mipmaps: map.generateMipmaps, colorSpace: "srgb", programs: faces[i] };
    });

    const lights = new Group();
    addCelLights(lights);
    const sun = lights.children.find((c): c is DirectionalLight => c instanceof DirectionalLight);
    const fill = lights.children.find((c): c is AmbientLight => c instanceof AmbientLight);
    if (!sun || !fill || lights.children.length !== 2) throw new Error("the cel lights are not one directional and one ambient light");

    const meshBytes = encodeMesh(parts);
    const mesh: MeshAsset = {
      kind: "mesh", id: STAGE_MESH_ID, path: STAGE_MESH_PATH,
      parts: parts.map((p) => ({ id: p.id, ...(p.kind && p.kind !== "triangles" ? { kind: p.kind } : {}), vertices: p.positions.length / 3, indices: p.indices.length, uv: p.uvs !== undefined })),
    };
    const node: Stage3dNode = {
      kind: "stage3d",
      id,
      mesh: STAGE_MESH_ID,
      treatment: scene.treatment ?? "cel-v1",
      ...(usesDots ? { groups, ...(scene.treatments?.length ? { spans: scene.treatments.map((t) => ({ startFrame: t.startFrame, endFrame: t.endFrame, treatment: t.treatment })) } : {}) } : {}),
      projection: { cameraZ: STAGE_CAMERA_DEPTH, near: STAGE_CAMERA_NEAR, far: STAGE_CAMERA_FAR },
      lighting: {
        directional: { position: sun.position.toArray(), target: sun.target.position.toArray(), color: rgb(sun.color), intensity: sun.intensity },
        ambient: { color: rgb(fill.color), intensity: fill.intensity },
      },
      ramp: [...CEL_TREATMENT.ramp],
      output: { dpr: CEL_TREATMENT.dpr, antialias: CEL_TREATMENT.antialias, colorSpace: "srgb", toneMapping: "none", exposure: CEL_TREATMENT.exposure },
      sampleFrames,
      nodes,
      channels,
      drawables,
      faceTextures,
      facePrograms: programs.map((ops) => ({ ops })),
    };
    return { node, mesh, meshBytes };
  } finally {
    performers.forEach((p) => p.dispose());
  }
}

// Reads one mesh's dots-v1 look from three's own objects (the dots art is switched on): its paper or ink material, its sort key, its sample field and its edge lines. New parts are appended to `parts`, one per source geometry.
function readDotsLook(mesh: Mesh, drawableId: string, faceTexture: string | undefined, parts: MeshPartData[], samplePart: Map<BufferGeometry, string>, edgePart: Map<BufferGeometry, string>): DotsLook {
  const material = mesh.material;
  if (Array.isArray(material)) throw new Error(`mesh ${mesh.name} has several materials`);
  if (material instanceof ShaderMaterial) {
    const width = material.uniforms.w?.value as number | undefined, colour = material.uniforms.c?.value as Color | undefined;
    if (typeof width !== "number" || !colour) throw new Error(`mesh ${mesh.name}: a shader material other than the ink outline is on the stage`);
    return { material: { kind: "ink", color: rgb(colour), width, side: sideName(material.side) }, order: materialId(mesh) };
  }
  if (!(material instanceof MeshBasicMaterial)) throw new Error(`mesh ${mesh.name}: the dots paper is not a basic material (${material.type})`);
  const side = sideName(material.side);
  let paper: DotsLook["material"];
  if (material.map) {
    if (!faceTexture) throw new Error(`mesh ${mesh.name}: a textured dots paper is not the face`);
    paper = { kind: "faceLuma", texture: faceTexture, color: rgb(material.color), side };
  } else paper = { kind: "basic", color: rgb(material.color), side };
  const look: DotsLook = { material: paper, order: materialId(mesh) };
  const points = mesh.children.find((c): c is Points => c instanceof Points);
  if (!points || !(points.material instanceof ShaderMaterial)) throw new Error(`mesh ${mesh.name}: the dots art added no point field`);
  const u = points.material.uniforms;
  if (typeof u.tone?.value !== "number" || typeof u.faceSpan?.value !== "number" || typeof u.doubleSided?.value !== "number") throw new Error(`mesh ${mesh.name}: the dots shader uniforms are not the ones the IR carries`);
  if ((u.doubleSided.value > 0.5) !== (side === "double")) throw new Error(`mesh ${mesh.name}: the dots shader's double sided flag disagrees with the paper's side`);
  const sampled = points.geometry.getAttribute("position");
  if (u.faceSpan.value === 0 && sampled.count > 0) {
    let part = samplePart.get(mesh.geometry);
    if (part === undefined) {
      part = `${drawableId}.dots`;
      samplePart.set(mesh.geometry, part);
      parts.push(pointsPart(part, points.geometry));
    }
    look.samples = { part, tone: u.tone.value };
  }
  const lines = mesh.children.find((c): c is LineSegments => c instanceof LineSegments);
  if (lines && lines.material instanceof LineBasicMaterial && lines.geometry.getAttribute("position").count > 0) {
    let part = edgePart.get(mesh.geometry);
    if (part === undefined) {
      part = `${drawableId}.edges`;
      edgePart.set(mesh.geometry, part);
      parts.push(linesPart(part, lines.geometry));
    }
    look.edges = { part, color: rgb(lines.material.color), order: (lines.material as unknown as { id: number }).id };
  }
  return look;
}

// Copies a dot sample field (positions, normals, ranks) as a points part.
function pointsPart(id: string, geometry: BufferGeometry): MeshPartData {
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), rank = geometry.getAttribute("rank");
  for (const [name, attr, size] of [["position", position, 3], ["normal", normal, 3], ["rank", rank, 1]] as const) {
    if (!attr || attr.itemSize !== size || !(attr.array instanceof Float32Array) || attr.array.length !== attr.count * size || ("isInterleavedBufferAttribute" in attr)) throw new Error(`points ${id}: ${name} is not a plain f32 attribute`);
  }
  if (normal.count !== position.count || rank.count !== position.count) throw new Error(`points ${id}: attribute counts differ`);
  return { id, kind: "points", positions: Float32Array.from(position.array as Float32Array), normals: Float32Array.from(normal.array as Float32Array), ranks: Float32Array.from(rank.array as Float32Array), indices: new Uint32Array(0) };
}

// Copies edge line segments (pairs of end points) as a lines part.
function linesPart(id: string, geometry: BufferGeometry): MeshPartData {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3 || !(position.array instanceof Float32Array) || position.array.length !== position.count * 3 || ("isInterleavedBufferAttribute" in position) || position.count % 2 !== 0 || geometry.getIndex()) throw new Error(`lines ${id}: the edge geometry is not plain, non-indexed f32 segments`);
  return { id, kind: "lines", positions: Float32Array.from(position.array as Float32Array), normals: new Float32Array(0), indices: new Uint32Array(0) };
}

// Copies one geometry's attributes as the mesh file stores them; unindexed geometry gets sequential indices (the same triangles).
function meshPart(id: string, geometry: BufferGeometry): MeshPartData {
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
  for (const [name, attr, size] of [["position", position, 3], ["normal", normal, 3], ["uv", uv, 2]] as const) {
    if (name === "uv" && !attr) continue;
    if (!attr || attr.itemSize !== size || !(attr.array instanceof Float32Array) || attr.array.length !== attr.count * size || ("isInterleavedBufferAttribute" in attr)) throw new Error(`part ${id}: ${name} is not a plain f32 attribute`);
  }
  if (normal.count !== position.count || (uv && uv.count !== position.count)) throw new Error(`part ${id}: attribute counts differ`);
  if (geometry.morphAttributes.position || geometry.groups.length > 1) throw new Error(`part ${id}: morphs and geometry groups are not drawn by the cel stage`);
  const index = geometry.getIndex();
  const indices = index ? Uint32Array.from(index.array as ArrayLike<number>) : Uint32Array.from({ length: position.count }, (_, i) => i);
  return {
    id,
    positions: Float32Array.from(position.array as Float32Array),
    normals: Float32Array.from(normal.array as Float32Array),
    ...(uv ? { uvs: Float32Array.from(uv.array as Float32Array) } : {}),
    indices,
  };
}
