/**
 * File Description: Pure deterministic compiler for the Aideos 2D Scene Graph (Phase 3).
 * Compiles high-level scenes, actions, and tracks into dense, verified per-frame execution data.
 * Implements joint-mask blending, Catmull-Rom spline interpolation, rest-hold gap anchoring (C-14),
 * hierarchical kinematic transform composition (C-6), environment sub-rotation (D1), and per-frame derived layering (D5).
 */

import type { Scene, ActorInstance, EnvironmentAsset, SchemaVersion, Keyframe } from "./types";
import { validateScene } from "./validateScene";
import { getActionDefinition, getAffectedJointsForAction } from "./actions";
import { getCharacterRigById } from "../characters";
import { evaluateCatmullRomSpline } from "../motion/spline";
import { verifyTrajectoryContinuity } from "../motion/verifier";
import { MAX_ALLOWED_VELOCITY_DISCONTINUITY_DEG_PER_SEC } from "../validateFilm";

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
}

export interface CompiledFrame {
  frame: number;
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
}

/** Evaluates 2D rigid transform rotating point (cx, cy) around pivot (px, py) by angleDeg. */
export function rotatePointAroundPivot(
  cx: number,
  cy: number,
  px: number,
  py: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = cx - px;
  const dy = cy - py;

  return {
    x: px + (dx * cos - dy * sin),
    y: py + (dx * sin + dy * cos),
  };
}

/**
 * Compiles a validated Scene into a CompiledScene data structure.
 * @param scene Complete validated scene object.
 * @param options Optional compilation overrides.
 */
