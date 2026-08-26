# Aideos: Context, Schema, Classes, Functions & Terminology Reference

This document serves as the complete technical context and API dictionary for the Aideos explainer video engine, detailing all schemas, types, classes, functions, design tokens, and components across `src/dl/`, `backend/`, and `editor/`.

---

## 1. Core Film Schema & Data Types (`src/dl/schema.ts`)

### `Film`
The root data contract defining a complete video composition.
* `id: string` (Lowercase kebab-case identifier, e.g. "character-showcase", "what-is-jepa")
* `title: string` (Human-readable video title)
* `fps: number` (Target playback framerate, standard is 30)
* `accent?: string` (Primary brand hex color override, e.g. "#635BFF")
* `theme?: ThemeConfig` (Global paper background, typography, and camera settings)
* `chapters: string[]` (Ordered list of chapter titles for the progress rail)
* `canvas: { nodes: CanvasNode[], edges: CanvasEdge[] }` (The continuous 2D spatial graph)
* `shots: Shot[]` (Ordered chronological sequence of camera shots and visual blocks)
* `voiceover?: { src: string, volume?: number }` (Master audio track source file)

### `Shot`
A single continuous camera view and duration window on the timeline.
* `id: string` (Unique shot identifier, e.g. "shot-intro")
* `ch?: string` (Chapter assignment for chapter rail tracking)
* `dur: number` (Authored duration in seconds; locked by master audio clock $\pm 50\text{ms}$)
* `stage: "anchor" | "frame" | "none"` (Visual staging: "frame"=Hero center stage, "anchor"=grows from canvas node, "none"=empty canvas)
* `look: string | string[] | "all"` (Node ID(s) targeted by the camera viewport)
* `move: "cut" | "pan" | "zoom-in" | "zoom-out" | "hold"` (Camera motion transition)
* `zoom?: number` (Camera optical zoom multiplier, default 1.0)
* `drift?: boolean` (True to apply subtle 100% to 104% scale drift during holds)
* `blocks: Block[]` (Array of visual blocks rendered during this shot)
* `scriptText?: string` (Exact voiceover narration sentence spoken in this shot)
* `visualDirection?: string` (Human/AI visual intent prompt)
* `metaphor?: string` (Assigned visual metaphor ID)
* `needsFootage?: boolean` (Flag indicating AI video b-roll overlay)

### `CanvasNode`
A 2D rectangular concept card on the continuous spatial map.
* `id: string` (Unique node identifier)
* `label: string` (Primary node title)
* `sub?: string` (Secondary subtitle or descriptor)
* `x: number, y: number` (Top-left coordinate in virtual canvas pixels)
* `w: number, h: number` (Width and height bounding box)

### `CanvasEdge`
A directed relationship connection between two canvas nodes.
* `from: string` (Source node ID)
* `to: string` (Target node ID)
* `dashed?: boolean` (True if rendered as dashed connection line)

---

## 2. Visual Block Taxonomy (`src/dl/Block.tsx`, `src/dl/schema.ts`)

Blocks are divided into two strict categories:

### A. Device & Character Blocks (`DEVICE_BLOCKS`)
Interactive, complex visual containers that spend 1 accent token:
* **`CharacterBeat`**: 2-level kinematic SVG character rig (`characterId`, `poses`).
* **`DeviceCard`**: Browser window, code editor, or terminal mockup (`variant`, `title`, `url`).
* **`MetaphorViewer`**: Interactive concept visualizer (KV cache, balance scale, fluid reservoir).
* **`MatrixGrid`**: 2D memory allocation and tensor cell grid (`values`, `rowLabel`, `colLabel`, `sweep`).
* **`TokenStrip`**: Sequence token cards with active highlighting (`tokens`, `lit`, `caption`).
* **`AttentionArcs`**: Directed curved attention links between tokens (`tokens`, `focus`, `links`).
* **`LayerStack`**: 3D isometric neural network layer cards (`count`, `bottomLabel`, `topLabel`).
* **`VectorSpace`**: 2D embedding space with vector points and arrows (`points`, `arrow`, `xLabel`, `yLabel`).
* **`AnalogyInset`**: Full-bleed cinematic video b-roll overlay (`caption`, `framesDir`, `totalFrames`).

