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
|  - Google GenAI Agent Compiler, Script Intake & Critique   |
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
   - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`): Required for AI agent compiler, script intake, director prose transform, critique engine, and Jev semantic primitive compilation.
4. **Optional API Keys & GPU Settings**:
   - `DEEPGRAM_API_KEY`: For fast cloud-based word-level audio transcription and TTS.
   - `PARALLEL_API_KEY`: For web research and script enrichment.
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
   - *(Optional)* `DEEPGRAM_API_KEY`, `PARALLEL_API_KEY`, `WAN_GPU_*`
5. Click **Create Web Service**.
6. Wait for deployment to complete and copy the backend URL (`https://<your-service>.onrender.com`).

---

## 4. Step 2: Deploy Frontend Studio to Vercel

1. Log into your Vercel dashboard.
2. Click **Add New...** -> **Project**.
3. Import the `aideos` GitHub repository.
4. Update the destination URL in `vercel.json` (or `editor/vercel.json`) with your live Render backend URL:
   - Replace `https://aideos-backend.onrender.com` in `vercel.json` with your actual Render service URL.
5. Configure the Project Settings on Vercel:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./` (leave default, or set to `editor` if deploying standalone)
   - **Build Command**: `cd editor && npm run build` (automatic from `vercel.json`)
   - **Output Directory**: `editor/dist` (automatic from `vercel.json`)
   - **Install Command**: `npm --prefix editor ci` (automatic from `vercel.json`)
6. Click **Deploy**.
7. Once deployment finishes, open your Vercel deployment URL (e.g. `https://aideos.vercel.app`).

---

## 5. Step 3: Verification & Smoke Testing

1. **Verify Backend Health**:
   - Open `https://<your-render-service>.onrender.com/api/health` in your browser.
   - Expected response: `{"status":"ok","service":"aideos-backend","uptime":...,"timestamp":"..."}`.
2. **Verify Film Registry**:
   - Open `https://<your-vercel-app>.vercel.app/api/films`.
   - Expected response: JSON list of available film package slugs (e.g. `["kvcache", "still-talking", ...]`).
3. **Verify Interactive Studio**:
   - Open `https://<your-vercel-app>.vercel.app`.
   - The Studio Editor should load cleanly with the 2D infinite spatial canvas and playback controls.
   - Switch stages (Story, Stage, Motion, Edit) to confirm live UI functionality.
   - Test screenplay generation and natural-language critique to verify Gemini API integration.

---

## 6. Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | - | Google Gemini API key for agent compilation and critique |
| `GOOGLE_API_KEY` | Alternative | - | Fallback Google GenAI API key |
| `AIDEOS_GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model name for screenplay intake and critique |
| `DEEPGRAM_API_KEY` | No | - | Deepgram API key for speech recognition and neural TTS |
| `PARALLEL_API_KEY` | No | - | Parallel Web Search key for factual script research |
| `PORT` | No | `8080` (Docker) / `3001` (Dev) | Port for the backend server |
| `NODE_ENV` | No | `production` | Node environment |
| `WAN_GPU_HOST` | No | - | Remote GPU host for Wan2.1 video diffusion B-roll |
| `WAN_GPU_USER` | No | - | Remote GPU SSH user |
| `WAN_GPU_PASSWORD` | No | - | Remote GPU SSH password |

---

## 7. Free-Tier Capabilities and Constraints

When hosting on Render's free tier, keep the following considerations in mind:

1. **Cold Starts**:
   - Free instances on Render spin down after 15 minutes of inactivity. The first request after dormancy takes ~50 seconds to wake the container.
2. **Memory and CPU Limits**:
   - Free tier provides 512 MB RAM and 0.1 CPU.
   - **Interactive Studio, Script Intake, Critique, Audio Sync & Canvas**: Fully functional and responsive.
   - **Full Remotion MP4 Rendering**: Remotion rendering spins up headless Chromium and FFmpeg. On 512 MB RAM, rendering full-length 1080p videos may run slowly or encounter memory constraints. For heavy video rendering workloads, upgrading the Render instance to Starter (512MB-1GB) or Standard (2GB+) is recommended.
3. **Speech Synthesis**:
   - Offline Kokoro TTS utilizes CPU ONNX runtime. Google Cloud TTS / Deepgram TTS API keys provide instant cloud voiceover generation without local CPU load.
