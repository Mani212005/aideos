/**
 * File Description: Procedural cel geometry primitives shared by every character: tubes, surface panels, facets and the head UV map.
 * Inputs and outputs: resolved primitive parameters -> Three.js BufferGeometry (arithmetic preserved from the approved Iona proof).
 * Used by: scene/characters/build.ts and scene/props/paperGlider.ts.
 */
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, MathUtils, Vector3 } from "three";
import type { Radius, SurfaceProfile } from "../../characters/expand";

type Num3 = readonly [number, number, number] | readonly number[];

// Builds a tapered elliptical ring-section tube along a smooth path with full-width closed end caps.
export function tubeGeometry(pts: readonly Num3[], radii: readonly Radius[], o: Num3 = [0, 0, 0], seg = 20, rad = 20, cap: readonly [number, number] = [1, 1]): BufferGeometry {
  const cv = new CatmullRomCurve3(pts.map((p) => new Vector3(p[0] - o[0], p[1] - o[1], p[2] - o[2])));
  const P: number[] = [], I: number[] = [], n = radii.length - 1;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, c = cv.getPoint(t), T = cv.getTangent(t);
    const ref = Math.abs(T.z) < .9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    const S = new Vector3().crossVectors(T, ref).normalize(), N = new Vector3().crossVectors(S, T);
    const f = t * n, k = Math.min(Math.floor(f), n - 1), w = f - k;
    const R = (q: number): number[] => ([] as number[]).concat(radii[Math.max(0, Math.min(n, q))] as number | number[]);
    const A = R(k - 1), ra = R(k), rb = R(k + 1), D = R(k + 2);
    const CR = (a: number, b: number, cc: number, d: number) => Math.max(.004, .5 * (2 * b + (cc - a) * w + (2 * a - 5 * b + 4 * cc - d) * w * w + (3 * b - a - 3 * cc + d) * w * w * w));
    const rx = CR(A[0], ra[0], rb[0], D[0]), rz = CR(A[1] ?? A[0], ra[1] ?? ra[0], rb[1] ?? rb[0], D[1] ?? D[0]), cs = i === 0 ? cap[0] : i === seg ? cap[1] : 1;
    for (let j = 0; j <= rad; j++) {
      const a = j / rad * Math.PI * 2, cx = Math.cos(a) * rx * cs, sz = Math.sin(a) * rz * cs;
      P.push(c.x + S.x * cx + N.x * sz, c.y + S.y * cx + N.y * sz, c.z + S.z * cx + N.z * sz);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
  for (const [ri, e, pt] of [[0, 0, cv.getPoint(0)], [seg, 1, cv.getPoint(1)]] as Array<[number, number, Vector3]>) {
    const ci = P.length / 3; P.push(pt.x, pt.y, pt.z);
    for (let j = 0; j <= rad; j++) { const q = (ri * (rad + 1) + j) * 3; P.push(P[q], P[q + 1], P[q + 2]); }
    for (let j = 0; j < rad; j++) { if (e) I.push(ci, ci + 2 + j, ci + 1 + j); else I.push(ci, ci + 1 + j, ci + 2 + j); }
  }
  const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
  const nm = g.attributes.normal;
  for (let i = 0; i <= seg; i++) { const a = i * (rad + 1), b = a + rad, v = new Vector3(nm.getX(a) + nm.getX(b), nm.getY(a) + nm.getY(b), nm.getZ(a) + nm.getZ(b)).normalize(); nm.setXYZ(a, v.x, v.y, v.z); nm.setXYZ(b, v.x, v.y, v.z); }
  return g;
}

// Adds the head's planar front UV map (x / span + 0.5, y / span + 0.5) so the painted face lands on the sculpted surface.
export function addHeadUv(geometry: BufferGeometry, span = 1): BufferGeometry {
  const pa = geometry.attributes.position, uv: number[] = [];
  for (let i = 0; i < pa.count; i++) uv.push(pa.getX(i) / span + .5, pa.getY(i) / span + .5);
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return geometry;
}

// Builds a surface-hugging clothing panel between two matching edge polylines over a cross-section profile.
export function panelGeometry(surface: SurfaceProfile, A: ReadonlyArray<readonly [number, number]>, B: ReadonlyArray<readonly [number, number]>, h = .03, m = 5): BufferGeometry {
  const TY = surface.y, last = TY.length - 1;
  // Interpolates a profile half-width at a local height.
  const lerpAt = (Arr: readonly number[], y: number): number => { for (let i = 0; i < last; i++) if (y <= TY[i + 1]) return MathUtils.lerp(Arr[i], Arr[i + 1], Math.max(0, (y - TY[i]) / (TY[i + 1] - TY[i]))); return Arr[last]; };
  // Projects a front x,y point onto the profile surface with a small outward lift.
  const onSurface = (x: number, y: number, lift: number) => [x, y, Math.sqrt(Math.max(0, 1 - (x / lerpAt(surface.rx, y)) ** 2)) * lerpAt(surface.rz, y) + lift];
  const P: number[] = [], q = (a: readonly number[], b: readonly number[], u: number) => onSurface(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, h);
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < m; j++) {
    const u = j / m, v = (j + 1) / m, a = q(A[i], B[i], u), b = q(A[i], B[i], v), c = q(A[i + 1], B[i + 1], u), d = q(A[i + 1], B[i + 1], v);
    P.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
}

// Builds flat triangles from a corner list.
export function facetsGeometry(corners: readonly Num3[]): BufferGeometry {
  const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(corners.flatMap((c) => [c[0], c[1], c[2]]), 3)); g.computeVertexNormals(); return g;
}
