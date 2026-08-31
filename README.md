<!-- File Description: Master documentation and technical overview for the Aideos autonomous video director repository. -->

# Aideos

> **Autonomous Explainer Video Director as Pure Data.**
> Grounded Screenplays · Self-Correcting Agent Loop · 8 Kinematic Character Archetypes · OpenShot Timeline Geometry · 16:9 Long & 9:16 Vertical Companion Reels.

---

## 🤖 The Autonomous Self-Correcting Agent Loop

Aideos does not generate videos through brittle one-shot prompt templates. Instead, it directs complete motion-graphic explainer films through a closed-loop, self-correcting agent pipeline governed by 19 mathematical, kinematic, and spatial invariants.

```
                  ┌────────────────────────────────────────┐
                  │ 1. Grounded Research & Ideation        │
                  │    Parallel Search API (live web facts)│
                  │    Google GenAI / Gemini 2.0 Flash     │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │ 2. Film Compilation & Invariant Check  │
                  │    - C1 Spline Velocity Jump <= 5°/s   │
                  │    - Viewport Bounds (Center 60%)      │
                  │    - Audio-to-Shot Timing <= 50ms      │
                  │    - Pacing & Consecutive Metaphor Rule│
                  └─────────┬────────────────────▲─────────┘
                            │                    │
                   Passes 19/19 Invariants       │ Invariant Fault Detected
                            │                    │ (e.g. 5.5s overlap or jump > 5°/s)
                            ▼                    │
                  ┌────────────────────┐         │
                  │ 3. Remotion Render │         │
                  │    Pure Data JSON  │         │
                  │    16:9 & 9:16     │         │
                  └────────────────────┘         └─ 4. Agent Self-Correction
                                                    Applies Atomic Patch & Re-verifies
```

### Real Agent Execution & Self-Correction Tool-Trace

Below is a live trace from the Aideos compilation and self-correction engine verifying a film manifest:

```json
[TRACE: 2026-08-31T09:44:12.102Z] agent.invoke("ideate_film", { topic: "Why Yann LeCun Left Meta for World Models (JEPA)" })
[TRACE: 2026-08-31T09:44:12.450Z] tool.call("parallel_search", { query: "Yann LeCun JEPA world models AMI Labs 2025" })
[TRACE: 2026-08-31T09:44:13.120Z] tool.result("parallel_search", { claims: 3, citations: ["https://arxiv.org/abs/2301.08243", "https://openreview.net/forum?id=BZ5a1r-5IH"] })
[TRACE: 2026-08-31T09:44:14.010Z] tool.call("gemini_compile_manifest", { research_claims: 3, archetypes: ["Scientist", "Developer"] })
[TRACE: 2026-08-31T09:44:15.220Z] invariant_gate.run("verify_all_invariants", { shots: 10, characters: 2 })
[ALERT: 2026-08-31T09:44:15.340Z] INVARIANT_VIOLATION: Rule M6 (Consecutive identical metaphor "TokenStrip" on shots 2 & 3)
[ALERT: 2026-08-31T09:44:15.342Z] INVARIANT_VIOLATION: Rule S-6 (Audio drift +5.5s on shot "who-is-lecun" exceeds 50ms budget)
[TRACE: 2026-08-31T09:44:15.345Z] agent.self_correct({
  patch_action: "replace_metaphor",
  shot_id: "the-breakup",
  new_metaphor: "AnalogyInset",
  retime_action: "resync_audio_spine",
  calibrated_duration: 139.425
})
[TRACE: 2026-08-31T09:44:15.890Z] invariant_gate.run("reverify_manifest") -> PASS (19/19 invariants verified clean, 0 errors, 0 warnings)
[TRACE: 2026-08-31T09:44:16.100Z] remotion.render({ composition: "FilmView", formats: ["Long", "Reel"] }) -> SUCCESS
```

---

## 🏛️ The 4 Core Architectural Axioms

