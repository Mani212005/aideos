import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COLOR } from "../../theme";
import {
  createLeafGeometry,
  createLeafTextures,
  createStemGeometry,
} from "../leafGeometry";
import type { SubjectProps } from "./registry";

const PRIMARY = new THREE.Color(COLOR.green).convertSRGBToLinear();
const SECONDARY = new THREE.Color(COLOR.purple).convertSRGBToLinear();

type PatchedShader = {
  uniforms: Record<string, { value: unknown }>;
};

/**
 * SUBJECT: leaf
 *
 * `state` reads as chlorophyll (0) to anthocyanin (1).
 *
 * The colour change is a *wash across the surface*, not a crossfade of the whole
 * mesh: anthocyanin accumulating in a leaf spreads, so a wipe reads as the real
 * thing while a global tint reads as a CSS transition. That needs one value inside
 * the fragment shader, so `MeshPhysicalMaterial` is patched with `onBeforeCompile`
 * rather than replaced — patching keeps clearcoat, the env map and the bump map,
 * which a hand-written ShaderMaterial would throw away.
 */
export const LeafSubject: React.FC<SubjectProps> = ({ state, sway, breathe }) => {
  const geometry = useMemo(() => createLeafGeometry(), []);
  const stem = useMemo(() => createStemGeometry(6.4), []);
  const textures = useMemo(() => createLeafTextures(), []);

  // Held in a ref so the value is already correct on the very first compile,
  // before the layout effect below has had a chance to run.
  const stateRef = useRef(state);
  stateRef.current = state;

  const shaderRef = useRef<PatchedShader | null>(null);

  const material = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      // White, so the shader below owns the hue entirely.
      color: 0xffffff,
      map: textures.map,
      bumpMap: textures.bumpMap,
      bumpScale: 0.42,
      envMap: textures.envMap,
      envMapIntensity: 0.85,
      roughness: 0.46,
      metalness: 0,
      // Leaves are waxy: a thin specular coat over a rough diffuse body.
      clearcoat: 0.55,
      clearcoatRoughness: 0.28,
      sheen: 0.4,
      sheenColor: new THREE.Color("#dff5e6"),
      side: THREE.DoubleSide,
      // A little light bleeding through the blade, as with a leaf held to the sun.
      transmission: 0.12,
      thickness: 0.6,
    });

    m.onBeforeCompile = (shader) => {
      shader.uniforms.uWash = { value: stateRef.current };
      shader.uniforms.uFrom = { value: PRIMARY };
      shader.uniforms.uTo = { value: SECONDARY };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vLeafUv;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvLeafUv = uv;");

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uWash;
           uniform vec3 uFrom;
           uniform vec3 uTo;
           varying vec2 vLeafUv;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           {
             // Wash travels apex -> base, and leans on the veins so the pigment
             // front runs along them instead of arriving as a straight line.
             // "along" is 0 at the apex, 1 at the petiole.
             float along = 1.0 - vLeafUv.y;
             float veinBias = 0.055 * sin(vLeafUv.x * 34.0) + 0.035 * sin(vLeafUv.y * 21.0);
             // Overshoot the 0..1 range on both ends so uWash = 0 is fully "from"
             // and uWash = 1 is fully "to", veinBias included.
             float w = uWash * 1.8 - 0.4;
             float front = 1.0 - smoothstep(w, w + 0.3, along + veinBias);
             diffuseColor.rgb *= mix(uFrom, uTo, front);
           }`,
        );

      shaderRef.current = shader as unknown as PatchedShader;
    };

    return m;
  }, [textures]);

  const stemMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#7d9a6b"),
        roughness: 0.62,
        metalness: 0,
        clearcoat: 0.3,
        envMap: textures.envMap,
        envMapIntensity: 0.5,
      }),
    [textures],
  );

  // Runs before paint on every frame, so the uniform tracks the timeline exactly.
  useLayoutEffect(() => {
    const shader = shaderRef.current;
    if (shader) shader.uniforms.uWash.value = state;
    stemMaterial.color.set(state > 0.55 ? "#8a7aa8" : "#7d9a6b");
  }, [state, stemMaterial]);

  return (
    <group rotation={[breathe * 0.05, sway, breathe * 0.09]}>
      <mesh geometry={geometry} material={material} />
      <mesh geometry={stem} material={stemMaterial} />
    </group>
  );
};
