/**
 * File Description: Renumbers a cut reel's chapter rail so it names only the chapters whose shots the reel kept.
 * Inputs and outputs: long film, reel film with kept shots -> reel film with its own chapters and chapter cuts.
 * Used by: backend/reelCut/build.ts (compileReel).
 */
import type { Film } from "../../src/dl/schema";
import { buildTimeline } from "../../src/dl/camera";

/**
 * Re-derives the reel's chapter rail from the shots it kept.
 *
 * The rail counts chapters by `move: "cut"` (src/dl/camera.ts) and reads names from `film.chapters`. A reel keeps the long's
 * chapters and each kept shot's move, so a dropped chapter-opening shot (or a whole dropped chapter) shifted every later label
 * and left chapters with no shots, which the native renderer refuses. Here each kept shot keeps the long chapter it sat in,
 * only chapters that still have shots are listed, and the first kept shot of each is the chapter cut. A kept shot that is a cut
 * but continues its chapter (the long clamped extra cuts into its last chapter) becomes a plain pan so the count stays exact.
 */
export function renumberReelChapters(long: Film, reel: Film): Film {
  if (long.chapters.length === 0 || reel.shots.length === 0) return reel;
  const lastChapter = long.chapters.length - 1;
  const longChapterOf = new Map(buildTimeline(long).map((timed) => [timed.shot.id, Math.min(timed.chapter, lastChapter)]));
  const names: string[] = [];
  let previous: number | undefined;
  const shots = reel.shots.map((shot) => {
    const chapter = longChapterOf.get(shot.id);
    if (chapter === undefined) throw new Error(`reel shot ${shot.id} is missing from the long timeline, so its chapter is unknown`);
    if (chapter !== previous) {
      previous = chapter;
      names.push(long.chapters[chapter]);
      return shot.move === "cut" ? shot : { ...shot, move: "cut" as const };
    }
    return shot.move === "cut" ? { ...shot, move: "pan" as const } : shot;
  });
  return { ...reel, chapters: names, shots };
}
