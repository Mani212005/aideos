/*
File Description: Implements custom GLSL vertex and fragment shaders for procedural glowing wireframe icosahedrons driven by Remotion frame index.
*/

import * as THREE from 'three';

export const GlowWireframeVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const GlowWireframeFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uGlowIntensity;
  uniform float uAudioAmp;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float rim = 1.0 - max(0.0, dot(vNormal, viewDir));
    float pulse = sin(uTime * 3.0 + vPosition.y * 2.0) * 0.5 + 0.5;
    
    vec3 finalColor = uColor * (rim * uGlowIntensity + pulse * 0.5 + uAudioAmp * 1.2);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// Creates a THREE.ShaderMaterial for glowing wireframe meshes with deterministic frame uniforms.
export function createGlowWireframeMaterial(
  color: string = '#635BFF',
  glowIntensity: number = 2.0
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GlowWireframeVertexShader,
    fragmentShader: GlowWireframeFragmentShader,
    uniforms: {
      uTime: { value: 0.0 },
      uColor: { value: new THREE.Color(color) },
      uGlowIntensity: { value: glowIntensity },
      uAudioAmp: { value: 0.0 },
    },
    wireframe: true,
    toneMapped: false,
    transparent: true,
  });
}
