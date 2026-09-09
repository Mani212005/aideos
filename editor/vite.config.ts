/**
 * File Description: Vite configuration and custom development API plugins for Aideos Studio editor server.
 */

import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { filmSchema } from '../src/dl/schema.ts'
import type { Film } from '../src/dl/schema.ts'
import { produceAudioPipeline, splitScriptIntoSegments, chunkTextForTTS, trimSilence } from '../backend/audio.ts'
import { executeCritique } from '../backend/critique/engine.ts'
import { extractSpokenBlocks as extractSpokenVoiceoverBlocks, buildFilmPartsFromScript, hasScreenplayTags } from '../backend/scriptIntake.ts'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true })
import { createEngine } from '../backend/engine/index.ts'
import type { VideoJobSpec } from '../backend/engine/types.ts'

const filmsDir = path.resolve(__dirname, '../src/dl/films');
const videosDir = path.resolve(__dirname, '../videos');

// The schema's own id rule. It also happens to make traversal unrepresentable:
// a film can only ever be written as `<id>.ts` inside src/dl/films.
const FILM_ID = /^[a-z0-9-]+$/;

// `kv-cache` → `kvCacheFilm`. Film ids may contain dashes; identifiers may not.
const exportName = (id: string) =>
  `${id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}Film`;

// Films are pure data with a type-only import - see src/dl/films/kvcache.ts.
const filmModule = (film: Film) =>
  `import type { Film } from "../schema";\n\nexport const ${exportName(film.id)}: Film = ${JSON.stringify(film, null, 2)};\n`;

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });

interface BrollJobRecord {
  jobId: string;
  filmId: string;
  shotId: string;
  prompt: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  error?: string;
  footageSrc?: string;
  startedAt: number;
  finishedAt?: number;
}

const brollJobs = new Map<string, BrollJobRecord>();

async function startBrollJob(filmId: string, shotId: string, promptText: string, seconds: number): Promise<BrollJobRecord> {
  const engine = createEngine('ssh-wangp');
  const spec: VideoJobSpec = {
    prompt: promptText.replace(/\s*\n+\s*/g, ' ').trim(),
    seconds: Math.min(Math.max(seconds, 3), 8),
    width: 832,
    height: 480,
    fps: 16,
    modelProfile: 'small',
  };

  const handle = await engine.submit(spec);
  const record: BrollJobRecord = {
    jobId: handle.jobId,
    filmId,
    shotId,
    prompt: promptText,
    state: 'running',
    progress: 0.05,
    startedAt: Date.now(),
  };
  brollJobs.set(handle.jobId, record);

  // Background polling loop
  (async () => {
    try {
      while (true) {
        await new Promise((r) => setTimeout(r, 6000));
        const st = await engine.status(handle.jobId);
        const current = brollJobs.get(handle.jobId);
        if (!current) break;

        current.state = st.state;
        if (typeof st.progress === 'number') {
          current.progress = Math.max(current.progress, st.progress);
        }

        if (st.state === 'done') {
          const footageDir = path.resolve(__dirname, '../public/footage');
          if (!fs.existsSync(footageDir)) fs.mkdirSync(footageDir, { recursive: true });
          const relPath = `footage/${filmId}_${shotId}.mp4`;
          const destPath = path.join(footageDir, `${filmId}_${shotId}.mp4`);
          await engine.fetchOutput(handle.jobId, destPath);

          current.footageSrc = relPath;
          current.progress = 1;
          current.finishedAt = Date.now();

          // Auto-wire footage into film file so it persists immediately
          try {
            const filmPath = path.join(filmsDir, `${filmId}.ts`);
            if (fs.existsSync(filmPath)) {
              const fileContent = fs.readFileSync(filmPath, 'utf8');
              const jsonMatch = fileContent.match(/=\s*(\{[\s\S]*\})\s*;/);
              if (jsonMatch) {
                const filmObj: Film = JSON.parse(jsonMatch[1]);
                const targetShot = filmObj.shots.find((s) => s.id === shotId);
                if (targetShot) {
                  targetShot.needsFootage = true;
                  const existingInset = targetShot.blocks.find((b) => b.c === 'AnalogyInset');
                  if (existingInset) {
                    (existingInset as any).src = relPath;
                    (existingInset as any).fullScreenHero = true;
                  } else {
                    targetShot.blocks = [
                      {
                        c: 'AnalogyInset',
                        caption: (targetShot.visualDirection || promptText || 'GPU B-Roll').slice(0, 60),
                        src: relPath,
                        fullScreenHero: true,
                      } as any,
                      ...targetShot.blocks.filter((b) => b.c !== 'AnalogyInset'),
                    ];
                  }
                  fs.writeFileSync(filmPath, filmModule(filmObj), 'utf8');
                  console.log(`[broll] Successfully wired ${relPath} into shot ${shotId} of ${filmId}`);
                }
              }
            }
          } catch (e) {
            console.error(`[broll] Failed to auto-wire footage into film file:`, e);
          }
          break;
        }

        if (st.state === 'failed') {
          current.error = st.error || 'GPU render failed';
          current.finishedAt = Date.now();
          console.error(`[broll] Job ${handle.jobId} failed:`, current.error);
          break;
        }
      }
    } catch (err: any) {
      const current = brollJobs.get(handle.jobId);
      if (current) {
        current.state = 'failed';
        current.error = err?.message || String(err);
      }
      console.error(`[broll] Polling error on ${handle.jobId}:`, err);
    }
  })();

  return record;
}

