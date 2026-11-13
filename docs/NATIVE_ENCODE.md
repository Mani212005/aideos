# Native encode and audio mux (`native/aideos-encode`)

R3 of the native renderer, Phase 1. It turns a stream of raw frames plus an audio plan into the final mp4. It does
not draw (R2's evaluator does), does not emit a Render IR (R1 defines it, R4's emitter fills it) and does not burn in
captions. It is a Rust crate with a library API and a CLI, driving `ffmpeg` and `ffprobe` as subprocesses.

| Piece | File |
| --- | --- |
| Frame-source interface, synthetic, PNG sequence and raw stream sources (the CLI accepts PNG sequences and raw streams) | `native/aideos-encode/src/frames.rs` |
| Profiles (draft, review, final) and backends (x264, VAAPI, VideoToolbox) | `native/aideos-encode/src/profile.rs` |
| Encoder: ffmpeg subprocess, backend probe, cancellation, atomic output | `native/aideos-encode/src/encode.rs` |
| Audio mixer: clips, gain, envelope, fades, speech ducking, float WAV | `native/aideos-encode/src/audio.rs` |
| ffprobe facts | `native/aideos-encode/src/probe.rs` |
| CLI | `native/aideos-encode/src/main.rs` |
| Behavioural tests (library and CLI, probed with ffprobe and ffmpeg) | `native/aideos-encode/tests/encode.rs` |

## Commands

```bash
cargo test --locked --manifest-path native/Cargo.toml          # all native crates (also run by `npm run ci -- unit`)
cargo build --release --manifest-path native/Cargo.toml        # native/target/release/aideos-encode

# PNG directory plus narration and music, final export (x264 CRF 16)
aideos-encode --frames frames/ --fps 30 --voiceover voiceover.wav --music music.wav --out long.mp4

# Raw frames on stdin (the shape R2's evaluator streams): I420 is the fast path
render | aideos-encode --raw-stdin --size 1080x1920 --frame-count 4621 --pixel-format i420 --profile draft --out reel.mp4

```

`aideos-encode --help` lists every flag. Exit code 0 is success, 1 an encode failure (message on stderr), 2 a usage
error. The tests need `ffmpeg` and `ffprobe` on PATH (`AIDEOS_FFMPEG` and `AIDEOS_FFPROBE` override). CI's unit job
already installs ffmpeg; the cargo cache step it gained keys on `native/Cargo.lock`. The `cargo test` step lives in
`scripts/ci.ts` and covers every crate under `native/`.

## The delivery format

Every profile writes H.264 High, `yuv420p`, **limited range**, tagged BT.709 on all four tags (primaries, transfer,
matrix, range), in an mp4 with `+faststart`, plus AAC-LC stereo 48 kHz at 320 kbps when there is audio. The values are
the `RENDER_PROFILES` table of `backend/renderJob.ts` (task aideos-m1-render-job): CRF 16, `yuv420p`, limited range,
AAC 320k.

| Profile | Encoder | Settings |
| --- | --- | --- |
| `final` | always libx264 | preset `medium`, CRF 16 |
| `review`, `draft` | VAAPI on Linux or VideoToolbox on the Mac when the machine passes the probe, else libx264 | VAAPI constant QP 18; VideoToolbox about 0.2 bit per pixel per frame (not measurable on the Linux dev laptop, so unverified until run on the Mac); software fallback is CRF 16 with preset `veryfast` |

Decision record: x264 for final export and hardware for drafts and review renders is decision 5 of the native renderer
plan (measured SSIM 0.9987 for x264 medium, 0.9985 for veryfast, 0.9977 for VAAPI). The `veryfast` fallback preset is
this ship's choice, since the profile table fixes CRF but not a preset.

**Backend choice is verified, not assumed.** For a draft or review with `--backend auto`, the encoder first encodes
three tiny synthetic frames with the hardware backend and ffprobes the result: it must be h264, `yuv420p`, limited
range, with all three colour tags BT.709. Only then is hardware used. Otherwise it falls back to x264 and the report's
`fallback_reason` says why. `--backend vaapi` (explicit) never falls back: a machine that cannot run it gets
`BackendUnavailable`. A `final` profile refuses a hardware backend outright (`Policy` error), because the deliverable
is x264.

**Input layouts.** `rgba` frames are converted by ffmpeg with an accurate BT.709 limited-range matrix
(`scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int`); alpha is ignored, so frames must be
opaque (the PNG reader composites transparency over black). `i420` frames must already be limited-range BT.709, as the
GPU conversion R2 plans produces. Sizes must be even in both directions. Both 16:9 (1920x1080) and 9:16 (1080x1920)
are the same code path.

**Determinism.** The same frames, audio and options give byte-identical output on one machine: the tests encode twice
and compare bytes. x264's output depends on its thread count, so a different `--threads` (or a machine where the
default differs) gives a different, equally valid file. Pin `threads` when byte identity across machines matters.
The container carries no creation time or ffmpeg version tag; the stream's own encoder SEI still names the x264 build (or VAAPI driver), so files from different builds differ.

