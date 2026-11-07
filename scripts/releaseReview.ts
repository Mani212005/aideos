/**
 * File Description: The mandatory Gemini review of every rendered output in a release, with no waiver of any verdict.
 * Inputs and outputs: rendered output paths and a review runner -> returns when every output is ACCEPT, throws on the first that is not.
 * Used by: scripts/release.ts and scripts/release_gemini.test.ts.
 */

/** Runs the Gemini review on each output in order; the runner must throw on a non-ACCEPT verdict (gemini-review exits 1), which stops the release. */
export function reviewOutputsWithGemini(outputs: readonly { path: string }[], runReview: (videoPath: string) => void): void {
  for (const output of outputs) runReview(output.path);
}
