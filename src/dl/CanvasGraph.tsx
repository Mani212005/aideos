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

  const border = interpolateColors(
    active,
    [0, 1],
    [interpolateColors(arrived, [0, 1], [rule(0.7), rule(1.6)]), accent],
  );
  const background = interpolateColors(
    active,
    [0, 1],
    [interpolateColors(arrived, [0, 1], ["#0B0B0D", "#0D0D0F"]), accentAt(accent, 0.1)],
  );
  const labelColor = interpolateColors(
    active,
    [0, 1],
    [interpolateColors(arrived, [0, 1], [PALETTE.muted, PALETTE.ink]), accent],
  );

  // A pulse, not a blink. Anything that goes fully dark reads as an error state.
  const pulse = 0.55 + 0.45 * Math.sin((frame / fps) * 2.6);

  return (
    <div
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        border: `1px solid ${border}`,
        borderRadius: 8,
        background,
        padding: "0 16px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        opacity: 0.4 + 0.6 * Math.max(0, Math.min(1, arrived)),
        // The node itself does not rise — it is a fixed place on the canvas.
        // Only its state changes. Moving it would break the one thing the
        // canvas is for.
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 17,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: labelColor,
        }}
      >
        {node.label}
      </div>
      {node.sub ? (
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#6A6A70",
          }}
        >
          {node.sub}
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
          <path
            key={`${edge.from}-${edge.to}-${i}`}
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
