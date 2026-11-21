/**
 * File Description: Tests for readTranscriptWords: a missing transcript is empty and warning-free, the
 * imported transcript wins, and an unusable transcript file warns instead of passing as empty.
 * Inputs and outputs: temporary package directories with sidecar files -> transcript read assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { readTranscriptWords } from "./transcribe";

/** Writes a package directory holding the given sidecar files and returns the videos dir. */
function makePackage(files: Record<string, string>): string {
  const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-transcript-read-"));
  fs.mkdirSync(path.join(videosDir, "demo"), { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(videosDir, "demo", name), content);
  return videosDir;
}

test("readTranscriptWords: a package without any transcript is empty and warning-free", (t) => {
  const videosDir = makePackage({});
  t.after(() => fs.rmSync(videosDir, { recursive: true, force: true }));
  assert.deepEqual(readTranscriptWords("demo", videosDir), { words: [], source: null });
});

test("readTranscriptWords: the imported transcript wins over the voiceover one", (t) => {
  const word = (w: string) => ({ word: w, start: 0, end: 1 });
  const videosDir = makePackage({
    "import_words.json": JSON.stringify({ words: [word("imported")] }),
    "voiceover_words.json": JSON.stringify({ words: [word("voiceover")] }),
  });
  t.after(() => fs.rmSync(videosDir, { recursive: true, force: true }));
  const read = readTranscriptWords("demo", videosDir);
  assert.equal(read.source, "import_words.json");
  assert.deepEqual(read.words.map((w) => w.word), ["imported"]);
  assert.equal(read.warning, undefined);
});

test("readTranscriptWords: an existing but unusable transcript warns instead of passing as empty", (t) => {
  const cases: Array<[string, string, RegExp]> = [
    ["not json", "{ broken", /could not be read/],
    ["no words list", JSON.stringify({ text: "hi" }), /no "words" list/],
    ["bad entries", JSON.stringify({ words: [{ word: "ok", start: 0, end: 1 }, { word: "bad", start: "x" }] }), /1 of 2 word entries/],
  ];
  for (const [label, content, expected] of cases) {
    const videosDir = makePackage({ "voiceover_words.json": content });
    t.after(() => fs.rmSync(videosDir, { recursive: true, force: true }));
    const read = readTranscriptWords("demo", videosDir);
    assert.equal(read.source, "voiceover_words.json", label);
    assert.deepEqual(read.words, [], label);
    assert.match(read.warning ?? "", expected, label);
  }
});
