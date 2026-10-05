<!-- File Description: Master documentation and technical overview for the Aideos autonomous video director repository. -->

# Aideos

> **Autonomous Explainer Video Director as Pure Data.**
> Grounded Screenplays · Continuous Vector Scenes · OpenShot Timeline Geometry · 16:9 Long & 9:16 Vertical Companion Reels.

---

## 🎬 Two Formats, One Film

`Long` (1920x1080) and `Reel` (1080x1920) are not two separate edits. They derive automatically from the exact same canvas and shot list, sharing safe-area padding and phrase-locked bottom kinetic subtitles (`KineticSubtitles.tsx`) using the active theme accent token.

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
   * Multi-clip drags, linked audio-video trims, or ripple edits share a single transaction UUID.
   * Magnetic ripple editing (toggle via `R` key) auto-shifts downstream clips to close or prevent dead gaps.
   * Universal `Cmd + Z` / `Cmd + Shift + Z` undoes/redoes multi-clip gestures as a single atomic step.
3. **Sticky Snapping with Self-Ignore:**
   * Excludes the dragged clip from its own boundaries (`_snap_ignore_ids`).
   * Holds lock onto snap anchors until mouse delta exceeds a 12px threshold.
4. **Explicit Drag State Machine:**
   * Disjoint states (`idle`, `move`, `trim-start`, `trim-end`, `scrub`, `marquee`) with clean entry/exit hooks.
5. **Pending Overrides Preview Layer:**
   * 60 FPS live preview during mouse dragging without committing to the persistent document until mouse release.

---

## 📦 Per-Video Package Architecture & Custom SVG Engine

1. **Self-Contained Video Packages (`videos/<slug>/`):**
   * Each explainer video is packaged in a self-contained directory containing `film.json`, `script.md`, `voiceover.wav` + `voiceover_words.json`, `footage/` (GPU B-roll clips), `visuals/`.
   * Your videos stay out of git: `videos/` is gitignored (set `AIDEOS_VIDEOS_DIR` to keep them anywhere), and only `examples/hello-scene/` ships so a fresh clone renders something. See `videos/README.md`.
   * Discovered and loaded dynamically at runtime via the unified loader `src/dl/videoPackageLoader.ts`.
2. **Custom Animation (`src/dl/scene/`):**
   * Static animatable `.svg` scene assets.
   * Declarative custom SVG animation engine (`src/dl/scene/`) drives element-level motion (translations, scale, rotate, opacity, drawOn, line endpoints) with audio-first retiming. See [src/dl/scene/README.md](src/dl/scene/README.md).

---

## 🚀 Quick Start & Commands

```bash
# 1. Install dependencies
npm install

# 2. Run fast automated test suite
npm test

# 3. Start the Aideos Studio Editor
npm run editor

# 4. Render 16:9 Long-Form Explainer Film
npm run render

# 5. Render 9:16 Vertical Companion Reel
npm run render:reel

# 6. Auto-prompt a complete film from a prompt (LLM director plans and produces end to end)
npm run backend -- direct "Why attention scales quadratically" --broll --formats long,reel

# 7. Run end-to-end production pipeline from an existing screenplay (intake -> narrate -> design -> b-roll -> assemble -> render -> verify)
npm run backend -- film --script-file videos/my-video/script.md --title "My Video" --slug my-video --broll --formats long,reel

# 8. Start Model Context Protocol (MCP) server
npm run backend -- mcp

# 9. Run deterministic quality review checks on a rendered video
npm run review -- videos/speculative-decoding/renders/long.mp4

# 10. Run Gemini 3.8 Flash video quality review (9.0+ bar)
aideos gemini-review videos/speculative-decoding/renders/long.mp4

# 11. Full check of the long cut AND the reel in a background agent (own tmux window): render, measured review,
#     Gemini review, fix, repeat; reports the scores and final videos (also the `all-check` skill)
aideos all-check speculative-decoding [--reference ref.mp4] [--rounds 6] [--target 9.0] [--agent claude|agy] [--model <id>]
#     (models come from aideos.config.json: Claude Sonnet 5.5 generates, Gemini 3.8 Flash reviews)
aideos all-check wait speculative-decoding
```

See [docs/PRODUCTION_PIPELINE.md](docs/PRODUCTION_PIPELINE.md), [docs/DIRECTOR_GUIDE.md](docs/DIRECTOR_GUIDE.md), and [docs/REVIEW.md](docs/REVIEW.md) for full production, direction, and review documentation.

---

## 📱 Android PWA Installation

Aideos Studio ships with a standalone Progressive Web App manifest (`manifest.json`), installable directly on Android devices and Chrome desktops via the **"Install App"** browser prompt.

---

## 📜 License

MIT License: see [LICENSE](LICENSE) for details.
