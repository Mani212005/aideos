import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { accentOf, COLOR, EASE, SANS, t, type Accent, type Layout } from "../theme";
import { withAlpha } from "../palette";
import type { Formula as FormulaData } from "../schema";

/**
 * Monospace formula / code block.
 *
 * Uses a system monospace stack rather than a loaded webfont: the content is
 * equations and pseudocode where glyph *alignment* matters more than personality,
 * and every extra webfont is another thing that can silently fail to load inside
 * a render worker.
 */
const MONO =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

export const Formula: React.FC<{
  data: FormulaData;
  layout: Layout;
  accent: Accent;
  start: number;
  exit: number;
}> = ({ data, layout, accent, start, exit }) => {
  const frame = useCurrentFrame();
  const k = layout.scale;
  const tone = accentOf(accent);
  const highlight = new Set(data.highlight ?? []);

  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  const panel = interpolate(frame, [start, start + 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });

  return (
    <div
      style={{
        marginTop: 30 * k,
        alignSelf: "stretch",
        opacity: out * panel,
        translate: `0 ${(1 - panel) * 18 * k}px`,
        background: COLOR.glass,
        border: `1px solid ${COLOR.hairline}`,
        borderLeft: `2px solid ${tone.base}`,
        borderRadius: 12 * k,
        padding: `${22 * k}px ${26 * k}px`,
        textAlign: "left",
      }}
    >
      {data.lines.map((line, i) => {
        // Lines reveal in sequence so the eye follows the derivation.
        const delay = start + 12 + i * 8;
        const enter = interpolate(frame, [delay, delay + 20], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE.out,
        });
        const isHot = highlight.has(i);

        return (
          <div
            key={i}
            style={{
              fontFamily: MONO,
              fontSize: t(layout, "body") * 0.86,
              fontWeight: isHot ? 700 : 500,
              lineHeight: 1.75,
              letterSpacing: "-0.01em",
              color: isHot ? tone.base : COLOR.inkMid,
              opacity: enter,
              translate: `${(1 - enter) * 14 * k}px 0`,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              textShadow: isHot ? `0 0 ${22 * k}px ${withAlpha(tone.glow, 0.45)}` : undefined,
            }}
          >
            {line}
          </div>
        );
      })}

      {data.caption ? (
        <div
          style={{
            marginTop: 16 * k,
            paddingTop: 14 * k,
            borderTop: `1px solid ${COLOR.hairline}`,
            fontFamily: SANS,
            fontSize: t(layout, "body") * 0.78,
            fontWeight: 500,
            lineHeight: 1.5,
            color: COLOR.inkLow,
            opacity: interpolate(frame, [start + 30, start + 50], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE.out,
            }),
          }}
        >
          {data.caption}
        </div>
      ) : null}
    </div>
  );
};