**Failure behaviour.** The mp4 is written to `<name>.partial` and renamed on success, so a file at the output path is
always complete. A failing source, a failing ffmpeg, a cancel (`EncodeOptions::cancel`, an `AtomicBool` another thread
raises) and a missing ffmpeg all leave no partial or scratch file. Errors name the cause (the frame file, the audio
file, the backend, ffmpeg's last messages).

## Plugging R2's evaluator in

```rust
impl FrameSource for Evaluator {
    fn spec(&self) -> FrameSpec { /* width, height, fps, PixelFormat::I420, frame_count */ }
    fn next_frame(&mut self, frame: &mut [u8]) -> Result<bool, SourceError> { /* fill, Ok(true); Ok(false) when done */ }
}
let report = aideos_encode::encode(&mut evaluator, Some(&audio_plan), out, &mut EncodeOptions::new(Profile::Final))?;
```

The source is pulled in order, once per frame, on the calling thread; ffmpeg encodes concurrently in its own process,
so rendering and encoding overlap. To render ahead on another thread, wrap a channel receiver in a `FrameSource`.
`FrameSpec::frame_count` must be exact: the audio mix length is derived from it.

## Audio plan

`--voiceover`, `--music` and `--audio` build a plan for you; `--audio-plan plan.json` takes the whole thing (relative
paths resolve against the plan file's folder). Fields are camelCase, unknown fields are errors:

```json
{
  "mix": { "duckDb": -18, "pauseGainDb": -10, "musicOnlyGainDb": -8, "storyEndSec": 150.2 },
  "speech": [{ "startSec": 1.0, "endSec": 2.4 }],
  "clips": [
    { "path": "voiceover.wav", "role": "voice", "startSec": 0, "gain": 1 },
    { "path": "music.wav", "role": "music", "gain": 0.8, "fadeInSec": 0.25, "fadeOutSec": 0.25, "duckUnderVoice": true,
      "gainEnvelope": [{ "timeSec": 0, "gain": 1 }, { "timeSec": 30, "gain": 0.5 }] }
  ]
}
```

A clip has a `role` (`voice`, `music`, `effect`), a film-time `startSec`, an optional `durationSec` and
`sourceStartSec`, a static `gain` (0 to 4), optional `gainEnvelope` keyframes in film time (linear, held outside the
first and last), equal-power `fadeInSec` and `fadeOutSec`, and `duckUnderVoice`. This is the shape of the Render IR's
audio clip (`startFrame`, `sourceStartMs`, `gain`, `gainEnvelope`) in seconds.

Mixing happens in the sample domain, as `backend/pcm.ts` does for narration: each clip is decoded by ffmpeg to 48 kHz
float, mono sources are copied to both channels at unity (the same upmix the Chrome pipeline does), everything is
summed into one stereo bed exactly as long as the picture, written as a float WAV and muxed. Nothing is normalized or
limited here: gains, including loudness normalization of music, arrive already resolved from the TypeScript side, and
loudness mastering stays with the render job. A sum past full scale is clamped and reported (`audio.clipped_samples`,
`audio.peak` in the report).

**Ducking follows the committed soundtrack mixer** (`speechGain` and `mergeSpeech` in `src/dl/audio/sectionMixer.ts`,
the detector of `backend/soundtrack.ts`): narration is the 10 ms windows with RMS above -40 dBFS in the `voice` clips
(measured before gain), phrases closer than 0.6 s merge, and music with `duckUnderVoice` sits at `duckDb` (-18) during
speech with a 0.25 s attack and 0.6 s release, `pauseGainDb` (-10) in pauses and `musicOnlyGainDb` (-8) before the first
and after the last phrase, rising to the music-only level around `storyEndSec`. Pass `speech` when the TypeScript
pipeline already measured it (`soundtrack.speech`); the mixer then measures nothing. The tests hold these levels to
0.3 dB.

Not carried over: the library-section manifest, per-effect peak caps and the legacy `ducking.ts` curve. The emitter
(R4) resolves those into clips, gains and envelopes before they reach this crate.

## Measured speed

`aideos-encode` 1080p, release build, this laptop (i7-1255U, VAAPI) while other lanes were running (load average 8 to
10), 150 frames of ffmpeg `testsrc2` (dense detail, a hard case), median of two runs, wall time of the whole process
including start-up and, for hardware, the conformance probe:

| Run | Wall | Frames per second |
| --- | --- | --- |
| final, x264 CRF 16 medium, I420 in | 4.9 to 5.3 s | about 29 |
| draft, VAAPI QP 18, I420 in | 1.9 s | about 79 |
| draft, software fallback (veryfast), I420 in | 2.6 to 2.8 s | about 55 |
| final, x264, RGBA in (90 frames) | 3.6 to 4.4 s | about 23 |
| draft, VAAPI, RGBA in (90 frames) | 3.1 to 3.2 s | about 29 |

Two things to take from it. The native plan measured 82 fps for x264 on quiet hardware and calmer content, so these
numbers are a loaded-machine floor, not a ceiling. And `rgba` input is bound by ffmpeg's swscale conversion
(about 56 fps alone with the accuracy flags, 117 fps with defaults), so the evaluator should hand over I420.

## Not in this ship

The evaluator and raster (R2), the TypeScript emitter and Still Talking acceptance (R4), captions burn-in, loudness
mastering and incremental shot-level re-encode. No Remotion code or type is imported and the Remotion render path is
untouched. The render job (`backend/renderJob.ts`) can call the binary or the library behind its `Renderer` interface;
wiring it is R4.

Dependencies: `serde`, `serde_json` and `png` (pure Rust), 23 packages in all in `native/Cargo.lock`, this crate included, built into
`native/target` (gitignored).
