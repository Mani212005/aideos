import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { accentOf, COLOR, EASE, THEME, type Accent } from "../theme";
import { withAlpha } from "../palette";
import { subjectStateAt } from "../script";

/**
 * Everything here exists to stop the frame reading as "a div on a gradient".
 * Depth cues (bokeh, vignette), a light source that agrees with the 3D rig
 * (accent glow), and sensor character (grain) are what the eye reads as "shot"
 * rather than "rendered".
 */

/** Deterministic hash — Math.random() would differ across render workers. */
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Out-of-focus particles drifting through the volume. */
export const Bokeh: React.FC<{ count?: number }> = ({ count = 26 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const state = subjectStateAt(frame);

  const motes = useMemo(
    () =>
      new Array(count).fill(0).map((_, i) => ({
        x: rand(i * 3.1) * 1.2 - 0.1,
        y: rand(i * 7.7 + 1) * 1.2 - 0.1,
        // Depth: near motes are bigger, blurrier, and drift faster.
        depth: 0.25 + rand(i * 5.3 + 2) * 0.75,
        speed: 0.12 + rand(i * 9.1 + 3) * 0.5,
        phase: rand(i * 2.7 + 4) * Math.PI * 2,
        warm: rand(i * 11.3 + 5) > 0.6,
      })),
    [count],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {motes.map((m, i) => {
        const size = (10 + m.depth * 46) * (width / 1920);
        // Slow rise, with a lateral wander so paths never look like a conveyor.
        const travel = ((frame * m.speed) / 1400) % 1.35;
        const y = (m.y - travel) * height;
        const x = (m.x + Math.sin(frame / 150 + m.phase) * 0.035) * width;

        if (y < -size * 2 || y > height + size * 2) return null;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: m.warm
                ? "rgba(255, 244, 224, 0.5)"
                : withAlpha(state > 0.5 ? THEME.secondary.base : THEME.primary.base, 0.42),
              filter: `blur(${(3 + m.depth * 16) * (width / 1920)}px)`,
              opacity: 0.1 + (1 - m.depth) * 0.32,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * A soft coloured wash sitting behind the subject, keyed to its current state.
 * This is what sells the subject as lit by something in the room.
 */
export const AccentGlow: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const state = subjectStateAt(frame);

  // Breathe the intensity so the light never looks like a static PNG.
  const pulse = 0.82 + Math.sin(frame / 88) * 0.18;
  const size = width * 0.85;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: size,
          height: size,
          translate: "-50% -50%",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${
            withAlpha(state > 0.5 ? THEME.secondary.glow : THEME.primary.glow, 0.28)
          } 0%, rgba(0,0,0,0) 68%)`,
          filter: `blur(${width * 0.05}px)`,
          opacity: pulse,
        }}
      />
      {/* A cool counter-light on the opposite side, for shape separation. */}
      <div
        style={{
          position: "absolute",
          left: `${(1 - x) * 100}%`,
          top: `${(1 - y) * 100}%`,
          width: size * 0.7,
          height: size * 0.7,
          translate: "-50% -50%",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(64, 116, 158, 0.16) 0%, rgba(0,0,0,0) 70%)",
          filter: `blur(${width * 0.06}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Corner falloff. Keeps the eye in the middle third of the frame. */
export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background:
        "radial-gradient(ellipse 86% 90% at 50% 48%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.28) 80%, rgba(0,0,0,0.55) 100%)",
    }}
  />
);

/**
 * Film grain via SVG turbulence. The seed is driven by the frame so the grain
 * actually moves — a static grain plate reads as dirt on the lens. CSS
 * animations are forbidden in Remotion, so the frame number is the only clock.
 */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.055 }) => {
  const frame = useCurrentFrame();
  // Cycle over a short loop; a monotonically rising seed makes turbulence drift.
  const seed = frame % 12;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%">
        <filter id="grain-filter">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={3}
            seed={seed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain-filter)" />
      </svg>
    </AbsoluteFill>
  );
};

/** The base gradient, tinted by the current subject state. */
export const Backdrop: React.FC = () => {
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

/**
 * Timeline scrubber along the bottom edge. Small, but it is the single cheapest
 * signal that a video was authored rather than exported from a slide deck.
 */
export const ProgressRail: React.FC<{
  accent: Accent;
  chapter: number;
  chapters: number;
}> = ({ accent, chapter, chapters }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const k = width / 1920;
  const progress = frame / durationInFrames;
  const reveal = interpolate(frame, [8, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });

  // A near-white active segment on a dark frame pulls the eye straight off the
  // headline, so neutral scenes use mid ink rather than high ink.
  const railColor = accent === "neutral" ? COLOR.inkMid : accentOf(accent).base;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 3 * k,
        opacity: reveal * 0.5,
        display: "flex",
        gap: 3 * k,
        paddingInline: 0,
      }}
    >
      {new Array(chapters).fill(0).map((_, i) => {
        const done = i < chapter;
        const active = i === chapter;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              background: done || active ? railColor : COLOR.hairline,
              opacity: active ? 1 : done ? 0.45 : 1,
              // The active segment fills as the chapter plays.
              scale: active ? `${Math.min(1, progress * chapters - chapter)} 1` : "1 1",
              transformOrigin: "left center",
            }}
          />
        );
      })}
    </div>
  );
};
