/**
 * File Description: Isolated cel filmstrip comparing the recovered approved performance with the new action.
 * Inputs and outputs: browser canvas, reference source and bundled evaluator -> paired actual raster frames.
 * Used by: npm run performance:filmstrip; never imported by the production renderer or Studio.
 */
import { createProof } from './character.mjs';
import { createPerformance } from './performance.mjs';
import { action, evaluate } from './evaluate.js';
import * as T from './three.module.min.js';

const reference = createPerformance(document.createElement('canvas'));
const candidate = createProof(document.createElement('canvas'));
const { scene, renderer, camera, rig, parts } = candidate;
renderer.setPixelRatio(1); renderer.setSize(1280, 720, false);
camera.aspect = 16 / 9; camera.position.set(0, 3.25, 18); camera.lookAt(0, 3.25, 0); camera.updateProjectionMatrix();
for (const mesh of scene.children) if (mesh.geometry?.type === 'CircleGeometry') {
  mesh.position.x = 1.9;
  if (mesh.geometry.parameters.radius > 2) mesh.scale.setScalar(1.6);
}
scene.add(rig.glider); rig.glider.visible = true;

// Applies a secondary mesh rotation about its original authored pivot.
function swing(mesh, pivot, x, y, z) {
  mesh.rotation.set(x, y, z);
  mesh.position.copy(pivot).sub(pivot.clone().applyEuler(mesh.rotation));
}
// Applies every driven transform to the archived rig, then renders the fixed-camera candidate.
function renderCandidate(frame) {
  const state = evaluate(frame);
  rig.root.position.fromArray(state.root.position); rig.root.quaternion.fromArray(state.root.rotation);
  for (const [id, transform] of Object.entries(state.local)) {
    rig[id].position.fromArray(transform.position); rig[id].quaternion.fromArray(transform.rotation);
  }
  rig.glider.position.fromArray(state.prop.position); rig.glider.quaternion.fromArray(state.prop.rotation); rig.glider.scale.setScalar(state.prop.scale);
  const { coat, tuft, side } = state.secondary;
  for (const [id, sign] of [['coatTailL', 1], ['coatTailR', -1]]) swing(parts.meshes[id], new T.Vector3(.2 * sign, 0, -.2), coat[0] + sign * .02, 0, sign * coat[1]);
  for (const id of ['hair_tuft', 'hairHi_tuft']) swing(parts.meshes[id], new T.Vector3(0, .1, -.55), tuft[0], 0, tuft[1]);
  for (const id of ['hair_sideLong', 'hairHi_sideLong']) swing(parts.meshes[id], new T.Vector3(.38, .28, .15), 0, 0, side[1] + side[0] * .5);
  rig.setExpression(state.expression);
  rig.root.updateMatrixWorld(true); rig.glider.updateMatrixWorld(true);
  renderer.render(scene, camera);
  return state;
}

const evidence = [];
for (const frame of [0, 21, 45, 57, 69, 80, 99, 111]) {
  reference.renderFrame(frame, 'cel');
  const baseline = globalThis.approvedFrames?.[frame] ?? reference.renderer.domElement.toDataURL('image/png');
  const state = renderCandidate(frame);
  let adapterError = 0, referenceGap = 0;
  for (const [id, transform] of Object.entries(state.joints)) {
    const actual = rig[id].getWorldPosition(new T.Vector3());
    adapterError = Math.max(adapterError, actual.distanceTo(new T.Vector3(...transform.position)));
    referenceGap = Math.max(referenceGap, actual.distanceTo(reference.rig[id].getWorldPosition(new T.Vector3())));
  }
  evidence.push({ frame, phase: state.phase, adapterError, referenceGap, attachmentGap: new T.Vector3(...state.contact.point).distanceTo(new T.Vector3(...state.contact.propPoint)) });
  const section = document.createElement('section'), label = document.createElement('h2');
  label.textContent = `Frame ${frame}: ${state.phase}`; section.append(label);
  for (const [name, url] of [[globalThis.approvedFrames?.[frame] ? 'Approved encoded clip' : 'Approved reference source', baseline], ['Cue-bound receive', renderer.domElement.toDataURL('image/png')]]) {
    const figure = document.createElement('figure'), caption = document.createElement('figcaption'), image = document.createElement('img');
    caption.textContent = name; image.src = url; image.alt = `${name}, frame ${frame}`;
    figure.append(caption, image); section.append(figure);
  }
  document.querySelector('main').append(section);
}
document.querySelector('#evidence').textContent = JSON.stringify({ action: action.id, camera: 'fixed 24-degree perspective', evidence }, null, 2);
reference.dispose(); candidate.dispose();
