/**
 * File Description: Persists derived reel films and resolves each delivery's film, words and source identity.
 * Inputs and outputs: package slug and derived Film -> reel manifest, generated shadow and checked delivery inputs.
 * Used by: reel build, production rendering, deterministic review, Gemini facts and all-check.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseFilm, type Film } from "../../src/dl/schema";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { DELIVERY_CONFIG, deliveryTimeline, type DeliveryConfig, type DeliveryFormat } from "../../src/dl/delivery";
import { FILMS_DIR, filmModule } from "../pipeline/generatedFiles";
import { ProductionError } from "../pipeline/types";
import { parseReelBudget, type ReelBudget } from "./schema";

// Derives the writer's card reserve from the same rounded span Remotion delivers.
export function reelBudgetFor(film: Film, config: DeliveryConfig = DELIVERY_CONFIG): ReelBudget {
  const delivery = deliveryTimeline(film, "reel", { config });
  return parseReelBudget({ ...config.reel, endCardSec: (delivery.card?.durationInFrames ?? 0) / film.fps });
}

// Hashes the source bytes and delivery settings that can change a reel's narration or picture.
export function reelSourceFingerprint(slug: string): string {
  const pkg = resolvePackageDir(slug);
  const files = ["film.json", "narration.json", "voiceover_words.json", "reel/cut.json", "design/base-film.json", "design/design.json", "design/look.json"];
  // Shared artwork can change without a manifest edit, so its bytes belong to the source identity.
  const visuals = path.join(pkg, "visuals");
  if (fs.existsSync(visuals)) files.push(...fs.readdirSync(visuals).filter((f) => f.endsWith(".svg")).sort().map((f) => `visuals/${f}`));
  const hash = createHash("sha256").update(JSON.stringify(DELIVERY_CONFIG));
  for (const file of files) {
    hash.update(file);
    const absolute = path.join(pkg, file);
    hash.update(fs.existsSync(absolute) ? fs.readFileSync(absolute) : "missing");
  }
  return hash.digest("hex");
}

// Writes only the derived reel manifest and shadow, without mutating the long owner record.
export function writeReelFilm(slug: string, film: Film): Film {
  const validated = parseFilm(film);
  if (validated.id !== slug) throw new Error(`reel film id must be ${slug}`);
  const dir = path.join(resolvePackageDir(slug), "reel");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify(validated, null, 2) + "\n");
  fs.mkdirSync(FILMS_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILMS_DIR, `${slug}.reel.ts`), filmModule(validated));
  return validated;
}

// Names each format's authoritative inputs, using the long words for an identity reel.
export function formatInputs(slug: string, format: DeliveryFormat): { film: string; words: string } {
  const pkg = resolvePackageDir(slug);
  const reelFile = path.join(pkg, "reel/film.json");
  const longFile = path.join(pkg, "film.json");
  const long = format === "reel" && fs.existsSync(reelFile) && fs.existsSync(longFile) ? parseFilm(JSON.parse(fs.readFileSync(longFile, "utf8"))) : null;
  const identity = long && deliveryTimeline(long, "reel").totalFrames / long.fps <= DELIVERY_CONFIG.reel.maxSec;
  if (format === "long" || identity || !fs.existsSync(reelFile)) {
    return { film: path.join(pkg, "film.json"), words: path.join(pkg, "voiceover_words.json") };
  }
  const film = parseFilm(JSON.parse(fs.readFileSync(reelFile, "utf8")));
  const isCut = film.voiceover?.src === `videos/${slug}/reel/voiceover.wav`;
  return { film: reelFile, words: path.join(pkg, isCut ? "reel/voiceover_words.json" : "voiceover_words.json") };
}

// Refuses an over-budget reel with measured overage and the shots a writer should shorten.
export function assertReelCap(film: Film, stage: "reel" | "render" = "reel", config: DeliveryConfig = DELIVERY_CONFIG): void {
  const delivery = deliveryTimeline(film, "reel", { config });
  const storySec = delivery.storyFrames / film.fps;
  const totalSec = delivery.totalFrames / film.fps;
  if (totalSec <= config.reel.maxSec) return;
  const longest = [...film.shots].sort((a, b) => b.dur - a.dur).slice(0, 3).map((s) => `${s.id} (${s.dur.toFixed(1)} s)`).join(", ");
  throw new ProductionError(stage, `reel runs ${totalSec.toFixed(3)} s (story ${storySec.toFixed(3)} s + end card ${(totalSec - storySec).toFixed(3)} s), ${(totalSec - config.reel.maxSec).toFixed(3)} s over the ${config.reel.maxSec.toFixed(1)} s cap; shorten ${longest}`);
}

// Checks a derived reel is current before any expensive renderer starts; short films reuse the long.
export function reelForRender(slug: string): Film {
  const pkg = resolvePackageDir(slug);
  const long = parseFilm(JSON.parse(fs.readFileSync(path.join(pkg, "film.json"), "utf8")));
  if (deliveryTimeline(long, "reel").totalFrames / long.fps <= DELIVERY_CONFIG.reel.maxSec) return long;
  const statusFile = path.join(pkg, "reel/status.json");
  const status: unknown = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, "utf8")) : null;
  if (!status || typeof status !== "object" || !("state" in status) || status.state !== "passed" ||
    !("fingerprint" in status) || status.fingerprint !== reelSourceFingerprint(slug)) {
    throw new ProductionError("render", `needs reel cut: run aideos reel build ${slug}; the derived reel is missing, failed or stale`);
  }
  const inputs = formatInputs(slug, "reel");
  const film = parseFilm(JSON.parse(fs.readFileSync(inputs.film, "utf8")));
  assertReelCap(film, "render");
  return film;
}
