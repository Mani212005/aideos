import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  accentAt,
  FAINT,
  ink,
  MONO,
  PALETTE,
  rule,
  SERIF,
  SUNKEN,
  useLayout,
  type DLLayout,
} from "./tokens";
import { EXPO, frames, MS, useEntrance, useProgress } from "./motion";
import { useAccent } from "./accent";
import { useAlign } from "./align";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE — PRIMITIVES
 * ---------------------------------------------------------------------------
 * Implements §04. Animation is baked into each component rather than applied by
 * the scene that uses it: a caller can decide *when* something enters (by its
 * order among siblings) but never *how*, which is the only reason eight
 * independently written components read as one film.
 *
 * Every primitive takes `start` (the frame its panel began) and `index` (its
 * position among siblings). Those two numbers are the whole timing contract.
 */

export type BlockProps = {
  /** Frame this block's panel began. */
  start: number;
  /** Position among siblings. The only thing that decides a delay. */
  index: number;
  /** How long the shot holds. Devices pace their internal sweep across it. */
  durationInFrames: number;
};

const stripPunct = (w: string) => w.replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase();

/**
 * Split a headline into animatable words.
 *
 * Two things this has to get right. First, the animation unit is the *word*,
 * not the markup chunk — splitting on markers orphans full stops onto their own
 * line, where they fade up as a floating dot. Second, `*marked*` spans are
 * stripped from the output: leaving the asterisks in is how a marker convention
 * ends up printed on screen at 134px.
 *
 * A span may cover several words (`*weighted sums*`), so the markers are
 * resolved against character offsets in the cleaned string rather than
 * per-token.
 */
const parseHeadline = (text: string, accentWord?: string) => {
  const spans: [number, number][] = [];
  let clean = "";
  let open: number | null = null;

  for (const ch of text) {
    if (ch === "*") {
      if (open === null) open = clean.length;
      else {
        spans.push([open, clean.length]);
        open = null;
      }
      continue;
    }
    clean += ch;
  }
  // An unclosed marker means the author meant a literal asterisk. Keep it.
  if (open !== null) clean = text.replace(/\*/g, (_m, i) => (i === open ? "*" : ""));

  const target = accentWord ? stripPunct(accentWord) : null;
  const out: { word: string; accent: boolean }[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean)) !== null) {
    const at = match.index;
    const inSpan = spans.some(([a, b]) => at >= a && at < b);
    out.push({
      word: match[0],
      accent: inSpan || (target !== null && stripPunct(match[0]) === target),
    });
  }
  return out;
};

/* -------------------------------------------------------------------------- */
/* Type                                                                        */
/* -------------------------------------------------------------------------- */

export const Kicker: React.FC<BlockProps & { text: string }> = ({ text, start, index }) => {
  const layout = useLayout();
  const accent = useAccent();
  const align = useAlign();
  const enter = useEntrance(start, index, layout.px(12));

  return (
    <div
      style={{
        ...enter,
        display: "flex",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: layout.grid,
        ...layout.label(),
        color: accent,
      }}
    >
      <span
        style={{
          width: layout.px(9),
          height: layout.px(9),
          borderRadius: layout.px(2),
          background: accent,
        }}
      />
      <span>{text}</span>
    </div>
  );
};

/**
 * The headline treatment. Words rise on a 70ms stagger; the accent word draws
 * an underline under itself once it has landed.
 *
 * One accent word, never two — §01 budgets three accents per *frame*, and the
 * headline is only ever entitled to one of them.
 */
export const TextReveal: React.FC<
  BlockProps & { text: string; size: "display" | "headline" | "subhead"; accentWord?: string }
> = ({ text, size, accentWord, start, index }) => {
  const layout = useLayout();
  const accent = useAccent();
  const align = useAlign();
  const { fps } = useVideoConfig();
  const base = start + frames(MS.stagger * index, fps);

  return (
    <div
      style={{
        ...layout.type(size),
        color: PALETTE.ink,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : "flex-start",
        columnGap: "0.28em",
        rowGap: "0.06em",
        textWrap: "pretty",
      }}
    >
      {parseHeadline(text, accentWord).map((token, i) => (
        <Word
          key={`${i}-${token.word}`}
          word={token.word}
          start={base}
          index={i}
          accent={token.accent ? accent : null}
        />
      ))}
    </div>
  );
};

