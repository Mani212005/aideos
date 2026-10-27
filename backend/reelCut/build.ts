/**
 * File Description: Builds a separate reel narration and retimes the shared picture with checked shot drops.
 * Inputs and outputs: long package and checked cut -> reel narration, derived film, design findings and build status.
 * Used by: the production reel stage and aideos reel build.
 */
import fs from "node:fs";
import path from "node:path";
import { parseFilm, type Film } from "../../src/dl/schema";
import { carryCaptionPlacement } from "../../src/dl/captionPlacement";
import { deliveryTimeline, DELIVERY_CONFIG } from "../../src/dl/delivery";
import { produceAudioPipeline, type ProduceAudioResult } from "../audio";
import { readNarrationVoice, type LineSynthesizer } from "../endCard/voice";
import { checkFilmDesign, type DesignFinding } from "../designCheck/designCheck";
import { checkDesignAgainstLook, resolveDesignCharacters } from "../designSpec/build";
import { compileDesign, narrationTimingForFilm, type TimedWord } from "../designSpec/compile";
import { resolveCue } from "../designSpec/cues";
import { resolveSoundtrack } from "../designSpec/soundtrack";
import { prepareDefaultSoundtrack, scoreDefaultSoundtrack } from "../defaultSoundtrack";
import { designSpecSchema, type DesignSpec } from "../designSpec/spec";
import { lookPlanSchema, type LookPlan } from "../lookPlan/schema";
import { createCues } from "../sceneKit/timing";
import { ProductionError } from "../pipeline/types";
import { loadReelContext, readReelCut, reelPackageDir } from "./brief";
import { checkReelCut, formatReelReport } from "./check";
import { reelCutSchema, type ReelCut } from "./schema";
import { assertReelCap, reelBudgetFor, reelSourceFingerprint, writeReelFilm } from "./store";

export interface ReelBuildStatus {
  state: "passed" | "failed";
  mode: "identity" | "cut";
  fingerprint: string;
  at: string;
  measuredSec?: number;
  errors: string[];
  findings: DesignFinding[];
}

// Records the build outcome so a failed or stale reel can never be rendered as a passing one.
export function recordReelStatus(slug: string, status: ReelBuildStatus): ReelBuildStatus {
  const dir = path.join(reelPackageDir(slug), "reel");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status, null, 2) + "\n");
  return status;
}

