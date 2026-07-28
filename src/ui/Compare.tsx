import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { accentOf, COLOR, EASE, oppositeAccentOf, SANS, t, type Accent, type Layout } from "../theme";
import { withAlpha } from "../palette";
import type { Compare as CompareData } from "../schema";

/**
 * Two-column comparison.
 *
 * The columns are tinted with opposing accents so "these are two different
 * things" is carried by position *and* colour *and* the divider — a viewer who
 * looks away for a second can re-orient without re-reading the headings.
 *
 * Stacks vertically on portrait/square: two 90-character columns side by side in
 * a 1080-wide frame would be unreadable on a phone.
 */
export const Compare: React.FC<{
  data: CompareData;
  layout: Layout;
  accent: Accent;
  start: number;
  exit: number;
}> = ({ data, layout, accent, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;
  const stacked = layout.mode !== "landscape";

  const leftTone = accentOf(accent === "neutral" ? "primary" : accent);
  const rightTone = oppositeAccentOf(accent === "neutral" ? "primary" : accent);

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  const column = (
    side: CompareData["left"],
    tone: { base: string; glow: string },
    offset: number,
  ) => {
    const enter = interpolate(frame, [start + offset, start + offset + 24], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE.out,
    });

    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          opacity: enter,
          // Columns arrive from opposite sides, which reinforces the split.
          translate: `${(1 - enter) * (offset === 0 ? -24 : 24) * k}px 0`,
          background: COLOR.glass,
          border: `1px solid ${withAlpha(tone.base, 0.22)}`,
          borderTop: `2px solid ${tone.base}`,
          borderRadius: 12 * k,
          padding: `${20 * k}px ${22 * k}px`,
          textAlign: "left",
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontSize: t(layout, "body") * 0.98,
            fontWeight: 800,
            letterSpacing: "-0.015em",
            color: tone.base,
            marginBottom: 14 * k,
            textShadow: `0 0 ${24 * k}px ${withAlpha(tone.glow, 0.4)}`,
          }}
        >
          {side.title}
        </div>

        {side.points.map((point, i) => {
          const delay = start + offset + 14 + i * 9;
          const pEnter = interpolate(frame, [delay, delay + 20], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE.out,
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10 * k,
                alignItems: "baseline",
                marginBottom: 9 * k,
                opacity: pEnter,
                translate: `0 ${(1 - pEnter) * 10 * k}px`,
              }}
            >
              <span
                style={{
                  width: 5 * k,
                  height: 5 * k,
                  borderRadius: "50%",
                  background: tone.base,
                  flexShrink: 0,
                  transform: `translateY(${-3 * k}px)`,
                }}
              />
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: t(layout, "body") * 0.8,
                  fontWeight: 400,
                  lineHeight: 1.5,
                  color: COLOR.inkMid,
                }}
              >
                {point}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        gap: 14 * k,
        marginTop: 30 * k,
        alignSelf: "stretch",
        opacity: out,
      }}
    >
      {column(data.left, leftTone, 0)}
      {column(data.right, rightTone, 10)}
    </div>
  );
};
