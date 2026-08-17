/*
File Description: Implements a 3-point studio lighting rig with HDRI environment maps and soft PCF shadow maps for photorealistic rendering in Remotion.
*/

import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { continueRender, delayRender } from 'remotion';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export interface StudioLightingProps {
  hdriPath?: string;
  keyIntensity?: number;
  fillIntensity?: number;
  rimIntensity?: number;
}

// Configures high-resolution PCF soft shadow maps on direction lights.
export function configureShadowLight(light: THREE.DirectionalLight): void {
  light.castShadow = true;
  light.shadow.mapSize.width = 2048;
  light.shadow.mapSize.height = 2048;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 50;
  light.shadow.bias = -0.0001;
}

// Renders 3-point studio lighting and loads HDRI environment reflections.
export function StudioLighting({
  hdriPath,
  keyIntensity = 2.0,
  fillIntensity = 0.8,
  rimIntensity = 1.5,
}: StudioLightingProps) {
  const { scene, gl } = useThree();
  const [renderHandle] = useState(() =>
    hdriPath ? delayRender(`Loading HDRI environment: ${hdriPath}`) : null
  );

  useEffect(() => {
    // Configure WebGLRenderer soft shadows.
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;

    if (!hdriPath) return;

    // Load HDRI environment map using RGBELoader and PMREMGenerator.
    const pmremGenerator = new THREE.PMREMGenerator(gl);
    pmremGenerator.compileEquirectangularShader();

    const rgbeLoader = new RGBELoader();
    rgbeLoader.load(
      hdriPath,
      (texture) => {
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.environment = envMap;
        texture.dispose();
        pmremGenerator.dispose();
        if (renderHandle) continueRender(renderHandle);
      },
      undefined,
      (error) => {
        console.warn(`[StudioLighting] Failed loading HDRI map ${hdriPath}:`, error);
        if (renderHandle) continueRender(renderHandle);
      }
    );
  }, [hdriPath, gl, scene, renderHandle]);

  return (
    <group>
      {/* Key Light - Main directional light with soft shadows */}
      <directionalLight
        position={[8, 12, 8]}
        intensity={keyIntensity}
        color="#F5F5F5"
        ref={(light) => light && configureShadowLight(light)}
      />

      {/* Fill Light - Soft blue ambient fill light */}
      <directionalLight position={[-8, 6, -4]} intensity={fillIntensity} color="#8A8A8E" />

      {/* Rim Light - Backlight for silhouetted rim glow highlights */}
      <directionalLight position={[0, 10, -10]} intensity={rimIntensity} color="#635BFF" />
    </group>
  );
}
