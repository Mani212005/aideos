import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { accentAt, FAINT, MONO, PALETTE, rule, SERIF, SUNKEN, useLayout } from "./tokens";
import { EXPO, frames, MS, useEntrance, useProgress } from "./motion";
import { useAccent } from "./accent";
import { AlignContext } from "./align";
import type { BlockProps } from "./primitives";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE — DEVICE LIBRARY
 * ---------------------------------------------------------------------------
 * Implements §07. One canvas cannot hold six minutes — attention decays after
 * roughly twenty seconds of the same visual device. So the canvas is the spine
 * and these are what you zoom into and back out of.
 *
 * All of them share the tokens, the curve and the hairline, which is what stops
 * switching between them reading as a different video. None of them draw a
 * syntax-highlighted code editor: ideas are carried by graphs, vectors and
 * distributions, and a code block is a picture of an implementation rather than
 * a picture of an idea.
 *
 * Each device paces its own internal motion across the shot it is given, rather
 * than finishing in 400ms and then sitting dead for twenty seconds.
 */

/** Where in a shot a device's sweep runs — after the entrance, before the exit. */
const sweepWindow = (durationInFrames: number, fps: number) => ({
  from: frames(MS.enter, fps),
  span: Math.max(1, durationInFrames - frames(MS.enter + MS.move, fps)),
});

