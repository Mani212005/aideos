/**
 * File Description: `aideos design build` - turns videos/<id>/design/design.json into the film.
 * Reads the spec and the measured narration, compiles the scene, runs the design check, and only
 * writes film.json (through filmStore, so its shadow module lands with it) when the check passes,
 * so a broken design never replaces a working film. The first build saves the undesigned film as
 * design/base-film.json and every build starts from it. Every outcome is recorded in
 * videos/<id>/design/status.json, which is how the pipeline learns an agent has finished.
 * Inputs and outputs: film slug and design specification -> built video package with assets and film.json.
 * Used by: backend/designSpec/designer.ts.
 */

import { carryCaptionPlacement, splitCaptionDescendants } from "../../src/dl/captionPlacement";
import fs from "node:fs";
import path from "node:path";
import { parseFilm, type Film } from "../../src/dl/schema";
import { collectSvgElementIds, parseSvgDocument } from "../../src/dl/scene/svgDocument";
import { writeFilm } from "../pipeline/filmStore";
import { buildSvgSources } from "../scene/buildSvgSources";
import { checkFilmDesign, type DesignFinding, type DesignCheckContext } from "../designCheck/designCheck";
import { compileDesign, DEFAULT_BACKGROUND_FILE, narrationTimingForFilm, type DesignSource, type TimedWord } from "./compile";
import { designSpecSchema, type DesignSpec } from "./spec";
import { checkLookPlan, packageCharacterResolver, parseLookPlan, plannedCharacterId, type LookPlan } from "../lookPlan";
import { fieldIssues } from "../../src/dl/schemaIssues";
import { createCues } from "../sceneKit";
import { readVisualChoices } from "../pipeline/visualChoices";
import { performanceStartIssue, resolveCue } from "./cues";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { formatIssues } from "../../src/dl/characters/validate";
import type { CharacterSpec } from "../../src/dl/characters/schema";
import { loadCharacter } from "../characters/library";
import { resolveSoundtrack } from "./soundtrack";
import { writeReelFilm } from "../reelCut/store";


/** The outcome of one build, as written to design/status.json. */
export interface DesignBuildStatus {
  state: "passed" | "failed";
  source: DesignSource;
  at: string;
  errors: string[];
  findings: DesignFinding[];
}

/** The plain canvas-colour backdrop used when a spec names none. */
const DEFAULT_BACKGROUND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet">
  <rect id="canvas" x="-300" y="-200" width="600" height="400" fill="#0A0A0B"/>
</svg>
`;

// Returns the design folder of a film package.
export function designDir(filmId: string): string {
  return path.join(resolvePackageDir(filmId), "design");
}

// Reads a film's last build status, or null when it has never been built.
export function readDesignStatus(filmId: string): DesignBuildStatus | null {
  const file = path.join(designDir(filmId), "status.json");
  try {
    if (!fs.existsSync(file)) return null;
    const status = JSON.parse(fs.readFileSync(file, "utf8")) as DesignBuildStatus | null;
    return status && (status.state === "passed" || status.state === "failed") &&
      ["agent", "server-model", "hand-built"].includes(status.source) && typeof status.at === "string" &&
      Array.isArray(status.errors) && Array.isArray(status.findings) ? status : null;
  } catch {
    return null;
  }
}

// Reads and checks the look against the actual narrated film, including complete shot coverage.
export function readCheckedLookPlan(film: Film): { plan?: LookPlan; errors: string[]; warnings?: string[] } {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(designDir(film.id), "look.json"), "utf8"));
    const wordsFile = path.join(resolvePackageDir(film.id), "voiceover_words.json");
    const words: TimedWord[] = fs.existsSync(wordsFile) ? JSON.parse(fs.readFileSync(wordsFile, "utf8")).words ?? [] : [];
    const cues = createCues(narrationTimingForFilm(film, words), film.fps);
    const report = checkLookPlan(raw, film.id, { resolveCharacter: packageCharacterResolver(resolvePackageDir(film.id)), ...(words.length ? { cues } : {}) });
    const warnings = report.findings.filter((f) => f.severity === "warning" && (f.rule === "character" || f.rule === "timing"))
      .map((f) => `look.json ${f.where}: ${f.message}`);
    if (!report.ok) return {
      errors: report.findings.filter((f) => f.severity === "error").map((f) => `look.json ${f.where}: ${f.message}`),
      warnings,
    };
    // Character warnings (art changed since the plan) travel with the plan; the rest are pre-design "not checked yet" notes.
    const plan = parseLookPlan(raw);
    const errors: string[] = [];
    const ids = new Set(film.shots.map((s) => s.id));
    for (const shot of film.shots) {
      if (!plan.shots.some((s) => s.id === shot.id)) errors.push(`look.json missing treatment for shot "${shot.id}"`);
    }
    for (const shot of plan.shots) {
      if (!ids.has(shot.id)) errors.push(`look.json names unknown shot "${shot.id}"`);
    }
    for (const item of plan.film.cast) {
      for (const at of [item.enters, ...item.changes.map((c) => c.at)]) {
        if (!ids.has(at)) errors.push(`look.json cast "${item.id}" names unknown shot "${at}"`);
      }
    }
    for (const pose of plan.film.camera) {
      try { resolveCue(pose.at, cues); }
      catch (err) { errors.push(`look.json camera: ${err instanceof Error ? err.message : String(err)}`); }
    }
    return errors.length ? { errors } : { plan, errors, warnings };
  } catch (err) {
    return { errors: [`look.json: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

