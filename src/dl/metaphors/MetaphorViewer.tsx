/**
 * File Description: Unified vector visual metaphor library for Aideos.
 * Implements pure data-driven SVG concept visualizers with explicit centered viewBoxes
 * and preserveAspectRatio="xMidYMid meet" for frame-accurate Remotion positioning.
 */
import React from "react";
import { MONO, PALETTE } from "../tokens";
import { GlowingClusterMetaphor } from "./GlowingClusterMetaphor";
import type { MetaphorContent } from "../schema";

export interface MetaphorProps {
  type:
    | "typing-cursor-quote"
    | "spider-web"
    | "liquid-bucket"
    | "balance-scale"
    | "clock-gears"
    | "rocket-launch"
    | "character-throw"
    | "glowing-cluster"
    | "custom";
  content?: MetaphorContent;
  frame: number;
  accent?: string;
  fontFamily?: string;
}

// 1. Procedural Spider Web Weaving Animation
export const SpiderWebAnimation: React.FC<{
  frame: number;
  accent: string;
  caption?: string;
}> = ({ frame, accent, caption = "Procedural Radial Network" }) => {
  const radials = 8;
  const spirals = 6;
  const progress = Math.min(1, frame / 90);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="-300 -300 600 600"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "85%", flex: 1, minHeight: 0 }}
      >
        {/* Radial Spokes */}
        {Array.from({ length: radials }).map((_, i) => {
          const angle = (i * 2 * Math.PI) / radials;
          const r = 240 * Math.min(1, progress * 1.5);
          const x2 = Math.cos(angle) * r;
          const y2 = Math.sin(angle) * r;
          return (
            <line
              key={`spoke-${i}`}
              x1={0}
              y1={0}
              x2={x2}
              y2={y2}
              stroke={accent}
              strokeWidth={2}
              strokeOpacity={0.6}
            />
          );
        })}

        {/* Concentric Spiral Connections */}
        {Array.from({ length: spirals }).map((_, s) => {
          const radius = 40 + s * 35;
          const sProgress = Math.max(0, Math.min(1, (progress - s * 0.12) / 0.3));
          if (sProgress <= 0) return null;

          const points = Array.from({ length: radials + 1 })
            .map((_, r) => {
              const angle = (r * 2 * Math.PI) / radials;
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;
              return `${x},${y}`;
            })
            .join(" ");

          return (
            <polyline
              key={`spiral-${s}`}
              points={points}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={1.8}
              strokeOpacity={0.75 * sProgress}
              strokeDasharray="4,3"
            />
          );
        })}

        {/* The Animated Spider Centroid */}
        <g
          transform={`translate(${Math.cos(frame * 0.08) * 120 * (1 - progress)}, ${
            Math.sin(frame * 0.08) * 120 * (1 - progress)
          })`}
        >
          <circle r={10} fill={accent} />
          <circle r={16} fill="none" stroke={accent} strokeWidth={2} opacity={0.4} />
          {/* Spider Legs */}
          {[-1, 1].map((side) =>
            [0, 1, 2, 3].map((leg) => {
              const angle = side * (0.4 + leg * 0.3) + Math.sin(frame * 0.3 + leg) * 0.2;
              const lx = Math.cos(angle) * (20 + leg * 3);
              const ly = Math.sin(angle) * (20 + leg * 3);
              return (
                <line
                  key={`leg-${side}-${leg}`}
                  x1={0}
                  y1={0}
                  x2={lx}
                  y2={ly}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })
          )}
        </g>
      </svg>

      <div
        style={{
          marginTop: 12,
          padding: "6px 16px",
          borderRadius: 20,
          background: "rgba(0, 0, 0, 0.65)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          color: "#FFFFFF",
          fontFamily: MONO,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>🕸️</span>
        <span>{caption}</span>
      </div>
    </div>
  );
};

// 2. Liquid Container / Reservoir Simulation (Pure Centered SVG)
export const LiquidContainerAnimation: React.FC<{
  frame: number;
  accent: string;
  levelLabel?: string;
  caption?: string;
  fillRatio?: number;
}> = ({
  frame,
  accent,
  levelLabel = "Dynamic Buffer Capacity",
  caption = "Fluid Level Reservoir",
  fillRatio = 0.75,
}) => {
  const animatedRatio = Math.min(fillRatio, (frame / 100) * fillRatio);
  const fillH = animatedRatio * 220;
  const wave = Math.sin(frame * 0.15) * 6;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="0 0 500 380"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "85%", flex: 1, minHeight: 0 }}
      >
        <defs>
          <linearGradient id="liquid-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={accent} stopOpacity={0.9} />
            <stop offset="100%" stopColor="#0E0E14" stopOpacity={0.95} />
          </linearGradient>
          <clipPath id="reservoir-clip">
            <rect x="130" y="60" width="240" height="240" rx="24" />
          </clipPath>
        </defs>

        {/* Outer Reservoir Glass Tank */}
        <rect
          x="130"
          y="60"
          width="240"
          height="240"
          rx="24"
          fill="rgba(10, 10, 14, 0.7)"
          stroke="rgba(255, 255, 255, 0.4)"
          strokeWidth="4"
        />

        {/* Liquid Fill Group (Clipped to Tank) */}
        <g clipPath="url(#reservoir-clip)">
          <rect
            x="130"
            y={300 - fillH}
            width="240"
            height={fillH}
            fill="url(#liquid-grad)"
          />
          {/* Animated Wave Surface */}
          <path
            d={`M 130 ${300 - fillH + wave} Q 190 ${300 - fillH - wave} 250 ${300 - fillH + wave} T 370 ${300 - fillH + wave} L 370 ${300 - fillH + 20} L 130 ${300 - fillH + 20} Z`}
            fill="rgba(255, 255, 255, 0.35)"
          />
        </g>

        {/* Measurement Ticks & Percentage Legend */}
        {[100, 75, 50, 25, 0].map((pct, idx) => {
          const yPos = 60 + idx * 60;
          return (
            <g key={pct} opacity={0.6}>
              <line x1="375" y1={yPos} x2="385" y2={yPos} stroke="#A1A1AA" strokeWidth="2" />
              <text x="392" y={yPos + 4} fill="#A1A1AA" fontSize="10" fontFamily={MONO}>
                {pct}%
              </text>
            </g>
          );
        })}

        {/* Level Label in SVG */}
        <text
          x="250"
          y="340"
          fill="#E4E4E7"
          fontSize="12"
          fontFamily={MONO}
          textAnchor="middle"
          fontWeight="bold"
        >
          {levelLabel}: {Math.round(animatedRatio * 100)}%
        </text>
      </svg>

      <div
        style={{
          marginTop: 8,
          padding: "6px 16px",
          borderRadius: 20,
          background: "rgba(0, 0, 0, 0.65)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          color: "#FFFFFF",
          fontFamily: MONO,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>🚰</span>
        <span>{caption}</span>
      </div>
    </div>
  );
};

