import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { accentOf, COLOR, EASE, oppositeAccentOf, t, type Accent, type Layout } from "../theme";
import { withAlpha } from "../palette";
import type {
  Layers as LayersData,
  Mismatch as MismatchData,
  Predict as PredictData,
  Rescan as RescanData,
  Tokenize as TokenizeData,
} from "../schema";

/**
 * Illustrations that *depict* what the line says, rather than decorating it.
 *
 * All three are pure DOM/SVG driven by the frame number — no WebGL, so they cost
 * almost nothing to render and cannot fail to get a context.
 */

const MONO =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * RESCAN — the cost of generation, made visible.
 *
 * A row of token cells builds up left to right. Before each new token is written,
 * a read-head sweeps the cells it must consult.
 *
 *   cached: false → the head sweeps *every* previous cell each step. The sweep
 *                   gets visibly longer and slower as the row grows, and the
 *                   read counter climbs quadratically. This is the problem.
 *   cached: true  → the head touches only the new cell. The counter climbs by
 *                   one. Same component, same layout, opposite behaviour — which
 *                   is what makes the before/after comparison land.
 */
export const Rescan: React.FC<{
  data: RescanData;
  layout: Layout;
  accent: Accent;
  start: number;
  exit: number;
}> = ({ data, layout, accent, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;
  const tone = accentOf(accent);
  const warn = oppositeAccentOf(accent);
  const n = data.tokens;
  const cached = data.cached;

  const local = frame - start;
  // Naive steps take longer as the row grows; cached steps are constant. The
  // pacing itself carries the argument.
  const stepFrames = cached ? 12 : 20;
  const step = Math.max(0, Math.floor(local / stepFrames));
  const written = Math.min(n, step + 1);
  const within = (local % stepFrames) / stepFrames;

  // How far the read-head has travelled this step.
  const headSpan = cached ? 1 : written;
  const headPos = cached ? written - 1 : within * headSpan;

  // Cumulative reads: n(n+1)/2 naive versus n cached.
  const reads = cached
    ? written
    : (written * (written + 1)) / 2;

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });
  const enter = interpolate(frame, [start, start + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });

  const cell = 50 * k;
  const gap = 8 * k;

  return (
    <div
      style={{
        marginTop: 30 * k,
        alignSelf: "stretch",
        opacity: out * enter,
        translate: `0 ${(1 - enter) * 16 * k}px`,
      }}
    >
      <div style={{ display: "flex", gap, flexWrap: "nowrap" }}>
        {new Array(n).fill(0).map((_, i) => {
          const isWritten = i < written;
          const isNew = i === written - 1;
          // The read-head illuminates a cell as it passes over it.
          const underHead = isWritten && Math.abs(i - headPos) < 0.9;
          const lit = cached ? isNew : underHead;

          return (
            <div
              key={i}
              style={{
                width: cell,
                height: cell * 1.45,
                borderRadius: 4 * k,
                flexShrink: 0,
                background: isWritten
                  ? lit
                    ? withAlpha(warn.base, 0.9)
                    : withAlpha(tone.base, 0.24)
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${
                  isWritten ? withAlpha(tone.base, lit ? 0.95 : 0.4) : COLOR.hairline
                }`,
                boxShadow: lit ? `0 0 ${16 * k}px ${withAlpha(warn.glow, 0.65)}` : undefined,
                // The newest cell pops slightly as it is written.
                scale: isNew && within < 0.3 ? `${1 + (0.3 - within) * 0.6}` : "1",
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          gap: 26 * k,
          marginTop: 16 * k,
          fontFamily: MONO,
          fontSize: t(layout, "body") * 0.88,
          fontWeight: 600,
        }}
      >
        <span style={{ color: COLOR.inkLow }}>
          tokens written{" "}
          <b style={{ color: COLOR.inkHigh, fontVariantNumeric: "tabular-nums" }}>{written}</b>
        </span>
        <span style={{ color: COLOR.inkLow }}>
          total reads{" "}
          <b
            style={{
              color: cached ? tone.base : warn.base,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.round(reads)}
          </b>
        </span>
        <span style={{ color: cached ? tone.base : warn.base, fontWeight: 700 }}>
          {cached ? "cached · O(1) per token" : "naive · O(n) per token"}
        </span>
      </div>
    </div>
  );
};

/**
 * PREDICT — next-token probabilities as horizontal bars.
 *
 * Form: comparing magnitudes across a handful of named categories, so bars, not
 * a pie or a line. One hue carries "probability"; the absurd option is the only
 * thing drawn in the warning accent, and it is labelled, so colour is never the
 * sole signal.
 */
export const Predict: React.FC<{
  data: PredictData;
  layout: Layout;
  accent: Accent;
  start: number;
  exit: number;
}> = ({ data, layout, accent, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;
  const tone = accentOf(accent);
  const warn = oppositeAccentOf(accent);

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  const promptParts = data.prompt.split("___");
  const blankFill = interpolate(frame, [start + 46, start + 66], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });
  const top = data.candidates.reduce((a, b) => (b.p > a.p ? b : a), data.candidates[0]);
  const max = Math.max(...data.candidates.map((c) => c.p));

  return (
    <div style={{ marginTop: 28 * k, alignSelf: "stretch", opacity: out }}>
      {/* The prompt, with the blank filling in once the bars have resolved. */}
      <div
        style={{
          fontFamily: MONO,
          fontSize: t(layout, "body") * 1.05,
          fontWeight: 600,
          color: COLOR.inkMid,
          marginBottom: 22 * k,
          opacity: interpolate(frame, [start, start + 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE.out,
          }),
        }}
      >
        {promptParts[0]}
        <span
          style={{
            display: "inline-block",
            minWidth: 92 * k,
            textAlign: "center",
            padding: `${2 * k}px ${10 * k}px`,
            borderRadius: 5 * k,
            border: `1px dashed ${withAlpha(tone.base, 0.55)}`,
            background: withAlpha(tone.base, 0.08 + blankFill * 0.14),
            color: blankFill > 0.5 ? tone.base : COLOR.inkLow,
            fontWeight: 800,
          }}
        >
          {blankFill > 0.5 ? top.label : "?"}
        </span>
        {promptParts[1] ?? ""}
      </div>

      {data.candidates.map((c, i) => {
        const delay = start + 20 + i * 7;
        const grow = interpolate(frame, [delay, delay + 26], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE.out,
        });
        const barTone = c.absurd ? warn : tone;
        // Scale to the largest candidate so the smallest is still visible.
        const width = (c.p / max) * 100 * grow;

        return (
          <div
            key={c.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12 * k,
              marginBottom: 9 * k,
              opacity: grow,
            }}
          >
            <span
              style={{
                width: 86 * k,
                flexShrink: 0,
                textAlign: "right",
                fontFamily: MONO,
                fontSize: t(layout, "body") * 0.82,
                fontWeight: 700,
                color: c.absurd ? warn.base : COLOR.inkHigh,
              }}
            >
              {c.label}
            </span>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: 13 * k,
                background: "rgba(255,255,255,0.04)",
                borderRadius: 3 * k,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(width, c.p > 0 ? 0.6 : 0)}%`,
                  height: "100%",
                  // 4px rounded data-end, anchored to the baseline.
                  borderRadius: `0 ${3 * k}px ${3 * k}px 0`,
                  background: barTone.base,
                  boxShadow: `0 0 ${14 * k}px ${withAlpha(barTone.glow, 0.4)}`,
                }}
              />
            </div>
            <span
              style={{
                width: 62 * k,
                flexShrink: 0,
                fontFamily: MONO,
                fontSize: t(layout, "body") * 0.74,
                fontWeight: 600,
                color: COLOR.inkLow,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {c.p >= 0.01 ? `${Math.round(c.p * 100)}%` : "<1%"}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * TOKENIZE — a word becoming numbers.
 *
 * Three staged beats: the whole word, then its token pieces separating, then a
 * short numeric vector dropping out of each piece. It makes "it understands
 * numbers, not words" concrete in about two seconds of screen time.
 */
export const Tokenize: React.FC<{
  data: TokenizeData;
  layout: Layout;
  accent: Accent;
  start: number;
  exit: number;
}> = ({ data, layout, accent, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;
  const tone = accentOf(accent);

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  // Beat 1: word appears. Beat 2: it splits. Beat 3: numbers drop out.
  const appear = interpolate(frame, [start, start + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });
  const split = interpolate(frame, [start + 22, start + 46], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });

  /** Deterministic pseudo-embedding — stable across render workers. */
  const vec = (seed: number, j: number) => {
    const x = Math.sin(seed * 12.9898 + j * 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };

  return (
    <div
      style={{
        marginTop: 30 * k,
        alignSelf: "stretch",
        opacity: out * appear,
        display: "flex",
        gap: 10 * k + split * 16 * k,
        flexWrap: "wrap",
      }}
    >
      {data.pieces.map((piece, i) => {
        const drop = interpolate(frame, [start + 46 + i * 8, start + 70 + i * 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE.out,
        });

        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 * k }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: t(layout, "body") * 1.15,
                fontWeight: 700,
                color: COLOR.inkHigh,
                padding: `${8 * k}px ${13 * k}px`,
                borderRadius: 6 * k,
                background: withAlpha(tone.base, 0.05 + split * 0.09),
                border: `1px solid ${withAlpha(tone.base, 0.1 + split * 0.34)}`,
                textAlign: "center",
              }}
            >
              {piece}
            </div>

            {/* The vector this piece becomes. */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2 * k,
                opacity: drop,
                translate: `0 ${(1 - drop) * -10 * k}px`,
              }}
            >
              {new Array(4).fill(0).map((__, j) => (
                <span
                  key={j}
                  style={{
                    fontFamily: MONO,
                    fontSize: t(layout, "body") * 0.62,
                    fontWeight: 500,
                    color: withAlpha(tone.base, 0.85),
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "center",
                  }}
                >
                  {vec(i + 1, j).toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * LAYERS — the skyscraper of kitchens.
 *
 * Floors stack upward, each carrying its own row of shelf cards. Cards fill
 * floor by floor from the bottom, because that is the actual dependency: floor
 * 12's cards are written from floor 11's output. The animation encodes the
 * cascading-dependency argument the script makes two chapters later.
 */
export const Layers: React.FC<{
  data: LayersData;
  layout: Layout;
  accent: Accent;
  start: number;
  exit: number;
}> = ({ data, layout, accent, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;
  const tone = accentOf(accent);
  const local = frame - start;

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  const perFloor = 13;
  const CELLS = 12;

  return (
    <div
      style={{
        marginTop: 26 * k,
        alignSelf: "stretch",
        display: "flex",
        flexDirection: "column-reverse",
        gap: 5 * k,
        opacity: out,
      }}
    >
      {new Array(data.count).fill(0).map((_, floor) => {
        const arrive = interpolate(
          local,
          [floor * perFloor, floor * perFloor + 22],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.out },
        );
        const label =
          floor === 0 ? data.bottomLabel : floor === data.count - 1 ? data.topLabel : undefined;

        return (
          <div
            key={floor}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10 * k,
              opacity: arrive,
              // Floors slide in from the left, one after another, bottom first.
              translate: `${(1 - arrive) * -26 * k}px 0`,
            }}
          >
            <span
              style={{
                width: 26 * k,
                flexShrink: 0,
                textAlign: "right",
                fontFamily: MONO,
                fontSize: t(layout, "body") * 0.62,
                fontWeight: 600,
                color: COLOR.inkLow,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              L{floor + 1}
            </span>

            <div style={{ display: "flex", gap: 3 * k }}>
              {new Array(CELLS).fill(0).map((__, c) => {
                // Cards on a floor fill left to right once that floor has landed.
                const fill = interpolate(
                  local,
                  [floor * perFloor + 14 + c * 2, floor * perFloor + 22 + c * 2],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                );
                return (
                  <div
                    key={c}
                    style={{
                      width: 15 * k,
                      height: 19 * k,
                      borderRadius: 2 * k,
                      background: withAlpha(tone.base, 0.1 + fill * 0.55),
                      border: `1px solid ${withAlpha(tone.base, 0.16 + fill * 0.5)}`,
                    }}
                  />
                );
              })}
            </div>

            {label ? (
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: t(layout, "body") * 0.6,
                  fontWeight: 600,
                  color: withAlpha(tone.base, 0.85),
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/**
 * MISMATCH — two architectures that cannot line up.
 *
 * Two stacks with different floor counts sit side by side, and dashed connectors
 * try to map one onto the other. They visibly fail: some floors have no partner.
 * "80 floors versus 60 floors has no sane mapping" is hard to hold in words and
 * obvious in one glance here.
 */
export const Mismatch: React.FC<{
  data: MismatchData;
  layout: Layout;
  accent: Accent;
  start: number;
  exit: number;
}> = ({ data, layout, accent, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;
  const tone = accentOf(accent);
  const warn = oppositeAccentOf(accent);
  const local = frame - start;

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  const stack = (
    side: { label: string; rows: number },
    colour: { base: string; glow: string },
    offset: number,
  ) => (
    <div style={{ display: "flex", flexDirection: "column-reverse", gap: 4 * k }}>
      {new Array(side.rows).fill(0).map((_, i) => {
        const arrive = interpolate(local, [offset + i * 6, offset + i * 6 + 20], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE.out,
        });
        return (
          <div
            key={i}
            style={{
              width: 108 * k,
              height: 16 * k,
              borderRadius: 3 * k,
              background: withAlpha(colour.base, 0.2),
              border: `1px solid ${withAlpha(colour.base, 0.5)}`,
              opacity: arrive,
              scale: `${0.7 + arrive * 0.3} 1`,
              transformOrigin: "left center",
            }}
          />
        );
      })}
      <span
        style={{
          fontFamily: MONO,
          fontSize: t(layout, "body") * 0.68,
          fontWeight: 700,
          color: colour.base,
          marginBottom: 8 * k,
        }}
      >
        {side.label}
      </span>
    </div>
  );

  // The unmatched floors — the whole point — flash once both stacks have landed.
  const surplus = Math.abs(data.left.rows - data.right.rows);
  const reveal = interpolate(local, [58, 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });

  return (
    <div style={{ marginTop: 26 * k, alignSelf: "stretch", opacity: out }}>
      <div style={{ display: "flex", gap: 46 * k, alignItems: "flex-end" }}>
        {stack(data.left, tone, 0)}
        {stack(data.right, warn, 14)}
        <div
          style={{
            opacity: reveal,
            translate: `${(1 - reveal) * -12 * k}px 0`,
            paddingBottom: 26 * k,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: t(layout, "body") * 0.78,
              fontWeight: 700,
              color: warn.base,
            }}
          >
            {surplus} floors unmatched
          </div>
          {data.note ? (
            <div
              style={{
                fontFamily: MONO,
                fontSize: t(layout, "body") * 0.64,
                fontWeight: 500,
                color: COLOR.inkLow,
                marginTop: 5 * k,
              }}
            >
              {data.note}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
