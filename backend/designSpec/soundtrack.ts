/**
 * File Description: Resolves authored design spec soundtrack cues into format-specific film.soundtrack manifests.
 * Inputs and outputs: SpecSoundtrack, visual cues, Film and format -> resolved Soundtrack data.
 * Used by: backend/designSpec/compile.ts, backend/designSpec/build.ts, backend/reelCut/build.ts.
 */

import { computeFileSha256, getDefaultLibraryPath, loadAudioLibrary } from "../audioLibrary/library";
import { deliveryTimeline } from "../../src/dl/delivery";
import { FPS, type Cues } from "../sceneKit";
import { resolveCue } from "./cues";
import type { SpecSoundtrack } from "./spec";
import { soundtrackMixDefault, type Film, type Soundtrack, type SoundtrackSection, type SoundtrackSfx } from "../../src/dl/schema";

export interface VisualEvent {
  frame: number;
  type: string;
}

// Collects all key visual event frames from a film to anchor sound effects.
export function getVisualEventFrames(film: Film): VisualEvent[] {
  const fps = film.fps ?? FPS;
  const events: VisualEvent[] = [];
  let cursorSec = 0;

  film.shots.forEach((shot, index) => {
    const startFrame = Math.round(cursorSec * fps);
    const endFrame = Math.round((cursorSec + shot.dur) * fps);

    events.push({ frame: startFrame, type: "shot-boundary" });
    events.push({ frame: endFrame, type: "shot-boundary" });

    const isChapterCut = index === 0 || shot.move === "cut" || (index > 0 && shot.ch !== film.shots[index - 1].ch);
    if (isChapterCut) {
      events.push({ frame: startFrame, type: "chapter-cut" });
    }

    if (shot.blocks) {
      for (const block of shot.blocks) {
        if (block.c === "StatCounter") {
          events.push({ frame: startFrame, type: "counter-start" });
          events.push({ frame: startFrame + Math.round(0.9 * fps), type: "counter-end" });
        } else if (block.c === "TextReveal" || block.c === "Card" || block.c === "Body") {
          events.push({ frame: startFrame, type: "text-card" });
        }
      }
    }

    cursorSec += shot.dur;
  });

  const storyFrames = Math.round(cursorSec * fps);
  events.push({ frame: storyFrames, type: "end-card" });

  if (film.scene) {
    if (film.scene.camera?.keyframes) {
      for (const kf of film.scene.camera.keyframes) {
        events.push({ frame: kf.frame, type: "camera-pose" });
      }
    }
    if (film.scene.props) {
      for (const prop of film.scene.props) {
        if (prop.animation?.clips) {
          for (const clip of prop.animation.clips) {
            events.push({ frame: clip.startFrame, type: "scene-clip" });
          }
        }
      }
    }
  }

  return events;
}

// Determines the closest on-screen event type for a sound effect at a given time.
export function detectVisualEvent(film: Film, timeSec: number, fps: number): string {
  const frame = Math.round(timeSec * fps);
  const events = getVisualEventFrames(film);
  const matching = events.filter((e) => Math.abs(e.frame - frame) <= 2);
  if (matching.length === 0) return "visual-event";

  const priorityOrder = ["end-card", "chapter-cut", "counter-end", "counter-start", "camera-pose", "scene-clip", "text-card", "shot-boundary"];
  for (const prio of priorityOrder) {
    if (matching.some((m) => m.type === prio)) return prio;
  }
  return matching[0].type;
}

// Returns the family name of a sound effect from its item id.
export function effectFamily(itemId: string): string {
  if (itemId.startsWith("whoosh") || itemId.startsWith("swoosh") || itemId.startsWith("sweep")) return "transition";
  if (itemId.startsWith("zoom")) return "zoom";
  if (itemId.startsWith("tick") || itemId.startsWith("counter")) return "counter";
  if (itemId.startsWith("pop") || itemId.startsWith("card")) return "card";
  if (itemId.startsWith("ui") || itemId === "click" || itemId === "confirm") return "ui";
  if (itemId.startsWith("hit") || itemId.startsWith("reveal") || itemId.startsWith("riser")) return "impact";
  if (itemId.startsWith("glitch") || itemId === "error") return "error";
  if (itemId.startsWith("typing")) return "typing";
  return itemId.split("-")[0];
}

// Resolves authored cues in design.json into format-specific film.soundtrack data.
export function resolveSoundtrack(
  specSoundtrack: SpecSoundtrack,
  cues: Cues,
  film: Film,
  format: "long" | "reel" = "long",
): Soundtrack {
  const fps = film.fps ?? FPS;
  const delivery = deliveryTimeline(film, format);
  const storySec = delivery.storyFrames / fps;
  const totalSec = delivery.totalFrames / fps;
  const defaultCrossfadeSec = format === "reel" ? 1.5 : 3;

  const library = loadAudioLibrary();
  let libraryHash: string | undefined;
  try {
    libraryHash = computeFileSha256(getDefaultLibraryPath());
  } catch {
    libraryHash = undefined;
  }

  const sections: SoundtrackSection[] = specSoundtrack.sections.map((section, index) => {
    const item = library.items.find((candidate) => candidate.id === section.item);
    const from = Number((resolveCue(section.start, cues) / fps).toFixed(3));
    let to = Number((resolveCue(section.end, cues) / fps).toFixed(3));

    const isLastSection = index === specSoundtrack.sections.length - 1;
    const isEndCue = typeof section.end === "string" && section.end.trim() === "end";
    if (isLastSection || isEndCue || Math.abs(to - storySec) < 0.05) {
      to = Number(totalSec.toFixed(3));
    }

    let offsetSec = 0;
    if (section.offsetSec !== undefined) {
      offsetSec = section.offsetSec;
    } else if (isLastSection || section.role === "outro") {
      const sectionLength = to - from;
      const trackLength = item ? item.durationSec : 0;
      offsetSec = trackLength >= sectionLength ? Number((trackLength - sectionLength).toFixed(3)) : 0;
    }

    return {
      role: section.role,
      item: section.item,
      sha256: item?.sha256,
      from,
      to,
      offsetSec,
      crossfadeSec: defaultCrossfadeSec,
      volume: section.volume ?? 1,
      duckUnderVoiceover: true,
    };
  });

  const sfx: SoundtrackSfx[] = specSoundtrack.sfx.map((effect) => {
    const item = library.items.find((candidate) => candidate.id === effect.item);
    const timeSec = Number((resolveCue(effect.at, cues) / fps).toFixed(3));
    const event = effect.event ?? detectVisualEvent(film, timeSec, fps);
    const gainDb = effect.gainDb ?? 0;

    return {
      item: effect.item,
      sha256: item?.sha256,
      timeSec,
      gainDb,
      event,
      volume: effect.volume ?? 1,
    };
  });

  const credits: string[] = [];
  const seenItems = new Set<string>();
  for (const entry of [...specSoundtrack.sections.map((s) => s.item), ...specSoundtrack.sfx.map((e) => e.item)]) {
    if (seenItems.has(entry)) continue;
    seenItems.add(entry);
    const item = library.items.find((candidate) => candidate.id === entry);
    if (item?.licence.attribution) {
      credits.push(item.licence.attribution);
    }
  }

  return {
    ...(libraryHash ? { library: libraryHash } : {}),
    sections,
    speech: film.soundtrack?.speech ?? [],
    speechSource: film.soundtrack?.speechSource,
    narrationPeakDb: film.soundtrack?.narrationPeakDb,
    mix: film.soundtrack?.mix ?? soundtrackMixDefault,
    sfx,
    credits,
  };
}
