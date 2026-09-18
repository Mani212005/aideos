/**
 * File Description: Core Remotion film renderer assembling canvas graph, spatial camera movements, staged devices, subtitles, and audio tracks.
 */

import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Img, staticFile, Audio, Sequence } from "remotion";
import { accentAt, PALETTE, useLayout, useTokens, BACKGROUND_THEMES, resolveFont, ThemeContext } from "./tokens";
import { getFullScreenHeroLayout, heroScrimGradient } from "./fullScreenHeroLayout";
import { DRIFT, easeExpo, frames, MS } from "./motion";
import { AccentContext } from "./accent";
import { BlockView } from "./Block";
import { CanvasGraph } from "./CanvasGraph";
import { SceneStage } from "./SceneStage";
import { PaperRip } from "./PaperRip";
import { KineticSubtitles, type CaptionWord } from "./KineticSubtitles";
import { getRetimedAudioRelPath } from "./audio/retime";
import {
  buildTimeline,
  camAt,
  lookBox,
  projectBox,
  shotAt,
  activeShotAt,
  totalFrames,
  type TimedShot,
} from "./camera";
import type { Film, Block } from "./schema";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE: THE FILM
 * ---------------------------------------------------------------------------
 * Assembles 05-08: the camera moves across one canvas, and where it stops it
 * either sits on the structure (the spine) or grows a device out of the node it
 * is looking at.
 *
 * The join is the whole trick. A device does not cut in: the node's border
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
  const palette = useTokens();
  const active = activeShotAt(timeline, frame);
  if (!active || active.shot.stage === "none") return null;
  const current = active;
  const shot = current.shot;

  const bgPreset = film.theme?.background || "paper-white";
  const bgTheme = BACKGROUND_THEMES[bgPreset] || BACKGROUND_THEMES["paper-white"];

  if (shot.stage === "none") return null;

  const openFrames = frames(MS.move, fps);
  const closeFrames = frames(CLOSE_MS, fps);

  const isCut = shot.move === "cut" || current.index === 0 || shot.stage === "frame";
  const open = isCut ? 1 : easeExpo((frame - current.from) / openFrames);
  const close = isCut ? 0 : easeExpo((frame - (current.to - closeFrames)) / closeFrames);

  // A shot whose only block is a full-screen hero plate has no panel to speak of: the plate
  // is the station. Keeping the usual margins around it framed the footage as a small
  // letterboxed rectangle floating on black, which is what a stock-footage slideshow looks
  // like. It runs to the frame edge instead.
  const heroOnly =
    shot.blocks.length === 1 && shot.blocks[0].c === "AnalogyInset" && Boolean(shot.blocks[0].fullScreenHero);

  const target = heroOnly
    ? { x: 0, y: 0, w: width, h: height }
    : {
        x: layout.margin.left,
        y: layout.margin.top,
        w: width - layout.margin.left - layout.margin.right,
        h: height - layout.margin.top - layout.margin.bottom,
      };

  let rect = target;
  const opacity = isCut
    ? 1
    : Math.max(0, Math.min(1, open * 1.4)) * (1 - Math.max(0, Math.min(1, close)));

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

  const contentIn = isCut
    ? 1
    : interpolate(
        frame,
        [current.from + openFrames * 0.55, current.from + openFrames],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );
  const contentStart = isCut ? current.from : current.from + Math.round(openFrames * 0.55);

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        border: heroOnly || shot.stage === "frame" ? "none" : `1px solid ${bgTheme.hairline}`,
        borderRadius: heroOnly ? 0 : layout.radius.card,
        background:
          shot.stage === "frame" || heroOnly ? "transparent" : bgTheme.surface,
        boxShadow: shot.stage === "frame" || heroOnly ? "none" : "0 16px 40px rgba(0, 0, 0, 0.35)",
        opacity,
        overflow: "hidden",
        display: "flex",
      }}
    >
      {/* A card printed straight onto a scene has a star field behind it, and a single lit dot
          landing on a glyph reads as a broken character. The film-level scrim sets the mood but
          is far too light to suppress one; this band is local to the type, so the picture stays
          visible around the card while nothing shows through the letters themselves. */}
      {film.scene && shot.blocks.length > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            height: "42%",
            pointerEvents: "none",
            background: `linear-gradient(to bottom, ${accentAt(palette.canvas, 0)} 0%, ${accentAt(palette.canvas, 0.86)} 26%, ${accentAt(palette.canvas, 0.86)} 74%, ${accentAt(palette.canvas, 0)} 100%)`,
          }}
        />
      ) : null}
      <div
        style={{
          flex: 1,
          position: "relative",
          padding: shot.stage === "frame" || heroOnly ? 0 : layout.grid * 5,
          display: "flex",
          flexDirection: "column",
          // Centred, always. Spreading two blocks to the top and bottom of a full-frame
          // panel left a void the height of the frame between a headline and the device
          // it introduces, which reads as a layout accident rather than a composition.
          justifyContent: "center",
          alignItems: "center",
          gap: layout.grid * 2.5,
          opacity: contentIn,
          minWidth: 0,
          width: "100%",
          height: "100%",
        }}
      >
        {shot.blocks.map((block, i) => (
          <BlockView
            key={`${current.index}-${i}`}
            block={block}
            start={contentStart}
            index={i}
            durationInFrames={current.durationInFrames}
          />
        ))}
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
 * Chapter rail. This is the answer to section 08's one test: scrub with the sound off
 * and every frame has to tell you where you are in the argument.
 */
