import React, { useMemo } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLOR, EASE, SANS, type Layout } from "../theme";

/**
 * Chlorophyll absorption spectrum.
 *
 * Form: two continuous series over a continuous domain -> line chart.
 *
 * Identity is carried by lightness + dash pattern + a direct label on each
 * curve, never by hue. That keeps the pair readable under any colour vision
 * deficiency and in grayscale, which matters more than usual here because the
 * frame also contains a full-spectrum gradient competing for attention.
 *
 * The rainbow along the x-axis is not a colour scale applied to data — the
 * encoded quantity *is* colour, so the wavelength axis wears its own hues. That
 * is the one case where a spectral ramp is the correct choice.
 *
 * The y-axis is intentionally unquantified: the claim is "two peaks, blue and
 * red, with a gap in the middle", not a specific absorbance figure.
 */

const NM_MIN = 400;
const NM_MAX = 700;

const gaussian = (x: number, mu: number, sigma: number, amp: number) =>
  amp * Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));

/** Chlorophyll a — Soret band near 430nm, Qy band near 662nm. */
const chlA = (nm: number) =>
  gaussian(nm, 430, 15, 1.0) + gaussian(nm, 662, 11, 0.82) + gaussian(nm, 617, 19, 0.14);

/** Chlorophyll b — both bands shifted inward relative to chlorophyll a. */
const chlB = (nm: number) => gaussian(nm, 453, 17, 0.9) + gaussian(nm, 642, 13, 0.56);

/** Approximate sRGB rendering of each wavelength, for the axis ramp. */
const SPECTRAL_STOPS: [number, string][] = [
  [400, "#6A00F4"],
  [440, "#0040FF"],
  [470, "#00A8FF"],
  [490, "#00E0D0"],
  [510, "#35E000"],
  [550, "#ADFF2F"],
  [580, "#FFE800"],
  [600, "#FF9500"],
  [650, "#FF2D00"],
  [700, "#A60000"],
];

// The band chlorophyll barely touches — this is the payload of the whole chart.
const REFLECT_LO = 495;
const REFLECT_HI = 570;

