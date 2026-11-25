/**
 * File Description: Behavioural tests for the argument and ranges-file checks of whisperWords.py, run against the real script with system python3. Every bad call must stop at once with a one-line message, before the whisper model stack is imported (these tests need no whisper install).
 * Inputs and outputs: bad argument lists and ranges files -> assertions on the exit status and the message on stderr.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSyncBounded } from "../proc";

const SCRIPT = path.join(__dirname, "whisperWords.py");

// Runs the script with the given arguments and returns its exit status and stderr.
function run(args: string[]): { status: number | null; stderr: string } {
  const r = spawnSyncBounded("python3", ["-I", SCRIPT, ...args], { encoding: "utf8", timeout: 20_000 });
  return { status: r.status, stderr: r.stderr };
}

test("whisperWords.py refuses unusable arguments with a one-line message instead of a traceback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-args-"));
  try {
    const wav = path.join(dir, "vo.wav");
    const out = path.join(dir, "out.json");
    fs.writeFileSync(wav, "not really audio");
    const write = (name: string, body: string): string => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, body);
      return file;
    };

    const cases: Array<[string[], RegExp]> = [
      [[], /usage: whisperWords\.py/],
      [[wav, write("a.json", "[]")], /usage: whisperWords\.py/],
      [[path.join(dir, "missing.wav"), write("b.json", "[]"), out], /audio file not found/],
      [[wav, path.join(dir, "missing.json"), out], /ranges file not found/],
      [[wav, write("c.json", "{not json"), out], /not valid JSON/],
      [[wav, write("d.json", '{"a": 1}'), out], /must hold a list/],
      [[wav, write("e.json", "[[2, 1]]"), out], /0 <= start < end/],
      [[wav, write("f.json", '[[0, "x"]]'), out], /0 <= start < end/],
      [[wav, write("g.json", "[[0, 1]]"), path.join(dir, "nope", "out.json")], /output folder not found/],
    ];
    for (const [args, message] of cases) {
      const { status, stderr } = run(args);
      assert.equal(status, 1, `${args.join(" ")}: ${stderr}`);
      assert.match(stderr, message);
      assert.doesNotMatch(stderr, /Traceback/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