// 3. Balance Scale Metaphor (Data-Driven Labels & Pure Centered SVG)
export const BalanceScaleAnimation: React.FC<{
  frame: number;
  accent: string;
  leftLabel?: string;
  rightLabel?: string;
  caption?: string;
  tilt?: number;
}> = ({
  frame,
  accent,
  leftLabel = "Primary Constraint",
  rightLabel = "Secondary Tradeoff",
  caption = "Trade-Off Equilibrium",
  tilt,
}) => {
  const dynamicTilt = tilt !== undefined ? tilt : Math.sin(frame * 0.05) * 14;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="-250 -180 500 360"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "85%", flex: 1, minHeight: 0 }}
      >
        {/* Central Stand */}
        <line x1={0} y1={-120} x2={0} y2={120} stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" />
        <path d="M-60 120 L60 120 L40 140 L-40 140 Z" fill="#333338" />

        {/* Pivot Point */}
        <circle cx={0} cy={-120} r={8} fill={accent} />

        {/* Rotating Lever Beam */}
        <g transform={`rotate(${dynamicTilt} 0 -120)`}>
          <line x1={-180} y1={-120} x2={180} y2={-120} stroke="#FFFFFF" strokeWidth={5} />

          {/* Left Pan */}
          <line x1={-180} y1={-120} x2={-180} y2={-40} stroke="rgba(255,255,255,0.4)" strokeWidth={2} />
          <path d="M-220 -40 Q-180 -10 -140 -40 Z" fill="#222226" stroke="#888" strokeWidth={2} />
          <text x={-180} y={-55} fill="#FFFFFF" fontSize="12" fontFamily={MONO} textAnchor="middle">
            {leftLabel}
          </text>

          {/* Right Pan */}
          <line x1={180} y1={-120} x2={180} y2={-40} stroke="rgba(255,255,255,0.4)" strokeWidth={2} />
          <path d="M140 -40 Q180 -10 220 -40 Z" fill="#222226" stroke={accent} strokeWidth={2} />
          <text x={180} y={-55} fill={accent} fontSize="12" fontFamily={MONO} textAnchor="middle">
            {rightLabel}
          </text>
        </g>
      </svg>

      <div
        style={{
          marginTop: 8,
          padding: "6px 16px",
          borderRadius: 20,
          background: "rgba(0, 0, 0, 0.65)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          color: "#FFFFFF",
          fontFamily: MONO,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>⚖️</span>
        <span>{caption}</span>
      </div>
    </div>
  );
};

