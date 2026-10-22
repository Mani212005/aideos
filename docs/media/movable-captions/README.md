# Movable caption proof

Real film `speculative-decoding-designed`, frame 45. The after images use positions moved,
resized and locked through the studio. Font size is unchanged. These images are for visual
acceptance by the owner.

| Format | Before | Moved and resized |
| --- | --- | --- |
| Wide | ![Wide before](wide-before.png) | ![Wide after](wide-after.png) |
| Reel | ![Reel before](reel-before.png) | ![Reel after](reel-after.png) |

Eight default-film stills across four fixture films and both formats matched their references
with zero differing pixels. J13 verifies both scopes, move, resize, lock, reset, undo and reload,
then checks native Player caption ink bounds against PNG and MP4 export within 2 px.

The original fixture narration is unavailable. Separate 10-second MP4 excerpts used disposable
tone audio, which is not committed. Measured review passes the placed-caption gate in both
formats (Wide 60%, Reel 80% coverage, no over-two-line frames), but fails overall on audio sync
and Reel readability. Gemini CLI returns REVISE for both: its deterministic placed-card caption
gate fails Wide at 67% coverage and passes Reel at 75%. Tone audio and truncated storyline also
limit those reviews. These are placement measurements, not quality-approved films.

Review thresholds are unchanged. Calibration could not run without the external
`AIDEOS_CALIBRATION_A`, `AIDEOS_CALIBRATION_B` and `AIDEOS_CALIBRATION_RAG` reference paths.

No-mistakes risk level: High, covering schema, rendering, owner persistence, gestures, review
and checked AI editing. Automatic placement, suggestions, CTA and reel-length changes remain
outside this change.
