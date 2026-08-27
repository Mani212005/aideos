/**
 * File Description: Single authoritative source of truth for on-screen block placement rects.
 * Provides computeBlockRect for runtime rendering (Stage, BlockView) and analytical validation.
 */
import type { Film, Shot, Block } from "./schema";
import { DEVICE_BLOCKS } from "./schema";
import { lookBox, projectBox, camAt, type Cam } from "./camera";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BlockRectOptions {
  blockIndex?: number;
  totalBlocks?: number;
  progress?: number;
  cam?: Cam;
}

/**
 * Checks if a block is classified as a device or visual metaphor block.
 */
export function isDeviceBlock(block: Block): boolean {
  return (
    block.c === "MetaphorViewer" ||
    (DEVICE_BLOCKS as readonly string[]).includes(block.c)
  );
}

/**
 * The single source of truth for where any block renders on screen.
 * Every block (TextReveal, CharacterBeat, MetaphorViewer, DeviceCard, etc.)
 * is placed through this function across Long (1920x1080) and Reel (1080x1920) viewports.
 */
export function computeBlockRect(
  film: Film,
  shot: Shot,
  block: Block,
  viewport: { width: number; height: number },
  options: BlockRectOptions = {}
): Rect {
  const isReel = viewport.width < viewport.height;
  const total = Math.max(1, options.totalBlocks ?? shot.blocks.length);
  const index = Math.max(0, options.blockIndex ?? 0);

  // Standard margins from tokens.ts
  const margin = isReel
    ? { top: 120, right: 64, bottom: 240, left: 64 }
    : { top: 96, right: 96, bottom: 96, left: 96 };

  if (shot.stage === "none") {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  const hasHeadline = shot.blocks.some(
    (b) => b.c === "TextReveal" || b.c === "Kicker"
  );
  const hasVisualDevice = shot.blocks.some(
    (b) => isDeviceBlock(b) || b.c === "CharacterBeat"
  );

  if (shot.stage === "frame") {
    if (block.c === "Kicker" || (block.c === "TextReveal" && hasVisualDevice)) {
      // Headline occupies top area above the visual device
      const maxW = isReel ? viewport.width - margin.left - margin.right : 1180;
      const w = Math.min(viewport.width - margin.left - margin.right, maxW);
      const h = block.c === "Kicker" ? 40 : 120;
      const x = Math.round((viewport.width - w) / 2);
      const y = block.c === "Kicker" ? margin.top : margin.top + (shot.blocks.some((b) => b.c === "Kicker") ? 48 : 12);
      return { x, y, w, h };
    }

    if (block.c === "TextReveal" && !hasVisualDevice) {
      // Solo headline centered in the middle of frame
      const maxW = isReel ? viewport.width - margin.left - margin.right : 1180;
      const w = Math.min(viewport.width - margin.left - margin.right, maxW);
      const h = Math.min(viewport.height * 0.40, 240);
      const x = Math.round((viewport.width - w) / 2);
      const y = Math.round((viewport.height - h) / 2);
      return { x, y, w, h };
    }

    if (block.c === "CharacterBeat") {
      // Hero character centered in stage
      const charH = isReel
        ? Math.min(viewport.height * 0.45, 520)
        : Math.min(viewport.height * 0.58, 480);
      const charW = Math.round(charH * 0.65);
      const x = Math.round((viewport.width - charW) / 2);
      const y = hasHeadline
        ? Math.round(viewport.height * 0.30)
        : Math.round((viewport.height - charH) / 2);
      return { x, y, w: charW, h: Math.round(charH) };
    }

    if (isDeviceBlock(block)) {
      // Visual device or MetaphorViewer centered in the active stage area
      const maxW = isReel ? viewport.width - margin.left - margin.right : 840;
      const maxH = isReel ? viewport.height * 0.42 : viewport.height * 0.52;
      const w = Math.round(Math.min(viewport.width - margin.left - margin.right, maxW));
      const h = Math.round(Math.min(viewport.height - margin.top - margin.bottom, maxH));
      const x = Math.round((viewport.width - w) / 2);
      const y = hasHeadline
        ? Math.round(margin.top + 140 + (viewport.height - margin.top - margin.bottom - 140 - h) / 2)
        : Math.round((viewport.height - h) / 2);
      return { x, y, w, h };
    }

    if (block.c === "StatCounter") {
      const statW = Math.min(360, viewport.width - margin.left - margin.right);
      const statH = 120;
      const x = Math.round((viewport.width - statW) / 2);
      const y = Math.round(viewport.height - margin.bottom - statH - 20);
      return { x, y, w: statW, h: statH };
    }
  }

  // shot.stage === "anchor" (or fallback card partitioning)
  const target = {
    x: margin.left,
    y: margin.top,
    w: viewport.width - margin.left - margin.right,
    h: viewport.height - margin.top - margin.bottom,
  };

  let cardBox = target;
  if (options.cam) {
    const seed = projectBox(lookBox(film, shot), options.cam, viewport);
    const progress = options.progress ?? 1.0;
    const mix = (a: number, b: number) => Math.round(a + (b - a) * progress);
    cardBox = {
      x: mix(seed.x, target.x),
      y: mix(seed.y, target.y),
      w: mix(seed.w, target.w),
      h: mix(seed.h, target.h),
    };
  }

  const padding = 24;
  const availableH = Math.max(40, cardBox.h - padding * 2);
  const rowH = availableH / total;
  const x = cardBox.x + padding;
  const y = Math.round(cardBox.y + padding + index * rowH);
  const w = Math.max(40, cardBox.w - padding * 2);
  const h = Math.round(Math.max(20, rowH - 12));

  return { x, y, w, h };
}
