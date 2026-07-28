import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { SubjectScene } from "./three/SubjectScene";
import { AccentGlow, Bokeh, Grain, ProgressRail, Vignette } from "./ui/Atmosphere";
import { Backdrop } from "./ui/Backdrops";
import { Body, Kicker, Words } from "./ui/Type";
import { Bullets, Chips } from "./ui/Blocks";
import { Spectrum } from "./ui/Spectrum";
import { Formula } from "./ui/Formula";
import { Compare } from "./ui/Compare";
import { Layers, Mismatch, Predict, Rescan, Tokenize } from "./ui/Illustrations";
import { COLOR, EASE, SANS, t, useLayout, type Layout } from "./theme";
import {
  EPISODE,
  isWideVisual,
  SCRIPT,
  sceneAt,
  sceneFrames,
  sceneStart,
  TOTAL_FRAMES,
  type Scene,
} from "./script";

/**
 * How long before the end of a scene its content starts leaving. Exits are
 * shorter than entrances — content should clear the frame faster than it arrives.
 */
const EXIT_LEAD = 20;

/** Where a scene's copy column sits, given the layout and the scene's visual. */
const placementFor = (scene: Scene, layout: Layout): React.CSSProperties => {
  const isCentred = layout.mode !== "landscape";
  const endcard = scene.visual === "endcard";
  const hasChart = scene.visual === "spectrum";
  // Modules that need more than the standard 42% copy column: a two-column
  // comparison or an 80-character monospace line will not fit in it.
  const wide = isWideVisual(scene.visual);

  if (endcard) {
    // The leaf takes the upper third on the closing shot, so the copy sits below
    // it rather than across it.
    return {
      left: "50%",
      top: "70%",
      translate: "-50% -50%",
      width: layout.mode === "landscape" ? layout.width * 0.66 : layout.columnWidth,
      textAlign: "center",
      alignItems: "center",
    };
  }

  if (layout.mode === "landscape") {
    return {
      left: layout.safe,
      // A chart scene pushes its copy up to make room underneath.
      top: hasChart ? layout.height * 0.16 : "50%",
      translate: hasChart ? "0 0" : "0 -50%",
      width: hasChart
        ? layout.width * 0.52
        : wide
          ? layout.width * 0.54
          : layout.columnWidth,
      textAlign: "left",
      alignItems: "flex-start",
    };
  }

  return {
    left: "50%",
    top: hasChart ? layout.height * 0.5 : `${layout.textAnchor.y * 100}%`,
    translate: hasChart ? "-50% 0" : "-50% -50%",
    width: layout.columnWidth,
    textAlign: isCentred ? "center" : "left",
    alignItems: "center",
  };
};

/** Geometry of the chart panel for the spectrum scene. */
const chartRectFor = (layout: Layout) => {
  if (layout.mode === "landscape") {
    const width = Math.min(layout.width * 0.58, 1150 * layout.scale);
    return {
      left: layout.safe,
      top: layout.height * 0.52,
      width,
      height: layout.height * 0.34,
    };
  }
  const width = layout.columnWidth;
  return {
    left: (layout.width - width) / 2,
    top: layout.height * 0.66,
    width,
    height: layout.height * 0.25,
  };
};

/** Preserves whatever centring translate the placement asked for. */
const translateBase = (placement: React.CSSProperties): string =>
  typeof placement.translate === "string" ? placement.translate : "0 0";

