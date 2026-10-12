/* File Description: Scratch performance for Iona catching a windborne paper glider, 5 s at 30 fps, fixed camera, cel style only.
 * Inputs and outputs: createPerformance(canvas) returns {...lab, renderFrame, getFrameData, metrics, poseState}; every render rebuilds the full pose from the frame number alone.
 * Used by: the scratch Remotion entry and review pages; not shipped source.
 */
import { createProof } from './character.mjs';
import { createDots } from './dots.mjs';
import * as T from './three.module.min.js';

const FPS = 30, CATCH = 69, HOLD = 111, THOLD = 3.7, ROOT_X = 1.9, GS = .85;
const GRIP = new T.Vector3(0, -.4, .09), KEEL = new T.Vector3(0, -.2, -.38);

// Clamped smoothstep between a and b.
const ss = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
// Interpolates numbers or arrays.
const mix = (a, b, w) => Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * w) : a + (b - a) * w;
// Samples keys [[time, value, easeOut]] with smoothstep; flat after the last key.
function tr(K, t) {
  if (t <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) if (t < K[i][0]) { const [t0, v0] = K[i - 1], [t1, v1, o] = K[i], u = (t - t0) / (t1 - t0); return mix(v0, v1, o ? 1 - (1 - u) * (1 - u) : u * u * (3 - 2 * u)); }
  return K[K.length - 1][1];
}
// Designed pose tracks in seconds; arm targets are in root space.
const TR = {
  hipsPos: [[0, [0, .03, 0]], [.7, [0, .07, -.02]], [1.5, [.1, .24, -.08]], [2.3, [-.1, .13, .1], 1], [2.65, [-.08, .14, .1]], [3.7, [-.04, .1, .04]]],
  hipsRot: [[0, [0, 0, 0]], [1.5, [.05, .14, -.03]], [2.3, [-.02, -.12, .03], 1], [3.7, [.03, -.06, -.05]]],
  spine: [[0, [0, 0, 0]], [.7, [-.07, -.1, .03]], [1.5, [.12, -.42, .06]], [2.3, [.2, .32, -.05], 1], [2.65, [.24, .38, -.08]], [3.3, [.13, .2, .06]], [3.7, [.12, .16, .1]]],
  neck: [[0, [0, 0, 0]], [.7, [-.04, -.1, 0]], [1.5, [.04, -.08, 0]], [2.3, [-.02, -.1, 0], 1], [3.2, [.03, .05, -.02]], [3.7, [.04, .14, -.04]]],
  head: [[0, [-.02, -.05, .01]], [.7, [-.14, -.3, .04]], [1.5, [.02, -.2, .02]], [2.3, [0, -.25, -.02], 1], [2.75, [.05, -.1, 0]], [3.7, [.06, .32, -.08]]],
  wR: [[0, [-1.1, 3.25, .2]], [.7, [-1.05, 3.55, .35]], [1.5, [-1.2, 4.5, -.9]], [2.3, [-1.45, 5.6, 1.95], 1], [2.55, [-1.5, 5.65, 2]], [3.2, [-.55, 4.55, .9]], [3.7, [-.42, 4.4, .82]]],
  wL: [[0, [1.1, 3.25, .2]], [.7, [1.2, 3.65, .3]], [1.5, [1.45, 4.1, .1]], [2.3, [1.55, 4.55, -.55], 1], [2.65, [1.5, 4.5, -.4]], [3.3, [.5, 4.1, .7]], [3.7, [.3, 4, .78]]],
  poleR: [[0, [-.6, -.3, -.7]], [1.5, [-1, .4, -.6]], [2.3, [-.7, -.6, -.4]], [3.1, [-1, -.7, -.2]]],
  poleL: [[0, [.6, -.3, -.7]], [1.5, [1, -.2, -.6]], [2.3, [1, -.5, -.5]], [3.1, [1, -.7, -.2]]],
  wrR: [[0, [.16, 0, -.1]], [1.5, [-.35, 0, -.2]], [2.3, [.5, 0, -.1], 1], [3.1, [.25, .2, 0]]],
  wrL: [[0, [.1, 0, .08]], [2.3, [.2, 0, .1]], [3.5, [.4, -.2, .1]]],
  coat: [[0, [.03, 0]], [.7, [.12, .02]], [1.5, [.2, .05]], [2.3, [-.1, -.03]], [2.7, [.38, .1]], [3.1, [-.12, -.06]], [3.45, [.1, .03]], [3.7, [.04, .02]]],
  tuft: [[0, [0, 0]], [.7, [.22, .04]], [1.5, [.1, -.02]], [2.3, [-.18, 0]], [2.75, [.4, .1]], [3.2, [-.12, -.05]], [3.55, [.07, .02]], [3.7, [.05, 0]]],
  side: [[0, [0, 0]], [.8, [-.1, .1]], [2.4, [.12, -.12]], [2.9, [-.15, .1]], [3.7, [0, 0]]]
};
const EXK = [[0, 'neutral'], [.5, 'neutral'], [.85, 'surprised'], [1.2, 'surprised'], [1.6, 'determined'], [2.6, 'determined'], [3.1, 'relieved']];
// Returns the expression blend for time t.
function expr(t) {
  for (let i = 1; i < EXK.length; i++) if (t < EXK[i][0]) return { a: EXK[i - 1][1], b: EXK[i][1], t: ss(EXK[i - 1][0], EXK[i][0], t) };
  return { a: 'relieved', b: 'relieved', t: 0 };
}
// Maps a frame to pose time; the final hold uses one fixed time so frames 111 to 149 are identical.
const tOf = f => f >= HOLD ? THOLD : f / FPS;

