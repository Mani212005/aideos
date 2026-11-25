/**
 * File Description: Expect-test helper: renders a structured value as stable, diff-friendly JSON (small objects and arrays stay on one line, so a changed keyframe is one changed line) and compares it with a committed expected file under test_fixtures/expect/. The expected files are captured from the real code, never typed. After an intended change, run the test with AIDEOS_UPDATE_EXPECT=1 to rewrite them, then review the git diff line by line before committing.
 * Inputs and outputs: a value or text and an expected-file path -> returns when equal, throws with the first differing line and the update command when not (or when the file is missing).
 * Used by: backend/renderIr/emit.expect.test.ts, backend/timelineResults.expect.test.ts, backend/pipeline/filmJson.expect.test.ts, backend/modelReply.expect.test.ts, backend/jev.expect.test.ts, backend/media/probe.expect.test.ts, backend/geminiReview/geminiReview.expect.test.ts.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** Root folder of the committed expected outputs. */
export const EXPECT_DIR = path.resolve(__dirname, "../../test_fixtures/expect");

// Renders a JSON value with two-space indent, keeping any object or array whose compact form fits `width` on one line.
export function formatForReview(value: unknown, width = 130): string {
  const render = (node: unknown, indent: string): string => {
    const compact = JSON.stringify(node);
    if (compact === undefined) throw new Error("formatForReview cannot render undefined");
    if (node === null || typeof node !== "object" || compact.length + indent.length <= width) return compact;
    const inner = `${indent}  `;
    if (Array.isArray(node)) return `[\n${node.map((item) => `${inner}${render(item, inner)}`).join(",\n")}\n${indent}]`;
    const entries = Object.entries(node as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${render(v, inner)}`).join(",\n")}\n${indent}}`;
  };
  return `${render(value, "")}\n`;
}

// Describes the first line where two texts differ, with a little context, for a readable failure.
function firstDifference(expected: string, actual: string): string {
  const want = expected.split("\n");
  const got = actual.split("\n");
  const limit = Math.max(want.length, got.length);
  for (let i = 0; i < limit; i++) {
    if (want[i] !== got[i]) {
      return `first difference at line ${i + 1} (expected ${want.length} lines, got ${got.length}):\n  expected: ${want[i] ?? "(end of file)"}\n  actual:   ${got[i] ?? "(end of file)"}`;
    }
  }
  return "texts differ";
}

// Compares `actual` with the committed expected file; AIDEOS_UPDATE_EXPECT=1 rewrites the file instead.
export function expectFile(actual: string, relativePath: string): void {
  const target = path.join(EXPECT_DIR, relativePath);
  if (!path.resolve(target).startsWith(`${EXPECT_DIR}${path.sep}`)) throw new Error(`expected file ${relativePath} is outside test_fixtures/expect`);
  if (process.env.AIDEOS_UPDATE_EXPECT === "1") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, actual, "utf8");
    return;
  }
  const hint = `Review the change, then update with: AIDEOS_UPDATE_EXPECT=1 node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test <test file>`;
  assert.ok(fs.existsSync(target), `missing expected file test_fixtures/expect/${relativePath}. ${hint}`);
  const expected = fs.readFileSync(target, "utf8");
  assert.ok(expected === actual, `test_fixtures/expect/${relativePath} no longer matches: ${firstDifference(expected, actual)}\n${hint}`);
}
