import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { THEME } from "../../theme";
import type { SubjectProps } from "./registry";

/**
 * SUBJECT: cardShelf
 *
 * A wall of index cards — rows are layers, columns are tokens. `state` sweeps a
 * write-front left to right: cards behind the front are written (lit, pushed
 * forward), cards ahead of it are blank (dim, recessed).
 *
 * For the KV cache episode this is literally the subject matter: the shelf of
 * index cards the script describes. It generalises to anything that accumulates
 * over a sequence — memory filling, a buffer, a timeline, a training run.
 *
 * Built as a single InstancedMesh: ~200 cards as separate meshes would be 200
 * draw calls per frame, which is the difference between a render finishing
 * tonight and finishing tomorrow.
 */

const COLS = 26; // tokens
const ROWS = 8; // layers

const CARD_W = 0.3;
const CARD_H = 0.46;
const CARD_D = 0.022;
const GAP_X = 0.42;
const GAP_Y = 0.62;

/** Deterministic jitter — Math.random() would differ across render workers. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const CardShelfSubject: React.FC<SubjectProps> = ({ state, sway, breathe }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = COLS * ROWS;

  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D);
    // Cards read as paper, not slabs — a tiny bevel would be costlier than this.
    g.translate(0, 0, 0);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.62,
        metalness: 0,
        clearcoat: 0.18,
        clearcoatRoughness: 0.5,
        // NOT vertexColors. InstancedMesh applies per-instance colour through
        // its own USE_INSTANCING_COLOR path as soon as `instanceColor` exists.
        // Setting vertexColors makes the shader look for a per-vertex `color`
        // attribute that BoxGeometry does not have, and every card renders black.
      }),
    [],
  );

  // Per-card constants, computed once.
  const cards = useMemo(
    () =>
      new Array(count).fill(0).map((_, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        return {
          col,
          row,
          // Column position along the sequence, 0..1 — what the write-front tests.
          u: col / (COLS - 1),
          x: (col - (COLS - 1) / 2) * GAP_X,
          y: (row - (ROWS - 1) / 2) * GAP_Y,
          jitterZ: (hash(i * 1.7) - 0.5) * 0.06,
          jitterRot: (hash(i * 3.3) - 0.5) * 0.14,
          phase: hash(i * 5.9) * Math.PI * 2,
        };
      }),
    [count],
  );

  const litColor = useMemo(() => new THREE.Color(THEME.primary.base), []);
  const warmColor = useMemo(() => new THREE.Color(THEME.secondary.base), []);
  // Blank cards must still read as paper on a near-black backdrop, so this sits
  // well above the background rather than at it.
  const blankColor = useMemo(() => new THREE.Color("#4A555F"), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // The write-front. Overshoots both ends so state 0 is fully blank and
    // state 1 is fully written, jitter included.
    const front = state * 1.25 - 0.12;

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      // Rows fill slightly out of step, so the front reads as a diagonal sweep
      // rather than a flat wall moving across — layers finish at their own pace.
      const rowLag = (c.row / ROWS) * 0.08;
      const written = Math.max(0, Math.min(1, (front - rowLag - c.u) * 9));

      // Written cards sit forward and square up; blank cards hang back, tilted.
      const z = c.jitterZ + written * 0.34 + Math.sin(breathe * 1.3 + c.phase) * 0.03;
      dummy.position.set(c.x, c.y, z);
      dummy.rotation.set(
        c.jitterRot * (1 - written) * 1.6,
        c.jitterRot * (1 - written) * 2.2,
        c.jitterRot * (1 - written),
      );
      const s = 0.82 + written * 0.18;
      dummy.scale.set(s, s, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Freshly written cards flare toward the secondary accent, then settle to
      // primary — it gives the sweep a visible leading edge.
      const edge = Math.max(0, 1 - Math.abs(front - rowLag - c.u) * 7);
      color.copy(blankColor).lerp(litColor, written).lerp(warmColor, edge * 0.75);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [state, breathe, cards, litColor, warmColor, blankColor]);

  return (
    <group rotation={[breathe * 0.03, sway * 0.5, 0]} scale={1.42}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, count]}
        // Instance colours only exist once the buffer is allocated; three.js
        // allocates it lazily on the first setColorAt, so seed it here.
        onUpdate={(m) => {
          if (!m.instanceColor) {
            m.instanceColor = new THREE.InstancedBufferAttribute(
              new Float32Array(count * 3).fill(1),
              3,
            );
          }
        }}
      />
    </group>
  );
};