// Builds the lab, the pose solver, the glider flight and the render API.
export function createPerformance(canvas) {
  const lab = createProof(canvas), { rig, scene, camera, renderer } = lab, gl = rig.glider, root = rig.root, M = lab.parts.meshes;
  const metrics = { frame: -1, triangles: 0, drawCalls: 0, catchDistance: 0, contactFrame: CATCH, holdStart: HOLD, dotPoints: 0 };
  renderer.setPixelRatio(1); renderer.setSize(1280, 720, false);
  camera.aspect = 16 / 9; camera.position.set(0, 3.25, 18); camera.lookAt(0, 3.25, 0); camera.updateProjectionMatrix();
  root.position.x = ROOT_X; root.rotation.y = -.62;
  for (const m of scene.children) if (m.geometry?.type === 'CircleGeometry') { m.position.x = ROOT_X; if (m.geometry.parameters.radius > 2) m.scale.setScalar(1.6); }
  scene.add(gl); gl.visible = true;
  const dots = createDots(lab);
  const tails = [['coatTailL', 1], ['coatTailR', -1]].map(([n, s]) => [M[n], new T.Vector3(.2 * s, 0, -.2), s]);
  const tuft = [M.hair_tuft, M.hairHi_tuft].map(m => [m, new T.Vector3(0, .1, -.55)]), side = [M.hair_sideLong, M.hairHi_sideLong].map(m => [m, new T.Vector3(.38, .28, .15)]);

  // Rotates a mesh whose geometry is in parent coordinates about a pivot while keeping the pivot fixed.
  const swing = (m, p, x, y, z) => { m.rotation.set(x, y, z); m.position.copy(p).sub(p.clone().applyEuler(m.rotation)); };

  // Analytic two bone IK in world space honoring rest bone vectors; returns the middle joint world rotation.
  function ik(a, b, c, target, pole) {
    const S = a.getWorldPosition(new T.Vector3()), Qp = a.parent.getWorldQuaternion(new T.Quaternion()), r1 = b.position.clone(), r2 = c.position.clone(), L1 = r1.length(), L2 = r2.length();
    const u = target.clone().sub(S), d = Math.min(L1 + L2 - 1e-3, Math.max(Math.abs(L1 - L2) + 1e-3, u.length())); u.normalize();
    const p = pole.clone().addScaledVector(u, -pole.dot(u)).normalize(), aa = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - aa * aa));
    const E = S.clone().addScaledVector(u, aa).addScaledVector(p, h), Tp = S.clone().addScaledVector(u, d);
    const q1 = new T.Quaternion().setFromUnitVectors(r1.clone().normalize(), E.clone().sub(S).divideScalar(L1).applyQuaternion(Qp.clone().invert()));
    a.quaternion.copy(q1); const Q1 = Qp.clone().multiply(q1);
    const q2 = new T.Quaternion().setFromUnitVectors(r2.clone().normalize(), Tp.sub(E).divideScalar(L2).applyQuaternion(Q1.clone().invert()));
    b.quaternion.copy(q2); return Q1.multiply(q2);
  }

  // Rebuilds every driven joint from the frame number alone, with planted feet and IK arms.
  function setPose(frame) {
    const t = tOf(frame), P = {}; for (const k in TR) P[k] = tr(TR[k], t);
    rig.hips.position.set(P.hipsPos[0], 3.2 - P.hipsPos[1], P.hipsPos[2]); rig.hips.rotation.set(...P.hipsRot);
    rig.spine.rotation.set(...P.spine); rig.chest.rotation.set(0, 0, 0); rig.neck.rotation.set(...P.neck); rig.head.rotation.set(...P.head);
    root.updateMatrixWorld(true);
    const rq = root.getWorldQuaternion(new T.Quaternion()), toW = a => root.localToWorld(new T.Vector3(...a)), dir = a => new T.Vector3(...a).applyQuaternion(rq);
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R', Qk = ik(rig['hip' + k], rig['knee' + k], rig['ankle' + k], toW([.29 * s, .35, 0]), dir([0, 0, 1]));
      rig['ankle' + k].quaternion.copy(Qk.invert().multiply(rq));
      ik(rig['shoulder' + k], rig['elbow' + k], rig['wrist' + k], toW(P['w' + k]), dir(P['pole' + k]));
      rig['wrist' + k].rotation.set(...P['wr' + k]);
    }
    const c = ss(2.25, 2.45, t);
    rig.fingersR.rotation.set(-.1 - .8 * c, 0, 0); rig.thumbR.rotation.set(-.05 - .45 * c, 0, 0); rig.fingersL.rotation.set(-.35, 0, 0); rig.thumbL.rotation.set(-.2, 0, 0);
    for (const [m, p, s] of tails) swing(m, p, P.coat[0] + s * .02, 0, s * P.coat[1]);
    for (const [m, p] of tuft) swing(m, p, P.tuft[0], 0, P.tuft[1]);
    for (const [m, p] of side) swing(m, p, 0, 0, P.side[1] + P.side[0] * .5);
    root.updateMatrixWorld(true);
    return t;
  }

  // Evaluates the contact pose once and derives the exact wrist to glider attachment transform from it.
  setPose(CATCH);
  const Wc = rig.wristR.matrixWorld.clone(), Qc = new T.Quaternion().setFromEuler(new T.Euler(-.12, 1.5, .14, 'YXZ'));
  const O = GRIP.clone().applyMatrix4(Wc).sub(KEEL.clone().multiplyScalar(GS).applyQuaternion(Qc));
  const attach = Wc.clone().invert().multiply(new T.Matrix4().compose(O, Qc, new T.Vector3(GS, GS, GS)));
  const cp = new T.Vector3(), cq = new T.Quaternion(), cs = new T.Vector3(); Wc.clone().multiply(attach).decompose(cp, cq, cs);
  const P0 = new T.Vector3(-5.2, 6.15, .45), P1 = new T.Vector3(-3.4, 6.75, .45), P2 = cp.clone().add(new T.Vector3(-1.1, .75, 0));
  const q0 = new T.Quaternion().setFromEuler(new T.Euler(.12, 1.45, .3, 'YXZ')), AX = new T.Vector3(1, 0, 0), mtx = new T.Matrix4();

  // Places the glider on its airborne path before contact and rigidly on the wrist from contact on.
  function placeGlider(frame) {
    if (frame >= CATCH) { mtx.multiplyMatrices(rig.wristR.matrixWorld, attach).decompose(gl.position, gl.quaternion, gl.scale); return; }
    const u = frame / CATCH, e = 1 - (1 - u) * (1 - u), m = 1 - e;
    gl.position.copy(P0).multiplyScalar(m ** 3).addScaledVector(P1, 3 * m * m * e).addScaledVector(P2, 3 * m * e * e).addScaledVector(cp, e ** 3);
    gl.position.y += .12 * Math.sin(2 * Math.PI * u) * (1 - u);
    gl.quaternion.copy(q0).slerp(cq, e).multiply(new T.Quaternion().setFromAxisAngle(AX, -.3 * Math.sin(Math.PI * u) * u));
    gl.scale.copy(cs);
  }

  // Renders one deterministic frame in the cel or dots style from the same pose, glider and camera.
  function renderFrame(frame, style = 'cel') {
    const f = Math.max(0, Math.min(149, Math.round(frame))), t = setPose(f);
    placeGlider(f); gl.updateMatrixWorld(true); rig.setExpression(expr(t)); const st = style === 'dots' ? 'dots' : 'cel'; dots.setStyle(st);
    renderer.render(scene, camera);
    const kw = KEEL.clone().applyMatrix4(gl.matrixWorld), gw = GRIP.clone().applyMatrix4(rig.wristR.matrixWorld);
    Object.assign(metrics, { frame: f, style: st, dotPoints: dots.pointCount, triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls, catchDistance: kw.distanceTo(gw) });
    return canvas;
  }

  // Returns the pose values, phase and glider mode for a frame without rendering.
  function poseState(frame) {
    const t = tOf(frame), S = { frame, t, phase: t < .7 ? 'setup' : t < 1.5 ? 'anticipation' : t < 2.3 ? 'reach' : t < 3.7 ? 'follow-through' : 'final-hold', glider: frame >= CATCH ? 'attached' : 'airborne', expression: expr(t) };
    for (const k in TR) S[k] = tr(TR[k], t);
    return S;
  }

  // Renders a frame and returns its PNG data URL with metrics and pose state.
  function getFrameData(frame, style = 'cel') {
    renderFrame(frame, style);
    return { frame, style: metrics.style, png: canvas.toDataURL('image/png'), metrics: { ...metrics }, pose: poseState(frame) };
  }

  renderFrame(0);
  return { ...lab, renderFrame, getFrameData, metrics, poseState, dispose: () => { dots.dispose(); lab.dispose(); } };
}
