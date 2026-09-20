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
import { produceAudioPipeline, splitScriptIntoSegments, chunkTextForTTS, trimSilence, retimeAudioSync, resolveAudioSourcePath, ensureRetimedAudio } from '../backend/audio.ts'
import { extractAudioPeaks } from '../backend/timeline/waveform.ts'
import { transcribe, writeImportWords } from '../backend/transcribe.ts'
import { detectFillers } from '../backend/editContext/detectFillers.ts'
import { detectSilences } from '../backend/editContext/detectSilences.ts'
import { buildEditContext } from '../backend/editContext/buildEditContext.ts'
import { planEdits, applyEditProgram } from '../backend/editPlanner/index.ts'
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from '../src/dl/convertFilm.ts'
import { executeCritique } from '../backend/critique/engine.ts'
import {
  extractSpokenBlocks as extractSpokenVoiceoverBlocks,
  buildFilmPartsFromScript,
  hasScreenplayTags,
  generateAgentPrompt,
  generateDirectorTaskDocument,
} from '../backend/scriptIntake.ts'
import {
  dispatchPromptToAgent,
  buildDirectingPrompt,
  getAgentSession,
  setAgentSession,
} from '../backend/agentPrompter.ts'
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

// Loads a film by id, preferring the video package's film.json (authoritative) and
// falling back to the generated src/dl/films/<id>.ts module.
function readFilm(filmId: string): Film | null {
  const pkgFilmPath = path.join(videosDir, filmId, 'film.json');
  if (fs.existsSync(pkgFilmPath)) {
    try {
      return JSON.parse(fs.readFileSync(pkgFilmPath, 'utf8'));
    } catch {
      // Fall through to the .ts module
    }
  }
  const filmPath = path.join(filmsDir, `${filmId}.ts`);
  if (fs.existsSync(filmPath)) {
    const jsonMatch = fs.readFileSync(filmPath, 'utf8').match(/=\s*(\{[\s\S]*\})\s*;/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
  }
  return null;
}

// Persists a film to both the video package (authoritative, read by the editor Player)
// and the generated src/dl/films/<id>.ts module (read by Remotion's CLI render/activeFilm
// bundle), so the two never drift the way they did when B-roll auto-wiring only touched one.
function writeFilm(filmId: string, film: Film): void {
  const pkgDir = path.join(videosDir, filmId);
  if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'film.json'), JSON.stringify(film, null, 2), 'utf8');

  const filmPath = path.join(filmsDir, `${filmId}.ts`);
  if (fs.existsSync(filmPath)) {
    fs.writeFileSync(filmPath, filmModule(film), 'utf8');
  }
}

// Wires a finished B-roll clip into a shot's blocks as an AnalogyInset, replacing any
// existing one, and persists the film to both authoritative locations.
function wireFootageIntoFilm(filmId: string, shotId: string, relPath: string, promptText: string): void {
  const film = readFilm(filmId);
  if (!film) return;
  const targetShot = film.shots.find((s) => s.id === shotId);
  if (!targetShot) return;

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

  writeFilm(filmId, film);
  console.log(`[broll] Successfully wired ${relPath} into shot ${shotId} of ${filmId}`);
}

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

