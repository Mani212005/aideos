/*
File Description: Component for loading and rendering 3D GLTF/GLB models with Draco compression and PBR material fallbacks in Remotion.
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface GLTFAssetViewerProps {
  modelPath: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  autoRotate?: boolean;
}

// Configures Draco geometry decoder for compressed 3D GLTF assets.
export function configureDracoLoader(): DRACOLoader {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  return dracoLoader;
}

// Normalizes GLTF mesh materials to ensure valid PBR roughness and metallic maps.
export function normalizePBRMaterials(scene: THREE.Group): void {
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.material) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.roughness === undefined) mat.roughness = 0.4;
        if (mat.metalness === undefined) mat.metalness = 0.2;
      }
    }
  });
}

// Renders a loaded GLTF 3D asset model driven deterministically by Remotion frame index.
export function GLTFAssetViewer({
  modelPath,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1.0,
  autoRotate = true,
}: GLTFAssetViewerProps) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const modelRef = useRef<THREE.Group>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;

  const [renderHandle] = useState(() => delayRender(`Loading GLTF asset: ${modelPath}`));

  const dracoLoader = useMemo(() => configureDracoLoader(), []);

  useEffect(() => {
    // Instantiate GLTFLoader and load GLB model with Draco compression support.
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    let loadedScene: THREE.Group | null = null;

    loader.load(
      modelPath,
      (gltf) => {
        normalizePBRMaterials(gltf.scene);
        loadedScene = gltf.scene;
        setModel(gltf.scene);
        continueRender(renderHandle);
      },
      undefined,
      (error) => {
        console.warn(`[GLTF Asset Viewer] Failed to load 3D model ${modelPath}:`, error);
        continueRender(renderHandle);
      }
    );

    return () => {
      if (loadedScene) {
        loadedScene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((mat) => mat.dispose());
            } else {
              mesh.material?.dispose();
            }
          }
        });
      }
    };
  }, [modelPath, dracoLoader, renderHandle]);

  if (!model) return null;

  const currentRotationY = autoRotate ? rotation[1] + time * 0.4 : rotation[1];

  return (
    <group
      ref={modelRef}
      position={position}
      rotation={[rotation[0], currentRotationY, rotation[2]]}
      scale={[scale, scale, scale]}
    >
      <primitive object={model} />
    </group>
  );
}
