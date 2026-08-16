import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { filmSchema } from '../src/dl/schema.ts'
import type { Film } from '../src/dl/schema.ts'

const filmsDir = path.resolve(__dirname, '../src/dl/films');

// The schema's own id rule. It also happens to make traversal unrepresentable:
// a film can only ever be written as `<id>.ts` inside src/dl/films.
const FILM_ID = /^[a-z0-9-]+$/;

// `kv-cache` → `kvCacheFilm`. Film ids may contain dashes; identifiers may not.
const exportName = (id: string) =>
  `${id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}Film`;

// Films are pure data with a type-only import — see src/dl/films/kvcache.ts.
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

// Vite plugin to provide simple read/write API for films and video rendering
function filmApiPlugin(): Plugin {
  return {
    name: 'film-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];

        // Disable browser caching for media assets during development
        if (url.endsWith('.wav') || url.endsWith('.vtt')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
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
          const lines = raw.split("\n");
          const spokenParagraphs: string[] = [];
          let isCapturingVO = false;
          let currentVO: string[] = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Stop capturing if we reach production notes or sources
            if (
              line.toLowerCase().startsWith("### production notes") ||
              line.toLowerCase().startsWith("## production notes") ||
              line.toLowerCase().startsWith("### notes") ||
              line.toLowerCase().startsWith("## notes")
            ) {
              break;
            }

            // Detect VO start tag (e.g. **VO (energetic):**, **VO:**, VO:, Voiceover:, Narrator:)
            if (
              /^\*{0,2}VO\s*(\([^)]*\))?\s*:\*{0,2}/i.test(line) ||
              /^\*{0,2}Voiceover\s*(\([^)]*\))?\s*:\*{0,2}/i.test(line) ||
              /^\*{0,2}Narrator\s*(\([^)]*\))?\s*:\*{0,2}/i.test(line)
            ) {
              if (currentVO.length > 0) {
                spokenParagraphs.push(currentVO.join(" "));
                currentVO = [];
              }
              isCapturingVO = true;
              const afterTag = line
                .replace(/^\*{0,2}(VO|Voiceover|Narrator)\s*(\([^)]*\))?\s*:\*{0,2}\s*/i, "")
                .trim();
              if (afterTag) currentVO.push(afterTag);
              continue;
            }

            // Boundary checks: VISUAL, ON-SCREEN TEXT, scene headers ##, dividers ---
            if (
              /^\*{0,2}(VISUAL|ON-SCREEN TEXT|SCREEN|GRAPHICS|AUDIO|SFX)\s*:\*{0,2}/i.test(line) ||
              /^#{1,4}\s+/.test(line) ||
              line === "---" ||
              line === "***"
            ) {
              if (isCapturingVO && currentVO.length > 0) {
                spokenParagraphs.push(currentVO.join(" "));
                currentVO = [];
              }
              isCapturingVO = false;
              continue;
            }

            if (isCapturingVO && line.length > 0) {
              currentVO.push(line);
            }
          }

          if (currentVO.length > 0) {
            spokenParagraphs.push(currentVO.join(" "));
          }

          // If VO tags were identified, return strictly spoken dialogue
          if (spokenParagraphs.length > 0) {
            return spokenParagraphs
              .join("\n\n")
              .replace(/["“”]/g, "")
              .replace(/\*+/g, "")
              .replace(/—/g, " - ")
              .replace(/–/g, " - ")
              .trim();
          }

          // Fallback: clean markdown syntax for raw prose
          return raw
            .replace(/^#+\s+/gm, "")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/—/g, " - ")
            .replace(/–/g, " - ")
            .trim();
        }

        // Handle /api/parse-script-scenes (Intelligently construct shots, visual directions & nodes from screenplay)
        if (url === '/api/parse-script-scenes' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const { script, filmTitle: _filmTitle = "Film" } = body || {};
            if (!script) {
              sendJson(res, 400, { error: 'Script text is required' });
              return;
            }

            const spokenText = extractSpokenVoiceover(script);
            const sections = script.split(/^##\s+/m);
            const shots: any[] = [];
            const nodes: any[] = [];
            let currentTime = 0;

            for (const sec of sections) {
              const lines = sec.split("\n").map((l: string) => l.trim()).filter(Boolean);
              if (lines.length === 0) continue;

              const header = lines[0];
              if (header.toLowerCase().includes("production notes") || header.startsWith("#")) continue;

              const timeMatch = header.match(/\[(\d+):(\d+)\s*[-–—]\s*(\d+):(\d+)\]\s*(.*)/i);
              let startSec = currentTime;
              let endSec = currentTime + 12;
              let title = header;

              if (timeMatch) {
                startSec = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
                endSec = parseInt(timeMatch[3], 10) * 60 + parseInt(timeMatch[4], 10);
                title = timeMatch[5] || header;
              }
              const duration = Math.max(5, endSec - startSec);
              currentTime = endSec;

              let visualText = "";
              let onScreenText = "";
              let voText = "";

              for (const l of lines) {
                if (/^\*{0,2}VISUAL:\*{0,2}\s*(.*)/i.test(l)) {
                  visualText = l.replace(/^\*{0,2}VISUAL:\*{0,2}\s*/i, "").replace(/["“”]/g, "");
                } else if (/^\*{0,2}ON-SCREEN TEXT:\*{0,2}\s*(.*)/i.test(l)) {
                  onScreenText = l.replace(/^\*{0,2}ON-SCREEN TEXT:\*{0,2}\s*/i, "").replace(/["“”]/g, "");
                } else if (/^\*{0,2}VO\s*(\([^)]*\))?:\*{0,2}\s*(.*)/i.test(l)) {
                  voText = l.replace(/^\*{0,2}VO\s*(\([^)]*\))?:\*{0,2}\s*/i, "").replace(/["“”]/g, "");
                }
              }

              const slug = title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 24) || `scene-${shots.length + 1}`;

              nodes.push({
                id: slug,
                label: title.slice(0, 24),
                sub: onScreenText.slice(0, 32) || visualText.slice(0, 32) || "Key concept",
                x: -200 + (shots.length % 3) * 260,
                y: -100 + Math.floor(shots.length / 3) * 180,
                w: 230,
                h: 68,
              });

              const blocks: any[] = [];
              if (onScreenText) {
                blocks.push({ c: "TextReveal", text: onScreenText.slice(0, 160), size: "headline" });
              }
              if (visualText) {
                blocks.push({ c: "Body", text: visualText.slice(0, 300) });
              }
              if (blocks.length === 0) {
                blocks.push({ c: "TextReveal", text: title, size: "headline" });
              }

              shots.push({
                id: slug,
                dur: duration,
                look: slug,
                move: shots.length === 0 ? "cut" : "pan",
                stage: shots.length === 0 ? "anchor" : shots.length === sections.length - 2 ? "anchor" : "frame",
                zoom: 1,
                drift: true,
                visualDirection: visualText || undefined,
                metaphor: "custom",
                scriptText: voText || undefined,
                blocks,
              });
            }

            const edges = [];
            for (let i = 0; i < nodes.length - 1; i++) {
              edges.push({
                from: nodes[i].id,
                to: nodes[i + 1].id,
                dashed: false,
              });
            }

            sendJson(res, 200, {
              ok: true,
              shots,
              nodes,
              edges,
              spokenText,
              wordCount: spokenText.split(/\s+/).filter(Boolean).length,
              durationSec: Math.round((spokenText.split(/\s+/).filter(Boolean).length / 150) * 60),
            });
          }).catch(err => sendJson(res, 500, { error: String(err) }));
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

            // Extract ONLY spoken dialogue lines if screenplay format is present, or use spokenTextOverride directly from words
            const cleanText = spokenTextOverride && typeof spokenTextOverride === 'string' && spokenTextOverride.trim()
              ? spokenTextOverride.trim()
              : extractSpokenVoiceover(script || '');

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

                const paragraphs = cleanText.split('\n\n').filter(Boolean);
                const allAudio: Float32Array[] = [];
                let sampleRate = 24000;

                for (let i = 0; i < paragraphs.length; i++) {
                  const p = paragraphs[i].trim();
                  if (!p) continue;
                  console.log(`[TTS] Kokoro [${i + 1}/${paragraphs.length}] (${p.length} chars): ${p.slice(0, 35)}...`);
                  const audio = await tts.generate(p, { voice: kokoroVoice });
                  sampleRate = audio.sampling_rate;
                  allAudio.push(audio.audio);
                  // 250ms natural pause between paragraphs
                  const pauseSamples = Math.floor(sampleRate * 0.25);
                  allAudio.push(new Float32Array(pauseSamples));
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

              // Invalidate stale word transcript cache on new audio generation
              const staleCachePath = path.join(scriptsDir, `voiceover_${projectId}_words.json`);
              if (fs.existsSync(staleCachePath)) {
                try { fs.unlinkSync(staleCachePath); } catch (_) {}
              }

              sendJson(res, 200, {
                ok: true,
                filename: outFilename,
                audioSrc: `/${outFilename}?t=${Date.now()}`,
                scriptFile: `scripts/${projectId}.md`,
                spokenWordCount: cleanText.split(/\s+/).filter(Boolean).length,
                estimatedDurationSec: Math.round((cleanText.split(/\s+/).filter(Boolean).length / 150) * 60),
              });
            } else {
              sendJson(res, 500, { error: 'Failed to synthesize voiceover audio.' });
            }
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/audio-transcript/:id (Extracts or loads word-by-word timestamps for interactive voiceover editing)
        if (url.startsWith('/api/audio-transcript/') && req.method === 'GET') {
          const rawId = url.slice('/api/audio-transcript/'.length);
          const [id, queryStr] = rawId.split('?');
          const forceRefresh = Boolean(queryStr && (queryStr.includes('force=1') || queryStr.includes('refresh=1') || queryStr.includes('t=')));
          const scriptsDir = path.resolve(__dirname, '../scripts');
          const publicDir = path.resolve(__dirname, '../public');
          const cachePath = path.join(scriptsDir, `voiceover_${id}_words.json`);
          const audioPath = path.join(publicDir, `voiceover_${id}.wav`);

          if (!forceRefresh && fs.existsSync(cachePath)) {
            try {
              const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
              const scriptPath = path.join(scriptsDir, `${id}.md`);
              let scriptWordsCount = 0;
              if (fs.existsSync(scriptPath)) {
                const spoken = extractSpokenVoiceover(fs.readFileSync(scriptPath, 'utf8'));
                scriptWordsCount = spoken.split(/\s+/).filter(Boolean).length;
              }
              if (Array.isArray(cached.words) && (scriptWordsCount === 0 || cached.words.length >= Math.min(scriptWordsCount * 0.7, 800))) {
                sendJson(res, 200, { ok: true, words: cached.words, source: 'cache' });
                return;
              } else {
                console.log(`[STT] Bypassing stale cache (${cached?.words?.length || 0} words vs ${scriptWordsCount} script words)`);
              }
            } catch (_) {}
          }

          if (!fs.existsSync(audioPath)) {
            sendJson(res, 404, { error: `Audio file voiceover_${id}.wav not found.` });
            return;
          }

          // Transcribe using Deepgram Nova-2 for exact acoustic word timestamps
          void (async () => {
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
                const { createClient } = await import('@deepgram/sdk');
                const deepgram = createClient(deepgramKey);
                const audioBuffer = fs.readFileSync(audioPath);
                const sttRes = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
                  model: 'nova-2',
                  smart_format: true,
                  punctuate: true,
                  words: true,
                });
                const rawWords = sttRes.result?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
                const words = rawWords.map((w: any, idx: number) => ({
                  id: `w-${idx}`,
                  word: w.word,
                  punctuated: w.punctuated_word || w.word,
                  start: Number(w.start.toFixed(2)),
                  end: Number(w.end.toFixed(2)),
                  confidence: w.confidence,
                }));

                fs.writeFileSync(cachePath, JSON.stringify({ words }, null, 2), 'utf8');
                sendJson(res, 200, { ok: true, words, source: 'deepgram-nova2' });
                return;
              } catch (e) {
                console.warn('[STT] Deepgram word alignment error, falling back to script alignment:', e);
              }
            }

            // Fallback: Proportional word alignment from script
            const scriptPath = path.join(scriptsDir, `${id}.md`);
            let rawScript = '';
            if (fs.existsSync(scriptPath)) rawScript = fs.readFileSync(scriptPath, 'utf8');
            const spokenText = extractSpokenVoiceover(rawScript);
            const wordsList = spokenText.split(/\s+/).filter(Boolean);
            const totalDurationSec = 250; // estimate
            const secPerWord = totalDurationSec / (wordsList.length || 1);

            const fallbackWords = wordsList.map((w, idx) => ({
              id: `w-${idx}`,
              word: w.replace(/[^\w]/g, '').toLowerCase(),
              punctuated: w,
              start: Number((idx * secPerWord).toFixed(2)),
              end: Number(((idx + 1) * secPerWord).toFixed(2)),
              confidence: 0.9,
            }));

            sendJson(res, 200, { ok: true, words: fallbackWords, source: 'proportional' });
          })();
          return;
        }

        // Handle /api/update-script-words (Applies inline word edits & feedback back to the script)
        if (url === '/api/update-script-words' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const { projectId, updatedScript, wordChanges } = body || {};
            const scriptsDir = path.resolve(__dirname, '../scripts');
            const scriptPath = path.join(scriptsDir, `${projectId}.md`);
            const cachePath = path.join(scriptsDir, `voiceover_${projectId}_words.json`);

            if (updatedScript) {
              fs.writeFileSync(scriptPath, updatedScript, 'utf8');
            } else if (wordChanges && Array.isArray(wordChanges) && fs.existsSync(scriptPath)) {
              let content = fs.readFileSync(scriptPath, 'utf8');
              for (const change of wordChanges) {
                if (change.oldText && change.newText !== undefined) {
                  content = content.replace(change.oldText, change.newText);
                }
              }
              fs.writeFileSync(scriptPath, content, 'utf8');
            }

            // Invalidate STT transcript cache so next synthesis gets fresh word timings
            if (fs.existsSync(cachePath)) {
              try { fs.unlinkSync(cachePath); } catch (_) {}
            }

            const currentScript = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
            sendJson(res, 200, { ok: true, script: currentScript });
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/projects/new (Create fresh video project)
        if (url === '/api/projects/new' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const { title, id, script = '' } = body || {};
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

            // 2. Create src/dl/films/<id>.ts
            const newFilm: Film = {
              id: cleanId,
              title: title.trim(),
              fps: 30,
              accent: "#635BFF",
              theme: {
                background: "dot-grid",
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
                  dur: 8,
                  look: "intro",
                  move: "pan",
                  stage: "anchor",
                  zoom: 1,
                  drift: true,
                  blocks: [{ c: "TextReveal", text: title.trim(), size: "headline" }]
                },
                {
                  id: "shot-2",
                  dur: 10,
                  look: "mechanism",
                  move: "pan",
                  stage: "frame",
                  zoom: 1.1,
                  drift: true,
                  blocks: [{ c: "Body", text: "Visualizing the fundamental idea and mechanics." }]
                },
                {
                  id: "shot-3",
                  dur: 12,
                  look: "system",
                  move: "pan",
                  stage: "frame",
                  zoom: 1.15,
                  drift: true,
                  blocks: [{ c: "StatCounter", to: 10, label: "Performance Gain", format: "plain", suffix: "x" }]
                },
                {
                  id: "shot-4",
                  dur: 8,
                  look: "result",
                  move: "zoom-out",
                  stage: "anchor",
                  zoom: 0.9,
                  drift: false,
                  blocks: [{ c: "Body", text: "Summary and key takeaways." }]
                }
              ]
            };

            const filmFile = path.join(filmsDir, `${cleanId}.ts`);
            fs.writeFileSync(filmFile, filmModule(newFilm), 'utf8');

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
          const files = fs.readdirSync(filmsDir).filter(f => f.endsWith('.ts') && f !== 'index.ts');
          sendJson(res, 200, files.map(f => f.replace(/\.ts$/, '')).sort());
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
    port: 3000,
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