const useSweep = (start: number, durationInFrames: number, delayMs = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { from, span } = sweepWindow(durationInFrames, fps);
  return interpolate(
    frame,
    [start + from + frames(delayMs, fps), start + from + span],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
};

/* -------------------------------------------------------------------------- */
/* TokenStrip — the metronome device                                           */
/* -------------------------------------------------------------------------- */

export const TokenStrip: React.FC<
  BlockProps & { tokens: string[]; lit: number[]; caption?: string }
> = ({ tokens, lit, caption, start, index, durationInFrames }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const sweep = useSweep(start, durationInFrames);
  // The strip fills left to right across the shot; anything in `lit` is already
  // computed and starts accented, which is how "cached" reads without a legend.
  const head = sweep * tokens.length;

  return (
    <div style={{ ...enter, display: "flex", flexDirection: "column", gap: layout.grid * 2 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: layout.grid }}>
        {tokens.map((token, i) => {
          const preset = lit.includes(i);
          const on = preset || head > i;
          const landing = Math.max(0, Math.min(1, head - i));
          return (
            <span
              key={`${i}-${token}`}
              style={{
                fontFamily: MONO,
                fontSize: layout.type("body").fontSize * 0.9,
                padding: `${layout.grid}px ${layout.grid * 1.5}px`,
                borderRadius: layout.radius.chip * 0.6,
                border: `1px solid ${on ? accentAt(accent, 0.5) : rule()}`,
                background: on ? accentAt(accent, preset ? 0.22 : 0.1 + landing * 0.08) : SUNKEN,
                color: on ? PALETTE.ink : PALETTE.muted,
                whiteSpace: "pre",
              }}
            >
              {token}
            </span>
          );
        })}
      </div>
      {caption ? <div style={layout.label()}>{caption}</div> : null}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* AttentionArcs — which token looks at which                                  */
/* -------------------------------------------------------------------------- */

export const AttentionArcs: React.FC<
  BlockProps & { tokens: string[]; focus: number; links: number[]; note?: string }
> = ({ tokens, focus, links, note, start, index, durationInFrames }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const sweep = useSweep(start, durationInFrames);

  const W = 560;
  const H = 240;
  const baseline = 96;
  const step = W / (tokens.length + 1);
  const at = (i: number) => step * (i + 1);

  return (
    <div
      style={{
        ...enter,
        width: "100%",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: layout.grid,
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", flex: 1, minHeight: 0 }}>
        <path d={`M${step * 0.4} ${baseline} H${W - step * 0.4}`} stroke={rule()} />
        {links.map((target, i) => {
          // Strongest link first, so opacity encodes rank without a colour ramp.
          const weight = 1 - i / (links.length + 0.6);
          const x1 = at(focus);
          const x2 = at(target);
          const drop = baseline + 40 + Math.abs(x1 - x2) * 0.22;
          const d = `M${x1} ${baseline + 8} C${x1} ${drop}, ${x2} ${drop}, ${x2} ${baseline + 8}`;
          const p = Math.max(0, Math.min(1, (sweep - i * 0.12) / 0.5));
          return (
            <path
              key={target}
              d={d}
              fill="none"
              stroke={i === 0 ? accent : rule(2.2)}
              strokeWidth={i === 0 ? 2 : 1.2}
              opacity={weight}
              strokeDasharray={400}
              strokeDashoffset={400 * (1 - EXPO(p))}
            />
          );
        })}
        {tokens.map((token, i) => (
          <text
            key={`${i}-${token}`}
            x={at(i)}
            y={baseline - 14}
            fontFamily={MONO}
            fontSize={16}
            textAnchor="middle"
            fill={i === focus ? accent : PALETTE.muted}
          >
            {token}
          </text>
        ))}
      </svg>
      {note ? <div style={layout.label()}>{note}</div> : null}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* VectorSpace — meaning as position                                           */
/* -------------------------------------------------------------------------- */

export const VectorSpace: React.FC<
  BlockProps & {
    points: { x: number; y: number; label?: string }[];
    arrow?: { from: number; to: number; label: string };
    xLabel?: string;
    yLabel?: string;
  }
> = ({ points, arrow, xLabel, yLabel, start, index, durationInFrames }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const sweep = useSweep(start, durationInFrames);

  const W = 520;
  const H = 320;
  const pad = { l: 34, r: 34, t: 26, b: 40 };
  const px = (x: number) => pad.l + x * (W - pad.l - pad.r);
  const py = (y: number) => H - pad.b - y * (H - pad.t - pad.b);

  const a = arrow ? points[arrow.from] : null;
  const b = arrow ? points[arrow.to] : null;
  const p = EXPO(Math.max(0, Math.min(1, sweep / 0.6)));

  return (
    <div style={{ ...enter, width: "100%", flex: 1, minHeight: 0, display: "flex" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", flex: 1, minHeight: 0 }}>
        <path d={`M${pad.l} ${pad.t} V${H - pad.b} H${W - pad.r}`} stroke={rule(2)} fill="none" />
        {points.map((pt, i) => (
          <g key={i}>
            <circle cx={px(pt.x)} cy={py(pt.y)} r={3} fill={rule(2.8)} />
            {pt.label ? (
              <text
                x={px(pt.x) + 8}
                y={py(pt.y) - 7}
                fontFamily={SERIF}
                fontStyle="italic"
                fontSize={14}
                fill={PALETTE.muted}
              >
                {pt.label}
              </text>
            ) : null}
          </g>
        ))}
        {a && b && arrow ? (
          <g>
            <path
              d={`M${px(a.x)} ${py(a.y)} L${px(b.x)} ${py(b.y)}`}
              stroke={accent}
              strokeWidth={2}
              strokeDasharray={400}
              strokeDashoffset={400 * (1 - p)}
            />
            <circle cx={px(b.x)} cy={py(b.y)} r={4.5} fill={accent} opacity={p > 0.85 ? 1 : 0} />
            <text
              x={px(b.x) + 9}
              y={py(b.y) - 9}
              fontFamily={SERIF}
              fontStyle="italic"
              fontSize={16}
              fill={accent}
              opacity={p > 0.85 ? 1 : 0}
            >
              {arrow.label}
            </text>
          </g>
        ) : null}
        {xLabel ? (
          <text x={pad.l} y={H - 12} fontFamily={MONO} fontSize={11} fill={FAINT}>
            {xLabel}
          </text>
        ) : null}
        {yLabel ? (
          <text x={pad.l - 6} y={pad.t + 2} fontFamily={MONO} fontSize={11} fill={FAINT} textAnchor="end">
            {yLabel}
          </text>
        ) : null}
      </svg>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* MatrixGrid — weights as a lit grid                                          */
/* -------------------------------------------------------------------------- */

export const MatrixGrid: React.FC<
  BlockProps & {
    values: number[][];
    rowLabel?: string;
    colLabel?: string;
    valueLabel?: string;
    sweep: "row" | "cell";
  }
> = ({ values, rowLabel, colLabel, valueLabel, sweep, start, index, durationInFrames }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const progress = useSweep(start, durationInFrames);
  const rows = values.length;
  const cols = values[0]?.length ?? 0;

  // One row at a time — never all cells at once. A grid that lights up in a
  // single frame reads as a texture; lit row by row it reads as a computation.
  const head = progress * (sweep === "row" ? rows : rows * cols);

  return (
    <div
      style={{
        ...enter,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: layout.grid * 2.5,
        width: "100%",
      }}
    >
      <span
        style={{
          fontFamily: SERIF,
          fontStyle: "italic",
          fontSize: layout.type("subhead").fontSize * 0.7,
          color: PALETTE.muted,
          flex: "none",
        }}
      >
        A
      </span>
      <div
        style={{
          display: "grid",
          // Cells stay roughly square. Letting the grid take the full panel
          // width turns a matrix into a spreadsheet — the shape is the point.
          gridTemplateColumns: `repeat(${cols}, minmax(0, ${layout.px(104)}px))`,
          gap: layout.px(4),
          borderLeft: `1px solid ${rule(2)}`,
          borderRight: `1px solid ${rule(2)}`,
          padding: `${layout.px(6)}px ${layout.px(10)}px`,
        }}
      >
        {values.flatMap((row, r) =>
          row.map((v, c) => {
            const order = sweep === "row" ? r : r * cols + c;
            const lit = head > order;
            const hot = v > 0.4;
            return (
              <div
                key={`${r}-${c}`}
                style={{
                  fontFamily: MONO,
                  fontSize: layout.type("caption").fontSize * 0.95,
                  textAlign: "center",
                  padding: `${layout.px(7)}px 0`,
                  borderRadius: layout.px(3),
                  background: lit
                    ? hot
                      ? accentAt(accent, 0.1 + v * 0.28)
                      : `rgba(245,245,245,${0.02 + v * 0.1})`
                    : `rgba(245,245,245,0.02)`,
                  color: lit ? (hot ? accent : FAINT) : rule(3),
                }}
              >
                {v.toFixed(2)}
              </div>
            );
          }),
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: layout.grid,
          flex: "none",
          ...layout.label(),
        }}
      >
        {rowLabel ? <span style={{ color: accent }}>{rowLabel}</span> : null}
        {colLabel ? <span>{colLabel}</span> : null}
        {valueLabel ? <span>{valueLabel}</span> : null}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Distribution — the answer as probability                                    */
/* -------------------------------------------------------------------------- */

export const Distribution: React.FC<
  BlockProps & {
    prompt?: string;
    items: { label: string; p: number }[];
    note?: string;
  }
> = ({ prompt, items, note, start, index, durationInFrames }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const grow = useProgress(start, 900, MS.stagger * index + MS.enter);
  // Sorted descending, so the winner is always the top bar and the eye never
  // has to search for it.
  const sorted = [...items].sort((a, b) => b.p - a.p);
  const sample = useSweep(start, durationInFrames, 600);

  return (
    <div style={{ ...enter, display: "flex", flexDirection: "column", gap: layout.grid * 1.5, width: "100%" }}>
      {prompt ? (
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: layout.type("body").fontSize,
            color: PALETTE.muted,
            marginBottom: layout.grid,
          }}
        >
          {prompt.split("___").map((part, i, all) => (
            <React.Fragment key={i}>
              {part}
              {i < all.length - 1 ? <span style={{ color: PALETTE.ink }}>___</span> : null}
            </React.Fragment>
          ))}
        </div>
      ) : null}

      {sorted.map((item, i) => {
        const width = Math.max(0, Math.min(1, (grow - i * 0.08) / 0.6)) * item.p;
        const winner = i === 0;
        return (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: layout.grid * 1.5 }}>
            <span
              style={{
                fontFamily: MONO,
                fontSize: layout.type("caption").fontSize,
                color: winner ? accent : FAINT,
                width: layout.px(90),
                flex: "none",
                textAlign: "right",
              }}
            >
              {item.label}
            </span>
            <span
              style={{
                flex: 1,
                height: layout.px(18),
                background: `rgba(245,245,245,0.05)`,
                borderRadius: layout.px(2),
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${width * 100}%`,
                  borderRadius: layout.px(2),
                  background: winner ? accent : rule(2.2),
                }}
              />
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: layout.type("caption").fontSize * 0.9,
                color: winner ? accent : FAINT,
                width: layout.px(48),
                flex: "none",
              }}
            >
              {item.p.toFixed(2)}
            </span>
          </div>
        );
      })}

      {/* The answer lands after the bars, never with them. */}
      <div
        style={{
          marginTop: layout.grid,
          border: `1px solid ${accent}`,
          borderRadius: layout.radius.chip,
          background: accentAt(accent, 0.1),
          padding: `${layout.grid * 1.5}px ${layout.grid * 2}px`,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          opacity: sample > 0.05 ? 1 : 0,
          transform: `translateY(${(1 - Math.min(1, sample * 6)) * layout.px(12)}px)`,
        }}
      >
        <span style={{ ...layout.label(), color: accent }}>sampled</span>
        <span
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: layout.type("subhead").fontSize * 0.8,
            color: PALETTE.ink,
          }}
        >
          {sorted[0]?.label}
        </span>
      </div>
      {note ? <div style={layout.label()}>{note}</div> : null}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* LayerStack — depth                                                          */
/* -------------------------------------------------------------------------- */

export const LayerStack: React.FC<
  BlockProps & { count: number; bottomLabel?: string; topLabel?: string }
> = ({ count, bottomLabel, topLabel, start, index, durationInFrames }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const travel = useSweep(start, durationInFrames);
  const lit = Math.min(count - 1, Math.floor(travel * count));

  return (
    <div
      style={{
        ...enter,
        display: "flex",
        justifyContent: "center",
        gap: layout.grid * 2.5,
        width: "100%",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Narrow on purpose: this is a stack seen in profile, and a full-width
          one reads as hatching rather than as depth. The bars flex so 32 of
          them fit whatever height the panel has left. */}
      <div
        style={{
          position: "relative",
          width: layout.px(460),
          maxWidth: "60%",
          display: "flex",
          flexDirection: "column",
          gap: layout.px(3),
          minHeight: 0,
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            style={{
              display: "block",
              flex: 1,
              minHeight: layout.px(3),
              borderRadius: layout.px(2),
              border: `1px solid ${i === lit ? accent : rule()}`,
              background: i === lit ? accentAt(accent, 0.3) : `rgba(245,245,245,0.03)`,
            }}
          />
        ))}
        <span
          style={{
            position: "absolute",
            left: layout.px(-14),
            top: `${(lit / count) * 100}%`,
            width: layout.px(5),
            height: layout.px(10),
            borderRadius: layout.px(1),
            background: accent,
          }}
        />
      </div>
      <div
        style={{
          flex: "none",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          ...layout.label(),
        }}
      >
        <span>{topLabel ?? ""}</span>
        <span style={{ color: accent }}>{`${lit + 1} / ${count}`}</span>
        <span>{bottomLabel ?? ""}</span>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* ScaleBar — orders of magnitude                                              */
/* -------------------------------------------------------------------------- */

export const ScaleBar: React.FC<
  BlockProps & { ticks: string[]; value: number; label?: string }
> = ({ ticks, value, label, start, index, durationInFrames }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const grow = useSweep(start, durationInFrames) * value;

  const W = 520;
  const H = 150;
  const axis = 96;
  const left = 24;
  const right = W - 24;

  return (
    <div style={{ ...enter, width: "100%", flex: 1, minHeight: 0, display: "flex", maxHeight: layout.px(260) }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", flex: 1, minHeight: 0 }}>
        <path d={`M${left} ${axis} H${right}`} stroke={rule(2)} />
        {ticks.map((tick, i) => {
          const x = left + (i / (ticks.length - 1)) * (right - left);
          return (
            <g key={tick}>
              <path d={`M${x} ${axis - 7} V${axis + 7}`} stroke={rule(2)} />
              <text x={x} y={axis + 26} fontFamily={MONO} fontSize={12} fill={FAINT} textAnchor="middle">
                {tick}
              </text>
            </g>
          );
        })}
        <rect
          x={left}
          y={axis - 22}
          width={Math.max(0, grow * (right - left))}
          height={5}
          rx={2.5}
          fill={accent}
        />
        {label ? (
          <text
            x={left + grow * (right - left)}
            y={axis - 34}
            fontFamily={MONO}
            fontSize={12}
            fill={accent}
            textAnchor="middle"
          >
            {label}
          </text>
        ) : null}
      </svg>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* AnalogyInset — the only texture in the system                               */
/* -------------------------------------------------------------------------- */

export const AnalogyInset: React.FC<BlockProps & { caption: string; src?: string }> = ({
  caption,
  src,
  start,
  index,
  durationInFrames,
}) => {
  const layout = useLayout();
  const enter = useEntrance(start, index, layout.px(12));
  const spin = useSweep(start, durationInFrames);

  return (
    <div
      style={{
        ...enter,
        width: "100%",
        border: `1px dashed ${rule(1.8)}`,
        borderRadius: layout.radius.inner,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: layout.grid * 2,
        padding: layout.grid * 3,
        minHeight: layout.px(220),
        overflow: "hidden",
      }}
    >
      {src ? (
        <Img
          src={staticFile(src)}
          style={{ maxWidth: "100%", maxHeight: layout.px(300), objectFit: "contain" }}
        />
      ) : (
        // Held inside the hairline frame rather than bleeding to the edges: a
        // photograph that fills the frame breaks the diagrammatic register the
        // rest of the system depends on.
        <span
          style={{
            width: layout.px(90),
            height: layout.px(90),
            border: `1px solid ${rule(2.4)}`,
            borderRadius: layout.px(6),
            transform: `rotate(${45 + spin * 90}deg)`,
          }}
        />
      )}
      <span style={layout.label()}>{caption}</span>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* TextBeat — the breather                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One sentence, full frame, nothing else. Resets attention.
 *
 * There is no device here on purpose. After sixty seconds of diagrams the most
 * effective thing you can put on screen is a single claim with nothing to read
 * around it.
 */
export const TextBeat: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const layout = useLayout();
  // Long-form centres; a reel does not. A 9:16 frame is read like a page, and
  // centred type in a narrow column gives every line a different left edge.
  const align = layout.format === "reel" ? "left" : "center";

  return (
    <AlignContext.Provider value={align}>
      <div
        style={{
          width: "100%",
          height: "100%",
          maxWidth: layout.format === "long" ? layout.px(1180) : "100%",
          marginInline: align === "center" ? "auto" : undefined,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: layout.grid * 3,
        }}
      >
        {children}
      </div>
    </AlignContext.Provider>
  );
};
