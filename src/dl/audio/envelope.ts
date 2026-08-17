/*
File Description: Implements offline pre-computation of audio amplitude envelopes per video frame for audio-reactive shaders in Remotion.
*/

export interface AudioEnvelopeData {
  fps: number;
  totalFrames: number;
  amplitudes: number[];
}

// Pre-computes deterministic per-frame RMS audio amplitude values for Remotion shader uniforms.
export function precomputeAudioEnvelope(
  audioSamples: Float32Array,
  sampleRate: number,
  fps: number,
  totalFrames: number
): AudioEnvelopeData {
  const amplitudes: number[] = [];
  const samplesPerFrame = Math.floor(sampleRate / fps);

  for (let frame = 0; frame < totalFrames; frame++) {
    const startSample = frame * samplesPerFrame;
    const endSample = Math.min(startSample + samplesPerFrame, audioSamples.length);

    let sumSquare = 0;
    for (let i = startSample; i < endSample; i++) {
      sumSquare += audioSamples[i] * audioSamples[i];
    }

    const count = Math.max(1, endSample - startSample);
    const rms = Math.sqrt(sumSquare / count);
    amplitudes.push(Number(rms.toFixed(4)));
  }

  return { fps, totalFrames, amplitudes };
}

// Returns the normalized audio amplitude for a specific frame index.
export function getFrameAudioAmplitude(envelope: AudioEnvelopeData, frame: number): number {
  if (!envelope.amplitudes || envelope.amplitudes.length === 0) return 0.0;
  const clampedFrame = Math.min(Math.max(0, frame), envelope.amplitudes.length - 1);
  return envelope.amplitudes[clampedFrame];
}
