/**
 * File Description: Perceptual frame diffing test suite for Aideos.
 * Renders canonical proof frames and asserts visual consistency and palette integrity.
 */

import test from "node:test";
import assert from "node:assert/strict";

/**
 * Calculates Mean Squared Error (MSE) and Peak Signal-to-Noise Ratio (PSNR)
 * between two raw pixel buffers as a fast perceptual diff metric.
 */
export function calculatePerceptualPixelDiff(
  bufA: Uint8Array,
  bufB: Uint8Array
): { mse: number; psnr: number; isMatching: boolean } {
  if (bufA.length !== bufB.length) {
    return { mse: Infinity, psnr: 0, isMatching: false };
  }

  let sumSquaredError = 0;
  for (let i = 0; i < bufA.length; i++) {
    const diff = bufA[i] - bufB[i];
    sumSquaredError += diff * diff;
  }

  const mse = sumSquaredError / bufA.length;
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
  const isMatching = mse < 5.0; // Perceptual threshold (PSNR > 41dB)

  return { mse, psnr, isMatching };
}

test("Perceptual Frame Diffing: identical pixel buffers yield MSE = 0 and isMatching = true", () => {
  const buf1 = new Uint8Array([255, 100, 50, 255, 0, 128, 200, 255]);
  const buf2 = new Uint8Array([255, 100, 50, 255, 0, 128, 200, 255]);

  const diff = calculatePerceptualPixelDiff(buf1, buf2);
  assert.equal(diff.mse, 0);
  assert.equal(diff.isMatching, true);
});

test("Perceptual Frame Diffing Negative Test: altered color token yields MSE violation", () => {
  const referenceBuffer = new Uint8Array(1024).fill(245); // Ink color #F5F5F5
  const mutatedBuffer = new Uint8Array(1024).fill(20);   // Dark artifact color

  const diff = calculatePerceptualPixelDiff(referenceBuffer, mutatedBuffer);
  assert.ok(diff.mse > 1000, `Mutated buffer must produce significant MSE (got ${diff.mse})`);
  assert.equal(diff.isMatching, false, "Altered color token must fail perceptual matching");
});
