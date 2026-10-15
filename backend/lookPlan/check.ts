/**
 * File Description: Checker for look.json plans enforcing semantic rules: treatments, unique shot IDs, unique cast IDs, valid carries references, device rules, camera wide establishing and payoff, bottom captions, carry-over transformation clarity, shot IDs, spoken cues, and cast asset targets.
 * Inputs and outputs: LookPlan object or raw JSON (and optional LookCheckContext) -> LookCheckReport with pass/fail and findings.
 * Used by: backend/cli.ts, backend/lookPlan/index.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { safeParseLookPlan } from "./schema";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { parseFilm, type Film } from "../../src/dl/schema";
import { collectSvgElementIds, parseSvgDocument } from "../../src/dl/scene/svgDocument";

export type LookCheckRule =
  | "schema"
  | "treatment"
  | "shot"
  | "cast"
  | "carries"
  | "carry-over"
  | "device"
  | "camera"
  | "captions";

export interface LookCheckFinding {
  rule: LookCheckRule;
  severity: "error" | "warning";
  where: string;
  message: string;
}

export interface LookCheckReport {
  filmId: string;
  ok: boolean;
  findings: LookCheckFinding[];
  stats: {
    shots: number;
    castCount: number;
    cameraPoses: number;
  };
}

/** Package inputs that let the checker validate ids and spoken cues before design authoring. */
export interface LookCheckContext {
  film?: Film;
  castTargets?: Set<string>;
  designPerformanceIds?: string[];
}