const ASSET_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.vtt': 'text/vtt',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// Serves a file from disk with byte-range support, so video/audio scrubbing works for
// per-video package assets that live outside Vite's publicDir (which won't follow the
// public/videos -> ../videos symlink due to its realpath containment check).
function serveFileWithRange(req: IncomingMessage, res: ServerResponse, filePath: string) {
  const stat = fs.statSync(filePath);
  const contentType = ASSET_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (range) {
    const match = /bytes=(-?\d*)-(\d*)/.exec(range);
    let start = 0;
    let end = stat.size - 1;

    if (match) {
      if (match[1].startsWith('-')) {
        const suffix = parseInt(match[1].slice(1), 10);
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      } else {
        start = match[1] ? parseInt(match[1], 10) : 0;
        end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      }
    }

    if (start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(filePath).pipe(res);
}

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
          const footageDir = path.join(videosDir, filmId, 'footage');
          if (!fs.existsSync(footageDir)) fs.mkdirSync(footageDir, { recursive: true });
          const relPath = `videos/${filmId}/footage/${shotId}.mp4`;
          const destPath = path.join(footageDir, `${shotId}.mp4`);
          await engine.fetchOutput(handle.jobId, destPath);

          current.footageSrc = relPath;
          current.progress = 1;
          current.finishedAt = Date.now();

          // Auto-wire footage into the film so it persists immediately. videos/<id>/film.json
          // is the authoritative copy the editor Player reads; src/dl/films/<id>.ts is kept in
          // sync too since it's what Remotion's CLI render/activeFilm bundle reads.
          try {
            wireFootageIntoFilm(filmId, shotId, relPath, promptText);
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

        // Serve self-contained video package assets (footage, voiceover, script) directly
        // from videos/<slug>/ on disk. staticFile('videos/<slug>/...') resolves to this
        // same URL path under Vite's publicDir, but Vite's own static middleware won't
        // follow the public/videos symlink, so it's served explicitly here instead.
        if (url.startsWith('/videos/') && req.method === 'GET') {
          const rel = decodeURIComponent(url.slice('/videos/'.length));
          const filePath = path.join(videosDir, rel);
          if (!rel.includes('..') && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            serveFileWithRange(req, res, filePath);
            return;
          }
          const m = rel.match(/^([^/]+)\/footage\/([^/]+)$/);
          if (m && !rel.includes('..')) {
            const legacyPath = path.resolve(__dirname, '../public/footage', `${m[1]}_${m[2]}`);
            if (fs.existsSync(legacyPath) && fs.statSync(legacyPath).isFile()) {
              serveFileWithRange(req, res, legacyPath);
              return;
            }
          }
        }

        // Serve cached pitch-corrected retimed audio directly from .tmp_audio/
        if (url.startsWith('/.tmp_audio/') && req.method === 'GET') {
          const rel = decodeURIComponent(url.slice('/.tmp_audio/'.length));
          const filePath = path.join(path.resolve(__dirname, '../.tmp_audio'), rel);
          if (!rel.includes('..') && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            serveFileWithRange(req, res, filePath);
            return;
          }
          const pubPath = path.join(path.resolve(__dirname, '../public/.tmp_audio'), rel);
          if (!rel.includes('..') && fs.existsSync(pubPath) && fs.statSync(pubPath).isFile()) {
            serveFileWithRange(req, res, pubPath);
            return;
          }
        }

        // Handle /api/audio/retime (Pitch-corrected WSOLA time-stretching with FFmpeg atempo)
        if (url.startsWith('/api/audio/retime')) {
          if (req.method === 'GET') {
            const parsedUrl = new URL(req.url ?? '', 'http://localhost');
            const src = parsedUrl.searchParams.get('src');
            const speed = parseFloat(parsedUrl.searchParams.get('speed') || '1.0');
            if (!src) {
              sendJson(res, 400, { error: 'src parameter is required' });
              return;
            }
            try {
              const result = retimeAudioSync(src, speed);
              serveFileWithRange(req, res, result.filePath);
            } catch (err: any) {
              console.error('[audio/retime] Error retiming audio:', err);
              sendJson(res, 500, { error: err?.message || 'Failed to retime audio' });
            }
            return;
          }

          if (req.method === 'POST') {
            void readBody(req).then((body) => {
              const { src, speed } = (body as { src?: string; speed?: number }) || {};
              if (!src) {
                sendJson(res, 400, { error: 'src is required' });
                return;
              }
              const numSpeed = typeof speed === 'number' && speed > 0 ? speed : 1.0;
              try {
                const result = retimeAudioSync(src, numSpeed);
                sendJson(res, 200, {
                  success: true,
                  url: `/api/audio/retime?src=${encodeURIComponent(src)}&speed=${numSpeed}`,
                  path: result.filePath,
                  duration: result.durationSec,
                });
              } catch (err: any) {
                console.error('[audio/retime] Error retiming audio:', err);
                sendJson(res, 500, { error: err?.message || 'Failed to retime audio' });
              }
            });
            return;
          }
        }

        // Handle /api/audio/peaks (Compute or fetch amplitude envelope peaks for timeline waveforms)
        if (url.startsWith('/api/audio/peaks') && req.method === 'GET') {
          const parsedUrl = new URL(req.url ?? '', 'http://localhost');
          const src = parsedUrl.searchParams.get('src');
          const points = parseInt(parsedUrl.searchParams.get('points') || '100', 10);
          if (!src) {
            sendJson(res, 400, { error: 'src parameter is required' });
            return;
          }
          try {
            const resolvedPath = resolveAudioSourcePath(src);
            const peakCount = Math.max(10, Math.min(5000, points));
            const peaksData = extractAudioPeaks(resolvedPath, peakCount);
            sendJson(res, 200, peaksData);
          } catch (err: any) {
            console.error('[audio/peaks] Error extracting audio peaks:', err);
            sendJson(res, 500, { error: err?.message || 'Failed to extract audio peaks' });
          }
          return;
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
                const fullPath = path.join(videosDir, film.id, 'footage', `${s.id}.mp4`);
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

              // Ensure retimed audio is pre-rendered for Remotion CLI
              ensureRetimedAudio(film);

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

              let renderLogs = '';
              child.stdout?.on('data', (d) => {
                const text = d.toString();
                renderLogs = (renderLogs + text).slice(-4000);
                process.stdout.write(text);
              });
              child.stderr?.on('data', (d) => {
                const text = d.toString();
                renderLogs = (renderLogs + text).slice(-4000);
                process.stderr.write(text);
              });

              child.on('close', (code) => {
                if (code === 0) {
                  sendJson(res, 200, {
                    ok: true,
                    filename,
                    downloadUrl: `/api/downloads/${filename}`,
                  });
                } else {
                  sendJson(res, 500, {
                    error: `Remotion render exited with code ${code}: ${renderLogs.trim()}`,
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
              let filmObj: Film | null = clientFilm || readFilm(filmId);

              if (!filmObj) {
                sendJson(res, 404, { error: `Film ${filmId} not found` });
                return;
              }

              // If client passed updated film, persist it first so shot flags are synchronized
              if (clientFilm) {
                writeFilm(filmId, clientFilm);
              }

              const spawnedJobs: BrollJobRecord[] = [];

              if (allPending) {
                const pendingShots = filmObj.shots.filter((s) => {
                  if (!s.needsFootage) return false;
                  return !fs.existsSync(path.join(videosDir, filmId, 'footage', `${s.id}.mp4`));
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

          const footageDir = path.join(videosDir, filmId, 'footage');
          const existingFootage: Record<string, string> = {};
          if (fs.existsSync(footageDir)) {
            const files = fs.readdirSync(footageDir);
            for (const f of files) {
              if (f.endsWith('.mp4')) {
                const shotId = f.slice(0, -4);
                existingFootage[shotId] = `videos/${filmId}/footage/${f}`;
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

        // Handle /api/scripts/:id (Read and Save scripts, self-contained under videos/<id>/)
        if (url.startsWith('/api/scripts/')) {
          const scriptId = url.slice('/api/scripts/'.length);
          const pkgDir = path.join(videosDir, scriptId);

          if (req.method === 'GET') {
            const scriptFile = path.join(pkgDir, 'script.md');
            let foundScript = '';
            if (fs.existsSync(scriptFile)) {
              foundScript = fs.readFileSync(scriptFile, 'utf8');
            } else if (fs.existsSync(path.join(filmsDir, `${scriptId}.ts`)) || fs.existsSync(path.join(pkgDir, 'film.json'))) {
              // Draft placeholder for an existing project that has no script yet
              foundScript = `# ${scriptId}\n\nPaste your narration script here. Each paragraph will sync with your video scenes and visual metaphors.\n\nClick "Generate Voiceover (.wav)" to generate studio audio.`;
            }
            sendJson(res, 200, { ok: true, script: foundScript });
            return;
          }

          if (req.method === 'POST') {
            void readBody(req).then((body: any) => {
              const { script } = body || {};
              if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });
              const targetFile = path.join(pkgDir, 'script.md');
              fs.writeFileSync(targetFile, script || '', 'utf8');
              sendJson(res, 200, { ok: true, file: `videos/${scriptId}/script.md` });
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
            const { script, filmTitle = "Film", targetDurationSec, projectId = "kvcache" } = body || {};
            if (!script) {
              sendJson(res, 400, { error: 'Script text is required' });
              return;
            }

            const { shots, nodes, edges, spokenText, wordCount, durationSec } = buildFilmPartsFromScript(script, targetDurationSec);

            const pkgDir = path.join(videosDir, projectId);
            if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });

            // Persist screenplay doc
            fs.writeFileSync(path.join(pkgDir, 'script.md'), script, 'utf8');

            // Generate Creative Director directive & prompt for terminal coding agent
            const taskOpts = {
              projectId,
              filmTitle,
              shotCount: shots.length,
              durationSec,
              spokenWordCount: wordCount,
            };
            const agentPrompt = generateAgentPrompt(taskOpts);
            const taskDoc = generateDirectorTaskDocument(taskOpts);

            const taskPath = path.join(pkgDir, 'director_task.md');
            fs.writeFileSync(taskPath, taskDoc, 'utf8');
            const rootTaskPath = path.resolve(__dirname, '../.aideos_task.md');
            fs.writeFileSync(rootTaskPath, taskDoc, 'utf8');

            // Automatically prompt the active coding agent in tmux session
            const directingPrompt = buildDirectingPrompt({
              event: "auto_build_scenes",
              filmId: projectId,
              filmTitle,
              scriptText: script,
              durationSec,
              shotCount: shots.length,
            });
            const dispatch = dispatchPromptToAgent(directingPrompt);

            sendJson(res, 200, {
              ok: true,
              shots,
              nodes,
              edges,
              spokenText,
              wordCount,
              durationSec,
              agentPrompt,
              taskFile: `videos/${projectId}/director_task.md`,
              dispatch,
            });
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/prompt-agent (Directly auto-prompts active terminal agent)
        if (url === '/api/prompt-agent' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const { filmId = "kvcache", filmTitle = "Film", event = "custom_directive", customInstruction, script } = body || {};
            const prompt = buildDirectingPrompt({
              event,
              filmId,
              filmTitle,
              customInstruction,
              scriptText: script,
            });
            const dispatch = dispatchPromptToAgent(prompt);
            sendJson(res, 200, { ok: true, dispatch, prompt });
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/agent-session (Read/Update active agent session metadata)
        if (url === '/api/agent-session' && req.method === 'GET') {
          const session = getAgentSession();
          sendJson(res, 200, { ok: true, session });
          return;
        }
        if (url === '/api/agent-session' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const updated = setAgentSession(body || {});
            sendJson(res, 200, { ok: true, session: updated });
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
            const pkgDir = path.join(videosDir, film.id);
            const audioResult = await produceAudioPipeline(scriptInput, pkgDir);

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
              voiceover: { src: `videos/${film.id}/voiceover.wav`, volume: 1 },
            };

            // Flatten per-segment word timings onto the film's timeline for the Pretext
            // kinetic captions editor
            const flatWords = audioResult.segments.flatMap((seg) =>
              seg.words.map((w) => ({
                word: w.word,
                punctuated_word: w.punctuated_word,
                start: Number((seg.startOffset + w.start).toFixed(3)),
                end: Number((seg.startOffset + w.end).toFixed(3)),
              }))
            );
            fs.writeFileSync(path.join(pkgDir, 'voiceover_words.json'), JSON.stringify({ words: flatWords }, null, 2), 'utf8');

            sendJson(res, 200, { ok: true, film: updatedFilm, audioResult });
          }).catch(err => {
            console.error('[API voiceover error]:', err);
            sendJson(res, 500, { error: String(err) });
          });
          return;
        }

        // Handle /api/visuals (List the SVG animations authored for a video package)
        if (url === '/api/visuals' && req.method === 'GET') {
          const parsed = new URL(req.url || '', 'http://localhost');
          const filmId = parsed.searchParams.get('filmId') || '';
          if (!FILM_ID.test(filmId)) {
            sendJson(res, 400, { error: 'filmId is required' });
            return;
          }
          const visualsDir = path.join(videosDir, filmId, 'visuals');
          if (!fs.existsSync(visualsDir)) {
            sendJson(res, 200, { ok: true, visuals: [] });
            return;
          }
          const visuals = fs
            .readdirSync(visualsDir)
            .filter(f => f.toLowerCase().endsWith('.svg'))
            .map(f => {
              const stats = fs.statSync(path.join(visualsDir, f));
              return {
                name: f.replace(/\.svg$/i, ''),
                src: `videos/${filmId}/visuals/${f}`,
                sizeBytes: stats.size,
                updatedAt: stats.mtimeMs,
              };
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
          sendJson(res, 200, { ok: true, visuals });
          return;
        }

        // Handle /api/visuals/save (Write an authored SVG animation into the video package)
        if (url === '/api/visuals/save' && req.method === 'POST') {
          void readBody(req)
            .then((body: any) => {
              const { filmId, name, svg } = body || {};
              if (!FILM_ID.test(String(filmId || ''))) {
                sendJson(res, 400, { error: 'filmId must be a film id (lowercase letters, digits and dashes)' });
                return;
              }
              const safeName = String(name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 48);
              if (!safeName) {
                sendJson(res, 400, { error: 'name is required' });
                return;
              }
              if (typeof svg !== 'string' || !svg.includes('<svg')) {
                sendJson(res, 400, { error: 'svg must be SVG markup containing an <svg> root' });
                return;
              }
              const visualsDir = path.join(videosDir, String(filmId), 'visuals');
              fs.mkdirSync(visualsDir, { recursive: true });
              const filePath = path.join(visualsDir, `${safeName}.svg`);
              fs.writeFileSync(filePath, svg, 'utf8');
              sendJson(res, 200, {
                ok: true,
                name: safeName,
                src: `videos/${filmId}/visuals/${safeName}.svg`,
              });
            })
            .catch(err => sendJson(res, 400, { error: String(err) }));
          return;
        }

        // Handle /api/visuals/delete (Remove an authored SVG animation from the video package)
        if (url === '/api/visuals/delete' && req.method === 'POST') {
          void readBody(req)
            .then((body: any) => {
              const { filmId, name } = body || {};
              const safeName = String(name || '').trim().replace(/[^a-z0-9-]/g, '');
              if (!FILM_ID.test(String(filmId || '')) || !safeName) {
                sendJson(res, 400, { error: 'filmId and name are required' });
                return;
              }
              const filePath = path.join(videosDir, String(filmId), 'visuals', `${safeName}.svg`);
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
              sendJson(res, 200, { ok: true });
            })
            .catch(err => sendJson(res, 400, { error: String(err) }));
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
            let width: number | undefined;
            let height: number | undefined;
            let fps: number | undefined;
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

            if (isVideo) {
              try {
                const out = spawnSync('ffprobe', [
                  '-v', 'error',
                  '-select_streams', 'v:0',
                  '-show_entries', 'stream=width,height,r_frame_rate',
                  '-of', 'csv=s=x:p=0',
                  filePath
                ]).stdout.toString().trim();
                const [wStr, hStr, rateStr] = out.split('x');
                const w = parseInt(wStr, 10);
                const h = parseInt(hStr, 10);
                if (!isNaN(w) && w > 0) width = w;
                if (!isNaN(h) && h > 0) height = h;
                if (rateStr) {
                  const [num, den] = rateStr.split('/').map(Number);
                  if (num > 0 && den > 0) fps = num / den;
                }
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
                ...(width ? { width } : {}),
                ...(height ? { height } : {}),
                ...(fps ? { fps } : {}),
              },
            });
          }).catch((err) => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/transcribe (word-level transcription of an imported video/audio source,
        // via Deepgram when configured or a local Whisper fallback otherwise)
        if (url === '/api/transcribe' && req.method === 'POST') {
          void readBody(req).then(async (body: any) => {
            const { filmId, src } = body || {};
            if (!filmId || !src) {
              sendJson(res, 400, { error: 'filmId and src are required' });
              return;
            }
            try {
              const result = await transcribe(src);
              const fillers = detectFillers(result.words);
              const fillerIndices = new Set<number>();
              for (const span of fillers) {
                for (let i = span.startIndex; i <= span.endIndex; i++) fillerIndices.add(i);
              }
              const words = result.words.map((w, i) => ({ ...w, filler: fillerIndices.has(i) }));
              const silences = detectSilences(result.words);
              const { wordsPath, vttPath } = writeImportWords(filmId, words, videosDir);
              sendJson(res, 200, {
                ok: true,
                backend: result.backend,
                words,
                fillers,
                silences,
                wordsPath: path.relative(path.resolve(__dirname, '..'), wordsPath),
                vttPath: path.relative(path.resolve(__dirname, '..'), vttPath),
              });
            } catch (err: any) {
              console.error('[transcribe] Error transcribing source:', err);
              sendJson(res, 500, { error: err?.message || 'Failed to transcribe source' });
            }
          }).catch((err) => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/ai-edit (Model-driven AI editing core, planning and executing EditOp programs)
        if (url === '/api/ai-edit' && req.method === 'POST') {
          void readBody(req).then(async (body: any) => {
            const { film, request, agentHints, transcript: providedTranscript, dryRun = true } = body || {};
            if (!film || !request) {
              sendJson(res, 400, { error: 'film and request are required' });
              return;
            }

            try {
              // Convert Film to LayeredFilm if necessary
              const layered = film.layers && film.clips ? film : convertFilmToLayeredFilm(film);
              const filmId = film.id || 'film';

              // Load or use provided transcript
              let transcript = Array.isArray(providedTranscript) ? providedTranscript : [];
              if (transcript.length === 0) {
                const importWordsPath = path.join(videosDir, filmId, 'import_words.json');
                const voWordsPath = path.join(videosDir, filmId, 'voiceover_words.json');
                if (fs.existsSync(importWordsPath)) {
                  try {
                    const raw = JSON.parse(fs.readFileSync(importWordsPath, 'utf8'));
                    transcript = raw.words || [];
                  } catch {}
                } else if (fs.existsSync(voWordsPath)) {
                  try {
                    const raw = JSON.parse(fs.readFileSync(voWordsPath, 'utf8'));
                    transcript = raw.words || [];
                  } catch {}
                }
              }

              const fillers = detectFillers(transcript);
              const silences = detectSilences(transcript);
              const durationSec = layered.clips.reduce((max: number, c: any) => Math.max(max, c.position + (c.end - c.start)), 0) || 30;

              const context = buildEditContext(layered, transcript, fillers, silences, {
                fps: layered.fps || 30,
                durationSec,
                accent: layered.accent,
                theme: layered.theme,
              });

              const planResult = await planEdits(request, context, undefined, { agentHints });

              // If dryRun, return plan and ops for client preview/approval
              if (dryRun) {
                sendJson(res, 200, {
                  ok: true,
                  dryRun: true,
                  plan: planResult.plan,
                  ops: planResult.ops,
                  attempts: planResult.attempts,
                  warnings: planResult.warnings,
                  context,
                });
                return;
              }

              // Apply the edit program
              const appliedResult = applyEditProgram(layered, planResult.ops, context);
              if (appliedResult.rejected.length > 0) {
                sendJson(res, 422, {
                  ok: false,
                  error: 'Failed to apply planned operations',
                  rejected: appliedResult.rejected,
                  plan: planResult.plan,
                  ops: planResult.ops,
                });
                return;
              }

              const updatedFilm = convertLayeredFilmToFilm(appliedResult.film, film);

              sendJson(res, 200, {
                ok: true,
                dryRun: false,
                plan: planResult.plan,
                ops: planResult.ops,
                attempts: planResult.attempts,
                warnings: planResult.warnings,
                film: updatedFilm,
              });
            } catch (err: any) {
              console.error('[ai-edit] Error planning/applying edit:', err);
              sendJson(res, 500, { error: err?.message || 'Failed to process AI edit request' });
            }
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

            const pkgDir = path.join(videosDir, projectId);
            if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });

            const outFilename = 'voiceover.wav';
            const publicPath = path.join(pkgDir, outFilename);

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
                    generated = true;
                  }
                }
                try { fs.unlinkSync(tmpText); fs.unlinkSync(tmpAiff); } catch (_) {}
              } catch (e) {
                console.error('[TTS] macOS fallback failed:', e);
              }
            }

            if (generated) {
              const scriptDocPath = path.join(pkgDir, 'script.md');
              fs.writeFileSync(scriptDocPath, script, 'utf8');

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
                        src: `videos/${projectId}/${outFilename}`,
                        volume: 1,
                        speed: 1,
                        version: Date.now().toString(),
                        durationSec: measuredDuration,
                      },
                      audioClips: undefined,
                    } as Film;
                    writeFilm(projectId, updatedFilm);
                  }
                } catch (syncErr) {
                  console.warn('[TTS] Automatic shot duration scaling error:', syncErr);
                }
              }

              const taskOpts = {
                projectId,
                filmTitle: updatedFilm?.title || projectId,
                shotCount: updatedShots?.length || (updatedFilm?.shots?.length ?? 0),
                durationSec: measuredDuration,
                spokenWordCount: cleanText.split(/\s+/).filter(Boolean).length,
              };
              const agentPrompt = generateAgentPrompt(taskOpts);
              const taskDoc = generateDirectorTaskDocument(taskOpts);

              fs.writeFileSync(path.join(pkgDir, 'director_task.md'), taskDoc, 'utf8');
              fs.writeFileSync(path.resolve(__dirname, '../.aideos_task.md'), taskDoc, 'utf8');

              // Automatically prompt the active coding agent in tmux session
              const directingPrompt = buildDirectingPrompt({
                event: "voiceover_ready",
                filmId: projectId,
                filmTitle: taskOpts.filmTitle,
                voiceoverFile: `videos/${projectId}/${outFilename}`,
                durationSec: measuredDuration,
                shotCount: taskOpts.shotCount,
              });
              const dispatch = dispatchPromptToAgent(directingPrompt);

              sendJson(res, 200, {
                ok: true,
                filename: outFilename,
                audioSrc: `/videos/${projectId}/${outFilename}?t=${Date.now()}`,
                scriptFile: `videos/${projectId}/script.md`,
                spokenWordCount: taskOpts.spokenWordCount,
                estimatedDurationSec: Math.round(measuredDuration),
                actualDurationSec: measuredDuration,
                shots: updatedShots,
                film: updatedFilm,
                agentPrompt,
                taskFile: `videos/${projectId}/director_task.md`,
                dispatch,
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
              writeFilm(result.updatedFilm.id, result.updatedFilm);
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

            // 1. Create videos/<id>/script.md
            const newPkgDir = path.join(videosDir, cleanId);
            if (!fs.existsSync(newPkgDir)) fs.mkdirSync(newPkgDir, { recursive: true });
            const initialScript = script.trim() || `# ${title}\n\nWrite your voiceover narration script here.\n\nEvery paragraph maps to visual scenes, 3D camera angles, and animated primitives.\n\nClick "Generate Voiceover (.wav)" when ready!`;
            fs.writeFileSync(path.join(newPkgDir, 'script.md'), initialScript, 'utf8');

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

            // 2. Create src/dl/films/<id>.ts (for Remotion's CLI render/activeFilm bundle)
            // and videos/<id>/film.json (authoritative, read by the editor Player)
            const filmFile = path.join(filmsDir, `${cleanId}.ts`);
            fs.writeFileSync(filmFile, filmModule(newFilm), 'utf8');
            writeFilm(cleanId, newFilm);

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
            writeFilm(id, parsed.data);

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
    },
    watch: {
      // Saving a film rewrites its generated module and package manifest. Those are data, not
      // editor source, so watching them would hot-reload the page on every autosave and throw the
      // user back to the first stage mid-edit.
      ignored: [
        path.resolve(__dirname, '../src/dl/films/**'),
        path.resolve(__dirname, '../src/dl/activeFilm.ts'),
        path.resolve(__dirname, '../videos/**'),
        path.resolve(__dirname, '../out/**'),
      ]
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
