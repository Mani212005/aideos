/**
 * File Description: Captured input/output corpus for the shared ffprobe wrapper, using a committed synthetic image
 * fixture so the probe path exercises real ffprobe without network, generated media, or voice data.
 * Inputs and outputs: test_fixtures/pictures/text-signal.png -> stable VideoFacts expectation.
 * Used by: npm test (found by glob), the CI unit job.
 */

import path from "node:path";
import test from "node:test";
import { expectFile, formatForReview } from "../testSupport/expectFile";
import { probeVideo } from "./probe";

const fixture = path.resolve(__dirname, "../../test_fixtures/pictures/text-signal.png");

// Captures facts from ffprobe while removing the checkout-specific absolute path.
test("probeVideo matches the sanitized fixture media corpus", () => {
  const facts = probeVideo(fixture);
  expectFile(formatForReview({ ...facts, path: path.basename(facts.path) }), "media/probe-text-signal.json");
});