// Normalizes spoken text into punctuation-free lowercase words for reliable phrase matching.
function spokenTokens(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return normalized.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

// Checks whether a cue's normalized word sequence appears in the narration text.
function containsSpokenCue(narration: string, cue: string): boolean {
  const words = spokenTokens(narration);
  const phrase = spokenTokens(cue);
  return phrase.length > 0 && words.some((_, index) => phrase.every((word, offset) => words[index + offset] === word));
}

// Checks a LookPlan against all deterministic look-plan rules.
export function checkLookPlan(plan: unknown, filmId: string = "unnamed", context: LookCheckContext = {}): LookCheckReport {
  const parsed = safeParseLookPlan(plan);
  if (!parsed.success) {
    const findings: LookCheckFinding[] = parsed.error.issues.map((iss) => ({
      rule: "schema",
      severity: "error",
      where: iss.path.join(".") || "root",
      message: iss.message,
    }));
    return {
      filmId,
      ok: false,
      findings,
      stats: { shots: 0, castCount: 0, cameraPoses: 0 },
    };
  }

  const look = parsed.data;
  const findings: LookCheckFinding[] = [];

  if (look.schema === "aideos.look/2") {
    const performanceIds = new Set<string>();
    for (const p of look.film.performances) {
      if (performanceIds.has(p.id)) findings.push({ rule: "cast", severity: "error", where: p.id, message: "duplicate performance id" });
      performanceIds.add(p.id);
      const actor = look.film.cast.find((c) => c.id === p.actor);
      const prop = look.film.cast.find((c) => c.id === p.prop);
      const plannedCharacter = actor?.character ?? (actor?.asset === "iona-art-v1" && actor.rig === "iona-v1" ? "iona" : undefined);
      if (actor?.renderer !== "three" || !plannedCharacter || actor.treatment !== "cel-v1" || prop?.renderer !== "three" || prop.asset !== "paper-glider-v1" || prop.treatment !== "cel-v1") findings.push({ rule: "cast", severity: "error", where: p.id, message: "receive-v1 needs a three character (character: <id>) and the paper glider, both cel-v1" });
      for (const shotId of p.carries) if (!look.shots.some((s) => s.id === shotId && s.performances.includes(p.id) && s.carries.includes(p.actor) && s.carries.includes(p.prop))) findings.push({ rule: "carries", severity: "error", where: p.id, message: `performance carry ${shotId} must retain actor and prop and reference the performance` });
      const decisiveShot = context.film?.shots.find((s) => s.id === p.decisive.shotId);
      if (context.film && !containsSpokenCue(decisiveShot?.scriptText ?? "", p.decisive.phrase)) findings.push({ rule: "shot", severity: "error", where: p.id, message: "decisive phrase is absent from its narrated shot" });
    }
    for (const shot of look.shots) for (const id of shot.performances) if (!performanceIds.has(id)) findings.push({ rule: "cast", severity: "error", where: shot.id, message: `unknown performance ${id}` });
    if (context.designPerformanceIds) {
      const designIds = new Set(context.designPerformanceIds);
      for (const id of designIds) if (context.designPerformanceIds.filter((candidate) => candidate === id).length > 1) findings.push({ rule: "cast", severity: "error", where: `design.performances.${id}`, message: `design performance "${id}" is duplicated.` });
      for (const id of performanceIds) if (!designIds.has(id)) findings.push({ rule: "cast", severity: "error", where: `film.performances.${id}`, message: `look performance "${id}" has no matching design performance.` });
      for (const id of designIds) if (!performanceIds.has(id)) findings.push({ rule: "cast", severity: "error", where: `design.performances.${id}`, message: `design performance "${id}" has no matching look performance.` });
    }
    findings.push({ rule: "cast", severity: "warning", where: "three stage", message: "projected geometry checks deferred to design build; facial appeal, finger contact and raster occlusion unmeasured" });
  }

  if (!context.film) {
    findings.push({ rule: "shot", severity: "warning", where: "film.json", message: "not checked yet: shot and cast beat ids need film.json." });
  } else {
    const filmShotIds = new Set(context.film.shots.map((shot) => shot.id));
    const planShotIds = new Set(look.shots.map((shot) => shot.id));
    for (const shot of look.shots) {
      if (!filmShotIds.has(shot.id)) {
        findings.push({ rule: "shot", severity: "error", where: `shots.${shot.id}`, message: `look plan names unknown film shot "${shot.id}".` });
      }
    }
    for (const shot of context.film.shots) {
      if (!planShotIds.has(shot.id)) {
        findings.push({ rule: "shot", severity: "error", where: `shots.${shot.id}`, message: `look plan is missing film shot "${shot.id}".` });
      }
    }
    for (const item of look.film.cast) {
      for (const shotId of [item.enters, ...item.changes.map((change) => change.at)]) {
        if (!filmShotIds.has(shotId)) {
          findings.push({ rule: "cast", severity: "error", where: `film.cast.${item.id}`, message: `cast "${item.id}" references unknown film shot "${shotId}".` });
        }
      }
    }
    const narrationAvailable = context.film.shots.some((shot) => Boolean(shot.scriptText?.trim()));
    if (!narrationAvailable) {
      findings.push({ rule: "shot", severity: "warning", where: "film.shots[].scriptText", message: "not checked yet: cue words and phrases need narration text." });
    } else {
      for (const shot of look.shots) {
        const filmShot = context.film.shots.find((candidate) => candidate.id === shot.id);
        const narration = filmShot?.scriptText?.trim() ?? "";
        if (!containsSpokenCue(narration, shot.cue)) {
          findings.push({ rule: "shot", severity: "error", where: `shots.${shot.id}.cue`, message: `cue "${shot.cue}" is not found in the narration for shot "${shot.id}".` });
        }
      }
    }
  }

  if (context.castTargets === undefined) {
    findings.push({ rule: "cast", severity: "warning", where: "design/design.json", message: "not checked yet: cast ids need design.json assets and their SVG element ids." });
  } else {
    for (const item of look.film.cast) {
      if (!context.castTargets.has(item.id)) {
        findings.push({ rule: "cast", severity: "error", where: `film.cast.${item.id}`, message: `cast id "${item.id}" does not match a design asset id or SVG element id.` });
      }
    }
  }

  // 1. Check cast uniqueness
  const castIds = new Set<string>();
  for (const item of look.film.cast) {
    if (castIds.has(item.id)) {
      findings.push({
        rule: "cast",
        severity: "error",
        where: `film.cast.${item.id}`,
        message: `duplicate cast id "${item.id}"; cast ids must be unique.`,
      });
    }
    castIds.add(item.id);

    // Check carry-over change descriptions
    for (let cIdx = 0; cIdx < item.changes.length; cIdx++) {
      const change = item.changes[cIdx];
      if (!change.state?.trim()) {
        findings.push({
          rule: "carry-over",
          severity: "error",
          where: `film.cast.${item.id}.changes[${cIdx}]`,
          message: `carry-over change for "${item.id}" at "${change.at}" needs a distinct resulting state so the change can be staged and checked.`,
        });
      }
      if (change.magnitude === "minor") {
        findings.push({
          rule: "carry-over",
          severity: "error",
          where: `film.cast.${item.id}.changes[${cIdx}]`,
          message: `carry-over change for "${item.id}" at "${change.at}" is marked minor; carry-over must be visibly substantial (moderate or major) to be clearly recognized.`,
        });
      } else if (!change.magnitude && change.how.trim().length < 15) {
        findings.push({
          rule: "carry-over",
          severity: "error",
          where: `film.cast.${item.id}.changes[${cIdx}]`,
          message: `carry-over change description for "${item.id}" ("${change.how}") is too brief to verify visible transformation; describe how the object visibly changes, moves, or transforms.`,
        });
      }
    }
  }

  for (let i = 0; i < look.film.camera.length; i++) {
    const focus = look.film.camera[i].focus;
    if (focus && !castIds.has(focus)) {
      findings.push({
        rule: "camera",
        severity: "error",
        where: `film.camera[${i}].focus`,
        message: `camera focus names unknown cast object "${focus}".`,
      });
    } else if (i > 0 && i < look.film.camera.length - 1 && !focus) {
      findings.push({
        rule: "camera",
        severity: "warning",
        where: `film.camera[${i}].focus`,
        message: `name the cast object this move lands on, so the design check can verify that the camera arrives near its subject.`,
      });
    }
  }

  // 2. Check camera poses: must start wide and end wide
  if (look.film.camera.length > 0) {
    const firstPose = look.film.camera[0].pose.toLowerCase();
    const lastPose = look.film.camera[look.film.camera.length - 1].pose.toLowerCase();

    if (!firstPose.includes("wide")) {
      findings.push({
        rule: "camera",
        severity: "error",
        where: `film.camera[0]`,
        message: `initial camera pose must establish with a wide view (found "${look.film.camera[0].pose}").`,
      });
    }

    if (!lastPose.includes("wide")) {
      findings.push({
        rule: "camera",
        severity: "error",
        where: `film.camera[${look.film.camera.length - 1}]`,
        message: `final camera pose must conclude with a wide payoff view (found "${look.film.camera[look.film.camera.length - 1].pose}").`,
      });
    }
  }

  // 3. Check captions: kineticColumn must be false
  if (look.film.captions.kineticColumn) {
    findings.push({
      rule: "captions",
      severity: "error",
      where: "film.captions.kineticColumn",
      message: `kineticColumn captions are forbidden; narration text appears only in the bottom caption band.`,
    });
  }

  // 4. Check shots: treatments, carries validity, device rules, spacing rules
  const shotIds = new Set<string>();
  let consecutiveDeviceCount = 0;
  let totalDeviceCount = 0;
  const shotCount = look.shots.length;

  for (let i = 0; i < shotCount; i++) {
    const shot = look.shots[i];

    if (shotIds.has(shot.id)) {
      findings.push({
        rule: "shot",
        severity: "error",
        where: `shots[${i}] (${shot.id})`,
        message: `duplicate shot id "${shot.id}"; shot ids must be unique.`,
      });
    }
    shotIds.add(shot.id);

    // Treatment checks
    if (shot.treatment === "footage") {
      findings.push({
        rule: "treatment",
        severity: "error",
        where: `shots[${i}] (${shot.id})`,
        message: `treatment "footage" is reserved and out of scope until b-roll is planned.`,
      });
    }

    // Carries checks: every carried object must exist in cast
    for (const carriedId of shot.carries) {
      if (!castIds.has(carriedId)) {
        findings.push({
          rule: "carries",
          severity: "error",
          where: `shots[${i}] (${shot.id})`,
          message: `shot carries unknown cast id "${carriedId}"; every carried object must be declared in film.cast.`,
        });
      }
    }

    // Device checks
    if (shot.treatment === "device") {
      totalDeviceCount++;
      consecutiveDeviceCount++;

      if (!shot.device || shot.device.trim() === "") {
        findings.push({
          rule: "device",
          severity: "error",
          where: `shots[${i}] (${shot.id})`,
          message: `device shot must name a template device (e.g. StatCounter, Plot, CodeBlock).`,
        });
      }

      if (consecutiveDeviceCount > 1) {
        findings.push({
          rule: "device",
          severity: "error",
          where: `shots[${i}] (${shot.id})`,
          message: `no two device shots in a row; previous shot was also a device shot.`,
        });
      }
    } else {
      consecutiveDeviceCount = 0;
    }
  }

  // Frequency limit: at most 1 device shot per 4 shots (rounded up for tiny films: max 1 if <=4, max 2 if 5..8, etc.)
  const maxAllowedDevices = Math.max(1, Math.ceil(shotCount / 4));
  if (totalDeviceCount > maxAllowedDevices) {
    findings.push({
      rule: "device",
      severity: "error",
      where: "shots",
      message: `too many device shots (${totalDeviceCount} of ${shotCount}); limit is at most one in four shots (${maxAllowedDevices} allowed).`,
    });
  }

  return {
    filmId,
    ok: !findings.some((f) => f.severity === "error"),
    findings,
    stats: {
      shots: shotCount,
      castCount: look.film.cast.length,
      cameraPoses: look.film.camera.length,
    },
  };
}

// Checks look.json for a film package by slug or path.
export function checkLookPlanById(filmId: string): LookCheckReport {
  const pkgDir = resolvePackageDir(filmId);
  const lookFile = path.join(pkgDir, "design", "look.json");
  if (!fs.existsSync(lookFile)) {
    return {
      filmId,
      ok: false,
      findings: [
        {
          rule: "schema",
          severity: "error",
          where: "design/look.json",
          message: `no look.json file found at ${lookFile}`,
        },
      ],
      stats: { shots: 0, castCount: 0, cameraPoses: 0 },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(lookFile, "utf8"));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      filmId,
      ok: false,
      findings: [
        {
          rule: "schema",
          severity: "error",
          where: "design/look.json",
          message: `failed to parse look.json: ${msg}`,
        },
      ],
      stats: { shots: 0, castCount: 0, cameraPoses: 0 },
    };
  }

  const auxiliaryFindings: LookCheckFinding[] = [];
  const context: LookCheckContext = {};

  const filmFile = path.join(pkgDir, "film.json");
  if (fs.existsSync(filmFile)) {
    try {
      context.film = parseFilm(JSON.parse(fs.readFileSync(filmFile, "utf8")));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      auxiliaryFindings.push({
        rule: "shot",
        severity: "error",
        where: "film.json",
        message: `failed to parse film.json: ${msg}`,
      });
    }
  }

  const designFile = path.join(pkgDir, "design", "design.json");
  if (fs.existsSync(designFile)) {
    try {
      const design = JSON.parse(fs.readFileSync(designFile, "utf8")) as { assets?: Array<{ id?: string; file?: string }>; performances?: unknown };
      if (Array.isArray(design.performances)) {
        const performanceIds: string[] = [];
        design.performances.forEach((performance: unknown, index: number) => {
          const id = performance !== null && typeof performance === "object" ? (performance as { id?: unknown }).id : undefined;
          if (typeof id !== "string" || !id.trim()) {
            auxiliaryFindings.push({
              rule: "cast",
              severity: "error",
              where: `design/design.json performances[${index}].id`,
              message: "missing; every performance needs an id that matches a look-plan performance.",
            });
          } else performanceIds.push(id);
        });
        context.designPerformanceIds = performanceIds;
      } else if (design.performances !== undefined) {
        auxiliaryFindings.push({
          rule: "cast",
          severity: "error",
          where: "design/design.json performances",
          message: "must be an array of performances with nonempty ids.",
        });
      }
      const castTargets = new Set<string>();
      for (const asset of design.assets ?? []) {
        if (asset.id) castTargets.add(asset.id);
        if (!asset.file) continue;
        const assetFile = path.join(pkgDir, asset.file);
        if (fs.existsSync(assetFile)) {
          try {
            for (const id of collectSvgElementIds(parseSvgDocument(fs.readFileSync(assetFile, "utf8")))) {
              castTargets.add(id);
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            auxiliaryFindings.push({
              rule: "cast",
              severity: "error",
              where: asset.file,
              message: `failed to parse ${asset.file}: ${msg}`,
            });
          }
        }
      }
      context.castTargets = castTargets;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      auxiliaryFindings.push({
        rule: "cast",
        severity: "error",
        where: "design/design.json",
        message: `failed to parse design/design.json: ${msg}`,
      });
    }
  }

  const report = checkLookPlan(raw, filmId, context);
  if (auxiliaryFindings.length > 0) {
    const errorPaths = new Set(auxiliaryFindings.map((f) => f.where));
    report.findings = [
      ...auxiliaryFindings,
      ...report.findings.filter((f) => !(f.severity === "warning" && errorPaths.has(f.where))),
    ];
    report.ok = !report.findings.some((f) => f.severity === "error");
  }
  return report;
}

// Formats a LookCheckReport for display.
export function formatLookReport(report: LookCheckReport): string {
  const status = report.ok ? "PASS" : "FAIL";
  const header = `${status} ${report.filmId}: ${report.stats.shots} shots, ${report.stats.castCount} cast objects, ${report.stats.cameraPoses} camera poses`;
  if (report.findings.length === 0) {
    return header;
  }
  const lines = [header];
  for (const f of report.findings) {
    const tag = f.severity === "error" ? "error" : "warn ";
    lines.push(`  ${tag} [${f.rule}] ${f.where}: ${f.message}`);
  }
  return lines.join("\n");
}
