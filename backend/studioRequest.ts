/**
 * File Description: Request hygiene for the Studio HTTP API: the one id pattern that may become a folder or file name, and JSON request bodies that are read with a byte cap so a huge or endless upload cannot exhaust the server's memory.
 * Inputs and outputs: ids, request headers and request body streams -> an id check, a declared-size check, and a parsed JSON body or a rejection.
 * Used by: editor/vite.config.ts, backend/studioRequest.test.ts, backend/studioRequestLive.test.ts.
 */

import type { IncomingHttpHeaders } from "node:http";

/** The pattern every film id, shot id and project id follows (the same one `src/dl/schema.ts` enforces on films and shots). */
export const SAFE_ID = /^[a-z0-9-]+$/;

/** True when `value` is a string that is safe to join onto a folder path: lowercase letters, digits and dashes only. */
export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

/** The largest JSON body most routes accept: a film manifest or script with room to spare. */
export const DEFAULT_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

/** The largest upload body: a media file as base64 inside JSON, which must still fit one string in memory. */
export const UPLOAD_BODY_LIMIT_BYTES = 256 * 1024 * 1024;

/** Thrown when a request body is larger than its route allows. */
export class BodyTooLargeError extends Error {
  readonly status = 413;
  readonly limitBytes: number;

  /** Builds the error naming the cap that was exceeded. */
  constructor(limitBytes: number) {
    super(`Request body is larger than the ${Math.round(limitBytes / (1024 * 1024))} MB this route accepts`);
    this.name = "BodyTooLargeError";
    this.limitBytes = limitBytes;
  }
}

/** The body cap of a request URL: uploads get the large cap, everything else the default. */
export function bodyLimitFor(requestUrl: string | undefined): number {
  const pathname = (requestUrl ?? "").split("?")[0];
  return pathname === "/api/media/upload" ? UPLOAD_BODY_LIMIT_BYTES : DEFAULT_BODY_LIMIT_BYTES;
}

/** True when the request announces (by Content-Length) a body larger than its route allows, so it can be refused before a byte is read. */
export function declaredBodyTooLarge(headers: IncomingHttpHeaders, requestUrl: string | undefined): boolean {
  const declared = Number(headers["content-length"]);
  return Number.isFinite(declared) && declared > bodyLimitFor(requestUrl);
}

/**
 * Reads a whole request body as JSON, rejecting with `BodyTooLargeError` as soon as more than `maxBytes`
 * have arrived (a chunked body has no Content-Length to check up front) and with "body is not JSON"
 * when the bytes do not parse.
 */
export async function readJsonBody(body: AsyncIterable<Buffer | string>, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    size += bytes.length;
    if (size > maxBytes) throw new BodyTooLargeError(maxBytes);
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("body is not JSON");
  }
}
