<!-- File Description: Contest Rules and Platform Verification Matrix documenting SDK compliance, agent architecture, grounding, and deployment. -->

# Aideos: Contest Rules & Platform Verification Matrix

This document provides formal verification and evidence for all platform and hackathon requirements governing the Aideos project.

---

## 1. Google GenAI SDK & Model Verification (V-1, A7)

### Requirement
The hackathon requires genuine usage of Google's Generative AI technologies (Gemini models) and compliance with official SDK specifications.

### Implementation & Evidence
* **Official SDK**: Aideos utilizes the official `@google/genai` package (`npm:@google/genai@^2.19.0`), the official next-generation Google GenAI SDK for Node.js and TypeScript.
* **Model ID**: Configured in `backend/modelClient.ts` as `gemini-2.0-flash` (with environment variable override support via `AIDEOS_GEMINI_MODEL`).
* **Zero Barred SDKs**: Runtime dependencies in `package.json` are verified clean with zero unauthorized third-party vendor SDKs (`openai`, `@deepgram/sdk`, `@anthropic-ai/*`).
* **Test Verification**: Verified by `backend/ideation/ideation.test.ts` and `backend/compliance.test.ts`.

---

## 2. Agent Architecture & Self-Correction (V-2, A5)

### Requirement
The project must exhibit genuine autonomous agent capabilities, structured reasoning, and self-correction.

### Implementation & Evidence
* **Staged Agent Pipeline**: Multi-stage generation from research retrieval $\to$ treatment $\to$ shot list $\to$ visual device synthesis.
* **19 Invariant Enforcement Rules**: Programmatic gating validates C1 joint velocity continuity, middle-60% viewport centering, zero text clipping, and $\pm 50\text{ms}$ audio clock synchronization.
* **Self-Correction Engine**: If a generated shot list violates any invariant (e.g. consecutive duplicate metaphors or audio duration mismatch), the agent detects the fault, computes an atomic patch, and re-verifies before compilation.
* **Critique Studio**: `/api/critique` provides a live conversational feedback drawer where users submit natural-language adjustments which the agent translates into precise JSON manifest modifications.

---

## 3. Partner Track: Parallel Web Search Grounding (A8, A4)

### Requirement
Projects competing in the Parallel Partner Track must demonstrate genuine web search grounding using the `parallel-web` SDK.

### Implementation & Evidence
* **SDK Integration**: `backend/parallelClient.ts` integrates `parallel-web` (`npm:parallel-web@^1.3.2`).
* **Live Research Retrieval**: Queries live web corpora for technical claims, figures, and verified URLs prior to screenplay ideation.
* **Factual Citations**: Real URLs (e.g. `https://arxiv.org/abs/2405.04517`) are grounded directly into the film's canvas nodes and metadata.
* **Test Verification**: Tested in `backend/ideation/ideation.test.ts`.

---

## 4. Platform & Android Artifact Verification (V-4, A3)

### Requirement
Web / mobile accessibility and platform artifact delivery.

### Implementation & Evidence
* **PWA Standalone Manifest**: Configured at `editor/public/manifest.json` with standalone display mode, 192px/512px icon configurations, and theme styling (`#FF6B00` on `#0A0A0B`).
* **Touch & Responsive Viewport**: Editor and player support dynamic aspect-ratio switching between 16:9 Long and 9:16 Vertical Reel with safe mobile touch margins.
* **Installability**: Installable on Android devices and Chrome desktop via the native browser "Install Aideos Studio" action.

---

## 5. Cloud Run Deployment Architecture (A1)

### Implementation & Evidence
* **Containerization**: [`Dockerfile`](../Dockerfile) configures a hardened Node.js production container equipped with headless Chromium, libvpx, and FFmpeg for server-side video rendering.
* **One-Click Deployment Script**: [`scripts/deploy_cloud_run.sh`](../scripts/deploy_cloud_run.sh) submits Cloud Build artifacts and deploys managed Cloud Run services with 2 vCPUs and 2GB RAM.