const Word: React.FC<{ word: string; start: number; index: number; accent: string | null }> = ({
  word,
  start,
  index,
  accent,
}) => {
  const layout = useLayout();
  const enter = useEntrance(start, index, layout.px(12));
  // The underline draws only after the word it belongs to has arrived.
  const draw = useProgress(start, MS.enter, MS.stagger * index + MS.enter * 0.6);

  if (!accent) return <span style={{ ...enter, display: "inline-block" }}>{word}</span>;

  // Punctuation stays welded to the word for layout, but it is not part of the
  // accent: colouring the comma after "linearly," and running the underline
  // beneath it makes the highlight look like a selection rather than a mark.
  const [, core, tail] = /^(.*?)([^\p{L}\p{N}]*)$/u.exec(word) ?? ["", word, ""];

  return (
    <span style={{ ...enter, display: "inline-block" }}>
      <span style={{ position: "relative", display: "inline-block", color: accent }}>
        {core}
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "-0.1em",
            height: layout.px(2),
            background: accent,
            transformOrigin: "left",
            transform: `scaleX(${draw})`,
          }}
        />
      </span>
      {tail}
    </span>
  );
};

export const Body: React.FC<BlockProps & { text: string }> = ({ text, start, index }) => {
  const layout = useLayout();
  const align = useAlign();
  const enter = useEntrance(start, index, layout.px(12));
  return (
    <div
      style={{
        ...enter,
        ...layout.type("body"),
        color: PALETTE.muted,
        // A measure, not a full-bleed line. Body copy running the width of a
        // 1920 frame is unreadable regardless of how big the type is.
        maxWidth: layout.format === "long" ? layout.px(680) : "100%",
        marginInline: align === "center" ? "auto" : undefined,
        textAlign: align === "center" ? "center" : "left",
        textWrap: "pretty",
      }}
    >
      {text}
    </div>
  );
};

