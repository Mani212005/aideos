/* File Description: Surface bound white on black dot treatment for the Iona performance; seeded build-time samples ride on the exact rig meshes.
 * Inputs and outputs: createDots(lab) takes the createProof lab and returns {setStyle(style),dispose,pointCount}; style is 'cel' or 'dots'.
 * Used by: the scratch performance module, called once after rig creation and before each render.
 */
import * as T from './three.module.min.js';

const N = 28000, MINQ = 24, BOOST = { head: 3.5 }, LD = new T.Vector3(3, 6, 5).normalize();

// Seeded mulberry32 generator.
function rng(s) { return () => { s = s + 1831565813 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Hashes a string into a seed.
function hs(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
// Computes cumulative triangle areas for an indexed or non indexed geometry.
function prep(g) {
  const p = g.attributes.position, ix = g.index, n = (ix ? ix.count : p.count) / 3 | 0, cum = new Float64Array(n), V = [new T.Vector3(), new T.Vector3(), new T.Vector3()], e = new T.Vector3(), f = new T.Vector3();
  let a = 0;
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) V[k].fromBufferAttribute(p, ix ? ix.getX(i * 3 + k) : i * 3 + k); a += e.subVectors(V[1], V[0]).cross(f.subVectors(V[2], V[0])).length() / 2; cum[i] = a; }
  return { n, cum, area: a };
}
// Spatial hash key for a grid cell; collisions only cost extra distance tests.
const key = (a, b, c) => a * 73856093 ^ b * 19349663 ^ c * 83492791;
// Area weighted dart throwing with a minimum spacing r, interpolating normals and uvs by barycentrics.
function sample(g, pr, quota, r, rnd) {
  const p = g.attributes.position, nm = g.attributes.normal, uv = g.attributes.uv, ix = g.index, o = { P: [], Nn: [], U: [], count: 0 };
  const grid = new Map(), A = [new T.Vector3(), new T.Vector3(), new T.Vector3()], B = [new T.Vector3(), new T.Vector3(), new T.Vector3()], q = new T.Vector3(), nn = new T.Vector3(), r2 = r * r, inv = 1 / r;
  for (let tries = quota * 6; tries-- > 0 && o.count < quota;) {
    const x = rnd() * pr.cum[pr.n - 1]; let lo = 0, hi = pr.n - 1;
    while (lo < hi) { const mid = lo + hi >> 1; if (pr.cum[mid] < x) lo = mid + 1; else hi = mid; }
    const id = [0, 1, 2].map(k => ix ? ix.getX(lo * 3 + k) : lo * 3 + k);
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = [1 - u - v, u, v]; q.set(0, 0, 0); nn.set(0, 0, 0); let tu = 0, tv = 0;
    for (let k = 0; k < 3; k++) {
      A[k].fromBufferAttribute(p, id[k]); q.addScaledVector(A[k], w[k]);
      if (nm) nn.addScaledVector(B[k].fromBufferAttribute(nm, id[k]), w[k]);
      if (uv) { tu += uv.getX(id[k]) * w[k]; tv += uv.getY(id[k]) * w[k]; }
    }
    if (!nm) nn.subVectors(A[1], A[0]).cross(B[0].subVectors(A[2], A[0]));
    if (nn.lengthSq() < 1e-12) nn.set(0, 1, 0); nn.normalize();
    const cx = Math.floor(q.x * inv), cy = Math.floor(q.y * inv), cz = Math.floor(q.z * inv); let ok = true;
    for (let a = -1; a < 2 && ok; a++) for (let b = -1; b < 2 && ok; b++) for (let c = -1; c < 2 && ok; c++) {
      const l = grid.get(key(cx + a, cy + b, cz + c));
      if (l) for (const j of l) { const dx = o.P[j * 3] - q.x, dy = o.P[j * 3 + 1] - q.y, dz = o.P[j * 3 + 2] - q.z; if (dx * dx + dy * dy + dz * dz < r2) { ok = false; break; } }
    }
    if (!ok) continue;
    const kk = key(cx, cy, cz); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(o.count);
    o.P.push(q.x, q.y, q.z); o.Nn.push(nn.x, nn.y, nn.z); o.U.push(tu, tv); o.count++;
  }
  return o;
}

const VS = 'uniform float uSize,uOff,uFace,uRef; uniform vec3 uL; uniform sampler2D uMap; attribute vec3 aI; varying float vA; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vec3 n=normalize(normalMatrix*normal), v=normalize(-mv.xyz); if(aI.z>.5&&dot(n,v)<0.) n=-n; float f=smoothstep(.02,.3,dot(n,v)); mv.xyz+=n*uOff; float lum=aI.y, lit=.45+.55*clamp(dot(n,uL)*.5+.5,0.,1.), d; if(uFace>.5){ vec3 c=texture2D(uMap,uv).rgb; lum=pow(dot(c,vec3(.2126,.7152,.0722)),.4545); d=smoothstep(.1,.5,lum)*(.8+.2*lit); } else d=(.2+.8*sqrt(lum))*lit; vA=f*smoothstep(aI.x-.08,aI.x+.08,d); gl_PointSize=uSize*clamp(pow(uRef/-mv.z,.35),.85,1.2); gl_Position=projectionMatrix*mv; }';
const FS = 'varying float vA; void main(){ float d=length(gl_PointCoord-.5)*2.; float a=vA*(1.-smoothstep(.4,1.,d)); if(a<.01) discard; gl_FragColor=vec4(1.,1.,1.,a); }';

// Builds all surface points once, parented to their meshes, and returns the style switch.
export function createDots(lab) {
  const { scene, camera, renderer } = lab, meshes = Object.values(lab.parts.meshes), bg0 = scene.background.clone(), hide = [];
  scene.traverse(o => { if (o.isMesh && (o.geometry.type === 'CircleGeometry' || (o.material.type === 'ShaderMaterial' && o.material.side === T.BackSide))) hide.push(o); });
  const pre = meshes.map(m => { const pr = prep(m.geometry); return { m, pr, wt: pr.area * (BOOST[m.name] || 1) }; }), tot = pre.reduce((s, x) => s + x.wt, 0) || 1;
  const U = { uSize: { value: 3.6 }, uOff: { value: .012 }, uRef: { value: 18 }, uMap: { value: lab.parts.meshes.head.userData.base.map }, uL: { value: new T.Vector3() } };
  const mk = f => new T.ShaderMaterial({ uniforms: { ...U, uFace: { value: f } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: true, depthWrite: false });
  const mb = mk(0), mf = mk(1), dm = { colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  const D1 = new T.MeshBasicMaterial(dm), D2 = new T.MeshBasicMaterial({ ...dm, side: T.DoubleSide });
  let pointCount = 0;
  const items = pre.map(({ m, pr, wt }) => {
    const rnd = rng(hs(m.name)), quota = Math.max(MINQ, Math.round(N * wt / tot)), r = .7 * Math.sqrt(pr.area / quota), s = sample(m.geometry, pr, quota, r, rnd), c = s.count;
    const base = m.userData.base || m.material, col = base.color, lum = col ? Math.pow(Math.min(1, .2126 * col.r + .7152 * col.g + .0722 * col.b), .4545) : .8, dbl = base.side === T.DoubleSide ? 1 : 0, aI = new Float32Array(c * 3);
    for (let k = 0; k < c; k++) aI.set([(k + rnd()) / c, lum, dbl], k * 3);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(s.P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(s.Nn, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(s.U, 2)); g.setAttribute('aI', new T.BufferAttribute(aI, 3));
    const pts = new T.Points(g, m.name === 'head' ? mf : mb); pts.frustumCulled = false; pts.renderOrder = 10; pts.visible = false; pts.name = m.name + 'Dots'; m.add(pts);
    pointCount += c; return { m, pts, g, base, dbl };
  });
  // Switches every mesh, outline, ground ellipse, point layer and background between cel and dots.
  function setStyle(style) {
    const d = style === 'dots';
    camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    U.uL.value.copy(LD).transformDirection(camera.matrixWorldInverse); U.uSize.value = 3.6 * renderer.domElement.width / 1280;
    for (const h of hide) h.visible = !d;
    for (const it of items) { it.m.material = d ? (it.dbl ? D2 : D1) : it.base; it.pts.visible = d; }
    if (d) scene.background.set(0); else scene.background.copy(bg0);
  }
  // Restores cel state and frees the point geometry and materials.
  function dispose() {
    setStyle('cel');
    for (const it of items) { it.m.remove(it.pts); it.g.dispose(); }
    mb.dispose(); mf.dispose(); D1.dispose(); D2.dispose();
  }
  setStyle('cel');
  return { setStyle, dispose, pointCount };
}
