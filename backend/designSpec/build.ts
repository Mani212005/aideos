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

import fs from "node:fs";
import path from "node:path";
import { parseFilm, type Film } from "../../src/dl/schema";
import { collectSvgElementIds, parseSvgDocument } from "../../src/dl/scene/svgDocument";
import { writeFilm } from "../pipeline/filmStore";
import { buildSvgSources } from "../scene/buildSvgSources";
import { checkFilmDesign, type DesignFinding } from "../designCheck/designCheck";
import { compileDesign, DEFAULT_BACKGROUND_FILE, narrationTimingForFilm, type DesignSource, type TimedWord } from "./compile";
import { designSpecSchema, type DesignSpec } from "./spec";
import { checkLookPlan, parseLookPlan, type LookPlan } from "../lookPlan";
import { createCues } from "../sceneKit";
import { readVisualChoices } from "../pipeline/visualChoices";
import { resolveCue } from "./cues";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";


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
export function readCheckedLookPlan(film: Film): { plan?: LookPlan; errors: string[] } {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(designDir(film.id), "look.json"), "utf8"));
    const report = checkLookPlan(raw, film.id);
    if (!report.ok) return { errors: report.findings.map((f) => `look.json ${f.where}: ${f.message}`) };
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
    const wordsFile = path.join(resolvePackageDir(film.id), "voiceover_words.json");
    const words: TimedWord[] = fs.existsSync(wordsFile) ? JSON.parse(fs.readFileSync(wordsFile, "utf8")).words ?? [] : [];
    const cues = createCues(narrationTimingForFilm(film, words), film.fps);
    for (const pose of plan.film.camera) {
      try { resolveCue(pose.at, cues); }
      catch (err) { errors.push(`look.json camera: ${err instanceof Error ? err.message : String(err)}`); }
    }
    return errors.length ? { errors } : { plan, errors };
  } catch (err) {
    return { errors: [`look.json: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

// Checks the design's cast, carried motion, device overrides and camera against its look plan.
export function checkDesignAgainstLook(film: Film, spec: DesignSpec, words: TimedWord[], pkg: string, plan: LookPlan): string[] {
  const errors: string[] = [];
  const idsByAsset = new Map(spec.assets.map((a) => [a.id,
    collectSvgElementIds(parseSvgDocument(fs.readFileSync(path.join(pkg, a.file), "utf8"))),
  ]));
  for (const item of plan.film.cast) {
    if (!idsByAsset.has(item.id) && ![...idsByAsset.values()].some((ids) => ids.includes(item.id))) {
      errors.push(`look cast "${item.id}" has no asset or SVG element in design.json`);
    }
  }
  const cues = createCues(narrationTimingForFilm(film, words), film.fps);
  for (const shot of plan.shots) {
    if (shot.treatment === "scene") {
      const start = cues.from(shot.id);
      const end = cues.to(shot.id);
      const hasMotion = spec.clips.some((clip) => {
        const frame = resolveCue(clip.start, cues);
        const carried = shot.carries.some((id) => id === clip.asset ||
          (idsByAsset.get(clip.asset)?.includes(id) && clip.targets.some((target) => target === id || target === "*")));
        return carried && clip.from !== clip.to && frame >= start && frame < end;
      });
      if (!hasMotion) errors.push(`look scene shot "${shot.id}" needs a changing clip on a carried object starting inside the shot`);
    }
    if (shot.treatment === "device") {
      const override = spec.shots?.[shot.id];
      const refused = readVisualChoices(film.id)?.shots[shot.id];
      const refusalMatches = refused?.device?.state === "refused" &&
        (refused.rawChoice ?? refused.visual) === shot.device;
      const fallback = override ?? film.shots.find((s) => s.id === shot.id);
      const showsCard = fallback && (fallback.stage === "frame" || fallback.stage === "none") &&
        fallback.blocks.every((b) => b.c === "TextReveal" || b.c === "Body");
      if (refusalMatches && showsCard) continue;
      if (!override?.blocks.some((b) => b.c === shot.device) || override.stage !== "inset") {
        errors.push(`look device shot "${shot.id}" needs a matching "${shot.device}" shots override with stage "inset"`);
      }
    }
  }
  if (plan.film.camera.length && !spec.camera?.length) errors.push("look camera poses require camera keyframes in design.json");
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
    return fail(parsed.error.issues.map((i) => `design.json ${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const spec = parsed.data;

  const missing = [...spec.assets.map((a) => a.file), ...(spec.background ? [spec.background.file] : [])].filter(
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
  const film = parseFilm(JSON.parse(fs.readFileSync(baseFile, "utf8")));
  const wordsFile = path.join(pkg, "voiceover_words.json");
  const words: TimedWord[] = fs.existsSync(wordsFile) ? (JSON.parse(fs.readFileSync(wordsFile, "utf8")).words ?? []) : [];

  const compiled = compileDesign(film, spec, words, source);
  if (!compiled.film) return fail(compiled.errors);

  // Legacy packages without a plan still build; new production runs always require one first.
  let lookPlan: LookPlan | undefined;
  if (fs.existsSync(path.join(designDir(filmId), "look.json"))) {
    const look = readCheckedLookPlan(film);
    if (!look.plan) return fail(look.errors);
    lookPlan = look.plan;
    try {
      const errors = checkDesignAgainstLook(film, spec, words, pkg, lookPlan);
      if (errors.length) return fail(errors);
    } catch (err) {
      return fail([`look/design check: ${err instanceof Error ? err.message : String(err)}`]);
    }
  }

  const cues = createCues(narrationTimingForFilm(film, words), film.fps);
  const authoredPoses = (spec.camera ?? []).map((pose) => ({ frame: resolveCue(pose.at, cues), focus: pose.focus }));
  const cameraTargets = (lookPlan?.film.camera ?? []).map((pose) => {
    const frame = resolveCue(pose.at, cues);
    const authoredPose = authoredPoses.length ? authoredPoses.reduce((nearest, candidate) =>
      Math.abs(candidate.frame - frame) < Math.abs(nearest.frame - frame) ? candidate : nearest,
    ) : undefined;
    return { frame, focus: pose.focus, authoredFocus: authoredPose?.focus };
  });
  const report = checkFilmDesign(compiled.film, {
    ...(cameraTargets.length ? { cameraTargets } : {}),
    ...(lookPlan ? { lookPlan } : {}),
  });
  if (!report.ok) return fail([], report.findings);

  writeFilm(filmId, compiled.film);
  // The browser bundle reads artwork through the generated source map, so refresh it.
  buildSvgSources();
  return record(filmId, { state: "passed", source, at, errors: [], findings: report.findings });
}

// Formats a build status for the terminal (and for an agent to read and act on).
export function formatBuildStatus(filmId: string, status: DesignBuildStatus): string {
  const lines = [`${status.state === "passed" ? "PASS" : "FAIL"} design build ${filmId} (${status.source})`];
  for (const e of status.errors) lines.push(`  error ${e}`);
  for (const f of status.findings) lines.push(`  ${f.severity === "error" ? "error" : "warn "} [${f.rule}] ${f.where}: ${f.message}`);
  if (status.state === "passed") lines.push(`  wrote videos/${filmId}/film.json`);
  return lines.join("\n");
}
