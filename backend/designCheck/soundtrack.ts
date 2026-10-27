/**
 * File Description: Checks film soundtrack sections and effects against approved Decision D6 standards.
 * Inputs and outputs: Film, DesignFinding array, and DesignCheckContext -> validated findings or failure reports.
 * Used by: backend/designCheck/designCheck.ts.
 */

import { loadAudioLibrary } from "../audioLibrary/library";
import { deliveryTimeline } from "../../src/dl/delivery";
import { buildTimeline } from "../../src/dl/camera";
import { FPS } from "../sceneKit";
import { effectFamily, getVisualEventFrames } from "../designSpec/soundtrack";
import type { Film } from "../../src/dl/schema";
import type { DesignCheckContext, DesignFinding } from "./designCheck";

// Enforces standard-layer soundtrack rules for audio library usage, timing, density, and chapter alignment (Decision D6).
export function checkSoundtrack(film: Film, findings: DesignFinding[], context: DesignCheckContext = {}): void {
  if (!film.soundtrack || (film.soundtrack.sections.length === 0 && film.soundtrack.sfx.length === 0)) {
    return;
  }

  const fps = film.fps ?? FPS;
  const format = context.formats !== undefined ? undefined :
    film.soundtrack.defaultScore?.format ?? (film.id.includes("reel") ? "reel" : "long");
  const isReel = context.formats !== undefined ? context.formats.includes("reel") : format === "reel";
  const library = context.library ?? loadAudioLibrary();

  // Rule: Reel at most 2 tracks
  if (isReel && film.soundtrack.sections.length > 2) {
    findings.push({
      rule: "soundtrack",
      severity: "error",
      where: "soundtrack.sections",
      message: `reel format has ${film.soundtrack.sections.length} tracks; at most 2 tracks allowed in reel format (Decision D3).`,
    });
  }

  // Chapter cut times for validating section boundaries
  const chapterCuts: number[] = [0];
  const timeline = buildTimeline(film);
  timeline.forEach(({ shot, from }, index) => {
    if (index > 0 && shot.ch && shot.ch !== timeline[index - 1].shot.ch) {
      chapterCuts.push(from / fps);
    }
  });

  const expectedCrossfade = isReel ? 1.5 : 3;
  const orderedSections = [...film.soundtrack.sections].sort((a, b) => a.from - b.from);
  const delivery = deliveryTimeline(film, isReel ? "reel" : "long");
  const totalSec = delivery.totalFrames / fps;
  const boundaryTolerance = 0.001;
  if (orderedSections.length > 0) {
    if (Math.abs(orderedSections[0].from) > boundaryTolerance) {
      findings.push({ rule: "soundtrack", severity: "error", where: "soundtrack.sections", message: "soundtrack sections must cover the opening from 0s." });
    }
    for (let i = 0; i < orderedSections.length - 1; i++) {
      if (Math.abs(orderedSections[i].to - orderedSections[i + 1].from) > boundaryTolerance) {
        findings.push({ rule: "soundtrack", severity: "error", where: "soundtrack.sections", message: `soundtrack sections must meet without gaps or overlaps between ${orderedSections[i].item} and ${orderedSections[i + 1].item}.` });
      }
    }
    if (Math.abs(orderedSections[orderedSections.length - 1].to - totalSec) > boundaryTolerance) {
      findings.push({ rule: "soundtrack", severity: "error", where: "soundtrack.sections", message: `soundtrack sections must cover the ending through ${totalSec.toFixed(2)}s.` });
    }
  }

  for (const section of film.soundtrack.sections) {
    const item = library.items.find((candidate) => candidate.id === section.item);

    // Rule: Item exists in library
    if (!item) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: `soundtrack.sections.${section.item}`,
        message: `track "${section.item}" does not exist in the audio library.`,
      });
      continue;
    }

    if (item.kind !== "music") {
      findings.push({ rule: "soundtrack", severity: "error", where: `soundtrack.sections.${section.item}`, message: `item "${section.item}" is a sound effect, not a music track.` });
      continue;
    }

    // Rule: Licence allows monetized use without credit
    if (item.licence.attribution !== null) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: `soundtrack.sections.${section.item}`,
        message: `track "${section.item}" requires credit attribution, which is not permitted under Decision D2 (no credit-required music).`,
      });
    }

    // Rule: Roles describe both the library item and the section's actual story position.
    if (!item.roles.includes(section.role)) {
      findings.push({ rule: "soundtrack", severity: "error", where: `soundtrack.sections.${section.item}`, message: `track "${section.item}" does not support role "${section.role}"; supported roles: ${item.roles.join(", ")}.` });
    }
    const lastChapter = chapterCuts[chapterCuts.length - 1];
    const closingRole = section.role === "payoff" || section.role === "outro";
    const misplaced = (section.role === "hook" && section.from > boundaryTolerance) ||
      (closingRole && ((chapterCuts.length > 1 && section.from <= boundaryTolerance) || section.from > lastChapter + boundaryTolerance || Math.abs(section.to - totalSec) > boundaryTolerance)) ||
      (section.role === "reel" && (!isReel || orderedSections.length !== 1));
    if (misplaced) {
      findings.push({ rule: "soundtrack", severity: "error", where: `soundtrack.sections.${section.item}`, message: `role "${section.role}" does not match its story position: hook opens the film, payoff/outro covers the last chapter and end card, and a reel bed spans the reel.` });
    }

    // Rule: The full frame-rounded source span needed by the mixer must be available.
    const duration = section.to - section.from;
    const orderedIndex = orderedSections.indexOf(section);
    const last = orderedIndex === orderedSections.length - 1;
    const fadeFrames = Math.round(expectedCrossfade * fps);
    const fadeIn = orderedIndex > 0 && Math.abs(orderedSections[orderedIndex - 1].to - section.from) < 1 / fps ? fadeFrames : 0;
    const fadeOut = !last && Math.abs(section.to - orderedSections[orderedIndex + 1].from) < 1 / fps ? fadeFrames : 0;
    const fromFrame = Math.max(0, Math.round(section.from * fps) - Math.ceil(fadeIn / 2));
    const toFrame = last && section.to >= delivery.storyFrames / fps - 1 / fps ? delivery.totalFrames :
      Math.min(delivery.totalFrames, Math.round(section.to * fps) + Math.ceil(fadeOut / 2));
    const spanFrames = toFrame - fromFrame;
    const trackFrames = Math.floor(item.durationSec * fps);
    const trimBefore = last ? Math.max(0, trackFrames - spanFrames) : Math.round(section.offsetSec * fps);
    // The mixer back-times the final section from the source ending and ignores its stored offset.
    const offsetSec = last ? 0 : section.offsetSec;
    const totalRun = Math.max((spanFrames + trimBefore) / fps, duration + offsetSec);
    if (spanFrames + trimBefore > trackFrames || totalRun > item.durationSec + 0.001) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: `soundtrack.sections.${section.item}`,
        message: `section "${section.item}" runs ${duration.toFixed(1)}s (offset ${offsetSec.toFixed(1)}s, total ${totalRun.toFixed(1)}s), exceeding track length ${item.durationSec.toFixed(1)}s; no silent looping allowed.`,
      });
    }
    if (fadeIn + fadeOut > spanFrames) {
      findings.push({ rule: "soundtrack", severity: "error", where: `soundtrack.sections.${section.item}`, message: `section "${section.item}" is too short for its crossfades; choose a longer story act.` });
    }

    // Rule: High-LRA tracks only in payoff or outro sections
    if (item.loudness.lra > 10 && section.role !== "payoff" && section.role !== "outro") {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: `soundtrack.sections.${section.item}`,
        message: `track "${section.item}" has high loudness range (LRA ${item.loudness.lra} > 10) and is only allowed in payoff or outro sections, not in "${section.role}".`,
      });
    }

    // Rule: Crossfade lengths per format
    if (film.soundtrack.sections.length > 1) {
      if (Math.abs(section.crossfadeSec - expectedCrossfade) > 0.05) {
        findings.push({
          rule: "soundtrack",
          severity: "error",
          where: `soundtrack.sections.${section.item}`,
          message: `section "${section.item}" crossfade length is ${section.crossfadeSec}s; expected ${expectedCrossfade}s on ${isReel ? "reel" : "long"} format.`,
        });
      }
      if (duration < section.crossfadeSec) {
        findings.push({
          rule: "soundtrack",
          severity: "error",
          where: `soundtrack.sections.${section.item}`,
          message: `section "${section.item}" duration ${duration.toFixed(1)}s is shorter than crossfade length ${section.crossfadeSec}s.`,
        });
      }
    }

    // Rule: Section changes only at chapter cuts
    if (section.from > 0.01) {
      const landsOnChapterCut = chapterCuts.some((cut) => Math.abs(cut - section.from) <= 2 / fps + 0.05);
      if (!landsOnChapterCut) {
        findings.push({
          rule: "soundtrack",
          severity: "error",
          where: `soundtrack.sections.${section.item}`,
          message: `section "${section.item}" changes at ${section.from.toFixed(2)}s, which is not a chapter cut; section changes are only allowed at chapter cuts.`,
        });
      }
    }
  }

  // Sound effects checks
  const visualEvents = getVisualEventFrames(film);

  for (const effect of film.soundtrack.sfx) {
    const item = library.items.find((candidate) => candidate.id === effect.item);

    // Rule: Sfx item exists in library
    if (!item) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: `soundtrack.sfx.${effect.item}`,
        message: `sound effect "${effect.item}" does not exist in the audio library.`,
      });
      continue;
    }

    if (item.kind !== "sfx") {
      findings.push({ rule: "soundtrack", severity: "error", where: `soundtrack.sfx.${effect.item}`, message: `item "${effect.item}" is a music track, not a sound effect.` });
      continue;
    }

    // Rule: Sfx licence allows monetized use without credit
    if (item.licence.attribution !== null) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: `soundtrack.sfx.${effect.item}`,
        message: `sound effect "${effect.item}" requires credit attribution, which is not permitted under Decision D2.`,
      });
    }

    // Rule: Every effect lands within plus or minus 2 frames of a real visual event
    const effectFrame = Math.round(effect.timeSec * fps);
    const matchingEvents = visualEvents.filter((ev) => Math.abs(ev.frame - effectFrame) <= 2);
    if (matchingEvents.length === 0) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: `soundtrack.sfx.${effect.item}`,
        message: `sound effect "${effect.item}" at ${effect.timeSec.toFixed(2)}s (frame ${effectFrame}) does not land within +/- 2 frames of a real visual event.`,
      });
    } else if (effect.event && !matchingEvents.some((ev) => ev.type === effect.event)) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: `soundtrack.sfx.${effect.item}`,
        message: `sound effect "${effect.item}" is labeled "${effect.event}" but no matching visual event occurs within +/- 2 frames.`,
      });
    }
  }

  // Density caps checks
  const sfxCount = film.soundtrack.sfx.length;
  if (sfxCount > 0) {
    const minInterval = isReel ? 5 : 8;
    const averageInterval = totalSec / sfxCount;

    if (averageInterval < minInterval - 1e-4) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: "soundtrack.sfx",
        message: `sound effect density too high: average interval is ${averageInterval.toFixed(1)}s per effect (${sfxCount} effects in ${totalSec.toFixed(1)}s), exceeding limit of at most one effect per ${minInterval}s on ${isReel ? "reel" : "long"} format.`,
      });
    }

    // Rule: Never two within 0.5s except a tick run
    const sortedSfx = [...film.soundtrack.sfx].sort((a, b) => a.timeSec - b.timeSec);
    for (let i = 0; i < sortedSfx.length - 1; i++) {
      const gap = sortedSfx[i + 1].timeSec - sortedSfx[i].timeSec;
      if (gap < 0.5 - 1e-4) {
        const isTickRun = sortedSfx[i].item === "tick" && sortedSfx[i + 1].item === "tick";
        if (!isTickRun) {
          findings.push({
            rule: "soundtrack",
            severity: "error",
            where: `soundtrack.sfx.${sortedSfx[i + 1].item}`,
            message: `sound effects "${sortedSfx[i].item}" and "${sortedSfx[i + 1].item}" occur within ${gap.toFixed(2)}s; never two effects within 0.5s except a tick run.`,
          });
        }
      }
    }

    // Rule: At most about 4 effect families per film
    const families = new Set(film.soundtrack.sfx.map((s) => effectFamily(s.item)));
    if (families.size > 4) {
      findings.push({
        rule: "soundtrack",
        severity: "error",
        where: "soundtrack.sfx",
        message: `film uses ${families.size} sound effect families (${[...families].join(", ")}), exceeding cap of at most 4 effect families per film.`,
      });
    }
  }
}
