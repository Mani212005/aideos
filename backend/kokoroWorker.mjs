/**
 * File Description: Long-lived Kokoro TTS worker. Loads the Kokoro-82M ONNX model once and then
 * answers newline-delimited JSON synthesis requests on stdin, writing raw mono float32 PCM to the
 * path each request names.
 *
 * It exists as a separate ESM process for two concrete reasons. Kokoro resolves its voice files
 * relative to its own module directory via import.meta.dirname, which the CJS interop the backend
 * runs under rewrites to the wrong path; and the ONNX runtime's native thread pool aborts the
 * whole process on teardown when it is loaded inside the tsx loader. Both disappear when the model
 * lives in a plain `node` ESM child.
 */

import fs from "node:fs/promises";
import readline from "node:readline";
import { KokoroTTS } from "kokoro-js";

/** Writes one JSON response line to stdout. */
function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/** Loads the model, then serves synthesis requests until stdin closes. */
async function main() {
  const modelId = process.env.AIDEOS_KOKORO_MODEL || "onnx-community/Kokoro-82M-v1.0-ONNX";
  const dtype = process.env.AIDEOS_KOKORO_DTYPE || "q8";

  let tts;
  try {
    tts = await KokoroTTS.from_pretrained(modelId, { dtype, device: "cpu" });
  } catch (err) {
    respond({ ready: false, error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  respond({ ready: true, voices: Object.keys(tts.voices), sampleRate: 24000 });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      respond({ id: null, ok: false, error: "request was not valid JSON" });
      continue;
    }

    try {
      const result = await tts.generate(request.text, {
        voice: request.voice || "af_heart",
        speed: typeof request.speed === "number" ? request.speed : 1,
      });
      if (result.sampling_rate !== 24000) {
        throw new Error(`kokoro returned ${result.sampling_rate}Hz, expected 24000Hz`);
      }
      const samples = Float32Array.from(result.audio);
      await fs.writeFile(request.out, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
      respond({ id: request.id, ok: true, samples: samples.length, sampleRate: result.sampling_rate });
    } catch (err) {
      respond({ id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

main();
