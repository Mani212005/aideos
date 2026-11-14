/**
 * File Description: Renders a film package to videos/<slug>/renders/<format>.mp4 with the review profile, so the
 * review tools (`aideos all-check`) can watch the current cut of a film. The native renderer draws the film when it
 * can (hardware encode where the machine has one); Remotion renders it otherwise and the reason is printed.
 * Inputs and outputs: video slug, aspect ratio and a log sink -> rendered MP4 video under videos/<slug>/renders/, and one line naming the renderer that drew it.
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
import { createNativeRenderer } from "../nativeRenderer";
import { createSelectedRenderer, rendererModeFromEnv } from "../rendererSelection";

// Refuses a film that would be delivered without music, sound effects or the end card; an all-check render becomes the final video, so it is held to the same rule as any delivery.
export function assertSlugDeliverable(slug: string, format: "long" | "reel"): void {
  const film = format === "reel" ? reelForRender(slug) : readFilm(slug);
  if (film) assertDeliverable([{ film, format }]);
}

// Renders the video for a given slug with the review profile, natively when the film allows it.
export async function renderVideoForSlug(
  slug: string,
  format: "long" | "reel" = "long",
  deps: RemotionRendererDeps = {},
  onLog: (message: string) => void = (message) => console.error(`[review render] ${message}`),
): Promise<string> {
  const film = format === "reel" ? reelForRender(slug) : readFilm(slug);
  const pkgDir = resolvePackageDir(slug);
  const rendersDir = path.join(pkgDir, "renders");
  const outPath = path.join(rendersDir, `${format}.mp4`);
  if (!film) throw new Error(`No film found for "${slug}"`);
  const renderer = createSelectedRenderer({
    mode: rendererModeFromEnv(),
    remotion: () => createRemotionRenderer({ caller: "review" }, deps),
    native: () => createNativeRenderer(),
    onChoice: (_choice, message) => onLog(message),
  });
  await createRenderJob({ film, format, outPath, profile: "review" }, renderer).run();
  writeDescriptionCredits(rendersDir, [film]);
  return outPath;
}
