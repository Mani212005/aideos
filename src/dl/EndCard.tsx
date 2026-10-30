/**
 * File Description: The optional like-and-subscribe end card drawn over the held final stage of a
 * video: the stage dims gently, then a centred card (mono label, Geist headline, an outline LIKE chip,
 * an accent SUBSCRIBE pill with a bell, the channel handle) enters on the ease-out-expo curve, and the
 * SUBSCRIBE pill presses on the spoken word "subscribe". Copy comes from aideos.config.json.
 * Inputs and outputs: the card span and its spoken words from src/dl/delivery.ts, the current frame -> card overlay and the spoken line's audio.
 * Used by: src/dl/Film.tsx (FilmView end card overlay), src/dl/Soundtrack.tsx (the line's audio in render and studio preview).
 */

import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useAccent } from "./accent";
import { DELIVERY_CONFIG, type CardWord, type EndCardConfig, type EndCardSpan } from "./delivery";
import { getEndCardLayout, readableInkOn, type CardRect } from "./endCardLayout";
import { easeExpo, frames, useEntrance } from "./motion";
import type { Film } from "./schema";
import { accentAt, MONO, SANS, useLayout, useTokens } from "./tokens";

/** How dark the held stage ends up under the card: 0.55 of the canvas over it leaves it at about 45%. */
const DIM_ALPHA = 0.55;
/** The dim settles over this long, on the same curve as everything else. */
const DIM_MS = 600;
/** The card's first part enters this long after the card starts, once the dim is under way. */
const ENTER_DELAY_MS = 150;
/** One press of the SUBSCRIBE pill: down fast, back on the curve. */
const PRESS_MS = 360;
/** How far the pill sinks at the bottom of its press. */
const PRESS_DEPTH = 0.06;
/** With no spoken line the pill presses this long into the card, after the parts have arrived. */
const SILENT_PRESS_MS = 1400;

export type EndCardProps = {
  card: EndCardSpan;
  /** The spoken line's words in absolute frames; the pill presses on the subscribe word. */
  cardWords: CardWord[];
  /** Rectangles the card must keep clear of; defaults to the last shot's bottom caption card. */
  avoid?: CardRect[];
  copy?: EndCardConfig;
};

// Lowercases a word and strips punctuation, so "subscribe." matches the configured SUBSCRIBE.
const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// The frame the SUBSCRIBE pill presses: its spoken word when the line says it, else a fixed beat.
export function subscribePressFrame(card: EndCardSpan, cardWords: CardWord[], subscribe: string, fps: number): number {
  const spoken = cardWords.find((w) => bare(w.text) === bare(subscribe));
  return spoken ? spoken.startFrame : card.from + Math.round(frames(SILENT_PRESS_MS, fps));
}

// Depth 0..1 of the press at a frame: a quick dip then a release on the expo curve.
export function pressDepth(frame: number, pressFrame: number, fps: number): number {
  const t = (frame - pressFrame) / frames(PRESS_MS, fps);
  if (t < 0 || t > 1) return 0;
  return t < 0.25 ? easeExpo(t / 0.25) : 1 - easeExpo((t - 0.25) / 0.75);
}

/** Outline thumbs-up, drawn on a 24 unit grid in the current colour. */
const ThumbsUp: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 10v11" />
    <path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7.9A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z" />
  </svg>
);

/** Bell, drawn on a 24 unit grid in the current colour. */
const Bell: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10.3 21a2 2 0 0 0 3.4 0" />
    <path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3" />
  </svg>
);

