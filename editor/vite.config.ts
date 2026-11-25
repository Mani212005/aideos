/**
 * File Description: Vite configuration and custom development API plugins for Aideos Studio editor server.
 * Inputs and outputs: Vite plugins and API route handlers -> Vite development and API server configuration.
 * Used by: npm run editor, Vite build, and Render container.
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';
import { releaseChannel } from '../backend/releaseChannel.ts';
import { writeDescriptionCredits } from '../backend/masterAudio.ts';
import { deliverReel } from '../backend/reelCut/writer.ts';
import { loadReelContext, readReelCut, reelPackageDir } from '../backend/reelCut/brief.ts';
import { checkReelCut } from '../backend/reelCut/check.ts';
import { formatInputs, reelBudgetFor, reelSourceFingerprint } from '../backend/reelCut/store.ts';
import { buildNewProjectFilm } from '../backend/newProjectFilm.ts';
import { acceptanceCheck, acceptanceCheckForFilm, hashFileOrNull } from '../backend/filmAcceptance/store.ts';
import { REEL_MAX_SEC, reelCutSchema } from '../backend/reelCut/schema.ts';
import { deliveryTimeline, DELIVERY_CONFIG } from '../src/dl/delivery.ts';
import { persistStudioSoundtrack, rebuildStudioSoundtrack, studioSoundtrackRequestSchema } from '../backend/designSpec/soundtrackStudio.ts';
import { fetchAudioItem, getAudioItemFilename, loadAudioLibrary, verifyAudioItem } from '../backend/audioLibrary/library.ts';
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { applyCaptionPlacementDraft } from '../backend/designCheck/captionPlacement.ts';
import { checkCaptionPlacementDraftAsync } from '../backend/designCheck/captionPlacementDraft.ts';
import { filmSchema } from '../src/dl/schema.ts'
import { withFootage } from '../src/dl/footageWiring.ts'
import { newProjectFilmTheme } from '../src/projectTheme.ts';
import type { Film } from '../src/dl/schema.ts'
import { decideSave, filmRevision, revisionOfFilm } from '../backend/filmRevision.ts';
import { CorruptFilmError, readFilm, readStoredFilm, writeFilm as writeStoredFilm, type WriteFilmOptions } from '../backend/pipeline/filmStore.ts';
import { getVideosDir, getExamplesDir, listVideoPackages, resolvePackageDir } from '../src/dl/videoPackageLoader.ts'
import { chunkTextForTTS, trimSilence, resolveAudioSourcePath, buildCaptionsVtt } from '../backend/audio.ts'
import { setActiveFilm } from '../backend/pipeline/generatedFiles.ts';
import { ensureEndCardVoice } from '../backend/endCard/voice.ts'
import { createExportJobs } from '../backend/exportJobs.ts'
import { pruneStudioExports } from '../backend/exportRetention.ts'
import {
  applyStudioCorsHeaders,
  guardStudioApiRequest,
  resolveAllowedHosts,
  resolveResourcePolicy,
  resolveStudioHost,
} from '../backend/studioApiGuard.ts'
import {
  kokoroWorkerSynthesizer,
  readContainerMemoryLimit,
  requestedVoiceKey,
  sayToWav,
  synthesizeVoiceover,
  VoiceSynthesisError,
} from '../backend/voiceSynthesis.ts'
import { AideosConfigError, resolveVoiceCloneSettings } from '../backend/aideosConfig.ts'
import {
  VCD_DEFAULT_VOICE_KEY,
  VCD_HINDI_VOICE_KEY,
  VcdUnavailableError,
  isVcdStudioVoice,
  probeVcdService,
  resolveVcdVoiceId,
  vcdStudioVoiceLanguage,
  vcdVoiceCacheKey,
  type VcdLanguagePreference,
} from '../backend/vcdClient.ts'
import { extractAudioPeaks } from '../backend/timeline/waveform.ts'
import { detectFillers } from '../backend/editContext/detectFillers.ts'
import { detectSilences } from '../backend/editContext/detectSilences.ts'
import { buildEditContext } from '../backend/editContext/buildEditContext.ts'
import { planEdits, applyEditProgram } from '../backend/editPlanner/index.ts'
import { assertFilmWriteAssetsExist, assertLayeredAssetsExist, layeredMediaSources } from '../backend/timeline/layerAssetCheck.ts'
import { appendEditProvenanceRecord, readEditProvenanceLog } from '../backend/editPlanner/provenanceLog.ts'
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from '../src/dl/convertFilm.ts'
import {
  extractSpokenBlocks as extractSpokenVoiceoverBlocks,
  buildFilmPartsFromScript,
  plainTextToTaggedScript,
  generateAgentPrompt,
  generateDirectorTaskDocument,
  screenplayFromFilmShots,
} from '../backend/scriptIntake.ts'
import { narrationLines } from '../backend/storyScript.ts'
import { checkVoiceoverIntake } from '../backend/voiceoverIntake.ts'
import { bodyLimitFor, declaredBodyTooLarge, isSafeId, readJsonBody, SAFE_ID } from '../backend/studioRequest.ts'
import { readNarrationLog, readScriptText, syncNarrationLog } from '../backend/narrationLog.ts'
import { recordedStatus, synthesizeLines, resampleLinear, voiceLinesDir, pacedVoiceKey, unpacedVoiceKey, type SpokenLine } from '../backend/voiceLines.ts'
import { NARRATION_RATE } from '../backend/pacingProfile.ts'
import { DEFAULT_KOKORO_SPEED } from '../backend/tts.ts'
import {
  assembleSegments,
  decodeWav,
  deriveShotDurations,
  encodeWav,
  narrationWordTimings,
  normalizePeak,
  timeStretch,
  DEFAULT_ASSEMBLE_OPTIONS,
} from '../backend/pcm.ts'
import {
  dispatchTask,
  paneDelivery,
  traceBus,
} from '../backend/agentBridge/index.ts'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true })
import { createEngine } from '../backend/engine/index.ts'
import type { VideoJobSpec } from '../backend/engine/types.ts'

const captionCheckRequest = z.object({ film: filmSchema, previewFilm: filmSchema, format: z.enum(['long', 'reel']), shotId: z.string(), frame: z.number().finite().min(0) }).strict();

const filmsDir = path.resolve(__dirname, '../src/dl/films');
// The owner's personal, gitignored videos (AIDEOS_VIDEOS_DIR moves it); examples/ is the read-only fallback.
const videosDir = getVideosDir();
// Media sources in a film are relative to public/ (what staticFile() resolves against).
const PUBLIC_DIR = path.resolve(__dirname, '../public')
// Studio exports run as cancellable jobs; a render still going when the dev server exits is killed with it.
const exportJobs = createExportJobs();
// Studio Kokoro runs in its own worker process (backend/kokoroWorker.mjs), shared by every voiceover request.
const studioKokoro = kokoroWorkerSynthesizer();
process.on('exit', () => exportJobs.killAll());
// The render runs in its own process group, so Ctrl+C on the dev server never reaches it: stop it here.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    exportJobs.killAll();
    process.kill(process.pid, signal);
  });
}

// The voice the studio narrates with when a request does not name one (owner's cloned voice).
const DEFAULT_VOICE_KEY = VCD_DEFAULT_VOICE_KEY;

// Maps a stored narration backend or voiceLines voiceKey back to a Studio voice selector id.
function mapStoredVoiceToStudioId(raw: string): string | null {
  const key = unpacedVoiceKey(raw.trim());
  if (!key) return null;
  if (key === VCD_DEFAULT_VOICE_KEY || key === VCD_HINDI_VOICE_KEY) return key;
  if (key.startsWith('vcd:')) return key.endsWith(':hi') ? VCD_HINDI_VOICE_KEY : VCD_DEFAULT_VOICE_KEY;
  const head = key.split('|')[0];
  if (head.startsWith('kokoro-') || head.startsWith('aura-') || head.startsWith('macos-')) return head;
  if (head.startsWith('kokoro:')) return `kokoro-${head.slice('kokoro:'.length)}`;
  if (head.startsWith('say:')) return `macos-${head.slice('say:'.length).toLowerCase()}`;
  return null;
}

// Detects the voice an existing project previously chose, or null for a new project without prior narration.
function detectProjectVoice(pkgDir: string, film: Film | null): string | null {
  if (film?.voiceover?.voice && film.voiceover.voice.trim()) {
    return film.voiceover.voice.trim();
  }
  const narrationPath = path.join(pkgDir, 'narration.json');
  if (fs.existsSync(narrationPath)) {
    try {
      const narration = JSON.parse(fs.readFileSync(narrationPath, 'utf8')) as { ttsBackend?: string; voice?: string | null };
      if (typeof narration.ttsBackend === 'string') {
        const mapped = mapStoredVoiceToStudioId(narration.ttsBackend);
        if (mapped) return mapped;
      }
    } catch {
      // Ignore corrupt narration metadata and fall through.
    }
  }
  const linesDir = voiceLinesDir(pkgDir);
  if (fs.existsSync(linesDir)) {
    try {
      const files = fs
        .readdirSync(linesDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ file: path.join(linesDir, f), mtime: fs.statSync(path.join(linesDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const entry of files) {
        try {
          const meta = JSON.parse(fs.readFileSync(entry.file, 'utf8')) as { voiceKey?: string };
          if (typeof meta.voiceKey === 'string') {
            const mapped = mapStoredVoiceToStudioId(meta.voiceKey);
            if (mapped) return mapped;
          }
        } catch {
          // Skip unreadable line entries.
        }
      }
    } catch {
      // Ignore unreadable directory.
    }
  }
  return null;
}
const examplesDir = getExamplesDir();

// The schema's own id rule. It also happens to make traversal unrepresentable:
// a film can only ever be written as `<id>.ts` inside src/dl/films.
const FILM_ID = SAFE_ID;

// Revisions this server wrote, so the external-file watcher cannot replay a studio save (or one undone since) as an outside edit.
const studioFilmWrites = new Map<string, string>();

// Writes a film through the one film store (backend/pipeline/filmStore.ts) and returns the film as written with its revision.
// The owner's save also persists the studio soundtrack authoring data before either file lands.
function writeFilm(filmId: string, incoming: Film, options: Omit<WriteFilmOptions, 'beforeWrite'> = { owner: false }): { film: Film; rev: string } {
  const film = writeStoredFilm(filmId, incoming, { ...options, beforeWrite: options.owner ? persistStudioSoundtrack : undefined });
  const rev = revisionOfFilm(film);
  studioFilmWrites.set(filmId, rev);
  return { film, rev };
}

// Wires a finished B-roll clip into its shot by the shared footage rule (src/dl/footageWiring.ts), captioned the way the Look lens captions it, and persists the film.
function wireStudioFootage(filmId: string, shotId: string, relPath: string, promptText: string): void {
  const film = readFilm(filmId);
  if (!film) throw new Error(`no film found for "${filmId}"`);
  const shot = film.shots.find((s) => s.id === shotId);
  writeFilm(filmId, withFootage(film, shotId, relPath, shot?.visualDirection || promptText || 'GPU B-Roll'));
  console.log(`[broll] Successfully wired ${relPath} into shot ${shotId} of ${filmId}`);
}

// Sends a film-store read failure: a corrupt film.json gets its own code so the studio can say what to repair.
function sendFilmReadError(res: ServerResponse, error: unknown): void {
  if (error instanceof CorruptFilmError) {
    sendJson(res, 500, { error: error.message, code: 'corrupt_film' });
    return;
  }
  sendJson(res, 500, { error: `Could not read the film: ${error instanceof Error ? error.message : String(error)}` });
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

// Writes script.md and records any narration change in the project's visible change list. Narration that
// changed on disk since the last look (an agent edited the file) is attributed to the agent first, then the
// studio's own write is attributed to the user.
const writeScriptWithLog = (pkgDir: string, text: string) => {
  fs.mkdirSync(pkgDir, { recursive: true });
  syncNarrationLog(pkgDir, 'agent');
  fs.writeFileSync(path.join(pkgDir, 'script.md'), text, 'utf8');
  syncNarrationLog(pkgDir, 'user');
};

// Reads the studio owner key a browser sends with every request once it has paired an agent.
const ownerOf = (req: IncomingMessage): string | undefined => {
  const v = req.headers['x-aideos-owner'];
  return typeof v === 'string' && v.length >= 32 ? v : undefined;
};

// Reads a connector's bearer token.
const bearerOf = (req: IncomingMessage): string | undefined => {
  const m = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''));
  return m ? m[1] : undefined;
};

// The URL a connector should dial: the configured public API URL, else the one this request reached.
const publicApiUrl = (req: IncomingMessage): string => {
  if (process.env.AIDEOS_PUBLIC_API_URL) return process.env.AIDEOS_PUBLIC_API_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:3001').split(',')[0];
  return `${proto}://${host}`;
};

/** Reads the request's JSON body, refusing more than the route's byte cap (see backend/studioRequest.ts). */
const readBody = (req: IncomingMessage) => readJsonBody(req, bodyLimitFor(req.url));

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

  const allowedOrigin = applyStudioCorsHeaders(req, res, {
    methods: 'GET, HEAD, OPTIONS',
    headers: 'Range, Accept-Ranges, Content-Type',
    exposeHeaders: 'Content-Range, Accept-Ranges, Content-Length',
  });
  res.setHeader('Cross-Origin-Resource-Policy', resolveResourcePolicy(req, allowedOrigin));

  if (req.method === 'OPTIONS') {
    if (req.headers.origin && !allowedOrigin) {
      sendJson(res, 403, { error: 'Origin is not allowed by Aideos Studio.', code: 'origin_not_allowed' });
      return;
    }
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
            wireStudioFootage(filmId, shotId, relPath, promptText);
            traceBus.recordStep({
              phase: "broll",
              source: "broll",
              filmId,
              title: `GPU B-Roll: Shot ${shotId}`,
              description: `Rendered and auto-wired GPU footage into shot [${shotId}]`,
              status: "done",
              details: [`Footage: ${relPath}`, `Prompt: ${(promptText || "GPU B-Roll").slice(0, 100)}`],
            });
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

let filmWatcher: fs.FSWatcher | null = null;
const debounceTimers = new Map<string, NodeJS.Timeout>();

// Watches the videos directory for external modifications to film.json and broadcasts updates
function startFilmWatcher(): void {
  if (filmWatcher) return;
  if (!fs.existsSync(videosDir)) {
    try {
      fs.mkdirSync(videosDir, { recursive: true });
    } catch (_) {
      return;
    }
  }

  try {
    filmWatcher = fs.watch(videosDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('film.json')) return;
      const parts = filename.split(/[/\\]/);
      const slug = parts.length > 1 ? parts[0] : null;
      if (!slug || !FILM_ID.test(slug)) return;

      const existingTimer = debounceTimers.get(slug);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        debounceTimers.delete(slug);
        const filmPath = path.join(videosDir, slug, 'film.json');
        if (!fs.existsSync(filmPath)) return;
        try {
          const raw = fs.readFileSync(filmPath, 'utf8');
          const rev = filmRevision(raw);
          if (studioFilmWrites.get(slug) === rev) return;
          const parsedJson = JSON.parse(raw);
          const parsed = filmSchema.safeParse(parsedJson);
          if (parsed.success) {
            traceBus.notifyFilmUpdated(slug, parsed.data, rev);
          }
        } catch (_) {}
      }, 100);

      if (typeof timer.unref === 'function') timer.unref();
      debounceTimers.set(slug, timer);
    });

    if (filmWatcher && typeof filmWatcher.unref === 'function') {
      filmWatcher.unref();
    }
  } catch (err) {
    console.warn('[filmWatcher] Could not attach watcher on videos directory:', err);
  }
}

