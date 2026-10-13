# P0 verification record

One Iona, one illustrative glider, one backdrop and one receive; three shots at 30 fps. The real resumable run stopped at needs_look and needs_design, then completed both formats with local macOS Samantha narration. Contact was independently bound to catches at frame 108 (3.600 s). Narration is 10.8566 s and picture is 10.8667 s. This uses the pipeline's existing 10-second minimum rather than weakening it to fit a shorter clip.

The approved procedural Iona was promoted unchanged in geometry/face paint/cel style. Orthographic projection replaces the perspective proof. No general retargeter or claim of finished anime craft is included.

## Validation

- Root tests: 824 pass, 0 fail, 3 intentional skips. Root lint, editor build and smoke:studio pass. Both example and actual film validation pass.
- Late timing tests enumerate all timed fields; strict parse/save retains compact actions; missing/tampered art, adapter, reference and SVG resources fail; both-crop geometry, camera-matrix projection and cold/reverse/repeated seeks are covered.
- Editor layer conversion/save/reload preserves the stage and hidden/muted flags; muted narration becomes zero volume. Export refuses an all-hidden visual preview rather than exporting the original film.
- Real editor Player opened Iona. At canonical DPR 1, its stage contact PNG matched all repeated/reverse contacts byte-for-byte. A cold Remotion stage capture matches those Player RGBA pixels exactly.
- Final full-composite parity uses firstmate's approved fallback: direct FilmView with the editor's input props rendered as Remotion stills, compared to Video export stills. Both wide and reel have zero different pixels. This is not a claim that the final full-composite PNG came from the editor Player. Browser AXI refs/canvas were disrupted by Vite and test-generated reloads; two recovery attempts were used.
- Initial real full-Player versus render comparison before drift/caption repairs had RGB MAE 0.06193/255, including rail/driver differences. The final fallback uses identical Chrome/ANGLE and exact equality, without a broad tolerance.

## Mac baseline

macOS 15.6 (24G84), Mac16,12, 10 CPUs, 16 GiB RAM. Installed Google Chrome with ANGLE; exact Three 0.180.0, Fiber 9.4.0, Remotion/ThreeCanvas 4.0.499. Sequential formats, concurrency 2, PNG frames, H.264 CRF 16.

| Format | Render wall seconds | Seconds per second of picture | Peak process-tree RSS | MP4 bytes |
|---|---:|---:|---:|---:|
| long | 39.26 | 3.61 | 2.11 GiB | 1136772 |
| reel | 37.06 | 3.41 | 1.77 GiB | 1140227 |

RSS sampled every 0.5 s across the direct production process tree; this excludes existing editor/desktop processes and GPU driver allocations outside that tree. End-to-end production was 82.58 s including verify. Disk free was 4.15 GiB before, lowest sampled 3.96 GiB, and 4.16 GiB after. Committed art/fixture data stays below 0.1 MB; local MP4 pair is about 2.2 MB. No render, cache or build directory was deleted.

## Review limits

- long: measured review fails camera, skips full v2 look adherence, and persists format-indexed numerical/projected facts with visual craft unmeasured. Gemini 3.8 Flash via agy scored 8/10, REVISE; fixed camera and the approximately 5.9-second held after-state are the reported limits. Captions, readability, no clipping and catch sync pass its hard gates.
- reel: measured review fails camera, skips full v2 look adherence, and persists format-indexed numerical/projected facts with visual craft unmeasured. Gemini 3.8 Flash via agy scored 7.5/10, REVISE; fixed camera and the approximately 5.9-second held after-state are the reported limits. Captions, readability, no clipping and catch sync pass its hard gates.

Those are P0 integration results, not a >=9 finished-explainer acceptance. Purposeful moving camera, broader story motion, full stage look adherence and measured occlusion remain the later approved phases. P1 second-character reuse, P2 full gates, P3 full authoring/review, P4 long film and P5 dots are intentionally absent.

Local evidence is retained under out/stage-p0-evidence/. Personal film state remains under its package, resolved through package helpers. review-long.json and review-reel.json are attached there with Gemini reports, PNG comparisons, seek hashes and baseline JSON. Temporary evidence directories were moved there after capture; original production result paths record where the files were generated.
