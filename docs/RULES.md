<!-- File Description: Project guidelines, editing rules, visual hook standards, and video production workflow gates for Aideos. -->

# Aideos Project Guidelines & Editing Rules

Every AI agent working on the `aideos` project MUST read and adhere strictly to the following core rules:

## 1. The Visual Hook Requirement (First 8-12 Seconds)
* **High-Energy Opening**: The first 8 to 12 seconds of every video composition MUST serve as an intense, visual hook.
* **Flashy Motion Graphics**: Use multi-layer text reveals (`TextReveal` with bold display sizes), fast kinetic typography, strobe/matrix grid accents, dynamic zoom movements, and vibrant color pulses to capture immediate audience attention within the first 10 seconds.
* **Zero Bland Intro**: Never start a video with static text or slow ambient pans. The opening sequence must feel alive, polished, and captivating.

## 2. Multi-Layer Tactile Paper Rip Transitions
* **Organic Paper Tears**: Mind-map transitions between major nodes must use multi-layer paper tearing and ripping visual effects (inspired by Premiere Pro paper editing techniques).
* **Tactile Aesthetics**: Include jagged serrated SVG tear borders, soft off-white paper textures, fractal noise fibers, stop-motion rotation tilts ($-4^\circ$ to $+4^\circ$), and drop shadows.
* **Dynamic Cut Motion**: Replace bare linear pans across empty space with energetic paper rips that bridge topics smoothly.

## 3. Audio & Subtitle Synchronization
* **Voiceover Alignment**: Every shot duration (`dur`) must strictly match the exact synthesized voiceover audio timing.
* **Synchronized Captions**: Always generate and pair VTT subtitle tracks (`captions.vtt`) with the primary audio stream (`voiceover.wav`).

## 4. Video Production Agent Workflow & Gate Rules (MANDATORY)

Every agent producing a video in the `aideos` repository MUST follow this strict 3-stage lifecycle:

### Stage A: Script Storage & FIFO Memory Rotation
1. **Directory Location**: When the user provides a script, store it under the `scripts/` folder (e.g. `scripts/video-script-<name>.txt`).
2. **Git Ignore Requirement**: `scripts/` MUST remain gitignored so user scripts and raw text are never committed to version control.
3. **3-Script FIFO Memory Budget**:
   - The `scripts/` folder MUST hold a **maximum of 3 script files** at any given time.
   - When a new script arrives and the folder already contains 3 scripts, the agent MUST automatically identify and remove the **oldest script file** before saving the new one (First-In, First-Out memory rotation).

### Stage B: Interactive Design & Color Palette Review (`localhost` Dev Server)
1. **Native Localhost Server (NO LAVISH DEPENDENCY)**:
   - The agent MUST NOT use Lavish (`lavish-axi` / `.lavish/`).
   - The agent MUST launch a native `localhost` dev server (e.g. `http://localhost:3005`, `http://localhost:3008`, or `http://localhost:5173` via Vite / Aideos Studio) to present the storyboard prototype, visual node graph layout, and color palette options.
2. **Interactive Selection**: Present the visual theme and color palette choices to the user. The user selects the color palette and requests layout, pacing, or style modifications.
3. **Continuous Connection**: The agent MUST remain continuously connected, listening for real-time user feedback on `localhost`.
4. **DESIGN APPROVAL GATE**: The agent **MUST NOT** proceed to full video generation/composition until the user explicitly confirms and approves the design layout and workflow.

### Stage C: Video Composition & Final Cut Approval (Remotion Studio / Render Player)
1. **Video Composition**: Upon design approval, the agent generates the film composition and launches the video preview on `localhost:3000` / `localhost:3001` in Remotion Studio / render player.
2. **Final Cut Presentation**: Present the rendered video playback directly to the user for visual review of the final cut.
3. **FINAL CUT APPROVAL GATE**: The agent **MUST NOT** download, export, or play final `.mp4` video files until the user explicitly approves the final cut.

## 5. Code Hygiene & Validation Standards
* **Schema Validation**: Run `npm run validate` before rendering to ensure node constraints, durations, and camera look bounds are 100% valid.
* **Linting & Types**: Run `npm run lint` to guarantee clean TypeScript types and zero ESLint errors.
