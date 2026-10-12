/* File Description: Original character still proof for Iona, an adult wind courier, built from custom ring-section Three.js geometry with a painted face texture on a sculpted head. This is an unfinished proof, not a claim of final anime quality.
 * Inputs and outputs: createProof(canvas) takes an HTMLCanvasElement and returns {still,getData,rig,renderer,scene,camera,parts,palette,dispose}. still(view,expression,mode,crop) renders and returns the canvas; getData() returns a PNG data URL.
 * Used by: character art review pages and later rig and animation passes.
 */
import * as THREE from './three.module.min.js';

const PAL = { ink: 0x101826, skin: 0xf0c8a8, navy: 0x1c2a4e, brow: 0x131c38, teal: 0x1f8a8c, cream: 0xf2e8d0, rust: 0xb5532f, pants: 0x252c3c, boot: 0x161b26, glove: 0x2b3a4a, paper: 0xe9e2d2, iris: 0x1fa7a4 };
// Colour decisions: the face uses an authored two-tone cel map (flat basic material) so the art stays stable, not a physically lit anatomical shading.
const EX = {
  neutral: { o: .8, bt: .05, br: 0, mc: .012, mo: 0 },
  determined: { o: .62, bt: .5, br: -.01, mc: -.012, mo: 0 },
  surprised: { o: 1.15, bt: -.4, br: .05, mc: 0, mo: .07 },
  relieved: { o: .3, bt: -.25, br: .02, mc: .034, mo: 0 } };
// Converts a numeric color to a CSS hex string.
const hex = n => '#' + n.toString(16).padStart(6, '0');

// Builds a tapered elliptical ring-section tube along a smooth path with full-width closed end caps.
function tube(pts, radii, o = [0, 0, 0], seg = 20, rad = 20, cap = [1, 1]) {
  const cv = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0] - o[0], p[1] - o[1], p[2] - o[2])));
  const P = [], I = [], n = radii.length - 1, L = THREE.MathUtils.lerp;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, c = cv.getPoint(t), T = cv.getTangent(t);
    const ref = Math.abs(T.z) < .9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const S = new THREE.Vector3().crossVectors(T, ref).normalize(), N = new THREE.Vector3().crossVectors(S, T);
    const f = t * n, k = Math.min(Math.floor(f), n - 1), w = f - k, R = q => [].concat(radii[Math.max(0, Math.min(n, q))]), A = R(k - 1), ra = R(k), rb = R(k + 1), D = R(k + 2), CR = (a, b, c, d) => Math.max(.004, .5 * (2 * b + (c - a) * w + (2 * a - 5 * b + 4 * c - d) * w * w + (3 * b - a - 3 * c + d) * w * w * w));
    const rx = CR(A[0], ra[0], rb[0], D[0]), rz = CR(A[1] ?? A[0], ra[1] ?? ra[0], rb[1] ?? rb[0], D[1] ?? D[0]), cs = i === 0 ? cap[0] : i === seg ? cap[1] : 1;
    for (let j = 0; j <= rad; j++) {
      const a = j / rad * Math.PI * 2, cx = Math.cos(a) * rx * cs, sz = Math.sin(a) * rz * cs;
      P.push(c.x + S.x * cx + N.x * sz, c.y + S.y * cx + N.y * sz, c.z + S.z * cx + N.z * sz);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
  for (const [ri, e, pt] of [[0, 0, cv.getPoint(0)], [seg, 1, cv.getPoint(1)]]) {
    const ci = P.length / 3; P.push(pt.x, pt.y, pt.z);
    for (let j = 0; j <= rad; j++) { const q = (ri * (rad + 1) + j) * 3; P.push(P[q], P[q + 1], P[q + 2]); }
    for (let j = 0; j < rad; j++) { if (e) I.push(ci, ci + 2 + j, ci + 1 + j); else I.push(ci, ci + 1 + j, ci + 2 + j); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
  const nm = g.attributes.normal;
  for (let i = 0; i <= seg; i++) { const a = i * (rad + 1), b = a + rad, v = new THREE.Vector3(nm.getX(a) + nm.getX(b), nm.getY(a) + nm.getY(b), nm.getZ(a) + nm.getZ(b)).normalize(); nm.setXYZ(a, v.x, v.y, v.z); nm.setXYZ(b, v.x, v.y, v.z); }
  return g;
}

// Builds a folded-paper dart glider with a ridge and keel crease.
function glider() {
  const v = { n: [0, 0, .95], l: [-.62, .06, -.45], r: [.62, .06, -.45], t: [0, .02, -.5], k: [0, -.2, -.38], a: [0, .12, -.1] };
  const F = [['n', 'l', 'a'], ['n', 'a', 'r'], ['a', 'l', 't'], ['a', 't', 'r'], ['n', 'l', 'k'], ['n', 'k', 'r'], ['l', 't', 'k'], ['r', 'k', 't']];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(F.flat().flatMap(c => v[c]), 3)); g.computeVertexNormals(); return g;
}

// Creates a restrained 3-band toon gradient texture.
function ramp() {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

// Builds a normal-extruded backface ink outline material.
function inkMat(w) {
  return new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { w: { value: w }, c: { value: new THREE.Color(PAL.ink) } },
    vertexShader: 'uniform float w; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * w, 1.0); }',
    fragmentShader: 'uniform vec3 c;\nvoid main(){\n gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}' });
}

