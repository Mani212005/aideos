/**
 * File Description: Pure sample-domain helpers for the narration pipeline - silence trimming,
 * boundary fades, peak normalization, exact-offset concatenation, word-timing distribution and
 * 16-bit PCM WAV encode/decode. Everything here is deterministic and dependency-free so the
 * voiceover regression tests can assert on sample counts and boundary amplitudes directly,
 * which is the only way to prove there is no click, gap or drift at a stitch point.
 */

/** One synthesized piece of narration and the text it speaks. */
export interface PcmChunk {
  text: string;
  samples: Float32Array;
}

/** Where one assembled segment landed on the concatenated timeline, in samples and seconds. */
export interface AssembledSegment {
  text: string;
  startSample: number;
  lengthSamples: number;
  startSec: number;
  durationSec: number;
}

/** The concatenated narration plus the exact placement of every segment inside it. */
export interface AssembledAudio {
  samples: Float32Array;
  sampleRate: number;
  segments: AssembledSegment[];
  totalSec: number;
}

/** A single word with its absolute position on the narration timeline. */
export interface TimedWord {
  word: string;
  punctuated_word: string;
  start: number;
  end: number;
}

/**
 * Trims leading and trailing silence samples (below amplitude threshold) from raw Float32Array audio.
 * Neural TTS pads most utterances with 100-400ms of near-silence; leaving it in is what pushed the
 * spoken words late against the visuals they describe.
 */
export function trimSilence(samples: Float32Array, threshold = 0.005): Float32Array {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) <= threshold) {
    start++;
  }
  if (start >= samples.length) {
    return new Float32Array(0);
  }
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) <= threshold) {
    end--;
  }
  return samples.subarray(start, end + 1);
}

/**
 * Ramps the first and last few milliseconds to zero.
 *
 * Trimming cuts mid-waveform, so a trimmed chunk almost always starts and ends on a non-zero
 * sample. Butting two of those together produces a step discontinuity, which is exactly the
 * click that reads as a stutter at every segment boundary. A short ramp removes the step
 * without being audible as a fade.
 */
export function applyEdgeFades(samples: Float32Array, sampleRate: number, fadeMs = 6): Float32Array {
  const out = Float32Array.from(samples);
  const fade = Math.min(Math.floor((fadeMs / 1000) * sampleRate), Math.floor(out.length / 2));
  if (fade <= 0) return out;
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

/** Scales the buffer so its loudest sample sits at targetPeak, leaving headroom below clipping. */
export function normalizePeak(samples: Float32Array, targetPeak = 0.89): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak === 0) return Float32Array.from(samples);
  const gain = targetPeak / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] * gain;
  }
  return out;
}

/** Options controlling how synthesized chunks are joined into one narration track. */
export interface AssembleOptions {
  sampleRate: number;
  /** Silence inserted between two segments (two different shots). */
  segmentGapMs: number;
  /** Silence inserted between chunks that belong to the same segment. */
  chunkGapMs: number;
  /** Length of the ramp applied to each chunk's head and tail. */
  fadeMs: number;
  /** Amplitude below which a sample counts as silence for trimming. */
  silenceThreshold: number;
}

/** The defaults the production pipeline runs with. */
export const DEFAULT_ASSEMBLE_OPTIONS: Omit<AssembleOptions, "sampleRate"> = {
  segmentGapMs: 200,
  chunkGapMs: 110,
  fadeMs: 6,
  silenceThreshold: 0.005,
};

/**
 * Concatenates per-segment chunk lists into one narration buffer.
 *
 * Every offset is computed in whole samples and the output length is the sum of the pieces, so
 * the reported segment boundaries are exact rather than measured back off an encoded file.
 * That exactness is what lets the film timeline line up with the narration to the frame.
 */
export function assembleSegments(
  segmentChunks: PcmChunk[][],
  options: AssembleOptions,
): AssembledAudio {
  const { sampleRate, segmentGapMs, chunkGapMs, fadeMs, silenceThreshold } = options;
  const segmentGap = Math.round((segmentGapMs / 1000) * sampleRate);
  const chunkGap = Math.round((chunkGapMs / 1000) * sampleRate);

  const prepared: Float32Array[][] = segmentChunks.map((chunks) =>
    chunks
      .map((chunk) => applyEdgeFades(trimSilence(chunk.samples, silenceThreshold), sampleRate, fadeMs))
      .filter((buf) => buf.length > 0),
  );

  let total = 0;
  prepared.forEach((chunks, segIdx) => {
    if (segIdx > 0) total += segmentGap;
    chunks.forEach((buf, chunkIdx) => {
      if (chunkIdx > 0) total += chunkGap;
      total += buf.length;
    });
  });

  const samples = new Float32Array(total);
  const segments: AssembledSegment[] = [];
  let cursor = 0;

  prepared.forEach((chunks, segIdx) => {
    if (segIdx > 0) cursor += segmentGap;
    const startSample = cursor;
    chunks.forEach((buf, chunkIdx) => {
      if (chunkIdx > 0) cursor += chunkGap;
      samples.set(buf, cursor);
      cursor += buf.length;
    });
    segments.push({
      text: segmentChunks[segIdx].map((c) => c.text).join(" "),
      startSample,
      lengthSamples: cursor - startSample,
      startSec: startSample / sampleRate,
      durationSec: (cursor - startSample) / sampleRate,
    });
  });

  return { samples, sampleRate, segments, totalSec: total / sampleRate };
}

