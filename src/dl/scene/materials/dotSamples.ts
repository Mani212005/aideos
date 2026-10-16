/**
 * File Description: Deterministic object-space Poisson rejection samples on arbitrary triangle meshes.
 * Inputs and outputs: BufferGeometry, spacing and seed -> stable surface positions, normals and ranks.
 * Used by: dots treatment and its sampling/pose tests; browser-safe and independent of frame time.
 */
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

/** Sampling version is frozen so different render workers build the same surface field. */
export const DOT_SAMPLING = { seed: 731, spacing: 0.026, attemptsPerSample: 16, maxSamples: 24000 } as const;

// Samples triangles by area and rejects neighbours using a spatial hash, including across triangle seams.
export function sampleDotSurface(source: BufferGeometry, spacing: number = DOT_SAMPLING.spacing, seed: number = DOT_SAMPLING.seed): BufferGeometry {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error("dot spacing must be positive and finite");
  let state = seed >>> 0;
  // Advances a private integer PRNG without touching global randomness.
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const position = source.getAttribute("position"), normal = source.getAttribute("normal"), index = source.index;
  const triangles: Array<{ ids: number[]; area: number }> = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let area = 0;
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const ids = [0, 1, 2].map((j) => index ? index.getX(i + j) : i + j);
    a.fromBufferAttribute(position, ids[0]); b.fromBufferAttribute(position, ids[1]); c.fromBufferAttribute(position, ids[2]);
    const size = b.sub(a).cross(c.sub(a)).length() / 2;
    if (size > 1e-12) { area += size; triangles.push({ ids, area }); }
  }
  const positions: number[] = [], normals: number[] = [], ranks: number[] = [];
  const cells = new Map<string, Vector3[]>(), point = new Vector3(), n = new Vector3();
  const target = Math.min(DOT_SAMPLING.maxSamples, Math.ceil(area / (spacing * spacing)));
  for (let attempt = 0; attempt < target * DOT_SAMPLING.attemptsPerSample && ranks.length < target; attempt++) {
    const choice = random() * area;
    let lo = 0, hi = triangles.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (choice < triangles[mid].area) hi = mid; else lo = mid + 1; }
    const triangle = triangles[lo];
    if (!triangle) break;
    const u = Math.sqrt(random()), v = random(), weights = [1 - u, u * (1 - v), u * v];
    point.set(0, 0, 0); n.set(0, 0, 0);
    triangle.ids.forEach((id, j) => {
      point.addScaledVector(a.fromBufferAttribute(position, id), weights[j]);
      n.addScaledVector(a.fromBufferAttribute(normal, id), weights[j]);
    });
    const x = Math.floor(point.x / spacing), y = Math.floor(point.y / spacing), z = Math.floor(point.z / spacing);
    let accepted = true;
    for (let dx = -1; dx <= 1 && accepted; dx++) for (let dy = -1; dy <= 1 && accepted; dy++) for (let dz = -1; dz <= 1 && accepted; dz++) {
      for (const other of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) if (point.distanceToSquared(other) < spacing * spacing) { accepted = false; break; }
    }
    if (!accepted) continue;
    const key = `${x},${y},${z}`, bucket = cells.get(key) ?? [];
    bucket.push(point.clone()); cells.set(key, bucket);
    positions.push(point.x, point.y, point.z); n.normalize(); normals.push(n.x, n.y, n.z); ranks.push(random());
  }
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(positions, 3));
  result.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  result.setAttribute("rank", new Float32BufferAttribute(ranks, 1));
  return result;
}
