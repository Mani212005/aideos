/**
 * File Description: Canonical JSON and content hash for character specs.
 * Inputs and outputs: parsed (defaulted) CharacterSpec -> canonical text, sha256 identity and stamped copy.
 * Used by: character validation, the character CLI's --stamp, design compilation and stage verification.
 */
import { sha256Hex } from "./sha256";
import type { CharacterSpec } from "./schema";

// Serializes a JSON value with object keys sorted at every depth, so equal content always hashes equally.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonical JSON cannot hold a non-finite number");
  return JSON.stringify(value);
}

// Hashes a parsed spec's content, excluding its own hash field.
export function characterHash(spec: CharacterSpec): string {
  const { hash: _ignored, ...content } = spec;
  void _ignored;
  return sha256Hex(canonicalJson(content));
}

// Returns a copy of the spec carrying its current content hash.
export function stampCharacter(spec: CharacterSpec): CharacterSpec {
  return { ...spec, hash: characterHash(spec) };
}

// Names the rig a character exposes to actions: its id and version, e.g. "iona-v1".
export function characterRigId(spec: Pick<CharacterSpec, "id" | "version">): string {
  return `${spec.id}-v${spec.version}`;
}