// Paints skin, hairline, brows, eyes, and mouth into the head's front UV plane.
function paintFace(c, e) {
  c.setTransform(1024, 0, 0, -1024, 512, 512); c.lineCap = c.lineJoin = 'round';
  c.fillStyle = '#d9a687'; c.fillRect(-.5, -.5, 1, 1);
  c.fillStyle = hex(PAL.skin); c.beginPath(); c.ellipse(.03, .02, .36, .42, 0, 0, 7); c.fill();
  c.strokeStyle = 'rgba(176,112,86,.45)'; c.lineWidth = .008; c.stroke();
  c.fillStyle = 'rgba(226,110,104,.13)'; for (const s of [-1, 1]) { c.beginPath(); c.ellipse(.21 * s, -.14, .07, .035, 0, 0, 7); c.fill(); }
  c.fillStyle = hex(PAL.navy); c.beginPath(); c.moveTo(-.55, -.12); c.lineTo(-.41, -.12); c.quadraticCurveTo(-.4, .18, -.15, .24);
  c.quadraticCurveTo(.08, .3, .2, .22); c.quadraticCurveTo(.33, .16, .4, .02); c.lineTo(.55, -.12); c.lineTo(.55, .6); c.lineTo(-.55, .6); c.fill();
  const h = .06 * e.o, yi = .1 + e.br - e.bt * .04, ya = .1 + e.br + .012, yo = .1 + e.br;
  for (const s of [-1, 1]) {
    c.save(); c.scale(s, 1); c.fillStyle = hex(PAL.brow);
    c.beginPath(); c.moveTo(.075, yi - .012); c.quadraticCurveTo(.17, ya + .03, .29, yo); c.quadraticCurveTo(.17, ya + .005, .075, yi + .014); c.fill();
    c.translate(.18, -.02); c.strokeStyle = hex(PAL.ink);
    if (e.o < .4) { c.lineWidth = .016; c.beginPath(); c.moveTo(-.09, 0); c.bezierCurveTo(-.04, .055, .05, .06, .105, .01); c.stroke(); }
    else {
      const lo = .035 * Math.min(e.o, 1), up = () => { c.beginPath(); c.moveTo(-.09, 0); c.bezierCurveTo(-.05, h * 1.15, .05, h * 1.25, .105, .02); };
      up(); c.bezierCurveTo(.06, -lo, -.04, -lo, -.09, 0); c.save(); c.clip(); c.fillStyle = '#fbf8f0'; c.fillRect(-.1, -.1, .25, .2);
      const g = c.createLinearGradient(0, -.06, 0, .07); g.addColorStop(0, '#5fd0c4'); g.addColorStop(.5, hex(PAL.iris)); g.addColorStop(1, '#0f5a63');
      c.fillStyle = g; c.beginPath(); c.ellipse(.015, 0, .047, .058, 0, 0, 7); c.fill();
      c.fillStyle = '#0a1c26'; c.beginPath(); c.ellipse(.015, 0, .02, .027, 0, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(0, .022, .012, 0, 7); c.arc(.035, -.015, .006, 0, 7); c.fill(); c.restore();
      up(); c.lineWidth = .017; c.stroke(); c.beginPath(); c.moveTo(.105, .02); c.lineTo(.14, .045); c.lineWidth = .012; c.stroke();
      c.lineWidth = .005; c.globalAlpha = .6; c.beginPath(); c.moveTo(-.07, -.003); c.bezierCurveTo(-.03, -lo * 1.1, .05, -lo * 1.1, .1, .015); c.moveTo(-.06, h * 1.5 + .01); c.bezierCurveTo(0, h * 2 + .015, .06, h * 2 + .015, .1, .045); c.stroke(); c.globalAlpha = 1;
    }
    c.restore();
  }
  const w = e.mo ? .01 : e.bt > .3 ? .07 : .085, yb = -.3;
  c.beginPath(); if (!e.mo) { c.moveTo(-w, yb + e.mc); c.quadraticCurveTo(0, yb - e.mc * 1.6, w, yb + e.mc); }
  if (e.mo) { c.ellipse(0, yb - .005, .043, .047, 0, 0, 7); c.fillStyle = '#6a2630'; c.fill(); }
  c.lineWidth = e.bt > .3 ? .013 : .009; c.strokeStyle = '#4a1f26'; c.stroke();
}

// Builds the renderer, stage, rigged character, and still-rendering API.
export function createProof(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setPixelRatio(1);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(PAL.paper);
  const camera = new THREE.PerspectiveCamera(24, .8, .1, 100);
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 6, 5); scene.add(sun, new THREE.AmbientLight(0xffffff, Math.PI * .3));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), new THREE.MeshBasicMaterial({ color: 0xd9d0bc })); floor.rotation.x = -Math.PI / 2; floor.position.y = -.01;
  const shade = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .12 })); shade.rotation.x = -Math.PI / 2; shade.position.y = 0;
  scene.add(floor, shade);
  const fc = document.createElement('canvas'); fc.width = fc.height = 1024; const fx = fc.getContext('2d');
  const tex = new THREE.CanvasTexture(fc); tex.colorSpace = THREE.SRGBColorSpace;
  const gm = ramp(), sil = new THREE.MeshBasicMaterial({ color: 0x141b2c }), parts = { meshes: {}, geometries: [], inks: [] }, rig = {};
  const root = rig.root = new THREE.Group(); root.name = 'root'; scene.add(root);
  // Creates a named rig joint under a parent.
  const J = (n, p, x, y, z) => { const g = new THREE.Group(); g.name = n; g.position.set(x, y, z); p.add(g); return rig[n] = g; };
  // Adds a toon mesh with an optional ink outline and records it in parts.
  const add = (name, geo, col, parent, ink = .022, opt = {}) => {
    const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: col, gradientMap: gm, ...opt })); m.name = name; m.userData.base = m.material; parent.add(m);
    if (ink) { const im = inkMat(ink), o = new THREE.Mesh(geo, im); o.name = name + 'Ink'; m.add(o); parts.inks.push([im, ink]); }
    parts.meshes[name] = m; parts.geometries.push(geo); return m;
  };
  const hips = J('hips', root, 0, 3.2, 0), spine = J('spine', hips, 0, .7, 0), chest = J('chest', spine, 0, .7, 0), neck = J('neck', chest, 0, .7, 0), head = J('head', neck, 0, .7, 0);
  const TO = [0, 3.9, 0];
  add('torso', tube([[0, 3.2, 0], [0, 3.9, 0], [0, 4.6, 0], [0, 5.2, 0], [0, 5.45, 0]], [[.38, .26], [.29, .21], [.38, .26], [.46, .24], [.17, .17]], TO), PAL.teal, spine, .026);
  add('hem', tube([[0, 3.38, 0], [0, 3.05, 0]], [[.43, .29], [.47, .32]], TO, 4, 20, [1, 1]), PAL.rust, spine, .02);
  for (const s of [-1, 1]) add('coatTail' + (s > 0 ? 'L' : 'R'), tube([[.2 * s, 0, -.2], [.26 * s, -.55, -.38], [.3 * s, -1.2, -.5]], [[.2, .07], [.16, .05], [.1, .03]]), PAL.rust, hips, .018);
  const TY = [-.7, 0, .7, 1.3, 1.55], TX = [.38, .29, .38, .46, .17], TZ = [.26, .21, .26, .24, .17];
  // Interpolates a torso section value at a local height.
  const lerpAt = (Arr, y) => { for (let i = 0; i < 4; i++) if (y <= TY[i + 1]) return THREE.MathUtils.lerp(Arr[i], Arr[i + 1], Math.max(0, (y - TY[i]) / (TY[i + 1] - TY[i]))); return Arr[4]; };
  // Projects a front x,y point onto the torso surface with a small outward offset h.
  const onTorso = (x, y, h) => [x, y, Math.sqrt(Math.max(0, 1 - (x / lerpAt(TX, y)) ** 2)) * lerpAt(TZ, y) + h];
  // Builds a surface hugging jacket panel between two matching edge polylines.
  function sheet(A, B, h = .03, m = 5) {
    const P = [], q = (a, b, u) => onTorso(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, h);
    for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < m; j++) {
      const u = j / m, v = (j + 1) / m, a = q(A[i], B[i], u), b = q(A[i], B[i], v), c = q(A[i + 1], B[i + 1], u), d = q(A[i + 1], B[i + 1], v);
      P.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
  }
  const mir = (Arr, s) => Arr.map(p => [p[0] * s, p[1]]), DS = { side: THREE.DoubleSide };
  add('jacketOpening', sheet([[-.2, 1.3], [-.13, .95], [-.07, .5], [-.04, 0], [-.05, -.62]], [[.2, 1.3], [.13, .95], [.07, .5], [.04, 0], [.05, -.62]], .03), PAL.cream, spine, 0, DS);
  add('waistSeam', sheet([[-.3, .05], [-.15, .06], [0, .06], [.15, .06], [.3, .05]], [[-.3, -.04], [-.15, -.03], [0, -.03], [.15, -.03], [.3, -.04]], .04, 2), 0x145f62, spine, 0, DS);
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    const wd = s > 0 ? 1 : .78;
    add('jacketLining' + k, sheet(mir([[.2, 1.3], [.13, .95], [.07, .5]], s), mir([[.27, 1.3], [.2, .95], [.07, .5]], s), .035, 3), PAL.rust, spine, 0, DS);
    add('lapel' + k, sheet(mir([[.27, 1.3], [.2, .95], [.07, .5]], s), mir([[.27 + .13 * wd, 1.2], [.2 + .16 * wd, .8], [.07, .5]], s), .045), 0x167074, spine, 0, DS);
  }
  add('neckSkin', tube([[0, 0, 0], [0, .35, .03]], [.12, .11]), PAL.skin, neck, .012);
  add('collar', tube([[0, -.05, 0], [0, .22, 0]], [[.25, .22], [.19, .17]], [0, 0, 0], 4, 24, [1, 1]), PAL.cream, neck, .016);
  const hg = tube([[0, -.5, .26], [0, -.44, .2], [0, -.32, .12], [0, -.15, .04], [0, .05, 0], [0, .25, -.01], [0, .4, -.02], [0, .5, -.02], [0, .54, -.02]],
    [[.05, .06], [.15, .16], [.27, .27], [.37, .36], [.42, .41], [.43, .42], [.38, .4], [.22, .28], [.03, .04]], [0, 0, 0], 36, 32);
  const pa = hg.attributes.position, uv = []; for (let i = 0; i < pa.count; i++) uv.push(pa.getX(i) + .5, pa.getY(i) + .5); hg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const hm = add('head', hg, 0xffffff, head, .02, { map: tex }); { const oldMat = hm.material; hm.material = hm.userData.base = new THREE.MeshBasicMaterial({ map: tex }); oldMat.dispose(); }
  add('nose', tube([[0, 0, .37], [0, -.1, .45], [0, -.15, .46]], [[.035, .03], [.04, .035], [.045, .04]], [0, 0, 0], 14, 14, [.35, .5]), 0xdfae8e, head, .004); { const nm = parts.meshes.nose, oldMat = nm.material; nm.material = nm.userData.base = new THREE.MeshBasicMaterial({ color: 0xe0b092 }); oldMat.dispose(); }
  add('hairMass', tube([[0, -.34, -.1], [0, -.15, -.14], [0, .05, -.15], [0, .25, -.12], [0, .4, -.1], [0, .5, -.08], [0, .58, -.08]],
    [[.3, .26], [.42, .4], [.46, .44], [.46, .44], [.41, .42], [.27, .3], [.03, .04]], [0, 0, 0], 30, 28, [1, .2]), PAL.navy, head, .022);
  const locks = { sideLong: [[[.38, .28, .15], [.46, .05, .12], [.42, -.22, .2], [.3, -.5, .32]], [[.1, .07], [.1, .06], [.07, .04], [.01, .01]]],
    sideShort: [[[-.38, .28, .15], [-.46, .05, .12], [-.42, -.12, .15]], [[.1, .07], [.09, .06], [.01, .01]]],
    fringeA: [[[-.15, .52, .15], [0, .46, .33], [.25, .3, .34], [.4, .1, .16]], [[.1, .05], [.11, .05], [.08, .04], [.01, .01]]],
    fringeB: [[[-.3, .4, .1], [-.2, .36, .28], [-.05, .38, .37], [.15, .34, .37]], [[.08, .04], [.08, .04], [.06, .03], [.01, .01]]],
    tuft: [[[0, .1, -.55], [.04, -.1, -.75], [.2, -.35, -.85], [.3, -.55, -.8]], [[.1, .08], [.09, .07], [.06, .04], [.01, .01]]] };
  for (const [k, [p, r]] of Object.entries(locks)) add('hair_' + k, tube(p, r, [0, 0, 0], 16, 12), PAL.navy, head, .014);
  for (const [k, [p, r]] of Object.entries(locks)) add('hairHi_' + k, tube(p.map(q => [q[0] * 1.03, q[1] + .03, q[2] + .05]), r.map(v => v.map(x => x * .42)), [0, 0, 0], 12, 8), 0x37538c, head, 0);
  add('hairTie', tube([[.015, .03, -.63], [.025, -.03, -.68]], [[.095, .095], [.095, .095]], [0, 0, 0], 4, 14, [1, 1]), PAL.rust, head, .01);
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R', sh = J('shoulder' + k, chest, .5 * s, .5, 0), el = J('elbow' + k, sh, .34 * s, -1.05, 0), wr = J('wrist' + k, el, .3 * s, -.95, 0);
    add('upperArm' + k, tube([[0, .1, 0], [.17 * s, -.5, 0], [.34 * s, -1.05, 0]], [[.17, .16], [.14, .13], [.115, .11]]), PAL.teal, sh, .02);
    add('foreArm' + k, tube([[0, 0, 0], [.15 * s, -.5, .02], [.3 * s, -.95, 0]], [[.115, .11], [.1, .095], [.085, .08]]), PAL.teal, el, .018);
    add('cuff' + k, tube([[.26 * s, -.78, 0], [.3 * s, -.95, 0]], [[.1, .095], [.095, .09]], [0, 0, 0], 4, 16, [1, 1]), PAL.cream, el, .012);
    add('palm' + k, tube([[0, 0, 0], [.03 * s, -.33, 0]], [[.08, .035], [.07, .03]]), PAL.glove, wr, .012);
    const fg = J('fingers' + k, wr, .03 * s, -.33, 0), th = J('thumb' + k, wr, -.06 * s, -.12, .03);
    for (let i = 0; i < 4; i++) { const x = (i - 1.5) * .04, L = [.9, 1, .95, .72][i], c = [.5, .8, 1, .7][i]; add('finger' + i + k, tube([[x, 0, 0], [x * 1.2 + .012 * s, -.14 * L, .035], [x * 1.4 + .02 * s * c, -.25 * L, .05 + .07 * c]], [.02, .017, .011], [0, 0, 0], 8, 8), PAL.glove, fg, .008); }
    add('thumbMesh' + k, tube([[0, 0, 0], [-.04 * s, -.14, .04], [-.02 * s, -.25, .07]], [.024, .02, .013], [0, 0, 0], 8, 8), PAL.glove, th, .008);
    const hp = J('hip' + k, hips, .26 * s, -.1, 0), kn = J('knee' + k, hp, .03 * s, -1.45, 0), an = J('ankle' + k, kn, 0, -1.3, 0);
    add('thigh' + k, tube([[0, .1, 0], [.01 * s, -.7, .03], [0, -1.45, 0]], [[.27, .25], [.22, .2], [.17, .16]]), PAL.pants, hp, .02);
    add('calf' + k, tube([[0, 0, 0], [0, -.65, -.02], [0, -1.3, 0]], [[.17, .16], [.14, .14], [.1, .1]]), PAL.pants, kn, .018);
    add('bootShaft' + k, tube([[0, -.55, 0], [0, -1.3, 0]], [[.17, .17], [.125, .125]], [0, 0, 0], 4, 20, [1, 1]), PAL.boot, kn, .016);
    add('foot' + k, tube([[0, -.18, -.1], [0, -.22, .3], [0, -.26, .65]], [[.12, .13], [.115, .1], [.07, .06]]), PAL.boot, an, .018);
  }
  const gl = J('glider', rig.wristR, 0, -.3, .05); gl.scale.setScalar(.85); gl.rotation.set(.2, .3, 0); gl.visible = false;
  rig.hips.rotation.z = .015; rig.chest.rotation.z = -.03; rig.head.rotation.z = .012;
  rig.shoulderL.rotation.z = .05; rig.shoulderR.rotation.z = -.02; rig.elbowL.rotation.x = -.2; rig.elbowR.rotation.x = -.16; rig.wristL.rotation.set(.1, 0, .08); rig.wristR.rotation.set(.16, 0, -.1);
  add('gliderPaper', glider(), PAL.cream, gl, 0, { side: THREE.DoubleSide });
  const tipG = new THREE.BufferGeometry(); tipG.setAttribute('position', new THREE.Float32BufferAttribute([-.62, .075, -.45, -.434, .058, -.015, -.434, .065, -.465], 3)); tipG.computeVertexNormals();
  add('gliderTip', tipG, PAL.rust, gl, 0, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // Poses, paints, frames, and renders one still, returning the canvas. Mode 'action' exposes the glider.
  function still(view = 'threequarter', expression = 'neutral', mode = 'cel', crop = 'full') {
    root.rotation.y = { front: 0, threequarter: -.62, side: -Math.PI / 2 }[view] ?? -.62;
    paintFace(fx, EX[expression] || EX.neutral); tex.needsUpdate = true;
    const face = crop === 'face', silM = mode === 'silhouette'; gl.visible = mode === 'action';
    for (const m of Object.values(parts.meshes)) m.material = silM ? sil : m.userData.base;
    for (const [m, w] of parts.inks) m.uniforms.w.value = w * (face ? .45 : 1);
    scene.background.set(silM ? PAL.cream : PAL.paper);
    renderer.setSize(face ? 640 : 768, face ? 640 : 960, false);
    camera.aspect = face ? 1 : .8; camera.position.set(0, face ? 6 : 3.4, face ? 4.7 : 17.5); camera.lookAt(0, face ? 6 : 3.35, 0); camera.updateProjectionMatrix();
    renderer.render(scene, camera); return canvas;
  }
  // Repaints the face from a name or a numeric blend {a, b, t} without touching poses or camera.
  function setExpression(ex = 'neutral') {
    const get = k => typeof k === 'string' ? EX[k] || EX.neutral : k, a = get(ex.a ?? ex), b = ex.b ? get(ex.b) : a, w = Math.min(1, Math.max(0, ex.t ?? 0)), e = {};
    for (const k of Object.keys(EX.neutral)) e[k] = a[k] + (b[k] - a[k]) * w;
    if (e.mo < .02) e.mo = 0;
    paintFace(fx, e); tex.needsUpdate = true; return e;
  }
  rig.setExpression = setExpression;
  // Returns the current canvas as a PNG data URL.
  const getData = () => canvas.toDataURL('image/png');
  // Releases GPU resources held by the proof.
  const dispose = () => { scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); tex.dispose(); gm.dispose(); sil.dispose(); renderer.dispose(); };
  still();
  return { still, getData, rig, renderer, scene, camera, parts, palette: PAL, dispose, setExpression };
}
