import React from "react";
import { interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import { accentAt, MONO, PALETTE, rule, SANS } from "./tokens";
import { easeExpo, frames, MS } from "./motion";
import { useAccent } from "./accent";
import { camTransform, edgePath, nodeArrivals, shotAt, type Cam, type TimedShot } from "./camera";
import type { Film, Shot } from "./schema";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE — THE INTERACTIVE GLASSMORPHIC CANVAS GRAPH
 * ---------------------------------------------------------------------------
 * High-clarity, luminous multi-agent graph architecture.
 * Features:
 * - Glassmorphic translucent cards with glowing neon active states
 * - Animated data packet pulses traveling along connection curves
 * - Type badges, status indicators, and expanding radar beacon pulses
 */

const HOLD_MS = 700;

const looksAt = (shot: Shot, id: string) =>
  shot.look !== "all" && (Array.isArray(shot.look) ? shot.look.includes(id) : shot.look === id);

const useActiveness = (timeline: TimedShot[], id: string) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const current = shotAt(timeline, frame);
  const previous = current.index > 0 ? timeline[current.index - 1] : null;

  const now = looksAt(current.shot, id);
  const before = previous ? looksAt(previous.shot, id) : false;
  const p = easeExpo((frame - current.from) / frames(HOLD_MS, fps));

  if (now) return before ? 1 : p;
  return before ? 1 - p : 0;
};

const getNodeCategoryTag = (id: string, label: string): { tag: string; icon: string } => {
  const lower = (id + " " + label).toLowerCase();
  if (lower.includes("super")) return { tag: "SUPERVISOR", icon: "👑" };
  if (lower.includes("state") || lower.includes("memory")) return { tag: "SHARED STATE", icon: "◈" };
  if (lower.includes("loop") || lower.includes("cycle")) return { tag: "CYCLIC LOOP", icon: "↻" };
  if (lower.includes("fan") || lower.includes("parallel")) return { tag: "FAN-OUT / IN", icon: "⑂" };
  if (lower.includes("trap") || lower.includes("guard")) return { tag: "FAILURE GUARD", icon: "🛡️" };
  if (lower.includes("chain") || lower.includes("linear")) return { tag: "LINEAR PIPELINE", icon: "→" };
  if (lower.includes("graph") || lower.includes("map")) return { tag: "MASTER GRAPH", icon: "⬡" };
  return { tag: "AGENT NODE", icon: "⚡" };
};

const Node: React.FC<{
  node: Film["canvas"]["nodes"][number];
  timeline: TimedShot[];
  arrival: number;
}> = ({ node, timeline, arrival }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = useAccent();

  const arrived = easeExpo(
    (frame - arrival - frames(MS.stagger, fps)) / frames(MS.enter, fps),
  );
  const active = useActiveness(timeline, node.id);
  const isLive = active > 0.4;

  const { tag, icon } = getNodeCategoryTag(node.id, node.label);

  const border = interpolateColors(
    active,
    [0, 1],
    [interpolateColors(arrived, [0, 1], ["rgba(255, 255, 255, 0.08)", "rgba(255, 255, 255, 0.16)"]), accent],
  );

  const background = isLive
    ? "linear-gradient(145deg, rgba(42, 20, 10, 0.94) 0%, rgba(24, 10, 5, 0.98) 100%)"
    : "linear-gradient(145deg, rgba(22, 26, 36, 0.88) 0%, rgba(12, 14, 20, 0.96) 100%)";

  const labelColor = isLive ? "#FFFFFF" : interpolateColors(arrived, [0, 1], [PALETTE.muted, "#E2E8F0"]);

  // Animated pulse waves for active radar beacon
  const pulseScale = 1 + 0.8 * ((frame % 30) / 30);
  const pulseOpacity = Math.max(0, 1 - (frame % 30) / 30);
  const breathingGlow = 0.5 + 0.5 * Math.sin((frame / fps) * 3.0);

  return (
    <div
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        border: `1.5px solid ${border}`,
        borderRadius: 14,
        background,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        padding: "12px 18px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: isLive
          ? `0 16px 40px rgba(0, 0, 0, 0.6), 0 0 28px ${accentAt(accent, 0.35 * breathingGlow)}, inset 0 1px 1px rgba(255, 255, 255, 0.35)`
          : "0 8px 24px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.08)",
        opacity: 0.35 + 0.65 * Math.max(0, Math.min(1, arrived)),
        transform: isLive ? "scale(1.02)" : "scale(1.0)",
        transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Top Tag & Status Beacon */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: "0.12em",
            fontWeight: 600,
            textTransform: "uppercase",
            color: isLive ? accent : "rgba(255, 255, 255, 0.5)",
            background: isLive ? accentAt(accent, 0.16) : "rgba(255, 255, 255, 0.06)",
            padding: "2px 8px",
            borderRadius: 6,
            border: `1px solid ${isLive ? accentAt(accent, 0.3) : "rgba(255, 255, 255, 0.08)"}`,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span>{icon}</span>
          <span>{tag}</span>
        </div>

        {/* Live Active Radar Beacon */}
        <div style={{ position: "relative", width: 10, height: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isLive ? (
            <span
              style={{
                position: "absolute",
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: `1.5px solid ${accent}`,
                transform: `scale(${pulseScale})`,
                opacity: pulseOpacity,
              }}
            />
          ) : null}
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isLive ? accent : "rgba(255, 255, 255, 0.2)",
              boxShadow: isLive ? `0 0 8px ${accent}` : "none",
            }}
          />
        </div>
      </div>

      {/* Main Node Label */}
      <div
        style={{
          fontFamily: SANS,
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          color: labelColor,
          lineHeight: 1.2,
        }}
      >
        {node.label}
      </div>

      {/* Node Subtitle / Metric */}
      {node.sub ? (
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            letterSpacing: "0.08em",
            fontWeight: 500,
            textTransform: "uppercase",
            color: isLive ? "rgba(255, 255, 255, 0.85)" : "#8E8E98",
          }}
        >
          {node.sub}
        </div>
      ) : null}
    </div>
  );
};

