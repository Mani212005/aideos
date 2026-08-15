import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
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

        // Handle /api/downloads/:filename to stream exported MP4
        if (url.startsWith('/api/downloads/')) {
          const fname = path.basename(url.slice('/api/downloads/'.length));
          const fpath = path.join(__dirname, '../out', fname);
          if (fs.existsSync(fpath)) {
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
            fs.createReadStream(fpath).pipe(res);
            return;
          } else {
            sendJson(res, 404, { error: 'File not found' });
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
        if (!id || req.method !== 'POST') {
          sendJson(res, 405, { error: `${req.method} ${url} is not a film route` });
          return;
        }
        if (!FILM_ID.test(id)) {
          sendJson(res, 400, { error: `"${id}" is not a film id (lowercase letters, digits and dashes)` });
          return;
        }

        // The film is parsed here rather than trusted: the editor is the only
        // writer of src/dl/films, so anything that reaches disk has to be
        // something `npm run validate` and the render would accept.
        void readBody(req)
          .then(body => {
            const film = (body as { film?: unknown } | null)?.film;
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
            sendJson(res, 200, { ok: true, file: path.relative(path.resolve(__dirname, '..'), file) });
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
