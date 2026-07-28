import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLOR, EASE, SANS, t, type Layout } from "../theme";
import type { Bullet, Chip } from "../script";

/**
 * pH chips. Each one carries its own swatch, so the colour is illustrating the
 * claim rather than encoding a category the reader has to decode from a legend.
 */
export const Chips: React.FC<{
  chips: Chip[];
  layout: Layout;
  start: number;
  exit: number;
}> = ({ chips, layout, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 14 * k,
        marginTop: 34 * k,
        opacity: out,
        justifyContent: layout.mode === "landscape" ? "flex-start" : "center",
      }}
    >
      {chips.map((chip, i) => {
        const delay = start + i * 9;
        const enter = interpolate(frame, [delay, delay + 26], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE.overshoot,
        });

        return (
          <div
            key={chip.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12 * k,
              padding: `${13 * k}px ${22 * k}px`,
              borderRadius: 999,
              background: COLOR.glass,
              border: `1px solid ${chip.color}44`,
              boxShadow: `0 0 ${28 * k}px ${chip.color}1f, inset 0 1px 0 rgba(255,255,255,0.06)`,
              opacity: Math.max(0, enter),
              scale: `${0.86 + Math.max(0, enter) * 0.14}`,
              translate: `0 ${(1 - Math.max(0, enter)) * 16 * k}px`,
            }}
          >
            <div
              style={{
                width: 13 * k,
                height: 13 * k,
                borderRadius: "50%",
                background: chip.color,
                boxShadow: `0 0 ${14 * k}px ${chip.color}`,
                flexShrink: 0,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 * k }}>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: t(layout, "body") * 0.94,
                  fontWeight: 700,
                  color: COLOR.inkHigh,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.15,
                }}
              >
                {chip.label}
              </span>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: t(layout, "kicker") * 0.92,
                  fontWeight: 500,
                  color: COLOR.inkLow,
                  letterSpacing: "0.04em",
                  whiteSpace: "nowrap",
                }}
              >
                {chip.sub}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * The benefits list. Numbered rather than emoji-led: the previous version used
 * 🛡️ ❄️ 🐛, and system emoji render differently in headless Chrome than they do
 * on the machine you previewed on — a classic way for a render to not match.
 */
export const Bullets: React.FC<{
  bullets: Bullet[];
  layout: Layout;
  start: number;
  exit: number;
}> = ({ bullets, layout, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 11 * k,
        marginTop: 32 * k,
        opacity: out,
        // The parent column centres its children on vertical formats, which left
        // every row a different width and staggered the leading numbers. Stretch
        // to the column and left-align so the numbers form a clean edge.
        alignSelf: "stretch",
        textAlign: "left",
      }}
    >
      {bullets.map((bullet, i) => {
        const delay = start + i * 11;
        const enter = interpolate(frame, [delay, delay + 26], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE.out,
        });

        return (
          <div
            key={bullet.title}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 16 * k,
              opacity: enter,
              translate: `${(1 - enter) * 30 * k}px 0`,
              paddingBottom: 11 * k,
              borderBottom: i < bullets.length - 1 ? `1px solid ${COLOR.hairline}` : "none",
            }}
          >
            <span
              style={{
                fontFamily: SANS,
                fontSize: t(layout, "kicker") * 0.95,
                fontWeight: 700,
                color: COLOR.purple,
                letterSpacing: "0.1em",
                minWidth: 26 * k,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 * k }}>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: t(layout, "h2") * 0.68,
                  fontWeight: 700,
                  color: COLOR.inkHigh,
                  letterSpacing: "-0.015em",
                  lineHeight: 1.2,
                }}
              >
                {bullet.title}
              </span>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: t(layout, "body") * 0.82,
                  fontWeight: 400,
                  color: COLOR.inkMid,
                  lineHeight: 1.45,
                }}
              >
                {bullet.sub}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