const Edges: React.FC<{ film: Film; timeline: TimedShot[]; arrivals: Map<string, number> }> = ({
  film,
  timeline,
  arrivals,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = useAccent();
  const current = shotAt(timeline, frame);
  const byId = new Map(film.canvas.nodes.map((n) => [n.id, n]));

  const box = film.canvas.nodes.reduce(
    (acc, n) => ({
      w: Math.max(acc.w, n.x + n.w),
      h: Math.max(acc.h, n.y + n.h),
    }),
    { w: 0, h: 0 },
  );

  return (
    <svg
      viewBox={`0 0 ${box.w + 80} ${box.h + 140}`}
      width={box.w + 80}
      height={box.h + 140}
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
    >
      <defs>
        <filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur1" />
          <feGaussianBlur stdDeviation="8" result="blur2" />
          <feMerge>
            <feMergeNode in="blur2" />
            <feMergeNode in="blur1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="activeEdgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF6B00" />
          <stop offset="100%" stopColor="#FFA000" />
        </linearGradient>
      </defs>

      {film.canvas.edges.map((edge, i) => {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) return null;

        const arrival = arrivals.get(edge.to) ?? Infinity;
        const draw = easeExpo((frame - arrival) / frames(MS.edge, fps));
        const seen = Number.isFinite(arrival) && frame >= arrival;
        const live = looksAt(current.shot, edge.to);
        const pathData = edgePath(a, b);

        return (
          <g key={`${edge.from}-${edge.to}-${i}`}>
            {/* Base Dark Guide Track */}
            <path
              d={pathData}
              fill="none"
              stroke="rgba(255, 255, 255, 0.09)"
              strokeWidth={2}
              strokeDasharray={edge.dashed ? "6 6" : undefined}
              opacity={seen ? 1 : 0.15}
            />

            {/* Glowing Active Track */}
            {live ? (
              <path
                d={pathData}
                fill="none"
                stroke={accent}
                strokeWidth={5}
                filter="url(#neonGlow)"
                opacity={0.45}
                strokeDasharray={edge.dashed ? "6 6" : undefined}
              />
            ) : null}

            {/* Crisp Foreground Signal Path */}
            <path
              d={pathData}
              fill="none"
              stroke={live ? "url(#activeEdgeGrad)" : "rgba(255, 255, 255, 0.22)"}
              strokeWidth={live ? 2.5 : 1.5}
              strokeDasharray={edge.dashed ? "6 6" : undefined}
              pathLength={edge.dashed ? undefined : 1}
              strokeDashoffset={edge.dashed ? undefined : 1 - Math.max(0, Math.min(1, draw))}
              opacity={seen ? 1 : 0.18}
            />

            {/* Traveling Luminescent Data Packets */}
            {seen ? (
              <path
                d={pathData}
                fill="none"
                stroke={live ? "#FFFFFF" : accent}
                strokeWidth={live ? 3 : 2}
                strokeDasharray="6 28"
                strokeDashoffset={-frame * 3.5}
                opacity={live ? 0.95 : 0.4}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

export const CanvasGraph: React.FC<{ film: Film; timeline: TimedShot[]; cam: Cam }> = ({
  film,
  timeline,
  cam,
}) => {
  const { width, height } = useVideoConfig();
  const arrivals = React.useMemo(() => nodeArrivals(film, timeline), [film, timeline]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transformOrigin: "0 0",
        transform: camTransform(cam, { width, height }),
      }}
    >
      <Edges film={film} timeline={timeline} arrivals={arrivals} />
      {film.canvas.nodes.map((node) => (
        <Node
          key={node.id}
          node={node}
          timeline={timeline}
          arrival={arrivals.get(node.id) ?? Infinity}
        />
      ))}
    </div>
  );
};
