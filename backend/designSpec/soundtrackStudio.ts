/**
 * File Description: Studio soundtrack edits through the shared authoring resolver and design rules.
 * Inputs and outputs: Film and swap or level edit -> checked, rebuilt film and synchronized design data.
 * Used by: editor/vite.config.ts and editor/src/components/SoundtrackPanel.tsx.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { filmSchema, type Film } from "../../src/dl/schema";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { fetchAudioItem, loadAudioLibrary, verifyAudioItem } from "../audioLibrary/library";
import { checkSoundtrack } from "../designCheck/soundtrack";
import type { DesignFinding } from "../designCheck/designCheck";
import { prepareSoundtrack } from "../soundtrack";
import { createCues } from "../sceneKit";
import { narrationTimingForFilm } from "./compile";
import { resolveCue } from "./cues";
import { designSpecSchema, specSoundtrackSchema, type SpecSoundtrack } from "./spec";
import { resolveSoundtrack } from "./soundtrack";

const soundtrackEditSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("swap"), section: z.number().int().min(0), item: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("level"), channel: z.enum(["music", "sfx"]), volume: z.number().min(0).max(1) }).strict(),
]);
export type SoundtrackEdit = z.infer<typeof soundtrackEditSchema>;
export const studioSoundtrackRequestSchema = z.object({ film: filmSchema, edit: soundtrackEditSchema }).strict();

// Rejects a soundtrack that violates the rules for its delivery format.
function assertSoundtrackValid(film: Film, format: "long" | "reel", library = loadAudioLibrary()): void {
  const findings: DesignFinding[] = [];
  checkSoundtrack(film, findings, { library, formats: [format] });
  const errors = findings.filter((finding) => finding.severity === "error");
  if (errors.length) throw new Error(errors.map((finding) => `${finding.rule}: ${finding.message}`).join("\n"));
}

// Rejects edits to a derived reel, whose soundtrack is rebuilt from the long design cues.
function assertLongStudioFilm(film: Film): void {
  if (film.voiceover?.src === `videos/${film.id}/reel/voiceover.wav`) {
    throw new Error("The reel soundtrack follows the Long film's design. Edit the Long film soundtrack instead.");
  }
}

// Reads the existing visual design without creating a replacement for an undesigned film.
function readStudioDesign(film: Film) {
  const file = path.join(resolvePackageDir(film.id), "design", "design.json");
  if (!fs.existsSync(file)) throw new Error("This film has no sound design yet. Add a soundtrack in Look before adjusting its mix.");
  return designSpecSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

// Uses the package's measured words when preserving phrase-bound authoring cues.
function studioCues(film: Film) {
  const file = path.join(resolvePackageDir(film.id), "voiceover_words.json");
  const words = fs.existsSync(file) ? z.object({ words: z.array(z.object({
    word: z.string(), start: z.number(), end: z.number(), punctuated_word: z.string().optional(),
  })) }).parse(JSON.parse(fs.readFileSync(file, "utf8"))).words : [];
  return createCues(narrationTimingForFilm(film, words), film.fps);
}

// Carries authored cues forward until a timeline gesture changes their resolved position.
function studioSoundtrackSpec(film: Film, previous?: SpecSoundtrack): SpecSoundtrack {
  if (!film.soundtrack) throw new Error("This film has no soundtrack yet.");
  const cues = studioCues(film);
  // Keeps an existing cue only when it still resolves to the edited frame.
  const cueAt = (cue: string | number | undefined, seconds: number): string | number => {
    const frame = Math.round(seconds * film.fps);
    if (cue !== undefined) {
      try { if (resolveCue(cue, cues) === frame) return cue; } catch { /* A removed shot becomes an absolute cue. */ }
    }
    return frame;
  };
  return specSoundtrackSchema.parse({
    sections: film.soundtrack.sections.map((section, index) => ({
      role: section.role, item: section.item,
      start: cueAt(previous?.sections[index]?.start, section.from),
      end: cueAt(previous?.sections[index]?.end, section.to),
      offsetSec: section.offsetSec, volume: section.volume ?? 1,
    })),
    sfx: film.soundtrack.sfx.map((effect, index) => ({
      item: effect.item, at: cueAt(previous?.sfx[index]?.at, effect.timeSec),
      gainDb: effect.gainDb, event: effect.event, volume: effect.volume ?? 1,
    })),
  });
}

// Saves the soundtrack authoring data with the normal owner save and Undo.
export function persistStudioSoundtrack(film: Film): void {
  assertLongStudioFilm(film);
  if (film.soundtrack) assertSoundtrackValid(film, "long");
  if (!film.soundtrack?.library && !film.soundtrack?.sections.some((s) => s.sha256) && !film.soundtrack?.sfx.some((s) => s.sha256)) return;
  const file = path.join(resolvePackageDir(film.id), "design", "design.json");
  if (!fs.existsSync(file)) return;
  const spec = readStudioDesign(film);
  const soundtrack = studioSoundtrackSpec(film, spec.soundtrack);
  if (JSON.stringify(soundtrack) === JSON.stringify(spec.soundtrack)) return;
  fs.writeFileSync(file, JSON.stringify({ ...spec, soundtrack }, null, 2) + "\n");
}

// Rebuilds only the sound design so a track swap never resets the owner's visual or timeline edits.
export async function rebuildStudioSoundtrack(film: Film, edit: SoundtrackEdit, format: "long" | "reel"): Promise<Film> {
  if (format !== "long") {
    throw new Error("The reel soundtrack follows the Long film's design and is rebuilt from it.");
  }
  assertLongStudioFilm(film);
  const spec = readStudioDesign(film);
  const authored = studioSoundtrackSpec(film, spec.soundtrack);
  const library = loadAudioLibrary();
  if (edit.kind === "swap") {
    const section = authored.sections[edit.section];
    if (!section) throw new Error("This music section no longer exists. Select it again.");
    const item = library.items.find((candidate) => candidate.id === edit.item);
    if (!item || item.kind !== "music" || !item.roles.includes(section.role)) {
      throw new Error(`Choose a music track with the ${section.role} role.`);
    }
    section.item = item.id;
    // A swap uses the new track's source, including its own ending on the last act.
    if (edit.section === authored.sections.length - 1) delete section.offsetSec;
  } else if (edit.channel === "music") {
    authored.sections = authored.sections.map((section) => ({ ...section, volume: edit.volume }));
  } else {
    authored.sfx = authored.sfx.map((effect) => ({ ...effect, volume: edit.volume }));
  }
  const cues = studioCues(film);
  const rebuilt: Film = { ...film, soundtrack: resolveSoundtrack(authored, cues, film, format) };
  assertSoundtrackValid(rebuilt, format, library);
  // Only fetch the chosen item; every other source is already part of the playing film.
  if (edit.kind === "swap") {
    const item = library.items.find((candidate) => candidate.id === edit.item);
    if (item) {
      await fetchAudioItem(item);
      const result = verifyAudioItem(item);
      if (result.status !== "valid") throw new Error(result.message ?? "This track is not available in the audio cache.");
    }
  }
  return prepareSoundtrack(rebuilt);
}
