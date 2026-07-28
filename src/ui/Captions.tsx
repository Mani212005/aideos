import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import { accentOf, COLOR, EASE, SANS, t, useLayout, type Layout } from "../theme";
import { withAlpha } from "../palette";

/**
 * Burned-in captions.
 *
 * Deliberately *not* the TikTok one-word-at-a-time treatment. That style exists
 * to hold attention in a 15-second short; across twelve minutes it is exhausting
 * and it reads slower than normal subtitles. This groups into short phrases the
 * way broadcast subtitles do, and only softly lifts the word currently being
 * spoken so the eye can re-find its place after looking away.
 */

/** How often a caption page turns over. Longer on landscape, where lines are wider. */
const switchEveryMs = (layout: Layout) => (layout.mode === "landscape" ? 2400 : 1600);

const CaptionPage: React.FC<{ page: TikTokPage; layout: Layout }> = ({ page, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = layout.scale;
  const tone = accentOf("primary");

  const absoluteMs = page.startMs + (frame / fps) * 1000;

  // Pages fade rather than cut; a hard swap at reading speed is jarring.
  const fade = interpolate(frame, [0, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.out,
  });

  return (
    <div
      style={{
        maxWidth: layout.width * (layout.mode === "landscape" ? 0.68 : 0.9),
        textAlign: "center",
        fontFamily: SANS,
        fontSize: t(layout, "body") * (layout.mode === "landscape" ? 1.06 : 1.15),
        fontWeight: 600,
        lineHeight: 1.42,
        letterSpacing: "-0.01em",
        // A soft scrim rather than a solid bar — the frame stays visible behind.
        background: "rgba(3, 6, 9, 0.62)",
        border: `1px solid ${COLOR.hairline}`,
        borderRadius: 12 * k,
        padding: `${12 * k}px ${22 * k}px`,
        opacity: fade,
        whiteSpace: "pre-wrap",
      }}
    >
      {page.tokens.map((token) => {
        const active = token.fromMs <= absoluteMs && token.toMs > absoluteMs;
        return (
          <span
            key={`${token.fromMs}-${token.text}`}
            style={{
              whiteSpace: "pre",
              color: active ? tone.base : COLOR.inkHigh,
              textShadow: active ? `0 0 ${18 * k}px ${withAlpha(tone.glow, 0.5)}` : undefined,
            }}
          >
            {token.text}
          </span>
        );
      })}
    </div>
  );
};

/**
 * Loads a captions JSON from `public/` and renders it along the bottom.
 *
 * `useDelayRender` holds the render until the file has loaded — without it the
 * first frames would render before the fetch resolves and ship with no captions.
 */
export const Captions: React.FC<{ src: string }> = ({ src }) => {
  const layout = useLayout();
  const { fps } = useVideoConfig();
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender());

  const load = useCallback(async () => {
    try {
      const res = await fetch(staticFile(src));
      if (!res.ok) throw new Error(`captions file ${src} returned ${res.status}`);
      setCaptions((await res.json()) as Caption[]);
      continueRender(handle);
    } catch (e) {
      cancelRender(e);
    }
  }, [src, continueRender, cancelRender, handle]);

  useEffect(() => {
    load();
  }, [load]);

  const switchMs = switchEveryMs(layout);

  const pages = useMemo(() => {
    if (!captions) return [];
    return createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: switchMs,
    }).pages;
  }, [captions, switchMs]);

  if (!captions) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {pages.map((page, i) => {
        const next = pages[i + 1] ?? null;
        const startFrame = (page.startMs / 1000) * fps;
        const endFrame = Math.min(
          next ? (next.startMs / 1000) * fps : Infinity,
          startFrame + (switchMs / 1000) * fps,
        );
        const durationInFrames = endFrame - startFrame;
        if (durationInFrames <= 0) return null;

        return (
          <Sequence
            key={i}
            name={`caption-${i}`}
            from={Math.round(startFrame)}
            durationInFrames={Math.round(durationInFrames)}
          >
            <AbsoluteFill
              style={{
                justifyContent: "flex-end",
                alignItems: "center",
                // Clear of the progress rail, and inside YouTube's control strip
                // so the player chrome never covers a line.
                paddingBottom: layout.height * 0.075,
              }}
            >
              <CaptionPage page={page} layout={layout} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
