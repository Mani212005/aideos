# End-to-End Video Pipeline

This document defines the strict, step-by-step pipeline for producing explainer videos using the **Audio-First workflow** and the **aideos Remotion engine**.

---

## Phase 1: Script & Audio (The Foundation)
Everything is driven by the audio track. The video conforms to the audio length, not the other way around.

1. **Script Generation**: Draft the narrative script detailing exactly what will be spoken.
2. **Audio Recording**: The user records the voiceover based on the script.
3. **Audio Setup**:
   - Save the raw audio file into the `public/` directory (e.g., `public/voiceover.mp3`).
   - Determine exact timestamp cues and the total duration.

---

## Phase 2: Visual Storyboarding (The Prototype)
Do **not** write Remotion code or JSON film data until the visual flow is approved.

1. **HTML Storyboard**: Generate an interactive HTML visual storyboard preview (`.lavish/video_storyboard.html`).
2. **Review via lavish-axi**: The user reviews the primitive placements, typography, and scene layouts in their browser.
3. **Feedback Loop**: Iterate purely on the HTML storyboard until the visual sequence and flow are approved.

---

## Phase 3: Writing the Film (The Data)
Once the storyboard is approved, translate the flow into **pure data** for the aideos engine. Both 1920×1080 (Long) and 1080×1920 (Reel) formats will automatically render from this single file.

1. **Create Film Data**:
   - Create a new TypeScript data file in `src/dl/films/<topic>.ts`.
   - **Important**: This file must remain *pure data* with `import type` only. No React or runtime imports.
2. **Define the Canvas & Shots**:
   - **Canvas**: Define the graph of nodes and edges (laid out once, left-to-right).
   - **Shots**: Define the camera shot list referencing node IDs, with durations (`dur`) synced precisely to the audio cues.
   - **Blocks**: Define what text, metrics, or devices appear at each stop, utilizing the 7 animated primitives.
3. **Activate the Film**:
   - Point `src/dl/activeFilm.ts` to your new film file.

---

## Phase 4: Validation & Tweaking (The Engine)
The aideos engine enforces strict design and pacing invariants.

1. **Run Validation**:
   ```bash
   npm run validate
   ```
   This validates the schema, checks pacing rules (e.g., text beats every 90s, no device holds >25s, max 3 accents), and prints a visual runsheet of the timeline.
   *Never skip this step.* Fix any field path errors it throws.

2. **Remotion Studio Sync**:
   ```bash
   npm run studio
   ```
   Open the Remotion Studio. Configure the audio filename in the props panel. Visually adjust `dur` (durations) in the film data to nail the exact sync between the spoken word and the visual stagger.

---

## Phase 5: Rendering (The Output)
Once `validate` passes and Studio looks perfect:

1. **Generate Proofs**:
   ```bash
   npm run frames
   ```
   Generates 17 real stills in `.frames/` to verify both formats.

2. **Final Render**:
   ```bash
   npm run render        # Renders out/long.mp4 (1920x1080)
   npm run render:reel   # Renders out/reel.mp4 (1080x1920)
   ```

---

### Core Principles to Remember
- **Continuous Flow**: No dissected frames or isolated cuts. Build incrementally on existing UI components.
- **Derived Framing**: Never write pixel coordinates. The camera scales and solves its own framing by looking at node boundaries.
- **Order = Stagger**: Timing of elements within a shot is derived purely from their array index order. Do not write manual delays.
- **One Accent**: Keep strictly to the Video Design System's 6-value palette. Use the primary accent max 3 times per frame.