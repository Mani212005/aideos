/**
 * File Description: The renderer version that goes into a task spec: a short digest of the native renderer binary, so a rebuilt renderer never serves an old cache entry. The digest of one file is computed once per path, size and modification time.
 * Inputs and outputs: a binary path -> "native:<first 16 hex digits of its SHA-256>".
 * Used by: scripts/farm.ts (submit command) and the farm tests.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { nativeRendererBinary } from "../nativeRenderer";

const cache = new Map<string, string>();

/** The renderer version of a native binary. */
export function nativeRendererVersion(binary: string = nativeRendererBinary()): string {
  const stat = fs.statSync(binary);
  const key = `${binary}:${stat.size}:${stat.mtimeMs}`;
  let version = cache.get(key);
  if (!version) {
    version = `native:${createHash("sha256").update(fs.readFileSync(binary)).digest("hex").slice(0, 16)}`;
    cache.set(key, version);
  }
  return version;
}