// Resolves every character a design names to a verified spec, package characters first, then the library.
export function resolveDesignCharacters(spec: DesignSpec, pkg: string): { characters: Record<string, CharacterSpec>; errors: string[] } {
  const characters: Record<string, CharacterSpec> = {}, errors: string[] = [];
  for (const a of spec.assets) {
    if (!("kind" in a) || a.kind !== "character" || Object.prototype.hasOwnProperty.call(characters, a.character)) continue;
    const loaded = loadCharacter(a.character, pkg);
    if (loaded.spec && !loaded.errors.length) characters[a.character] = loaded.spec;
    else errors.push(...formatIssues(loaded.errors, `asset "${a.id}" character ${a.character} (${path.relative(pkg, loaded.file).startsWith("..") ? loaded.file : path.relative(pkg, loaded.file)}) `));
  }
  return { characters, errors };
}

// Checks the design's cast, carried motion, device overrides and camera against its look plan.
export function checkDesignAgainstLook(film: Film, spec: DesignSpec, words: TimedWord[], pkg: string, plan: LookPlan, options: { collapsed?: ReadonlyMap<string, number> } = {}): string[] {
  const errors: string[] = [];
  const idsByAsset = new Map<string, string[]>(spec.assets.map((a): [string, string[]] => [a.id,
    "file" in a ? collectSvgElementIds(parseSvgDocument(fs.readFileSync(path.join(pkg, a.file), "utf8"))) : [],
  ]));
  for (const item of plan.film.cast) {
    if (!idsByAsset.has(item.id) && ![...idsByAsset.values()].some((ids) => ids.includes(item.id))) {
      errors.push(`look cast "${item.id}" has no asset or SVG element in design.json`);
    }
  }
  const cues = createCues(narrationTimingForFilm(film, words), film.fps, options);
  if (plan.schema === "aideos.look/2") {
    if (!("performances" in spec)) return ["Three look requires aideos.design/2 performances."];
    if ((spec.treatment ?? "cel-v1") !== (plan.film.treatment ?? "cel-v1")) errors.push("design.treatment: differs from look film.treatment");
    for (const shot of plan.shots) if ((spec.shots?.[shot.id]?.stageTreatment ?? spec.treatment ?? "cel-v1") !== (shot.stageTreatment ?? plan.film.treatment ?? "cel-v1")) errors.push(`design.shots.${shot.id}.stageTreatment: differs from look shot stageTreatment`);
    const designIds = new Set<string>();
    for (const delivered of spec.performances) {
      if (designIds.has(delivered.id)) errors.push(`design performance "${delivered.id}" is duplicated`);
      designIds.add(delivered.id);
    }
    const lookIds = new Set(plan.film.performances.map((performance) => performance.id));
    for (const intended of plan.film.performances) {
      const delivered = spec.performances.find((p) => p.id === intended.id);
      const sameDecisiveCue = delivered && delivered.decisive.shotId === intended.decisive.shotId && delivered.decisive.phrase === intended.decisive.phrase && delivered.decisive.edge === intended.decisive.edge && delivered.decisive.event === intended.decisive.event;
      if (!delivered || ["action", "actor", "prop", "start", "afterState"].some((key) => delivered[key as keyof typeof delivered] !== intended[key as keyof typeof intended]) || !sameDecisiveCue) errors.push(`look performance ${intended.id}: design differs from action, actor, prop, start, decisive cue or after-state intention`);
      for (const id of [intended.actor, intended.prop]) {
        const authored = spec.assets.find((a) => a.id === id);
        const planned = plan.film.cast.find((a) => a.id === id);
        const sameIdentity = authored && "renderer" in authored && authored.renderer === "three" && planned?.renderer === "three" && (authored.treatment ?? spec.treatment ?? "cel-v1") === (planned.treatment ?? plan.film.treatment ?? "cel-v1") &&
          (authored.kind === "character" ? authored.character === plannedCharacterId(planned) : authored.asset === planned.asset);
        if (!sameIdentity) errors.push(`look cast ${id}: design identity or treatment mismatch`);
      }
      try {
        const issue = performanceStartIssue(intended, cues);
        if (issue) errors.push(`look performance ${intended.id}: ${issue}`);
      }
      catch (err) { errors.push(`look performance ${intended.id}: ${String(err)}`); }
    }
    for (const delivered of spec.performances) if (!lookIds.has(delivered.id)) errors.push(`design performance "${delivered.id}" has no matching look performance`);
  }
  for (const shot of plan.shots) {
    if (options.collapsed?.has(shot.id)) continue;
    if (shot.treatment === "scene") {
      if (plan.schema === "aideos.look/2" && "performances" in shot && shot.performances.length) continue;
      const start = cues.from(shot.id);
      const end = cues.to(shot.id);
      let cueFrame: number | null = null;
      try {
        cueFrame = cues.word(shot.id, shot.cue);
      } catch {
        errors.push(`look scene shot "${shot.id}" cue "${shot.cue}" was not found in narration word timings`);
      }
      const hasTimelyMotion = cueFrame !== null && spec.clips.some((clip) => {
        const frame = resolveCue(clip.start, cues);
        const carried = shot.carries.some((id) => id === clip.asset ||
          (idsByAsset.get(clip.asset)?.includes(id) && clip.targets.some((target) => target === id || target === "*")));
        return carried && clip.from !== clip.to && frame >= start && frame < end &&
          Math.abs(frame - cueFrame) / film.fps <= 0.4;
      });
      if (cueFrame !== null && !hasTimelyMotion) {
        errors.push(`look scene shot "${shot.id}" cue "${shot.cue}" needs a changing clip on a carried object starting within 0.4s of the cue`);
      }
    }
    if (shot.treatment === "device") {
      const override = spec.shots?.[shot.id];
      const refused = readVisualChoices(film.id)?.shots[shot.id];
      const refusalMatches = refused?.device?.state === "refused" &&
        (refused.rawChoice ?? refused.visual) === shot.device;
      const fallback = override ?? film.shots.find((s) => s.id === shot.id);
      const showsCard = fallback && (fallback.stage === "frame" || fallback.stage === "none") &&
        fallback.blocks?.every((b) => b.c === "TextReveal" || b.c === "Body");
      if (refusalMatches && showsCard) continue;
      if (!override?.blocks?.some((b) => b.c === shot.device) || override.stage !== "inset") {
        errors.push(`look device shot "${shot.id}" needs a matching "${shot.device}" shots override with stage "inset"`);
      }
    }
  }
  if (plan.schema !== "aideos.look/2" && plan.film.camera.length && !spec.camera?.length) errors.push("look camera poses require camera keyframes in design.json");
  return errors;
}