// Vite plugin to provide simple read/write API for films and video rendering
function filmApiPlugin(): Plugin {
  return {
    name: 'film-api',
    configureServer(server) {
      setupApiMiddlewares(server);
    },
    configurePreviewServer(server) {
      setupApiMiddlewares(server);
    },
  };
}

// Answers a refused agent token with why it ended (replaced, disconnected, tab closed, or unknown).
function sendEnded(res: ServerResponse, link: { replacementNote(t?: string): any; endReason(t?: string): string }, token: string | undefined): void {
  const replacedBy = link.replacementNote(token);
  const reason = replacedBy ? 'replaced' : link.endReason(token);
  const error =
    reason === 'replaced' && replacedBy
      ? `this connection was replaced by ${replacedBy.agentLabel} (${replacedBy.machine}); that agent now gets the work`
      : reason === 'disconnected'
        ? 'you disconnected this agent in the studio'
        : reason === 'tab-closed'
          ? 'the studio tab was closed, so the link ended; open the studio and connect again'
          : 'this connection is not recognised by the studio; connect again from the Agent button in the studio';
  sendJson(res, 401, { error, reason, ...(replacedBy ? { replacedBy } : {}) });
}

// Summarises an MCP tools/call request as one activity line (tool name and the file it touches), or null.
function describeToolCall(body: unknown): string | null {
  const b = body as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } } | null;
  if (b?.method !== 'tools/call' || !b.params?.name || b.params.name === 'aideos_wait_for_task') return null;
  const args = b.params.arguments ?? {};
  const target = [args.path, args.filmId, args.film, args.title].find((v) => typeof v === 'string');
  return `${b.params.name.replace(/^aideos_/, '')}${target ? ` ${String(target).slice(0, 120)}` : ''}`;
}

