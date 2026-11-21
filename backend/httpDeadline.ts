/**
 * File Description: One shared, injectable deadline policy for outbound HTTP. A Deadline is a
 * single time budget for a whole operation (every request, retry wait and body read inside it);
 * each request gets an abort signal capped by both its own per-request limit and what is left of
 * the budget, so a stalled server can never outlive the operation's timeout. The abort signal also
 * covers reading the response body.
 * Inputs and outputs: a budget in milliseconds, an optional clock, a fetch implementation -> a Deadline, abort signals, or an HttpDeadlineError.
 * Used by: backend/vcdClient.ts, backend/voiceSynthesis.ts, backend/transcribe.ts, backend/audioLibrary/library.ts.
 */

/** Default per-operation budgets (ms) for the external services that have no budget of their own. */
export const HTTP_DEADLINES = {
  /** One speech-provider synthesis request (Deepgram Aura or Google Cloud TTS), per text chunk. */
  speechRequestMs: 60_000,
  /** All chunks of one speech-provider attempt; a stalled provider then fails over to the next one. */
  speechProviderMs: 5 * 60_000,
  /** One Deepgram prerecorded transcription request including the upload and the response body. */
  transcriptionMs: 5 * 60_000,
  /** One audio library download (also bounds the curl fallback). */
  audioDownloadMs: 2 * 60_000,
} as const;

/** Injectable clock so deadline arithmetic is testable without real waiting. */
export type NowFn = () => number;

/** Thrown when an operation's budget is spent, before or during a request. */
export class HttpDeadlineError extends Error {
  /** What was being attempted when the budget ran out (a URL host or a phase name). */
  what: string;
  /** The budget (ms) the operation was given. */
  budgetMs: number;

  constructor(what: string, budgetMs: number) {
    super(`${what} timed out (time budget ${budgetMs} ms)`);
    this.name = "HttpDeadlineError";
    this.what = what;
    this.budgetMs = budgetMs;
  }
}

/** A single time budget shared by every request and wait inside one operation. */
export interface Deadline {
  /** The budget (ms) the operation started with. */
  readonly budgetMs: number;
  /** Milliseconds left, never below zero. */
  remainingMs(): number;
  /** True once nothing is left. */
  expired(): boolean;
  /** Abort signal that fires after min(capMs, remaining); throws HttpDeadlineError when already spent. */
  signal(what: string, capMs?: number): AbortSignal;
}

/** Starts a deadline of `budgetMs` from now (a non-finite or non-positive budget is rejected). */
export function startDeadline(budgetMs: number, now: NowFn = Date.now): Deadline {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError(`deadline budget must be a positive number of milliseconds, got ${budgetMs}`);
  }
  const endsAt = now() + budgetMs;
  const remainingMs = (): number => Math.max(0, endsAt - now());
  return {
    budgetMs,
    remainingMs,
    expired: () => remainingMs() <= 0,
    signal(what, capMs = Infinity) {
      const left = remainingMs();
      if (left <= 0) throw new HttpDeadlineError(what, budgetMs);
      return AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(capMs, left))));
    },
  };
}

/** True when an error is the abort or timeout that an expired AbortSignal.timeout produces. */
export function isAbortTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Runs fetch under the deadline. An already-spent budget fails before any request is made and an
 * abort during the request becomes an HttpDeadlineError; other failures pass through untouched.
 * The abort signal stays live after the headers arrive, so read the body with `readWithin` to turn
 * a stalled body into the same HttpDeadlineError.
 */
export async function fetchWithin(
  deadline: Deadline,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  options: { what?: string; capMs?: number } = {},
): Promise<Response> {
  const what = options.what ?? hostOf(url);
  const signal = deadline.signal(what, options.capMs);
  try {
    return await fetchImpl(url, { ...init, signal });
  } catch (err) {
    if (isAbortTimeout(err) || signal.aborted) throw new HttpDeadlineError(what, deadline.budgetMs);
    throw err;
  }
}

/** Runs a response-body read and turns an abort or timeout into an HttpDeadlineError. */
export async function readWithin<T>(deadline: Deadline, what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (isAbortTimeout(err)) throw new HttpDeadlineError(what, deadline.budgetMs);
    throw err;
  }
}

// Names the host of a URL for error messages (the whole string when it is not a valid URL).
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