// 4. Clock Gears Metaphor
export const ClockGearsAnimation: React.FC<{
  frame: number;
  accent: string;
  gearLabels?: string[];
  caption?: string;
}> = ({
  frame,
  accent,
  gearLabels = ["Cadence", "Synchronization"],
  caption = "Escapement Cadence & Execution Speed",
}) => {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="-220 -220 440 440"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "85%", flex: 1, minHeight: 0 }}
      >
        {/* Large Main Gear */}
        <g transform={`rotate(${frame * 1.2} 0 0)`}>
          <circle r={110} fill="none" stroke="#FFFFFF" strokeWidth={6} strokeDasharray="18,10" />
          <circle r={90} fill="#18181B" stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
          <circle r={20} fill={accent} />
          {Array.from({ length: 6 }).map((_, i) => (
            <line
              key={i}
              x1={0}
              y1={0}
              x2={Math.cos((i * Math.PI) / 3) * 90}
              y2={Math.sin((i * Math.PI) / 3) * 90}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={3}
            />
          ))}
          {gearLabels[0] && (
            <text x={0} y={4} fill="#FFFFFF" fontSize="10" fontFamily={MONO} textAnchor="middle">
              {gearLabels[0]}
            </text>
          )}
        </g>

        {/* Small Interlocking Pinion Gear */}
        <g transform={`translate(130, -75) rotate(${-frame * 2.4} 0 0)`}>
          <circle r={55} fill="none" stroke={accent} strokeWidth={5} strokeDasharray="12,8" />
          <circle r={42} fill="#111114" stroke={accent} strokeWidth={1.5} />
          <circle r={10} fill="#FFFFFF" />
          {gearLabels[1] && (
            <text x={0} y={3} fill={accent} fontSize="8" fontFamily={MONO} textAnchor="middle">
              {gearLabels[1]}
            </text>
          )}
        </g>
      </svg>

      <div
        style={{
          marginTop: 8,
          padding: "6px 16px",
          borderRadius: 20,
          background: "rgba(0, 0, 0, 0.65)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          color: "#FFFFFF",
          fontFamily: MONO,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>⏱️</span>
        <span>{caption}</span>
      </div>
    </div>
  );
};