// Draws the dim and the card for the frames of the card span; nothing before it.
export const EndCard: React.FC<EndCardProps> = ({ card, cardWords, avoid, copy = DELIVERY_CONFIG.endCard }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const layout = useLayout();
  const palette = useTokens();
  const accent = useAccent();

  const start = card.from + frames(ENTER_DELAY_MS, fps);
  // Entrances are hooks, so they run on every frame; the card simply is not drawn before its span.
  const panelIn = useEntrance(start, 0);
  const labelIn = useEntrance(start, 1);
  const headlineIn = useEntrance(start, 2);
  const chipsIn = useEntrance(start, 3);
  const handleIn = useEntrance(start, 4);
  if (frame < card.from) return null;

  const geo = getEndCardLayout({ format: layout.format, width, height, avoid, hasHandle: copy.handle.trim().length > 0, headline: copy.headline });
  const dim = DIM_ALPHA * easeExpo((frame - card.from) / frames(DIM_MS, fps));
  const press = pressDepth(frame, subscribePressFrame(card, cardWords, copy.subscribe, fps), fps);
  const pillInk = readableInkOn(accent, [palette.canvas, palette.ink]);
  const chipText: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: geo.type.chip,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    lineHeight: 1,
  };
  const chip: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: geo.chip.icon * 0.36,
    height: geo.chip.height,
    padding: `0 ${geo.chip.padX}px`,
    borderRadius: geo.chip.height / 2,
    boxSizing: "border-box",
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: accentAt(palette.canvas, dim) }} />
      {/* The layout's rect is the most the card may cover; the card itself hugs its content
          inside it, centred, so it never reaches what the rect was placed to avoid. */}
      <div
        style={{
          position: "absolute",
          left: geo.card.x,
          top: geo.card.y,
          width: geo.card.w,
          height: geo.card.h,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
      <div
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          boxSizing: "border-box",
          padding: `${geo.padY}px ${geo.padX}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: palette.surface,
          border: `1px solid ${palette.hairline}`,
          borderRadius: geo.radius,
          boxShadow: `0 ${layout.px(16)}px ${layout.px(40)}px ${accentAt(palette.canvas, 0.45)}`,
          ...panelIn,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: geo.type.label,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            lineHeight: 1.4,
            color: palette.muted,
            whiteSpace: "nowrap",
            ...labelIn,
          }}
        >
          {copy.label}
        </div>
        <div
          style={{
            marginTop: geo.gap,
            fontFamily: SANS,
            fontWeight: 500,
            fontSize: geo.type.headline,
            letterSpacing: "-0.025em",
            lineHeight: 1.06,
            color: palette.ink,
            whiteSpace: "nowrap",
            ...headlineIn,
          }}
        >
          {copy.headline}
        </div>
        <div style={{ marginTop: geo.gap * 1.4, display: "flex", gap: geo.chip.gap, ...chipsIn }}>
          <div style={{ ...chip, border: `2px solid ${palette.inkAt(0.35)}`, color: palette.ink }}>
            <ThumbsUp size={geo.chip.icon} />
            <span style={chipText}>{copy.like}</span>
          </div>
          <div
            style={{
              ...chip,
              background: accent,
              color: pillInk,
              transform: `scale(${1 - PRESS_DEPTH * press})`,
              boxShadow: `0 0 0 ${layout.px(10) * press}px ${accentAt(accent, 0.28 * press)}`,
            }}
          >
            <Bell size={geo.chip.icon} />
            <span style={chipText}>{copy.subscribe}</span>
          </div>
        </div>
        {copy.handle.trim() ? (
          <div
            style={{
              marginTop: geo.gap,
              fontFamily: MONO,
              fontSize: geo.type.handle,
              letterSpacing: "0.04em",
              lineHeight: 1.4,
              color: palette.muted,
              whiteSpace: "nowrap",
              ...handleIn,
            }}
          >
            {copy.handle}
          </div>
        ) : null}
      </div>
      </div>
    </AbsoluteFill>
  );
};

// Plays the film's spoken end card line from its place in the card; nothing for a silent card.
export const EndCardVoice: React.FC<{ film: Film; card: EndCardSpan; volume: number }> = ({ film, card, volume }) => {
  if (!film.endCardVoice || card.lineFrom === null || card.lineFrom >= card.to) return null;
  return (
    <Sequence from={card.lineFrom} durationInFrames={card.to - card.lineFrom} layout="none">
      <Audio src={staticFile(film.endCardVoice.src)} volume={volume} />
    </Sequence>
  );
};
