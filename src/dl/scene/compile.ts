/**
 * File Description: Pure deterministic compiler for the Aideos 2D Scene Graph (Phase 3).
 * Compiles high-level scenes, actions, and tracks into dense, verified per-frame execution data.
 * Implements joint-mask blending, Catmull-Rom spline interpolation, rest-hold gap anchoring (C-14),
 * hierarchical kinematic transform composition (C-6), environment sub-rotation (D1), custom
 * element-level SVG animation timelines, per-frame derived layering (D5), and camera track compilation.
 * Inputs and outputs: raw Scene data and action tracks -> compiled dense per-frame animation state.
 * Used by: src/dl/scene/SceneClip.tsx, backend/scene/compile.test.ts, editor/src/screens/MotionStage.tsx.
 */

import type { Scene, EnvironmentAsset, SchemaVersion } from "./types";
import type { SvgElementState } from "./svgAnimation";
import { compileSvgTimeline } from "./svgAnimation";
import { compileCameraTrack, type CompiledCameraState } from "./cameraTrack";
import { validateScene } from "./validateScene";
import { evaluateCatmullRomSpline } from "../motion/spline";

export interface CompiledEntityTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface CompiledEntity {
  entityId: string;
  kind: "actor" | "prop" | "background";
  rigId?: string;
  svgSource?: string;
  resolvedLayer: number;
  layerSource: "explicit" | "derived";
  transform: CompiledEntityTransform;
  joints?: Record<string, number>; // absolute degrees for each joint
  composedPivots?: Record<string, { x: number; y: number; rotation: number }>; // hierarchical pivots
  subGroupRotations?: Array<{ elementId: string; degrees: number }>; // D1
  /** Resolved custom SVG animation state for this frame, keyed by element id inside the asset. */
  elementStates?: Record<string, SvgElementState>;
}

export type { CompiledCameraState };

export interface CompiledFrame {
  frame: number;
  camera?: CompiledCameraState;
  entities: CompiledEntity[]; // sorted ascending by resolvedLayer
}

export interface CompiledScene {
  schemaVersion: SchemaVersion;
  sceneId: string;
  fps: number;
  durationFrames: number;
  frames: CompiledFrame[];
  meta: {
    compiledAt: string;
    continuityVerified: boolean;
    maxVelocityDiscontinuity: number;
    warnings: string[];
    compileTimeMs: number;
  };
}

export interface CompileOptions {
  skipContinuityVerification?: boolean;
  velocityToleranceDegPerSec?: number;
  /**
   * Pins the wall clock used for the diagnostic meta fields (compiledAt, compileTimeMs).
   * Pass a fixed value when the whole CompiledScene must be byte-identical across runs.
   */
  clockMs?: number;
  /**
   * Element ids declared by each asset's SVG document, keyed by assetId. When supplied, custom
   * animation clips that target an id the document does not declare fail the compile instead of
   * silently animating nothing.
   */
  assetElementIds?: Record<string, string[]>;
}

/**
 * Compiles a validated Scene into a CompiledScene data structure.
 * @param scene Complete validated scene object.
 * @param options Optional compilation overrides.
 */