const Rail: React.FC<{ film: Film; timeline: TimedShot[] }> = ({ film, timeline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  // The rail's unfilled track has to come from the rendering theme. The module-level
  // rule() is paper-white ink, which is invisible on a dark canvas and leaves the rail
  // showing only its filled half, so the film stops saying where you are in it.
  const palette = useTokens();
  const current = shotAt(timeline, frame);
  const total = totalFrames(timeline);
  const progress = frame / total;

  const seconds = Math.floor(frame / fps);
  const stamp = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const chapterIndex = Math.min(current.chapter, film.chapters.length - 1);

  // The rail is chrome, and chrome has to stay readable over whatever the film is doing behind
  // it. A node graph leaves the bottom of the frame empty, but a scene can put a star or a limb
  // straight through a glyph, so the rail carries its own ground rather than trusting the frame.
  // Sized to the rail, not to the margin. A reel's bottom margin is two and a half times the
  // long cut's because the design language reserves the bottom fifth of a vertical frame for the
  // platform's own chrome, so scaling the scrim by that margin blacked out 40% of the reel.
  const scrimHeight = layout.margin.bottom * 0.5 + layout.px(120);

  return (
    <>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: scrimHeight,
        pointerEvents: "none",
        // Opaque for the band the rail actually occupies, then faded out: a star showing through
        // a glyph at even a few percent still reads as a collision.
        background: `linear-gradient(to top, ${palette.canvas} 0%, ${palette.canvas} 56%, ${accentAt(palette.canvas, 0)} 100%)`,
      }}
    />
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
        <span>{`chapter ${String(chapterIndex + 1).padStart(2, "0")}: ${film.chapters[chapterIndex]}`}</span>
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
                background: i <= chapterIndex ? "currentColor" : palette.rule(),
                color: i <= chapterIndex ? undefined : "transparent",
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{ height: layout.px(3), background: palette.rule(), borderRadius: layout.px(2) }}>
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
    </>
  );
};

export type FilmViewProps = {
  film: Film;
  timeline: TimedShot[];
  accent: string;
  showGrid: boolean;
  showRail: boolean;
  captionWords?: CaptionWord[];
  transitionType?: string;
  includeAudio?: boolean;
};

/**
 * The PNG-sequence variant of a `fullScreenHero` block. It shares
 * `getFullScreenHeroLayout` with `AnalogyInset` so both hero paths fill the frame
 * and place their caption in the same safe area on either canvas.
 */
const Dynamic3DHeroOverlay: React.FC<{ frame: number; timeline: ReturnType<typeof buildTimeline> }> = ({ frame, timeline }) => {
  const layout = useLayout();
  const palette = useTokens();
  const labelStyle = layout.label(14);
  const heroLayout = getFullScreenHeroLayout({
    ...layout,
    labelHeight: Number(labelStyle.fontSize) * 1.6,
  });

  for (const t of timeline) {
    const shot = t.shot;
    const heroBlock = shot.blocks.find(
      (b: Block): b is Extract<Block, { c: "AnalogyInset" }> =>
        b.c === "AnalogyInset" && !!b.fullScreenHero && Boolean(b.framesDir) && !b.src
    );
    if (!heroBlock || !heroBlock.framesDir) continue;

    const delay = heroBlock.delayFrames || 0;
    const total = heroBlock.totalFrames || 180;
    const startFrame = t.from + delay;
    const endFrame = startFrame + total;

    if (frame >= startFrame && frame <= endFrame) {
      const elapsed = frame - startFrame + 1;
      const currentFrame = Math.max(1, Math.min(total, elapsed));
      const pad = String(currentFrame).padStart(4, "0");
      const dir = heroBlock.framesDir;
      const imgSrc = `${dir}/frame_${pad}.png`;

      const fadeIn = Math.min(1, elapsed / 8);
      const fadeOut = Math.min(1, (endFrame - frame) / 10);
      const opacity = Math.min(fadeIn, fadeOut);

      return (
        <AbsoluteFill
          style={{
            zIndex: 100,
            opacity,
            background: palette.canvas,
            overflow: "hidden",
          }}
        >
          <Img src={staticFile(imgSrc)} alt={heroBlock.caption || ""} style={heroLayout.media} />
          <AbsoluteFill
            style={{
              pointerEvents: "none",
              background: heroScrimGradient(heroLayout.scrimStops, (alpha) => accentAt(palette.canvas, alpha)),
            }}
          />
          {heroBlock.caption ? (
            <div
              style={{
                ...labelStyle,
                position: "absolute",
                ...heroLayout.caption,
                color: palette.inkAt(0.72),
                textShadow: `0 ${layout.px(2)}px ${layout.px(12)}px ${accentAt(palette.canvas, 0.9)}`,
              }}
            >
              {heroBlock.caption}
            </div>
          ) : null}
        </AbsoluteFill>
      );
    }
  }

  return null;
};

