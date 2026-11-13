# Render jobs

`backend/renderJob.ts` owns the renderer-independent lifecycle:

`queued -> preparing -> rendering -> mastering -> probed -> done`

Every nonterminal state can fail or be cancelled. Terminal states cannot be re-entered or changed.
Calling `run()` again returns the same execution. `cancel()` aborts the backend, waits for teardown,
and removes the partial video, render sidecar and mastering report. Cleanup runs once.

The job copies its input film, checks delivery requirements and pending B-roll, prepares retimed
audio, asks the backend to check its disk budget, renders, masters audio, probes the finished file,
then writes `<output>.render.json`. That sidecar records the prepared film's canonical SHA-256 hash,
requested profile policy and final output facts. This is input provenance, not an acceptance verdict
or a hash of external footage, fonts or audio assets.

`RENDER_PROFILES` is the shared policy table for `draft`, `review` and `final`. All currently request
lossless intermediates, H.264 CRF 16, limited-range yuv420p and AAC at 320 kbps. A future native
encoder can consume this data directly. The sidecar calls this `profilePolicy` because the legacy
capture adapter retains its existing encode settings.

The `Renderer` interface accepts film data, a format, output path, profile and optional frame range.
Its context contains an `AbortSignal` and an output callback. It prepares backend resources, checks
its own measured disk budget, encodes, and releases resources. A Rust, Skia or ffmpeg implementation
can replace this interface without changing lifecycle states or importing capture-framework types.
The existing audio and probe functions are default services; tests use short synthetic services and
encoders through the same public interface.

`backend/remotionRenderer.ts` is the thin Remotion compatibility adapter. It keeps the old pipeline,
studio, review and manual commands, including their existing encode flags, GL selections and
active-film pointer behavior. `backend/pipeline/render.ts` retains its low-level render compatibility
entry point for existing frame journeys. Remotion command assembly, public-directory staging,
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

This change does not tune Remotion capture, change GL selection or encode flags, or add an
active-film pointer lock. The known cross-process pointer race remains part of the legacy backend.
