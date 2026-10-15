/**
 * File Description: One persistent orthographic cel stage shared by editor Player and Remotion export.
 * Inputs and outputs: resolved scene, absolute frame and viewport -> fully drawn deterministic stage pixels.
 * Used by: SceneStage within FilmView. Captures wait for shader preparation and exact frame draw. Any character spec renders here.
 */
import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { AbsoluteFill, useCurrentFrame, useDelayRender, useBufferState, useRemotionEnvironment } from "remotion";
import { Group, NoToneMapping, OrthographicCamera, SRGBColorSpace } from "three";
import { createPerformanceEvaluator } from "../performance/evaluate";
import { rigFromCharacter } from "../characters/rig";
import { addCelLights, buildCharacter } from "./characters/build";
import { applyCharacter } from "./characters/apply";
import { applyProp, buildProp } from "./props/paperGlider";
import { resolveStageCharacter } from "../characters/resolve";
import { compileCameraTrack } from "./cameraTrack";
import { applyStageCamera } from "./projection";
import { validateStage } from "./validateStage";
import { CEL_TREATMENT } from "./rigs/registry";
import type { Scene } from "./types";

interface Props { scene: Scene; width: number; height: number }

// Commits complete absolute state, prepares shaders and draws before releasing each frame's capture barrier.
function FrameCommit({ scene: manifest, frame, width, height, ready }: Props & { frame: number; ready: (error?: string) => void }) {
  const { gl, scene: world, set } = useThree();
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const { delayPlayback } = useBufferState();
  const generation = React.useRef(0);
  const resources = React.useRef<ReturnType<typeof createResources> | null>(null);

  // Owns all mutable resources within this WebGL context and verifies the manifest before allocating geometry.
  const createResources = React.useCallback(() => {
    const errors = validateStage(manifest);
    if (errors.length) throw new Error(errors.join("\n"));
    const camera = new OrthographicCamera(-960, 960, 960, -960, 0.1, 10000);
    const root = new Group();
    addCelLights(root);
    const entries = manifest.performances!.map((p) => {
      const actor = manifest.cast!.find((c) => c.id === p.actor);
      const propCast = manifest.cast!.find((c) => c.id === p.prop);
      const resolved = actor?.kind === "character" ? resolveStageCharacter(actor) : undefined;
      if (!resolved) throw new Error(`Missing character ${p.actor}`);
      const { cast: resolvedActor, spec: character } = resolved;
      if (!propCast || propCast.kind !== "prop") throw new Error(`Missing prop ${p.prop}`);
      // Each performer owns private geometry and face texture built from its verified spec.
      const art = buildCharacter(character, document.createElement("canvas"));
      const prop = buildProp(propCast.asset);
      const placement = new Group();
      placement.position.set(resolvedActor.position[0] - manifest.sceneSize.w / 2, manifest.sceneSize.h / 2 - resolvedActor.position[1], resolvedActor.depth);
      placement.scale.setScalar(resolvedActor.unitsToStage);
      placement.add(art.rig.root, prop.root);
      root.add(placement);
      return { art, prop, evaluate: createPerformanceEvaluator(rigFromCharacter(character), p.data) };
    });
    world.add(root);
    set({ camera });
    gl.setPixelRatio(CEL_TREATMENT.dpr);
    gl.setSize(width, height, false);
    gl.outputColorSpace = SRGBColorSpace;
    gl.toneMapping = NoToneMapping;
    gl.toneMappingExposure = CEL_TREATMENT.exposure;
    gl.setClearColor(0, 0);
    return { camera, root, entries, cameraFrames: compileCameraTrack(manifest.camera, manifest.durationFrames, manifest.sceneSize), compiled: false };
  }, [manifest, world, set, gl, width, height]);

  React.useLayoutEffect(() => {
    const currentGeneration = generation;
    // A context-loss failure cannot silently capture a blank stage.
    const lost = () => { ready("Scene graphics context was lost. Reload the film."); cancelRender(new Error("Three stage WebGL context lost")); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      currentGeneration.current++;
      gl.domElement.removeEventListener("webglcontextlost", lost);
      if (resources.current) {
        world.remove(resources.current.root);
        resources.current.entries.forEach(({ art, prop }) => { art.dispose(); prop.dispose(); });
        resources.current = null;
      }
    };
  }, [manifest, gl, world, cancelRender, ready]);

  React.useLayoutEffect(() => {
    const token = ++generation.current;
    const handle = delayRender(`Three stage ${manifest.sceneId}: frame ${frame} committed and drawn`);
    const playback = delayPlayback();
    let released = false;
    // Releases each frame barrier and Player buffer once, including cancellation and StrictMode teardown.
    const release = () => { if (!released) { released = true; continueRender(handle); playback.unblock(); } };
    // Uses the requested frame after readiness, rejecting obsolete shader completions.
    const draw = async () => {
      try {
        const res = resources.current ?? (resources.current = createResources());
        const pose = res.cameraFrames[frame];
        const cam = res.camera;
        applyStageCamera(cam, pose, width, height, manifest.sceneSize);
        for (const entry of res.entries) { const state = entry.evaluate(frame); applyCharacter(entry.art, state); applyProp(entry.prop, state); }
        world.updateMatrixWorld(true);
        if (!res.compiled) { await gl.compileAsync(world, cam); res.compiled = true; }
        if (generation.current !== token) return;
        gl.render(world, cam);
        gl.getContext().finish();
        gl.domElement.dataset.stageFrame = String(frame);
        ready();
        release();
      } catch (error) {
        if (generation.current !== token) return;
        const err = error instanceof Error ? error : new Error(String(error));
        ready(err.message); cancelRender(err); release();
      }
    };
    void draw();
    return release;
  }, [frame, manifest, width, height, gl, world, delayRender, continueRender, cancelRender, delayPlayback, ready, createResources]);
  return null;
}

// Reads film time once and keeps the host outside shot sequences with canonical DPR and viewport.
export const ThreeStage: React.FC<Props> = ({ scene, width, height }) => {
  const current = useCurrentFrame();
  const frame = Math.max(0, Math.min(scene.durationFrames - 1, current));
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = React.useState(() => delayRender(`Three stage ${scene.sceneId} initial readiness`));
  const [status, setStatus] = React.useState<string | null>("Loading scene...");
  const { isPlayer } = useRemotionEnvironment();
  // Signals first complete draw and leaves explicit errors visible in the preview.
  const ready = React.useCallback((error?: string) => { setStatus(error ?? null); continueRender(handle); }, [handle, continueRender]);
  React.useEffect(() => () => continueRender(handle), [handle, continueRender]);
  return <AbsoluteFill>
    <ThreeCanvas width={width} height={height} dpr={CEL_TREATMENT.dpr} frameloop="never" gl={{ antialias: CEL_TREATMENT.antialias, alpha: true, preserveDrawingBuffer: true }}>
      <FrameCommit scene={scene} frame={frame} width={width} height={height} ready={ready} />
    </ThreeCanvas>
    {isPlayer && status ? <AbsoluteFill role="status" style={{ alignItems: "center", justifyContent: "center", color: "white" }}>{status}</AbsoluteFill> : null}
  </AbsoluteFill>;
};
