# End-to-End Video Pipeline (Upgraded)

This document defines the strict, step-by-step pipeline for producing explainer videos using the **Audio-First workflow** and the **aideos Remotion engine**, enhanced with automated alignment and structured canvas authoring.

---

## Phase 1: Script, Audio & Alignment (The Foundation)
Everything is driven by the audio track. Timing is derived programmatically from the recorded speech.

1. **Script Generation**: Draft the narrative script detailing exactly what will be spoken.
2. **Audio Recording**: The user records the voiceover based on the script.
3. **Automated Alignment**:
   - Run the recorded audio through WhisperX (or `faster-whisper` + forced-aligner) to extract word-level timestamps (`{word, start, end}`).
   - Emit an auto-SRT/VTT file as a byproduct for accessibility captions and sync debugging.
4. **Draft Durations**: Feed the alignment output directly into the initial film `dur` (duration) fields, creating a highly accurate first-pass draft based on real speech timing.

---

## Phase 2: Structured Canvas & Film Data (The Blueprint)
*This replaces the old static HTML storyboard. The storyboard and film-data authoring are unified.*

1. **Structured Canvas (JSON)**: We use a structured, shape-based canvas (like tldraw). Shapes are saved as JSON (position, size, type, text), not pixels.
2. **Pre-populate Layouts**: The agent programmatically pre-populates the canvas with rough shapes (text beats, placeholders) derived directly from the script/shot list by writing JSON. No vision models or GUI drawing tools required unless decoding a custom freehand doodle.
3. **Structured Metadata**: Directives are attached to shape metadata (e.g., `openAt: 5`, `motion: "spin"`, `holdUntil: 12`) instead of relying on parsed freehand text.
4. **Extraction to Pure TS**:
   - Run the extraction script: **Canvas Shape JSON → Film-Data TS**.
   - This script generates the final `src/dl/films/<topic>.ts` file containing the canvas graph, shot list, and blocks.
   - **Crucial Invariant**: The resulting film file must remain **pure data** (`import type` only, no React or runtime imports) so it remains LLM-editable and diffable.
5. **Activate the Film**: Point `src/dl/activeFilm.ts` to the newly generated data file.

---

## Phase 3: Motion Primitive Layer (The Animation)
Animations are formalized and referenced directly in the film data blocks (e.g., `motion: "curl"`).

1. **Standard Motion**: Use Remotion's native `interpolate()` and `spring()` for simple fades, slides, and basic easing.
2. **Complex 2D Motion (GSAP Bridge)**: Utilize the `useGsapFrame` hook to bridge GSAP timelines to Remotion's deterministic `useCurrentFrame()`. This unlocks GSAP plugins like MorphSVG, DrawSVG, and custom eases.
3. **True 3D Spatial Motion**: Use `@remotion/three` for genuine 3D effects (axis spins, real space curls, folds) rather than faking it with 2D transforms.
4. *(Optional) Visual Keyframing*: Evaluate Theatre.js to visually author and tweak these 3D/expressive curves by eye.

---

## Phase 4: Validation & Tweaking (The Engine)
The aideos engine enforces strict invariants through comprehensive checks.

1. **Run Validation**:
   ```bash
   npm run validate
   ```
   This performs:
   - **Schema & Pacing Checks**: Validates against a shared Zod/JSON-Schema contract. Enforces text beats every 90s, no device holds >25s, and max 3 accents.
   - **Sync-Drift Validation**: Flags any manual `dur` tweaks that drift meaningfully from the WhisperX aligned word-timestamp span.
   - **Dual-Format Safe-Zone Check**: Ensures content stays within the un-cropped safe margins for both 1920×1080 (Long) and 1080×1920 (Reel).
2. **Aideos Studio Tweaking**:
   ```bash
   npm run editor
   ```
   Preview the draft and apply manual polish to the timing (`dur`), canvas nodes, and layout where necessary.

---

## Phase 5: Rendering & Performance (The Output)
Prioritize rendering performance and output verification.

1. **Performance Checklist (CI/Validate)**:
   - Ensure all assets are preloaded via `staticFile`.
   - Ensure components are memoized properly to avoid re-renders.
   - Offload heavy computation to workers to fix low fps in Studio.
2. **Generate Proofs**:
   ```bash
   npm run frames
   ```
   Outputs 17 test frames of both Aspect Ratios to `.frames/`.
3. **Final Render**:
   ```bash
   npm run render        # Renders out/long.mp4 (1920x1080)
   npm run render:reel   # Renders out/reel.mp4 (1080x1920)
   ```

---

### Core Principles to Remember
- **Continuous Flow**: Build incrementally on existing UI components. No disconnected cuts.
- **Derived Framing**: The camera scales and solves its own framing based on node coordinates. Never write hard pixels.
- **Order = Stagger**: Timing of elements in a shot is purely derived from array index order.
- **One Accent**: Keep to the 6-value palette. Max 3 accents per frame.