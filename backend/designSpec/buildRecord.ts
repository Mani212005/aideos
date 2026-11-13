/**
 * File Description: Tracks open design requests, hashes design inputs and records request attribution.
 * Design waiters compare the recorded request id and current input hash; a build on identical inputs
 * can retain the previous request attribution. Look-plan delivery uses content digests for detection.
 * Inputs and outputs: film id and request kind -> request pointer, input hash, content digest.
 * Used by: backend/designSpec/build.ts, backend/designSpec/designer.ts, backend/designSpec/motionRequests.ts, backend/reelCut/writer.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir, resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import { DOT_RESOURCES, STAGE_RESOURCES } from "../../src/dl/scene/rigs/registry";
import { characterCandidates } from "../characters/library";

/** What asked for a build. */
export type BuildRequestKind = "design" | "motion";

/** The request an agent is currently working on for a film. */
export interface OpenBuildRequest {
  requestId: string;
  kind: BuildRequestKind;
  openedAt: string;
}

// The design folder of a film package.
function designFolder(filmId: string): string {
  return path.join(resolvePackageDir(filmId), "design");
}

// The file holding the film's open request.
function requestFile(filmId: string): string {
  return path.join(designFolder(filmId), "request.json");
}

/** Writes JSON through a temp file and a rename, so a reader never sees a torn file. */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temp, file);
}

/** A new request id. */
export function newRequestId(prefix = "r"): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Opens a request for a film; a request already open is superseded by it. */
export function openBuildRequest(filmId: string, kind: BuildRequestKind, requestId: string = newRequestId()): OpenBuildRequest {
  const request: OpenBuildRequest = { requestId, kind, openedAt: new Date().toISOString() };
  writeJsonAtomic(requestFile(filmId), request);
  return request;
}

/** The film's open request, or null when none is open or the file is unreadable. */
export function readOpenBuildRequest(filmId: string): OpenBuildRequest | null {
  try {
    const value = JSON.parse(fs.readFileSync(requestFile(filmId), "utf8")) as Partial<OpenBuildRequest>;
    return typeof value.requestId === "string" && (value.kind === "design" || value.kind === "motion") && typeof value.openedAt === "string"
      ? { requestId: value.requestId, kind: value.kind, openedAt: value.openedAt } : null;
  } catch {
    return null;
  }
}

/** Closes a request, but only when it is still the open one (a newer request is left alone). */
export function closeBuildRequest(filmId: string, requestId: string): void {
  if (readOpenBuildRequest(filmId)?.requestId === requestId) fs.rmSync(requestFile(filmId), { force: true });
}

/** A short digest of a file's bytes, or null when it does not exist. */
export function fileDigest(file: string): string | null {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** Hashes what a design build is made from (the spec, the look plan, the narration timing, every svg and the film fields the build keeps), never what the build itself writes. */
export function designInputHash(filmId: string): string {
  const pkg = resolvePackageDir(filmId);
  const hash = crypto.createHash("sha1");
  const readJson = (file: string): unknown => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  };
  const design = readJson(path.join(pkg, "design/design.json")) as { assets?: Array<{ kind?: string; character?: string; file?: string }>; background?: { file?: string }; soundtrack?: unknown } | null;
  const assetFiles = new Set([
    ...(design?.assets ?? []).flatMap((asset) => asset.file ? [asset.file] : []),
    ...(design?.background?.file ? [design.background.file] : []),
  ]);
  for (const file of ["design/design.json", "design/look.json", "voiceover_words.json"]) {
    hash.update(`${file}:${fileDigest(path.join(pkg, file)) ?? "-"}\n`);
  }
  const baseFilm = path.join(pkg, "design/base-film.json");
  const activeFilm = path.join(pkg, "film.json");
  hash.update(`base-film:${fileDigest(baseFilm) ?? fileDigest(activeFilm) ?? "-"}\n`);
  type Soundtrack = { defaultScore?: unknown } | null | undefined;
  type FilmInputs = {
    theme?: unknown;
    soundtrack?: Soundtrack;
    music?: unknown;
    captionPlacement?: unknown;
    endCardVoice?: unknown;
    shots?: Array<{ id?: unknown; captionPlacement?: unknown }>;
  };
  const active = readJson(activeFilm) as FilmInputs | null;
  const base = (readJson(baseFilm) ?? active) as FilmInputs | null;
  const authored = (soundtrack: Soundtrack): Soundtrack => soundtrack && !soundtrack.defaultScore ? soundtrack : undefined;
  hash.update(`active-build-inputs:${JSON.stringify(active ? {
    theme: active.theme,
    ...(!design?.soundtrack ? { soundtrack: authored(active.soundtrack) ?? authored(base?.soundtrack), music: active.music || base?.music } : {}),
    captionPlacement: active.captionPlacement,
    endCardVoice: active.endCardVoice,
    shots: active.shots?.map(({ id, captionPlacement }) => ({ id, captionPlacement })),
  } : null)}\n`);
  const visuals = path.join(pkg, "visuals");
  const svgs = fs.existsSync(visuals)
    ? fs.readdirSync(visuals).filter((f) => f.endsWith(".svg") && (f !== "canvas.svg" || assetFiles.has(`visuals/${f}`))).sort()
    : [];
  for (const svg of svgs) hash.update(`visuals/${svg}:${fileDigest(path.join(visuals, svg))}\n`);
  const look = readJson(path.join(pkg, "design/look.json")) as {
    film?: { cast?: Array<{ character?: string; asset?: string }>; performances?: Array<{ character?: { id?: string } }> };
  } | null;
  const characterIds = new Set([
    ...(design?.assets ?? []).flatMap((asset) => asset.kind === "character" && asset.character ? [asset.character] : []),
    ...(look?.film?.cast ?? []).flatMap((item) => item.character ?? (item.asset === "iona-art-v1" ? "iona" : undefined) ? [item.character ?? "iona"] : []),
    ...(look?.film?.performances ?? []).flatMap((item) => item.character?.id ? [item.character.id] : []),
  ]);
  for (const id of [...characterIds].sort()) {
    const file = characterCandidates(id, pkg).find((candidate) => fs.existsSync(candidate));
    hash.update(`character:${id}:${file ? fileDigest(file) : "-"}\n`);
  }
  for (const file of [...assetFiles].sort()) hash.update(`asset:${file}:${fileDigest(path.join(pkg, file)) ?? "-"}\n`);
  for (const file of Object.keys({ ...STAGE_RESOURCES, ...DOT_RESOURCES }).sort()) {
    hash.update(`resource:${file}:${fileDigest(resolveRepoAssetPath(file)) ?? "-"}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}