### B. Text Beats (`TEXT_BEATS`)
Typography and metric cards that spend 0 accent tokens:
* **`TextReveal`**: Staggered word-by-word kinetic headline typography (`text`, `size`, `accentWord`).
* **`StatCounter`**: High-impact numeric stat with animated counter (`to`, `label`, `suffix`, `format`).
* **`Body`**: Multi-line narrative description text (`text`).
* **`Kicker`**: Small uppercase tracking eyebrow tag above headlines (`text`).
* **`MathLine`**: Mathematical formula rendered in Source Serif italic (`text`).
* **`ProgressBar`**: Chapter progress indicator (`value`, `label`).
* **`IconLabel`**: Icon with text label (`text`).

---

## 3. Pure TypeScript Character Rigs (`src/dl/characters/`)

### `CharacterRig`
Interface defining a modular vector rig:
* `id: string` ("astronaut" | "developer")
* `name: string` ("Astro Guide" | "Tech Architect")
* `description: string` (Short visual description)
* `viewBox: string` (SVG viewBox string, e.g. "0 0 200 320")
* `groups: CharacterGroup[]` (Hierarchy of limbs and joint groups)

### `CharacterGroup`
A single poseable limb or joint container:
* `id: string` ("torso" | "head" | "leftArm" | "rightArm" | "legs")
* `parent?: string` (Parent group ID for 2-level hierarchical transforms, e.g. "torso")
* `pivot: { x: number, y: number }` (Rotational hinge anchor coordinate)
* `defaultRotation?: number` (Rest angle in degrees)
* `paths: CharacterPath[]` (Array of SVG vector paths)

### `CharacterPath`
An individual vector path inside a limb:
* `d: string` (SVG path data definition)
* `fill?: SemanticToken` ("surface" | "ink" | "muted" | "hairline" | "accent" | "canvas" | "none")
* `stroke?: SemanticToken` ("surface" | "ink" | "muted" | "hairline" | "accent" | "canvas" | "none")
* `strokeWidth?: number` (Stroke thickness in pixels)

### `POSE_PRESETS` (`src/dl/characters/presets.ts`)
8 built-in one-click gesture configurations:
* `neutral`: Rest posture, attentive listening.
* `present-right`: Body tilted $-4^\circ$, left arm $-35^\circ$, right arm $+20^\circ$ pointing right.
* `present-left`: Body tilted $+4^\circ$, left arm $+20^\circ$, right arm $-35^\circ$ pointing left.
* `think`: Body tilted $-2^\circ$, head $+8^\circ$, right hand to chin at $-65^\circ$.
* `shrug`: Both arms raised at $-45^\circ$ and $+45^\circ$, head $+6^\circ$.
* `wave`: Right arm raised $+85^\circ$ with $+15^\circ$ wave flick.
* `crossed-arms`: Left arm $-40^\circ$, right arm $+40^\circ$ crossed over chest.
* `celebrate`: Both arms raised high at $+110^\circ$ and $-110^\circ$.

---

## 4. Camera & Spatial Coordinates Engine (`src/dl/camera.ts`)

| Function | Signature | Description |
| :--- | :--- | :--- |
| `buildTimeline(film, targetDur)` | `(Film, number?) => TimedShot[]` | Builds linear frame timeline, assigning start frame `from`, end frame `to`, and frame counts. |
| `camAt(film, timeline, frame, viewport)` | `(Film, TimedShot[], number, Size) => Cam` | Solves continuous camera position $(x, y)$ and zoom factor at any exact frame. |
| `shotAt(timeline, frame)` | `(TimedShot[], number) => TimedShot` | Returns the active shot and chapter metadata at the current playhead frame. |
| `lookBox(film, shot)` | `(Film, Shot) => Box` | Calculates bounding box enclosing all nodes targeted by the shot's `look` parameter. |
| `projectBox(box, cam, viewport)` | `(Box, Cam, Size) => Box` | Projects 2D world-space coordinates into 2D screen-space pixel coordinates. |
| `totalFrames(timeline)` | `(TimedShot[]) => number` | Returns total frame count across all shots in the timeline. |

