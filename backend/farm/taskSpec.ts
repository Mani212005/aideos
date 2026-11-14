/**
 * File Description: The render task spec of the farm and its id. A task is one film in one format; its spec is the IR hash, the digest of every package asset, the format, the profile, the frame range and the renderer version. The task id is the SHA-256 of the canonical spec, so the same spec always has the same id and a repeat submission is a cache hit.
 * Inputs and outputs: a plain object -> a validated TaskSpec, its canonical JSON and its task id; priority class names -> ranks.
 * Used by: backend/farm/queue.ts, backend/farm/sqliteQueue.ts, backend/farm/submit.ts, backend/farm/worker.ts, backend/farm/renderExecutor.ts, scripts/farm.ts.
 */

import { createHash } from "node:crypto";
import type { RenderProfile } from "../renderJob";
import type { ProductionFormat } from "../pipeline/types";

/** A lowercase hex SHA-256 digest. */
export type Digest = string;

/** Priority classes from most to least urgent; the queue serves a lower rank first. */
export const PRIORITY_CLASSES = ["studio_export", "draft", "review", "batch_final"] as const;
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

/** Everything that decides the bytes of a render. */
export interface TaskSpec {
  /** SHA-256 of the canonical Render IR JSON; the IR itself is stored under this digest. */
  irHash: Digest;
  /** Package-relative asset path -> SHA-256 of its bytes (fonts, artwork, audio). */
  assetDigests: Record<string, Digest>;
  format: ProductionFormat;
  profile: RenderProfile;
  /** Inclusive frame range, or null for the whole film. */
  frameRange: [number, number] | null;
  /** Names the renderer build, so a new renderer never serves an old cache entry. */
  rendererVersion: string;
}

/** What a worker needs beyond the spec to run the task; it does not change the output bytes. */
export interface TaskPayload {
  filmId: string;
  /** Digest of the canonical film JSON in the store. */
  filmDigest: Digest;
}

const DIGEST = /^[0-9a-f]{64}$/;
const PROFILES: readonly string[] = ["draft", "review", "final"];

/** Returns the rank of a priority class (0 is the most urgent). */
export function priorityRank(cls: PriorityClass): number {
  const rank = PRIORITY_CLASSES.indexOf(cls);
  if (rank < 0) throw new Error(`Unknown priority class "${cls}": use ${PRIORITY_CLASSES.join(", ")}`);
  return rank;
}

/** True when the value is a lowercase hex SHA-256 digest. */
export function isDigest(value: unknown): value is Digest {
  return typeof value === "string" && DIGEST.test(value);
}

/** Serializes any JSON value with object keys sorted, so equal content gives equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(
        Object.keys(inner)
          .sort()
          .map((key) => [key, (inner as Record<string, unknown>)[key]]),
      );
    }
    return inner;
  });
}

/** True for a package-relative path that stays inside the package. */
function safeRelativePath(p: string): boolean {
  return p.length > 0 && !p.startsWith("/") && !p.includes("\\") && !/^[A-Za-z]:/.test(p) && !p.split("/").some((part) => part === ".." || part === "" || part === ".");
}

/** Validates an unknown value as a TaskSpec and returns a normalized copy; throws a message that names the first defect. */
export function parseTaskSpec(value: unknown): TaskSpec {
  if (typeof value !== "object" || value === null) throw new Error("task spec must be an object");
  const raw = value as Record<string, unknown>;
  if (!isDigest(raw.irHash)) throw new Error("task spec irHash must be a lowercase SHA-256 hex digest");
  const assets = raw.assetDigests;
  if (typeof assets !== "object" || assets === null || Array.isArray(assets)) throw new Error("task spec assetDigests must be an object");
  const assetDigests: Record<string, Digest> = {};
  for (const key of Object.keys(assets).sort()) {
    if (!safeRelativePath(key)) throw new Error(`task spec asset path "${key}" must be relative and stay inside the package`);
    const digest = (assets as Record<string, unknown>)[key];
    if (!isDigest(digest)) throw new Error(`task spec asset "${key}" needs a SHA-256 digest`);
    assetDigests[key] = digest;
  }
  if (raw.format !== "long" && raw.format !== "reel") throw new Error(`task spec format must be long or reel, got "${String(raw.format)}"`);
  if (typeof raw.profile !== "string" || !PROFILES.includes(raw.profile)) throw new Error(`task spec profile must be draft, review or final, got "${String(raw.profile)}"`);
  let frameRange: [number, number] | null = null;
  if (raw.frameRange !== null && raw.frameRange !== undefined) {
    const r = raw.frameRange;
    if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[0]) || !Number.isInteger(r[1]) || r[0] < 0 || r[1] < r[0]) {
      throw new Error("task spec frameRange must be null or [first, last] with 0 <= first <= last");
    }
    frameRange = [r[0], r[1]];
  }
  if (typeof raw.rendererVersion !== "string" || raw.rendererVersion.trim() === "") throw new Error("task spec rendererVersion must be a non-empty string");
  return { irHash: raw.irHash, assetDigests, format: raw.format, profile: raw.profile as RenderProfile, frameRange, rendererVersion: raw.rendererVersion };
}

/** The canonical text of a spec; the exact bytes the task id hashes. */
export function canonicalSpec(spec: TaskSpec): string {
  return canonicalJson(parseTaskSpec(spec));
}

/** The id of a task: SHA-256 of the canonical spec. */
export function taskIdOf(spec: TaskSpec): Digest {
  return createHash("sha256").update(canonicalSpec(spec)).digest("hex");
}

/** Validates a payload received from the queue store. */
export function parseTaskPayload(value: unknown): TaskPayload {
  const raw = value as Partial<TaskPayload> | null;
  if (typeof raw !== "object" || raw === null || typeof raw.filmId !== "string" || raw.filmId === "" || !isDigest(raw.filmDigest)) {
    throw new Error("task payload needs a filmId and a filmDigest");
  }
  return { filmId: raw.filmId, filmDigest: raw.filmDigest };
}

/** Every store digest a task reads: the IR, each asset and the film snapshot. */
export function inputDigests(spec: TaskSpec, payload: TaskPayload): Digest[] {
  return [...new Set([spec.irHash, ...Object.values(spec.assetDigests), payload.filmDigest])];
}
