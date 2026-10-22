/**
 * File Description: Pretext kinetic subtitles and text engine calculating word-level karaoke highlights and phrase-chunked subtitles inside Remotion's render cycle.
 * Inputs and outputs: caption words and current frame -> styled kinetic typography subtitle overlay.
 * Used by: src/dl/Film.tsx, editor/src/components/KineticCaptionEditor.tsx.
 */

import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  SUBTITLE_CARD_PADDING_Y,
  SUBTITLE_LINE_HEIGHT,
} from "./fullScreenHeroLayout";
import { SANS } from "./tokens";
import { measureText } from "@remotion/layout-utils";
import { buildCaptionPhrases } from "./captionPhrases";
import type { CaptionPlacement } from "./schema";
import { frames } from "./motion";

export interface CaptionWord {
  text: string;
  startFrame: number;
  endFrame: number;
}

export interface KineticSubtitleProps {
  words: CaptionWord[];
  maxWidth?: number;
  fontSize?: number;
  fontFamily?: string;
  primaryColor?: string;
  highlightColor?: string;
  backgroundColor?: string;
  position?: "top" | "center" | "bottom";
  placementAt?: (frame: number) => CaptionPlacement;
}

export const KineticSubtitles: React.FC<KineticSubtitleProps> = ({
  words,
  maxWidth = 1000,
  fontSize = 32,
  fontFamily = SANS,
  primaryColor = "#FFFFFF",
  highlightColor = "#635BFF",
  backgroundColor = "rgba(10, 15, 29, 0.88)",
  position = "bottom",
  placementAt,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // Compute every phrase once so neither position nor wrapping can change during a phrase.
  const phrases = useMemo(() => buildCaptionPhrases({
    words, fps, fontSize, width,
    placementAt: placementAt ?? (() => ({ x: 0.5, y: position === "top" ? 0.1 : position === "center" ? 0.45 : 0.78, w: maxWidth / width, locked: false, source: "default" })),
    measure: (text) => measureText({ text, fontFamily, fontSize, fontWeight: 700 }).width,
  }), [words, fps, fontSize, width, placementAt, position, maxWidth, fontFamily]);

  // If no words, don't render
  if (!words || words.length === 0) return null;

  // Find active phrase
  const activePhrase = phrases.find(
    (p) => frame >= p.startFrame && frame <= p.endFrame
  );

  if (!activePhrase) return null;
  const explicitWidth = activePhrase.placement.source !== "default" && Math.abs(activePhrase.placement.w - 0.86) > 0.000001;

  // Find active word index within the global words array
  let activeWordIndex = words.findIndex(
    (w) => frame >= w.startFrame && frame <= w.endFrame
  );

  // If between words within the active phrase, hold the preceding word
  if (activeWordIndex === -1) {
    for (let i = activePhrase.endIndex; i >= activePhrase.startIndex; i--) {
      if (frame >= words[i].startFrame) {
        activeWordIndex = i;
        break;
      }
    }
  }

  // Fade in / out smoothly at phrase boundaries
  const fadeSpan = frames(133, fps);
  const phraseIn = interpolate(frame, [activePhrase.startFrame, activePhrase.startFrame + fadeSpan], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const phraseOut = interpolate(frame, [activePhrase.endFrame - fadeSpan, activePhrase.endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = phraseIn * phraseOut;

  return (
    <div
      data-caption-phrase
      style={{
        position: "absolute",
        left: `${activePhrase.placement.x * 100}%`,
        top: `${activePhrase.placement.y * 100}%`,
        transform: "translateX(-50%)",
        width: activePhrase.placement.w * width,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 50,
        opacity,
      }}
    >
      <div
        data-caption-card
        style={{
          background: backgroundColor,
          padding: `${SUBTITLE_CARD_PADDING_Y}px 28px`,
          borderRadius: "16px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          textAlign: "center",
          ...(explicitWidth
            ? { width: activePhrase.placement.w * width, boxSizing: "border-box" as const }
            : { maxWidth: "92%" }),
        }}
      >
        <div
          style={{
            fontSize: `${fontSize}px`,
            fontFamily,
            fontWeight: 700,
            lineHeight: SUBTITLE_LINE_HEIGHT,
            display: "block",
            textAlign: "center",
            textWrap: "balance",
            ...(explicitWidth ? { width: "100%", boxSizing: "border-box" as const } : {}),
          }}
        >
          {activePhrase.words.map((w, localIdx) => {
            const globalIdx = activePhrase.startIndex + localIdx;
            const isActive = globalIdx === activeWordIndex;
            const isPast = activeWordIndex >= 0 && globalIdx < activeWordIndex;

            const scale = isActive
              ? spring({
                  frame: Math.max(0, frame - w.startFrame),
                  fps,
                  config: { damping: 14, stiffness: 260 },
                })
              : 1;

            const dynamicScale = isActive ? interpolate(scale, [0, 1], [1.12, 1.0]) : 1.0;

            return (
              <React.Fragment key={`${globalIdx}-${w.text}`}>
                {activePhrase.lineBreaks.includes(localIdx) ? <br /> : null}
                <span
                  style={{
                    color: isActive ? highlightColor : isPast ? primaryColor : "rgba(255, 255, 255, 0.38)",
                    transform: `scale(${dynamicScale})`,
                    display: "inline-block",
                    margin: "4px 6px",
                    textShadow: isActive
                      ? `0 0 20px ${highlightColor}88, 0 2px 6px rgba(0,0,0,0.8)`
                      : isPast
                      ? "0 2px 4px rgba(0,0,0,0.5)"
                      : "none",
                  }}
                >
                  {w.text}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