export function compileScene(scene: Scene, options: CompileOptions = {}): CompiledScene {
  const startTime = Date.now();

  // 1. Semantic Validation
  const validation = validateScene(scene);
  if (!validation.isValid) {
    const errMessages = validation.errors.map((e) => `[Rule ${e.rule}] ${e.message}`).join("; ");
    throw new Error(`SCENE_VALIDATION_FAILED: ${errMessages}`);
  }

  const warnings: string[] = validation.warnings.map((w) => w.message);
  const totalFrames = scene.durationFrames;
  const fps = scene.fps || 30;
  const durationSec = totalFrames / fps;
  const velTolerance = options.velocityToleranceDegPerSec ?? MAX_ALLOWED_VELOCITY_DISCONTINUITY_DEG_PER_SEC;

  let maxVelocityDiscontinuity = 0;

  // 2. Pre-compile Actor Joint Trajectories
  // actorId -> jointId -> number[] (length = totalFrames)
  const actorJointCurves: Map<string, Map<string, number[]>> = new Map();

  for (const actor of scene.actors) {
    const rig = getCharacterRigById(actor.rigId)!;
    const jointCurves: Map<string, number[]> = new Map();
    actorJointCurves.set(actor.instanceId, jointCurves);

    // Collect all joint names defined in rig
    const allRigJoints = rig.groups.map((g) => g.id);
    for (const joint of allRigJoints) {
      // Default: 0 deg across all frames
      jointCurves.set(joint, new Array(totalFrames).fill(0));
    }

    // A. Resolve ScheduledActions with Joint-Masking & Rest-Hold Anchoring (C-14)
    if (actor.actions && actor.actions.length > 0) {
      // Sort actions by startFrame
      const sortedActions = [...actor.actions].sort((a, b) => a.startFrame - b.startFrame);

      for (const joint of allRigJoints) {
        // Collect actions affecting this specific joint
        const relevantActions = sortedActions.filter((act) => {
          const affected = getAffectedJointsForAction(act);
          return affected.includes(joint);
        });

        if (relevantActions.length === 0) continue;

        // Joint-Masking Conflict Resolution:
        // Build timeline intervals for this joint. Later starting action wins for overlapping frames.
        const rawKnots: Array<{ frame: number; value: number }> = [];

        // Track active action intervals for gap analysis
        const actionIntervals: Array<{ start: number; end: number; actionId: string }> = [];

        for (let aIdx = 0; aIdx < relevantActions.length; aIdx++) {
          const act = relevantActions[aIdx];
          const actDef = getActionDefinition(act.actionId)!;
          const actKeyframes = actDef.generate({
            durationFrames: act.durationFrames,
            intensity: act.intensity,
            side: act.side,
          })[joint] || [];

          const actStart = act.startFrame;
          const actEnd = act.startFrame + act.durationFrames;
          actionIntervals.push({ start: actStart, end: actEnd, actionId: act.actionId });

          // Next action start frame on this joint (if overlapping)
          const nextStart = aIdx + 1 < relevantActions.length ? relevantActions[aIdx + 1].startFrame : Infinity;

          if (nextStart < actEnd) {
            warnings.push(
              `OVERLAPPING_ACTION_OVERRIDE: Actor "${actor.instanceId}" joint "${joint}" has overlapping actions "${act.actionId}" [${actStart}, ${actEnd}] and "${relevantActions[aIdx + 1].actionId}" [${relevantActions[aIdx + 1].startFrame}, ${relevantActions[aIdx + 1].startFrame + relevantActions[aIdx + 1].durationFrames}]. Action "${relevantActions[aIdx + 1].actionId}" takes precedence from frame ${relevantActions[aIdx + 1].startFrame}.`,
            );
          }

          // Include keyframes only up to the handover frame (nextStart)
          for (const kf of actKeyframes) {
            const absFrame = Math.round(actStart + kf.t * act.durationFrames);
            if (absFrame < nextStart) {
              rawKnots.push({ frame: Math.min(totalFrames - 1, Math.max(0, absFrame)), value: kf.value });
            }
          }
        }

        // Rest-Hold Gap Anchoring (C-14):
        // Insert rest anchors (0 deg) for gaps > 15 frames between actions or at start/end
        const anchorKnots: Array<{ frame: number; value: number }> = [];
        const buffer = 5;

        // Gap before first action
        if (actionIntervals[0].start > 15) {
          anchorKnots.push({ frame: 0, value: 0 });
          anchorKnots.push({ frame: Math.max(0, actionIntervals[0].start - buffer), value: 0 });
        }

        // Gaps between consecutive actions
        for (let i = 0; i < actionIntervals.length - 1; i++) {
          const gapStart = actionIntervals[i].end;
          const gapEnd = actionIntervals[i + 1].start;
          const gap = gapEnd - gapStart;
          if (gap > 15) {
            const b = Math.min(buffer, Math.floor(gap / 3));
            anchorKnots.push({ frame: gapStart + b, value: 0 });
            anchorKnots.push({ frame: gapEnd - b, value: 0 });
          }
        }

        // Gap after last action
        const lastEnd = actionIntervals[actionIntervals.length - 1].end;
        if (totalFrames - lastEnd > 15) {
          anchorKnots.push({ frame: Math.min(totalFrames - 1, lastEnd + buffer), value: 0 });
          anchorKnots.push({ frame: totalFrames - 1, value: 0 });
        }

        // Combine raw knots and anchor knots, deduplicate, and sort by frame
        const combinedKnots = [...rawKnots, ...anchorKnots];
        const knotsByFrame = new Map<number, number>();
        for (const k of combinedKnots) {
          knotsByFrame.set(k.frame, k.value);
        }

        const sortedKnotFrames = Array.from(knotsByFrame.keys()).sort((a, b) => a - b);
        const finalKnots = sortedKnotFrames.map((f) => ({ frame: f, value: knotsByFrame.get(f)! }));

        // Ensure boundary coverage at frame 0 and totalFrames - 1
        if (finalKnots[0].frame > 0) {
          finalKnots.unshift({ frame: 0, value: 0 });
        }
        if (finalKnots[finalKnots.length - 1].frame < totalFrames - 1) {
          finalKnots.push({ frame: totalFrames - 1, value: 0 });
        }

        // Interpolate via Catmull-Rom Spline
        const splineKnots = finalKnots.map((k) => ({
          t: totalFrames > 1 ? k.frame / (totalFrames - 1) : 0,
          val: k.value,
        }));

        const evalSpline = (t: number) => evaluateCatmullRomSpline(splineKnots, t);

        // Continuity Verification (C-4)
        if (!options.skipContinuityVerification && splineKnots.length > 2) {
          const interiorKnots = splineKnots.slice(1, -1).map((k) => k.t);
          const continuityReport = verifyTrajectoryContinuity(
            evalSpline,
            interiorKnots,
            durationSec,
            1e-4,
            velTolerance,
          );

          if (continuityReport.maxPhysicalVelocityDiscontinuity > maxVelocityDiscontinuity) {
            maxVelocityDiscontinuity = continuityReport.maxPhysicalVelocityDiscontinuity;
          }

          if (!continuityReport.isC1Continuous) {
            const badKnot =
              continuityReport.knots.find((k) => !k.isC1Continuous) || continuityReport.knots[0];
            const badFrame = Math.round(badKnot.t * (totalFrames - 1));
            throw new Error(
              `MOTION_CONTINUITY_VIOLATION: Actor "${actor.instanceId}" joint "${joint}" has a velocity discontinuity of ${badKnot.physicalVelocityDiscontinuity.toFixed(3)} deg/s (raw normalized Δv=${badKnot.rawNormalizedDiscontinuity.toFixed(3)}) at frame ${badFrame} (exceeds physical threshold ${velTolerance} deg/s)`,
            );
          }
        }

        // Fill per-frame joint values
        const curve = new Array<number>(totalFrames);
        for (let f = 0; f < totalFrames; f++) {
          const normT = totalFrames > 1 ? f / (totalFrames - 1) : 0;
          curve[f] = evalSpline(normT);
        }
        jointCurves.set(joint, curve);
      }
    }

    // B. Overlay explicit jointTracks if provided
    if (actor.jointTracks) {
      for (const [joint, tr] of Object.entries(actor.jointTracks)) {
        if (!tr.keyframes || tr.keyframes.length === 0) continue;
        const splineKnots = tr.keyframes.map((k) => ({
          t: totalFrames > 1 ? k.frame / (totalFrames - 1) : 0,
          val: k.value,
        }));
        if (splineKnots[0].t > 0) splineKnots.unshift({ t: 0, val: splineKnots[0].val });
        if (splineKnots[splineKnots.length - 1].t < 1) {
          splineKnots.push({ t: 1, val: splineKnots[splineKnots.length - 1].val });
        }

        // Select interpolation: Catmull-Rom (default) or Piecewise Linear (if C0 requested)
        const isC0 = tr.continuity === "C0";
        const evalTrack = (t: number): number => {
          if (isC0) {
            for (let i = 0; i < splineKnots.length - 1; i++) {
              if (t >= splineKnots[i].t && t <= splineKnots[i + 1].t) {
                const span = splineKnots[i + 1].t - splineKnots[i].t;
                const localT = span > 0 ? (t - splineKnots[i].t) / span : 0;
                return splineKnots[i].val + localT * (splineKnots[i + 1].val - splineKnots[i].val);
              }
            }
            return splineKnots[splineKnots.length - 1].val;
          }
          return evaluateCatmullRomSpline(splineKnots, t);
        };

        // Verify continuity on explicit jointTrack
        if (!options.skipContinuityVerification && splineKnots.length > 2) {
          const interiorKnots = splineKnots.slice(1, -1).map((k) => k.t);
          const continuityReport = verifyTrajectoryContinuity(
            evalTrack,
            interiorKnots,
            durationSec,
            1e-4,
            velTolerance,
          );
          if (continuityReport.maxPhysicalVelocityDiscontinuity > maxVelocityDiscontinuity) {
            maxVelocityDiscontinuity = continuityReport.maxPhysicalVelocityDiscontinuity;
          }
          if (!continuityReport.isC1Continuous) {
            const badKnot =
              continuityReport.knots.find((k) => !k.isC1Continuous) || continuityReport.knots[0];
            const badFrame = Math.round(badKnot.t * (totalFrames - 1));
            throw new Error(
              `MOTION_CONTINUITY_VIOLATION: Actor "${actor.instanceId}" joint "${joint}" has a velocity discontinuity of ${badKnot.physicalVelocityDiscontinuity.toFixed(3)} deg/s (raw normalized Δv=${badKnot.rawNormalizedDiscontinuity.toFixed(3)}) at frame ${badFrame} (exceeds physical threshold ${velTolerance} deg/s)`,
            );
          }
        }

        const curve = new Array<number>(totalFrames);
        for (let f = 0; f < totalFrames; f++) {
          const normT = totalFrames > 1 ? f / (totalFrames - 1) : 0;
          curve[f] = evalTrack(normT);
        }
        jointCurves.set(joint, curve);
      }
    }
  }

  // 3. Pre-compile Asset Transforms & SubGroup Rotations (D1)
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

  // 4. Pre-compile Actor Positions (positionTracks)
  const actorPosCurves: Map<string, { x: number[]; y: number[] }> = new Map();
  for (const actor of scene.actors) {
    const interpolatePosTrack = (trackId: string, defaultVal: number): number[] => {
      const tr = actor.positionTracks?.find((t) => t.trackId === trackId);
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

    actorPosCurves.set(actor.instanceId, {
      x: interpolatePosTrack("x", actor.position.x),
      y: interpolatePosTrack("y", actor.position.y),
    });
  }

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
        });
      }
    }

    // Actors
    for (const actor of scene.actors) {
      const rig = getCharacterRigById(actor.rigId)!;
      const jc = actorJointCurves.get(actor.instanceId)!;
      const pc = actorPosCurves.get(actor.instanceId)!;

      const currentJointAngles: Record<string, number> = {};
      for (const [joint, curve] of jc.entries()) {
        currentJointAngles[joint] = curve[f];
      }

      // Step 5: Hierarchical Kinematic Transform Composition (C-6)
      const composedPivots: Record<string, { x: number; y: number; rotation: number }> = {};
      for (const group of rig.groups) {
        const localAngle = currentJointAngles[group.id] ?? group.defaultRotation ?? 0;
        if (!group.parent) {
          // Root group
          composedPivots[group.id] = {
            x: group.pivot.x,
            y: group.pivot.y,
            rotation: localAngle,
          };
        } else {
          // Child group: transformed by parent pivot & rotation
          const parentPivot = composedPivots[group.parent] || {
            x: group.pivot.x,
            y: group.pivot.y,
            rotation: 0,
          };
          const rotated = rotatePointAroundPivot(
            group.pivot.x,
            group.pivot.y,
            parentPivot.x,
            parentPivot.y,
            parentPivot.rotation,
          );
          composedPivots[group.id] = {
            x: rotated.x,
            y: rotated.y,
            rotation: parentPivot.rotation + localAngle,
          };
        }
      }

      const posY = pc.y[f];
      const hasExplicit = actor.layer !== undefined;
      const resolvedLayer = hasExplicit ? actor.layer! : Math.round(posY);

      entitiesAtFrame.push({
        entityId: actor.instanceId,
        kind: "actor",
        rigId: actor.rigId,
        resolvedLayer,
        layerSource: hasExplicit ? "explicit" : "derived",
        transform: {
          x: pc.x[f],
          y: posY,
          scale: actor.scale,
          rotation: 0,
          opacity: 1.0,
        },
        joints: currentJointAngles,
        composedPivots,
      });
    }

    // Step 7: Sort ascending by resolvedLayer (stable tie-breaking)
    entitiesAtFrame.sort((a, b) => a.resolvedLayer - b.resolvedLayer);

    compiledFrames[f] = {
      frame: f,
      entities: entitiesAtFrame,
    };
  }

  const compileTimeMs = Date.now() - startTime;

  return {
    schemaVersion: scene.schemaVersion,
    sceneId: scene.sceneId,
    fps,
    durationFrames: totalFrames,
    frames: compiledFrames,
    meta: {
      compiledAt: new Date().toISOString(),
      continuityVerified: !options.skipContinuityVerification,
      maxVelocityDiscontinuity,
      warnings,
      compileTimeMs,
    },
  };
}
