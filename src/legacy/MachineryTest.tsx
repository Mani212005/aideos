import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { ThreeCanvas } from '@remotion/three';

const RotatingCube: React.FC = () => {
  const frame = useCurrentFrame();
  const rotationX = interpolate(frame, [0, 300], [0, Math.PI * 4]);
  const rotationY = interpolate(frame, [0, 300], [0, Math.PI * 2]);

  return (
    <mesh rotation={[rotationX, rotationY, 0]}>
      <boxGeometry args={[3, 3, 3]} />
      <meshStandardMaterial color="#a855f7" wireframe={false} />
    </mesh>
  );
};

export const MachineryTest: React.FC = () => {
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: '#09090b' }}>
      <ThreeCanvas width={width} height={height} camera={{ position: [0, 0, 10] }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} color="#3b82f6" />
        <directionalLight position={[-5, -5, -5]} intensity={0.5} color="#ef4444" />
        <RotatingCube />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
