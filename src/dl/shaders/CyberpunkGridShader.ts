/*
File Description: Implements a procedural neon grid floor shader material driven deterministically by Remotion frame index.
*/

import * as THREE from 'three';

export const CyberpunkGridVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const CyberpunkGridFragmentShader = `
  uniform float uTime;
  uniform vec3 uGridColor;
  varying vec2 vUv;

  void main() {
    vec2 gridUv = fract(vUv * 30.0 + vec2(0.0, uTime * 0.5));
    float line = step(0.96, gridUv.x) + step(0.96, gridUv.y);
    vec3 color = mix(vec3(0.04, 0.04, 0.05), uGridColor, min(line, 1.0));
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Creates a THREE.ShaderMaterial for animated neon cyberpunk floor grids.
export function createCyberpunkGridMaterial(color: string = '#635BFF'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CyberpunkGridVertexShader,
    fragmentShader: CyberpunkGridFragmentShader,
    uniforms: {
      uTime: { value: 0.0 },
      uGridColor: { value: new THREE.Color(color) },
    },
    side: THREE.DoubleSide,
  });
}