/**
 * Turns assembled segment placements into shot durations that tile the timeline exactly.
 *
 * Each shot runs from where its own narration starts to where the next one's does, so the
 * inter-segment gap lands at the tail of the shot that just finished speaking rather than
 * delaying the next shot's visuals. Summing the result reproduces the audio length exactly,
 * which is the invariant the film timeline is locked to.
 */
export function deriveShotDurations(segments: AssembledSegment[], totalSec: number): number[] {
  return segments.map((seg, i) => {
    const next = segments[i + 1];
    return (next ? next.startSec : totalSec) - seg.startSec;
  });
}

/** Rough syllable count, used to weight how long a word occupies the narration timeline. */
function syllableCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  // A trailing silent "e" ("shape", "table") is written but not spoken.
  if (n > 1 && /[^aeiouy]e$/.test(w)) n -= 1;
  return Math.max(1, n);
}

/** Extra weight for the pause a closing punctuation mark buys the word it follows. */
function punctuationWeight(word: string): number {
  if (/[.!?]["')\]]?$/.test(word)) return 1.1;
  if (/[,;:]["')\]]?$/.test(word)) return 0.55;
  return 0;
}

/**
 * Spreads a measured segment duration across its words.
 *
 * Dividing the duration evenly (what the pipeline used to do) puts "a" and "understanding" on
 * the same clock, so word-level captions slide progressively out of step inside every sentence.
 * Weighting by syllables plus the pause each punctuation mark buys tracks real speech closely
 * enough that caption highlighting lands on the word being spoken.
 */
export function distributeWordTimings(
  text: string,
  durationSec: number,
  startSec = 0,
): TimedWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || durationSec <= 0) return [];

  const weights = tokens.map((t) => syllableCount(t) + punctuationWeight(t));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || tokens.length;

  const words: TimedWord[] = [];
  let cursor = 0;
  tokens.forEach((token, i) => {
    const span = (weights[i] / totalWeight) * durationSec;
    const start = cursor;
    // The last word closes exactly on the segment end, so rounding never leaves a sliver.
    const end = i === tokens.length - 1 ? durationSec : cursor + span;
    words.push({
      word: token.toLowerCase().replace(/[^\w']/g, ""),
      punctuated_word: token,
      start: Number((startSec + start).toFixed(3)),
      end: Number((startSec + end).toFixed(3)),
    });
    cursor = end;
  });

  return words;
}

/** Encodes mono Float32 samples as a 16-bit PCM WAV file buffer. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20); // format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * bytesPerSample);
  }
  return buffer;
}

/** Decoded contents of a 16-bit PCM WAV file. */
export interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

/** Decodes a 16-bit PCM WAV buffer, walking the chunk list rather than assuming a 44-byte header. */
export function decodeWav(buffer: Buffer): DecodedWav {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataStart = body;
      dataLength = Math.min(size, buffer.length - body);
    }
    offset = body + size + (size % 2);
  }

  if (dataStart < 0) throw new Error("WAV file has no data chunk");
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${bitsPerSample}-bit`);

  const count = Math.floor(dataLength / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = buffer.readInt16LE(dataStart + i * 2) / 32768;
  }
  return { samples, sampleRate, channels };
}

/** Largest absolute jump between consecutive samples, the direct measure of a boundary click. */
export function maxSampleStep(samples: Float32Array): number {
  let worst = 0;
  for (let i = 1; i < samples.length; i++) {
    const step = Math.abs(samples[i] - samples[i - 1]);
    if (step > worst) worst = step;
  }
  return worst;
}

/** Longest run of consecutive near-silent samples, in seconds. Catches accidental dead air. */
export function longestSilenceSec(samples: Float32Array, sampleRate: number, threshold = 0.005): number {
  let worst = 0;
  let run = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) <= threshold) {
      run++;
      if (run > worst) worst = run;
    } else {
      run = 0;
    }
  }
  return worst / sampleRate;
}
