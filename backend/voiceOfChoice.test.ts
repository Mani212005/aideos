/**
 * File Description: Tests for the voice of choice rule (captain's decision, 2026-11-21: the owner's
 * cloned voice is the default voice for every film, test and run). They prove the deterministic fake
 * voice service speaks the real vcd protocol so the real client, backend name and cache key come out
 * as production's, that tests default to the owner voice, and that the design check fails a package
 * narrated by another voice unless the override is set, and that Studio records the voice that spoke as the
 * narrator of record in narration.json.
 * Inputs and outputs: the fake voice service, the real vcd client and a fixture film -> narrator, cache key and design check assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "./testSupport/fixtureVideosDir";
import { FAKE_OWNER_BACKEND_NAME, FAKE_OWNER_VOICE_ID, FAKE_OWNER_VOICE_NAME, voiceOfChoiceChildEnv } from "./testSupport/fakeVcd";
import { startEditor } from "./testSupport/studioDriver";
import { checkFilmDesign, checkFilmDesignById } from "./designCheck/designCheck";
import { PCM_SAMPLE_RATE, createTtsBackend } from "./tts";
import { resolveVcdVoiceId, synthesizeWithVcd, VcdUnavailableError } from "./vcdClient";
import { isVoiceOfChoiceNarrator, narratorKind, OTHER_VOICE_OVERRIDE_ENV, voiceOfChoiceFinding } from "./voiceOfChoice";

// Loads a fresh copy of the reference film the design check tests use.
function referenceFilm(): unknown {
  return JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "still-talking/film.json"), "utf8"));
}

// Runs a body with the narrator override variable set to a value (or removed), restoring it afterwards.
function withOverride<T>(value: string | undefined, body: () => T): T {
  const previous = process.env[OTHER_VOICE_OVERRIDE_ENV];
  if (value === undefined) delete process.env[OTHER_VOICE_OVERRIDE_ENV];
  else process.env[OTHER_VOICE_OVERRIDE_ENV] = value;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env[OTHER_VOICE_OVERRIDE_ENV];
    else process.env[OTHER_VOICE_OVERRIDE_ENV] = previous;
  }
}

test("voice of choice: with no options a test narrates in the owner voice through the real vcd client", async () => {
  const backend = await createTtsBackend();
  assert.equal(backend.name, FAKE_OWNER_BACKEND_NAME, "the backend name is the real vcd:<voice id>:<language> cache key");
  assert.equal(backend.voice, FAKE_OWNER_VOICE_ID);
  assert.ok(isVoiceOfChoiceNarrator(backend.name));

  const hindi = await createTtsBackend({ voice: "vcd-my-voice-hi" });
  assert.equal(hindi.name, `vcd:${FAKE_OWNER_VOICE_ID}:hi`, "the Hindi Studio key selects the same owner voice in Hindi");

  const resolved = await resolveVcdVoiceId({});
  assert.deepEqual([resolved.voiceId, resolved.voiceName], [FAKE_OWNER_VOICE_ID, FAKE_OWNER_VOICE_NAME]);
});

test("voice of choice: the fake service returns deterministic tone audio sized from the words, never speech", async () => {
  const backend = await createTtsBackend();
  const text = "One two three four five six seven eight nine ten.";
  const first = await backend.synthesize(text);
  const second = await backend.synthesize(text);
  assert.deepEqual(first, second, "the same text always gives the same samples");
  assert.equal(first.length, Math.round((10 / 150) * 60 * PCM_SAMPLE_RATE), "ten words last four seconds at 150 words a minute");
  assert.ok(first.some((sample) => Math.abs(sample) > 0.01), "the tone is audible so silence trimming keeps it");
  assert.ok(first.every((sample) => Math.abs(sample) < 0.06), "the tone stays quiet");
  const short = await backend.synthesize("Hi.");
  assert.equal(short.length, Math.round(0.4 * PCM_SAMPLE_RATE), "a very short line holds the 0.4 second floor");
});

test("voice of choice: the fake keeps the real service's rules (unknown voice, empty text, loopback only)", async () => {
  await assert.rejects(
    synthesizeWithVcd({ text: "Hello there.", voiceId: "voice_someone_else" }),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "voice_not_found",
  );
  await assert.rejects(
    synthesizeWithVcd({ text: "   " }),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "bad_response",
  );
  await assert.rejects(
    resolveVcdVoiceId({ url: "http://voices.example.com:8740" }),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "invalid_url",
  );
  const viaLocalhost = await synthesizeWithVcd({ text: "Hello there.", url: "http://localhost:8740" });
  assert.equal(viaLocalhost.voiceId, FAKE_OWNER_VOICE_ID, "the localhost spelling of the default address reaches the fake too");
});

test("voice of choice: narrators are read from what the pipeline and Studio really record", () => {
  const owner = [FAKE_OWNER_BACKEND_NAME, "vcd-my-voice", "vcd-my-voice-hi", "vcd:voice_abc123:hi"];
  const other = ["kokoro:af_heart", "kokoro-am_adam", "kokoro|af_heart|0.75", "google:en-US-Journey-F", "say:Samantha", "macos-samantha", "aura-asteria-en", "tone", "futurevoice:v2"];
  for (const name of owner) assert.equal(isVoiceOfChoiceNarrator(name), true, name);
  for (const name of other) assert.equal(isVoiceOfChoiceNarrator(name), false, name);
  assert.equal(narratorKind(undefined), "");
  assert.equal(narratorKind("  Kokoro:af_heart "), "kokoro");

  for (const name of other) assert.equal(voiceOfChoiceFinding(name, false)?.severity, "error", name);
  for (const name of other) assert.equal(voiceOfChoiceFinding(name, true)?.severity, "warning", name);
  for (const name of owner) assert.equal(voiceOfChoiceFinding(name, false), null, name);
  for (const missing of [undefined, null, "", "   ", 7, {}]) {
    assert.equal(voiceOfChoiceFinding(missing, false)?.severity, "error", `a recorded narrator of ${JSON.stringify(missing)} is not shown to be the voice of choice`);
    assert.match(voiceOfChoiceFinding(missing, false)?.message ?? "", /records no narrator/);
    assert.equal(voiceOfChoiceFinding(missing, true)?.severity, "warning");
  }
});

test("voice of choice: the design check fails a film narrated by another voice, passes the owner voice, and an override stays visible", () => {
  const film = referenceFilm();
  const rules = (narrator: string, allowOtherVoice: boolean) =>
    checkFilmDesign(film, { narration: { ttsBackend: narrator }, allowOtherVoice }).findings.filter((f) => f.rule === "voice-of-choice");

  assert.deepEqual(rules(FAKE_OWNER_BACKEND_NAME, false), []);
  const rejected = rules("kokoro:af_heart", false);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].severity, "error");
  assert.match(rejected[0].message, /not the voice of choice/);
  assert.match(rejected[0].message, new RegExp(OTHER_VOICE_OVERRIDE_ENV));
  assert.equal(checkFilmDesign(film, { narration: { ttsBackend: "kokoro:af_heart" } }).ok, false);

  const allowed = rules("kokoro:af_heart", true);
  assert.equal(allowed.length, 1);
  assert.equal(allowed[0].severity, "warning", "the override keeps the film shippable but the report still names the other voice");
  assert.equal(checkFilmDesign(film, { narration: { ttsBackend: "kokoro:af_heart" }, allowOtherVoice: true }).ok, true);
});

test("voice of choice: the design check by film id reads narration.json and honours the override variable", () => {
  const narrationFile = path.join(TEST_VIDEOS_DIR, "still-talking", "narration.json");
  const writeNarrator = (ttsBackend: string) => fs.writeFileSync(narrationFile, JSON.stringify({ ttsBackend }));
  const voiceFindings = () => checkFilmDesignById("still-talking").findings.filter((f) => f.rule === "voice-of-choice");
  try {
    assert.deepEqual(withOverride(undefined, voiceFindings), [], "no narration.json, nothing to judge");

    writeNarrator(FAKE_OWNER_BACKEND_NAME);
    assert.deepEqual(withOverride(undefined, voiceFindings), []);

    writeNarrator("google:en-US-Journey-F");
    const failing = withOverride(undefined, () => checkFilmDesignById("still-talking"));
    assert.equal(failing.ok, false);
    assert.equal(failing.findings.find((f) => f.rule === "voice-of-choice")?.where, "narration.json");

    const overridden = withOverride("1", () => checkFilmDesignById("still-talking"));
    assert.equal(overridden.ok, true);
    assert.equal(overridden.findings.find((f) => f.rule === "voice-of-choice")?.severity, "warning");
    assert.equal(withOverride("0", () => checkFilmDesignById("still-talking")).ok, false, "only an explicit 1 or true allows another voice");

    fs.writeFileSync(narrationFile, JSON.stringify({ voice: "af_heart" }));
    const unrecorded = withOverride(undefined, () => checkFilmDesignById("still-talking"));
    assert.equal(unrecorded.ok, false, "an existing narration.json with no ttsBackend is reported, not passed silently");
    assert.match(unrecorded.findings.find((f) => f.rule === "voice-of-choice")?.message ?? "", /records no narrator/);

    fs.writeFileSync(narrationFile, "{ not json");
    assert.deepEqual(withOverride(undefined, voiceFindings), [], "unreadable narration.json is left to the stages that own it");
  } finally {
    fs.rmSync(narrationFile, { force: true });
  }
});

test("Studio /api/generate-voiceover writes the voice that spoke as narration.json ttsBackend", async () => {
  const videosDir = path.resolve(".tmp", `m6-narrator-of-record-${process.pid}`);
  fs.mkdirSync(videosDir, { recursive: true });
  // The dev server child narrates through the deterministic fake voice service, never a real one.
  const childEnv = voiceOfChoiceChildEnv();
  const previousOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = childEnv.NODE_OPTIONS;
  let server: Awaited<ReturnType<typeof startEditor>> | undefined;
  try {
    server = await startEditor(videosDir);
    const response = await fetch(new URL("/api/generate-voiceover", server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(server.url).origin },
      body: JSON.stringify({ projectId: "m6-narrator", voice: "vcd-my-voice", spokenTextOverride: "First line of the story.\n\nSecond line of the story." }),
    });
    assert.equal(response.status, 200);
    const narration = JSON.parse(fs.readFileSync(path.join(videosDir, "m6-narrator", "narration.json"), "utf8")) as { ttsBackend?: string };
    assert.equal(narration.ttsBackend, FAKE_OWNER_BACKEND_NAME, "every line was spoken by the owner voice, so it is the narrator of record");

    // The checks that ran on the final audio are reported, including the explicit off switches the test host sets.
    const body = (await response.json()) as { cleanup?: { status: string }; flowCheck?: { passed: boolean }; pronunciationCheck?: { status: string; reason?: string }; lines?: { recorded: number; reused: number } };
    assert.equal(body.cleanup?.status, "disabled");
    assert.equal(body.flowCheck?.passed, true);
    assert.equal(body.pronunciationCheck?.status, "disabled");
    assert.match(body.pronunciationCheck?.reason ?? "", /AIDEOS_PRONUNCIATION_CHECK=off/);
    assert.equal(body.lines?.recorded, 2);
    const persisted = JSON.parse(fs.readFileSync(path.join(videosDir, "m6-narrator", "narration.json"), "utf8")) as { pronunciationCheck?: { status: string }; cleanup?: { status: string } };
    assert.equal(persisted.pronunciationCheck?.status, "disabled");
    assert.equal(persisted.cleanup?.status, "disabled");

    // A second request reuses both recordings: the lexicon-tagged line key is stable between runs.
    const again = await fetch(new URL("/api/generate-voiceover", server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(server.url).origin },
      body: JSON.stringify({ projectId: "m6-narrator", voice: "vcd-my-voice", spokenTextOverride: "First line of the story.\n\nSecond line of the story." }),
    });
    assert.equal(again.status, 200);
    assert.deepEqual(((await again.json()) as { lines: { recorded: number; reused: number } }).lines, { total: 2, recorded: 0, reused: 2 });
  } finally {
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousOptions;
    server?.stop();
    fs.rmSync(videosDir, { recursive: true, force: true });
  }
});

test("Studio narration status still detects a Hindi project whose stored line key carries a lexicon digest", async () => {
  const videosDir = path.resolve(".tmp", `hindi-detect-${process.pid}`);
  const pkgDir = path.join(videosDir, "hindi-detect");
  fs.mkdirSync(path.join(pkgDir, "voiceover_lines"), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "script.md"), "A line of the story.\n", "utf8");
  fs.writeFileSync(
    path.join(pkgDir, "voiceover_lines", "0123456789abcdef.json"),
    JSON.stringify({ voiceKey: `vcd:${FAKE_OWNER_VOICE_ID}:hi|lex=0123abcd|stretch=1.2` }),
    "utf8",
  );
  const childEnv = voiceOfChoiceChildEnv();
  const previousOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = childEnv.NODE_OPTIONS;
  let server: Awaited<ReturnType<typeof startEditor>> | undefined;
  try {
    server = await startEditor(videosDir);
    const response = await fetch(new URL("/api/narration/hindi-detect", server.url), { headers: { origin: new URL(server.url).origin } });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { projectVoice?: string }).projectVoice, "vcd-my-voice-hi");
  } finally {
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousOptions;
    server?.stop();
    fs.rmSync(videosDir, { recursive: true, force: true });
  }
});