// Carries only kept owner placements, leaving dropped-shot exceptions on the authoritative long film.
export function compileReel(input: {
  long: Film; base: Film; cut: ReelCut; narration: ProduceAudioResult;
  spec?: DesignSpec; look?: LookPlan; pkg: string;
}): { film?: Film; errors: string[]; findings: DesignFinding[] } {
  const { long, base, cut, narration, spec, look, pkg } = input;
  const kept = cut.shots.flatMap((entry) => "drop" in entry ? [] : [entry]);
  const keptIds = new Set(kept.map((s) => s.id));
  if (kept.length !== narration.shotDurations.length) throw new Error("reel narration does not cover every kept shot");
  const shots = kept.map((entry, index) => {
    const source = base.shots.find((s) => s.id === entry.id);
    const current = long.shots.find((s) => s.id === entry.id);
    if (!source || !current) throw new Error(`reel shot ${entry.id} is missing from the long or base film`);
    // Current footage is shared picture data, even when the undesigned base predates assembly.
    const footage = current.blocks.filter((block) => block.c === "AnalogyInset" && block.src);
    return { ...source, dur: narration.shotDurations[index], start: undefined, end: undefined, position: undefined, startSec: undefined, scriptText: entry.narration,
      ...(footage.length ? { blocks: [...source.blocks.filter((b) => b.c !== "AnalogyInset"), ...footage] } : {}) };
  });
  let reel = carryCaptionPlacement({ ...long, shots: long.shots.filter((s) => keptIds.has(s.id)) }, {
    ...base, shots, captions: long.captions === "off" ? "off" : narration.captionsVttContent,
    voiceover: { volume: long.voiceover?.volume ?? 1, speed: long.voiceover?.speed, src: `videos/${long.id}/reel/voiceover.wav`, durationSec: narration.totalAudioDuration },
    endCardVoice: long.endCardVoice,
    soundtrack: long.soundtrack,
    music: long.music,
  }, { owner: false });
  const collapsed = new Map<string, number>();
  let seconds = 0;
  for (const entry of cut.shots) {
    if ("drop" in entry) collapsed.set(entry.id, Math.round(seconds * long.fps));
    else seconds += shots.find((s) => s.id === entry.id)!.dur;
  }
  const words: TimedWord[] = narration.words;
  let collapsedClips: NonNullable<ReturnType<typeof compileDesign>["collapsedClips"]> = [];
  if (long.scene) {
    if (!spec) return { errors: ["scene reel needs the shared design/design.json to re-resolve its narration cues"], findings: [] };
    const resolved = resolveDesignCharacters(spec, pkg);
    if (resolved.errors.length) return { errors: resolved.errors, findings: [] };
    const compiled = compileDesign(reel, spec, words, long.design?.source === "server-model" ? "server-model" : "agent", { characters: resolved.characters, collapsed, format: "reel" });
    if (!compiled.film) return { errors: compiled.errors, findings: [] };
    reel = compiled.film;
    collapsedClips = compiled.collapsedClips ?? [];
    // Shared shot overrides must retain footage already assembled onto the long film.
    reel = { ...reel, shots: reel.shots.map((shot) => {
      const footage = long.shots.find((s) => s.id === shot.id)?.blocks.filter((b) => b.c === "AnalogyInset" && b.src) ?? [];
      return footage.length ? { ...shot, blocks: [...shot.blocks.filter((b) => b.c !== "AnalogyInset"), ...footage] } : shot;
    }) };
    if (look) {
      const errors = checkDesignAgainstLook(reel, spec, words, pkg, look, { collapsed });
      if (errors.length) return { errors, findings: [] };
    }
  } else if (spec?.soundtrack) {
    const cues = createCues(narrationTimingForFilm(reel, words), reel.fps, { collapsed });
    reel = { ...reel, soundtrack: resolveSoundtrack(spec.soundtrack, cues, reel, "reel") };
  }
  reel = scoreDefaultSoundtrack(reel, "reel");
  const cues = createCues(narrationTimingForFilm(reel, words), reel.fps, { collapsed });
  const authored = spec?.camera?.map((pose) => ({ frame: resolveCue(pose.at, cues), focus: pose.focus })) ?? [];
  const cameraTargets = (look?.film.camera ?? []).map((pose) => {
    const frame = resolveCue(pose.at, cues);
    const closest = authored.reduce<typeof authored[number] | undefined>((best, candidate) =>
      !best || Math.abs(candidate.frame - frame) < Math.abs(best.frame - frame) ? candidate : best, undefined);
    return { frame, focus: pose.focus, authoredFocus: closest?.focus };
  });
  const activeLook = look?.schema === "aideos.look/2"
    ? { ...look, shots: look.shots.filter((s) => keptIds.has(s.id)) }
    : look ? { ...look, shots: look.shots.filter((s) => keptIds.has(s.id)) } : undefined;
  const report = checkFilmDesign(reel, { formats: ["reel"], collapsedClips, cameraTargets, lookPlan: activeLook });
  return { film: report.ok ? reel : undefined, errors: [], findings: report.findings };
}

