/*
File Description: Implements a procedural glowing low-poly icosahedron cluster scene recreating the surreal Image 1 benchmark using Remotion frame determinism.
*/

import { useMemo, useRef } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { ThreeFoundation } from '../foundation/ThreeFoundation';
import { CinematicComposer } from '../postprocessing/CinematicComposer';

export interface GlowingClusterMetaphorProps {
  width: number;
  height: number;
  title?: string;
  subtitle?: string;
}

// Generates deterministic position vectors for the icosahedron sphere cluster.
export function generateClusterPositions(count: number): Array<[number, number, number]> {
  const positions: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(-1 + (2 * i) / count);
    const theta = Math.sqrt(count * Math.PI) * phi;
    const radius = 2.2 + (i % 3) * 0.4;
    positions.push([
      radius * Math.cos(theta) * Math.sin(phi),
      radius * Math.sin(theta) * Math.sin(phi),
      radius * Math.cos(phi),
    ]);
  }
  return positions;
}

// Renders the animated 3D glowing cluster mesh driven deterministically by Remotion frame.
export function ClusterMesh() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const groupRef = useRef<THREE.Group>(null);

  const clusterPositions = useMemo(() => generateClusterPositions(36), []);

  const coreMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#FF2D55'),
        wireframe: false,
      }),
    []
  );

  const glowWireframeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#635BFF'),
        wireframe: true,
      }),
    []
  );

  return (
    <group ref={groupRef} rotation={[time * 0.2, time * 0.35, 0]}>
      {clusterPositions.map(([x, y, z], idx) => {
        const scale = 0.65 + Math.sin(time * 2 + idx) * 0.15;
        const isCore = idx % 5 === 0;

        return (
          <group key={idx} position={[x, y, z]} scale={[scale, scale, scale]}>
            <mesh material={isCore ? coreMaterial : glowWireframeMaterial}>
              <icosahedronGeometry args={[0.75, 1]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// Main component combining ThreeFoundation, ClusterMesh, and CinematicComposer for Remotion.
export function GlowingClusterMetaphor({
  width,
  height,
  title = 'HIGH-FIDELITY SHADER CLUSTER',
  subtitle = 'Deterministic 3D Rendering Engine',
}: GlowingClusterMetaphorProps) {
  return (
    <div style={{ width, height, background: '#0A0A0B', position: 'relative' }}>
      <ThreeFoundation width={width} height={height}>
        <ClusterMesh />
        <CinematicComposer bloomStrength={2.0} bloomRadius={0.5} bloomThreshold={0.15} />
      </ThreeFoundation>

      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 60,
          color: '#F5F5F5',
          fontFamily: 'JetBrains Mono, monospace',
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.05em', color: '#635BFF' }}>
          {title}
        </div>
        <div style={{ fontSize: 16, color: '#8A8A8E', marginTop: 8 }}>{subtitle}</div>
      </div>
    </div>
  );
}
