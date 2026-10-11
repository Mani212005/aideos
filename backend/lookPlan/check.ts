/**
 * File Description: Checker for look.json plans enforcing semantic rules: treatments, unique shot IDs, unique cast IDs, valid carries references, device rules, camera wide establishing and payoff, bottom captions, and carry-over transformation clarity.
 * Inputs and outputs: LookPlan object or raw JSON (and optional Film context) -> LookCheckReport with pass/fail and findings.
 * Used by: backend/cli.ts, backend/lookPlan/index.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { safeParseLookPlan } from "./schema";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";

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

// Checks a LookPlan against all deterministic look-plan rules.
export function checkLookPlan(plan: unknown, filmId: string = "unnamed"): LookCheckReport {
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

  try {
    const raw = JSON.parse(fs.readFileSync(lookFile, "utf8"));
    return checkLookPlan(raw, filmId);
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
