import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Audio } from "remotion";
import { accentAt, ink, PALETTE, rule, useLayout } from "./tokens";
import { DRIFT, easeExpo, frames, MS } from "./motion";
import { AccentContext } from "./accent";
import { BlockView } from "./Block";
import { CanvasGraph } from "./CanvasGraph";
import { TextBeat } from "./devices";
import {
  camAt,
  lookBox,
  projectBox,
  shotAt,
  totalFrames,
  type TimedShot,
} from "./camera";
import type { Film } from "./schema";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE — THE FILM
 * ---------------------------------------------------------------------------
 * Assembles §05–§08: the camera moves across one canvas, and where it stops it
 * either sits on the structure (the spine) or grows a device out of the node it
 * is looking at.
 *
 * The join is the whole trick. A device does not cut in — the node's border
 * grows into the device frame, and on the way out it shrinks back into exactly
 * the same node. That reversibility is what tells the viewer where they are:
 * a device is never somewhere else, it is *inside* something they have already
 * seen on the map.
 */

/** How long the panel takes to shrink back into its node. Exit beats entrance. */
const CLOSE_MS = 420;

const Stage: React.FC<{ film: Film; timeline: TimedShot[] }> = ({ film, timeline }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const layout = useLayout();
  const current = shotAt(timeline, frame);
  const shot = current.shot;

  if (shot.stage === "none") return null;

  const openFrames = frames(MS.move, fps);
  const closeFrames = frames(CLOSE_MS, fps);

  const open = easeExpo((frame - current.from) / openFrames);
  const close = easeExpo((frame - (current.to - closeFrames)) / closeFrames);

  const target = {
    x: layout.margin.left,
    y: layout.margin.top,
    w: width - layout.margin.left - layout.margin.right,
    h: height - layout.margin.top - layout.margin.bottom,
  };

  let rect = target;
  const opacity =
    Math.max(0, Math.min(1, open * 1.4)) * (1 - Math.max(0, Math.min(1, close)));

  if (shot.stage === "anchor") {
    // The node this panel grew out of, in screen pixels under the shot's camera.
    const cam = camAt(film, timeline, current.to - 1, { width, height });
    const seed = projectBox(lookBox(film, shot), cam, { width, height });
    const grow = Math.max(0, Math.min(1, open)) * (1 - Math.max(0, Math.min(1, close)));
    const mix = (a: number, b: number) => a + (b - a) * grow;
    rect = {
      x: mix(seed.x, target.x),
      y: mix(seed.y, target.y),
      w: mix(seed.w, target.w),
      h: mix(seed.h, target.h),
    };
  }

  // Content fades in behind the frame rather than with it — a panel that
  // arrives already full of text reads as a cut, which is the one move this
  // system never makes.
  const contentIn = interpolate(
    frame,
    [current.from + openFrames * 0.55, current.from + openFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const contentStart = current.from + Math.round(openFrames * 0.55);

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        border: `1px solid ${rule(shot.stage === "frame" ? 0 : 1)}`,
        borderRadius: layout.radius.card,
        background:
          shot.stage === "frame" ? "transparent" : `rgba(10, 10, 11, ${0.86 * opacity})`,
        opacity,
        overflow: "hidden",
        display: "flex",
      }}
    >
      <div
        style={{
          flex: 1,
          padding: shot.stage === "frame" ? 0 : layout.grid * 5,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: layout.grid * 2.5,
          opacity: contentIn,
          minWidth: 0,
        }}
      >
        {shot.stage === "frame" ? (
          <TextBeat>
            {shot.blocks.map((block, i) => (
              <BlockView
                key={`${current.index}-${i}`}
                block={block}
                start={contentStart}
                index={i}
                durationInFrames={current.durationInFrames}
              />
            ))}
          </TextBeat>
        ) : (
          shot.blocks.map((block, i) => (
            <BlockView
              key={`${current.index}-${i}`}
              block={block}
              start={contentStart}
              index={i}
              durationInFrames={current.durationInFrames}
            />
          ))
        )}
      </div>
    </div>
  );
};

/** The 8px grid, as a render-time overlay. Off by default; a proofing aid. */
const Grid: React.FC = () => {
  const layout = useLayout();
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: 0.5,
        backgroundImage: `linear-gradient(to right, ${accentAt(PALETTE.accent, 0.1)} 1px, transparent 1px), linear-gradient(to bottom, ${accentAt(PALETTE.accent, 0.1)} 1px, transparent 1px)`,
        backgroundSize: `${layout.grid}px ${layout.grid}px`,
      }}
    />
  );
};

