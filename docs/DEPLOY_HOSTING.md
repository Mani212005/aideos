<!--
File Description: Step-by-step deployment guide for hosting Aideos on Vercel (Frontend Studio) and Render (Backend & Video Compiler).
-->

# Aideos Hosting and Deployment Runbook

This runbook details how to deploy Aideos live across **Vercel** (Frontend Studio SPA) and **Render** (Backend API, Agent Compiler, and Remotion Video Pipeline).

---

## 1. Architecture & Two-Service Topology

Aideos runs as a decoupled two-service architecture:

```
+-------------------------------------------------------------+
|                  Vercel (Frontend Studio)                   |
|  - Static React / Vite SPA built from editor/               |
|  - High-performance global CDN distribution                 |
|  - Rewrites /api/* and /videos/* to Render backend URL      |
+------------------------------+------------------------------+
                               |
                               | (Proxied HTTP & SSE Streams)
                               v
+-------------------------------------------------------------+
|                  Render (Backend & Compiler)                |
|  - Docker Container running Node.js 20 on Debian Bookworm   |
|  - Pre-installed Chromium, FFmpeg, and Asian/Emoji fonts    |
|  - Google GenAI Agent Compiler & Script Intake              |
|  - Remotion video rendering and waveform extraction engine  |
|  - Health check endpoint: /api/health                       |
+-------------------------------------------------------------+
```

---

## 2. Prerequisites & Credentials

Before deploying, ensure you have:

