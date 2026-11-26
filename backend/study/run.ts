/**
 * File Description: The `aideos study` run: validates the references (local files only, a URL is refused), studies each one, and writes a per-study folder
 * with one subfolder per reference (bible.json, bible.md, seed.json, seed.md) and a study.json index. Only with an explicit `into` film does it write a seed into
 * a film package (design/look.seed.json and design/STUDY_SEED.md), and it never touches design/look.json and never overwrites an existing seed.
 * Inputs and outputs: reference paths and options -> files under the study folder and a StudyRunResult.
 * Used by: backend/cli.ts.
 */

import { callerWorkingDirectory, REPO_ROOT as repositoryRoot } from "../paths";

import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../videoPackageLoader";
import { formatBible, formatSeed } from "./format";
import { buildSeed } from "./seed";
import { isRemoteReference, studyReference, type StudyDeps } from "./study";
import type { StudyBible } from "./types";

const REPO_ROOT = repositoryRoot;

/** Options of a study run. */
export interface StudyRunOptions {
  /** Local reference videos. */
  references: string[];
  /** Study name (folder name); defaults to study-<timestamp>. */
  name?: string;
  /** Where the study folder is created; defaults to <repo>/.frames/study (gitignored). */
  outRoot?: string;
  /** Word timings for the (single) reference's wpm; for several references, <name>.words.json next to each is used. */
  wordsFile?: string;
  /** Film slug to receive design/look.seed.json (exactly one reference). Never writes look.json. */
  into?: string;
  /** Base directory that relative reference paths resolve against (the caller's cwd). */
  cwd?: string;
  deps?: StudyDeps;
}

/** What a run produced. */
export interface StudyRunResult {
  studyDir: string;
  references: Array<{ source: string; dir: string; bible: StudyBible }>;
  seededInto?: string[];
}

// A folder-safe name from a file name without its extension.
export function slugify(name: string): string {
  return name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "reference";
}

// Finds the word list next to a reference (<name>.words.json), if any.
export function sidecarWords(file: string): string | undefined {
  const candidate = path.join(path.dirname(file), `${path.basename(file).replace(/\.[^.]+$/, "")}.words.json`);
  return fs.existsSync(candidate) ? candidate : undefined;
}

// Writes JSON with two-space indentation and a trailing newline.
function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

// Validates every reference before any work starts, so a bad one fails the whole run with a clear message and nothing half-written.
export function validateReferences(references: string[], cwd: string): string[] {
  if (references.length === 0) throw new Error("name at least one reference video (a local file)");
  const resolved: string[] = [];
  for (const ref of references) {
    if (isRemoteReference(ref)) {
      throw new Error(`"${ref}" is a URL. aideos study reads local files only: it never downloads or scrapes anything. Save the video yourself where you are allowed to, then pass its path.`);
    }
    const file = path.resolve(cwd, ref);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`no video file at ${file}`);
    resolved.push(file);
  }
  return resolved;
}

// Runs the study of each reference and writes the study folder.
export async function runStudy(options: StudyRunOptions): Promise<StudyRunResult> {
  const cwd = options.cwd ?? callerWorkingDirectory();
  const files = validateReferences(options.references, cwd);
  if (options.into !== undefined && files.length !== 1) throw new Error("--into takes exactly one reference: a film's seed comes from one study");
  if (options.wordsFile !== undefined && files.length !== 1) throw new Error("--words applies to a single reference; for several, put <name>.words.json next to each video");
  let intoDir: string | undefined;
  if (options.into !== undefined) {
    intoDir = resolvePackageDir(options.into);
    if (!fs.existsSync(path.join(intoDir, "film.json"))) throw new Error(`--into: no film package "${options.into}" (no film.json in ${intoDir})`);
    for (const target of ["look.seed.json", "STUDY_SEED.md"]) {
      if (fs.existsSync(path.join(intoDir, "design", target))) throw new Error(`--into: ${path.join(intoDir, "design", target)} already exists; a seed is never overwritten`);
    }
  }
  const name = slugify(options.name ?? `study-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`);
  const studyDir = path.resolve(options.outRoot ?? path.join(REPO_ROOT, ".frames", "study"), name);
  fs.mkdirSync(studyDir, { recursive: true });
  const used = new Set<string>();
  const references: StudyRunResult["references"] = [];
  for (const file of files) {
    let slug = slugify(path.basename(file));
    for (let n = 2; used.has(slug); n++) slug = `${slugify(path.basename(file))}-${n}`;
    used.add(slug);
    const dir = path.join(studyDir, slug);
    fs.mkdirSync(dir, { recursive: true });
    const bible = await studyReference(file, { wordsFile: options.wordsFile ?? sidecarWords(file), deps: options.deps });
    const seed = buildSeed(bible);
    writeJson(path.join(dir, "bible.json"), bible);
    fs.writeFileSync(path.join(dir, "bible.md"), formatBible(bible));
    writeJson(path.join(dir, "seed.json"), seed);
    fs.writeFileSync(path.join(dir, "seed.md"), formatSeed(seed));
    references.push({ source: file, dir, bible });
    if (intoDir) {
      const designDir = path.join(intoDir, "design");
      fs.mkdirSync(designDir, { recursive: true });
      writeJson(path.join(designDir, "look.seed.json"), seed);
      fs.writeFileSync(path.join(designDir, "STUDY_SEED.md"), formatSeed(seed));
    }
  }
  writeJson(path.join(studyDir, "study.json"), { schema: "aideos.study.index/1", name, references: references.map((r) => ({ file: path.basename(r.source), dir: path.basename(r.dir) })) });
  return { studyDir, references, ...(intoDir ? { seededInto: [path.join(intoDir, "design", "look.seed.json"), path.join(intoDir, "design", "STUDY_SEED.md")] } : {}) };
}
