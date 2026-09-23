/**
 * File Description: `aideos design build` - turns videos/<id>/design/design.json into the film.
 * Reads the spec and the measured narration, compiles the scene, runs the design check, and only
 * writes film.json (through filmStore, so its shadow module lands with it) when the check passes,
 * so a broken design never replaces a working film. The first build saves the undesigned film as
 * design/base-film.json and every build starts from it. Every outcome is recorded in
 * videos/<id>/design/status.json, which is how the pipeline learns an agent has finished.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFilm } from "../../src/dl/schema";
import { writeFilm } from "../pipeline/filmStore";
import { buildSvgSources } from "../scene/buildSvgSources";
import { checkFilmDesign, type DesignFinding } from "../designCheck/designCheck";
import { compileDesign, DEFAULT_BACKGROUND_FILE, type DesignSource, type TimedWord } from "./compile";
import { designSpecSchema } from "./spec";

const REPO_ROOT = path.resolve(__dirname, "../..");

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
  return path.join(REPO_ROOT, "videos", filmId, "design");
}

// Reads a film's last build status, or null when it has never been built.
export function readDesignStatus(filmId: string): DesignBuildStatus | null {
  const file = path.join(designDir(filmId), "status.json");
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as DesignBuildStatus) : null;
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
  const pkg = path.join(REPO_ROOT, "videos", filmId);
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

  const report = checkFilmDesign(compiled.film);
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
