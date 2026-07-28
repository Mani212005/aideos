import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { accentOf, COLOR, EASE, oppositeAccentOf, SANS, SERIF, t, type Accent, type Layout } from "../theme";

/**
 * Text animation, one word at a time.
 *
 * The previous version faded whole paragraphs as single blocks, which is why the
 * copy felt like slides. Staggering per word gives the eye a reading path and
 * lets a voiceover land on specific words.
 */

type Run = {
  text: string;
  accent: boolean;
  /** `~word~` — the *other* pigment colour, for lines that name both at once. */
  alt: boolean;
  serif: boolean;
};
/** A word is the animation unit, and may contain runs of mixed styling. */
type Word = Run[];

/**
 * Parses `*accent*` and `_serif italic_` markers into words.
 *
 * Splitting on the markers first and then on spaces is the obvious approach and
 * it is wrong: `is *green*.` yields the tokens `green` and `.`, which the flex
 * gap then separates into "green ." with a floating full stop. Words are found
 * first here, so trailing punctuation stays welded to the word it belongs to
 * even when the two halves are styled differently.
 */
export const tokenize = (input: string): Word[][] =>
  input.split("\n").map((line) => {
    const runs: Run[] = [];
    const marker = /(\*[^*]+\*|_[^_]+_|~[^~]+~)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = marker.exec(line)) !== null) {
      if (match.index > cursor) {
        runs.push({
          text: line.slice(cursor, match.index),
          accent: false,
          alt: false,
          serif: false,
        });
      }
      const chunk = match[0];
      runs.push({
        text: chunk.slice(1, -1),
        accent: chunk.startsWith("*"),
        alt: chunk.startsWith("~"),
        serif: chunk.startsWith("_"),
      });
      cursor = match.index + chunk.length;
    }
    if (cursor < line.length) {
      runs.push({ text: line.slice(cursor), accent: false, alt: false, serif: false });
    }

    const words: Word[] = [];
    let current: Word = [];
    for (const run of runs) {
      const parts = run.text.split(" ");
      parts.forEach((part, i) => {
        // Every part after the first follows a space, so it starts a new word.
        if (i > 0) {
          if (current.length > 0) words.push(current);
          current = [];
        }
        if (part.length > 0) {
          current.push({
            text: part,
            accent: run.accent,
            alt: run.alt,
            serif: run.serif,
          });
        }
      });
    }
    if (current.length > 0) words.push(current);

    return words;
  });

type WordsProps = {
  text: string;
  layout: Layout;
  accent: Accent;
  /** Frame, relative to the scene, at which the first word begins. */
  start: number;
  /** Frame at which the block starts leaving. */
  exit: number;
  size: number;
  weight?: number;
  lineHeight?: number;
  color?: string;
  /** Frames between consecutive words. */
  stagger?: number;
  tracking?: string;
  align?: "left" | "center";
};

export const Words: React.FC<WordsProps> = ({
  text,
  layout,
  accent,
  start,
  exit,
  size,
  weight = 800,
  lineHeight = 1.12,
  color = COLOR.inkHigh,
  stagger = 2.2,
  tracking = "-0.025em",
  align = "left",
}) => {
  const frame = useCurrentFrame();
  const lines = tokenize(text);
  const tone = accentOf(accent);
  // Whichever accent the scene is not already using.
  const altTone = oppositeAccentOf(accent);

  // The exit is a single move for the whole block: staggering the way out too
  // makes the cut feel mushy.
  const out = interpolate(frame, [exit, exit + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  let wordIndex = 0;

  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: size,
        fontWeight: weight,
        lineHeight,
        letterSpacing: tracking,
        color,
        textAlign: align,
        opacity: 1 - out,
        translate: `0 ${out * -34 * layout.scale}px`,
      }}
    >
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", flexWrap: "wrap", gap: `0 ${size * 0.26}px`, justifyContent: align === "center" ? "center" : "flex-start" }}>
          {line.map((word, wi) => {
            const delay = start + wordIndex * stagger;
            wordIndex += 1;

            const enter = interpolate(frame, [delay, delay + 22], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE.out,
            });

            return (
              <span
                key={wi}
                style={{
                  display: "inline-block",
                  whiteSpace: "pre",
                  opacity: enter,
                  translate: `0 ${(1 - enter) * size * 0.62}px`,
                  // A touch of blur on entry reads as focus pulling in, and hides
                  // the sub-pixel jitter of a translating glyph.
                  filter: `blur(${(1 - enter) * 7}px)`,
                }}
              >
                {word.map((run, ri) => {
                  const runTone = run.alt ? altTone : tone;
                  const tinted = run.accent || run.alt;
                  return (
                    <span
                      key={ri}
                      style={{
                        color: tinted ? runTone.base : undefined,
                        fontFamily: run.serif ? SERIF : undefined,
                        fontStyle: run.serif ? "italic" : undefined,
                        fontWeight: run.serif ? 400 : undefined,
                        letterSpacing: run.serif ? "-0.01em" : undefined,
                        textShadow: tinted
                          ? `0 0 ${size * 0.5}px ${runTone.glow}55`
                          : undefined,
                      }}
                    >
                      {run.text}
                    </span>
                  );
                })}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Small uppercase label with a rule that draws itself in. */
export const Kicker: React.FC<{
  text: string;
  layout: Layout;
  accent: Accent;
  start: number;
  exit: number;
}> = ({ text, layout, accent, start, exit }) => {
  const frame = useCurrentFrame();
  const tone = accentOf(accent);

  const draw = interpolate(frame, [start, start + 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });
  const out = interpolate(frame, [exit, exit + 14], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14 * layout.scale,
        marginBottom: 22 * layout.scale,
        opacity: out,
      }}
    >
      <div
        style={{
          width: 46 * layout.scale * draw,
          height: 2,
          background: tone.base,
          boxShadow: `0 0 12px ${tone.glow}`,
        }}
      />
      <span
        style={{
          fontFamily: SANS,
          fontSize: t(layout, "kicker"),
          fontWeight: 600,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: tone.base,
          opacity: draw,
          // Letters slide in from behind the rule.
          translate: `${(1 - draw) * -12 * layout.scale}px 0`,
        }}
      >
        {text}
      </span>
    </div>
  );
};

/** Body copy. Lower contrast than the headline, and it enters after it. */
export const Body: React.FC<{
  text: string;
  layout: Layout;
  start: number;
  exit: number;
  align?: "left" | "center";
}> = ({ text, layout, start, exit, align = "left" }) => {
  const frame = useCurrentFrame();

  const enter = interpolate(frame, [start, start + 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });
  const out = interpolate(frame, [exit, exit + 14], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.in,
  });

  return (
    <p
      style={{
        fontFamily: SANS,
        fontSize: t(layout, "body"),
        fontWeight: 400,
        lineHeight: 1.58,
        letterSpacing: "-0.005em",
        color: COLOR.inkMid,
        margin: `${26 * layout.scale}px 0 0 0`,
        maxWidth: layout.columnWidth * 0.94,
        textAlign: align,
        opacity: enter * out,
        translate: `0 ${(1 - enter) * 18 * layout.scale}px`,
      }}
    >
      {text}
    </p>
  );
};
