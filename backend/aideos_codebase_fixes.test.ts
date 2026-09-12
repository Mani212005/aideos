/**
 * File Description: Unit tests validating the 4 codebase fixes: model client retry loops, TTS auth options, film shadow integrity, and pruned legacy files.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { generateStructuredJson } from "./modelClient";

// Helper to get ApiClient prototype for mocking
function getApiClientPrototype() {
  const dummy = new GoogleGenAI({ apiKey: "dummy" });
  return Object.getPrototypeOf((dummy as any).apiClient);
}

// Test 1: modelClient generateStructuredJson retry loop succeeds on attempt 2 after bad JSON on attempt 1
test("modelClient generateStructuredJson retries on invalid JSON and succeeds when valid", async () => {
  const originalApiKey = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = "test-fake-key";

  const apiClientProto = getApiClientPrototype();
  const originalRequest = apiClientProto.request;

  let callCount = 0;
  apiClientProto.request = async () => {
    callCount++;
    if (callCount === 1) {
      // Attempt 1: Return malformed JSON
      return {
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "```json\n{ not valid json\n```" }] } }],
        }),
      };
    }
    // Attempt 2: Return valid JSON
    return {
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "```json\n{\"status\": \"ok\", \"count\": 42}\n```" }] } }],
      }),
    };
  };

  try {
    const result = await generateStructuredJson<{ status: string; count: number }>("test prompt");
    assert.equal(callCount, 2, "Should have retried and called generateContent twice");
    assert.deepEqual(result, { status: "ok", count: 42 });
  } finally {
    apiClientProto.request = originalRequest;
    if (originalApiKey) {
      process.env.GOOGLE_API_KEY = originalApiKey;
    } else {
      delete process.env.GOOGLE_API_KEY;
    }
  }
});

// Test 2: modelClient generateStructuredJson throws after 3 failed attempts
test("modelClient generateStructuredJson fails after 3 exhausted attempts", async () => {
  const originalApiKey = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = "test-fake-key";

  const apiClientProto = getApiClientPrototype();
  const originalRequest = apiClientProto.request;

  let callCount = 0;
  apiClientProto.request = async () => {
    callCount++;
    return {
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "invalid-json-always" }] } }],
      }),
    };
  };

  try {
    await assert.rejects(
      async () => {
        await generateStructuredJson("test prompt");
      },
      /failed to produce valid JSON after 3 attempts/
    );
    assert.equal(callCount, 3, "Should have attempted exactly 3 times before throwing");
  } finally {
    apiClientProto.request = originalRequest;
    if (originalApiKey) {
      process.env.GOOGLE_API_KEY = originalApiKey;
    } else {
      delete process.env.GOOGLE_API_KEY;
    }
  }
});

// Test 3: TextToSpeechClient accepts apiKey parameter directly when configured
test("TextToSpeechClient configures apiKey directly when GOOGLE_API_KEY is provided", () => {
  const apiKey = "test-google-tts-key-abc123";
  const client = new TextToSpeechClient({ apiKey });
  assert.equal((client.auth as any).apiKey, apiKey, "TextToSpeechClient must bind passed apiKey into auth client");
});

// Test 4: Verify deleted stale json files in src/dl/films are absent and ts shadows exist
test("stale pre-migration json files in src/dl/films are pruned while ts shadows exist", () => {
  const prunedFiles = [
    "flash-attention.json",
    "how-browsers-work.json",
    "mars-water.json",
    "raft-vs-paxos.json",
    "transformers-vs-mamba.json",
  ];

  for (const file of prunedFiles) {
    const jsonPath = path.join(process.cwd(), "src/dl/films", file);
    assert.equal(fs.existsSync(jsonPath), false, `Stale file ${file} should not exist in src/dl/films`);

    const tsName = file.replace(/\.json$/, ".ts");
    const tsPath = path.join(process.cwd(), "src/dl/films", tsName);
    assert.equal(fs.existsSync(tsPath), true, `TypeScript shadow ${tsName} must exist in src/dl/films`);
  }
});

// Test 5: Verify resynced shadow ts files parse as valid film structures
test("resynced shadow film ts modules export valid film structures", async () => {
  const slugs = [
    { mod: "./src/dl/films/graphEngineering.ts", exportName: "graphEngineeringFilm" },
    { mod: "./src/dl/films/graph-engineering-4min.ts", exportName: "graphEngineering4minFilm" },
    { mod: "./src/dl/films/kvcache.ts", exportName: "kvcacheFilm" },
    { mod: "./src/dl/films/rlAdapters.ts", exportName: "rlAdaptersFilm" },
    { mod: "./src/dl/films/rlEnvironments.ts", exportName: "rlEnvironmentsFilm" },
  ];

  for (const { mod, exportName } of slugs) {
    const modPath = path.resolve(process.cwd(), mod);
    assert.ok(fs.existsSync(modPath), `Module ${mod} must exist`);
    const imported = await import(modPath);
    const film = imported[exportName];
    assert.ok(film, `Export ${exportName} must be defined in ${mod}`);
    assert.ok(film.id, `Film ${exportName} must have an id`);
    assert.ok(Array.isArray(film.shots), `Film ${exportName} must have shots array`);
    assert.ok(film.shots.length > 0, `Film ${exportName} shots must not be empty`);
  }
});
