import React from "react";
import { AbsoluteFill, interpolate } from "remotion";

export type PaperRipProps = {
  active: boolean;
  progress: number; // 0 to 1
  frame?: number;
};

/**
 * Enhanced Multi-Layer Tactile Paper Rip Transition Effect
 * Inspired by Premiere Pro paper rip tutorials (Enam Al-Amin style).
 * Features 3 overlapping paper tear sheets, stop-motion rotation jitter, 
 * organic dual-sided serrated tear edges, paper fiber noise, and drop-shadow depth.
 */
export const PaperRip: React.FC<PaperRipProps> = ({ active, progress, frame = 0 }) => {
  if (!active || progress <= 0 || progress >= 1) return null;

  // Stop-motion frame jitter (simulating 12 FPS paper animation)
  const jitterFrame = Math.floor(frame / 2);
  const jitterAngle = Math.sin(jitterFrame * 1.8) * 1.5;

  // Layer 1: Primary Left Tear Sheet
  const slideLeft = interpolate(progress, [0, 0.45, 0.9], [-100, 0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Layer 2: Opposing Right Tear Sheet (Delayed offset)
  const slideRight = interpolate(progress, [0.1, 0.55, 1], [100, 0, -100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Layer 3: Center Rip Flash
  const opacity = interpolate(progress, [0, 0.15, 0.85, 1], [0, 1, 1, 0]);

  // High-detail jagged paper tear SVG paths
  const tearEdgeLeft = `
    M 0 0 
    L 30 18 L 15 36 L 40 54 L 20 72 L 45 90 L 25 108 L 50 126 L 30 144 L 55 162 L 35 180
    L 60 198 L 40 216 L 65 234 L 45 252 L 70 270 L 50 288 L 75 306 L 55 324 L 80 342
    L 60 360 L 85 378 L 65 396 L 90 414 L 70 432 L 95 450 L 75 468 L 100 486 L 80 504
    L 105 522 L 85 540 L 110 558 L 90 576 L 115 594 L 95 612 L 120 630 L 100 648 L 125 666
    L 105 684 L 130 702 L 110 720 L 135 738 L 115 756 L 140 774 L 120 792 L 145 810
    L 125 828 L 150 846 L 130 864 L 155 882 L 135 900 L 160 918 L 140 936 L 165 954
    L 145 972 L 170 990 L 150 1008 L 175 1026 L 155 1044 L 180 1062 L 160 1080
    L 0 1080 Z
  `;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 99, opacity }}>
      {/* LAYER 1: Primary Paper Sheet (Left to Right) */}
      <div
        style={{
          position: "absolute",
          left: `${slideLeft}%`,
          top: 0,
          width: "100%",
          height: "100%",
          background: "#F4F0EA", // Cream paper texture
          transform: `rotate(${-2.5 + jitterAngle}deg) scale(1.04)`,
          boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Jagged Left Tear Edge */}
        <svg
          viewBox="0 0 200 1080"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            right: "-60px",
            top: 0,
            width: "60px",
            height: "100%",
            fill: "#E8E2D6",
            filter: "drop-shadow(6px 0 8px rgba(0,0,0,0.35))",
          }}
        >
          <path d={tearEdgeLeft} />
        </svg>

        {/* Paper Grain Noise */}
        <svg style={{ position: "absolute", width: "100%", height: "100%", opacity: 0.18 }}>
          <filter id="paperGrain1">
            <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="4" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#paperGrain1)" />
        </svg>

        {/* Center Tactile Tape Badge */}
        <div
          style={{
            position: "relative",
            background: "#111113",
            color: "#FF6B00",
            fontFamily: "Inter, sans-serif",
            fontSize: "22px",
            fontWeight: 900,
            letterSpacing: "5px",
            textTransform: "uppercase",
            padding: "14px 32px",
            border: "3px dashed #FF6B00",
            boxShadow: "8px 8px 0px rgba(0,0,0,0.8)",
            transform: `rotate(${3 + jitterAngle}deg)`,
          }}
        >
          {"/// TOPIC SHIFT ///"}
        </div>
      </div>

      {/* LAYER 2: Opposing Dark Paper Overlay (Right to Left) */}
      <div
        style={{
          position: "absolute",
          left: `${slideRight}%`,
          top: 0,
          width: "100%",
          height: "100%",
          background: "#1A1A1E",
          transform: `rotate(${2 + jitterAngle}deg) scale(1.03)`,
          boxShadow: "-15px 0 35px rgba(0,0,0,0.7)",
          opacity: 0.9,
        }}
      >
        <svg
          viewBox="0 0 200 1080"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            left: "-60px",
            top: 0,
            width: "60px",
            height: "100%",
            fill: "#111113",
            filter: "drop-shadow(-6px 0 8px rgba(0,0,0,0.4))",
          }}
        >
          <path d={tearEdgeLeft} transform="scale(-1, 1) translate(-200, 0)" />
        </svg>
      </div>
    </AbsoluteFill>
  );
};
