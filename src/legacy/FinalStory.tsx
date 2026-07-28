import React, { useMemo, useRef } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, interpolateColors, Sequence } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import * as THREE from 'three';

// ---------------------------------------------------------
// 1. THREE.JS GENERAL: The Solid 3D Oak Leaf
// ---------------------------------------------------------
const OakLeaf3D: React.FC = () => {
  const frame = useCurrentFrame();
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Deterministic 3D organic floating and rotation
  const rotationY = interpolate(frame, [0, 1800], [0, Math.PI * 4]);
  const rotationZ = Math.sin(frame * 0.02) * 0.15;
  const positionY = Math.sin(frame * 0.05) * 0.3;

  // Color transition from Green to Purple around frame 750 (Anthocyanins)
  const leafColor = interpolateColors(
    frame,
    [600, 900],
    ["#15803d", "#7e22ce"] // Deep rich green to deep rich purple
  );

  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    
    // Bottom stem
    shape.moveTo(0, -6);
    shape.lineTo(0.15, -6);
    shape.lineTo(0.15, -4.5);

    // Right Side Lobes
    // Lobe 1
    shape.bezierCurveTo(2.5, -4.5, 3.5, -3, 3, -1.5);
    shape.bezierCurveTo(2.5, -0.5, 1.5, -0.5, 1.2, 0);
    // Lobe 2
    shape.bezierCurveTo(3, 0.5, 3.5, 2, 2.5, 3.5);
    shape.bezierCurveTo(2, 4, 1.5, 3.5, 1, 3.5);
    // Lobe 3 (Top right to tip)
    shape.bezierCurveTo(1.5, 4.5, 1, 5.5, 0, 6);

    // Left Side Lobes (Mirrored)
    // Tip to Lobe 3
    shape.bezierCurveTo(-1, 5.5, -1.5, 4.5, -1, 3.5);
    // Lobe 2
    shape.bezierCurveTo(-1.5, 3.5, -2, 4, -2.5, 3.5);
    shape.bezierCurveTo(-3.5, 2, -3, 0.5, -1.2, 0);
    // Lobe 1
    shape.bezierCurveTo(-1.5, -0.5, -2.5, -0.5, -3, -1.5);
    shape.bezierCurveTo(-3.5, -3, -2.5, -4.5, -0.15, -4.5);

    // Back to stem
    shape.lineTo(-0.15, -6);
    shape.lineTo(0, -6);

    // Extrude to make it 3D
    return new THREE.ExtrudeGeometry(shape, {
      steps: 1, 
      depth: 0.15, 
      bevelEnabled: true, 
      bevelThickness: 0.05, 
      bevelSize: 0.05, 
      bevelSegments: 4
    });
  }, []);

  return (
    <group position={[0, positionY, 0]} rotation={[0, rotationY, rotationZ]}>
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial 
          color={leafColor}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>
    </group>
  );
};

const Scene3D: React.FC = () => {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const cameraZ = interpolate(frame, [0, 1800], [12, 9]);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0 }}>
      {/* Background glow syncing with the leaf color */}
      <div style={{
        position: 'absolute',
        width: 800, height: 800,
        borderRadius: '50%',
        backgroundColor: frame < 750 ? '#22c55e' : '#a855f7',
        filter: 'blur(150px)',
        opacity: 0.15,
        left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        transition: 'background-color 1s ease'
      }}/>

      <ThreeCanvas width={width} height={height} camera={{ position: [0, 0, cameraZ] }}>
        <ambientLight intensity={0.8} />
        {/* Strong directional lights to give the solid 3D shape nice highlights and shadows */}
        <directionalLight position={[10, 10, 10]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[-10, -10, -10]} intensity={0.5} color="#ffffff" />
        <pointLight position={[0, 0, 5]} intensity={0.5} color="#ffffff" />
        <OakLeaf3D />
      </ThreeCanvas>
    </div>
  );
};


// ---------------------------------------------------------
// 2. FRAMER MOTION GENERAL: UI and Storytelling
// ---------------------------------------------------------
const SceneText: React.FC<{ text: React.ReactNode; duration: number }> = ({ text, duration }) => {
  const frame = useCurrentFrame();
  const motionVal = useMotionValue(0);
  motionVal.set(frame);

  // Smooth layout shifts perfectly synced to the timeline
  const y = useTransform(motionVal, [0, 20, duration - 20, duration], [50, 0, 0, -50]);
  const opacity = useTransform(motionVal, [0, 20, duration - 20, duration], [0, 1, 1, 0]);

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '100px 80px' }}>
      <motion.div 
        style={{
          y,
          opacity,
          background: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 32,
          padding: '48px 64px',
          boxShadow: '0 24px 40px rgba(0,0,0,0.5)',
          maxWidth: 700,
        }}
      >
        <h2 style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.4, margin: 0, color: '#f8fafc' }}>
          {text}
        </h2>
      </motion.div>
    </AbsoluteFill>
  );
};


// ---------------------------------------------------------
// 3. REMOTION GENERAL: The Conductor
// ---------------------------------------------------------
export const FinalStory: React.FC = () => {
  const SCENE_DURATION = 300; // 10 seconds per scene at 30fps

  return (
    <AbsoluteFill style={{ backgroundColor: '#09090b', fontFamily: 'Inter, sans-serif', overflow: 'hidden' }}>
      
      {/* Background 3D Engine running continuously */}
      <Scene3D />

      {/* Foreground Storyteller UI */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10 }}>
        
        <Sequence  durationInFrames={SCENE_DURATION}>
          <SceneText 
            duration={SCENE_DURATION}
            text={<>You'll notice most plants have <span style={{ color: '#4ade80' }}>green leaves</span>. But occasionally, you see deep purple, red, or almost black. Why?</>}
          />
        </Sequence>

        <Sequence from={SCENE_DURATION} durationInFrames={SCENE_DURATION}>
          <SceneText 
            duration={SCENE_DURATION}
            text="The answer lies in the pigments—the natural chemicals—inside the leaf."
          />
        </Sequence>

        <Sequence from={SCENE_DURATION * 2} durationInFrames={SCENE_DURATION}>
          <SceneText 
            duration={SCENE_DURATION}
            text={<>Leaves are green because of <span style={{ color: '#4ade80' }}>Chlorophyll a</span> and <span style={{ color: '#4ade80' }}>Chlorophyll b</span>. They absorb sunlight to create energy.</>}
          />
        </Sequence>

        <Sequence from={SCENE_DURATION * 3} durationInFrames={SCENE_DURATION}>
          <SceneText 
            duration={SCENE_DURATION}
            text={<>So why are some leaves <span style={{ color: '#a855f7' }}>purple</span>? <br/><br/>This is due to a powerful group of chemicals...</>}
          />
        </Sequence>

        <Sequence from={SCENE_DURATION * 4} durationInFrames={SCENE_DURATION}>
          <SceneText 
            duration={SCENE_DURATION}
            text={<>...called <span style={{ color: '#a855f7' }}>Anthocyanins</span>. They act as a natural sunscreen and protect the plant from damage.</>}
          />
        </Sequence>

      </div>
    </AbsoluteFill>
  );
};
