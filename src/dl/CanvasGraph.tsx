import React from "react";
import { interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import { accentAt, MONO, PALETTE, rule, SANS } from "./tokens";
import { easeExpo, frames, MS } from "./motion";
import { useAccent } from "./accent";
import { camTransform, edgePath, nodeArrivals, shotAt, type Cam, type TimedShot } from "./camera";
import type { Film, Shot } from "./schema";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE — THE CANVAS
 * ---------------------------------------------------------------------------
 * The spine. One canvas per film, laid out once, never reset. Nodes are drawn
 * in canvas units and the camera layer above scales the whole thing, so a node
 * never re-flows when the camera moves — it is a place, not a slide.
 *
 * §06 rule 02: nothing is destroyed. Unvisited nodes sit ghosted at 0.4 so the
 * structure pre-exists the argument; visited ones stay drawn and dim to muted.
 * The canvas accumulates, which is what lets the closing wide shot land.
 */

const HOLD_MS = 700;

/**
 * Whether a shot is pointing at a specific node.
 *
 * `look: "all"` deliberately does not count. The payoff shot names the whole
 * canvas, and if that made every node accent at once the frame would spend
 * eight accents against a budget of three — the wide shot is supposed to be
 * calm, not loud.
 */
const looksAt = (shot: Shot, id: string) =>
  shot.look !== "all" && (Array.isArray(shot.look) ? shot.look.includes(id) : shot.look === id);

/** 0 → 1 as a node takes focus, and back down as it loses it. */
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

const Node: React.FC<{
  node: Film["canvas"]["nodes"][number];
  timeline: TimedShot[];
  arrival: number;
}> = ({ node, timeline, arrival }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = useAccent();

  // Edge before node: the connector starts drawing at the arrival frame and the
  // node itself lands 70ms behind it, so the viewer sees the relationship
  // before the content it connects.
  const arrived = easeExpo(
    (frame - arrival - frames(MS.stagger, fps)) / frames(MS.enter, fps),
  );
  const active = useActiveness(timeline, node.id);

  const activeShadow = `0 0 ${15 * active}px ${accentAt(accent, 0.4)}, inset 0 0 ${10 * active}px ${accentAt(accent, 0.2)}`;

  const border = interpolateColors(
    active,
    [0, 1],
    [interpolateColors(arrived, [0, 1], [rule(0.7), rule(1.6)]), accent],
  );
  const background = interpolateColors(
    active,
    [0, 1],
    [interpolateColors(arrived, [0, 1], ["rgba(11, 11, 13, 0.6)", "rgba(13, 13, 15, 0.7)"]), accentAt(accent, 0.15)],
  );
  const labelColor = interpolateColors(
    active,
    [0, 1],
    [interpolateColors(arrived, [0, 1], [PALETTE.muted, PALETTE.ink]), accent],
  );

  const pulse = 0.55 + 0.45 * Math.sin((frame / fps) * 2.6);
  const radarScale = 1 + ((frame % (fps * 2)) / (fps * 2)) * 0.5;
  const radarOpacity = (1 - (frame % (fps * 2)) / (fps * 2)) * active;

  let badgeProps = { color: "#6A6A70", bg: "transparent", border: "transparent" };
  if (node.sub) {
    const s = node.sub.toUpperCase();
    if (s.includes("SUPERVISOR")) badgeProps = { color: "#EC4899", bg: "rgba(236, 72, 153, 0.15)", border: "rgba(236, 72, 153, 0.5)" };
    else if (s.includes("SHARED") || s.includes("STATE")) badgeProps = { color: "#10B981", bg: "rgba(16, 185, 129, 0.15)", border: "rgba(16, 185, 129, 0.5)" };
    else if (s.includes("REMOTION") || s.includes("CANVAS")) badgeProps = { color: "#3B82F6", bg: "rgba(59, 130, 246, 0.15)", border: "rgba(59, 130, 246, 0.5)" };
    else if (s.includes("CYCLIC") || s.includes("LOOP")) badgeProps = { color: "#F59E0B", bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.5)" };
    else badgeProps = { color: PALETTE.muted, bg: "rgba(245,245,245,0.05)", border: rule(1) };
  }

  return (
    <div
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        border: `1px solid ${border}`,
        boxShadow: active > 0 ? activeShadow : "none",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: 8,
        background,
        padding: "0 16px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 6,
        opacity: 0.4 + 0.6 * Math.max(0, Math.min(1, arrived)),
        // The node itself does not rise — it is a fixed place on the canvas.
        // Only its state changes. Moving it would break the one thing the
        // canvas is for.
      }}
    >
      {active > 0.1 ? (
        <div
          style={{
            position: "absolute",
            inset: -4,
            borderRadius: 12,
            border: `1px solid ${accent}`,
            opacity: radarOpacity * 0.5,
            transform: `scale(${radarScale})`,
            pointerEvents: "none",
          }}
        />
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: labelColor,
            textShadow: active > 0.5 ? `0 0 8px ${accentAt(accent, 0.5)}` : "none",
          }}
        >
          {node.label}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 4,
            background: active > 0.5 ? accentAt(accent, 0.2) : arrived > 0.9 ? "rgba(16, 185, 129, 0.15)" : "rgba(245,245,245,0.05)",
            color: active > 0.5 ? accent : arrived > 0.9 ? "#10B981" : "#6A6A70",
            border: `1px solid ${active > 0.5 ? accent : arrived > 0.9 ? "rgba(16, 185, 129, 0.3)" : "rgba(245,245,245,0.1)"}`,
          }}
        >
          {active > 0.5 ? "Active" : arrived > 0.9 ? "Completed" : "Queued"}
        </div>
      </div>
      {node.sub ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: badgeProps.color,
              background: badgeProps.bg,
              border: `1px solid ${badgeProps.border}`,
              padding: "2px 6px",
              borderRadius: 4,
              display: "inline-block",
            }}
          >
            {node.sub}
          </div>
        </div>
      ) : null}
      {active > 0.5 ? (
        <span
          style={{
            position: "absolute",
            right: 10,
            top: 10,
            width: 5,
            height: 5,
            borderRadius: 1,
            background: accent,
            opacity: pulse,
            boxShadow: `0 0 6px ${accent}`,
          }}
        />
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
      viewBox={`0 0 ${box.w + 60} ${box.h + 120}`}
      width={box.w + 60}
      height={box.h + 120}
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
    >
      {film.canvas.edges.map((edge, i) => {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) return null;

        const arrival = arrivals.get(edge.to) ?? Infinity;
        const draw = easeExpo((frame - arrival) / frames(MS.edge, fps));
        const seen = Number.isFinite(arrival) && frame >= arrival;
        const live = looksAt(current.shot, edge.to);

        return (
          <g key={`${edge.from}-${edge.to}-${i}`}>
            <path
              d={edgePath(a, b)}
              fill="none"
              stroke={live ? accent : rule(2)}
              strokeWidth={1}
              strokeDasharray={edge.dashed ? "5 5" : undefined}
              // `pathLength` normalises the curve to 1 user unit, so the draw-in
              // is exact without measuring the path in the DOM — which is not
              // available during a server-side first paint anyway.
              pathLength={edge.dashed ? undefined : 1}
              strokeDashoffset={edge.dashed ? undefined : 1 - Math.max(0, Math.min(1, draw))}
              opacity={seen ? 1 : 0.18}
            />
            {live && seen ? (
              <path
                d={edgePath(a, b)}
                fill="none"
                stroke={accent}
                strokeWidth={2}
                pathLength={1}
                strokeDasharray="0.02 0.23"
                strokeDashoffset={-((frame * 0.01) % 0.25)}
                style={{ filter: `drop-shadow(0 0 6px ${accent})` }}
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
