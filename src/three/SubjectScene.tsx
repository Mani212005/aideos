import React, { useLayoutEffect, useMemo } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import {
  cameraAt,
  EPISODE,
  subjectDimAt,
  subjectScreenAt,
  subjectStateAt,
  TOTAL_FRAMES,
} from "../script";
import { EASE, THEME, useLayout } from "../theme";
import { SUBJECTS } from "./subjects";

/**
 * The 3D stage: camera, lights, atmosphere. Knows nothing about what it is
 * filming — the subject comes from the registry, chosen by the episode.
 */

/**
 * Script distances are authored in "subject lengths" for readability; this
 * converts them to world units. Tune framing here rather than in every scene.
 */
const DISTANCE_SCALE = 2.0;

/**
 * Drives the camera from the script. R3F does not re-read `<Canvas camera>` after
 * mount, so the camera is mutated here instead — before paint, every frame.
 */
const CameraRig: React.FC<{
  distanceBias: number;
  /** Layout default for where the subject sits, 0..1, y downward. Scenes may override. */
  baseScreen: { x: number; y: number };
}> = ({ distanceBias, baseScreen }) => {
  const frame = useCurrentFrame();
  const camera = useThree((s) => s.camera);
  const { width, height } = useVideoConfig();
  const setup = cameraAt(frame);
  const { x: screenX, y: screenY } = subjectScreenAt(frame, baseScreen);

  // A slow float on top of the scripted move — a perfectly still camera is the
  // fastest way to make 3D read as a screenshot.
  const floatY = Math.sin(frame / 78) * 0.16;
  const floatX = Math.cos(frame / 104) * 0.2;

  const distance = (setup.distance + distanceBias) * DISTANCE_SCALE;
  const yaw = setup.yaw + floatX * 0.05;
  const pitch = setup.pitch + floatY * 0.05;

  useLayoutEffect(() => {
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance + floatY,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    camera.lookAt(0, 0, 0);

    // Slide the subject off-centre by shifting the frustum rather than the look
    // target: a look-target offset would swing the subject around as the camera
    // orbits, while a view offset holds it in the same part of the frame.
    camera.setViewOffset(
      width,
      height,
      (0.5 - screenX) * width,
      (0.5 - screenY) * height,
      width,
      height,
    );
    camera.updateProjectionMatrix();
  }, [camera, distance, yaw, pitch, floatY, screenX, screenY, width, height]);

  return null;
};

/** Three-point rig plus an accent rim light that follows the subject state. */
const LightRig: React.FC<{ state: number }> = ({ state }) => {
  const rimColor = useMemo(
    () =>
      new THREE.Color(THEME.primary.glow).lerp(new THREE.Color(THEME.secondary.glow), state),
    [state],
  );

  return (
    <>
      <ambientLight intensity={0.5} color="#93a7b5" />
      {/* Key: warm, high and to the left. */}
      <directionalLight position={[-7, 9, 7]} intensity={2.5} color="#fff6e8" />
      {/* Fill: cool, low and to the right, well below the key. */}
      <directionalLight position={[8, -2, 5]} intensity={0.55} color="#9fc4e0" />
      {/* Rim: behind the subject, in the accent colour — separates it from the bg. */}
      <pointLight position={[2.5, 1.5, -6]} intensity={95} distance={22} color={rimColor} />
      {/* A soft bounce from below so the underside is never solid black. */}
      <pointLight position={[0, -5, 4]} intensity={26} distance={18} color="#3d5a4a" />
    </>
  );
};

export const SubjectScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const layout = useLayout();

  const state = subjectStateAt(frame);
  const Subject = SUBJECTS[EPISODE.subject];

  // Gentle continuous sway; the subject is never mechanically still.
  //
  // The drift term is a fraction of the *whole timeline*, not a per-frame rate.
  // A fixed rate is a trap: 0.00028/frame is imperceptible over a 60s short but
  // accumulates a full 358-degree rotation across a 12-minute episode, and the
  // subject spends whole chapters edge-on. Normalising to TOTAL_FRAMES means the
  // subject always turns the same modest amount, whatever the runtime.
  const sway = Math.sin(frame / 96) * 0.26 + (frame / TOTAL_FRAMES) * 0.55;
  const breathe = Math.sin(frame / 61);

  // Open on a slow reveal and settle out at the end.
  const entrance = interpolate(frame, [0, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });
  const exit = interpolate(frame, [TOTAL_FRAMES - 26, TOTAL_FRAMES], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.inOut,
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // Recede behind wide illustration modules so they stay readable.
        opacity: entrance * exit * subjectDimAt(frame),
        scale: interpolate(entrance, [0, 1], [1.07, 1]),
      }}
    >
      <ThreeCanvas
        width={width}
        height={height}
        camera={{ fov: 34, near: 0.1, far: 100 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <CameraRig distanceBias={layout.cameraDistanceBias} baseScreen={layout.subjectOffset} />
        <LightRig state={state} />
        <Subject state={state} sway={sway} breathe={breathe} />
      </ThreeCanvas>
    </div>
  );
};