// 5. Character Throw Script Animation
export const CharacterThrowScriptAnimation: React.FC<{
  frame: number;
  accent: string;
  caption?: string;
}> = ({ frame, accent, caption = "Prompt Cached & Locked in KV State" }) => {
  const isSleeping = frame < 40;
  const isReading = frame >= 40 && frame < 85;
  const isThrowing = frame >= 85 && frame < 140;
  const isDiscarded = frame >= 140;

  let paperX = 0;
  let paperY = -120;
  let paperRot = 0;
  let paperOpacity = 1;

  if (isSleeping) {
    paperY = -160 + Math.sin(frame * 0.1) * 5;
    paperOpacity = 0.5;
  } else if (isReading) {
    paperX = 0;
    paperY = -40 + Math.sin(frame * 0.1) * 2;
    paperRot = 0;
    paperOpacity = 1;
  } else if (isThrowing) {
    const throwProgress = (frame - 85) / 55;
    paperX = throwProgress * 320;
    paperY = -40 - Math.sin(throwProgress * Math.PI) * 120 + throwProgress * 40;
    paperRot = throwProgress * 720;
    paperOpacity = Math.max(0, 1 - throwProgress * 0.9);
  } else {
    paperOpacity = 0;
  }

  const scanY = isReading ? -70 + ((frame - 40) % 25) * 4 : -70;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="-250 -130 500 270"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "85%", flex: 1, minHeight: 0 }}
      >
        {/* Window on the Right Wall */}
        <g transform="translate(150, -110)">
          <rect x="-10" y="-10" width="140" height="180" rx="8" fill="#18181B" stroke="#3F3F46" strokeWidth={3} />
          <rect x="0" y="0" width="120" height="160" rx="4" fill="#09090B" />
          <circle cx="90" cy="35" r="14" fill="#FDE047" opacity={0.9} />
          <circle cx="95" cy="32" r="12" fill="#09090B" />
          <line x1="60" y1="0" x2="60" y2="160" stroke="#27272A" strokeWidth={2} />
          <line x1="0" y1="80" x2="120" y2="80" stroke="#27272A" strokeWidth={2} />
          <rect x="-20" y="160" width="160" height="12" rx="3" fill="#27272A" />
        </g>

        {/* Desk Surface */}
        <line x1="-300" y1="110" x2="300" y2="110" stroke="#3F3F46" strokeWidth={5} strokeLinecap="round" />
        <rect x="-240" y="112" width="480" height="16" fill="#18181B" rx="4" />

        {/* Robot / Computer Monitor */}
        <g transform="translate(-60, 20)">
          <rect x="-80" y="-80" width="160" height="130" rx="16" fill="#27272A" stroke="#52525B" strokeWidth={4} />
          <rect x="-65" y="-68" width="130" height="100" rx="10" fill="#09090B" stroke="#3F3F46" strokeWidth={2} />

          {isSleeping && (
            <g>
              <path d="M -40 -20 Q -25 -10 -10 -20" fill="none" stroke="#71717A" strokeWidth={4} strokeLinecap="round" />
              <path d="M 10 -20 Q 25 -10 40 -20" fill="none" stroke="#71717A" strokeWidth={4} strokeLinecap="round" />
              <text x="35" y={-85 - Math.sin(frame * 0.15) * 15} fill="#A1A1AA" fontSize="18" fontFamily={MONO} fontWeight="bold">
                Z
              </text>
            </g>
          )}

          {isReading && (
            <g>
              <circle cx="-25" cy="-20" r="14" fill={accent} />
              <circle cx="25" cy="-20" r="14" fill={accent} />
              <circle cx="-25" cy="-20" r="6" fill="#FFF" />
              <circle cx="25" cy="-20" r="6" fill="#FFF" />
              <line x1="-55" y1="-50" x2="55" y2="-50" stroke={accent} strokeWidth={2} opacity={0.8} />
            </g>
          )}

          {isThrowing && (
            <g>
              <path d="M -38 -26 L -16 -16 L -38 -6" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" />
              <path d="M 38 -26 L 16 -16 L 38 -6" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" />
              <path d="M -15 10 Q 0 20 15 10" fill="none" stroke="#FFF" strokeWidth={3} strokeLinecap="round" />
            </g>
          )}

          {isDiscarded && (
            <g>
              <path d="M -38 -15 Q -25 -30 -12 -15" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" />
              <circle cx="25" cy="-20" r="10" fill={accent} />
              <circle cx="25" cy="-20" r="4" fill="#FFF" />
              <path d="M -15 8 Q 0 22 15 8" fill="none" stroke="#FFF" strokeWidth={3} strokeLinecap="round" />
            </g>
          )}

          {/* Base */}
          <rect x="-25" y="50" width="50" height="24" fill="#18181B" stroke="#3F3F46" strokeWidth={2} />
          <rect x="-50" y="74" width="100" height="12" rx="4" fill="#27272A" stroke="#52525B" strokeWidth={2} />
        </g>

        {/* Paper Document */}
        {paperOpacity > 0 && (
          <g transform={`translate(${paperX}, ${paperY}) rotate(${paperRot})`} opacity={paperOpacity}>
            <rect x="-45" y="-60" width="90" height="120" rx="4" fill="#F4F0EA" stroke="#D4D4D8" strokeWidth={2} />
            <polygon points="25,-60 45,-40 25,-40" fill="#E4E4E7" />
            <rect x="-35" y="-48" width="50" height="6" rx="2" fill={accent} />
            <line x1="-35" y1="-32" x2="30" y2="-32" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />
            <line x1="-35" y1="-20" x2="25" y2="-20" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />
            <line x1="-35" y1="-8" x2="32" y2="-8" stroke="#71717A" strokeWidth={3} strokeLinecap="round" />
            {isReading && (
              <g>
                <line x1="-45" y1={scanY} x2="45" y2={scanY} stroke="#EF4444" strokeWidth={3} />
                <rect x="-45" y={scanY - 4} width="90" height="8" fill="#EF4444" opacity={0.25} />
              </g>
            )}
          </g>
        )}
      </svg>

      <div
        style={{
          marginTop: 8,
          padding: "6px 16px",
          borderRadius: 20,
          background: "rgba(0, 0, 0, 0.65)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          color: "#FFFFFF",
          fontFamily: MONO,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>💻</span>
        <span>{caption}</span>
      </div>
    </div>
  );
};