/** Maths, in italic serif. `*token*` accents a symbol. */
export const MathLine: React.FC<BlockProps & { text: string }> = ({ text, start, index }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));

  return (
    <div style={{ ...enter, display: "flex", alignItems: "baseline", gap: layout.grid * 2 }}>
      <span style={{ ...layout.label(), flex: "none" }}>math</span>
      <span
        style={{
          fontFamily: SERIF,
          fontStyle: "italic",
          fontSize: layout.type("subhead").fontSize * 0.85,
          color: PALETTE.ink,
          lineHeight: 1.3,
        }}
      >
        {text.split(/(\*[^*]+\*)/g).map((part, i) =>
          part.startsWith("*") && part.endsWith("*") && part.length > 2 ? (
            <span key={i} style={{ color: accent }}>
              {part.slice(1, -1)}
            </span>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </span>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

const compact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${n}`;
};

/**
 * A number counting up. Tabular figures are not optional: proportional digits
 * change width as they tick and the whole line jitters for the full 900ms.
 */
export const StatCounter: React.FC<
  BlockProps & { to: number; label: string; format: "plain" | "compact"; suffix?: string }
> = ({ to, label, format, suffix, start, index }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const p = useProgress(start, 900, MS.stagger * index);
  const value = Math.round(to * p);

  return (
    <div style={{ ...enter, display: "flex", flexDirection: "column", gap: layout.grid }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: layout.type("headline").fontSize * 0.9,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          color: accent,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {format === "compact" ? compact(value) : value.toLocaleString("en-US")}
        {suffix ? (
          <span style={{ fontSize: "0.42em", color: PALETTE.muted }}> {suffix}</span>
        ) : null}
      </div>
      <div style={layout.label()}>{label}</div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

export const Divider: React.FC<BlockProps> = ({ start, index }) => {
  const layout = useLayout();
  const draw = useProgress(start, MS.enter, MS.stagger * index);
  return (
    <div
      style={{
        height: 1,
        background: rule(),
        transformOrigin: "left",
        transform: `scaleX(${draw})`,
        marginBlock: layout.grid,
      }}
    />
  );
};

export const IconLabel: React.FC<BlockProps & { text: string }> = ({ text, start, index }) => {
  const layout = useLayout();
  const accent = useAccent();
  const align = useAlign();
  const enter = useEntrance(start, index, layout.px(12));
  return (
    <div
      style={{
        ...enter,
        display: "flex",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: layout.grid * 1.5,
      }}
    >
      <span
        style={{
          width: layout.px(22),
          height: layout.px(22),
          border: `1px solid ${rule(2)}`,
          borderRadius: layout.radius.chip * 0.7,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <span
          style={{
            width: layout.px(8),
            height: layout.px(8),
            borderRadius: layout.px(1),
            background: accent,
          }}
        />
      </span>
      <span style={{ fontFamily: MONO, fontSize: layout.type("caption").fontSize, color: PALETTE.muted }}>
        {text}
      </span>
    </div>
  );
};

/** High-clarity glassmorphic card with luminous accents */
export const Card: React.FC<
  BlockProps & { title: string; body?: string; state: "idle" | "active" }
> = ({ title, body, state, start, index }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const active = state === "active";

  return (
    <div
      style={{
        ...enter,
        border: `1.5px solid ${active ? accent : "rgba(255, 255, 255, 0.12)"}`,
        borderRadius: layout.radius.inner + 4,
        background: active
          ? "linear-gradient(135deg, rgba(16, 36, 52, 0.94) 0%, rgba(8, 20, 30, 0.98) 100%)"
          : "linear-gradient(135deg, rgba(22, 26, 36, 0.88) 0%, rgba(12, 14, 20, 0.96) 100%)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        padding: `${layout.grid * 2}px ${layout.grid * 2.5}px`,
        display: "flex",
        flexDirection: "column",
        gap: layout.grid * 1.2,
        boxShadow: active
          ? `0 16px 36px rgba(0, 0, 0, 0.5), 0 0 24px ${accentAt(accent, 0.25)}, inset 0 1px 1px rgba(255, 255, 255, 0.3)`
          : "0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: "0.12em",
            fontWeight: 700,
            textTransform: "uppercase",
            color: active ? accent : "rgba(255, 255, 255, 0.5)",
            background: active ? accentAt(accent, 0.16) : "rgba(255, 255, 255, 0.06)",
            padding: "2px 8px",
            borderRadius: 6,
            border: `1px solid ${active ? accentAt(accent, 0.3) : "rgba(255, 255, 255, 0.08)"}`,
          }}
        >
          {active ? "⚡ ACTIVE SPEC" : "◈ SYSTEM SPEC"}
        </span>
      </div>
      <span style={{ ...layout.type("body"), color: "#FFFFFF", fontWeight: 600 }}>{title}</span>
      {body ? (
        <span style={{ ...layout.type("caption"), color: "rgba(255, 255, 255, 0.85)", lineHeight: 1.45 }}>
          {body}
        </span>
      ) : null}
    </div>
  );
};

/** Segmented for long-form, continuous for reels. */
export const ProgressBar: React.FC<
  BlockProps & { value: number; label?: string; chapters?: number }
> = ({ value, label, chapters, start, index }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const p = useProgress(start, 900, MS.stagger * index) * value;

  return (
    <div style={{ ...enter, display: "flex", flexDirection: "column", gap: layout.grid * 1.5 }}>
      {label ? (
        <div style={{ display: "flex", justifyContent: "space-between", ...layout.label() }}>
          <span>{label}</span>
          <span style={{ color: accent }}>{Math.round(p * 100)}%</span>
        </div>
      ) : null}
      <div
        style={{
          height: layout.px(4),
          borderRadius: layout.px(2),
          background: rule(),
          overflow: "hidden",
        }}
      >
        <div style={{ height: "100%", width: `${p * 100}%`, background: accent }} />
      </div>
      {chapters ? (
        <div style={{ display: "flex", gap: layout.grid }}>
          {Array.from({ length: chapters }, (_, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: layout.px(2),
                background: i / chapters < value ? accent : rule(),
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Plot                                                                        */
/* -------------------------------------------------------------------------- */

type Pt = { x: number; y: number };

/**
 * Catmull-Rom through the points, converted to cubic beziers.
 *
 * The evaluator is kept alongside the path builder on purpose: the travelling
 * dot has to sit exactly on the drawn line, and eyeballing it with a separate
 * linear interpolation puts the dot visibly off the curve at every bend.
 */
const spline = (pts: Pt[]) => {
  const segs: { p0: Pt; p1: Pt; p2: Pt; p3: Pt }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p3 = pts[i + 1];
    const prev = pts[i - 1] ?? p0;
    const next = pts[i + 2] ?? p3;
    segs.push({
      p0,
      p1: { x: p0.x + (p3.x - prev.x) / 6, y: p0.y + (p3.y - prev.y) / 6 },
      p2: { x: p3.x - (next.x - p0.x) / 6, y: p3.y - (next.y - p0.y) / 6 },
      p3,
    });
  }

  const d =
    `M${pts[0].x} ${pts[0].y}` +
    segs.map((s) => ` C${s.p1.x} ${s.p1.y}, ${s.p2.x} ${s.p2.y}, ${s.p3.x} ${s.p3.y}`).join("");

  const at = (t: number): Pt => {
    if (segs.length === 0) return pts[0];
    const scaled = Math.max(0, Math.min(1, t)) * segs.length;
    const i = Math.min(segs.length - 1, Math.floor(scaled));
    const u = scaled - i;
    const { p0, p1, p2, p3 } = segs[i];
    const v = 1 - u;
    return {
      x: v ** 3 * p0.x + 3 * v ** 2 * u * p1.x + 3 * v * u ** 2 * p2.x + u ** 3 * p3.x,
      y: v ** 3 * p0.y + 3 * v ** 2 * u * p1.y + 3 * v * u ** 2 * p2.y + u ** 3 * p3.y,
    };
  };

  // Numeric arc length, so the dash animation and the dot agree.
  let length = 0;
  let last = at(0);
  for (let i = 1; i <= 120; i++) {
    const p = at(i / 120);
    length += Math.hypot(p.x - last.x, p.y - last.y);
    last = p;
  }

  return { d, at, length };
};

/** One line, one dot, labelled ends. Never a legend, never a second series. */
export const Plot: React.FC<
  BlockProps & {
    points: [number, number][];
    xLabel?: string;
    yLabel?: string;
    endLabel?: string;
  }
> = ({ points, xLabel, yLabel, endLabel, start, index }) => {
  const layout = useLayout();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const p = useProgress(start, 2600, MS.stagger * index);

  const W = 520;
  const H = 300;
  const pad = { l: 40, r: 30, t: 24, b: 40 };
  const mapped = points.map(([x, y]) => ({
    x: pad.l + x * (W - pad.l - pad.r),
    y: H - pad.b - y * (H - pad.t - pad.b),
  }));
  const { d, at, length } = spline(mapped);
  const head = at(p);

  return (
    // `flex: 1` plus `minHeight: 0` is what stops a tall chart pushing its own
    // headline out of the panel: the SVG takes the space that is left rather
    // than the space its aspect ratio wants, and letterboxes inside it.
    <div style={{ ...enter, width: "100%", flex: 1, minHeight: 0, display: "flex" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", flex: 1, minHeight: 0 }}>
        <g stroke={rule(0.6)} strokeWidth={1}>
          {[0.25, 0.5, 0.75].map((f) => (
            <path key={f} d={`M${pad.l} ${pad.t + f * (H - pad.t - pad.b)} H${W - pad.r}`} />
          ))}
        </g>
        <path d={`M${pad.l} ${pad.t} V${H - pad.b} H${W - pad.r}`} stroke={rule(2)} fill="none" />
        <path
          d={d}
          fill="none"
          stroke={accent}
          strokeWidth={2.5}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - p)}
        />
        <circle cx={head.x} cy={head.y} r={4.5} fill={accent} opacity={p > 0.02 ? 1 : 0} />
        {yLabel ? (
          <text x={pad.l - 8} y={pad.t + 4} fontFamily={MONO} fontSize={11} fill={FAINT} textAnchor="end">
            {yLabel}
          </text>
        ) : null}
        {xLabel ? (
          <text x={pad.l} y={H - 12} fontFamily={MONO} fontSize={11} fill={FAINT}>
            {xLabel}
          </text>
        ) : null}
        {endLabel ? (
          <text
            x={W - pad.r}
            y={H - 12}
            fontFamily={MONO}
            fontSize={11}
            fill={FAINT}
            textAnchor="end"
          >
            {endLabel}
          </text>
        ) : null}
      </svg>
    </div>
  );
};

/**
 * A hairline rectangle that grows from `fromRect` to `toRect` on the curve.
 * This is the §08 join — a canvas node's border becoming a device frame — and
 * it is deliberately the same shape in both directions, so a zoom-out is
 * always the exact reverse of the entry that produced it.
 */
export const useJoin = (
  fromRect: { x: number; y: number; w: number; h: number },
  toRect: { x: number; y: number; w: number; h: number },
  start: number,
) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [start, start + frames(MS.move, fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EXPO,
  });
  const mix = (a: number, b: number) => a + (b - a) * p;
  return {
    progress: p,
    rect: {
      x: mix(fromRect.x, toRect.x),
      y: mix(fromRect.y, toRect.y),
      w: mix(fromRect.w, toRect.w),
      h: mix(fromRect.h, toRect.h),
    },
  };
};

export const hairlineFrame = (layout: DLLayout): React.CSSProperties => ({
  border: `1px solid ${rule()}`,
  borderRadius: layout.radius.card,
  background: PALETTE.canvas,
});

export const scrim = ink(0.02);
