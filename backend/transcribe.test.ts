/**
 * File Description: Tests for the transcription module. The Deepgram fetch call and the Whisper
 * CLI invocation are both injected dependencies, so these tests exercise the real routing and
 * file-writing logic without ever touching the network or a real ASR subprocess.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { transcribe, writeImportWords, resolveDeepgramApiKey, type TranscribedWord } from "./transcribe";

/** A source file resolveAudioSourcePath can find; content is irrelevant since extraction is injected. */
function makeFixtureSource(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-transcribe-test-"));
  const file = path.join(dir, "clip.mp4");
  fs.writeFileSync(file, "not a real video, only resolveAudioSourcePath needs it to exist");
  return file;
}

test("transcribe: uses the Deepgram path and its injected fetch when an API key is present", async () => {
  const src = makeFixtureSource();
  const wordsFromDeepgram = [{ word: "hello", start: 0, end: 0.5, punctuated_word: "Hello", confidence: 0.98 }];
  let fetchCalled = false;
  let capturedUrl = "";

  const fakeResponse = {
    ok: true,
    json: async () => ({ results: { channels: [{ alternatives: [{ words: wordsFromDeepgram }] }] } }),
    text: async () => "",
  } as Response;

  const result = await transcribe(
    src,
    { deepgramApiKey: "test-key" },
    {
      extractAudioTrack: (_srcPath, outWavPath) => fs.writeFileSync(outWavPath, "fake wav"),
      fetchImpl: (async (url: string) => {
        fetchCalled = true;
        capturedUrl = url;
        return fakeResponse;
      }) as unknown as typeof fetch,
    },
  );

  assert.equal(fetchCalled, true, "the Deepgram path must call the injected fetch");
  assert.match(capturedUrl, /api\.deepgram\.com\/v1\/listen/);
  assert.match(capturedUrl, /filler_words=true/);
  assert.equal(result.backend, "deepgram");
  assert.deepEqual(result.words, [{ word: "hello", start: 0, end: 0.5, punctuated_word: "Hello", confidence: 0.98 }]);
});

test("transcribe: falls back to the injected Whisper runner when no Deepgram key is configured", async () => {
  const src = makeFixtureSource();
  const originalKey = process.env.DEEPGRAM_API_KEY;
  delete process.env.DEEPGRAM_API_KEY;

  try {
    let whisperCalled = false;
    const result = await transcribe(
      src,
      {},
      {
        extractAudioTrack: (_srcPath, outWavPath) => fs.writeFileSync(outWavPath, "fake wav"),
        runWhisper: () => {
          whisperCalled = true;
          return [{ word: "hi", start: 0, end: 0.3 }];
        },
      },
    );

    assert.equal(whisperCalled, true, "the no-key path must call the injected Whisper runner");
    assert.equal(result.backend, "whisper");
    assert.deepEqual(result.words, [{ word: "hi", start: 0, end: 0.3 }]);
  } finally {
    if (originalKey !== undefined) process.env.DEEPGRAM_API_KEY = originalKey;
  }
});

test("transcribe: a failed Deepgram response throws with the status and body", async () => {
  const src = makeFixtureSource();
  const fakeResponse = {
    ok: false,
    status: 401,
    text: async () => "invalid API key",
    json: async () => ({}),
  } as Response;

  await assert.rejects(
    () =>
      transcribe(
        src,
        { deepgramApiKey: "bad-key" },
        {
          extractAudioTrack: (_srcPath, outWavPath) => fs.writeFileSync(outWavPath, "fake wav"),
          fetchImpl: (async () => fakeResponse) as unknown as typeof fetch,
        },
      ),
    /401/,
  );
});

test("resolveDeepgramApiKey: reads DEEPGRAM_API_KEY from the environment when present", () => {
  const original = process.env.DEEPGRAM_API_KEY;
  process.env.DEEPGRAM_API_KEY = "env-key-123";
  try {
    assert.equal(resolveDeepgramApiKey(), "env-key-123");
  } finally {
    if (original === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = original;
  }
});

test("writeImportWords: writes import_words.json in the WordInfo shape and a caption sidecar", () => {
  const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-videos-test-"));
  const words: TranscribedWord[] = [
    { word: "hello", start: 0, end: 0.4, punctuated_word: "Hello", filler: false },
    { word: "um", start: 0.4, end: 0.6, filler: true },
    { word: "world", start: 0.6, end: 1.0, punctuated_word: "world.", filler: false },
  ];

  const { wordsPath, vttPath } = writeImportWords("test-slug", words, videosDir);

  assert.ok(fs.existsSync(wordsPath));
  const parsed = JSON.parse(fs.readFileSync(wordsPath, "utf8"));
  assert.deepEqual(parsed.words, words);

  assert.ok(fs.existsSync(vttPath));
  const vtt = fs.readFileSync(vttPath, "utf8");
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /Hello um world\./);
});

test("transcribe: cleans up temporary directory after transcription finishes", async () => {
  const src = makeFixtureSource();
  let createdWav = "";
  await transcribe(
    src,
    { deepgramApiKey: "test-key" },
    {
      extractAudioTrack: (_srcPath, outWavPath) => {
        createdWav = outWavPath;
        fs.writeFileSync(outWavPath, "fake wav");
      },
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({ results: { channels: [{ alternatives: [{ words: [] }] }] } }),
        text: async () => "",
      })) as unknown as typeof fetch,
    },
  );
  assert.ok(createdWav, "extractAudioTrack must have received an output path");
  assert.equal(fs.existsSync(path.dirname(createdWav)), false, "temporary directory must be removed");
});

test("transcribe: cleans up temporary directory when transcription fails", async () => {
  const src = makeFixtureSource();
  let createdWav = "";
  await assert.rejects(
    () =>
      transcribe(
        src,
        { deepgramApiKey: "bad-key" },
        {
          extractAudioTrack: (_srcPath, outWavPath) => {
            createdWav = outWavPath;
            fs.writeFileSync(outWavPath, "fake wav");
          },
          fetchImpl: (async () => ({
            ok: false,
            status: 500,
            text: async () => "server error",
            json: async () => ({}),
          })) as unknown as typeof fetch,
        },
      ),
    /500/,
  );
  assert.ok(createdWav, "extractAudioTrack must have received an output path");
  assert.equal(fs.existsSync(path.dirname(createdWav)), false, "temporary directory must be removed on error");
});
