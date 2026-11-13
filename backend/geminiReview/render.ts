/**
 * File Description: Renders a film package to videos/<slug>/renders/<format>.mp4 through the Remotion CLI, so the
 * review tools (`aideos all-check`) can watch the current cut of a film.
 * Inputs and outputs: video slug and aspect ratio -> rendered MP4 video under videos/<slug>/renders/.
 * Used by: backend/allCheck/round.ts.
 */

import path from "node:path";
import { writeDescriptionCredits } from "../masterAudio";
import { readFilm } from "../pipeline/filmStore";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { reelForRender } from "../reelCut/store";
import { assertDeliverable } from "../deliveryGate";
import { createRenderJob } from "../renderJob";
import { createRemotionRenderer, type RemotionRendererDeps } from "../remotionRenderer";

// Refuses a film that would be delivered without music, sound effects or the end card; an all-check render becomes the final video, so it is held to the same rule as any delivery.
export function assertSlugDeliverable(slug: string, format: "long" | "reel"): void {
  const film = format === "reel" ? reelForRender(slug) : readFilm(slug);
  if (film) assertDeliverable([{ film, format }]);
}

// Renders the video for a given slug using Remotion CLI.
export async function renderVideoForSlug(slug: string, format: "long" | "reel" = "long", deps: RemotionRendererDeps = {}): Promise<string> {
  const film = format === "reel" ? reelForRender(slug) : readFilm(slug);
  const pkgDir = resolvePackageDir(slug);
  const rendersDir = path.join(pkgDir, "renders");
  const outPath = path.join(rendersDir, `${format}.mp4`);
  if (!film) throw new Error(`No film found for "${slug}"`);
  await createRenderJob({ film, format, outPath, profile: "review" }, createRemotionRenderer({ caller: "review" }, deps)).run();
  writeDescriptionCredits(rendersDir, [film]);
  return outPath;
}