1. **Render Account**: Access to [render.com](https://render.com).
2. **Vercel Account**: Access to [vercel.com](https://vercel.com).
3. **Required API Keys**:
   - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`): Required for AI agent compiler, script intake, director prose transform, and Jev semantic primitive compilation.
4. **Optional API Keys, Secrets & GPU Settings**:
   - `AIDEOS_LINK_SECRET`: Secret key used to sign agent-link tokens so pairings persist across server restarts (automatically generated via Blueprint `render.yaml`, or derived from `GEMINI_API_KEY`).
   - `AIDEOS_PUBLIC_API_URL`: Public address of the backend dialed by `aideos connect` (e.g. `https://aideos-backend.onrender.com`).
   - `DEEPGRAM_API_KEY`: For fast cloud-based word-level audio transcription and TTS.
   - `WAN_GPU_HOST`, `WAN_GPU_USER`, `WAN_GPU_PASSWORD`: For remote GPU Wan2.1 diffusion B-roll generation.

---

## 3. Step 1: Deploy Backend to Render

### Option A: Using Render Blueprint (Recommended)

1. Log into your Render dashboard.
2. Click **New +** -> **Blueprint**.
3. Connect the `aideos` GitHub repository.
4. Render will detect `render.yaml` automatically.
5. In the service setup screen, fill in the secret environment variables (`GEMINI_API_KEY`, etc.).
6. Click **Apply**.
7. Once the build finishes, copy your Render service URL (e.g. `https://aideos-backend.onrender.com`).

### Option B: Manual Web Service Creation

1. In Render dashboard, click **New +** -> **Web Service**.
2. Connect the `aideos` repository.
3. Configure the following settings:
   - **Name**: `aideos-backend`
   - **Language**: `Docker`
   - **Branch**: `main` (or your deployment branch)
   - **Dockerfile Path**: `./Dockerfile`
   - **Docker Context**: `.`
   - **Instance Type**: `Free`
   - **Health Check Path**: `/api/health`
4. Under **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `PORT`: `8080`
   - `GEMINI_API_KEY`: `<your-gemini-api-key>`
   - `AIDEOS_GEMINI_MODEL`: `gemini-2.0-flash`
   - *(Optional)* `DEEPGRAM_API_KEY`, `WAN_GPU_*`
5. Click **Create Web Service**.
6. Wait for deployment to complete and copy the backend URL (`https://<your-service>.onrender.com`).

---

## 4. Step 2: Deploy Frontend Studio to Vercel

1. Log into your Vercel dashboard.
2. Click **Add New...** -> **Project**.
3. Import the `aideos` GitHub repository.
4. Update the destination URL in `vercel.json` with your live Render backend URL:
   - Replace `https://aideos-backend.onrender.com` in `vercel.json` with your actual Render service URL.
5. Configure the Project Settings on Vercel:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./` (leave default)
   - **Build Command**: `cd editor && npm run build` (automatic from `vercel.json`)
   - **Output Directory**: `editor/dist` (automatic from `vercel.json`)
   - **Install Command**: `npm ci` (automatic from `vercel.json`)
6. Click **Deploy**.
7. Once deployment finishes, open your Vercel deployment URL (e.g. `https://aideos.vercel.app`).

---

## 5. Step 3: Verification & Smoke Testing

1. **Verify Backend Health**:
   - Open `https://<your-render-service>.onrender.com/api/health` in your browser.
   - Expected response: `{"status":"ok","service":"aideos-backend","uptime":...,"timestamp":"..."}`.
2. **Verify Film Registry**:
   - Open `https://<your-vercel-app>.vercel.app/api/films`.
   - Expected response: JSON list of available film package slugs (e.g. `["hello-scene", ...]`).
3. **Verify Interactive Studio**:
   - Open `https://<your-vercel-app>.vercel.app`.
   - The Studio Editor should load cleanly with the 2D infinite spatial canvas and playback controls.
   - Switch stages (Words, Look, Cut, Check) to confirm live UI functionality.
   - Test screenplay generation to verify Gemini API integration.

---

## 6. Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | - | Google Gemini API key for agent compilation |
| `GOOGLE_API_KEY` | Alternative / No | - | Fallback Google GenAI and Cloud TTS API key |
| `AIDEOS_GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model name for screenplay intake |
| `AIDEOS_GEMINI_REVIEW_MODEL` | No | `videoModels.reviewer.model` in `aideos.config.json` | agy CLI model catalog ID for video quality review loop; see [review model policy](REVIEW.md#5-video-model-policy) |
| `AIDEOS_PUBLIC_API_URL` | No | `https://aideos-backend.onrender.com` | Public backend URL shown in agent link connect commands |
| `AIDEOS_LINK_SECRET` | No | Derived / generated | HMAC secret key signing agent link tokens across restarts |
| `DEEPGRAM_API_KEY` | No | - | Deepgram API key for speech recognition and neural TTS |
| `AIDEOS_KOKORO` | No | - | Override container memory gate for local Kokoro TTS (1 to force enable, 0 to force disable) |
| `PORT` | No | `8080` (Docker) / `3001` (Dev) | Port for the backend server |
| `HOST` | No | `127.0.0.1` (Dev) / `0.0.0.0` (Docker `--host 0.0.0.0`) | Bind address for the Studio server; defaults to loopback-only for safety (set `HOST=0.0.0.0` or pass `--host 0.0.0.0` to opt in to network interfaces) |
| `AIDEOS_ALLOWED_HOSTS` | No | `.onrender.com` | Comma-separated extra hostnames allowed by Vite in hosted deployments |
| `AIDEOS_ALLOWED_ORIGINS` | No | - | Comma-separated explicit origins (for example `https://aideos.vercel.app`) granted CORS by the Studio API; see [Studio API access](#studio-api-access) |
| `NODE_ENV` | No | `production` | Node environment |
| `WAN_GPU_HOST` | No | - | Remote GPU host for Wan2.1 video diffusion B-roll |
| `WAN_GPU_USER` | No | - | Remote GPU SSH user |
| `WAN_GPU_PASSWORD` | No | - | Remote GPU SSH password |

### Studio API access

`backend/studioApiGuard.ts` owns the contract; its header and function comments are authoritative.

- The server binds loopback (`127.0.0.1`) unless `HOST` is set. The Docker image passes `--host 0.0.0.0` explicitly.
- CORS is allowlist-only (never `*`): a local Studio page gets its own loopback origin, and hosted deployments get the origins in `AIDEOS_ALLOWED_ORIGINS` and `AIDEOS_PUBLIC_API_URL` plus their own HTTPS origin. Other preflights get 403 `origin_not_allowed`.
- Every non-GET API route except OPTIONS is refused with 403 `local_studio_required` unless the request is a same-origin loopback Studio page. This covers writes, voice synthesis and exports. GET and HEAD stay open, except `/api/audio/retime`, which is local only.
- Agent link `claim`, `result`, `pair`, `DELETE /api/agent-link`, `/api/mcp` and the acceptance check stay reachable on hosted deployments (foreign browser origins are refused).
- Non-local write, export, upload, voice synthesis and edit requests are refused with 403 `local_studio_required`. This includes the routes that dispatch tasks to a linked agent (`/api/prompt-agent`, `/api/ai-edit`, project design and shot-redesign routes). The hosted access model is an open decision, so no hosted route beyond the list above is opened by this guard.

---

## 7. Free-Tier Capabilities and Constraints

When hosting on Render's free tier, keep the following considerations in mind:

1. **Cold Starts**:
   - Free instances on Render spin down after 15 minutes of inactivity. The first request after dormancy takes ~50 seconds to wake the container.
2. **Memory and CPU Limits**:
   - Free tier provides 512 MB RAM and 0.1 CPU.
   - **Interactive Studio, Script Intake, Audio Sync & Canvas**: Read-only browsing and the agent-link routes work on a hosted deployment. Writes, edits, uploads, exports and agent dispatch from a non-local origin are refused with 403 (see [Studio API access](#studio-api-access)).
   - **Full Remotion MP4 Rendering**: The Studio export route is refused on a hosted deployment, so the sizing note below applies to local or self-run renders. Remotion rendering spins up headless Chromium and FFmpeg. On 512 MB RAM, rendering full-length 1080p videos may run slowly or encounter memory constraints. For heavy video rendering workloads, upgrading the Render instance to Starter (512MB-1GB) or Standard (2GB+) is recommended.
3. **Speech Synthesis**:
   - On a hosted deployment `/api/generate-voiceover` is refused with 403 `local_studio_required` ([Studio API access](#studio-api-access)) while the hosted access decision is open. The memory gate and fallback below apply to a Studio server reached from a local origin.
   - Local Kokoro TTS requires ~400 MB of ONNX model runtime memory, so on hosts with under 1.5 GB RAM (such as the Render 512 MB free tier), the studio voiceover synthesis route (`/api/generate-voiceover` via `backend/voiceSynthesis.ts`) automatically skips local Kokoro to prevent out-of-memory container crashes. It seamlessly falls back to cloud TTS (`DEEPGRAM_API_KEY` or `GOOGLE_API_KEY`). On memory-constrained hosts without cloud API keys, synthesis returns an HTTP 503 with per-provider failure reasons rather than an opaque 502/500 crash.
