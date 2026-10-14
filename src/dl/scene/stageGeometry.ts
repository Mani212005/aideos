/**
 * File Description: Character-independent posed mesh bounds, material declarations and sampled depth evidence.
 * Inputs and outputs: evaluated Three meshes and canonical camera pose -> projected silhouettes and explicit visibility provenance.
 * Used by: stageFacts and stage-aware design checks; never asserts final raster visibility.
 */
import { Color, Matrix4, Raycaster, Vector3, type Mesh, type Material } from "three";
import { projectStagePoint, stageViewport, STAGE_CAMERA_DEPTH, STAGE_CAMERA_FAR, STAGE_CAMERA_NEAR, type SceneRect, type StageCameraPose } from "./projection";

export interface ProjectedPart { name: string; bounds: SceneRect }
export interface DepthEvidence {
  provenance: "sampled-mesh-depth";
  tested: number;
  exposed: number;
  status: "exposed" | "occluded" | "unmeasured";
  rasterVisibility: "unmeasured";
}

// Checks ancestor visibility and actual drawable material opacity without trusting a placement anchor.
export function meshIsDrawn(mesh: Mesh): boolean {
  for (let node = mesh as Mesh | null; node; node = node.parent as Mesh | null) if (!node.visible) return false;
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((m) => m.visible && (!m.transparent || m.opacity > 0.02));
}

// Measures every posed vertex plus conservative normal-extrusion allowance through the shared projector.
export function projectMeshParts(meshes: Mesh[], pose: StageCameraPose, width: number, height: number, size: { w: number; h: number }, outline: number): ProjectedPart[] {
  const point = new Vector3();
  const scale = new Vector3();
  return meshes.filter(meshIsDrawn).map((mesh) => {
    const vertices = mesh.geometry.getAttribute("position");
    if (!vertices?.count) throw new Error(`mesh ${mesh.name || mesh.uuid}: missing position geometry`);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < vertices.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      const depth = STAGE_CAMERA_DEPTH - point.z;
      if (!Number.isFinite(depth) || depth < STAGE_CAMERA_NEAR || depth > STAGE_CAMERA_FAR) throw new Error(`mesh ${mesh.name || mesh.uuid}: geometry crosses the orthographic depth clip`);
      const p = projectStagePoint({ x: point.x + size.w / 2, y: size.h / 2 - point.y }, pose, width, height, size);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error(`mesh ${mesh.name || mesh.uuid}: non-finite evaluated geometry`);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    mesh.getWorldScale(scale);
    const allowance = outline * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) * pose.zoom * stageViewport(width, height, size).fit;
    return { name: mesh.name, bounds: { x0: x0 - allowance, y0: y0 - allowance, x1: x1 + allowance, y1: y1 + allowance } };
  });
}

// Returns the complete silhouette extent, or null when the object has no drawable geometry.
export function unionPartBounds(parts: ProjectedPart[]): SceneRect | null {
  if (!parts.length) return null;
  return { x0: Math.min(...parts.map((p) => p.bounds.x0)), y0: Math.min(...parts.map((p) => p.bounds.y0)), x1: Math.max(...parts.map((p) => p.bounds.x1)), y1: Math.max(...parts.map((p) => p.bounds.y1)) };
}

// Tests reproducible surface samples against the actual shared depth geometry; this is weaker than raster evidence.
export function sampleMeshDepth(subject: Mesh[], stageMeshes: Mesh[]): DepthEvidence {
  const own = new Set(subject);
  const ray = new Raycaster(), point = new Vector3();
  const all = stageMeshes.filter(meshIsDrawn);
  let tested = 0, exposed = 0, ambiguous = false;
  for (const mesh of subject.filter(meshIsDrawn)) {
    const vertices = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index;
    const triangles = Math.floor((index?.count ?? vertices.count) / 3);
    for (let i = 0; i < triangles; i += Math.max(1, Math.floor(triangles / 16))) {
      point.set(0, 0, 0);
      for (let j = 0; j < 3; j++) point.add(mesh.getVertexPosition(index ? index.getX(i * 3 + j) : i * 3 + j, new Vector3()));
      point.divideScalar(3).applyMatrix4(mesh.matrixWorld);
      ray.set(new Vector3(point.x, point.y, 100000), new Vector3(0, 0, -1));
      const hits = ray.intersectObjects(all, false);
      // Surface-edge samples without a self hit cannot establish occlusion.
      if (!hits.some((h) => own.has(h.object as Mesh))) continue;
      tested++;
      if (hits.length && own.has(hits[0].object as Mesh)) exposed++;
      else if (hits.length) {
        const blocker = hits[0].object as Mesh;
        const materials = Array.isArray(blocker.material) ? blocker.material : [blocker.material];
        if (materials.some((m) => m.transparent || m.alphaTest > 0)) ambiguous = true;
      }
    }
  }
  return { provenance: "sampled-mesh-depth", tested, exposed, status: exposed ? "exposed" : tested === 0 || ambiguous ? "unmeasured" : "occluded", rasterVisibility: "unmeasured" };
}

// Checks finite declared base/outline shader colors rather than treating all Three colors as exempt.
export function undeclaredMaterialColours(meshes: Mesh[], declared: readonly string[]): string[] {
  const allowed = new Set(declared.map((c) => new Color(c).getHexString()));
  const findings = new Set<string>();
  for (const mesh of meshes) for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
    const m = material as Material & { color?: Color; uniforms?: Record<string, { value: unknown }> };
    const colours = [m.color, ...Object.values(m.uniforms ?? {}).map((u) => u.value).filter((v): v is Color => v instanceof Color)].filter((v): v is Color => v instanceof Color);
    for (const color of colours) if (!allowed.has(color.getHexString())) findings.add(`${mesh.name}: #${color.getHexString()}`);
  }
  return [...findings];
}

// Builds a placement matrix for numerical geometry tests without adding an alternate projection path.
export function stagePlacement(x: number, y: number, depth: number, units: number, size: { w: number; h: number }): Matrix4 {
  return new Matrix4().makeTranslation(x - size.w / 2, size.h / 2 - y, depth).multiply(new Matrix4().makeScale(units, units, units));
}
