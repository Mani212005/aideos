<!--
File Description: This file defines the core guidelines, coding principles, and rules for AI agents working in this repository.
-->

# Agent Guidelines & Coding Standards

## Core Rules

1. **File Header Description**: Every file created or updated must have a header description at the very top explaining what the file does and its purpose.
2. **Function Documentation**: Every function written must have a clear, one-line comment preceding it that explains what the function is for.
3. **No Long Dashes**: Never use long dashes (such as em dashes — or en dashes –) anywhere: in code, UI text, video text, comments, documentation, or agent messages. Always use standard hyphens (-), colons (:), or parentheses ().
4. **Video Design System Standard**: All videos created must strictly follow the specification defined in [src/dl/README.md](src/dl/README.md). This includes:
   - **Color Palette**: 6-value palette (#0A0A0B canvas, #F5F5F5 text primary, #8A8A8E text muted, #635BFF accent max 3x/frame, rgba(245,245,245,.10) hairline depth, #101013 surface).
   - **Typography**: Geist for voice/narrative, JetBrains Mono for all system/code/numbers.
   - **Motion Easing**: Ease-out-expo cubic-bezier(0.16, 1, 0.3, 1) for all transitions.
   - **7 Animated Primitives**: TextReveal, StatCounter, CodeBlock, Card, Divider, IconLabel, ProgressBar.
   - **Single Canvas Model**: 2D infinite spatial canvas with continuous camera motion and wide payoff zooms.
5. **Great Coding Principles & Refinement**:
   - Perform quality and refinement checks to verify code logic and appearance.
   - Maintain clean, modular, well-structured, and readable code.
   - Implement robust error handling, defensive checks, and input validation.

## Video Production & Animation Workflow

1. **Audio-First Pipeline**:
   - **Script Generation**: First, draft or refine the script detailing exactly what will be spoken in the video to communicate the core concept clearly.
   - **Voice Recording Phase**: Present the script to the user and prompt/guide them to record the audio narration.
   - **Audio Analysis & Timing**: Receive the recorded audio track, determine its exact duration and timestamp cues, and lock the video timeline to the audio length.

2. **Mandatory Visual Storyboarder Preview**:
   - **No Immediate Remotion Render**: Before writing complex Remotion/React code or rendering final MP4s, generate an interactive HTML visual storyboard preview (e.g. `.lavish/video_storyboard.html`).
   - **Interactive Storyboard Review**: Launch the storyboard via `lavish-axi` so the user can visually review scene layouts, typography, 2D canvas motion, color tokens, and primitive placements in their browser before full execution.
   - **Feedback & Iteration**: Apply any visual or structural feedback on the storyboard first, and only proceed to Remotion code generation once the user approves the preview.

3. **Continuous Flow & Chained Component Addition**:
   - **No Dissected Frames**: Videos must remain continuous and fluid. Never jump between disconnected static frames or isolated cuts.
   - **Incremental Component Chaining**: Base components must stay on screen and evolve. Add new elements, inputs, layers, or cards onto existing components progressively as the explanation advances (e.g. empty UI state -> typed input -> loading state -> resultant data card).
   - **Seamless Visual Progression**: Maintain persistent UI contexts so viewers experience a unified visual story that builds naturally.

4. **Strict Audio-Visual Synchronization**:
   - **Depict Spoken Words**: Every visual cue, animation, and graphic element must directly depict and reflect what is being spoken in the narration at that precise second.
   - **Precise Cue Syncing**: Align visual triggers, highlight effects, and component additions directly with the voiceover audio timestamps.

## Maintaining this file
- This file is managed by agents. Add rules only when a task produces durable, project-intrinsic knowledge useful to almost every future session.
- Keep it concise. Prefer pointers to authoritative files over copying details.
- When updating, check if this section exists and add it if missing.