const SceneBlock: React.FC<{ scene: Scene; layout: Layout }> = ({ scene, layout }) => {
  const frameLocal = useCurrentFrame();
  const total = sceneFrames(scene);
  const exit = total - EXIT_LEAD;
  const align = layout.mode === "landscape" && scene.visual !== "endcard" ? "left" : "center";

  const headlineSize =
    scene.visual === "endcard"
      ? t(layout, "display") * 0.82
      : scene.id === "question"
        // Instrument Serif has a small cap height for its em, so a serif display
        // line needs a much larger size than a sans one to read as equally big.
        ? t(layout, "display") * 2.6
        : t(layout, "h1");

  const placement = placementFor(scene, layout);
  const chart = chartRectFor(layout);

  // Continuity. Rather than each scene appearing and disappearing in place, the
  // whole column travels: it arrives from the right, drifts steadily left while
  // it is read, and continues left on the way out. Consecutive scenes therefore
  // hand off in one direction, which reads as moving through the material rather
  // than as a stack of slides being swapped.
  const travelIn = interpolate(frameLocal, [0, 26], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });
  const travelOut = interpolate(frameLocal, [exit, total], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });
  const drift = interpolate(frameLocal, [0, total], [0, -18 * layout.scale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const travelX =
    travelIn * 56 * layout.scale + drift - travelOut * 64 * layout.scale;

  return (
    <>
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          ...placement,
          translate: `${translateBase(placement)} `.trim(),
          transform: `translateX(${travelX}px)`,
        }}
      >
        {scene.kicker ? (
          <Kicker
            text={scene.kicker}
            layout={layout}
            accent={scene.accent}
            start={4}
            exit={exit}
          />
        ) : null}

        <Words
          text={scene.headline}
          layout={layout}
          accent={scene.accent}
          start={scene.kicker ? 12 : 6}
          exit={exit}
          size={headlineSize}
          weight={scene.visual === "endcard" ? 800 : 800}
          lineHeight={scene.id === "question" ? 1 : 1.14}
          align={align}
        />

        {scene.body ? (
          <Body
            text={scene.body}
            layout={layout}
            start={(scene.kicker ? 12 : 6) + 22}
            exit={exit}
            align={align}
          />
        ) : null}

        {scene.chips ? (
          <Chips chips={scene.chips} layout={layout} start={54} exit={exit} />
        ) : null}

        {scene.bullets ? (
          <Bullets bullets={scene.bullets} layout={layout} start={34} exit={exit} />
        ) : null}

        {scene.formula ? (
          <Formula
            data={scene.formula}
            layout={layout}
            accent={scene.accent}
            start={30}
            exit={exit}
          />
        ) : null}

        {scene.compare ? (
          <Compare
            data={scene.compare}
            layout={layout}
            accent={scene.accent}
            start={34}
            exit={exit}
          />
        ) : null}

        {scene.rescan ? (
          <Rescan
            data={scene.rescan}
            layout={layout}
            accent={scene.accent}
            start={26}
            exit={exit}
          />
        ) : null}

        {scene.predict ? (
          <Predict
            data={scene.predict}
            layout={layout}
            accent={scene.accent}
            start={26}
            exit={exit}
          />
        ) : null}

        {scene.layers ? (
          <Layers
            data={scene.layers}
            layout={layout}
            accent={scene.accent}
            start={26}
            exit={exit}
          />
        ) : null}

        {scene.mismatch ? (
          <Mismatch
            data={scene.mismatch}
            layout={layout}
            accent={scene.accent}
            start={26}
            exit={exit}
          />
        ) : null}

        {scene.tokenize ? (
          <Tokenize
            data={scene.tokenize}
            layout={layout}
            accent={scene.accent}
            start={26}
            exit={exit}
          />
        ) : null}

        {scene.visual === "endcard" ? <EndCardRule layout={layout} exit={exit} /> : null}
      </div>

      {scene.visual === "spectrum" ? (
        <div style={{ position: "absolute", ...chart }}>
          <Spectrum
            layout={layout}
            width={chart.width}
            height={chart.height}
            start={40}
            exit={exit}
          />
        </div>
      ) : null}
    </>
  );
};

/** A hairline that draws outward from centre under the closing line. */
const EndCardRule: React.FC<{ layout: Layout; exit: number }> = ({ layout, exit }) => {
  const frame = useCurrentFrame();
  // Comes from the episode. This was hardcoded to "Chlorophyll · Anthocyanin",
  // which then shipped on the final frame of an episode about KV caches.
  const tag = EPISODE.endTag;
  const draw = interpolate(frame, [30, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const out = interpolate(frame, [exit, exit + 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        marginTop: 40 * layout.scale,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20 * layout.scale,
        opacity: out,
      }}
    >
      <div
        style={{
          width: 200 * layout.scale * draw,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${COLOR.inkLow}, transparent)`,
        }}
      />
      {tag ? (
        <span
          style={{
            fontFamily: SANS,
            fontSize: t(layout, "kicker"),
            fontWeight: 600,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: COLOR.inkLow,
            opacity: draw,
          }}
        >
          {tag}
        </span>
      ) : null}
    </div>
  );
};

/**
 * A brief exposure lift on every cut. Real cameras adjust when the scene
 * changes; a hard cut with no luminance event is one of the things that makes
 * generated video feel flat.
 */
const CutFlash: React.FC = () => {
  const frame = useCurrentFrame();

  // Distance to the nearest scene boundary, ignoring the very first frame.
  let nearest = Infinity;
  for (const scene of SCRIPT) {
    const start = sceneStart(scene);
    if (start === 0) continue;
    nearest = Math.min(nearest, Math.abs(frame - start));
  }

  const strength = interpolate(nearest, [0, 7], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (strength <= 0) return null;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: "rgba(226, 240, 234, 1)",
        opacity: strength * 0.045,
        mixBlendMode: "screen",
      }}
    />
  );
};

export const EpisodeStory: React.FC<{
  showProgressRail?: boolean;
  grain?: number;
}> = ({ showProgressRail = true, grain = 0.055 }) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const { scene, index } = sceneAt(frame);

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: COLOR.bgDeep }}>
      <Backdrop />
      <AccentGlow x={layout.subjectOffset.x} y={layout.subjectOffset.y} />

      {/* The 3D leaf, running continuously beneath the copy. */}
      <SubjectScene />

      {/* Particles in front of the leaf, for depth. */}
      <Bokeh />

      {/* One Sequence per scene: each scene's children see a local frame of 0. */}
      {SCRIPT.map((s) => (
        <Sequence
          key={s.id}
          name={s.id}
          from={sceneStart(s)}
          durationInFrames={sceneFrames(s)}
          layout="none"
        >
          <SceneBlock scene={s} layout={layout} />
        </Sequence>
      ))}

      <Vignette />
      <CutFlash />
      <Grain opacity={grain} />
      {showProgressRail ? (
        <ProgressRail accent={scene.accent} chapter={index} chapters={SCRIPT.length} />
      ) : null}
    </AbsoluteFill>
  );
};

export { TOTAL_FRAMES };
