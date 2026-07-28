import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR, EASE, THEME } from "../theme";
import { withAlpha } from "../palette";
import { sceneAt, subjectStateAt, SCRIPT } from "../script";
import type { BackdropKind } from "../schema";

/**
 * Background treatments.
 *
 * A twelve-minute video on one static gradient reads as a slide deck. Each
 * chapter gets its own treatment, and consecutive treatments cross-fade across
 * the cut rather than switching, so the change registers as moving somewhere
 * new instead of as an edit.
 *
 * Every layer is CSS/SVG driven by the frame number — no WebGL, so the cost of
 * all five existing at once and being opacity-mixed is negligible.
 */

const KINDS: BackdropKind[] = ["deep", "grid", "rays", "rings", "beams"];

/** The base wash every treatment sits on, tinted by the subject's state. */
const BaseWash: React.FC = () => {
  const frame = useCurrentFrame();
  const state = subjectStateAt(frame);
  const tint = withAlpha(state > 0.5 ? THEME.secondary.deep : THEME.primary.deep, 0.3);

  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(ellipse 120% 90% at 50% 110%, ${tint} 0%, rgba(0,0,0,0) 60%),
          linear-gradient(168deg, ${COLOR.bgLift} 0%, ${COLOR.bgDeep} 55%, #03050700 100%),
          ${COLOR.bgDeep}
        `,
      }}
    />
  );
};

/** A receding lattice. Reads as structure, memory, addressable space. */
const Grid: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // Slow scroll gives parallax without ever looping visibly.
  const offset = (frame * 0.35) % 64;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <svg width="100%" height="100%" style={{ opacity: 0.5 }}>
        <defs>
          <linearGradient id="grid-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={THEME.primary.base} stopOpacity={0} />
            <stop offset="45%" stopColor={THEME.primary.base} stopOpacity={0.16} />
            <stop offset="100%" stopColor={THEME.primary.base} stopOpacity={0} />
          </linearGradient>
          <pattern
            id="grid-pattern"
            width={64}
            height={64}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(0 ${offset})`}
          >
            <path d="M64 0 L0 0 0 64" fill="none" stroke="url(#grid-fade)" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#grid-pattern)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Soft light rays. Warmth and direction — good for explanatory passages. */
const Rays: React.FC = () => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const spin = frame * 0.02;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {new Array(7).fill(0).map((_, i) => {
        const angle = spin + (i * Math.PI * 2) / 7;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "58%",
              top: "44%",
              width: width * 1.4,
              height: 120 + i * 22,
              translate: "-4% -50%",
              rotate: `${(angle * 180) / Math.PI}deg`,
              transformOrigin: "0% 50%",
              background: `linear-gradient(90deg, ${withAlpha(THEME.primary.glow, 0.1)} 0%, rgba(0,0,0,0) 65%)`,
              filter: `blur(${44}px)`,
              opacity: 0.5,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Concentric rings expanding outward. Reads as propagation, broadcast, layers. */
const Rings: React.FC = () => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {new Array(6).fill(0).map((_, i) => {
        // Each ring runs its own slow cycle, staggered.
        const cycle = ((frame * 0.45 + i * 120) % 720) / 720;
        const size = width * (0.15 + cycle * 1.3);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "56%",
              top: "48%",
              width: size,
              height: size,
              translate: "-50% -50%",
              borderRadius: "50%",
              border: `1px solid ${withAlpha(THEME.primary.base, 0.16 * (1 - cycle))}`,
              opacity: interpolate(cycle, [0, 0.12, 0.8, 1], [0, 1, 0.5, 0]),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Vertical light columns drifting sideways. Reads as flow, streaming, throughput. */
const Beams: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {new Array(9).fill(0).map((_, i) => {
        const drift = ((frame * 0.22 + i * 260) % (width + 400)) - 200;
        const w = 60 + (i % 4) * 46;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: drift,
              top: -height * 0.1,
              width: w,
              height: height * 1.2,
              background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${withAlpha(
                i % 3 === 0 ? THEME.secondary.glow : THEME.primary.glow,
                0.075,
              )} 45%, rgba(0,0,0,0) 100%)`,
              filter: "blur(30px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const LAYER: Record<BackdropKind, React.FC> = {
  deep: () => null,
  grid: Grid,
  rays: Rays,
  rings: Rings,
  beams: Beams,
};

/**
 * Renders every treatment at once and mixes them by opacity, cross-fading the
 * outgoing one into the incoming one across the first 24 frames of a scene.
 * Mounting/unmounting instead would pop, and would also restart each layer's
 * internal phase.
 */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { scene, index, local } = sceneAt(frame);

  const current: BackdropKind = scene.backdrop ?? "deep";
  const previous: BackdropKind =
    index > 0 ? (SCRIPT[index - 1].backdrop ?? "deep") : current;

  const blend = interpolate(local, [0, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.inOut,
  });

  return (
    <AbsoluteFill>
      <BaseWash />
      {KINDS.map((kind) => {
        const weight =
          (kind === current ? blend : 0) + (kind === previous ? 1 - blend : 0);
        if (weight <= 0.001) return null;
        const Layer = LAYER[kind];
        return (
          <AbsoluteFill key={kind} style={{ opacity: Math.min(1, weight) }}>
            <Layer />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
