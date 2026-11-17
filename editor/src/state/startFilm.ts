/**
 * File Description: Start a film from one story. It names the film from the first words of the story, makes an id that no other film uses, and asks the dev server to create the film and compile its first cut. The server contract is /api/projects/new, unchanged; theme and voice are no longer asked here (Look sets the accent, Words records the voice).
 * Inputs and outputs: the story text and the film ids that exist -> the new film (or an error message in words a director can act on).
 * Used by: editor/src/components/shell/StartBox.tsx.
 */

import type { Film } from "../../../src/dl/schema";

/** The most words the name of a film takes from the story. */
const TITLE_WORDS = 6;

/** The most characters in a name: the film schema limits a canvas node label to 28. */
const TITLE_CHARS = 28;

/** The first words of the story (up to 6 words and 28 characters), with section markers and punctuation at the ends removed. */
export function storyTitle(story: string): string {
  const line = story
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^#+\s*\w*\s*$/.test(l) && !/^\[[A-Z ]+\]$/.test(l) && !/^##\s*\d+:\d+/.test(l));
  const words = (line ?? "").replace(/^#+\s*/, "").replace(/^\[[A-Z ]+\]\s*/, "").split(/\s+/).filter(Boolean);
  let title = "";
  for (const word of words.slice(0, TITLE_WORDS)) {
    const next = title ? `${title} ${word}` : word;
    if (next.length > TITLE_CHARS) {
      if (!title) title = word.slice(0, TITLE_CHARS);
      break;
    }
    title = next;
  }
  return title.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** A lowercase id of letters, digits and dashes from a title, with a number added when another film has it. */
export function uniqueFilmId(title: string, taken: readonly string[]): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "film";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Creates a film from the story on the dev server and returns it. Throws an Error with a short message on failure. */
export async function startFilm(story: string, taken: readonly string[]): Promise<Film> {
  const text = story.trim();
  if (!text) throw new Error("Add a story.");
  const title = storyTitle(text) || "Film";
  const id = uniqueFilmId(title, taken);
  let res: Response;
  try {
    res = await fetch("/api/projects/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, id, script: text, autoCompile: true }),
    });
  } catch {
    throw new Error("No answer from the server.");
  }
  const data = (await res.json().catch(() => null)) as { film?: Film; error?: string } | null;
  if (!res.ok || !data?.film) throw new Error(data?.error ?? `Start failed (${res.status}).`);
  return data.film;
}
