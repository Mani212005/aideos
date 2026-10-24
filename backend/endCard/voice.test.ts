/**
 * File Description: Covers the end card's spoken line: reading the narration voice from narration.json,
 * synthesizing the line once in that voice (cached by fingerprint), attaching it to the film, the
 * silent card and notice for a package narrated before its voice was recorded, and the off cases.
 * Inputs and outputs: throwaway packages in the fixture videos dir and a stub synthesizer -> ensureEndCardVoice assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseDeliveryConfig } from "../../src/dl/delivery";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import type { ProduceAudioResult } from "../audio";
import { readFilm, writeFilm } from "../pipeline/filmStore";
import { FILMS_DIR } from "../pipeline/generatedFiles";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { endCardLineFingerprint, ensureEndCardVoice, narrationVoiceOf, readNarrationVoice, type LineSynthesizer } from "./voice";

// Creates a package with a narrated fixture film and, optionally, a narration.json.
function makePackage(tag: string, narration?: Record<string, unknown>): string {
  const slug = `endcard-${tag}-${Date.now().toString(36)}`;
  const film = { ...loadFixtureFilm("fixture-canvas-a"), id: slug, voiceover: { src: `videos/${slug}/voiceover.wav`, volume: 1, durationSec: 20 } };
  writeFilm(slug, film);
  if (narration) fs.writeFileSync(path.join(getVideosDir(), slug, "narration.json"), JSON.stringify(narration));
  return slug;
}

// Removes a throwaway package and the film shadow writeFilm made for it.
function cleanPackage(slug: string): void {
  fs.rmSync(path.join(getVideosDir(), slug), { recursive: true, force: true });
  fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
}

// A synthesizer that records its calls and writes a placeholder wav instead of running TTS.
function stubSynth(calls: Array<{ text: string; options: unknown }>): LineSynthesizer {
  return async (text, outDir, options) => {
    calls.push({ text, options });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "voiceover.wav"), "wav");
    const words = text.split(/\s+/).map((word, i) => ({ word: word.replace(/[^\w]/g, ""), punctuated_word: word, start: i * 0.35, end: i * 0.35 + 0.3 }));
    return { ttsBackend: `${options.backend}:${options.voice ?? ""}`, totalAudioDuration: 2.1, words } as unknown as ProduceAudioResult;
  };
}

const KOKORO = { ttsBackend: "kokoro:af_heart", voice: "af_heart", speed: 0.75 };

test("end card voice: the narration voice is read from what narration.json records", () => {
  assert.deepEqual(narrationVoiceOf(KOKORO), { backend: "kokoro", voice: "af_heart", speed: 0.75 });
  assert.deepEqual(narrationVoiceOf({ ttsBackend: "tone", voice: null, speed: null }), { backend: "tone", voice: null, speed: null });
  assert.equal(narrationVoiceOf({ ttsBackend: "mystery:x", voice: null, speed: null }), null);
  const known = makePackage("known", KOKORO);
  const legacy = makePackage("legacy", { ttsBackend: "kokoro:af_heart", segments: [] });
  try {
    assert.deepEqual(readNarrationVoice(path.join(getVideosDir(), known)), { backend: "kokoro", voice: "af_heart", speed: 0.75 });
    assert.equal(readNarrationVoice(path.join(getVideosDir(), legacy)), null, "a package narrated before voice was recorded has no known voice");
  } finally {
    for (const slug of [known, legacy]) cleanPackage(slug);
  }
});

test("end card voice: the line is synthesized once in the narration voice and attached to the film", async () => {
  const slug = makePackage("spoken", KOKORO);
  const calls: Array<{ text: string; options: unknown }> = [];
  try {
    const first = await ensureEndCardVoice(slug, { synthesize: stubSynth(calls) });
    assert.equal(first.state, "spoken");
    assert.equal(first.changed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, "If this helped, like and subscribe.");
    assert.deepEqual(calls[0].options, { backend: "kokoro", voice: "af_heart", speed: 0.75 });
    const onDisk = readFilm(slug)!;
    assert.equal(onDisk.endCardVoice?.src, `videos/${slug}/endcard/voiceover.wav`);
    assert.equal(onDisk.endCardVoice?.fingerprint, endCardLineFingerprint("If this helped, like and subscribe.", { backend: "kokoro", voice: "af_heart", speed: 0.75 }));
    assert.equal(onDisk.endCardVoice?.words[onDisk.endCardVoice.words.length - 1]?.word, "subscribe.");

    // Already current: nothing is synthesized or written.
    const again = await ensureEndCardVoice(slug, { synthesize: stubSynth(calls) });
    assert.equal(again.changed, false);
    assert.equal(calls.length, 1);

    // A film that lost the line (a design rebuild from an old base film) gets it back from line.json.
    const stripped = { ...onDisk };
    delete stripped.endCardVoice;
    const healed = await ensureEndCardVoice(slug, { film: stripped, write: false, synthesize: stubSynth(calls) });
    assert.deepEqual(healed.film.endCardVoice, onDisk.endCardVoice);
    assert.equal(calls.length, 1, "the cached line.json is reused, not re-synthesized");

    // A new line is a new fingerprint and a new synthesis.
    const config = parseDeliveryConfig({ endCard: { spokenLine: "Thanks, subscribe for more." } });
    const changed = await ensureEndCardVoice(slug, { config, synthesize: stubSynth(calls) });
    assert.equal(calls.length, 2);
    assert.equal(changed.film.endCardVoice?.text, "Thanks, subscribe for more.");
  } finally {
    cleanPackage(slug);
  }
});

test("end card voice: an unknown voice keeps the card silent with a notice instead of guessing", async () => {
  const slug = makePackage("unknown", { ttsBackend: "kokoro:af_heart" });
  const calls: Array<{ text: string; options: unknown }> = [];
  try {
    const result = await ensureEndCardVoice(slug, { synthesize: stubSynth(calls) });
    assert.equal(result.state, "silent");
    assert.equal(result.changed, false);
    assert.match(result.notice ?? "", /Generate end card line/);
    assert.equal(calls.length, 0);
    assert.equal(readFilm(slug)?.endCardVoice, undefined);
  } finally {
    cleanPackage(slug);
  }
});

test("end card voice: no card, no line and no narration all leave the card silent", async () => {
  const slug = makePackage("off", KOKORO);
  const calls: Array<{ text: string; options: unknown }> = [];
  try {
    await ensureEndCardVoice(slug, { synthesize: stubSynth(calls) });
    const off = await ensureEndCardVoice(slug, { config: parseDeliveryConfig({ endCard: { enabled: false } }), synthesize: stubSynth(calls) });
    assert.equal(off.state, "silent");
    assert.equal(off.changed, true, "turning the card off drops the line");
    assert.equal(readFilm(slug)?.endCardVoice, undefined);

    const noLine = await ensureEndCardVoice(slug, { config: parseDeliveryConfig({ endCard: { spokenLine: "" } }), synthesize: stubSynth(calls) });
    assert.equal(noLine.state, "silent");

    const film = readFilm(slug)!;
    const mute = { ...film };
    delete mute.voiceover;
    const silentFilm = await ensureEndCardVoice(slug, { film: mute, write: false, synthesize: stubSynth(calls) });
    assert.equal(silentFilm.state, "silent");
    assert.match(silentFilm.notice ?? "", /no narration/);
    assert.equal(calls.length, 1);
  } finally {
    cleanPackage(slug);
  }
});
