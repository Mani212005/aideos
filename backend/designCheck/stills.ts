/**
 * File Description: Review stills for the design check.
 * Points the Remotion bundle at a film, renders one wide-cut still just past the middle of every
 * shot plus the reel at the first, middle and last shots, then restores whichever film was active,
 * so checking a design never changes what the studio or the CLI renders by default.
 */

import path from "node:path";
import fs from "node:fs";
import { parseFilm } from "../../src/dl/schema";
import { readActiveFilmSource, restoreActiveFilmSource, setActiveFilm } from "../pipeline/filmStore";
import { midShotPicks, renderReviewStills, FPS, type StillPick } from "../sceneKit";

const REPO_ROOT = path.resolve(__dirname, "../..");

// Renders a film's review stills into .frames/<id>/ and returns that directory.
export async function renderFilmReviewStills(filmId: string, scale = 0.5): Promise<string> {
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "videos", filmId, "film.json"), "utf8")));
  const fps = film.fps ?? FPS;
  const spans = new Map<string, { from: number; to: number }>();
  let cursor = 0;
  for (const shot of film.shots) {
    const to = Math.round(cursor + shot.dur * fps);
    spans.set(shot.id, { from: cursor, to });
    cursor = to;
  }
  const picks: StillPick[] = midShotPicks(spans, "Long");
  const ids = [...spans.keys()];
  const reelIds = [...new Set([ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]])];
  reelIds.forEach((id, i) => {
    const span = spans.get(id)!;
    picks.push({ composition: "Reel", frame: Math.round(span.from + (span.to - span.from) * 0.55), name: `reel-${i + 1}-${id}` });
  });

  const previous = readActiveFilmSource();
  setActiveFilm(filmId);
  try {
    return await renderReviewStills(picks, path.join(REPO_ROOT, ".frames", filmId), scale);
  } finally {
    restoreActiveFilmSource(previous);
  }
}
