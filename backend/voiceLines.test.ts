/**
 * File Description: Behaviour tests for line-by-line voice-over storage. They prove the captain's rule that
 * nothing is generated twice: a line whose words and voice are unchanged is not re-recorded, a changed line
 * is, a different voice records everything once, and the real narration pipeline (produceAudioPipeline)
 * keeps the same promise while still producing a sample-exact timing spine. Synthesis is a counting fake, so
 * no speech engine or network is involved.
 * Inputs and outputs: narration lines and a counting synthesizer -> which lines were recorded or reused.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { lineFingerprint, recordedStatus, resampleLinear, synthesizeLines, voiceLinesDir, type LineAudio } from "./voiceLines";
import { produceAudioPipeline } from "./audio";
import { PCM_SAMPLE_RATE, type TtsBackend } from "./tts";

// Makes a fresh scratch package directory.
function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aideos-voice-lines-"));
}

// A synthesizer that records every text it was asked to speak and returns one short tone per call.
function countingSynth(spoken: string[]) {
  return async (text: string): Promise<LineAudio> => {
    spoken.push(text);
    const samples = new Float32Array(2400).fill(0.1);
    return { sampleRate: 24000, chunks: [{ text, samples }] };
  };
}

test("an unchanged line is not re-recorded, a changed line is", async () => {
  const pkg = scratch();
  try {
    const spoken: string[] = [];
    const run = (texts: string[], voiceKey = "kokoro|af_heart") =>
      synthesizeLines({ pkgDir: pkg, texts, voiceKey, synthesize: countingSynth(spoken) });

    const first = await run(["Caches make things fast.", "They also forget.", "Remember what is kept."]);
    assert.deepEqual([first.recorded, first.reused], [3, 0]);
    assert.equal(spoken.length, 3);

    // Same script again: nothing is spoken.
    spoken.length = 0;
    const again = await run(["Caches make things fast.", "They also forget.", "Remember what is kept."]);
    assert.deepEqual([again.recorded, again.reused], [0, 3]);
    assert.deepEqual(spoken, [], "an unchanged line is never sent to the voice");
    assert.deepEqual(again.lines.map((l) => l.reused), [true, true, true]);

    // One line edited: only that line is recorded.
    const edited = await run(["Caches make things fast.", "They also forget quickly.", "Remember what is kept."]);
    assert.deepEqual([edited.recorded, edited.reused], [1, 2]);
    assert.deepEqual(spoken, ["They also forget quickly."]);
    assert.deepEqual(edited.lines.map((l) => l.reused), [true, false, true]);

    // A line moved to another position keeps its recording; a new line is the only thing recorded.
    spoken.length = 0;
    const reordered = await run(["Remember what is kept.", "A brand new line.", "Caches make things fast."]);
    assert.deepEqual(spoken, ["A brand new line."]);
    assert.deepEqual([reordered.recorded, reordered.reused], [1, 2]);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

test("the fingerprint is the words plus the voice: another voice or pace records everything once", async () => {
  const pkg = scratch();
  try {
    const spoken: string[] = [];
    const texts = ["One line.", "Another line."];
    await synthesizeLines({ pkgDir: pkg, texts, voiceKey: "kokoro|af_heart|0.75", synthesize: countingSynth(spoken) });
    assert.equal(spoken.length, 2);

    spoken.length = 0;
    await synthesizeLines({ pkgDir: pkg, texts, voiceKey: "kokoro|am_adam|0.75", synthesize: countingSynth(spoken) });
    assert.equal(spoken.length, 2, "a different voice is a different recording");

    spoken.length = 0;
    await synthesizeLines({ pkgDir: pkg, texts, voiceKey: "kokoro|af_heart|0.75", synthesize: countingSynth(spoken) });
    assert.equal(spoken.length, 0, "the first voice's recordings were kept");
    assert.notEqual(lineFingerprint("One line.", "a"), lineFingerprint("One line.", "b"));
    assert.equal(lineFingerprint("One line.", "a"), lineFingerprint("One line.", "a"));
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

test("recordings survive a run that fails part way, and recorded status tells which lines still need recording", async () => {
  const pkg = scratch();
  try {
    const spoken: string[] = [];
    const flaky = async (text: string): Promise<LineAudio> => {
      if (text === "Second line.") throw new Error("voice went away");
      return countingSynth(spoken)(text);
    };
    await assert.rejects(
      synthesizeLines({ pkgDir: pkg, texts: ["First line.", "Second line.", "Third line."], voiceKey: "v", synthesize: flaky }),
      /voice went away/,
    );
    assert.deepEqual(recordedStatus(pkg, ["First line.", "Second line.", "Third line."], "v"), [true, false, false]);

    spoken.length = 0;
    const retry = await synthesizeLines({ pkgDir: pkg, texts: ["First line.", "Second line.", "Third line."], voiceKey: "v", synthesize: countingSynth(spoken) });
    assert.deepEqual(spoken, ["Second line.", "Third line."], "the retry continues from where it stopped");
    assert.deepEqual([retry.recorded, retry.reused], [2, 1]);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

test("a recording no current line uses is removed for that voice, other voices are left alone", async () => {
  const pkg = scratch();
  try {
    const spoken: string[] = [];
    await synthesizeLines({ pkgDir: pkg, texts: ["Keep me.", "Drop me."], voiceKey: "a", synthesize: countingSynth(spoken) });
    await synthesizeLines({ pkgDir: pkg, texts: ["Other voice."], voiceKey: "b", synthesize: countingSynth(spoken) });
    await synthesizeLines({ pkgDir: pkg, texts: ["Keep me."], voiceKey: "a", synthesize: countingSynth(spoken) });
    assert.deepEqual(recordedStatus(pkg, ["Keep me.", "Drop me."], "a"), [true, false]);
    assert.deepEqual(recordedStatus(pkg, ["Other voice."], "b"), [true]);
    assert.equal(fs.readdirSync(voiceLinesDir(pkg)).filter((f) => f.endsWith(".json")).length, 2);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

test("a corrupt stored recording is simply re-recorded", async () => {
  const pkg = scratch();
  try {
    const spoken: string[] = [];
    await synthesizeLines({ pkgDir: pkg, texts: ["Only line."], voiceKey: "v", synthesize: countingSynth(spoken) });
    const dir = voiceLinesDir(pkg);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".f32"))) fs.writeFileSync(path.join(dir, file), Buffer.alloc(3));
    spoken.length = 0;
    await synthesizeLines({ pkgDir: pkg, texts: ["Only line."], voiceKey: "v", synthesize: countingSynth(spoken) });
    assert.deepEqual(spoken, ["Only line."]);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

test("resampleLinear keeps duration when a line arrives at another sample rate", () => {
  const out = resampleLinear(new Float32Array(48000).fill(0.5), 48000, 24000);
  assert.equal(out.length, 24000);
});

test("produceAudioPipeline records only changed lines on a second run and still writes a sample-exact spine", async () => {
  const pkg = scratch();
  try {
    const spoken: string[] = [];
    const backend: TtsBackend = {
      name: "counting-tone",
      voice: "test",
      speed: 1,
      maxChars: 800,
      async synthesize(text: string): Promise<Float32Array> {
        spoken.push(text);
        const length = Math.round(PCM_SAMPLE_RATE * (1.2 + text.length / 100));
        const samples = new Float32Array(length);
        for (let i = 0; i < length; i++) samples[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / PCM_SAMPLE_RATE);
        return samples;
      },
    };
    const script = ["Caches make things fast.", "They also forget.", "Remember what is kept."];

    const first = await produceAudioPipeline(script, pkg, { ttsBackendInstance: backend });
    assert.equal(spoken.length, 3);
    assert.deepEqual(first.lines, { recorded: 3, reused: 0 });

    spoken.length = 0;
    const second = await produceAudioPipeline(script, pkg, { ttsBackendInstance: backend });
    assert.deepEqual(spoken, [], "regenerating an unchanged script records nothing");
    assert.deepEqual(second.lines, { recorded: 0, reused: 3 });
    assert.deepEqual(second.shotDurations, first.shotDurations, "reused lines give the identical timing spine");
    assert.equal(second.totalAudioDuration, first.totalAudioDuration);

    const edited = await produceAudioPipeline(["Caches make things fast.", "They also forget fast.", "Remember what is kept."], pkg, { ttsBackendInstance: backend });
    assert.deepEqual(spoken, ["They also forget fast."], "only the edited line is re-recorded");
    assert.deepEqual(edited.lines, { recorded: 1, reused: 2 });

    spoken.length = 0;
    await produceAudioPipeline(script, pkg, { ttsBackendInstance: backend, lineStore: false });
    assert.equal(spoken.length, 3, "the line store can be switched off to record everything");
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});
