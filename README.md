# Aideos

> **Autonomous Explainer Video Director as Pure Data.**
> One Canvas · One Camera · 8 Character Archetypes · 5 OpenShot Geometry Patterns · 16:9 Long & 9:16 Vertical Reels.

---

## 🏛️ The 4 Core Architectural Axioms

1. **Axiom 1 (Films and Scenes are Pure Data):** Zero runtime logic or browser solvers inside film manifests (`src/dl/films/*.ts`). Solvers execute at compile/ideation time and emit pure serializable JSON.
2. **Axiom 2 (Audio-First Timing Spine):** The narration voiceover drives the master clock. Total shot durations lock to the audio length within $\pm 50\text{ms}$.
3. **Axiom 3 (Derived Spatial Framing):** The camera solves framing and zoom levels from graph node coordinates, never hard-coded pixel coordinates.
4. **Axiom 4 (Strict Theme-Token Palette):** Every vector path, block, and character rig binds strictly to semantic theme tokens (`canvas`, `surface`, `ink`, `muted`, `hairline`, `accent`).

---

## 🎬 Two Formats, One Film

`Long` (1920×1080) and `Reel` (1080×1920) are not two separate edits. They derive automatically from the exact same canvas and shot list; the vertical reel solves framing with safe mobile padding, centered typography ($\le 8$ complete words), and phrase-locked subtitles (`KineticSubtitles.tsx`).

---

## 📐 The 5 OpenShot-Grade Timeline Geometry Patterns

The Aideos Timeline & Trimmer implements industry-standard non-linear editing geometry:

1. **The Stored Clip Data Model:**
   * `position`: Timeline start timestamp (seconds, stored).
   * `start` / `end`: In/out points in the source media.
   * `dur` is derived: `end - start`.
   * `layer`: Integer track index (0 = main shots, 1 = b-roll/devices, 2 = subtitles, 3 = audio).
   * Eliminates ghost frames during gaps: timeline gaps produce `activeShotAt = null`, rendering clean spatial canvas backgrounds.
2. **Transaction-Grouped `UpdateAction` Engine:**
   * Multi-clip drags or ripple edits share a single transaction UUID.
   * Universal `Cmd + Z` / `Cmd + Shift + Z` undoes/redoes multi-clip gestures as a single atomic step.
3. **Sticky Snapping with Self-Ignore:**
   * Excludes the dragged clip from its own boundaries (`_snap_ignore_ids`).
   * Holds lock onto snap anchors until mouse delta exceeds a 12px threshold.
4. **Explicit Drag State Machine:**
   * Disjoint states (`idle`, `drag-clip`, `resize-left`, `resize-right`, `playhead-scrub`, `box-select`, `vo-trim`) with clean entry/exit hooks.
5. **Pending Overrides Preview Layer:**
   * 60 FPS live preview during mouse dragging without committing to the persistent document until mouse release.

---

## 🤖 Google GenAI & Parallel Search Grounding

* **Parallel Search Integration (`parallel-web`):** Queries live web corpora and retrieves factual citations before screenplay generation, preventing LLM hallucination on post-2024 technical topics.
* **Google GenAI Integration (`@google/genai`):** Structured Gemini 2.5/3.0 generation enforced against 19 geometric and kinematic invariant rules.
* **100% Contest Compliance:** Zero barred third-party AI SDKs (`openai`, `@deepgram/sdk`, `@anthropic-ai/*`) in runtime dependencies.

---

## 🎭 8 SVG Character Archetypes & Kinematic Rigging

Eight distinct anatomical vector characters built with 100% theme-token color compliance:
* 🚀 **Astronaut** · 💻 **Developer** · 📊 **Data Engineer** · 🔬 **Scientist**
* 👔 **Executive** · 🤖 **Robot** · 🎓 **Educator** · 🦊 **Mascot**

* **Hermite Centripetal C1 Splines:** Continuous joint velocities with velocity jumps verified below $\le 5.0^\circ/\text{s}$.
* **Secondary Dynamics:** Semi-implicit Euler damped harmonic oscillator simulation for hair, antenna, and cloth.
* **Archetype Payoff Choreography:** 8 distinct concluding victory poses with staggered arrival peaks ($t = 0.20 \to 0.45$).

---

## 🚀 Quick Start & Commands

```bash
# 1. Install dependencies
npm install

# 2. Run the 205 automated test suites (~10.6s)
npm test

# 3. Start the Aideos Studio Editor
npm run editor

# 4. Render 16:9 Long-Form Explainer Film
npm run render

# 5. Render 9:16 Vertical Companion Reel
npm run render:reel

# 6. Batch Render all 5 Production Films in 9:16 Vertical Format
npx tsx scripts/batch_reel.ts
```

---

## 🌐 Google Cloud Run Deployment

Deploy Aideos Studio to Google Cloud Run with pre-configured headless Chromium and FFmpeg:

```bash
GCP_PROJECT_ID="your-project-id" ./scripts/deploy_cloud_run.sh
```

---

## 📱 Android PWA Installation

Aideos Studio ships with a standalone Progressive Web App manifest (`manifest.json`), installable directly on Android devices and Chrome desktops via the **"Install App"** browser prompt.

---

## 📜 License

MIT License — see [LICENSE](LICENSE) for details.