// Validates, narrates with the long's recorded voice, compiles and measures one candidate without trimming.
export async function buildReel(slug: string, options: { synthesize?: LineSynthesizer; onProgress?: (message: string) => void } = {}): Promise<Film> {
  const pkg = reelPackageDir(slug);
  const long = parseFilm(JSON.parse(fs.readFileSync(path.join(pkg, "film.json"), "utf8")));
  const delivered = deliveryTimeline(long, "reel");
  const mode = delivered.totalFrames / long.fps <= DELIVERY_CONFIG.reel.maxSec ? "identity" : "cut";
  const status: ReelBuildStatus = { state: "failed", mode, fingerprint: reelSourceFingerprint(slug), at: new Date().toISOString(), errors: [], findings: [] };
  try {
    if (mode === "identity") {
      let reelFilm = long;
      const specFile = path.join(pkg, "design/design.json");
      if (fs.existsSync(specFile)) {
        try {
          const spec = designSpecSchema.parse(JSON.parse(fs.readFileSync(specFile, "utf8")));
          if (spec.soundtrack) {
            const wordsFile = path.join(pkg, "voiceover_words.json");
            const words: TimedWord[] = fs.existsSync(wordsFile) ? (JSON.parse(fs.readFileSync(wordsFile, "utf8")).words ?? []) : [];
            const cues = createCues(narrationTimingForFilm(long, words), long.fps);
            reelFilm = { ...long, soundtrack: resolveSoundtrack(spec.soundtrack, cues, long, "reel") };
          }
        } catch {
          // Keep long soundtrack fallback on read/parse error
        }
      }
      const film = writeReelFilm(slug, await prepareDefaultSoundtrack(reelFilm, "reel"));
      recordReelStatus(slug, { ...status, state: "passed", measuredSec: delivered.totalFrames / long.fps });
      return film;
    }
    const raw = readReelCut(slug);
    const report = checkReelCut(raw, loadReelContext(slug), reelBudgetFor(long));
    if (!report.ok) throw new Error(formatReelReport(report));
    const cut = reelCutSchema.parse(raw);
    const voice = readNarrationVoice(pkg);
    if (!voice) throw new Error("the long narration's voice and speed are unknown; regenerate the long narration before building its reel");
    const script = cut.shots.flatMap((entry) => "drop" in entry ? [] : [`## ${entry.id}\n[NARRATION]\n${entry.narration}\n`]).join("\n");
    options.onProgress?.("narrating the reel in the long cut's voice and speed");
    const dir = path.join(pkg, "reel");
    fs.mkdirSync(dir, { recursive: true });
    const narration = await (options.synthesize ?? produceAudioPipeline)(script, dir, {
      backend: voice.backend, ...(voice.voice ? { voice: voice.voice } : {}), ...(voice.speed ? { speed: voice.speed } : {}),
    });
    fs.writeFileSync(path.join(dir, "narration.json"), JSON.stringify(narration, null, 2) + "\n");
    const measuredShots = cut.shots.flatMap((entry) => "drop" in entry ? [] : [entry]);
    assertReelCap({ ...long, scene: undefined, shots: measuredShots.map((entry, index) => ({
      ...long.shots.find((s) => s.id === entry.id)!, dur: narration.shotDurations[index], start: undefined, end: undefined, position: undefined, startSec: undefined, scriptText: entry.narration,
    })), voiceover: { volume: long.voiceover?.volume ?? 1, src: `videos/${slug}/reel/voiceover.wav`, durationSec: narration.totalAudioDuration } });
    const baseFile = path.join(pkg, "design/base-film.json");
    const base = fs.existsSync(baseFile) ? parseFilm(JSON.parse(fs.readFileSync(baseFile, "utf8"))) : long;
    const specFile = path.join(pkg, "design/design.json"), lookFile = path.join(pkg, "design/look.json");
    const compiled = compileReel({ long, base, cut, narration, pkg,
      spec: fs.existsSync(specFile) ? designSpecSchema.parse(JSON.parse(fs.readFileSync(specFile, "utf8"))) : undefined,
      look: fs.existsSync(lookFile) ? lookPlanSchema.parse(JSON.parse(fs.readFileSync(lookFile, "utf8"))) : undefined,
    });
    status.findings = compiled.findings;
    if (!compiled.film) throw new Error([...compiled.errors, ...compiled.findings.filter((f) => f.severity === "error").map((f) => `${f.rule}: ${f.where}: ${f.message}`)].join("\n"));
    assertReelCap(compiled.film);
    const film = writeReelFilm(slug, await prepareDefaultSoundtrack(compiled.film, "reel"));
    recordReelStatus(slug, { ...status, state: "passed", measuredSec: deliveryTimeline(film, "reel").totalFrames / film.fps });
    return film;
  } catch (error) {
    status.errors = [error instanceof Error ? error.message : String(error)];
    recordReelStatus(slug, status);
    throw error instanceof ProductionError ? error : new ProductionError("reel", status.errors.join("\n"), error);
  }
}