// Serves the agent link: pairing, the connector's task poll and results, status, and the remote MCP tools.
async function handleAgentLink(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
  const { agentLink, LINK_AGENTS } = await import('../backend/agentLink/store.ts');
  const link = agentLink();

  if (url === '/api/agent-link/connect.mjs' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.resolve(__dirname, '../scripts/aideos-connect.mjs'), 'utf8'));
    return;
  }
  if (url === '/api/agent-link/pair' && req.method === 'POST') {
    const body = (await readBody(req).catch(() => ({}))) as { agent?: string; mode?: string };
    const agent = (LINK_AGENTS.includes(body?.agent as never) ? body.agent : 'claude') as (typeof LINK_AGENTS)[number];
    const apiUrl = publicApiUrl(req);
    if (body?.mode === 'agent') {
      const { buildAgentInstructions } = await import('../backend/agentLink/connectInstructions.ts');
      const linked = link.startAgentPairing(ownerOf(req), agent);
      return sendJson(res, 200, { ownerKey: linked.ownerKey, apiUrl, mode: 'agent', ...buildAgentInstructions(agent, apiUrl, linked.token) });
    }
    const pairing = link.startPairing(ownerOf(req));
    return sendJson(res, 200, {
      ownerKey: pairing.ownerKey,
      code: pairing.code,
      expiresAt: pairing.expiresAt,
      mode: 'connector',
      apiUrl,
      command: `curl -fsSL ${apiUrl}/api/agent-link/connect.mjs -o aideos-connect.mjs && node aideos-connect.mjs ${pairing.pairingToken} --agent ${agent} --url ${apiUrl}`,
    });
  }
  if (url === '/api/agent-link/claim' && req.method === 'POST') {
    const body = (await readBody(req)) as { code?: string; agent?: string; machine?: string };
    if (!LINK_AGENTS.includes(body?.agent as never)) return sendJson(res, 400, { error: `agent must be one of ${LINK_AGENTS.join(', ')}` });
    const claimed = link.claim(String(body.code ?? ''), body.agent as (typeof LINK_AGENTS)[number], String(body.machine ?? ''));
    if (!claimed) return sendJson(res, 404, { error: 'that pairing code is wrong or has expired; make a new one with the Agent button in the studio' });
    return sendJson(res, 200, claimed);
  }
  if (url === '/api/agent-link/next' && req.method === 'GET') {
    const task = await link.next(bearerOf(req));
    if (task === 'unauthorized') return sendEnded(res, link, bearerOf(req));
    if (!task) {
      res.statusCode = 204;
      res.end();
      return;
    }
    return sendJson(res, 200, task);
  }
  if (url === '/api/agent-link/result' && req.method === 'POST') {
    const body = (await readBody(req)) as { taskId?: string; ok?: boolean; summary?: string };
    const ok = link.report(bearerOf(req), { taskId: String(body?.taskId ?? ''), ok: body?.ok === true, summary: String(body?.summary ?? '') });
    return sendJson(res, ok ? 200 : 401, { ok });
  }
  if (url === '/api/agent-link/activity' && req.method === 'GET') {
    const since = Number(new URL(req.url ?? '', 'http://x').searchParams.get('since') ?? 0) || 0;
    const lines = link.activity(bearerOf(req), since);
    if (!lines) return sendEnded(res, link, bearerOf(req));
    return sendJson(res, 200, { activity: lines });
  }
  if (url === '/api/agent-link/status' && req.method === 'GET') {
    // The browser polling this is its heartbeat: the link ends when the tab stops asking.
    return sendJson(res, 200, link.status(ownerOf(req)));
  }
  if (url === '/api/agent-link' && req.method === 'DELETE') {
    return sendJson(res, 200, { ok: link.disconnect(ownerOf(req)) });
  }
  if (url === '/api/mcp') {
    // Only a paired agent may use the tools. Stateless: one server and transport per request.
    const token = bearerOf(req);
    const auth = link.authenticate(token);
    if (!('conn' in auth)) return sendEnded(res, link, token);
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'the aideos MCP endpoint is stateless; use POST' });
    const [{ createMcpServer }, { StreamableHTTPServerTransport }] = await Promise.all([
      import('../backend/mcp/server.ts'),
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
    ]);
    const body = await readBody(req);
    const call = describeToolCall(body);
    if (call) link.recordActivity(token, call);
    const server = createMcpServer({
      remote: true,
      link: {
        waitForTask: async (holdMs) => {
          const task = await link.next(token, holdMs);
          return task === 'unauthorized' ? 'ended' : task;
        },
        complete: (taskId, summary, ok) => void link.report(token, { taskId, ok, summary: summary ?? '' }),
      },
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }
  sendJson(res, 404, { error: `${req.method} ${url} is not an agent link route` });
}