export const Spectrum: React.FC<{
  layout: Layout;
  width: number;
  height: number;
  /** Frame, relative to the scene, at which the chart starts drawing. */
  start: number;
  exit: number;
}> = ({ layout, width, height, start, exit }) => {
  const frame = useCurrentFrame();
  // Vertical formats give the plot far less width, so its labels need to be
  // relatively larger to stay readable on a phone.
  const k = layout.scale * (layout.mode === "landscape" ? 1 : 1.3);

  const pad = {
    top: 26 * k,
    right: 30 * k,
    bottom: 54 * k,
    left: 58 * k,
  };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xOf = (nm: number) => pad.left + ((nm - NM_MIN) / (NM_MAX - NM_MIN)) * plotW;
  const yOf = (v: number) => pad.top + plotH - (v / 1.05) * plotH;

  const { pathA, pathB } = useMemo(() => {
    const build = (fn: (nm: number) => number) => {
      let d = "";
      for (let nm = NM_MIN; nm <= NM_MAX; nm += 2) {
        d += `${d === "" ? "M" : "L"}${xOf(nm).toFixed(2)},${yOf(fn(nm)).toFixed(2)}`;
      }
      return d;
    };
    return { pathA: build(chlA), pathB: build(chlB) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, k]);

  // Wipe the plot in left to right, so the curves read as being traced.
  const draw = interpolate(frame, [start, start + 46], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.inOut,
  });
  const labels = interpolate(frame, [start + 34, start + 56], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });
  // The reflected-band callout lands last — it is the conclusion.
  const callout = interpolate(frame, [start + 56, start + 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });
  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  const clipId = "spectrum-clip";
  const tick = (nm: number) => (
    <g key={nm} opacity={labels}>
      <line
        x1={xOf(nm)}
        y1={pad.top + plotH}
        x2={xOf(nm)}
        y2={pad.top + plotH + 7 * k}
        stroke={COLOR.inkLow}
        strokeWidth={1}
      />
      <text
        x={xOf(nm)}
        y={pad.top + plotH + 26 * k}
        fill={COLOR.inkLow}
        fontFamily={SANS}
        fontSize={13 * k}
        fontWeight={500}
        textAnchor="middle"
      >
        {nm}
      </text>
    </g>
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ opacity: out, overflow: "visible" }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={pad.left} y={0} width={plotW * draw} height={height} />
        </clipPath>
        <linearGradient id="spectral-ramp" x1="0" y1="0" x2="1" y2="0">
          {SPECTRAL_STOPS.map(([nm, color]) => (
            <stop
              key={nm}
              offset={`${((nm - NM_MIN) / (NM_MAX - NM_MIN)) * 100}%`}
              stopColor={color}
            />
          ))}
        </linearGradient>
        {/* Fades upward. A gradient that is strongest at the top gives the band a
            hard horizontal edge, which reads as a UI panel rather than a
            highlight over the plot. */}
        <linearGradient id="reflect-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLOR.green} stopOpacity={0} />
          <stop offset="55%" stopColor={COLOR.green} stopOpacity={0.08} />
          <stop offset="100%" stopColor={COLOR.green} stopOpacity={0.26} />
        </linearGradient>
      </defs>

      {/* Baseline only. No y-grid: the shape is the message, not the values. */}
      <line
        x1={pad.left}
        y1={pad.top + plotH}
        x2={pad.left + plotW}
        y2={pad.top + plotH}
        stroke={COLOR.hairline}
        strokeWidth={1}
      />

      {/* The reflected band, highlighted behind the curves. */}
      <g clipPath={`url(#${clipId})`}>
        <rect
          x={xOf(REFLECT_LO)}
          y={pad.top}
          width={xOf(REFLECT_HI) - xOf(REFLECT_LO)}
          height={plotH}
          fill="url(#reflect-fill)"
          opacity={callout}
        />
        {/* Guides start below the plot top so the band does not close into a box. */}
        {[REFLECT_LO, REFLECT_HI].map((nm) => (
          <line
            key={nm}
            x1={xOf(nm)}
            y1={pad.top + plotH * 0.24}
            x2={xOf(nm)}
            y2={pad.top + plotH}
            stroke={COLOR.green}
            strokeWidth={1}
            strokeDasharray={`${3 * k} ${4 * k}`}
            opacity={callout * 0.55}
          />
        ))}
      </g>

      {/* Curves. Chlorophyll b is both dimmer and dashed. */}
      <g clipPath={`url(#${clipId})`} fill="none" strokeLinecap="round">
        <path
          d={pathB}
          stroke={COLOR.inkMid}
          strokeWidth={2.5 * k}
          strokeDasharray={`${9 * k} ${6 * k}`}
        />
        <path d={pathA} stroke={COLOR.inkHigh} strokeWidth={3 * k} />
      </g>

      {/* Direct labels — identity never rests on colour alone. */}
      <g opacity={labels} fontFamily={SANS} fontWeight={700}>
        <text
          x={xOf(430) + 12 * k}
          y={yOf(chlA(430)) - 12 * k}
          fill={COLOR.inkHigh}
          fontSize={16 * k}
        >
          Chlorophyll a
        </text>
        <text
          x={xOf(468) + 16 * k}
          y={yOf(chlB(453)) + 16 * k}
          fill={COLOR.inkMid}
          fontSize={16 * k}
          fontWeight={600}
        >
          Chlorophyll b
        </text>
      </g>

      {/* The spectral ramp doubles as the axis and as its own colour legend. */}
      <rect
        x={pad.left}
        y={pad.top + plotH + 9 * k}
        width={plotW * draw}
        height={6 * k}
        rx={3 * k}
        fill="url(#spectral-ramp)"
        opacity={0.9}
      />

      {[400, 500, 600, 700].map(tick)}

      {/* Axis titles. */}
      <text
        x={pad.left + plotW}
        y={pad.top + plotH + 44 * k}
        fill={COLOR.inkLow}
        fontFamily={SANS}
        fontSize={12 * k}
        fontWeight={600}
        letterSpacing="0.14em"
        textAnchor="end"
        opacity={labels}
      >
        WAVELENGTH (NM)
      </text>
      <text
        x={pad.left - 16 * k}
        y={pad.top + plotH / 2}
        fill={COLOR.inkLow}
        fontFamily={SANS}
        fontSize={12 * k}
        fontWeight={600}
        letterSpacing="0.14em"
        textAnchor="middle"
        opacity={labels}
        transform={`rotate(-90 ${pad.left - 16 * k} ${pad.top + plotH / 2})`}
      >
        ABSORPTION
      </text>

      {/* The conclusion, sitting in the gap it describes. */}
      <g opacity={callout}>
        <text
          x={(xOf(REFLECT_LO) + xOf(REFLECT_HI)) / 2}
          y={pad.top + plotH * 0.42}
          fill={COLOR.green}
          fontFamily={SANS}
          fontSize={17 * k}
          fontWeight={800}
          textAnchor="middle"
        >
          barely absorbed
        </text>
        <text
          x={(xOf(REFLECT_LO) + xOf(REFLECT_HI)) / 2}
          y={pad.top + plotH * 0.42 + 24 * k}
          fill={COLOR.inkMid}
          fontFamily={SANS}
          fontSize={14 * k}
          fontWeight={500}
          textAnchor="middle"
        >
          reflected back at you
        </text>
      </g>
    </svg>
  );
};
