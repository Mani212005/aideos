# Render jobs

`backend/renderJob.ts` owns the renderer-independent lifecycle:

`queued -> preparing -> rendering -> mastering -> probed -> done`

Every nonterminal state can fail or be cancelled. Terminal states cannot be re-entered or changed.
Calling `run()` again returns the same execution. `cancel()` aborts the backend, waits for teardown,
and removes the partial video, render sidecar and mastering report. Cleanup runs once.

The job copies its input film, checks delivery requirements and pending B-roll, prepares retimed
audio, asks the backend to check its disk budget, renders, masters audio, probes the finished file,
then writes `<output>.render.json`. That sidecar records the prepared film's canonical SHA-256 hash,
requested profile policy, the renderer that drew the file (`renderer`: `native` or `remotion`), a per-setting `profileSettingsApplied` map, and probed video stream facts
(codec, pixel format and color range). This is input provenance, not an acceptance verdict or a hash
of external footage, fonts or audio assets.

`RENDER_PROFILES` is the shared policy table for `draft`, `review` and `final`. All currently request
lossless intermediates, H.264 CRF 16, limited-range yuv420p and AAC at 320 kbps. The native
renderer consumes this data directly ([NATIVE_ENCODE.md](NATIVE_ENCODE.md)). The Remotion adapter expresses that policy for every caller
through `FINAL_ENCODE_FLAGS` in `backend/pipeline/render.ts` (PNG frames, h264, CRF 16, yuv420p,
AAC 320k), so its sidecar reports `profileSettingsApplied` true for each setting, alongside the
actual probed stream facts. Extra arguments passed to `npm run render` follow those flags and can
override them without the sidecar noticing.

The `Renderer` interface accepts film data, a format, output path, profile and optional frame range.
Its context contains an `AbortSignal` and an output callback. It prepares backend resources, checks
its own measured disk budget, encodes, and releases resources. A Rust, Skia or ffmpeg implementation
can replace this interface without changing lifecycle states or importing capture-framework types.
The existing audio and probe functions are default services; tests use short synthetic services and
encoders through the same public interface.

Every caller hands the job `createSelectedRenderer` (`backend/rendererSelection.ts`), which chooses when the
job prepares: the native renderer (`backend/nativeRenderer.ts`) for a film it supports, Remotion for every other
film with the reasons logged; `AIDEOS_RENDERER=remotion` keeps every film on Remotion and `AIDEOS_RENDERER=native`
requires native. A native failure fails the job. See [The renderer flag](NATIVE_RENDERER.md#the-renderer-flag).

`backend/remotionRenderer.ts` is the thin Remotion compatibility adapter. It keeps the old pipeline,
studio, review and manual commands, with the shared final encode flags and each caller's existing
GL selection and active-film pointer behavior (the pipeline alone adds `--log=error`).
`backend/pipeline/render.ts` retains its low-level render compatibility entry point for existing frame journeys. Remotion command assembly, public-directory staging,
frame sampling and generated active-film setup can be discarded when that backend is replaced.
The lifecycle, profile policy, provenance, delivery checks and process cancellation survive.

Behavior changes:

- All four delivery paths now perform the shared measured disk preflight and in-flight reserve
  check, pending B-roll check, retimed-audio preparation, mastering and final probe.
- Failures and cancellation remove partial outputs consistently across callers.
- Successful renders write a film-content sidecar. Review and manual commands now use an
  asynchronous subprocess through the same cancellation boundary as studio exports.
- The studio keeps its existing preparing/rendering/finishing/done/failed/cancelled API and real
  frame-count progress. Its registry maps these from the shared machine.
- Studio export, review and manual renders now encode with the pipeline's final flags, so they
  produce limited-range yuv420p rather than the full-range yuvj420p the old studio command made.

This change does not tune Remotion capture, change GL selection, or add an active-film pointer
lock. The known cross-process pointer race remains part of the legacy backend.