// Registers all API routes, static video package streaming, audio retiming, and CORS middlewares.
function setupApiMiddlewares(server: { middlewares: any }): void {
  startFilmWatcher();
  server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? '').split('?')[0];

    // Apply strict allowlist-only CORS (never wildcard '*') and reject foreign preflight origins.
    const allowedOrigin = applyStudioCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      if (req.headers.origin && !allowedOrigin) {
        sendJson(res, 403, { error: 'Origin is not allowed by Aideos Studio.', code: 'origin_not_allowed' });
        return;
      }
      res.statusCode = 204;
      res.end();
      return;
    }

    // Fail-closed guard: refuse writes, exports, voice synthesis, and foreign browser mutations before routing.
    const guard = guardStudioApiRequest(req, url);
    if (!guard.allow) {
      sendJson(res, guard.status, { error: guard.error, code: guard.code });
      return;
    }

    // Refuse a body that announces more than its route accepts before reading a byte of it.
    if (declaredBodyTooLarge(req.headers, req.url)) {
      res.setHeader('Connection', 'close');
      sendJson(res, 413, { error: `Request body is larger than the ${Math.round(bodyLimitFor(req.url) / (1024 * 1024))} MB this route accepts`, code: 'body_too_large' });
      return;
    }

    if (url === '/api/release-channel' && (req.method === 'GET' || req.method === 'HEAD')) {
      sendJson(res, 200, releaseChannel(path.resolve(__dirname, '..')));
      return;
    }

    // Measures the draft card against the same compiled art geometry as the design gate.
    if (url === '/api/caption-placement/check' && req.method === 'POST') {
      void readBody(req).then((body) => {
        const parsed = captionCheckRequest.safeParse(body);
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Expected a valid film, format, shotId and frame' });
          return;
        }
        const { film: requestedFilm, previewFilm, format, shotId, frame } = parsed.data;
        // This local studio route trusts the server's active-film pointer, never a request's package body.
        const activeFilmFile = path.resolve(__dirname, '../src/dl/activeFilm.ts');
        const activeFilmSource = fs.existsSync(activeFilmFile) ? fs.readFileSync(activeFilmFile, 'utf8') : '';
        const activeFilmId = /from\s+["']\.\/films\/([a-z0-9-]+)["']/.exec(activeFilmSource)?.[1];
        const activeFilm = activeFilmId ? readFilm(activeFilmId) : null;
        if (!activeFilm) {
          sendJson(res, 409, { error: 'The studio has no active film to check.' });
          return;
        }
        if (previewFilm.id !== activeFilm.id) {
          sendJson(res, 409, { error: 'Caption placement preview must match the studio active film.' });
          return;
        }
        let film: Film;
        try {
          film = applyCaptionPlacementDraft(requestedFilm, activeFilm);
        } catch (error) {
          sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        void checkCaptionPlacementDraftAsync(film, film.scene, { format, shotId, frame: Math.round(frame) }, previewFilm)
          .then((findings) => sendJson(res, 200, { findings }))
          .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
      }).catch((error) => sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }));
      return;
    }

    // Handle /api/health (Service health check for Render and cloud hosting deployments)
    if (url === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      sendJson(res, 200, {
        status: 'ok',
        service: 'aideos-backend',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Returns the current reel cut, backend checks and a preview film only when its build is current.
    const reelStudioMatch = /^\/api\/reel\/([a-z0-9-]+)$/.exec(url);
    if (reelStudioMatch && (req.method === 'GET' || req.method === 'POST')) {
      const slug = reelStudioMatch[1];
      // Packages in examples/ are served for exploration and must never receive owner rebuild writes.
      const respond = () => {
        const film = readFilm(slug);
        if (!film) {
          sendJson(res, 404, { error: `No film found for ${slug}.` });
          return;
        }
        const pkg = reelPackageDir(slug);
        const writable = path.resolve(pkg).startsWith(`${path.resolve(videosDir)}${path.sep}`);
        const statusPath = path.join(pkg, 'reel/status.json');
        const reelFilmPath = path.join(pkg, 'reel/film.json');
        let status: any = null;
        let cut: unknown = null;
        try { status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : null; } catch { status = null; }
        try { cut = readReelCut(slug); } catch { cut = null; }
        const identity = deliveryTimeline(film, 'reel').totalFrames / film.fps <= DELIVERY_CONFIG.reel.maxSec && !film.soundtrack?.defaultScore;
        const current = status?.state === 'passed' && status.fingerprint === reelSourceFingerprint(slug);
        const previewFilm = identity ? film : current && fs.existsSync(reelFilmPath)
          ? filmSchema.parse(JSON.parse(fs.readFileSync(reelFilmPath, 'utf8'))) : null;
        let report = null;
        if (!identity) {
          try { report = checkReelCut(cut, loadReelContext(slug), reelBudgetFor(film)); } catch { report = null; }
        }
        const durationSec = previewFilm
          ? deliveryTimeline(previewFilm, 'reel').totalFrames / previewFilm.fps
          : report?.estimate?.totalSec ?? null;
        sendJson(res, 200, {
          filmId: slug,
          maxSec: REEL_MAX_SEC,
          writable,
          identity,
          cut: reelCutSchema.safeParse(cut).success ? reelCutSchema.parse(cut) : null,
          report,
          status,
          current: Boolean(previewFilm),
          durationSec,
          previewFilm,
          sourceShots: film.shots.map((shot) => ({ id: shot.id, narration: shot.scriptText ?? '' })),
        });
      };
      if (req.method === 'GET') {
        try { respond(); } catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      } else {
        const pkg = reelPackageDir(slug);
        if (!path.resolve(pkg).startsWith(`${path.resolve(videosDir)}${path.sep}`)) {
          sendJson(res, 403, { error: 'Example films are read-only. Open a film in your videos folder to rebuild its reel.' });
          return;
        }
        void deliverReel(slug, { mode: 'inline' }).then((outcome) => {
          if (outcome.status === 'needs_reel_cut') {
            sendJson(res, 422, { error: `${outcome.note}\n${outcome.nextSteps.join('\n')}` });
            return;
          }
          respond();
        }).catch((error) => sendJson(res, 422, { error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    // Handle /api/agent-link/* (pairing the owner's own coding agent through `aideos connect`) and
    // /api/mcp (the aideos tools that agent works through). See backend/agentLink/store.ts.
    if (url.startsWith('/api/agent-link') || url === '/api/mcp') {
      void handleAgentLink(req, res, url).catch((err) => {
        if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      });
      return;
    }

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
          const exampleFile = path.join(examplesDir, rel);
          if (!rel.includes('..') && fs.existsSync(exampleFile) && fs.statSync(exampleFile).isFile()) {
            serveFileWithRange(req, res, exampleFile);
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

        // Export jobs: nothing renders until the studio posts the Start click here. Progress is the
        // renderer's own frame counts, cancel kills the render and deletes the partial video, and a
        // finished job only reports a download URL (the studio waits for the user to click Download).
        if (url === '/api/export' && req.method === 'POST') {
          void readBody(req)
            .then((body) => {
              const { film: postedFilm, format } = (body as { film: Film; format?: string }) || {};
              if (!postedFilm || !postedFilm.id || !FILM_ID.test(postedFilm.id)) {
                sendJson(res, 400, { error: 'Valid film with a valid film.id is required' });
                return;
              }
              const outFormat = format === 'reel' ? 'reel' : 'long';
              const filename = `aideos_${postedFilm.id}_${outFormat}_${Date.now()}.mp4`;
              const rendersDir = path.join(videosDir, postedFilm.id, 'renders');
              const outPath = path.join(rendersDir, filename);
              let renderedFilm: Film = postedFilm;
              let endCardNotice: string | undefined;

              const { job, busy } = exportJobs.start({
                film: postedFilm,
                filmId: postedFilm.id,
                format: outFormat,
                filmTitle: postedFilm.title,
                fps: postedFilm.fps || 30,
                durationInFrames: deliveryTimeline(postedFilm, outFormat).totalFrames,
                filename,
                outPath,
                downloadUrl: `/api/downloads/${filename}`,
                prepare: async (snapshot) => {
                  renderedFilm = snapshot;
                  // The end card speaks in the film's own voice: attach its line (synthesizing it when the
                  // narration voice is known) before rendering. A failure leaves the card silent.
                  try {
                    const endCard = await ensureEndCardVoice(snapshot.id, { film: snapshot });
                    renderedFilm = endCard.film;
                    endCardNotice = endCard.notice;
                  } catch (err) {
                    endCardNotice = `end card line could not be attached (${err instanceof Error ? err.message : String(err)}); the card stays silent`;
                  }
                  return renderedFilm;
                },
                onMaster: (master) => {
                  writeDescriptionCredits(rendersDir, [renderedFilm]);
                  if (master.status === 'skipped') endCardNotice = [endCardNotice, `Master skipped: ${master.reason}`].filter(Boolean).join('; ');
                  return endCardNotice;
                },
                onDone: async () => {
                  const pruned = await pruneStudioExports({
                    rendersDir,
                    filmId: postedFilm.id,
                    format: outFormat,
                    keepFilenames: [filename],
                    acceptancePath: path.join(videosDir, postedFilm.id, 'acceptance.json'),
                  });
                  if (pruned.skippedReason) console.warn(`[export] retention skipped: ${pruned.skippedReason}`);
                },
              });
              sendJson(res, busy ? 409 : 202, busy ? { error: 'Another export is already running.', job } : { job });
            })
            .catch((err) => {
              sendJson(res, 500, { error: String(err) });
            });
          return;
        }

        // The Check lens view (state, six hard gates, score against the bar) of the posted film: whether it is the film that was reviewed.
        const acceptanceMatch = /^\/api\/acceptance\/([a-z0-9-]+)$/.exec(url.split('?')[0]);
        if (acceptanceMatch && req.method === 'POST') {
          const id = acceptanceMatch[1];
          if (!FILM_ID.test(id)) {
            sendJson(res, 400, { error: 'Valid film id is required' });
            return;
          }
          const format = new URL(req.url ?? '', 'http://localhost').searchParams.get('format') === 'reel' ? 'reel' : 'long';
          void readBody(req).then(async (body) => {
            const postedFilm = (body as { film?: Film } | null)?.film;
            if (!postedFilm || postedFilm.id !== id) {
              sendJson(res, 400, { error: 'Film payload must match the requested id' });
              return;
            }
            const exportFilm = postedFilm;
            if (format === 'reel') {
              const reelInputs = formatInputs(id, 'reel');
              if (path.resolve(reelInputs.film) !== path.resolve(path.join(videosDir, id, 'film.json'))) {
                sendJson(res, 200, { check: acceptanceCheck(path.join(videosDir, id), format, hashFileOrNull(reelInputs.film)) });
                return;
              }
            }
            sendJson(res, 200, { check: acceptanceCheckForFilm(path.join(videosDir, id), format, exportFilm) });
          }).catch((err) => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // The export still in flight, so a reloaded page can pick the Check lens and header chip back up.
        if (url === '/api/export/current' && req.method === 'GET') {
          sendJson(res, 200, { job: exportJobs.current() ?? null });
          return;
        }

        // One export job's live state, or a cancel that kills the render and deletes the partial video.
        const exportJobMatch = /^\/api\/export\/([a-z0-9-]+)(\/cancel)?$/.exec(url);
        if (exportJobMatch) {
          const [, jobId, cancel] = exportJobMatch;
          if (cancel && req.method === 'POST') {
            void exportJobs.cancel(jobId).then((job) => {
              if (!job) sendJson(res, 404, { error: 'Unknown export' });
              else sendJson(res, 200, { job });
            });
            return;
          }
          if (!cancel && req.method === 'GET') {
            const job = exportJobs.get(jobId);
            if (!job) sendJson(res, 404, { error: 'Unknown export' });
            else sendJson(res, 200, { job });
            return;
          }
        }

        // Handle /api/downloads/:filename (Serve rendered video exports from package renders/ with fallback to out/)
        if (url.startsWith('/api/downloads/') && (req.method === 'GET' || req.method === 'HEAD')) {
          const filename = decodeURIComponent(url.slice('/api/downloads/'.length));
          if (!filename || filename.includes('..')) {
            sendJson(res, 400, { error: 'Invalid filename' });
            return;
          }

          let filePath: string | null = null;

          const m = /^aideos_([a-z0-9-]+)_/.exec(filename);
          if (m) {
            const candidate = path.join(videosDir, m[1], 'renders', filename);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              filePath = candidate;
            }
          }

          if (!filePath && fs.existsSync(videosDir)) {
            for (const pkg of fs.readdirSync(videosDir)) {
              const candidate = path.join(videosDir, pkg, 'renders', filename);
              if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                filePath = candidate;
                break;
              }
            }
          }

          if (!filePath && fs.existsSync(examplesDir)) {
            for (const pkg of fs.readdirSync(examplesDir)) {
              const candidate = path.join(examplesDir, pkg, 'renders', filename);
              if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                filePath = candidate;
                break;
              }
            }
          }

          const oldOut = path.resolve(__dirname, '../out', filename);
          if (!filePath && fs.existsSync(oldOut) && fs.statSync(oldOut).isFile()) {
            filePath = oldOut;
          }

          if (filePath) {
            serveFileWithRange(req, res, filePath);
            return;
          }
          sendJson(res, 404, { error: 'File not found' });
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
              if (!isSafeId(filmId) || (shotId !== undefined && !isSafeId(shotId))) {
                sendJson(res, 400, { error: 'filmId and shotId must be lowercase letters, digits and dashes' });
                return;
              }

              // Load film definition (prefer clientFilm if provided)
              const filmObj: Film | null = clientFilm || readFilm(filmId);

              if (!filmObj) {
                sendJson(res, 404, { error: `Film ${filmId} not found` });
                return;
              }
              // Every shot id becomes a footage file name below, including those of a film the client posted.
              if (filmObj.shots.some((s) => !isSafeId(s.id))) {
                sendJson(res, 400, { error: 'every shot id must be lowercase letters, digits and dashes' });
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
          if (!isSafeId(filmId)) {
            sendJson(res, 400, { error: 'filmId query parameter is required and must be lowercase letters, digits and dashes' });
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

        // Handle /api/narration/:id (the narration change list, and which lines already have a recording)
        if (url.startsWith('/api/narration/') && req.method === 'GET') {
          void (async () => {
            const parsedUrl = new URL(req.url ?? '', 'http://localhost');
            const narrationId = parsedUrl.pathname.slice('/api/narration/'.length);
            if (!narrationId || !FILM_ID.test(narrationId)) {
              sendJson(res, 400, { error: `Invalid project ID: "${narrationId}"` });
              return;
            }
            const pkgDir = path.join(videosDir, narrationId);
            if (!fs.existsSync(pkgDir)) {
              sendJson(res, 404, { error: `Project "${narrationId}" not found` });
              return;
            }
            // Anything that changed script.md since the last look was not made by this studio: it is the agent's.
            syncNarrationLog(pkgDir, 'agent');
            const text = readScriptText(pkgDir);
            const lines = narrationLines(text);
            const projectVoice = detectProjectVoice(pkgDir, readFilm(narrationId));
            const requestedVoice = parsedUrl.searchParams.get('voice') || projectVoice || DEFAULT_VOICE_KEY;
            let cacheVoiceKey = requestedVoiceKey(requestedVoice);
            let voiceService: Awaited<ReturnType<typeof probeVcdService>> | null = null;
            if (isVcdStudioVoice(requestedVoice)) {
              const settings = resolveVoiceCloneSettings();
              voiceService = await probeVcdService({ url: settings.url, voiceId: settings.voiceId });
              if (voiceService.voiceId) {
                cacheVoiceKey = vcdVoiceCacheKey(
                  voiceService.voiceId,
                  vcdStudioVoiceLanguage(requestedVoice, settings.language),
                );
              }
            }
            const recorded = recordedStatus(pkgDir, lines, pacedVoiceKey(cacheVoiceKey, NARRATION_RATE));
            sendJson(res, 200, {
              ok: true,
              revision: createHash('sha1').update(text).digest('hex').slice(0, 12),
              entries: (readNarrationLog(pkgDir)?.entries ?? []).slice(-100).reverse(),
              lines: lines.map((line, index) => ({ text: line, recorded: recorded[index] })),
              projectVoice,
              voiceService,
            });
          })().catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }));
          return;
        }

        // Handle /api/scripts/:id (Read and Save scripts, self-contained under videos/<id>/)
        if (url.startsWith('/api/scripts/')) {
          const scriptId = url.slice('/api/scripts/'.length);
          if (!scriptId || !FILM_ID.test(scriptId)) {
            sendJson(res, 400, { error: `Invalid script ID: "${scriptId}"` });
            return;
          }
          const pkgDir = path.join(videosDir, scriptId);

          if (req.method === 'GET') {
            const scriptFile = path.join(pkgDir, 'script.md');
            let foundScript = '';
            if (fs.existsSync(scriptFile)) {
              foundScript = fs.readFileSync(scriptFile, 'utf8');
            } else if (fs.existsSync(path.join(filmsDir, `${scriptId}.ts`)) || fs.existsSync(path.join(pkgDir, 'film.json'))) {
              // script.md is a gitignored build artefact, so a fresh clone or a hosted deploy has none:
              // rebuild the screenplay from the film's own narration before offering a blank draft.
              try {
                const film = JSON.parse(fs.readFileSync(path.join(pkgDir, 'film.json'), 'utf8'));
                foundScript = screenplayFromFilmShots(Array.isArray(film?.shots) ? film.shots : []);
              } catch {
                foundScript = '';
              }
            }
            sendJson(res, 200, { ok: true, script: foundScript });
            return;
          }

          if (req.method === 'POST') {
            void readBody(req).then((body: any) => {
              const { script } = body || {};
              // A plain-text story is converted here (no agent); a tagged script is stored exactly as sent.
              writeScriptWithLog(pkgDir, plainTextToTaggedScript(script || ''));
              sendJson(res, 200, { ok: true, file: `videos/${scriptId}/script.md` });
            }).catch(err => sendJson(res, 500, { error: String(err) }));
            return;
          }
        }

        // Handle /api/parse-script-scenes (Intelligently construct shots, visual directions & nodes from screenplay)
        if (url === '/api/parse-script-scenes' && req.method === 'POST') {
          void readBody(req).then(async (body: any) => {
            const { script, filmTitle = "Film", targetDurationSec, projectId = "kvcache" } = body || {};
            if (!projectId || !FILM_ID.test(projectId)) {
              sendJson(res, 400, { error: `Invalid project ID: "${projectId}"` });
              return;
            }
            if (!script || !script.trim()) {
              sendJson(res, 400, { error: 'Script text is required' });
              return;
            }

            // A plain-text story is converted by Aideos itself (deterministic, no agent, no model call); a tagged
            // script comes back unchanged. The agent only ever fills the visual and on-screen slots afterwards.
            const scriptToBuild = plainTextToTaggedScript(script);
            const transformed = scriptToBuild !== script;

            const { shots, nodes, edges, spokenText, wordCount, durationSec } = buildFilmPartsFromScript(scriptToBuild, targetDurationSec);

            if (shots.length === 0) {
              sendJson(res, 422, {
                ok: false,
                error: 'No video scenes could be created from the provided script text.',
                shots: [],
                nodes: [],
                edges: [],
              });
              return;
            }

            const pkgDir = path.join(videosDir, projectId);
            if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });

            // Persist screenplay doc
            writeScriptWithLog(pkgDir, scriptToBuild);

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

            // Automatically prompt and dispatch to connected coding agent across channels
            const dispatch = await dispatchTask({
              ownerKey: ownerOf(req),
              eventType: "auto_build_scenes",
              filmId: projectId,
              filmTitle,
              scriptText: scriptToBuild,
              durationSec,
              shotCount: shots.length,
            });

            traceBus.recordStep({
              phase: "authoring",
              source: "pipeline",
              filmId: projectId,
              title: "Auto-Build: Scenes & Graph Built",
              description: `Constructed ${shots.length} shots and ${nodes.length} canvas nodes (${durationSec}s total duration)`,
              status: "done",
              details: [
                `Spoken Words: ${wordCount}`,
                `Shots: ${shots.length}`,
                `Canvas Nodes: ${nodes.length}`,
                `Story converted to tagged script: ${transformed ? "yes (deterministic, no agent)" : "no (already tagged)"}`,
              ],
            });

            sendJson(res, 200, {
              ok: true,
              shots,
              nodes,
              edges,
              spokenText,
              wordCount,
              durationSec,
              script: transformed ? scriptToBuild : undefined,
              transformed,
              agentPrompt,
              taskFile: `videos/${projectId}/director_task.md`,
              dispatch,
            });
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/prompt-agent (Directly auto-prompts active terminal agent)
        if (url === '/api/prompt-agent' && req.method === 'POST') {
          void readBody(req).then(async (body: any) => {
            const { filmId = "kvcache", filmTitle = "Film", event = "custom_directive", customInstruction, script } = body || {};
            const dispatch = await dispatchTask({
              ownerKey: ownerOf(req),
              eventType: event as any || "custom_directive",
              filmId,
              filmTitle,
              customInstruction,
              scriptText: script,
              // A second click (or a client retry) while this task is open reuses it instead of adding another.
              idempotent: true,
            });
            sendJson(res, 200, { ok: true, dispatch, prompt: dispatch.prompt });
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/prompt-agent/queue (where a prompt stands in the agent's terminal: queued, sending, sent or failed)
        if (url === '/api/prompt-agent/queue' && req.method === 'GET') {
          const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id');
          const entry = id ? paneDelivery.get(id) : undefined;
          if (!entry) {
            sendJson(res, 404, { error: 'Unknown prompt delivery' });
            return;
          }
          sendJson(res, 200, { ok: true, entry });
          return;
        }

        // Handle /api/agent/trace (SSE stream for live Agent Trace telemetry)
        if (url === '/api/agent/trace' && req.method === 'GET') {
          const parsedUrl = new URL(req.url ?? '', 'http://localhost');
          const filmId = parsedUrl.searchParams.get('filmId') || undefined;

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
          });

          // Handshake connected event
          res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);

          // Send recent steps history so the subscriber has recent context immediately
          const history = traceBus.getRecentSteps({ filmId });
          for (const step of history) {
            res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
          }

          // Subscribe to live steps on the trace bus
          const unsubscribe = traceBus.subscribe((step) => {
            if (!filmId || !step.filmId || step.filmId === filmId) {
              try {
                res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
              } catch {
                // Connection may have dropped
              }
            }
          });

          // Subscribe to live film updates on the trace bus
          const unsubscribeFilm = traceBus.onFilmUpdate((update) => {
            if (!filmId || update.filmId === filmId) {
              try {
                res.write(`event: film_updated\ndata: ${JSON.stringify(update)}\n\n`);
              } catch {
                // Connection may have dropped
              }
            }
          });

          // Keep connection alive with periodic heartbeat
          const heartbeat = setInterval(() => {
            try {
              res.write(': heartbeat\n\n');
            } catch {
              // Heartbeat write failure
            }
          }, 15000);

          req.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
            unsubscribeFilm();
          });
          return;
        }

        // Handle DELETE /api/agent/trace (Reset trace history)
        if (url === '/api/agent/trace' && req.method === 'DELETE') {
          traceBus.clear();
          sendJson(res, 200, { ok: true, message: 'Trace history cleared' });
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

            const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
            if (/^\.+$/.test(safeName)) {
              sendJson(res, 400, { error: 'filename must name a file' });
              return;
            }
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

        // Handle /api/edit-log (Provenance log for a film's AI edit history - Phase 4)
        if (url.startsWith('/api/edit-log') && req.method === 'GET') {
          const qs = new URL(req.url ?? '/', 'http://localhost').searchParams;
          const filmId = qs.get('filmId') || '';
          if (!filmId || !FILM_ID.test(filmId)) {
            sendJson(res, 400, { error: 'filmId query param is required and must be a valid film slug' });
            return;
          }
          const records = readEditProvenanceLog(videosDir, filmId);
          sendJson(res, 200, { filmId, count: records.length, records });
          return;
        }

        if (url.startsWith('/api/edit-log') && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const { filmId, request, plan, ops, attempts = 1, dryRun = false, source = 'studio', warnings = [] } = body || {};
            if (!filmId || !FILM_ID.test(filmId)) {
              sendJson(res, 400, { error: 'filmId is required and must be a valid film slug' });
              return;
            }
            appendEditProvenanceRecord(videosDir, filmId, {
              request: request || 'Applied AI edit',
              plan: plan || '',
              ops: Array.isArray(ops) ? ops : [],
              attempts: typeof attempts === 'number' ? attempts : 1,
              dryRun: Boolean(dryRun),
              source,
              warnings: Array.isArray(warnings) ? warnings : [],
            });
            sendJson(res, 200, { ok: true, filmId });
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
            if (film.id !== undefined && !isSafeId(film.id)) {
              sendJson(res, 400, { error: 'film.id must be lowercase letters, digits and dashes' });
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

              // Automatically prompt and dispatch to connected coding agent across channels
              const dispatch = await dispatchTask({
              ownerKey: ownerOf(req),
                eventType: "ai_edit",
                filmId,
                filmTitle: film.title || filmId,
                customInstruction: request,
                durationSec,
                shotCount: film.shots?.length || 0,
                metadata: { editRequest: request, dryRun },
              });

              traceBus.recordStep({
                phase: "ai_edit",
                source: "pipeline",
                filmId,
                title: `AI Edit Request: "${request.slice(0, 60)}"`,
                description: `Planning video edit program for ${film.title || filmId}`,
                status: "running",
                details: [
                  `Request: ${request}`,
                  `Clips: ${layered.clips.length}`,
                  `Duration: ${durationSec.toFixed(1)}s`,
                ],
              });

              const planResult = await planEdits(request, context, undefined, { agentHints });

              traceBus.recordStep({
                phase: "ai_edit",
                source: "pipeline",
                filmId,
                title: `AI Edit Planned: ${planResult.ops.length} op(s)`,
                description: planResult.plan.slice(0, 100),
                status: "done",
                details: planResult.ops.map((o: any) => `${o.op}`),
              });

              // If dryRun, return plan and ops for client preview/approval
              if (dryRun) {
                appendEditProvenanceRecord(videosDir, filmId, {
                  request,
                  plan: planResult.plan,
                  ops: planResult.ops,
                  attempts: planResult.attempts,
                  dryRun: true,
                  source: "studio",
                  warnings: planResult.warnings,
                });

                sendJson(res, 200, {
                  ok: true,
                  dryRun: true,
                  plan: planResult.plan,
                  ops: planResult.ops,
                  attempts: planResult.attempts,
                  warnings: planResult.warnings,
                  context,
                  dispatch,
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
                  dispatch,
                });
                return;
              }

              const updatedFilm = convertLayeredFilmToFilm(appliedResult.film, film);
              try {
                const onDisk = readFilm(updatedFilm.id);
                const knownSources = onDisk ? layeredMediaSources(convertFilmToLayeredFilm(onDisk)) : new Set<string>();
                assertLayeredAssetsExist(appliedResult.film, { baseDir: PUBLIC_DIR, knownSources });
              } catch (assetError) {
                sendJson(res, 422, {
                  ok: false,
                  error: assetError instanceof Error ? assetError.message : String(assetError),
                  code: 'missing_asset',
                  plan: planResult.plan,
                  ops: planResult.ops,
                  dispatch,
                });
                return;
              }
              writeFilm(updatedFilm.id, updatedFilm, {
                owner: false,
                agentEdit: planResult.ops.some((op: { op: string }) => op.op === 'set_caption_placement'),
              });

              appendEditProvenanceRecord(videosDir, filmId, {
                request,
                plan: planResult.plan,
                ops: planResult.ops,
                attempts: planResult.attempts,
                dryRun: false,
                source: "studio",
                warnings: planResult.warnings,
              });

              traceBus.recordStep({
                phase: "ai_edit",
                source: "pipeline",
                filmId,
                title: `AI Edit Applied: ${planResult.ops.length} op(s)`,
                description: `Successfully applied and saved edit program to ${updatedFilm.id}`,
                status: "done",
              });

              sendJson(res, 200, {
                ok: true,
                dryRun: false,
                plan: planResult.plan,
                ops: planResult.ops,
                attempts: planResult.attempts,
                warnings: planResult.warnings,
                film: updatedFilm,
                dispatch,
              });
            } catch (err: any) {
              console.error('[ai-edit] Error planning/applying edit:', err);
              sendJson(res, 500, { error: err?.message || 'Failed to process AI edit request' });
            }
          }).catch((err) => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/generate-voiceover (AI Voice Synthesis with My voice [vcd] / Kokoro / Deepgram / macOS TTS)
        if (url === '/api/generate-voiceover' && req.method === 'POST') {
          void readBody(req).then(async (body: any) => {
            const { script, voice = DEFAULT_VOICE_KEY, projectId = 'kvcache', spokenTextOverride, language: requestedLanguage } = body || {};
            if (!projectId || !FILM_ID.test(projectId)) {
              sendJson(res, 400, { error: `Invalid project ID: "${projectId}"` });
              return;
            }
            if ((!script || !script.trim()) && (!spokenTextOverride || !spokenTextOverride.trim())) {
              sendJson(res, 400, { error: 'Script text or spoken words are required to generate voiceover.' });
              return;
            }

            let intakeNotices: string[] = [];
            const intake = checkVoiceoverIntake(script || '');
            intakeNotices = intake.intakeNotices;
            if (!intake.ok) {
              sendJson(res, intake.status, { error: intake.error, intakeNotices });
              return;
            }

            // The narration lines to record: only the spoken lines of a tagged script, the paragraphs of a plain
            // story, or the spoken text override, one recording per line.
            const narrationLinesToSpeak: string[] = spokenTextOverride && typeof spokenTextOverride === 'string' && spokenTextOverride.trim()
              ? spokenTextOverride.split(/\n\s*\n+/).map((t: string) => t.trim()).filter(Boolean)
              : extractSpokenVoiceoverBlocks(script || '');
            const cleanText = narrationLinesToSpeak.join('\n\n');

            if (!cleanText || !cleanText.trim()) {
              sendJson(res, 400, { error: 'No narration found in the script. Write your story as paragraphs, or ask your agent to write it.' });
              return;
            }

            const pkgDir = path.join(videosDir, projectId);
            if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });

            const outFilename = 'voiceover.wav';
            const publicPath = path.join(pkgDir, outFilename);

            let generated = false;
            let synthesisError: VoiceSynthesisError | undefined;
            let vcdError: Error | undefined;

            let deepgramKey = process.env.DEEPGRAM_API_KEY || '';
            if (!deepgramKey) {
              const envPath = path.resolve(__dirname, '../.env');
              if (fs.existsSync(envPath)) {
                const match = fs.readFileSync(envPath, 'utf8').match(/DEEPGRAM_API_KEY\s*=\s*([a-zA-Z0-9_-]+)/);
                if (match) deepgramKey = match[1];
              }
            }

            let lineSummary = { total: narrationLinesToSpeak.length, recorded: 0, reused: 0 };
            const otherVoices: { voice: string; lines: number }[] = [];
            let resolvedVcdVoiceId: string | undefined;
            let resolvedVcdUrl: string | undefined;
            let resolvedVcdLanguage: VcdLanguagePreference | undefined;
            let cacheVoiceKey = requestedVoiceKey(voice);
            let assembledShotDurations: number[] | undefined;
            const isClonedVoice = isVcdStudioVoice(voice);

            try {
              if (isClonedVoice) {
                const settings = resolveVoiceCloneSettings();
                const resolved = await resolveVcdVoiceId({ url: settings.url, voiceId: settings.voiceId });
                resolvedVcdUrl = resolved.url;
                resolvedVcdVoiceId = resolved.voiceId;
                const resolvedLang: VcdLanguagePreference =
                  requestedLanguage === 'en' || requestedLanguage === 'hi' || requestedLanguage === 'auto'
                    ? requestedLanguage
                    : vcdStudioVoiceLanguage(voice, settings.language);
                resolvedVcdLanguage = resolvedLang;
                cacheVoiceKey = vcdVoiceCacheKey(resolved.voiceId, resolvedLang);
              }

              const synthDeps = {
                fetch,
                kokoro: studioKokoro,
                say: sayToWav,
                memoryLimitBytes: readContainerMemoryLimit,
                platform: process.platform,
              };
              // One recording per line, kept under videos/<id>/voiceover_lines/ by content fingerprint: a line whose
              // words and voice are unchanged is reused as is, so only edited or new lines are recorded again.
              // A line is stored under the voice that actually spoke it, so a fallback voice is never reused as the requested one.
              const recordLine = async (text: string): Promise<SpokenLine> => {
                const spoken = await synthesizeVoiceover(
                  {
                    text,
                    voice,
                    ...(resolvedVcdUrl ? { vcdUrl: resolvedVcdUrl } : {}),
                    ...(resolvedVcdVoiceId ? { vcdVoiceId: resolvedVcdVoiceId } : {}),
                    ...(resolvedVcdLanguage ? { language: resolvedVcdLanguage } : {}),
                    deepgramKey,
                    googleKey: process.env.GOOGLE_API_KEY || '',
                    chunk: chunkTextForTTS,
                    trimSilence,
                  },
                  synthDeps,
                );
                const wav = decodeWav(spoken.wav);
                // Studio voices have no speaking-rate setting here, so every line is re-paced to the house rate.
                return {
                  audio: { sampleRate: wav.sampleRate, chunks: [{ text, samples: timeStretch(wav.samples, NARRATION_RATE, wav.sampleRate) }] },
                  voiceKey: pacedVoiceKey(spoken.provider === 'vcd' ? cacheVoiceKey : spoken.voiceKey, NARRATION_RATE),
                };
              };
              const requestedLineKey = pacedVoiceKey(cacheVoiceKey, NARRATION_RATE);
              const lineResult = await synthesizeLines({ pkgDir, texts: narrationLinesToSpeak, voiceKey: requestedLineKey, synthesize: recordLine });
              lineSummary = { total: lineResult.lines.length, recorded: lineResult.recorded, reused: lineResult.reused };
              // Lines another voice spoke because the requested one failed, so the studio can say so.
              for (const line of lineResult.lines) {
                if (line.voiceKey === requestedLineKey) continue;
                const voiceName = unpacedVoiceKey(line.voiceKey);
                const entry = otherVoices.find((v) => v.voice === voiceName);
                if (entry) entry.lines += 1;
                else otherVoices.push({ voice: voiceName, lines: 1 });
              }

              const rate = lineResult.lines[0].audio.sampleRate;
              if (!isClonedVoice) {
                const gap = new Float32Array(Math.round((rate * DEFAULT_ASSEMBLE_OPTIONS.segmentGapMs) / 1000));
                const pieces: Float32Array[] = [];
                lineResult.lines.forEach((line, index) => {
                  if (index > 0) pieces.push(gap);
                  for (const chunk of line.audio.chunks) pieces.push(resampleLinear(chunk.samples, line.audio.sampleRate, rate));
                });
                const merged = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
                let at = 0;
                for (const piece of pieces) {
                  merged.set(piece, at);
                  at += piece.length;
                }
                fs.writeFileSync(publicPath, encodeWav(merged, rate));
              } else {
                const segmentChunks = lineResult.lines.map((line) =>
                  line.audio.chunks.map((chunk) => ({
                    text: chunk.text,
                    samples: resampleLinear(chunk.samples, line.audio.sampleRate, rate),
                  })),
                );
                const assembled = assembleSegments(segmentChunks, {
                  ...DEFAULT_ASSEMBLE_OPTIONS,
                  sampleRate: rate,
                });
                const normalized = normalizePeak(assembled.samples);
                fs.writeFileSync(publicPath, encodeWav(normalized, rate));

                // Write word timings, WebVTT captions, and narration metadata so the master clock,
                // captions, and end card stay in sync with Studio-recorded audio.
                const shotDurations = deriveShotDurations(assembled.segments, assembled.totalSec);
                assembledShotDurations = shotDurations;
                const { words: absoluteWords, segments } = narrationWordTimings(assembled.segments);
                const vttContent = buildCaptionsVtt(absoluteWords);
                fs.writeFileSync(path.join(pkgDir, 'captions.vtt'), vttContent, 'utf8');
                fs.writeFileSync(path.join(pkgDir, 'voiceover_words.json'), JSON.stringify({ words: absoluteWords }, null, 2), 'utf8');
                fs.writeFileSync(
                  path.join(pkgDir, 'narration.json'),
                  JSON.stringify(
                    {
                      segments,
                      shotDurations,
                      totalAudioDuration: assembled.totalSec,
                      voiceoverPath: publicPath,
                      captionsPath: path.join(pkgDir, 'captions.vtt'),
                      captionsVttContent: vttContent,
                      words: absoluteWords,
                      wordsPath: path.join(pkgDir, 'voiceover_words.json'),
                      ttsBackend: cacheVoiceKey,
                      voice: resolvedVcdVoiceId,
                      speed: null,
                      lines: { recorded: lineSummary.recorded, reused: lineSummary.reused },
                    },
                    null,
                    2,
                  ),
                  'utf8',
                );
              }

              generated = true;
              console.log(`[TTS] voiceover: ${lineSummary.recorded} line(s) recorded, ${lineSummary.reused} reused (${cleanText.length} chars)`);
            } catch (err) {
              if (err instanceof VcdUnavailableError || err instanceof AideosConfigError) vcdError = err;
              else if (err instanceof VoiceSynthesisError) synthesisError = err;
              console.warn('[TTS] synthesis failed:', err instanceof VcdUnavailableError || err instanceof AideosConfigError ? err.message : err);
            }

            if (generated) {
              if (script) writeScriptWithLog(pkgDir, plainTextToTaggedScript(script));

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
              let updatedFilm: Film | undefined = undefined;
              let updatedRev: string | undefined = undefined;
              let updatedShots: any[] | undefined = undefined;

              try {
                // The authoritative film.json, never the generated shadow (which can lag behind it).
                const parsedFilm = readFilm(projectId);
                if (parsedFilm) {
                  const computedShots =
                    assembledShotDurations && parsedFilm.shots.length === assembledShotDurations.length
                      ? parsedFilm.shots.map((s: any, idx: number) => ({
                          ...s,
                          dur: Number(assembledShotDurations![idx].toFixed(3)),
                        }))
                      : (() => {
                          const currentTotal = parsedFilm.shots.reduce((sum: number, s: any) => sum + (s.dur || 0), 0);
                          const scale = currentTotal > 0 ? measuredDuration / currentTotal : 1.0;
                          return parsedFilm.shots.map((s: any) => ({
                            ...s,
                            dur: Number(((s.dur || 1) * scale).toFixed(2)),
                          }));
                        })();

                  const sumNew = computedShots.reduce((sum: number, s: any) => sum + s.dur, 0);
                  const diff = measuredDuration - sumNew;
                  if (Math.abs(diff) > 0.001 && computedShots.length > 0) {
                    computedShots[computedShots.length - 1].dur = Number((computedShots[computedShots.length - 1].dur + diff).toFixed(assembledShotDurations ? 3 : 2));
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
                      voice,
                      ...(resolvedVcdLanguage ? { language: resolvedVcdLanguage } : {}),
                    },
                    audioClips: undefined,
                  } as Film;
                  // The studio adopts exactly the film written here at its revision, instead of saving it again on a stale one.
                  const written = writeFilm(projectId, updatedFilm);
                  updatedFilm = written.film;
                  updatedRev = written.rev;
                }
              } catch (syncErr) {
                console.warn('[TTS] Automatic shot duration scaling error:', syncErr);
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

              // Automatically prompt and dispatch to connected coding agent across channels
              const dispatch = await dispatchTask({
              ownerKey: ownerOf(req),
                eventType: "voiceover_ready",
                filmId: projectId,
                filmTitle: taskOpts.filmTitle,
                voiceoverFile: `videos/${projectId}/${outFilename}`,
                durationSec: measuredDuration,
                shotCount: taskOpts.shotCount,
              });

              sendJson(res, 200, {
                ok: true,
                filename: outFilename,
                audioSrc: `/videos/${projectId}/${outFilename}?t=${Date.now()}`,
                scriptFile: `videos/${projectId}/script.md`,
                spokenWordCount: taskOpts.spokenWordCount,
                estimatedDurationSec: Math.round(measuredDuration),
                actualDurationSec: measuredDuration,
                ...(isClonedVoice ? { voice, voiceKey: cacheVoiceKey } : {}),
                lines: lineSummary,
                otherVoices,
                intakeNotices,
                shots: updatedShots,
                film: updatedFilm,
                ...(updatedRev ? { rev: updatedRev, order: traceBus.getFilmUpdateOrder(projectId) } : {}),
                agentPrompt,
                taskFile: `videos/${projectId}/director_task.md`,
                dispatch,
              });
            } else if (vcdError) {
              sendJson(res, 503, {
                error: vcdError.message,
                ...(vcdError instanceof VcdUnavailableError ? { code: vcdError.code } : {}),
                attempts: [{ provider: 'vcd', reason: vcdError.message }],
              });
            } else {
              const vcdOnly = synthesisError?.attempts.length === 1 && synthesisError.attempts[0].provider === 'vcd';
              sendJson(res, 503, {
                error: vcdOnly ? synthesisError!.attempts[0].reason : 'Failed to synthesize voiceover audio.',
                detail: vcdOnly ? undefined : synthesisError?.message,
                attempts: synthesisError?.attempts,
              });
            }
          }).catch(err => sendJson(res, 500, { error: String(err) }));
          return;
        }

        // Handle /api/projects/new (Create fresh video project and auto-compile film)
        if (url === '/api/projects/new' && req.method === 'POST') {
          void readBody(req).then((body: any) => {
            const {
              title,
              id,
              script = '',
              theme: chosenTheme,
              accent: chosenAccent,
              voice: _voice = 'kokoro-am_adam',
              voiceSpeed,
              autoCompile = false
            } = body || {};
            // The theme and accent chosen in the dialog bind the project: every film below carries them.
            const filmTheme = newProjectFilmTheme(chosenTheme, chosenAccent);
            const accent = filmTheme.accent;

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

            // 1. Create videos/<id>/script.md. A plain-text story (paragraphs, optional #Start / #Conclusion
            // markers) is converted here by Aideos itself, deterministically and with no agent, so nobody
            // downstream reformats what the user wrote. A tagged script and an empty project stay as they are.
            const newPkgDir = path.join(videosDir, cleanId);
            if (fs.existsSync(path.join(newPkgDir, 'film.json')) || fs.existsSync(path.join(newPkgDir, 'script.md'))) {
              sendJson(res, 409, { error: `A film named "${cleanId}" exists.` });
              return;
            }
            const storyScript = plainTextToTaggedScript(script, { speed: Number(voiceSpeed) > 0 ? Number(voiceSpeed) : DEFAULT_KOKORO_SPEED });

            // The first film: compiled from the story, or one title shot when the story is under the minimum film length (backend/newProjectFilm.ts).
            const newFilm: Film = buildNewProjectFilm({ id: cleanId, title: title.trim(), accent, theme: filmTheme, storyScript, autoCompile: Boolean(autoCompile) });

            fs.mkdirSync(newPkgDir, { recursive: true });
            fs.writeFileSync(path.join(newPkgDir, 'script.md'), storyScript, 'utf8');
            syncNarrationLog(newPkgDir, 'user');

            // 2. Create videos/<id>/film.json (authoritative, read by the editor Player) and
            // src/dl/films/<id>.ts (for Remotion's CLI render/activeFilm bundle) in one store write.
            const { film: createdFilm } = writeFilm(cleanId, newFilm);

            // 3. Point activeFilm.ts to new film
            setActiveFilm(cleanId);

            sendJson(res, 200, {
              ok: true,
              id: cleanId,
              film: createdFilm,
              script: storyScript,
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
              setActiveFilm(id);
              sendJson(res, 200, { ok: true, activeId: id });
            }).catch(err => sendJson(res, 500, { error: String(err) }));
            return;
          }
        }

        // Previews use the same verified shared cache as the render, never the remote source URL.
        const audioPreviewRoute = url.match(/^\/api\/audio-library\/([A-Za-z0-9._-]+)\/preview$/);
        if (audioPreviewRoute) {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST to prepare a track preview.' });
          void (async () => {
            const item = loadAudioLibrary().items.find((candidate) => candidate.id === audioPreviewRoute[1]);
            if (!item || item.licence.attribution !== null) return sendJson(res, 400, { error: 'Choose a no-credit library item.' });
            await fetchAudioItem(item);
            const result = verifyAudioItem(item);
            if (result.status !== 'valid') return sendJson(res, 400, { error: result.message });
            sendJson(res, 200, { src: `/videos/.audio-library/${getAudioItemFilename(item)}` });
          })().catch((error: unknown) => sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }));
          return;
        }

        // Propose a checked sound-only rebuild; the normal owner commit/autosave persists it.
        const soundtrackRoute = url.match(/^\/api\/soundtrack\/([a-z0-9-]+)$/);
        if (soundtrackRoute) {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST to edit the soundtrack.' });
          void readBody(req).then(async (body: unknown) => {
            const request = studioSoundtrackRequestSchema.safeParse(body);
            if (!request.success) throw new Error(request.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
            const { film, edit } = request.data;
            if (film.id !== soundtrackRoute[1]) throw new Error('Soundtrack film does not match the open project.');
            const rebuilt = await rebuildStudioSoundtrack(film, edit, 'long');
            sendJson(res, 200, { film: rebuilt });
          }).catch((error: unknown) => sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }));
          return;
        }

        // Handle /api/design/:id/approve-look (Look stage: captain approval recorded to look.json)
        // Handle /api/design/:id (the Look stage's design overview and full-film design dispatch)
        // Handle /api/design/:id/motion (the Look stage's Ask: requests to the agent for a shot, their outcomes, undo)
        const approveLookRoute = url.match(/^\/api\/design\/([a-z0-9-]+)\/approve-look$/);
        if (approveLookRoute) {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: `${req.method} ${url} is not allowed` });
            return;
          }
          void import('../backend/designSpec/shotTools.ts').then(({ approveLookPlan }) => {
            const plan = approveLookPlan(approveLookRoute[1]);
            sendJson(res, 200, { ok: true, approval: plan.approval?.captain ?? null });
          }).catch(err => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
          return;
        }

        const motionRoute = url.match(/^\/api\/design\/([a-z0-9-]+)\/(?:motion(?:\/([A-Za-z0-9-]+)\/revert)?|shots\/([A-Za-z0-9_-]+)\/motion)$/);
        if (motionRoute) {
          const [, filmId, revertId, shotId] = motionRoute;
          void (async () => {
            const motion = await import('../backend/designSpec/motionRequests.ts');
            if (req.method === 'GET' && !revertId && !shotId) return sendJson(res, 200, { ok: true, requests: motion.listMotionRequests(filmId) });
            if (req.method !== 'POST') return sendJson(res, 405, { error: `${req.method} ${url} is not allowed` });
            if (revertId) return sendJson(res, 200, { ok: true, request: motion.revertMotion(filmId, revertId) });
            const body = (await readBody(req)) as { prompt?: string; film?: unknown };
            const posted = body?.film ? filmSchema.safeParse(body.film) : null;
            const file = path.join(videosDir, filmId, 'film.json');
            const film = posted?.success ? posted.data : fs.existsSync(file) ? filmSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
            if (!film) return sendJson(res, 404, { error: `Film "${filmId}" not found` });
            const { serverDesignCaller } = await import('../backend/designSpec/designer.ts');
            const request = await motion.requestMotion(film, shotId, String(body?.prompt ?? ''), { ownerKey: ownerOf(req), llmCaller: await serverDesignCaller(filmId) });
            sendJson(res, 200, { ok: true, request });
          })().catch((err) => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
          return;
        }

        const designRoute = url.match(/^\/api\/design\/([a-z0-9-]+)$/);
        if (designRoute) {
          const [, filmId] = designRoute;
          const loadFilm = (posted: unknown): Film | null => {
            const parsed = posted ? filmSchema.safeParse(posted) : null;
            if (parsed?.success) return parsed.data;
            const file = path.join(videosDir, filmId, 'film.json');
            return fs.existsSync(file) ? filmSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
          };
          if (req.method === 'GET') {
            void import('../backend/designSpec/shotTools.ts').then(({ designOverview }) => {
              const film = loadFilm(null);
              if (!film) return sendJson(res, 404, { error: `Film "${filmId}" not found` });
              sendJson(res, 200, { ok: true, overview: designOverview(film) });
            }).catch(err => sendJson(res, 500, { error: String(err) }));
            return;
          }
          if (req.method === 'POST') {
            void readBody(req).then(async (body: any) => {
              const film = loadFilm(body?.film);
              if (!film) return sendJson(res, 404, { error: `Film "${filmId}" not found` });
              const { requestFilmDesign } = await import('../backend/designSpec/shotTools.ts');
              const dispatch = await requestFilmDesign(film, ownerOf(req));
              sendJson(res, 200, { ok: true, channels: dispatch.channels, taskId: dispatch.taskId, message: dispatch.message });
            }).catch(err => sendJson(res, 500, { error: String(err) }));
            return;
          }
          sendJson(res, 405, { error: `${req.method} ${url} is not allowed` });
          return;
        }

        if (url !== '/api/films' && !url.startsWith('/api/films/')) return next();

        if (url === '/api/films' && req.method === 'GET') {
          const set = new Set<string>();
          if (fs.existsSync(filmsDir)) {
            fs.readdirSync(filmsDir)
              .filter(f => f.endsWith('.ts') && f !== 'index.ts')
              .forEach(f => set.add(f.replace(/\.ts$/, '')));
          }
          for (const slug of listVideoPackages()) {
            if (fs.existsSync(path.join(resolvePackageDir(slug), 'film.json'))) set.add(slug);
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
          let stored: ReturnType<typeof readStoredFilm>;
          try {
            stored = readStoredFilm(id);
          } catch (error) {
            sendFilmReadError(res, error);
            return;
          }
          if (!stored) {
            sendJson(res, 404, { error: `Film "${id}" not found` });
            return;
          }
          sendJson(res, 200, { ok: true, film: stored.film, rev: stored.rev, order: traceBus.getFilmUpdateOrder(id) });
          return;
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
            // A save names the revision it started from; a stale one is refused with the film now on
            // disk so the studio can keep both versions instead of the last writer silently winning.
            let currentRev: string | null;
            try {
              currentRev = readStoredFilm(id)?.rev ?? null;
            } catch (error) {
              sendFilmReadError(res, error);
              return;
            }
            if (decideSave(raw?.baseRev, currentRev) === 'stale') {
              sendJson(res, 409, { error: 'conflict', code: 'stale_revision', rev: currentRev, order: traceBus.getFilmUpdateOrder(id), film: readFilm(id) });
              return;
            }
            // A save may not introduce a media source that is missing on disk (Rule 6); sources the film on disk already has are left alone.
            try {
              assertFilmWriteAssetsExist(parsed.data, readFilm(id), { baseDir: PUBLIC_DIR });
            } catch (error) {
              sendJson(res, 422, { error: error instanceof Error ? error.message : String(error), code: 'missing_asset' });
              return;
            }
            // This studio save endpoint is the trusted owner path; placement locks bind agents and rebuilds.
            const { film: written, rev } = writeFilm(id, parsed.data, { owner: true });

            setActiveFilm(id);

            // The film as written (caption placement carried, soundtrack prepared), so the studio holds exactly the bytes `rev` names.
            sendJson(res, 200, { ok: true, file: path.relative(path.resolve(__dirname, '..'), file), film: written, rev, order: traceBus.getFilmUpdateOrder(id) });
          })
          .catch((e: unknown) => {
            sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          });
      });
}

// Tests cache a synthetic audio library (AIDEOS_AUDIO_LIBRARY): serve that manifest in place of the committed audio/library.json the mixer imports. A no-op when unset.
const audioLibraryOverride = process.env.AIDEOS_AUDIO_LIBRARY?.trim()
function audioLibraryOverridePlugin(): Plugin {
  return {
    name: 'aideos-audio-library-override',
    enforce: 'pre',
    resolveId(source) {
      return audioLibraryOverride && /audio\/library\.json$/.test(source) ? path.resolve(audioLibraryOverride) : null
    },
  }
}

export default defineConfig({
  plugins: [react(), filmApiPlugin(), audioLibraryOverridePlugin()],
  publicDir: path.resolve(__dirname, '../public'),
  server: {
    port: Number(process.env.PORT) || releaseChannel(path.resolve(__dirname, '..')).port,
    // Bind loopback (127.0.0.1) by default so LAN peers cannot reach the local Studio API.
    // Opt in to binding other interfaces explicitly with HOST=0.0.0.0 (or `vite --host 0.0.0.0`, as Dockerfile does).
    host: resolveStudioHost(),
    strictPort: true,
    // CORS is enforced exclusively by setupApiMiddlewares (studioApiGuard) with an allowlist, never '*'.
    cors: false,
    // The hosted backend is this dev server (the API lives in its middleware), reached as
    // aideos-backend.onrender.com directly and through Vercel's /api rewrite. Vite rejects any
    // Host it does not know with a 403, so name the hosting domains; AIDEOS_ALLOWED_HOSTS adds more.
    allowedHosts: resolveAllowedHosts(),
    fs: {
      allow: ['..', ...(audioLibraryOverride ? [path.dirname(path.resolve(audioLibraryOverride))] : [])]
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
  preview: {
    port: Number(process.env.PORT) || releaseChannel(path.resolve(__dirname, '..')).port,
    host: resolveStudioHost(),
    cors: false,
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
