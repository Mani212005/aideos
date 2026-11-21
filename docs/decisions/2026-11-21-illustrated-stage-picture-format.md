<!-- File Description: Decision record that the illustrated stage format is one generated plate plus about 8 pictures on the one stage, with SVG keeping all text and motion. -->

# Illustrated stage: one plate and about 8 pictures, SVG keeps all text and motion

- **Date**: 2026-11-21 (day the phase 1 pull request merged; the owner approved it the evening before)
- **Status**: In force (phase 1 only)
- **Decided by**: owner, in his own words: "This is the single most awesome thing I have ever seen, 1000% add these change use claude, neon, sol which ever model you like and build this for me. I really want this." He chose option A of the mixed-media research.
- **Pull requests**: https://github.com/Mani212005/aideos/pull/248 (picture layer), https://github.com/Mani212005/aideos/pull/254 (cut reel resolves pinned pictures)

## Context

Design files accepted SVG only, the native renderer refused raster images, and a PNG wrapped inside an SVG worked only on the slower Remotion path while slipping past the palette design check. A mixed-media research task laid out three options for adding generated pictures to films.

## Decision

Build phase 1 of the "illustrated stage". A film gets one generated background plate for the whole film plus about 8 generated objects with transparent backgrounds. They stay on the one stage and change like today's SVG props. SVG keeps every word, number, label, line, arrow and all motion. Rules: no text inside generated images, no picture per scene, abstract objects only, no people, no logos, no named brands or artists, one style paragraph per film pasted into every prompt, original files and provenance data are kept, and watermarks are never stripped. Phase 2 (picture motion such as parallax, masks and blend modes) is out of scope.

Mechanics that came with it: a fingerprinted image cache like the per-line voice cache (a rebuild with unchanged prompts makes no request), each approved image pinned by sha256 in the design so a render is as repeatable as an SVG render, a new versioned `aideos.render.3` IR, native and Remotion drawing of pictures, and design check rules for provenance, prompts, the palette and OCR text in images. A film whose pictures the native renderer cannot draw falls back to Remotion visibly instead of failing.

## Why

The owner wants the look. Keeping all text, numbers and motion in SVG keeps the film exact, checkable and repeatable, while pictures supply texture the SVG cannot. Generated images are made on the owner's Mac (Linux cannot make them), so the aideos code only carries, checks and draws them. No paid cloud service or image API is used.

## Alternatives rejected

- **Option B: plates only.** Same phase 1 code with 2 images per film: lowest risk and a smaller gain in look. Not chosen.
- **Option C: stay SVG only.** Then only the latent fault (a PNG inside an SVG passes the design check but fails in the native renderer with no fallback) would be fixed. Not chosen.
- **A picture per scene.** Rejected: it breaks the one continuous stage.
- **Text inside generated images.** Rejected: words stay in SVG so they are exact and checkable.

## Where it lives now

- `backend/pictures/` (cache, prompt policy, `aideos pictures` command), `backend/designCheck/pictures.ts`.
- `docs/GOOD_VIDEO.md`, `docs/NATIVE_RENDERER.md` and `docs/RENDER_IR.md` describe the picture layer and its rules.
- Remaking the full Signal-encryption film (long and reel) in this format is the owner's acceptance test and was outside the phase 1 pull request.
