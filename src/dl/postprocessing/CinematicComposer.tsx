/*
File Description: Implements a deterministic post-processing pipeline for Remotion Three.js scenes using EffectComposer, UnrealBloomPass, and OutputPass.
*/

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer, RenderPass, UnrealBloomPass } from 'three-stdlib';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface CinematicComposerProps {
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
}

// Configures ACESFilmic tone mapping and sRGB output on the WebGLRenderer.
export function configureCinematicRenderer(gl: THREE.WebGLRenderer) {
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.0;
  gl.outputColorSpace = THREE.SRGBColorSpace;
}

// Custom R3F component managing post-processing passes frame-by-frame for Remotion.
export function CinematicComposer({
  bloomStrength = 1.5,
  bloomRadius = 0.4,
  bloomThreshold = 0.2,
}: CinematicComposerProps) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);

  useEffect(() => {
    // Configure renderer properties for tone mapping and sRGB.
    configureCinematicRenderer(gl);

    // Initialize EffectComposer pipeline with RenderPass, UnrealBloomPass, and OutputPass.
    const composer = new EffectComposer(gl);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      bloomStrength,
      bloomRadius,
      bloomThreshold
    );
    composer.addPass(bloomPass);

    // Mandatory OutputPass to apply correct color space conversion without double-processing.
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    composerRef.current = composer;

    return () => {
      composer.dispose();
    };
  }, [gl, scene, camera, size, bloomStrength, bloomRadius, bloomThreshold]);

  useEffect(() => {
    // Sync composer size when canvas dimensions change.
    if (composerRef.current) {
      composerRef.current.setSize(size.width, size.height);
    }
  }, [size]);

  // Priority 1 hijacks R3F render loop so EffectComposer renders post-processed output exclusively.
  useFrame(() => {
    if (composerRef.current) {
      composerRef.current.render();
    }
  }, 1);

  return null;
}
