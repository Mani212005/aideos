# Aideos Project Guidelines & Editing Rules

Every AI agent working on the `aideos` project MUST read and adhere strictly to the following core rules:

## 1. The Visual Hook Requirement (First 8–12 Seconds)
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

## 4. Code Hygiene & Validation Standards
* **Schema Validation**: Run `npm run validate` before rendering to ensure node constraints, durations, and camera look bounds are 100% valid.
* **Linting & Types**: Run `npm run lint` to guarantee clean TypeScript types and zero ESLint errors.
