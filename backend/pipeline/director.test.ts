/**
 * File Description: Tests for the auto-prompt director (backend/pipeline/director.ts). Pins the
 * guarantees docs/DIRECTOR_GUIDE.md and the captain's brief describe in prose: a screenplay is
 * drafted by whatever generator is wired in (never a canned template), a rejected draft is retried
 * with the specific reason fed back to the model, an exhausted retry budget fails loudly rather than
 * falling back to a stub, and a passing draft is produced through the real pipeline end to end.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { draftScreenplay, runDirector, type GenerateScreenplayFn } from "./director";
import { readFilm, slugify, VIDEOS_DIR, FILMS_DIR } from "./filmStore";

/** A screenplay that always parses: one section, one narration beat, naming the topic in the title. */
function screenplayFor(topic: string): string {
  return `# ${topic}

## Why It Matters

[VISUAL] a bold title card naming the idea
[ON SCREEN] ${topic}
[NARRATION] Today we explain ${topic} from first principles, and why it matters.

## The Mechanism

[VISUAL] a diagram of the mechanism
[NARRATION] Here is exactly how it works, laid out step by step for the viewer.
`;
}

/** Builds a fake generator that always returns a valid, topic-derived screenplay. */
function fakeGenerator(): GenerateScreenplayFn {
  return async (prompt) => screenplayFor(prompt);
}

test("draftScreenplay: a valid first draft is accepted without retrying", async () => {
  let calls = 0;
  const generate: GenerateScreenplayFn = async (prompt) => {
    calls += 1;
    return screenplayFor(prompt);
  };

  const drafted = await draftScreenplay("Speculative Decoding", { generateScreenplay: generate });
  assert.equal(calls, 1);
  assert.equal(drafted.attempts, 1);
  assert.equal(drafted.title, "Speculative Decoding");
  assert.ok(drafted.screenplay.includes("[NARRATION]"));
});

test("draftScreenplay: the plan is model-driven, not a canned template", async () => {
  const a = await draftScreenplay("Paxos Consensus", { generateScreenplay: fakeGenerator() });
  const b = await draftScreenplay("KV Cache Eviction", { generateScreenplay: fakeGenerator() });

  assert.notEqual(a.screenplay, b.screenplay, "two different prompts must not draft the same screenplay");
  assert.equal(a.title, "Paxos Consensus");
  assert.equal(b.title, "KV Cache Eviction");
});

test("draftScreenplay: retries a rejected draft, feeding back the specific reason", async () => {
  const reasonsSeen: Array<string | undefined> = [];
  const generate: GenerateScreenplayFn = async (prompt, reason) => {
    reasonsSeen.push(reason);
    if (reasonsSeen.length === 1) return "not a screenplay at all, just prose with no beats";
    return screenplayFor(prompt);
  };

  const drafted = await draftScreenplay("Retry Case", { generateScreenplay: generate });
  assert.equal(drafted.attempts, 2);
  assert.equal(reasonsSeen[0], undefined, "the first attempt gets no rejection reason yet");
  assert.ok(reasonsSeen[1] && reasonsSeen[1].length > 0, "the retry must be told why the prior draft failed");
});

test("draftScreenplay: a draft with sections but no [NARRATION] beat is rejected", async () => {
  const generate: GenerateScreenplayFn = async () => `# Silent Film

## Only Visuals

[VISUAL] something happens on screen
[ON SCREEN] but nobody ever speaks
`;

  await assert.rejects(
    () => draftScreenplay("Silent Film", { generateScreenplay: generate, maxAttempts: 1 }),
    /NARRATION/,
  );
});

test("draftScreenplay: exhausting every attempt fails loudly instead of falling back to a stub", async () => {
  let calls = 0;
  const generate: GenerateScreenplayFn = async () => {
    calls += 1;
    return "";
  };

  await assert.rejects(
    () => draftScreenplay("Always Empty", { generateScreenplay: generate, maxAttempts: 3 }),
    /could not produce a usable screenplay/,
  );
  assert.equal(calls, 3, "every attempt must be spent before giving up");
});

test("draftScreenplay: an empty prompt is rejected before the generator is ever called", async () => {
  let called = false;
  const generate: GenerateScreenplayFn = async () => {
    called = true;
    return screenplayFor("x");
  };

  await assert.rejects(() => draftScreenplay("   ", { generateScreenplay: generate }), /cannot be empty/);
  assert.equal(called, false);
});

test("draftScreenplay: with no generator injected and no cloud key configured, fails clearly rather than silently stubbing a film", async () => {
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  try {
    await assert.rejects(() => draftScreenplay("Unconfigured Case"), /GEMINI_API_KEY|GOOGLE_API_KEY/);
  } finally {
    if (originalGemini) process.env.GEMINI_API_KEY = originalGemini;
    if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
  }
});

// End-to-end: a prompt drafted by an injected director produces a real, verified package through
// the same pipeline a hand-written screenplay goes through - the guarantee docs/DIRECTOR_GUIDE.md
// and the agent director invariants test assert, exercised here for the auto-prompt entry point
// specifically rather than only for compileFilmFromScreenplay in isolation.
test("runDirector: a prompt is drafted and produced through the real pipeline end to end", async () => {
  const prompt = "Why Attention Scales Quadratically";
  const slug = slugify(`director-${prompt}-${Date.now().toString(36)}`);

  try {
    const result = await runDirector(
      {
        prompt,
        slug,
        generateScreenplay: fakeGenerator(),
        ttsBackend: "tone",
        broll: false,
        stopAfter: "design",
        resume: false,
      },
      () => undefined,
    );

    assert.equal(result.prompt, prompt);
    assert.equal(result.draftAttempts, 1);
    assert.equal(result.screenplay, screenplayFor(prompt).trim());
    assert.equal(result.title, prompt, "the title drafted into the screenplay's '# ' line must be used");

    const pkgDir = path.dirname(result.scriptPath);
    for (const name of ["script.md", "voiceover.wav", "film.json"]) {
      assert.ok(fs.existsSync(path.join(pkgDir, name)), `${name} must be written by the real pipeline`);
    }
    assert.equal(fs.readFileSync(result.scriptPath, "utf8"), result.screenplay);

    const film = readFilm(slug);
    assert.ok(film, "the design stage must have produced a schema-valid film (parseFilm already gates writeFilm)");
    assert.ok(film.chapters.length >= 1 && film.chapters.length <= 12);
    assert.equal(film.shots[0].move, "cut");
  } finally {
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
  }
});

test("runDirector: an explicit title overrides the one the screenplay drafts for itself", async () => {
  const prompt = "Override Title Case";
  const slug = slugify(`director-${prompt}-${Date.now().toString(36)}`);

  try {
    const result = await runDirector(
      {
        prompt,
        slug,
        title: "The Overridden Title",
        generateScreenplay: fakeGenerator(),
        ttsBackend: "tone",
        broll: false,
        stopAfter: "design",
        resume: false,
      },
      () => undefined,
    );

    assert.equal(result.title, "The Overridden Title");
  } finally {
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
  }
});
