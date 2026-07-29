import { createClient } from "@deepgram/sdk";
import * as fs from "fs/promises";
import * as path from "path";
import { Film } from "../src/dl/schema";

export async function processAudioForFilm(film: Film, outDir: string): Promise<Film> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not set.");
  }
  const deepgram = createClient(apiKey);

  const shotsText = film.shots.map(s => (s.scriptText || "").trim());
  const fullScript = shotsText.filter(t => t.length > 0).join(" ");

  if (fullScript.length === 0) {
    return film;
  }

  console.log("Generating TTS audio via Deepgram Aura...");
  const ttsResponse = await deepgram.speak.request(
    { text: fullScript },
    { model: "aura-asteria-en" }
  );

  const stream = await ttsResponse.getStream();
  if (!stream) {
    throw new Error("Failed to get TTS stream from Deepgram");
  }

  const audioBuffer = await stream2buffer(stream);
  const audioPath = path.join(outDir, "voiceover.wav");
  await fs.writeFile(audioPath, audioBuffer);
  console.log(`Saved TTS to ${audioPath}`);

  console.log("Running STT via Deepgram Nova to get word timings...");
  const sttResponse = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model: "nova-2",
      smart_format: true,
      utterances: true,
    }
  );

  if (sttResponse.error) {
    throw new Error(`STT failed: ${sttResponse.error.message}`);
  }

  const result = sttResponse.result;
  if (!result || !result.results || !result.results.channels[0].alternatives[0]) {
    throw new Error("No STT results returned from Deepgram.");
  }

  const words = result.results.channels[0].alternatives[0].words;

  // Generate VTT
  console.log("Generating captions.vtt...");
  const vttLines = ["WEBVTT", ""];
  // Just group words into short segments or use utterances if available
  const utterances = result.results.utterances;
  if (utterances && utterances.length > 0) {
    for (const u of utterances) {
      vttLines.push(`${formatTime(u.start)} --> ${formatTime(u.end)}`);
      vttLines.push(u.transcript);
      vttLines.push("");
    }
  } else {
    // fallback if utterances aren't perfectly aligned
    // Just simple 5-word chunks
    for (let i = 0; i < words.length; i += 5) {
      const chunk = words.slice(i, i + 5);
      vttLines.push(`${formatTime(chunk[0].start)} --> ${formatTime(chunk[chunk.length - 1].end)}`);
      vttLines.push(chunk.map(w => w.punctuated_word || w.word).join(" "));
      vttLines.push("");
    }
  }

  const vttPath = path.join(outDir, "captions.vtt");
  await fs.writeFile(vttPath, vttLines.join("\n"));
  console.log(`Saved captions to ${vttPath}`);

  // Dense Character Mapping Algorithm
  console.log("Applying Dense Character Mapping...");
  const shotAlphaTargets = film.shots.map(s => {
    return (s.scriptText || "").replace(/[^a-zA-Z0-9]/g, "").length;
  });

  let wordIndex = 0;
  let previousEnd = 0;

  for (let i = 0; i < film.shots.length; i++) {
    const targetAlpha = shotAlphaTargets[i];
    
    let shotAlpha = 0;
    let currentEnd = previousEnd;

    while (wordIndex < words.length && shotAlpha < targetAlpha) {
      const w = words[wordIndex];
      const wAlpha = w.word.replace(/[^a-zA-Z0-9]/g, "").length;
      shotAlpha += wAlpha;
      currentEnd = w.end;
      wordIndex++;
    }

    let dur = currentEnd - previousEnd;
    
    // If the shot had no text or no words were found, give it a tiny duration so video doesn't break,
    // but keep it as small as schema allows (2s).
    if (dur < 2) dur = 2;
    if (dur > 45) dur = 45;

    previousEnd = currentEnd;

    film.shots[i].dur = Number(dur.toFixed(2));
  }

  film.voiceover = { src: "voiceover.wav", volume: 1 };
  film.captions = "captions.vtt";

  return film;
}

// Utility functions
async function stream2buffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function formatTime(seconds: number): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
