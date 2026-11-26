/**
 * File Description: Core animated primitives for the video design system including TextReveal, StatCounter, CodeBlock, and Card components.
 * Inputs and outputs: primitive props (TextReveal, StatCounter, CodeBlock, Card) -> animated React UI elements.
 * Used by: src/dl/Block.tsx.
 */

import React from "react";
import {
  accentAt,
  useTokens,
  MONO,
  SERIF,
  useLayout,
} from "./tokens";
import { frames, MS, useEntrance, useMotionTiming, useProgress } from "./motion";
import { useAccent } from "./accent";
import { useAlign } from "./align";
import { compactNumber } from "./numberFormat";
import { parseHeadline } from "./headline";
import { spline } from "./plotSpline";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE - PRIMITIVES
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
 * One accent word, never two - §01 budgets three accents per *frame*, and the
 * headline is only ever entitled to one of them.
 */
export const TextReveal: React.FC<
  BlockProps & { text: string; size?: "display" | "headline" | "subhead"; accentWord?: string }
> = ({ text, size = "headline", accentWord, start, index }) => {
  const layout = useLayout();
  const palette = useTokens();
  const accent = useAccent();
  const align = useAlign();
  const { fps } = useMotionTiming();
  const base = start + frames(MS.stagger * index, fps);

  return (
    <div
      style={{
        ...layout.type(size),
        color: palette.ink,
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
  const palette = useTokens();
  const align = useAlign();
  const enter = useEntrance(start, index, layout.px(12));
  return (
    <div
      style={{
        ...enter,
        ...layout.type("body"),
        color: palette.muted,
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
  const palette = useTokens();
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
          color: palette.ink,
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

/**
 * A number counting up. Tabular figures are not optional: proportional digits
 * change width as they tick and the whole line jitters for the full 900ms.
 */
export const StatCounter: React.FC<
  BlockProps & { to: number; label: string; format: "plain" | "compact"; suffix?: string }
> = ({ to, label, format, suffix, start, index }) => {
  const layout = useLayout();
  const palette = useTokens();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const p = useProgress(start, 900, MS.stagger * index);
  const value = Math.round(to * p);
  const formattedValue =
    format === "compact"
      ? compactNumber(value)
      : (to >= 1900 && to <= 2100) || format === "plain"
      ? String(value)
      : value.toLocaleString("en-US");

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
        {formattedValue}
        {suffix ? (
          <span style={{ fontSize: "0.42em", color: palette.muted }}> {suffix}</span>
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
  const palette = useTokens();
  const draw = useProgress(start, MS.enter, MS.stagger * index);
  return (
    <div
      style={{
        height: 1,
        background: palette.rule(),
        transformOrigin: "left",
        transform: `scaleX(${draw})`,
        marginBlock: layout.grid,
      }}
    />
  );
};

export const IconLabel: React.FC<BlockProps & { text: string }> = ({ text, start, index }) => {
  const layout = useLayout();
  const palette = useTokens();
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
          border: `1px solid ${palette.rule(2)}`,
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
      <span style={{ fontFamily: MONO, fontSize: layout.type("caption").fontSize, color: palette.muted }}>
        {text}
      </span>
    </div>
  );
};

/** Monospace animated code block for terminal commands and code snippets */
export const CodeBlock: React.FC<
  BlockProps & { code: string; language?: string; caption?: string }
> = ({ code, language, caption, start, index }) => {
  const layout = useLayout();
  const tokens = useTokens();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));

  return (
    <div
      style={{
        ...enter,
        border: "1px solid rgba(245, 245, 245, 0.10)",
        borderRadius: layout.radius.inner + 4,
        background: tokens.surface,
        padding: `${layout.grid * 1.5}px ${layout.grid * 2}px`,
        display: "flex",
        flexDirection: "column",
        gap: layout.grid,
      }}
    >
      {(caption || language) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {caption && (
            <span style={{ fontFamily: MONO, fontSize: layout.type("caption").fontSize, color: tokens.muted }}>
              {caption}
            </span>
          )}
          {language && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: accent, textTransform: "uppercase" }}>
              {language}
            </span>
          )}
        </div>
      )}
      <pre
        style={{
          fontFamily: MONO,
          fontSize: layout.type("caption").fontSize,
          color: tokens.ink,
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
};

/** High-clarity card with theme-aware background, surface and accents */
export const Card: React.FC<
  BlockProps & { title: string; body?: string; tag?: string; state: "idle" | "active" }
> = ({ title, body, tag, state, start, index }) => {
  const layout = useLayout();
  const palette = useTokens();
  const accent = useAccent();
  const enter = useEntrance(start, index, layout.px(12));
  const active = state === "active";

  const defaultTag = active ? "⚡ ACTIVE SPEC" : "◈ SYSTEM SPEC";
  const displayTag = tag || defaultTag;

  return (
    <div
      style={{
        ...enter,
        border: `1.5px solid ${active ? accent : palette.rule(1.5)}`,
        borderRadius: layout.radius.inner + 4,
        background: active ? accentAt(accent, 0.12) : palette.surface,
        padding: `${layout.grid * 2}px ${layout.grid * 2.5}px`,
        display: "flex",
        flexDirection: "column",
        gap: layout.grid * 1.2,
        boxShadow: active
          ? `0 16px 36px rgba(0, 0, 0, 0.25), 0 0 24px ${accentAt(accent, 0.25)}`
          : "0 8px 24px rgba(0, 0, 0, 0.15)",
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
            color: active ? accent : palette.muted,
            background: active ? accentAt(accent, 0.16) : palette.sunken,
            padding: "2px 8px",
            borderRadius: 6,
            border: `1px solid ${active ? accentAt(accent, 0.3) : palette.rule()}`,
          }}
        >
          {displayTag}
        </span>
      </div>
      <span style={{ ...layout.type("body"), color: palette.ink, fontWeight: 600 }}>{title}</span>
      {body ? (
        <span style={{ ...layout.type("caption"), color: palette.muted, lineHeight: 1.45 }}>
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
  const palette = useTokens();
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
          background: palette.rule(),
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
                background: i / chapters < value ? accent : palette.rule(),
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
  const palette = useTokens();
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
        <g stroke={palette.rule(0.6)} strokeWidth={1}>
          {[0.25, 0.5, 0.75].map((f) => (
            <path key={f} d={`M${pad.l} ${pad.t + f * (H - pad.t - pad.b)} H${W - pad.r}`} />
          ))}
        </g>
        <path d={`M${pad.l} ${pad.t} V${H - pad.b} H${W - pad.r}`} stroke={palette.rule(2)} fill="none" />
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
          <text x={pad.l - 8} y={pad.t + 4} fontFamily={MONO} fontSize={11} fill={palette.faint} textAnchor="end">
            {yLabel}
          </text>
        ) : null}
        {xLabel ? (
          <text x={pad.l} y={H - 12} fontFamily={MONO} fontSize={11} fill={palette.faint}>
            {xLabel}
          </text>
        ) : null}
        {endLabel ? (
          <text
            x={W - pad.r}
            y={H - 12}
            fontFamily={MONO}
            fontSize={11}
            fill={palette.faint}
            textAnchor="end"
          >
            {endLabel}
          </text>
        ) : null}
      </svg>
    </div>
  );
};