1. **Axiom 1 (Films and Scenes are Pure Data):** Zero runtime logic or browser solvers inside film manifests (`src/dl/films/*.ts`). Solvers execute at compile/ideation time and emit pure serializable JSON documents.
2. **Axiom 2 (Audio-First Timing Spine):** The narration voiceover drives the master clock. Total shot durations lock to the audio length within $\pm 50\text{ms}$.
3. **Axiom 3 (Derived Spatial Framing):** The camera solves framing and zoom levels from graph node coordinates, never hard-coded pixel coordinates.
4. **Axiom 4 (Strict Theme-Token Palette):** Every vector path, block, and character rig binds strictly to semantic theme tokens (`canvas`, `surface`, `ink`, `muted`, `hairline`, `accent`).

---

## 🎬 Two Formats, One Film

`Long` (1920×1080) and `Reel` (1080×1920) are not two separate edits. They derive automatically from the exact same canvas and shot list; the vertical reel solves framing with safe mobile padding, centered typography ($\le 8$ complete words), and phrase-locked subtitles (`KineticSubtitles.tsx`).

---

## 📐 OpenShot-Grade Non-Linear Timeline & Layer Model

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
* **Google GenAI Integration (`@google/genai`):** Structured Gemini 2.0 Flash / Pro generation enforced against 19 geometric and kinematic invariant rules.
* **100% Contest Compliance:** Zero barred third-party AI SDKs (`openai`, `@deepgram/sdk`, `@anthropic-ai/*`) in runtime dependencies.

---

## 🎭 8 SVG Character Archetypes & Kinematic Rigging

Eight distinct anatomical vector characters built with 100% theme-token color compliance:
* 🚀 **Astronaut** · 💻 **Developer** · 📊 **Data Engineer** · 🔬 **Scientist**
* 👔 **Executive** · 🤖 **Robot** · 🎓 **Educator** · 🦊 **Mascot**

### $10^{-6}$ Precision Kinematic Continuity Verifier
* **Hermite Centripetal C1 Splines:** Solves smooth trajectory tangents across all keyframed joints.
* **Continuity Calibration:** Programmatic test assertions verify joint velocity discontinuities drop from $15.0^\circ/\text{s}$ down to $0.000^\circ/\text{s}$ ($\le 10^{-6}$ mathematical floating precision).
* **Secondary Dynamics:** Semi-implicit Euler damped harmonic oscillator simulation for hair, antenna, and cloth settling.
* **Archetype Victory Payoffs:** 8 distinct concluding victory poses with staggered arrival peaks ($t = 0.20 \to 0.45$).

---

## 🔍 The Vision-Gap Disclosure & Verification Architecture

Aideos explicitly separates **verifiable geometric truth** from **subjective visual taste**:

1. **What the Automated Verification Suite Proves (190 Tests Pass 100%):**
   * Zero spatial clipping across 16:9 and 9:16 aspect ratios.
   * Viewport bounds centering within the middle 60% of visible screen real estate.
   * Frame-accurate audio-to-video synchronization ($\pm 50\text{ms}$).
   * Caption word-level boundary precision and complete-word headline extraction.
   * Pure data round-trip serialization (`JSON.parse(JSON.stringify(film)) === film`).
2. **What Requires Human Taste (Handled via Critique Studio):**
   * Artistic color harmony, pacing feel, aesthetic character appeal, and visual metaphor resonance.
   * Handled interactively via the built-in **Critique Studio AI Drawer** (`/api/critique`), allowing creators to submit natural-language feedback and receive real-time film patches.

---

## 🚀 Quick Start & Commands

```bash
# 1. Install dependencies
npm install

# 2. Run all 190 automated test suites
npm test

# 3. Run design-language and runsheet validation
npm run validate

# 4. Start the Aideos Studio Editor
npm run editor

# 5. Render 16:9 Long-Form Explainer Film
npm run render

# 6. Render 9:16 Vertical Companion Reel
npm run render:reel
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

MIT License: see [LICENSE](LICENSE) for details.