/**
 * Chapter rail. This is the answer to §08's one test — scrub with the sound off
 * and every frame has to tell you where you are in the argument.
 */
const Rail: React.FC<{ film: Film; timeline: TimedShot[] }> = ({ film, timeline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const current = shotAt(timeline, frame);
  const total = totalFrames(timeline);
  const progress = frame / total;

  const seconds = Math.floor(frame / fps);
  const stamp = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const chapterIndex = Math.min(current.chapter, film.chapters.length - 1);

  return (
    <div
      style={{
        position: "absolute",
        left: layout.margin.left,
        right: layout.margin.right,
        bottom: layout.format === "reel" ? layout.margin.bottom * 0.55 : layout.margin.bottom * 0.5,
        display: "flex",
        flexDirection: "column",
        gap: layout.grid * 1.5,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", ...layout.label() }}>
        <span>{`chapter ${String(chapterIndex + 1).padStart(2, "0")} — ${film.chapters[chapterIndex]}`}</span>
        <span>{stamp}</span>
      </div>
      {/* Segmented for long-form, continuous for reels: a reel is too short for
          chapters to mean anything, and the segments only add clutter. */}
      {layout.format === "long" ? (
        <div style={{ display: "flex", gap: layout.grid }}>
          {film.chapters.map((name, i) => (
            <span
              key={name}
              style={{
                flex: 1,
                height: layout.px(2),
                background: i <= chapterIndex ? "currentColor" : rule(),
                color: i <= chapterIndex ? undefined : "transparent",
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{ height: layout.px(3), background: rule(), borderRadius: layout.px(2) }}>
          <div
            style={{
              height: "100%",
              width: `${progress * 100}%`,
              background: "currentColor",
              borderRadius: layout.px(2),
            }}
          />
        </div>
      )}
    </div>
  );
};

export type FilmViewProps = {
  film: Film;
  timeline: TimedShot[];
  accent: string;
  showGrid: boolean;
  showRail: boolean;
};

export const FilmView: React.FC<FilmViewProps> = ({
  film,
  timeline,
  accent,
  showGrid,
  showRail,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const current = shotAt(timeline, frame);
  const cam = camAt(film, timeline, frame, { width, height });

  // The whole composition drifts 100 → 104% across a held shot; the diagram
  // inside never moves once drawn. It is the difference between a still frame
  // and a held one.
  const drift = current.shot.drift
    ? 1 + (DRIFT - 1) * ((frame - current.from) / Math.max(1, current.durationInFrames))
    : 1;

  // The canvas dims under a panel rather than disappearing. Rule 02 again:
  // nothing is destroyed, so you can always see the structure you are inside.
  const panelOpen =
    current.shot.stage === "none"
      ? 0
      : Math.max(0, Math.min(1, easeExpo((frame - current.from) / frames(MS.move, fps))));
  const canvasOpacity =
    current.shot.stage === "frame" ? 1 - 0.94 * panelOpen : 1 - 0.72 * panelOpen;

  return (
    <AccentContext.Provider value={accent}>
      <AbsoluteFill style={{ background: PALETTE.canvas, color: accent }}>
        {film.voiceover?.src && (
          <Audio src={film.voiceover.src} volume={() => film.voiceover!.volume}>
            {film.captions && (
              <track
                default
                kind="captions"
                src={film.captions}
                srcLang="en"
                label="English"
              />
            )}
          </Audio>
        )}
        <AbsoluteFill style={{ transform: `scale(${drift})` }}>
          <AbsoluteFill style={{ opacity: canvasOpacity }}>
            <CanvasGraph film={film} timeline={timeline} cam={cam} />
          </AbsoluteFill>
          {showGrid ? <Grid /> : null}
          <Stage film={film} timeline={timeline} />
        </AbsoluteFill>
        {showRail ? <Rail film={film} timeline={timeline} /> : null}
        {/* A single hairline vignette at the very edge, to stop the canvas
            bleeding into a phone's rounded corners. No shadows anywhere. */}
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            boxShadow: `inset 0 0 0 1px ${ink(0.04)}`,
          }}
        />
      </AbsoluteFill>
    </AccentContext.Provider>
  );
};
