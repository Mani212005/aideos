/**
 * File Description: Unit tests validating the 4 codebase fixes: model client retry loops, TTS auth options, generated film shadow modules.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import "./testSupport/fixtureVideosDir";
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

// Test 4: the generated shadow modules are rebuilt from the packages on disk, never committed
test("ensureGenerated writes film shadow modules that export valid film structures and survive a re-run", async () => {
  const { ensureGenerated } = await import("./pipeline/generatedFiles");
  const { listVideoPackages } = await import("../src/dl/videoPackageLoader");
  const slugs = ["hello-scene", "sample-explainer"];
  for (const slug of slugs) assert.ok(listVideoPackages().includes(slug), `package ${slug} must be discoverable`);

  const first = ensureGenerated();
  assert.ok(first.shadows >= 0 && first.activeFilm.length > 0, "an active film must always be pointed at");
  assert.equal(ensureGenerated().shadows, 0, "a second run has nothing to rewrite");

  for (const slug of slugs) {
    const modPath = path.resolve(process.cwd(), "src/dl/films", `${slug}.ts`);
    assert.ok(fs.existsSync(modPath), `shadow ${slug}.ts must be generated`);
    const imported = await import(modPath);
    const film = Object.values(imported).find((v: any) => v && v.id === slug) as any;
    assert.ok(film, `shadow ${slug}.ts must export the film`);
    assert.ok(Array.isArray(film.shots) && film.shots.length > 0, `film ${slug} shots must not be empty`);
  }
});