// Vite plugin to provide simple read/write API for films and video rendering
function filmApiPlugin(): Plugin {
  return {
    name: 'film-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];

        // Enable byte-range streaming and caching for audio media to prevent playback stutter
        if (url.endsWith('.wav')) {
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'public, max-age=3600');
        } else if (url.endsWith('.vtt')) {
          res.setHeader('Cache-Control', 'no-cache');
        }

        // Handle /api/export endpoint for 1-click video rendering
        if (url === '/api/export' && req.method === 'POST') {
          void readBody(req)
            .then(async (body) => {
              const { film, format } = (body as { film: Film; format?: string }) || {};
              if (!film) {
                sendJson(res, 400, { error: 'film is required' });
                return;
              }

              // Enforce rule: Don't render video till B-roll is complete and footage is retrieved
              const pendingBroll = (film.shots || []).filter((s) => {
                if (!s.needsFootage) return false;
                const relPath = `footage/${film.id}_${s.id}.mp4`;
                const fullPath = path.resolve(__dirname, '../public', relPath);
                return !fs.existsSync(fullPath);
              });
              if (pendingBroll.length > 0) {
                sendJson(res, 400, {
                  error: `Cannot render video: GPU B-Roll footage is still pending for ${pendingBroll.length} shot(s) (${pendingBroll.map(s => s.id).join(', ')}). Please complete B-roll generation first.`,
                  pendingShotIds: pendingBroll.map((s) => s.id),
                });
                return;
              }

              const outDir = path.resolve(__dirname, '../out');
              if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

              const composition = format === 'reel' ? 'Reel' : 'Long';
              const filename = `aideos_${film.id}_${format || 'long'}_${Date.now()}.mp4`;
              const outPath = path.join(outDir, filename);

              // Save active film first so remotion bundles it
              const filmFile = path.join(filmsDir, `${film.id}.ts`);
              fs.writeFileSync(filmFile, filmModule(film), 'utf8');

              // Ensure activeFilm.ts is synced to this exported film
              const activeFilmFile = path.resolve(__dirname, '../src/dl/activeFilm.ts');
              fs.writeFileSync(
                activeFilmFile,
                `import { ${exportName(film.id)} } from "./films/${film.id}";\nimport type { Film } from "./schema";\n\nexport const ACTIVE_FILM: Film = ${exportName(film.id)};\n`,
                'utf8'
              );

              const child = spawn(
                'npx',
                ['remotion', 'render', 'src/index.ts', composition, outPath],
                {
                  cwd: path.resolve(__dirname, '..'),
                  stdio: 'pipe',
                }
              );

              child.on('close', (code) => {
                if (code === 0) {
                  sendJson(res, 200, {
                    ok: true,
                    filename,
                    downloadUrl: `/api/downloads/${filename}`,
                  });
                } else {
                  sendJson(res, 500, {
                    error: `Remotion render exited with code ${code}`,
                  });
                }
              });
            })
            .catch((err) => {
              sendJson(res, 500, { error: String(err) });
            });
          return;
        }

        // Handle /api/broll/generate (Triggers GPU diffusion generation on remote box for B-Roll shots)
        if (url === '/api/broll/generate' && req.method === 'POST') {
          void readBody(req)
            .then(async (body: any) => {
              const { filmId, shotId, prompt: customPrompt, allPending, film: clientFilm } = body || {};
              if (!filmId) {
                sendJson(res, 400, { error: 'filmId is required' });
                return;
              }

              // Load film definition (prefer clientFilm if provided)
              const filmPath = path.join(filmsDir, `${filmId}.ts`);
              let filmObj: Film | null = clientFilm || null;
              if (!filmObj && fs.existsSync(filmPath)) {
                const content = fs.readFileSync(filmPath, 'utf8');
                const jsonMatch = content.match(/=\s*(\{[\s\S]*\})\s*;/);
                if (jsonMatch) filmObj = JSON.parse(jsonMatch[1]);
              }

              if (!filmObj) {
                sendJson(res, 404, { error: `Film ${filmId} not found` });
                return;
              }

              // If client passed updated film, persist it first so shot flags are synchronized
              if (clientFilm) {
                fs.writeFileSync(filmPath, filmModule(clientFilm), 'utf8');
              }

              const spawnedJobs: BrollJobRecord[] = [];

              if (allPending) {
                const pendingShots = filmObj.shots.filter((s) => {
                  if (!s.needsFootage) return false;
                  const relPath = `footage/${filmId}_${s.id}.mp4`;
                  return !fs.existsSync(path.resolve(__dirname, '../public', relPath));
                });

                if (pendingShots.length === 0) {
                  sendJson(res, 200, { ok: true, message: 'All B-roll footage already rendered and available', jobs: [] });
                  return;
                }

                for (const shot of pendingShots) {
                  const existing = Array.from(brollJobs.values()).find(
                    (j) => j.filmId === filmId && j.shotId === shot.id && (j.state === 'running' || j.state === 'queued')
                  );
                  if (existing) {
                    spawnedJobs.push(existing);
                  } else {
                    const promptText = shot.visualDirection || shot.scriptText || 'Cinematic photoreal scene';
                    const record = await startBrollJob(filmId, shot.id, promptText, shot.dur || 5);
                    spawnedJobs.push(record);
                  }
                }
              } else if (shotId) {
                const shot = filmObj.shots.find((s) => s.id === shotId);
                if (!shot) {
                  sendJson(res, 404, { error: `Shot ${shotId} not found in film` });
                  return;
                }

                const existing = Array.from(brollJobs.values()).find(
                  (j) => j.filmId === filmId && j.shotId === shotId && (j.state === 'running' || j.state === 'queued')
                );
                if (existing) {
                  spawnedJobs.push(existing);
                } else {
                  const promptText = customPrompt || shot.visualDirection || shot.scriptText || 'Cinematic photoreal scene';
                  const record = await startBrollJob(filmId, shot.id, promptText, shot.dur || 5);
                  spawnedJobs.push(record);
                }
              } else {
                sendJson(res, 400, { error: 'Either shotId or allPending must be provided' });
                return;
              }

              sendJson(res, 200, { ok: true, jobs: spawnedJobs });
            })
            .catch((err) => {
              console.error('[broll] Error in /api/broll/generate:', err);
              sendJson(res, 500, { error: String(err) });
            });
          return;
        }

        // Handle /api/broll/status (Check live GPU progress and existing footage)
        if (url === '/api/broll/status' && req.method === 'GET') {
          const parsedUrl = new URL(req.url || '', 'http://localhost');
          const filmId = parsedUrl.searchParams.get('filmId');
          if (!filmId) {
            sendJson(res, 400, { error: 'filmId query parameter is required' });
            return;
          }

          const footageDir = path.resolve(__dirname, '../public/footage');
          const existingFootage: Record<string, string> = {};
          if (fs.existsSync(footageDir)) {
            const files = fs.readdirSync(footageDir);
            for (const f of files) {
              if (f.startsWith(`${filmId}_`) && f.endsWith('.mp4')) {
                const shotId = f.slice(`${filmId}_`.length, -4);
                existingFootage[shotId] = `footage/${f}`;
              }
            }
          }

          const jobs = Array.from(brollJobs.values()).filter((j) => j.filmId === filmId);
          const isGenerating = jobs.some((j) => j.state === 'queued' || j.state === 'running');

          sendJson(res, 200, {
            ok: true,
            jobs,
            isGenerating,
            existingFootage,
          });
          return;
        }

        // Handle /api/scripts/:id (Read and Save scripts)
        if (url.startsWith('/api/scripts/')) {
          const scriptId = url.slice('/api/scripts/'.length);
          const scriptsDir = path.resolve(__dirname, '../scripts');
          if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

          if (req.method === 'GET') {
            const possibleFiles = [
              path.join(scriptsDir, `${scriptId}.md`),
              path.join(scriptsDir, `${scriptId}.txt`),
              path.join(scriptsDir, `video-script-${scriptId}.md`),
              path.join(scriptsDir, `video-script-${scriptId}-4min.md`),
              path.join(scriptsDir, `video-script-${scriptId}-3min.md`),
            ];
            let foundScript = '';
            for (const f of possibleFiles) {
              if (fs.existsSync(f)) {
                foundScript = fs.readFileSync(f, 'utf8');
                break;
              }
            }
            if (!foundScript) {
              // Try reading film definition to generate draft script
              const filmFile = path.join(filmsDir, `${scriptId}.ts`);
              if (fs.existsSync(filmFile)) {
                foundScript = `# ${scriptId}\n\nPaste your narration script here. Each paragraph will sync with your video scenes and visual metaphors.\n\nClick "Generate Voiceover (.wav)" to generate studio audio.`;
              }
            }
            sendJson(res, 200, { ok: true, script: foundScript });
            return;
          }

          if (req.method === 'POST') {
            void readBody(req).then((body: any) => {
              const { script } = body || {};
              const targetFile = path.join(scriptsDir, `${scriptId}.md`);
              fs.writeFileSync(targetFile, script || '', 'utf8');
              sendJson(res, 200, { ok: true, file: `scripts/${scriptId}.md` });
            }).catch(err => sendJson(res, 500, { error: String(err) }));
            return;
          }
        }

        // Extracts strictly the spoken dialogue/narration lines from a director screenplay
        function extractSpokenVoiceover(raw: string): string {
          return extractSpokenVoiceoverBlocks(raw).join("\n\n");
        }

        // Handle /api/parse-script-scenes (Intelligently construct shots, visual directions & nodes from screenplay)
        if (url === '/api/parse-script-scenes' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const { script, filmTitle: _filmTitle = "Film", targetDurationSec } = body || {};
            if (!script) {
              sendJson(res, 400, { error: 'Script text is required' });
              return;
            }

            const { shots, nodes, edges, spokenText, wordCount, durationSec } = buildFilmPartsFromScript(script, targetDurationSec);

            sendJson(res, 200, {
              ok: true,
              shots,
              nodes,
              edges,
              spokenText,
              wordCount,
              durationSec,
            });
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/voiceover (Google Cloud TTS / Neural Voiceover Synthesis & Shot Duration Alignment)
        if (url === '/api/voiceover' && req.method === 'POST') {
          void readBody(req).then(async (body: any) => {
            const { film, scriptText } = body || {};
            if (!film) {
              sendJson(res, 400, { error: 'film is required' });
              return;
            }
            const shotTexts: string[] = film.shots?.map((s: any) => (s.scriptText || s.id || '').trim()).filter(Boolean) || [];
            const scriptInput = scriptText ? splitScriptIntoSegments(scriptText) : shotTexts.length > 0 ? shotTexts : [film.title];
            const outDir = path.resolve(__dirname, `../out/films/${film.id}`);
            const audioResult = await produceAudioPipeline(scriptInput, outDir);

            // Update shot durations to match audio segments accurately (1:1 shot-level mapping)
            const updatedShots = film.shots.map((shot: any, idx: number) => {
              const dur = audioResult.shotDurations[idx] || shot.dur || 3;
              return {
                ...shot,
                dur: Number(dur.toFixed(3)),
              };
            });

            const updatedFilm = {
              ...film,
              shots: updatedShots,
              voiceover: { src: `voiceover.wav`, volume: 1 },
            };

            // Copy synthesized voiceover to public folder so remotion can stream it
            const publicDir = path.resolve(__dirname, '../public');
            if (fs.existsSync(audioResult.voiceoverPath)) {
              fs.copyFileSync(audioResult.voiceoverPath, path.join(publicDir, 'voiceover.wav'));
            }

            sendJson(res, 200, { ok: true, film: updatedFilm, audioResult });
          }).catch(err => {
            console.error('[API voiceover error]:', err);
            sendJson(res, 500, { error: String(err) });
          });
          return;
        }

        // Handle /api/media/list (List all uploaded / available media assets)
        if (url === '/api/media/list' && req.method === 'GET') {
          const mediaDir = path.resolve(__dirname, '../public/media');
          if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
          const files = fs.readdirSync(mediaDir);
          const assets = files.map((f) => {
            const ext = path.extname(f).toLowerCase();
            const type = ['.mp4', '.mov', '.webm'].includes(ext) ? 'video' : ['.mp3', '.wav', '.aac'].includes(ext) ? 'audio' : 'image';
            const stats = fs.statSync(path.join(mediaDir, f));
            return {
              id: f,
              filename: f,
              src: `media/${f}`,
              type,
              sizeBytes: stats.size,
            };
          });
          sendJson(res, 200, { ok: true, assets });
          return;
        }

        // Handle /api/media/upload (Upload external video/audio/image footage)
        if (url === '/api/media/upload' && req.method === 'POST') {
          void readBody(req).then(async (body: any) => {
            const { filename, base64Data } = body || {};
            if (!filename || !base64Data) {
              sendJson(res, 400, { error: 'filename and base64Data are required' });
              return;
            }
            const mediaDir = path.resolve(__dirname, '../public/media');
            if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

            const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
            const filePath = path.join(mediaDir, safeName);
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filePath, buffer);

            let duration = 5.0;
            const ext = path.extname(safeName).toLowerCase();
            const isVideo = ['.mp4', '.mov', '.webm'].includes(ext);
            const isAudio = ['.mp3', '.wav', '.aac'].includes(ext);

            if (isVideo || isAudio) {
              try {
                const out = spawnSync('ffprobe', [
                  '-v', 'error',
                  '-show_entries', 'format=duration',
                  '-of', 'default=noprint_wrappers=1:nokey=1',
                  filePath
                ]).stdout.toString().trim();
                const d = parseFloat(out);
                if (!isNaN(d) && d > 0) duration = d;
              } catch {
                // Ignore probe error
              }
            }

            sendJson(res, 200, {
              ok: true,
              asset: {
                id: safeName,
                filename: safeName,
                src: `media/${safeName}`,
                type: isVideo ? 'video' : isAudio ? 'audio' : 'image',
                duration,
              },
            });
          }).catch((err) => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/generate-voiceover (AI Voice Synthesis with Kokoro / Deepgram / macOS TTS)
        if (url === '/api/generate-voiceover' && req.method === 'POST') {
          void readBody(req).then(async (body: any) => {
            const { script, voice = 'aura-helios-en', projectId = 'kvcache', spokenTextOverride } = body || {};
            if ((!script || !script.trim()) && (!spokenTextOverride || !spokenTextOverride.trim())) {
              sendJson(res, 400, { error: 'Script text or spoken words are required to generate voiceover.' });
              return;
            }

            // Extract ONLY spoken dialogue lines if screenplay format is present, or use spoken text override directly
            const cleanText = spokenTextOverride && typeof spokenTextOverride === 'string' && spokenTextOverride.trim()
              ? spokenTextOverride.trim()
              : extractSpokenVoiceover(script || '');

            if (!cleanText || !cleanText.trim()) {
              sendJson(res, 400, { error: 'No spoken narration dialogue found in script. Please add [NARRATION] blocks.' });
              return;
            }

            const publicDir = path.resolve(__dirname, '../public');
            const scriptsDir = path.resolve(__dirname, '../scripts');
            if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
            if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

            const outFilename = `voiceover_${projectId}.wav`;
            const publicPath = path.join(publicDir, outFilename);
            const scriptsPath = path.join(scriptsDir, outFilename);

            let generated = false;

            // Helper to encode Float32Array to 16-bit PCM WAV
            function encodeWav(float32Data: Float32Array, rate: number): Buffer {
              const numChannels = 1;
              const bytesPerSample = 2;
              const blockAlign = numChannels * bytesPerSample;
              const byteRate = rate * blockAlign;
              const dataSize = float32Data.length * bytesPerSample;
              const buffer = Buffer.alloc(44 + dataSize);

              buffer.write("RIFF", 0);
              buffer.writeUInt32LE(36 + dataSize, 4);
              buffer.write("WAVE", 8);
              buffer.write("fmt ", 12);
              buffer.writeUInt32LE(16, 16);
              buffer.writeUInt16LE(1, 20);
              buffer.writeUInt16LE(numChannels, 22);
              buffer.writeUInt32LE(rate, 24);
              buffer.writeUInt32LE(byteRate, 28);
              buffer.writeUInt16LE(blockAlign, 32);
              buffer.writeUInt16LE(16, 34);
              buffer.write("data", 36);
              buffer.writeUInt32LE(dataSize, 40);

              let bufOffset = 44;
              for (let i = 0; i < float32Data.length; i++) {
                const s = Math.max(-1, Math.min(1, float32Data[i]));
                const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
                buffer.writeInt16LE(Math.floor(val), bufOffset);
                bufOffset += 2;
              }
              return buffer;
            }

            // 1. KOKORO NEURAL TTS (Local ONNX - Full Multi-Paragraph Concatenation)
            if (voice.startsWith('kokoro-')) {
              try {
                const kokoroVoice = voice.replace(/^kokoro-/, '');
                console.log(`[TTS] Synthesizing full script with local Kokoro-82M voice "${kokoroVoice}"...`);
                const { KokoroTTS } = await import('kokoro-js');
                const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8' });

                const paragraphs = chunkTextForTTS(cleanText, 800);
                const allAudio: Float32Array[] = [];
                let sampleRate = 24000;

                for (let i = 0; i < paragraphs.length; i++) {
                  const p = paragraphs[i].trim();
                  if (!p) continue;
                  console.log(`[TTS] Kokoro [${i + 1}/${paragraphs.length}] (${p.length} chars): ${p.slice(0, 35)}...`);
                  const audio = await tts.generate(p, { voice: kokoroVoice });
                  sampleRate = audio.sampling_rate;
                  const trimmed = trimSilence(audio.audio, 0.005);
                  if (trimmed.length > 0) {
                    allAudio.push(trimmed);
                  }
                  // Controlled 200ms pause between distinct scene/shot boundaries
                  if (i < paragraphs.length - 1) {
                    const pauseSamples = Math.floor(sampleRate * 0.20);
                    allAudio.push(new Float32Array(pauseSamples));
                  }
                }

                const totalLength = allAudio.reduce((acc, a) => acc + a.length, 0);
                const merged = new Float32Array(totalLength);
                let offset = 0;
                for (const a of allAudio) {
                  merged.set(a, offset);
                  offset += a.length;
                }

                const wavBuffer = encodeWav(merged, sampleRate);
                fs.writeFileSync(publicPath, wavBuffer);
                fs.writeFileSync(scriptsPath, wavBuffer);
                generated = true;
                console.log(`[TTS] Kokoro synthesized full audio: ${(totalLength / sampleRate).toFixed(2)}s`);
              } catch (err) {
                console.warn('[TTS] Kokoro synthesis error:', err);
              }
            }

            // 2. DEEPGRAM NEURAL TTS (Aura)
            if (!generated && (voice.startsWith('aura-') || !voice.startsWith('macos-'))) {
              let deepgramKey = process.env.DEEPGRAM_API_KEY || '';
              if (!deepgramKey) {
                const envPath = path.resolve(__dirname, '../.env');
                if (fs.existsSync(envPath)) {
                  const envContent = fs.readFileSync(envPath, 'utf8');
                  const match = envContent.match(/DEEPGRAM_API_KEY\s*=\s*([a-zA-Z0-9_-]+)/);
                  if (match) deepgramKey = match[1];
                }
              }

              if (deepgramKey) {
                try {
                  const dgModel = voice.startsWith('aura-') ? voice : 'aura-helios-en';
                  console.log(`[TTS] Synthesizing with Deepgram Aura model "${dgModel}"...`);
                  const dgUrl = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(dgModel)}&encoding=linear16&sample_rate=48000`;
                  const dgRes = await fetch(dgUrl, {
                    method: 'POST',
                    headers: {
                      Authorization: `Token ${deepgramKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ text: cleanText }),
                  });

                  if (dgRes.ok) {
                    const audioBuffer = Buffer.from(await dgRes.arrayBuffer());
                    fs.writeFileSync(publicPath, audioBuffer);
                    fs.writeFileSync(scriptsPath, audioBuffer);
                    generated = true;
                  } else {
                    console.warn('[TTS] Deepgram API returned', dgRes.status, await dgRes.text());
                  }
                } catch (e) {
                  console.warn('[TTS] Deepgram synthesis failed, trying fallback:', e);
                }
              }
            }

            // 3. MACOS NATIVE TTS FALLBACK
            if (!generated) {
              try {
                let macVoice = 'Samantha';
                if (voice.toLowerCase().includes('daniel')) macVoice = 'Daniel';
                else if (voice.toLowerCase().includes('alex')) macVoice = 'Alex';
                else if (voice.toLowerCase().includes('eddy')) macVoice = 'Eddy';
                else if (voice.toLowerCase().includes('flo')) macVoice = 'Flo';
                else if (voice.toLowerCase().includes('fred')) macVoice = 'Fred';

                console.log(`[TTS] Synthesizing with macOS voice "${macVoice}"...`);
                const tmpText = path.join('/tmp', `aideos_script_${Date.now()}.txt`);
                const tmpAiff = path.join('/tmp', `aideos_voice_${Date.now()}.aiff`);
                fs.writeFileSync(tmpText, cleanText, 'utf8');

                const say = spawnSync('say', ['-v', macVoice, '-f', tmpText, '-o', tmpAiff]);
                if (say.status === 0 && fs.existsSync(tmpAiff)) {
                  spawnSync('ffmpeg', ['-y', '-i', tmpAiff, '-ar', '48000', '-ac', '1', publicPath]);
                  if (fs.existsSync(publicPath)) {
                    fs.copyFileSync(publicPath, scriptsPath);
                    generated = true;
                  }
                }
                try { fs.unlinkSync(tmpText); fs.unlinkSync(tmpAiff); } catch (_) {}
              } catch (e) {
                console.error('[TTS] macOS fallback failed:', e);
              }
            }

            if (generated) {
              const scriptDocPath = path.join(scriptsDir, `${projectId}.md`);
              fs.writeFileSync(scriptDocPath, script, 'utf8');

              // Also copy to default voiceover.wav for universal fallback
              try {
                fs.copyFileSync(publicPath, path.join(publicDir, 'voiceover.wav'));
              } catch (_) {}

              // Measure exact audio duration via ffprobe
              let measuredDuration = 5.0;
              try {
                const out = spawnSync('ffprobe', [
                  '-v', 'error',
                  '-show_entries', 'format=duration',
                  '-of', 'default=noprint_wrappers=1:nokey=1',
                  publicPath
                ]).stdout.toString().trim();
                const d = parseFloat(out);
                if (!isNaN(d) && d > 0) measuredDuration = Number(d.toFixed(3));
              } catch (_) {}

              // Automatically scale film shot durations to match the newly synthesized audio (Axiom 2 / D4 Master Clock Invariant)
              const filmFile = path.join(filmsDir, `${projectId}.ts`);
              let updatedFilm: Film | undefined = undefined;
              let updatedShots: any[] | undefined = undefined;

              if (fs.existsSync(filmFile)) {
                try {
                  const mod = fs.readFileSync(filmFile, 'utf8');
                  const jsonMatch = mod.match(/export const \w+:\s*Film\s*=\s*([\s\S]+?);(?:\s*\n|$)/);
                  if (jsonMatch) {
                    const parsedFilm = JSON.parse(jsonMatch[1]);
                    const currentTotal = parsedFilm.shots.reduce((sum: number, s: any) => sum + (s.dur || 0), 0);
                    const scale = currentTotal > 0 ? measuredDuration / currentTotal : 1.0;

                    const computedShots = parsedFilm.shots.map((s: any) => ({
                      ...s,
                      dur: Number(((s.dur || 1) * scale).toFixed(2)),
                    }));

                    const sumNew = computedShots.reduce((sum: number, s: any) => sum + s.dur, 0);
                    const diff = measuredDuration - sumNew;
                    if (Math.abs(diff) > 0.001 && computedShots.length > 0) {
                      computedShots[computedShots.length - 1].dur = Number((computedShots[computedShots.length - 1].dur + diff).toFixed(2));
                    }

                    updatedShots = computedShots;
                    updatedFilm = {
                      ...parsedFilm,
                      shots: computedShots,
                      voiceover: {
                        src: outFilename,
                        volume: 1,
                        speed: 1,
                        version: Date.now().toString(),
                        durationSec: measuredDuration,
                      },
                      audioClips: undefined,
                    } as Film;
                    fs.writeFileSync(filmFile, filmModule(updatedFilm), 'utf8');

                    // Sync to video package
                    const pkgDir = path.join(videosDir, projectId);
                    if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });
                    fs.writeFileSync(path.join(pkgDir, 'film.json'), JSON.stringify(updatedFilm, null, 2), 'utf8');
                  }
                } catch (syncErr) {
                  console.warn('[TTS] Automatic shot duration scaling error:', syncErr);
                }
              }

              sendJson(res, 200, {
                ok: true,
                filename: outFilename,
                audioSrc: `/${outFilename}?t=${Date.now()}`,
                scriptFile: `scripts/${projectId}.md`,
                spokenWordCount: cleanText.split(/\s+/).filter(Boolean).length,
                estimatedDurationSec: Math.round(measuredDuration),
                actualDurationSec: measuredDuration,
                shots: updatedShots,
                film: updatedFilm,
              });
            } else {
              sendJson(res, 500, { error: 'Failed to synthesize voiceover audio.' });
            }
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/critique (Natural-Language Critique & Film Patching Engine)
        if (url === '/api/critique' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const { critique, film, scene } = body || {};
            if (!critique || !film) {
              sendJson(res, 400, { error: 'critique and film are required' });
              return;
            }

            const result = executeCritique({ critique, film, scene });

            // Persist conversation history to disk for full assistant & developer context
            try {
              const dataDir = path.resolve(__dirname, '../data');
              if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
              const logFile = path.join(dataDir, 'chatbot_conversations.json');
              let history: any[] = [];
              if (fs.existsSync(logFile)) {
                try {
                  history = JSON.parse(fs.readFileSync(logFile, 'utf8'));
                } catch (_) {}
              }
              history.push({
                timestamp: new Date().toISOString(),
                filmId: film.id,
                filmTitle: film.title,
                userMessage: critique,
                assistantResponse: result.explanation,
                target: result.target,
                appliedOps: result.patchOps,
                ok: result.ok,
              });
              fs.writeFileSync(logFile, JSON.stringify(history.slice(-100), null, 2), 'utf8');
            } catch (_) {}

            if (result.ok && result.updatedFilm && result.patchOps && result.patchOps.length > 0) {
              const filmFile = path.join(filmsDir, `${result.updatedFilm.id}.ts`);
              if (fs.existsSync(filmFile)) {
                fs.writeFileSync(filmFile, filmModule(result.updatedFilm), 'utf8');
              }
            }
            sendJson(res, 200, result);
          }).catch((err) => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/projects/new (Create fresh video project and auto-compile film)
        if (url === '/api/projects/new' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const {
              title,
              id,
              script = '',
              characterId = 'developer',
              theme = 'smooth-dark',
              accent = '#635BFF',
              voice: _voice = 'kokoro-am_adam',
              autoCompile = false
            } = body || {};

            if (!title || !title.trim()) {
              sendJson(res, 400, { error: 'Project title is required.' });
              return;
            }
            const cleanId = (id || title)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');

            if (!FILM_ID.test(cleanId)) {
              sendJson(res, 400, { error: `"${cleanId}" is not a valid project ID (lowercase alphanumeric and hyphens).` });
              return;
            }

            // 1. Create scripts/<id>.md
            const scriptsDir = path.resolve(__dirname, '../scripts');
            if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
            const initialScript = script.trim() || `# ${title}\n\nWrite your voiceover narration script here.\n\nEvery paragraph maps to visual scenes, 3D camera angles, and animated primitives.\n\nClick "🎙️ Generate Voiceover (.wav)" when ready!`;
            fs.writeFileSync(path.join(scriptsDir, `${cleanId}.md`), initialScript, 'utf8');

            let newFilm: Film;

            if (autoCompile && script.trim()) {
              if (hasScreenplayTags(script)) {
                const parts = buildFilmPartsFromScript(script);
                newFilm = {
                  id: cleanId,
                  title: title.trim(),
                  fps: 30,
                  accent,
                  theme: {
                    background: theme as any,
                    fontFamily: "geist",
                    storyStyle: "script-metaphor",
                    cameraAngle: "isometric",
                    accent,
                  },
                  chapters: parts.nodes.map(n => n.label),
                  canvas: {
                    nodes: parts.nodes,
                    edges: parts.edges,
                  },
                  shots: parts.shots as any,
                };
              } else {
                // Intelligently parse raw script paragraphs into structured shots & relationship-aware canvas
                const paragraphs = script
                  .split(/\n\s*\n+/)
                  .map((p: string) => p.trim())
                  .filter((p: string) => p.length > 0 && !p.startsWith('#') && !p.toLowerCase().startsWith('production note'));

              const count = Math.max(3, paragraphs.length);
              const nodes: any[] = [];
              const edges: any[] = [];
              const shots: any[] = [];
              const chapters: string[] = [];

              for (let i = 0; i < count; i++) {
                const para = paragraphs[i] || `Scene ${i + 1} narration talking point.`;
                const words = para.split(/\s+/).filter(Boolean);
                const dur = Math.max(4.5, Math.min(12, Math.round((words.length / 145) * 60) || 6));
                
                // Concise headline (≤ 8 words)
                const headlineWords = words.slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '');
                const headline = headlineWords.length > 0 ? headlineWords : `Scene ${i + 1}`;

                const nodeSlug = `node-${i + 1}`;
                const nodeLabel = headline.slice(0, 24);
                chapters.push(nodeLabel);

                nodes.push({
                  id: nodeSlug,
                  label: nodeLabel,
                  x: -360 + (i * 240),
                  y: i % 2 === 0 ? -120 : 120,
                  w: 240,
                  h: 80,
                });

                if (i > 0) {
                  edges.push({
                    from: `node-${i}`,
                    to: nodeSlug,
                    dashed: i === count - 1,
                  });
                }

                // Select semantic visual blocks based on shot index & topic
                let visualBlock: any;
                if (i === 0) {
                  visualBlock = {
                    c: "CharacterBeat",
                    characterId,
                    poses: [
                      { t: 0.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: -20 }, leftArm: { rotate: 20 } } },
                      { t: 0.4, groups: { torso: { rotate: 3 }, rightArm: { rotate: -65 }, leftArm: { rotate: -10 } } },
                      { t: 1.0, groups: { torso: { rotate: 0 }, rightArm: { rotate: 0 }, leftArm: { rotate: 0 } } },
                    ],
                  };
                } else if (i === count - 1) {
                  visualBlock = {
                    c: "CharacterBeat",
                    characterId,
                    poses: [
                      { t: 0.0, groups: { torso: { rotate: 0 }, head: { rotate: 0 }, leftArm: { rotate: 0 }, rightArm: { rotate: 0 } } },
                      { t: 0.25, groups: { torso: { rotate: 0 }, head: { rotate: -4 }, leftArm: { rotate: 110 }, rightArm: { rotate: -110 } } },
                      { t: 0.85, groups: { torso: { rotate: 0 }, head: { rotate: -4 }, leftArm: { rotate: 110 }, rightArm: { rotate: -110 } } },
                      { t: 1.0, groups: { torso: { rotate: 0 }, head: { rotate: 0 }, leftArm: { rotate: 0 }, rightArm: { rotate: 0 } } },
                    ],
                  };
                } else if (i === 1) {
                  visualBlock = {
                    c: "ScaleBar",
                    ticks: ["10%", "30%", "60%", "100%"],
                    value: 0.75,
                    label: "Efficiency Scaling",
                  };
                } else if (i === 2) {
                  visualBlock = {
                    c: "LayerStack",
                    count: 8,
                    bottomLabel: "Input Baseline",
                    topLabel: "Optimized Output",
                  };
                } else {
                  visualBlock = {
                    c: "TokenStrip",
                    tokens: ["Step 1", "Step 2", "Step 3", "Complete"],
                    lit: [0],
                    caption: "Sequential Execution Flow",
                  };
                }

                shots.push({
                  id: `shot-${i + 1}`,
                  dur,
                  look: nodeSlug,
                  move: i === 0 ? "cut" : "pan",
                  stage: "frame",
                  drift: false,
                  zoom: 1,
                  visualDirection: `Visualizing ${headline}`,
                  blocks: [
                    {
                      c: "TextReveal",
                      text: headline,
                      size: "headline",
                      accentWord: headline.split(' ')[0] || "Key",
                    },
                    visualBlock,
                  ],
                });
              }

              newFilm = {
                id: cleanId,
                title: title.trim(),
                fps: 30,
                accent,
                theme: {
                  background: theme as any,
                  fontFamily: "geist",
                  storyStyle: "script-metaphor",
                  cameraAngle: "isometric",
                  accent,
                },
                chapters,
                canvas: {
                  nodes,
                  edges,
                },
                shots,
              };
              }
            } else {
              newFilm = {
                id: cleanId,
                title: title.trim(),
                fps: 30,
                accent: "#635BFF",
                theme: {
                  background: "smooth-dark",
                  fontFamily: "geist",
                  storyStyle: "script-metaphor",
                  cameraAngle: "isometric",
                  accent: "#635BFF"
                },
                chapters: ["Introduction", "Core Mechanism", "Architecture", "Payoff"],
                canvas: {
                  nodes: [
                    { id: "intro", label: title.trim(), x: -200, y: -100, w: 230, h: 70 },
                    { id: "mechanism", label: "Core Concept", x: 160, y: -100, w: 230, h: 70 },
                    { id: "system", label: "System Flow", x: 160, y: 150, w: 230, h: 70 },
                    { id: "result", label: "Key Payoff", x: -200, y: 150, w: 230, h: 70 }
                  ],
                  edges: [
                    { from: "intro", to: "mechanism", dashed: false },
                    { from: "mechanism", to: "system", dashed: false },
                    { from: "system", to: "result", dashed: true }
                  ]
                },
                shots: [
                  {
                    id: "shot-1",
                    dur: 6,
                    look: "intro",
                    move: "cut",
                    stage: "frame",
                    drift: false,
                    zoom: 1,
                    blocks: [{ c: "TextReveal", text: title.trim(), size: "headline" }]
                  },
                  {
                    id: "shot-2",
                    dur: 7,
                    look: "mechanism",
                    move: "pan",
                    stage: "frame",
                    drift: false,
                    zoom: 1,
                    blocks: [{ c: "Body", text: "Visualizing the fundamental idea and mechanics." }]
                  },
                  {
                    id: "shot-3",
                    dur: 8,
                    look: "system",
                    move: "pan",
                    stage: "frame",
                    drift: false,
                    zoom: 1,
                    blocks: [{ c: "StatCounter", to: 10, label: "Performance Gain", format: "plain", suffix: "x" }]
                  },
                  {
                    id: "shot-4",
                    dur: 6,
                    look: "result",
                    move: "pan",
                    stage: "frame",
                    drift: false,
                    zoom: 1,
                    blocks: [{ c: "Body", text: "Summary and key takeaways." }]
                  }
                ]
              };
            }

            // 2. Create src/dl/films/<id>.ts and .json
            const filmFile = path.join(filmsDir, `${cleanId}.ts`);
            fs.writeFileSync(filmFile, filmModule(newFilm), 'utf8');
            fs.writeFileSync(path.join(filmsDir, `${cleanId}.json`), JSON.stringify(newFilm, null, 2), 'utf8');

            // 3. Point activeFilm.ts to new film
            const activeFilmFile = path.resolve(__dirname, '../src/dl/activeFilm.ts');
            fs.writeFileSync(
              activeFilmFile,
              `import { ${exportName(cleanId)} } from "./films/${cleanId}";\nimport type { Film } from "./schema";\n\nexport const ACTIVE_FILM: Film = ${exportName(cleanId)};\n`,
              'utf8'
            );

            sendJson(res, 200, {
              ok: true,
              id: cleanId,
              film: newFilm,
              script: initialScript,
            });
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/active-film (Get or Set the active film ID)
        if (url === '/api/active-film') {
          const activeFilmFile = path.resolve(__dirname, '../src/dl/activeFilm.ts');
          if (req.method === 'GET') {
            let activeId = 'kvcache';
            if (fs.existsSync(activeFilmFile)) {
              const content = fs.readFileSync(activeFilmFile, 'utf8');
              const match = content.match(/from\s+["']\.\/films\/([a-zA-Z0-9_-]+)["']/);
              if (match) activeId = match[1];
            }
            sendJson(res, 200, { ok: true, activeId });
            return;
          }
          if (req.method === 'POST') {
            void readBody(req).then((body: any) => {
              const { id } = body || {};
              if (!id || !FILM_ID.test(id)) {
                sendJson(res, 400, { error: `"${id}" is not a valid film ID.` });
                return;
              }
              const filmFile = path.join(filmsDir, `${id}.ts`);
              if (!fs.existsSync(filmFile)) {
                sendJson(res, 404, { error: `Film "${id}" not found on disk.` });
                return;
              }
              fs.writeFileSync(
                activeFilmFile,
                `import { ${exportName(id)} } from "./films/${id}";\nimport type { Film } from "./schema";\n\nexport const ACTIVE_FILM: Film = ${exportName(id)};\n`,
                'utf8'
              );
              sendJson(res, 200, { ok: true, activeId: id });
            }).catch(err => sendJson(res, 500, { error: String(err) }));
            return;
          }
        }

        if (url !== '/api/films' && !url.startsWith('/api/films/')) return next();

        if (url === '/api/films' && req.method === 'GET') {
          const set = new Set<string>();
          if (fs.existsSync(filmsDir)) {
            fs.readdirSync(filmsDir)
              .filter(f => f.endsWith('.ts') && f !== 'index.ts')
              .forEach(f => set.add(f.replace(/\.ts$/, '')));
          }
          if (fs.existsSync(videosDir)) {
            fs.readdirSync(videosDir)
              .filter(f => !f.startsWith('.') && fs.existsSync(path.join(videosDir, f, 'film.json')))
              .forEach(f => set.add(f));
          }
          sendJson(res, 200, Array.from(set).sort());
          return;
        }

        const id = url.slice('/api/films/'.length);
        if (!id) {
          sendJson(res, 400, { error: 'Film ID is required.' });
          return;
        }
        if (!FILM_ID.test(id)) {
          sendJson(res, 400, { error: `"${id}" is not a film id (lowercase letters, digits and dashes)` });
          return;
        }

        // Support GET /api/films/:id to fetch any film definition dynamically
        if (req.method === 'GET') {
          const videoPkgFilmPath = path.join(videosDir, id, 'film.json');
          if (fs.existsSync(videoPkgFilmPath)) {
            try {
              const film = JSON.parse(fs.readFileSync(videoPkgFilmPath, 'utf8'));
              sendJson(res, 200, { ok: true, film });
              return;
            } catch (err) {
              console.warn(`Failed to parse ${videoPkgFilmPath}, falling back to .ts:`, err);
            }
          }

          const filmPath = path.join(filmsDir, `${id}.ts`);
          if (!fs.existsSync(filmPath)) {
            sendJson(res, 404, { error: `Film "${id}" not found` });
            return;
          }
          const content = fs.readFileSync(filmPath, 'utf8');
          const jsonMatch = content.match(/=\s*(\{[\s\S]*\})\s*;/);
          if (jsonMatch) {
            try {
              const film = JSON.parse(jsonMatch[1]);
              sendJson(res, 200, { ok: true, film });
              return;
            } catch (err) {
              sendJson(res, 500, { error: `Failed to parse film JSON: ${String(err)}` });
              return;
            }
          } else {
            sendJson(res, 500, { error: `Invalid film module format for ${id}` });
            return;
          }
        }

        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `${req.method} ${url} is not allowed` });
          return;
        }

        // The film is parsed here rather than trusted: the editor is the only
        // writer of src/dl/films, so anything that reaches disk has to be
        // something `npm run validate` and the render would accept.
        void readBody(req)
          .then(body => {
            const raw = body as any;
            const film = raw?.film || raw;
            const parsed = filmSchema.safeParse(film);
            if (!parsed.success) {
              sendJson(res, 400, {
                error: 'invalid film',
                issues: parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`),
              });
              return;
            }
            if (parsed.data.id !== id) {
              sendJson(res, 400, { error: `film id "${parsed.data.id}" does not match /api/films/${id}` });
              return;
            }
            const file = path.join(filmsDir, `${id}.ts`);
            fs.writeFileSync(file, filmModule(parsed.data), 'utf8');

            // Sync to video package
            const pkgDir = path.join(videosDir, id);
            if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });
            fs.writeFileSync(path.join(pkgDir, 'film.json'), JSON.stringify(parsed.data, null, 2), 'utf8');

            const activeFilmFile = path.resolve(__dirname, '../src/dl/activeFilm.ts');
            fs.writeFileSync(
              activeFilmFile,
              `import { ${exportName(id)} } from "./films/${id}";\nimport type { Film } from "./schema";\n\nexport const ACTIVE_FILM: Film = ${exportName(id)};\n`,
              'utf8'
            );

            sendJson(res, 200, { ok: true, file: path.relative(path.resolve(__dirname, '..'), file), film: parsed.data });
          })
          .catch((e: unknown) => {
            sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          });
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), filmApiPlugin()],
  publicDir: path.resolve(__dirname, '../public'),
  server: {
    port: 3001,
    strictPort: true,
    fs: {
      allow: ['..']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react': path.resolve(__dirname, '../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
      'remotion': path.resolve(__dirname, '../node_modules/remotion'),
      '@remotion/player': path.resolve(__dirname, '../node_modules/@remotion/player')
    }
  }
})