// 6. Typing Cursor Quote Animation
export const TypingCursorQuoteAnimation: React.FC<{
  frame: number;
  accent: string;
  quoteText?: string;
  stampText?: string;
}> = ({
  frame,
  accent,
  quoteText = "LLMs are a dead end that will never reach real intelligence.",
  stampText = "Yann LeCun Stamp: APPROVED",
}) => {
  const typedCount = Math.min(quoteText.length, Math.floor(frame * 0.8));
  const currentText = quoteText.slice(0, typedCount);
  const showCursor = Math.floor(frame / 12) % 2 === 0;
  const showStamp = frame > 40;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 680,
          background: "#101014",
          borderRadius: 16,
          padding: 24,
          border: "1px solid rgba(255, 255, 255, 0.15)",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.6)",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            paddingBottom: 10,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#EF4444" }} />
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#F59E0B" }} />
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#10B981" }} />
            <span style={{ fontSize: 11, color: "#9CA3AF", fontFamily: MONO, marginLeft: 6 }}>
              statement_quote.txt
            </span>
          </div>
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(99, 91, 255, 0.2)",
              color: accent,
              border: `1px solid ${accent}`,
              fontFamily: MONO,
              fontWeight: "bold",
            }}
          >
            STATEMENT
          </span>
        </div>

        <div
          style={{
            fontSize: 20,
            color: "#FFFFFF",
            fontWeight: "bold",
            lineHeight: 1.5,
            minHeight: 64,
            fontFamily: MONO,
          }}
        >
          "{currentText}"
          {showCursor && (
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 20,
                marginLeft: 4,
                backgroundColor: accent,
                verticalAlign: "middle",
              }}
            />
          )}
        </div>

        {showStamp && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%) rotate(-10deg)",
              background: "rgba(69, 10, 10, 0.95)",
              border: "3px solid #EF4444",
              color: "#F87171",
              fontWeight: 900,
              fontSize: 18,
              padding: "10px 20px",
              borderRadius: 8,
              textTransform: "uppercase",
              letterSpacing: 2,
              fontFamily: MONO,
              boxShadow: "0 8px 30px rgba(239, 68, 68, 0.4)",
            }}
          >
            {stampText}
          </div>
        )}
      </div>
    </div>
  );
};