---

## 5. Design System Tokens (`src/dl/tokens.ts`, `src/dl/motion.ts`)

### `PALETTE`
The strict 6-color semantic palette tokens:
* `canvas`: `#0A0A0B` (Deepest canvas background layer)
* `surface`: `#101013` (Raised card surface background)
* `ink`: `#F5F5F5` (High-contrast typography text)
* `muted`: `#8A8A8E` (Secondary captions, subtitles, and labels)
* `hairline`: `rgba(245, 245, 245, 0.10)` (Subtle borders and separators)
* `accent`: `#635BFF` (Default brand focus color)

### `BACKGROUND_THEMES`
Pre-built tactile paper backgrounds:
* `paper-white`: Archival textured paper with organic fiber lighting (`#F8F6F0`).
* `parchment`: Warm academic manila cream paper with aged grain (`#F4EFEA`).
* `blueprint`: Deep cyan engineering blueprint grid (`#0B2545`).
* `charcoal`: Dark tactile slate paper with crisp silver ink (`#121214`).
* `dot-grid`: Minimalist precision dot matrix on crisp surface (`#FAF9F6`).
* `smooth-dark`: Studio deep matte dark presentation (`#0A0A0B`).

### `EXPO` Motion Token (`src/dl/motion.ts`)
* `EXPO = [0.16, 1, 0.3, 1]`: Native ease-out-expo cubic-bezier easing curve ensuring high initial velocity and soft, organic landing.

---

## 6. Backend Produce & Validation Engine (`backend/`, `src/dl/validateFilm.ts`)

### `backend/audio.ts`
* `synthesizeSegment(text, outPath, options)`: Calls Deepgram Aura or Edge-TTS to produce audio for a single sentence.
* `concatAudioWithGaps(segments, gapSec, outPath)`: Merges audio clips with 200ms fixed pause buffers via FFmpeg concat filters.
* `alignWordTimestamps(audioPath, scriptText)`: Extracts word-level start/end timestamps for captions.
* `buildFilmFromAudioResult(treatment, audioResult)`: Compiles verified audio durations into a structured `Film` object.

### `backend/sync.ts`
* `runSemanticVisualSync(film, captions)`: Evaluates spoken words against visual device blocks.
* `matchShotVisual(segmentText, chapter)`: Determines whether a shot uses `CharacterBeat`, `DeviceCard`, `StatCounter`, or `TextReveal`.

### `src/dl/validateFilm.ts`
* `validateFilm(film)`: Runs Zod schema parsing and structural integrity assertions.
* `validatePacingInvariants(film)`: Enforces max 25s hold, no consecutive device repeats, and text breathers every 60-90s.
* `validateFilmAudioAndAssets(film, projectDir)`: Enforces duration sum invariant ($\sum \text{Shots} = \text{Audio} \pm 50\text{ms}$) and confirms audio asset presence.

---

## 7. Interactive Web Studio Components (`editor/src/components/`)

* **`ShotModal.tsx`**: 80% screen pop-up for visual mode switching, one-click gesture posing (`Wave`, `Point`, `Think`, `Celebrate`), and narration editing.
* **`Styleboard.tsx`**: Storyboard gallery with live scene cards, 3D perspective toggles, and background canvas pickers.
* **`MindMap.tsx`**: 2D infinite spatial canvas for dragging and connecting nodes.
* **`TimelineEditor.tsx`**: Multi-track visual timeline with audio waveforms and playhead scrubbing.
* **`CustomizationEditor.tsx`**: Studio theme customizer for paper textures, typography, and script-to-metaphor director.
* **`ScriptEditor.tsx`**: Structured chapter and script text writer with instant voiceover generation.
* **`KineticCaptionEditor.tsx`**: Word-level subtitle editor with live frame seeking.