export const FilmView: React.FC<FilmViewProps> = ({
  film,
  timeline,
  accent,
  showGrid,
  showRail,
  captionWords,
  transitionType,
  includeAudio = true,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const current = shotAt(timeline, frame);
  const cam = camAt(film, timeline, frame, { width, height });
  const isReel = width < height;

  // The whole composition drifts 100 -> 104% across a held shot; the diagram
  // inside never moves once drawn. It is the difference between a still frame
  // and a held one.
  const driftProgress = Math.max(
    0,
    Math.min(1, (frame - current.from) / Math.max(1, current.durationInFrames)),
  );
  const drift = current.shot.drift
    ? 1 + (DRIFT - 1) * driftProgress
    : 1;

  // The canvas dims under a panel rather than disappearing. Rule 02 again:
  // nothing is destroyed, so you can always see the structure you are inside.
  const panelOpen =
    current.shot.stage === "none"
      ? 0
      : Math.max(0, Math.min(1, easeExpo((frame - current.from) / frames(MS.move, fps))));
  // A text beat is transparent all the way to the canvas, so whatever node the camera is
  // sitting on is directly behind the headline at whatever scale the shot solved to. At a
  // 6% dim the node's own label was still legible enough to collide with the words in front
  // of it; 3% keeps the structure present without putting two texts in the same place.
  const canvasOpacity =
    current.shot.stage === "frame" ? 1 - 0.97 * panelOpen : 1 - 0.72 * panelOpen;

  // Paper rip transition between mind-map nodes (Enam Al-Amin paper tear style)
  const transitionFrames = frames(600, fps);
  const relFrame = frame - current.from;
  const isTransitioning = relFrame >= 0 && relFrame <= transitionFrames && current.index > 0;
  const transitionProgress = isTransitioning ? relFrame / transitionFrames : 0;

  const bgPreset = film.theme?.background || "paper-white";
  const bgTheme = BACKGROUND_THEMES[bgPreset] || BACKGROUND_THEMES["paper-white"];
  const fontFamily = resolveFont(film.theme?.fontFamily);
  const activeTransition = current.shot.transition || transitionType || "paper-rip";

  return (
    <ThemeContext.Provider value={bgTheme}>
      <AccentContext.Provider value={accent}>
        <AbsoluteFill
          style={{
            backgroundColor: bgTheme.canvas,
            color: bgTheme.ink,
            fontFamily,
          }}
        >
        {/* Paper & Texture Library Filter Shaders */}
        {bgTheme.gridType === "paper-fibers" && (
          <AbsoluteFill style={{ opacity: 0.28, pointerEvents: "none" }}>
            <svg width="100%" height="100%">
              <filter id="paper-grain">
                <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" />
                <feDiffuseLighting in="noise" lightingColor={bgTheme.canvas} surfaceScale="1.2">
                  <feDistantLight azimuth="60" elevation="50" />
                </feDiffuseLighting>
                <feBlend mode="multiply" in="SourceGraphic" result="blend" />
              </filter>
              <rect width="100%" height="100%" filter="url(#paper-grain)" opacity="0.8" />
            </svg>
          </AbsoluteFill>
        )}

        {bgTheme.gridType === "blueprint-grid" && (
          <AbsoluteFill style={{ opacity: 0.45, pointerEvents: "none" }}>
            <svg width="100%" height="100%">
              <defs>
                <pattern id="bp-small" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.5" />
                </pattern>
                <pattern id="bp-large" width="100" height="100" patternUnits="userSpaceOnUse">
                  <rect width="100" height="100" fill="url(#bp-small)" />
                  <path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#bp-large)" />
            </svg>
          </AbsoluteFill>
        )}

        {bgTheme.gridType === "subtle-dots" && (
          <AbsoluteFill style={{ opacity: 0.35, pointerEvents: "none" }}>
            <svg width="100%" height="100%">
              <defs>
                <pattern id="dot-pat" width="24" height="24" patternUnits="userSpaceOnUse">
                  <circle cx="12" cy="12" r="1.2" fill={bgTheme.ink} opacity="0.3" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#dot-pat)" />
            </svg>
          </AbsoluteFill>
        )}

        {/* Unified Spatial Canvas Graph & Stage */}
        <AbsoluteFill style={{ transform: `scale(${drift})` }}>
          {/* A film's canvas is either a node graph or a vector scene, never both. A scene runs
              its own continuous motion and raises its own scrim under text, so it is not dimmed
              by the panel the way a diagram is: dimming it would stop the film mid-shot. */}
          {film.scene ? (
            <SceneStage scene={film.scene} width={width} height={height} accent={accent} />
          ) : (
            <AbsoluteFill style={{ opacity: canvasOpacity }}>
              <CanvasGraph film={film} timeline={timeline} cam={cam} />
            </AbsoluteFill>
          )}
          {showGrid ? <Grid /> : null}
          <Stage film={film} timeline={timeline} />
        </AbsoluteFill>

        {/* Full-Screen Dynamic 3D Hero Spotlight Overlay */}
        <Dynamic3DHeroOverlay frame={frame} timeline={timeline} />
        {activeTransition === "paper-rip" && (
          <PaperRip active={isTransitioning} progress={transitionProgress} frame={frame} />
        )}
        {/* Burned-in subtitles are a reel-only treatment. src/dl/README.md rules them out of
            the design language because they fight the panel for the same space and every
            long-form platform draws its own from the sidecar track - but a vertical frame
            already reserves its bottom fifth for platform chrome, and social video is
            watched muted, so there the caption has somewhere to live and a job to do. */}
        {isReel && captionWords && captionWords.length > 0 ? (
          <KineticSubtitles
            words={captionWords}
            maxWidth={width * 0.86}
            fontSize={Math.round(width * 0.042)}
            highlightColor={accent}
            position="bottom"
          />
        ) : null}

        {/* Master Audio Track & Multi-Clip Voiceover Spine */}
        {includeAudio && (
          <>
            {film.audioClips && film.audioClips.length > 0 ? (
              film.audioClips.map((ac) => {
                const speed = ac.speed ?? 1.0;
                const isRetimed = Math.abs(speed - 1.0) > 0.001;
                const startFrame = Math.round(ac.position * fps);
                const rawDurFrames = Math.max(1, Math.round(ac.end * fps) - Math.round((ac.start ?? 0) * fps));
                const effectiveDurFrames = Math.max(1, Math.round(rawDurFrames / speed));
                const startFrom = isRetimed ? Math.round(((ac.start ?? 0) / speed) * fps) : Math.round((ac.start ?? 0) * fps);
                const endAt = isRetimed ? Math.round((ac.end / speed) * fps) : Math.round(ac.end * fps);
                const audioSrc = isRetimed
                  ? staticFile(ac.retimedSrc || getRetimedAudioRelPath(ac.src, speed))
                  : staticFile(ac.src);

                return (
                  <Sequence key={ac.id} from={startFrame} durationInFrames={effectiveDurFrames}>
                    <Audio
                      src={audioSrc}
                      startFrom={startFrom}
                      endAt={endAt}
                      playbackRate={1.0}
                      volume={() => ac.volume ?? 1}
                    />
                  </Sequence>
                );
              })
            ) : (
              film.voiceover?.src && (
                (() => {
                  const speed = film.voiceover.speed ?? 1.0;
                  const isRetimed = Math.abs(speed - 1.0) > 0.001;
                  const audioSrc = isRetimed
                    ? staticFile(film.voiceover.retimedSrc || getRetimedAudioRelPath(film.voiceover.src, speed))
                    : staticFile(film.voiceover.src);

                  return (
                    <Audio
                      key={`vo-${film.voiceover.src}-${speed}`}
                      src={audioSrc}
                      playbackRate={1.0}
                      volume={() => film.voiceover?.volume ?? 1}
                    />
                  );
                })()
              )
            )}

            {/* Background Music */}
            {film.music?.src && (
              <Audio
                src={staticFile(film.music.src)}
                volume={() => (film.music?.volume ?? 1) * 0.25}
              />
            )}

            {/* SFX Timeline Placements */}
            {film.sfx?.map((sfx, idx) => (
              <Sequence key={idx} from={Math.round(sfx.timeSec * fps)}>
                <Audio src={staticFile(sfx.src)} volume={() => sfx.volume ?? 1} />
              </Sequence>
            ))}
          </>
        )}

        {/* Chapter Rail */}
        {showRail ? <Rail film={film} timeline={timeline} /> : null}

        {/* A single hairline vignette at the very edge */}
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            boxShadow: `inset 0 0 0 1px ${bgTheme.hairline}`,
          }}
        />
      </AbsoluteFill>
    </AccentContext.Provider>
  </ThemeContext.Provider>
);
};