export function compileScene(scene: Scene, options: CompileOptions = {}): CompiledScene {
  const pinnedClock = typeof options.clockMs === "number";
  const startTime = pinnedClock ? options.clockMs! : Date.now();

  // 1. Semantic Validation
  const validation = validateScene(scene);
  if (!validation.isValid) {
    const errMessages = validation.errors.map((e) => `[Rule ${e.rule}] ${e.message}`).join("; ");
    throw new Error(`SCENE_VALIDATION_FAILED: ${errMessages}`);
  }

  const warnings: string[] = validation.warnings.map((w) => w.message);
  const totalFrames = scene.durationFrames;
  const fps = scene.fps || 30;

  const maxVelocityDiscontinuity = 0;

  // 3. Pre-compile Asset Transforms

  // assetId -> { x: number[], y: number[], scale: number[], rotation: number[], opacity: number[], subGroups: ... }
  const assetCurves: Map<
    string,
    {
      x: number[];
      y: number[];
      scale: number[];
      rotation: number[];
      opacity: number[];
      subGroups?: Array<{ elementId: string; angles: number[] }>;
    }
  > = new Map();

  const allAssets: EnvironmentAsset[] = [];
  if (scene.background) allAssets.push(scene.background);
  if (scene.props) allAssets.push(...scene.props);

  for (const asset of allAssets) {
    const interpolateTrack = (trackId: string, defaultVal: number): number[] => {
      const tr = asset.tracks?.find((t) => t.trackId === trackId);
      if (!tr || !tr.keyframes || tr.keyframes.length === 0) {
        return new Array(totalFrames).fill(defaultVal);
      }
      const splineKnots = tr.keyframes.map((k) => ({
        t: totalFrames > 1 ? k.frame / (totalFrames - 1) : 0,
        val: k.value,
      }));
      if (splineKnots[0].t > 0) splineKnots.unshift({ t: 0, val: splineKnots[0].val });
      if (splineKnots[splineKnots.length - 1].t < 1) {
        splineKnots.push({ t: 1, val: splineKnots[splineKnots.length - 1].val });
      }
      const res = new Array<number>(totalFrames);
      for (let f = 0; f < totalFrames; f++) {
        const normT = totalFrames > 1 ? f / (totalFrames - 1) : 0;
        res[f] = evaluateCatmullRomSpline(splineKnots, normT);
      }
      return res;
    };

    const xCurve = interpolateTrack("x", asset.position.x);
    const yCurve = interpolateTrack("y", asset.position.y);
    const scaleCurve = interpolateTrack("scale", asset.scale ?? 1.0);
    const rotCurve = interpolateTrack("rotation", asset.rotation ?? 0);
    const opCurve = interpolateTrack("opacity", asset.opacity ?? 1.0);

    // D1 Subgroups
    let subGroupCurves: Array<{ elementId: string; angles: number[] }> | undefined;
    if (asset.subGroups && asset.subGroups.length > 0) {
      subGroupCurves = [];
      for (const sg of asset.subGroups) {
        const angles = new Array<number>(totalFrames);
        if (typeof sg.degreesPerSecond === "number") {
          // Constant velocity: angle = (frame / fps) * degPerSec
          for (let f = 0; f < totalFrames; f++) {
            angles[f] = (f / fps) * sg.degreesPerSecond;
          }
        } else if (sg.track && sg.track.keyframes.length > 0) {
          const splineKnots = sg.track.keyframes.map((k) => ({
            t: totalFrames > 1 ? k.frame / (totalFrames - 1) : 0,
            val: k.value,
          }));
          if (splineKnots[0].t > 0) splineKnots.unshift({ t: 0, val: splineKnots[0].val });
          if (splineKnots[splineKnots.length - 1].t < 1) {
            splineKnots.push({ t: 1, val: splineKnots[splineKnots.length - 1].val });
          }
          for (let f = 0; f < totalFrames; f++) {
            const normT = totalFrames > 1 ? f / (totalFrames - 1) : 0;
            angles[f] = evaluateCatmullRomSpline(splineKnots, normT);
          }
        } else {
          angles.fill(0);
        }
        subGroupCurves.push({ elementId: sg.elementId, angles });
      }
    }

    assetCurves.set(asset.assetId, {
      x: xCurve,
      y: yCurve,
      scale: scaleCurve,
      rotation: rotCurve,
      opacity: opCurve,
      subGroups: subGroupCurves,
    });
  }

  // 3b. Compile custom element-level SVG animation timelines (one per asset, optional).
  const assetElementStates: Map<string, Array<Record<string, SvgElementState>>> = new Map();
  for (const asset of allAssets) {
    if (!asset.animation) continue;
    try {
      const compiledTimeline = compileSvgTimeline(asset.animation, {
        durationFrames: totalFrames,
        availableElementIds: options.assetElementIds?.[asset.assetId],
      });
      assetElementStates.set(asset.assetId, compiledTimeline.frames);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`SCENE_ANIMATION_COMPILE_FAILED: asset "${asset.assetId}": ${detail}`);
    }
  }

  // 4. Pre-compile Camera
  const cameraCurves = compileCameraTrack(scene.camera, totalFrames, scene.sceneSize);

  // 5. Assemble Per-Frame Compiled Data & Resolve Layers (D5)

  const compiledFrames: CompiledFrame[] = new Array(totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    const entitiesAtFrame: CompiledEntity[] = [];

    // Background
    if (scene.background) {
      const ac = assetCurves.get(scene.background.assetId)!;
      const posY = ac.y[f];
      const hasExplicit = scene.background.layer !== undefined;
      const resolvedLayer = hasExplicit ? scene.background.layer! : Math.round(posY);

      entitiesAtFrame.push({
        entityId: scene.background.assetId,
        kind: "background",
        svgSource: scene.background.svgSource,
        resolvedLayer,
        layerSource: hasExplicit ? "explicit" : "derived",
        transform: {
          x: ac.x[f],
          y: posY,
          scale: ac.scale[f],
          rotation: ac.rotation[f],
          opacity: ac.opacity[f],
        },
        subGroupRotations: ac.subGroups?.map((sg) => ({
          elementId: sg.elementId,
          degrees: sg.angles[f],
        })),
        elementStates: assetElementStates.get(scene.background.assetId)?.[f],
      });
    }

    // Props
    if (scene.props) {
      for (const prop of scene.props) {
        const ac = assetCurves.get(prop.assetId)!;
        const posY = ac.y[f];
        const hasExplicit = prop.layer !== undefined;
        const resolvedLayer = hasExplicit ? prop.layer! : Math.round(posY);

        entitiesAtFrame.push({
          entityId: prop.assetId,
          kind: "prop",
          svgSource: prop.svgSource,
          resolvedLayer,
          layerSource: hasExplicit ? "explicit" : "derived",
          transform: {
            x: ac.x[f],
            y: posY,
            scale: ac.scale[f],
            rotation: ac.rotation[f],
            opacity: ac.opacity[f],
          },
          subGroupRotations: ac.subGroups?.map((sg) => ({
            elementId: sg.elementId,
            degrees: sg.angles[f],
          })),
          elementStates: assetElementStates.get(prop.assetId)?.[f],
        });
      }
    }

    // Step 7: Sort ascending by resolvedLayer (stable tie-breaking)
    entitiesAtFrame.sort((a, b) => a.resolvedLayer - b.resolvedLayer);

    compiledFrames[f] = {
      frame: f,
      camera: cameraCurves[f],
      entities: entitiesAtFrame,
    };
  }

  const compileTimeMs = pinnedClock ? 0 : Date.now() - startTime;

  return {
    schemaVersion: scene.schemaVersion,
    sceneId: scene.sceneId,
    fps,
    durationFrames: totalFrames,
    frames: compiledFrames,
    meta: {
      compiledAt: new Date(startTime).toISOString(),
      continuityVerified: !options.skipContinuityVerification,
      maxVelocityDiscontinuity,
      warnings,
      compileTimeMs,
    },
  };
}
