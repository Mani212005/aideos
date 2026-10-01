<!-- File Description: Project guidelines, editing rules, and video production workflow gates for Aideos. -->

# Aideos Project Guidelines & Editing Rules

Every AI agent working on the `aideos` project MUST read and adhere strictly to the following core rules:

## 1. Audio & Subtitle Synchronization
* **Voiceover Alignment**: Every shot duration (`dur`) must strictly match the exact synthesized voiceover audio timing.
* **Synchronized Captions**: Captions must be burned in at the bottom of the video, paired with the primary audio stream (`voiceover.wav`).

## 2. Video Production Agent Workflow
### Stage A: Script Storage & Package Isolation
1. **Directory Location**: When the user provides a script, store it under the self-contained package folder as `videos/<slug>/script.md`.
2. **Git Ignore Requirement**: `videos/*/script.md`, `videos/*/footage/`, and `videos/*/voiceover.wav` MUST remain gitignored so local screenplay text, raw voiceover, and footage artifacts are never committed to version control.
3. **Package Isolation**: Each project maintains its own isolated workspace under `videos/<slug>/` containing `film.json`, `script.md`, `voiceover.wav`, `voiceover_words.json`, `footage/`, and `visuals/`.

### Stage B: Video Composition
1. **Video Composition**: Upon design approval, the agent generates the film composition and launches the video preview on `localhost:3000` / `localhost:3001` in Remotion Studio / render player.
2. **Final Cut Presentation**: Present the rendered video playback directly to the user for visual review of the final cut.
3. **FINAL CUT APPROVAL GATE**: The agent **MUST NOT** download, export, or play final `.mp4` video files until the user explicitly approves the final cut.

## 3. Code Hygiene & Validation Standards
* **Schema Validation**: Run `npm run validate` before rendering to ensure node constraints, durations, and camera look bounds are 100% valid.
* **Linting & Types**: Run `npm run lint` to guarantee clean TypeScript types and zero ESLint errors.