// Writes the status file and returns it.
function record(filmId: string, status: DesignBuildStatus): DesignBuildStatus {
  fs.mkdirSync(designDir(filmId), { recursive: true });
  fs.writeFileSync(path.join(designDir(filmId), "status.json"), JSON.stringify(status, null, 2) + "\n");
  return status;
}

// Builds a film's design from its spec and writes the film only when the design check passes.
export function buildDesign(filmId: string, source: DesignSource = "agent"): DesignBuildStatus {
  const at = new Date().toISOString();
  const pkg = resolvePackageDir(filmId);
  const fail = (errors: string[], findings: DesignFinding[] = []) =>
    record(filmId, { state: "failed", source, at, errors, findings });

  const specFile = path.join(pkg, "design", "design.json");
  if (!fs.existsSync(specFile)) return fail([`no design spec at videos/${filmId}/design/design.json`]);
  const filmFile = path.join(pkg, "film.json");
  if (!fs.existsSync(filmFile)) return fail([`no film at videos/${filmId}/film.json; run the pipeline through narrate and design first`]);

  let rawSpec: unknown;
  try {
    rawSpec = JSON.parse(fs.readFileSync(specFile, "utf8"));
  } catch (err) {
    return fail([`design.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`]);
  }
  const parsed = designSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    return fail(fieldIssues(parsed.error, rawSpec).map((i) => `design.json ${i.path}: ${i.message}`));
  }
  const spec = parsed.data;

  const missing = [...spec.assets.flatMap((a) => "file" in a ? [a.file] : []), ...(spec.background ? [spec.background.file] : [])].filter(
    (f) => !fs.existsSync(path.join(pkg, f)),
  );
  if (missing.length) return fail(missing.map((f) => `artwork ${f} is named in design.json but does not exist`));
  if (!spec.background && !fs.existsSync(path.join(pkg, DEFAULT_BACKGROUND_FILE))) {
    fs.mkdirSync(path.join(pkg, "visuals"), { recursive: true });
    fs.writeFileSync(path.join(pkg, DEFAULT_BACKGROUND_FILE), DEFAULT_BACKGROUND_SVG);
  }

  // Every build starts from the film as it was before its first design, so rebuilding is
  // repeatable and removing an override from design.json really restores the original shot.
  const baseFile = path.join(pkg, "design", "base-film.json");
  if (!fs.existsSync(baseFile)) fs.copyFileSync(filmFile, baseFile);
  let film: Film;
  let buildFilm: Film;
  try {
    const activeFilm = parseFilm(JSON.parse(fs.readFileSync(filmFile, "utf8")));
    const baseFilm = parseFilm(JSON.parse(fs.readFileSync(baseFile, "utf8")));
    film = carryCaptionPlacement(activeFilm, baseFilm, { owner: false });
    buildFilm = {
      ...baseFilm,
      ...(!spec.soundtrack && activeFilm.soundtrack && !activeFilm.soundtrack.defaultScore ? { soundtrack: activeFilm.soundtrack } : {}),
      ...(!spec.soundtrack && activeFilm.music ? { music: activeFilm.music } : {}),
      captionPlacement: film.captionPlacement,
      shots: baseFilm.shots.map((shot) => ({
        ...shot,
        captionPlacement: film.shots.find((current) => current.id === shot.id)?.captionPlacement ?? shot.captionPlacement,
      })),
    };
  } catch (error) { return fail([error instanceof Error ? error.message : String(error)]); }
  const wordsFile = path.join(pkg, "voiceover_words.json");
  const words: TimedWord[] = fs.existsSync(wordsFile) ? (JSON.parse(fs.readFileSync(wordsFile, "utf8")).words ?? []) : [];

  const resolved = resolveDesignCharacters(spec, pkg);
  if (resolved.errors.length) return fail(resolved.errors);
  const compiled = compileDesign(buildFilm, spec, words, source, { characters: resolved.characters });
  if (!compiled.film) return fail(compiled.errors);
  const builtFilm: Film = {
    ...compiled.film,
    shots: compiled.film.shots.flatMap((shot) => {
      const descendants = splitCaptionDescendants(film.shots, shot.id);
      return descendants.some((descendant) => descendant.captionPlacement)
        ? descendants.map((descendant) => ({ ...descendant, stage: shot.stage, blocks: shot.blocks }))
        : [shot];
    }),
  };

  // Legacy packages without a plan still build; new production runs always require one first.
  let lookPlan: LookPlan | undefined;
  const lookFindings: DesignFinding[] = [];
  if (fs.existsSync(path.join(designDir(filmId), "look.json"))) {
    const look = readCheckedLookPlan(buildFilm);
    if (!look.plan) return fail(look.errors, (look.warnings ?? []).map((message): DesignFinding => ({ rule: "look", severity: "warning", where: "design/look.json", message })));
    lookPlan = look.plan;
    lookFindings.push(...(look.warnings ?? []).map((message): DesignFinding => ({ rule: "look", severity: "warning", where: "design/look.json", message })));
    try {
      const errors = checkDesignAgainstLook(buildFilm, spec, words, pkg, lookPlan);
      if (errors.length) return fail(errors);
    } catch (err) {
      return fail([`look/design check: ${err instanceof Error ? err.message : String(err)}`]);
    }
  }

  const cues = createCues(narrationTimingForFilm(buildFilm, words), buildFilm.fps);
  let cameraTargets: DesignCheckContext["cameraTargets"] = [];
  try {
    const authoredPoses = (spec.camera ?? []).map((pose) => ({ frame: resolveCue(pose.at, cues), focus: pose.focus }));
    cameraTargets = (lookPlan?.film.camera ?? []).map((pose) => {
      const frame = resolveCue(pose.at, cues);
      const authoredPose = authoredPoses.length ? authoredPoses.reduce((nearest, candidate) =>
        Math.abs(candidate.frame - frame) < Math.abs(nearest.frame - frame) ? candidate : nearest,
      ) : undefined;
      return { frame, focus: pose.focus, authoredFocus: authoredPose?.focus };
    });
  } catch (err) {
    return fail([`camera cue resolution: ${err instanceof Error ? err.message : String(err)}`]);
  }
  const report = checkFilmDesign(builtFilm, {
    ...(cameraTargets.length ? { cameraTargets } : {}),
    ...(lookPlan ? { lookPlan } : {}),
  });
  if (!report.ok) return fail([], report.findings);

  // The end card's spoken line comes from the narration, not the design (base-film.json may predate
  // it), so a rebuild keeps the line the current film carries.
  const endCardVoice = (JSON.parse(fs.readFileSync(filmFile, "utf8")) as { endCardVoice?: unknown }).endCardVoice;
  writeFilm(filmId, endCardVoice ? { ...builtFilm, endCardVoice } as typeof builtFilm : builtFilm);
  // The browser bundle reads artwork through the generated source map, so refresh it.
  buildSvgSources();

  // Write description credits for public/YouTube upload
  const credits = builtFilm.soundtrack?.credits ?? [];
  const creditsText = Array.isArray(credits) ? credits.join("\n") : String(credits);
  const rendersDir = path.join(pkg, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });
  fs.writeFileSync(path.join(rendersDir, "description-credits.txt"), creditsText ? `${creditsText}\n` : "");

  // If a derived reel film exists, resolve the soundtrack separately for reel format
  const reelFile = path.join(pkg, "reel/film.json");
  if (spec.soundtrack && fs.existsSync(reelFile)) {
    try {
      const reelFilm = parseFilm(JSON.parse(fs.readFileSync(reelFile, "utf8")));
      const isCut = reelFilm.voiceover?.src === `videos/${filmId}/reel/voiceover.wav`;
      const reelWordsFile = path.join(pkg, isCut ? "reel/voiceover_words.json" : "voiceover_words.json");
      const reelWords: TimedWord[] = fs.existsSync(reelWordsFile) ? (JSON.parse(fs.readFileSync(reelWordsFile, "utf8")).words ?? []) : [];
      const reelCues = createCues(narrationTimingForFilm(reelFilm, reelWords), reelFilm.fps);
      const reelSoundtrack = resolveSoundtrack(spec.soundtrack, reelCues, reelFilm, "reel");
      writeReelFilm(filmId, { ...reelFilm, soundtrack: reelSoundtrack });
    } catch {
      // Don't fail the long design build if reel is mid-edit
    }
  }

  return record(filmId, { state: "passed", source, at, errors: [], findings: [...lookFindings, ...report.findings] });
}

// Formats a build status for the terminal (and for an agent to read and act on).
export function formatBuildStatus(filmId: string, status: DesignBuildStatus): string {
  const lines = [`${status.state === "passed" ? "PASS" : "FAIL"} design build ${filmId} (${status.source})`];
  for (const e of status.errors) lines.push(`  error ${e}`);
  for (const f of status.findings) lines.push(`  ${f.severity === "error" ? "error" : "warn "} [${f.rule}] ${f.where}: ${f.message}`);
  if (status.state === "passed") lines.push(`  wrote videos/${filmId}/film.json`);
  return lines.join("\n");
}