// 7. Glowing Cluster Metaphor (Pure SVG Constellation)
export const GlowingClusterAnimation: React.FC<{
  frame: number;
  accent: string;
  title?: string;
  subtitle?: string;
}> = ({
  frame,
  accent,
  title = "Abstract Latent Representation",
  subtitle = "Deterministic Multi-Dimensional Embedding",
}) => {
  const nodeCount = 18;
  const nodes = Array.from({ length: nodeCount }).map((_, i) => {
    const angle = (i * 2 * Math.PI) / nodeCount + frame * 0.01;
    const r = 110 + (i % 3) * 35 + Math.sin(frame * 0.05 + i) * 12;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r * 0.7;
    return { x, y, size: 4 + (i % 4) * 2 };
  });

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="-300 -200 600 400"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "85%", flex: 1, minHeight: 0 }}
      >
        {/* Connecting Mesh Lines */}
        {nodes.map((n1, i) =>
          nodes.slice(i + 1, i + 4).map((n2, j) => (
            <line
              key={`edge-${i}-${j}`}
              x1={n1.x}
              y1={n1.y}
              x2={n2.x}
              y2={n2.y}
              stroke={accent}
              strokeWidth={1.2}
              strokeOpacity={0.35}
            />
          ))
        )}

        {/* Glowing Nodes */}
        {nodes.map((n, i) => (
          <g key={`node-${i}`} transform={`translate(${n.x}, ${n.y})`}>
            <circle r={n.size * 2} fill={accent} opacity={0.25} />
            <circle r={n.size} fill="#FFFFFF" />
          </g>
        ))}
      </svg>

      <div
        style={{
          marginTop: 8,
          padding: "6px 16px",
          borderRadius: 20,
          background: "rgba(0, 0, 0, 0.65)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          color: "#FFFFFF",
          fontFamily: MONO,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>🪐</span>
        <span>{title} · {subtitle}</span>
      </div>
    </div>
  );
};

// Main Metaphor Viewer Component
export const MetaphorViewer: React.FC<MetaphorProps> = ({
  type,
  content,
  frame,
  accent = "#635BFF",
}) => {
  const resolvedKind = content?.kind ?? (type as MetaphorContent["kind"]);

  switch (resolvedKind) {
    case "spider-web":
      return (
        <SpiderWebAnimation
          frame={frame}
          accent={accent}
          caption={content && "caption" in content ? content.caption : undefined}
        />
      );
    case "liquid-bucket":
      return (
        <LiquidContainerAnimation
          frame={frame}
          accent={accent}
          levelLabel={content && "levelLabel" in content ? content.levelLabel : undefined}
          caption={content && "caption" in content ? content.caption : undefined}
          fillRatio={content && "fillRatio" in content ? content.fillRatio : undefined}
        />
      );
    case "balance-scale":
      return (
        <BalanceScaleAnimation
          frame={frame}
          accent={accent}
          leftLabel={content && "leftLabel" in content ? content.leftLabel : undefined}
          rightLabel={content && "rightLabel" in content ? content.rightLabel : undefined}
          caption={content && "caption" in content ? content.caption : undefined}
          tilt={content && "tilt" in content ? content.tilt : undefined}
        />
      );
    case "clock-gears":
      return (
        <ClockGearsAnimation
          frame={frame}
          accent={accent}
          gearLabels={content && "gearLabels" in content ? content.gearLabels : undefined}
          caption={content && "caption" in content ? content.caption : undefined}
        />
      );
    case "character-throw":
      return (
        <CharacterThrowScriptAnimation
          frame={frame}
          accent={accent}
          caption={content && "caption" in content ? content.caption : undefined}
        />
      );
    case "typing-cursor-quote":
      return (
        <TypingCursorQuoteAnimation
          frame={frame}
          accent={accent}
          quoteText={content && "quoteText" in content ? content.quoteText : undefined}
          stampText={content && "stampText" in content ? content.stampText : undefined}
        />
      );
    case "glowing-cluster":
      return (
        <GlowingClusterAnimation
          frame={frame}
          accent={accent}
          title={content && "title" in content ? content.title : "Abstract Latent Representation"}
          subtitle={content && "subtitle" in content ? content.subtitle : "Multi-Dimensional Space"}
        />
      );
    default:
      return (
        <BalanceScaleAnimation
          frame={frame}
          accent={accent}
          caption="Equilibrium Balance"
        />
      );
  }
};
