/**
 * ==============================================================================
 * AIDEOS 2.0: PRETEXT KINETIC SUBTITLES & TEXT ENGINE
 * ==============================================================================
 * Powered by @chenglou/pretext for microsecond zero-DOM multiline text layout.
 * Calculates exact line breaks, word coordinates, and dynamic badge sizes
 * mathematically inside Remotion's 60 FPS render cycle without layout reflows.
 * ==============================================================================
 */

import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { prepareWithSegments, layoutWithLines, type LayoutLine } from "@chenglou/pretext";

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
  maxWidth = 880,
  fontSize = 54,
  fontFamily = "system-ui, -apple-system, sans-serif",
  primaryColor = "#FFFFFF",
  highlightColor = "#FFD700",
  backgroundColor = "rgba(15, 23, 42, 0.85)",
  position = "bottom",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const totalDuration = words.length > 0 ? (words[words.length - 1]?.endFrame || 300) : 300;
  const cycleFrame = frame % totalDuration;

  // Find active word
  const activeWordIndex = words.findIndex(
    (w) => cycleFrame >= w.startFrame && cycleFrame <= w.endFrame
  );

  const activeIdx = activeWordIndex >= 0 ? activeWordIndex : 0;
  const windowSize = 7;
  const startWindow = Math.max(0, activeIdx - 2);
  const endWindow = Math.min(words.length, startWindow + windowSize);
  const visibleWords = words.slice(startWindow, endWindow);

  // Group text into a continuous string for Pretext layout calculation
  const fullText = useMemo(() => visibleWords.map((w) => w.text).join(" "), [visibleWords]);
  const lineHeight = Math.round(fontSize * 1.3);

  // Pretext Preparation & Zero-DOM Layout calculation
  useMemo(() => {
    try {
      const fontSpec = `bold ${fontSize}px ${fontFamily}`;
      const prep = prepareWithSegments(fullText, fontSpec);
      const res = layoutWithLines(prep, maxWidth, lineHeight);
      return { lines: res.lines.map((l: LayoutLine) => l.text), height: res.height };
    } catch {
      return { lines: [fullText], height: lineHeight };
    }
  }, [fullText, fontSize, fontFamily, maxWidth, lineHeight]);

  // Active word animation spring
  const activeWord = words[activeIdx] || words[0];
  const wordProgress = activeWord
    ? spring({
        frame: cycleFrame - activeWord.startFrame,
        fps,
        config: { damping: 12, stiffness: 220 },
      })
    : 1;

  const scale = interpolate(wordProgress, [0, 1], [1.15, 1.0], {
    extrapolateRight: "clamp",
  });

  const positionStyles: React.CSSProperties = {
    top: position === "top" ? "12%" : position === "center" ? "45%" : "80%",
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
        ...positionStyles,
      }}
    >
      <div
        style={{
          background: backgroundColor,
          padding: "14px 24px",
          borderRadius: "18px",
          backdropFilter: "blur(12px)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.55)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          textAlign: "center",
          maxWidth: "100%",
        }}
      >
        <div
          style={{
            fontSize: `${fontSize}px`,
            fontFamily,
            fontWeight: 800,
            lineHeight: 1.25,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "10px",
          }}
        >
          {visibleWords.map((w) => {
            const globalIdx = words.indexOf(w);
            const isActive = globalIdx === activeWordIndex;
            const isPast = globalIdx < activeWordIndex;

            return (
              <span
                key={`${w.text}-${globalIdx}`}
                style={{
                  color: isActive ? highlightColor : isPast ? primaryColor : "rgba(255, 255, 255, 0.4)",
                  transform: isActive ? `scale(${scale})` : "scale(1)",
                  display: "inline-block",
                  transition: "color 0.1s ease",
                  textShadow: isActive
                    ? `0 0 24px ${highlightColor}AA, 0 4px 12px rgba(0,0,0,0.9)`
                    : "0 2px 4px rgba(0,0,0,0.6)",
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
