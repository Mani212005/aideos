/**
 * ==============================================================================
 * AIDEOS 2.0: PRETEXT KINETIC SUBTITLES & TEXT ENGINE
 * ==============================================================================
 * Calculates word-level karaoke highlights and smooth phrase-chunked subtitles
 * inside Remotion's 60 FPS render cycle with zero layout jitter.
 * ==============================================================================
 */

import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

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
}

export const KineticSubtitles: React.FC<KineticSubtitleProps> = ({
  words,
  maxWidth = 1000,
  fontSize = 32,
  fontFamily = "system-ui, -apple-system, sans-serif",
  primaryColor = "#FFFFFF",
  highlightColor = "#FF6B00",
  backgroundColor = "rgba(10, 15, 29, 0.88)",
  position = "bottom",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Group words into natural phrase chunks (punctuated phrases or 5-8 words max)
  const phrases = useMemo(() => {
    if (!words || words.length === 0) return [];
    const list: Array<{
      startIndex: number;
      endIndex: number;
      startFrame: number;
      endFrame: number;
      words: CaptionWord[];
    }> = [];
    let currentChunk: CaptionWord[] = [];
    let chunkStartIndex = 0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      currentChunk.push(w);
      const isPunctuation = /[.,!?;:]$/.test(w.text);
      const isLong = currentChunk.length >= 7;
      const isLast = i === words.length - 1;
      const nextWordGap = !isLast && words[i + 1].startFrame - w.endFrame > fps * 0.4;

      if (isPunctuation || isLong || isLast || nextWordGap) {
        list.push({
          startIndex: chunkStartIndex,
          endIndex: i,
          startFrame: currentChunk[0].startFrame,
          endFrame: currentChunk[currentChunk.length - 1].endFrame + Math.round(fps * 0.25),
          words: currentChunk,
        });
        currentChunk = [];
        chunkStartIndex = i + 1;
      }
    }
    return list;
  }, [words, fps]);

  // If no words, don't render
  if (!words || words.length === 0) return null;

  // Find active phrase
  const activePhrase = phrases.find(
    (p) => frame >= p.startFrame && frame <= p.endFrame
  );

  if (!activePhrase) return null;

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
  const phraseIn = interpolate(frame, [activePhrase.startFrame, activePhrase.startFrame + 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const phraseOut = interpolate(frame, [activePhrase.endFrame - 4, activePhrase.endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = phraseIn * phraseOut;

  const positionStyles: React.CSSProperties = {
    top: position === "top" ? "10%" : position === "center" ? "45%" : "82%",
  };

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        width: maxWidth,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 50,
        opacity,
        ...positionStyles,
      }}
    >
      <div
        style={{
          background: backgroundColor,
          padding: "12px 28px",
          borderRadius: "16px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          textAlign: "center",
          maxWidth: "92%",
        }}
      >
        <div
          style={{
            fontSize: `${fontSize}px`,
            fontFamily,
            fontWeight: 700,
            lineHeight: 1.35,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "8px 12px",
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
              <span
                key={`${globalIdx}-${w.text}`}
                style={{
                  color: isActive ? highlightColor : isPast ? primaryColor : "rgba(255, 255, 255, 0.38)",
                  transform: `scale(${dynamicScale})`,
                  display: "inline-block",
                  transition: "color 0.08s ease, transform 0.08s ease",
                  textShadow: isActive
                    ? `0 0 20px ${highlightColor}88, 0 2px 6px rgba(0,0,0,0.8)`
                    : isPast
                    ? "0 2px 4px rgba(0,0,0,0.5)"
                    : "none",
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
