# Devpost Submission Text — Aideos

### 🏷️ Project Title
**Aideos: Autonomous Explainer Video Director as Pure Data**

### 💡 Tagline
Autonomous AI video director that transforms research and scripts into 16:9 explainer films and 9:16 vertical reels with self-correcting agent loops, kinematic SVG characters, and OpenShot timeline geometry.

---

### 🏆 Partner Track
**Parallel Web Search Track** (utilizing `parallel-web` for deep technical grounding and citation retrieval).

---

### 📖 Description / Story

#### 🌟 Inspiration
Creating high-quality technical explainer videos typically takes days of scriptwriting, visual asset creation, voiceover synthesis, and tedious keyframing in video editors. Existing generative AI tools produce disjointed, hallucinatory video clips with inconsistent characters, illegible text, and zero narrative continuity.

We asked: **What if a video director was not a prompt wrapper, but a deterministic, self-correcting autonomous agent governed by mathematical invariants and pure data?**

#### 🎬 What Aideos Does
Aideos is an autonomous motion-graphic explainer video director and interactive studio. Given a topic or script, Aideos:
1. **Performs Grounded Research**: Uses the **Parallel Web Search API** to fetch live technical facts, figures, and verified academic citations.
2. **Generates Multi-Stage Screenplays**: Uses **Google Gemini 2.0 Flash (`@google/genai`)** to architect a synchronized screenplay, spatial 2D mind map, visual metaphor devices, and character choreography.
3. **Enforces 19 Invariant Rules**: A rigorous verification gate evaluates C1 spline joint continuity ($10^{-6}$ mathematical floating precision), audio clock drift ($\pm 50\text{ms}$), middle-60% viewport centering, and complete-word headline typography.
4. **Self-Corrects Failures**: If a shot list violates pacing or continuity, the agent computes an atomic patch, re-verifies, and automatically clears the gate.
5. **Renders Two Formats from One Pure Data Document**: Simultaneously compiles 16:9 widescreen YouTube explainers and 9:16 vertical companion reels from the same underlying JSON film document.
6. **Provides an OpenShot-Grade Studio**: Includes a multi-track non-linear timeline editor with transaction-grouped undo/redo (`Cmd+Z`), sticky snapping with self-ignore, zero-overhead DOM playhead tracking, and a live AI Critique drawer.

---

#### 🛠️ How We Built It
* **AI & Agent Core**: Google GenAI SDK (`@google/genai`, Gemini 2.0 Flash) with structured JSON schema outputs and multi-stage self-correction.
* **Factual Grounding**: Parallel Web Search SDK (`parallel-web`) for live citation retrieval.
* **Rendering & Motion Graphics**: Remotion, React 19, SVG kinematic rigging, and Hermite Centripetal C1 spline interpolation.
* **Timeline Engine**: OpenShot-inspired non-linear editing geometry (`position`, derived `duration`, `layer` indices, transaction-grouped update actions).
* **Audio & Captions**: WebAudio streaming with byte-range headers, WebVTT phrase-locked kinetic captions, and automatic voiceover ducking envelopes.
* **Testing & Quality Assurance**: 190 automated test suites verifying all 19 kinematic, spatial, and timing invariants.

---

#### 🧗 Challenges We Overcame
1. **Character Motion Jumps**: Early keyframe transitions had abrupt $15.0^\circ/\text{s}$ angular velocity discontinuities. We implemented Hermite Centripetal C1 splines and secondary harmonic oscillator dynamics, bringing velocity jumps down to $0.000^\circ/\text{s}$ ($\le 10^{-6}$ precision).
2. **Timeline Playback Re-render Lag**: Firing 60 React state updates per second during playback caused frame drops and audio stuttering. We replaced React state synchronization with direct DOM ref binding on the playhead and timecode, delivering silky 60 FPS playback with zero reconciliation overhead.
3. **Hallucination on Recent Tech**: By integrating the Parallel Web Search API at the ideation stage, Aideos grounds every script in verified web sources before any code or visual block is compiled.

---

#### 🏅 Accomplishments We're Proud Of
* **190 Passing Automated Tests**: 100% pass rate across timeline geometry, critique engine, caption parser, and visual rendering.
* **Two Formats from One Pure Data Manifest**: 16:9 Long and 9:16 Vertical Reel derived deterministically from the same JSON document without duplicate editing.
* **Zero Ghost Frames**: Non-linear layer model that eliminates black flashes and timeline gaps through explicit active-shot resolution.

---

#### 🚀 What's Next for Aideos
* Full video footage segmentation and hybrid AI video b-roll compositing.
* Enhanced voice cloning and multi-character dialogue interplay.
* One-click Cloud Run cloud rendering cluster for instant batch exports.
