/**
 * File Description: Resolves character ids to verified aideos.character/1 specs from a film package or the committed library.
 * Inputs and outputs: character id (and optional package dir) or a spec file -> parsed, hash-verified spec and its file, or errors naming file and field.
 * Used by: design build (before compile), pipeline resume fingerprints, the character CLI and character tests.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import { formatIssues, parseCharacter, type ParsedCharacter } from "../../src/dl/characters/validate";
import type { CharacterSpec } from "../../src/dl/characters/schema";
import type { CharacterRig } from "../../src/dl/performance/types";

/** Repo-relative directory of committed, shared characters. */
export const CHARACTER_LIBRARY = "characters";
/** File name a character id resolves to, in a package's characters/ or the library. */
export const characterFileName = (id: string): string => `${id}.character.json`;

/** A spec read from disk, verified, with where it came from. */
export interface LoadedCharacter extends ParsedCharacter {
  file: string;
}

// Lists the files a character id may resolve to, package first so a film can carry its own cast.
export function characterCandidates(id: string, packageDir?: string): string[] {
  return [...(packageDir ? [path.join(packageDir, "characters", characterFileName(id))] : []), resolveRepoAssetPath(path.join(CHARACTER_LIBRARY, characterFileName(id)))];
}

// Reads and verifies one spec file; a missing hash is an error, since an unstamped spec was never checked.
export function loadCharacterFile(file: string): LoadedCharacter {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { file, errors: [{ path: "(file)", message: fs.existsSync(file) ? `not valid JSON: ${err instanceof Error ? err.message : String(err)}` : "missing or unreadable" }] };
  }
  return { file, ...parseCharacter(raw, { requireHash: true }) };
}

// Resolves a character id to its first existing spec and verifies it.
export function loadCharacter(id: string, packageDir?: string): LoadedCharacter {
  const candidates = characterCandidates(id, packageDir);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return { file: candidates[candidates.length - 1], errors: [{ path: "(file)", message: `no character "${id}"; looked for ${candidates.map((c) => path.relative(process.cwd(), c) || c).join(" and ")}` }] };
  const loaded = loadCharacterFile(file);
  if (loaded.spec && loaded.spec.id !== id) loaded.errors.push({ path: "id", message: `the spec in ${file} is "${loaded.spec.id}" but the design asks for character "${id}"; rename the file or fix the id` });
  return loaded;
}

// Resolves a character or throws one error listing every problem with its file and field.
export function requireCharacter(id: string, packageDir?: string): { spec: CharacterSpec; rig: CharacterRig; file: string } {
  const loaded = loadCharacter(id, packageDir);
  if (!loaded.spec || !loaded.rig || loaded.errors.length) throw new Error(formatIssues(loaded.errors, `character ${id} (${loaded.file}) `).join("\n"));
  return { spec: loaded.spec, rig: loaded.rig, file: loaded.file };
}

/** The rig the receive reference was authored on: the approved Iona spec in the library. */
export function receiveSourceRig(): CharacterRig {
  return requireCharacter("iona").rig;
}
