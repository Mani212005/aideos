//! File Description: Renders a whole film (or a frame range) of one format to an mp4: worker threads each hold their own `Renderer` and draw frames on the CPU reference raster, convert them to limited-range BT.709 I420, and a reorder buffer hands them in order to the R3 encoder (`aideos_encode::encode`), which encodes through ffmpeg and muxes the film's audio. The audio plan is built from the Render IR's own audio clips, so the IR is the one description of the film. Frames are pure functions of the IR, so the threads need no coordination beyond the frame counter.
//! Inputs and outputs: an IR path, a package directory, a format, a frame range and encode options -> the mp4 at `out` and a `VideoReport` (frames, wall time, render and encode facts).
//! Used by: the `aideos-render video` CLI (src/main.rs), backend/nativeRenderer.ts through it, and tests/video.rs.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, Receiver};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use aideos_encode::audio::{AudioClip, AudioPlan, EnvelopePoint, MixSettings, Role};
use aideos_encode::{
    encode, BackendChoice, EncodeOptions, EncodeReport, Fps, FrameSource, FrameSpec, PixelFormat,
    Profile, SourceError,
};
use aideos_render_ir::types::{Asset, Ease, RenderIr};
use serde::Serialize;

use crate::eval::Format;
use crate::renderer::{RenderError, Renderer};

/// How to render and encode.
pub struct VideoOptions {
    pub format: Format,
    /// Inclusive frame range; None renders the whole film.
    pub frames: Option<(u32, u32)>,
    pub profile: Profile,
    pub backend: BackendChoice,
    /// Raster worker threads (at least 1).
    pub threads: usize,
    /// x264 threads; None lets ffmpeg decide.
    pub encoder_threads: Option<u32>,
    /// Raise to stop: workers stop drawing and the encoder removes its partial output.
    pub cancel: Arc<AtomicBool>,
    /// Called after every encoded frame with (frames done, frames total).
    pub on_progress: Option<Box<dyn FnMut(u64, u64)>>,
}

/// What a finished render did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoReport {
    pub output: PathBuf,
    pub format: &'static str,
    pub first_frame: u32,
    pub last_frame: u32,
    pub frames: u64,
    pub width: u32,
    pub height: u32,
    pub raster_threads: usize,
    /// The encoder that actually ran (`libx264`, `h264_vaapi`, ...).
    pub encoder: &'static str,
    pub fallback_reason: Option<String>,
    pub audio_clips: usize,
    /// Wall time of the whole render, loading included.
    pub elapsed_sec: f64,
    pub frames_per_second: f64,
}

/// Converts straight RGBA8 (opaque) to planar I420, limited-range BT.709, with 2x2 averaged chroma.
pub fn rgba_to_i420(rgba: &[u8], width: u32, height: u32, out: &mut [u8]) {
    let (w, h) = (width as usize, height as usize);
    let (cw, ch) = (w / 2, h / 2);
    let (y_plane, rest) = out.split_at_mut(w * h);
    let (u_plane, v_plane) = rest.split_at_mut(cw * ch);
    // Kr = 0.2126, Kb = 0.0722; luma scaled to 16..235, chroma to 16..240, in 16-bit fixed point.
    for (row, y_row) in y_plane.chunks_exact_mut(w).enumerate() {
        let src = &rgba[row * w * 4..(row + 1) * w * 4];
        for (x, y) in y_row.iter_mut().enumerate() {
            let (r, g, b) = (
                i32::from(src[x * 4]),
                i32::from(src[x * 4 + 1]),
                i32::from(src[x * 4 + 2]),
            );
            *y = ((11_966 * r + 40_254 * g + 4_064 * b + (16 << 16) + 32_768) >> 16) as u8;
        }
    }
    for cy in 0..ch {
        for cx in 0..cw {
            let mut sum = [0i32; 3];
            for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                let i = ((cy * 2 + dy) * w + cx * 2 + dx) * 4;
                for c in 0..3 {
                    sum[c] += i32::from(rgba[i + c]);
                }
            }
            // Averages of the four pixels, kept at 4x for precision.
            let (r, g, b) = (sum[0], sum[1], sum[2]);
            let u = (-6_596 * r - 22_189 * g + 28_784 * b + (128 << 18) + (1 << 17)) >> 18;
            let v = (28_784 * r - 26_145 * g - 2_639 * b + (128 << 18) + (1 << 17)) >> 18;
            u_plane[cy * cw + cx] = u.clamp(0, 255) as u8;
            v_plane[cy * cw + cx] = v.clamp(0, 255) as u8;
        }
    }
}

/// Builds the encoder's audio plan from the IR's audio clips for frames `first..=last`, in seconds relative to `first`.
pub fn audio_plan(ir: &RenderIr, package: &Path, first: u32, last: u32) -> Result<Option<AudioPlan>, String> {
    if ir.audio.is_empty() {
        return Ok(None);
    }
    let fps = f64::from(ir.film.fps.0);
    let offset = f64::from(first) / fps;
    let end = f64::from(last + 1) / fps - offset;
    let mut clips = Vec::new();
    for clip in &ir.audio {
        let Some(Asset::Audio(asset)) = ir.assets.iter().find(|a| a.id() == clip.asset) else {
            return Err(format!("audio clip {:?} names no audio asset {:?}", clip.id, clip.asset));
        };
        if !aideos_render_ir::is_safe_relative_path(&asset.path) {
            return Err(format!("audio asset {:?}: {} is not a safe package-relative path", asset.id, asset.path));
        }
        let path = package.join(&asset.path);
        let real = path
            .canonicalize()
            .map_err(|e| format!("audio asset {:?}: cannot open {}: {e}", asset.id, path.display()))?;
        let root = package
            .canonicalize()
            .map_err(|e| format!("cannot open the package directory: {e}"))?;
        if !real.starts_with(&root) {
            return Err(format!("audio asset {:?} resolves outside the package directory", asset.id));
        }
        if let Some(k) = clip.gain_envelope.iter().find(|k| !matches!(k.ease, None | Some(Ease::Linear))) {
            return Err(format!(
                "audio clip {:?}: gain envelope keyframe at frame {} is not linear; the mixer interpolates gain linearly",
                clip.id, k.frame.0
            ));
        }
        let mut start = f64::from(clip.start_frame.0) / fps - offset;
        let mut duration = f64::from(clip.duration_frames.0) / fps;
        let mut source_start = clip.source_start_ms / 1000.0;
        if start < 0.0 {
            // A clip already playing at the range start enters partway through its source.
            source_start -= start;
            duration += start;
            start = 0.0;
        }
        if duration <= 0.0 || start >= end {
            continue;
        }
        let mut c = AudioClip::new(real, Role::Voice);
        c.start_sec = start;
        c.duration_sec = Some(duration);
        c.source_start_sec = source_start;
        c.gain = clip.gain;
        c.gain_envelope = clip
            .gain_envelope
            .iter()
            .map(|k| EnvelopePoint {
                time_sec: f64::from(k.frame.0) / fps - offset,
                gain: k.value,
            })
            .collect();
        clips.push(c);
    }
    // Nothing is ducked (every IR clip is voice), so no speech needs measuring.
    Ok(Some(AudioPlan {
        mix: MixSettings::default(),
        clips,
        speech: Some(Vec::new()),
    }))
}

/// A frame source fed by raster worker threads through an in-order reorder buffer.
struct ParallelSource {
    spec: FrameSpec,
    first: u32,
    next: u32,
    /// Highest frame index workers may start (exclusive), moved forward as frames are consumed.
    window: Arc<AtomicU32>,
    window_size: u32,
    rx: Receiver<(u32, Result<Vec<u8>, String>)>,
    pending: BTreeMap<u32, Vec<u8>>,
    workers: Vec<JoinHandle<()>>,
    cancel: Arc<AtomicBool>,
}

impl ParallelSource {
    /// Starts `threads` workers, each opening its own renderer, drawing frames `first..=last`.
    fn start(ir_path: &Path, package: &Path, opts: &VideoOptions, first: u32, last: u32, size: (u32, u32), fps: u32) -> ParallelSource {
        let threads = opts.threads.max(1);
        let window_size = (threads as u32) * 3;
        let counter = Arc::new(AtomicU32::new(first));
        let window = Arc::new(AtomicU32::new(first + window_size));
        let (tx, rx) = sync_channel(threads * 3);
        let mut workers = Vec::new();
        for _ in 0..threads {
            let (tx, counter, window, cancel) = (tx.clone(), counter.clone(), window.clone(), opts.cancel.clone());
            let (ir_path, package, format) = (ir_path.to_path_buf(), package.to_path_buf(), opts.format);
            workers.push(std::thread::spawn(move || {
                let renderer = match Renderer::open(&ir_path, Some(&package)) {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = tx.send((counter.load(Ordering::SeqCst), Err(e.to_string())));
                        return;
                    }
                };
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        return;
                    }
                    let frame = counter.fetch_add(1, Ordering::SeqCst);
                    if frame > last {
                        return;
                    }
                    // Stay inside the window so a slow frame cannot make the buffer grow without bound.
                    while frame >= window.load(Ordering::SeqCst) {
                        if cancel.load(Ordering::Relaxed) {
                            return;
                        }
                        std::thread::sleep(Duration::from_micros(200));
                    }
                    let result = renderer.render_frame(format, frame).map(|f| {
                        let mut yuv = vec![0u8; PixelFormat::I420.frame_bytes(f.width, f.height)];
                        rgba_to_i420(&f.rgba, f.width, f.height, &mut yuv);
                        yuv
                    });
                    if tx.send((frame, result.map_err(|e: RenderError| e.to_string()))).is_err() {
                        return;
                    }
                }
            }));
        }
        ParallelSource {
            spec: FrameSpec {
                width: size.0,
                height: size.1,
                fps: Fps { num: fps, den: 1 },
                pixel_format: PixelFormat::I420,
                frame_count: u64::from(last - first + 1),
            },
            first,
            next: first,
            window,
            window_size,
            rx,
            pending: BTreeMap::new(),
            workers,
            cancel: opts.cancel.clone(),
        }
    }

    /// Stops the workers and waits for them.
    fn stop(&mut self) {
        self.cancel.store(true, Ordering::SeqCst);
        while self.rx.try_recv().is_ok() {}
        for w in self.workers.drain(..) {
            // Drain while joining so a worker blocked on a full channel can finish.
            while !w.is_finished() {
                while self.rx.try_recv().is_ok() {}
                std::thread::sleep(Duration::from_millis(1));
            }
            let _ = w.join();
        }
    }
}

impl FrameSource for ParallelSource {
    /// The I420 stream description.
    fn spec(&self) -> FrameSpec {
        self.spec
    }

    /// Hands over the next frame in order, waiting for the worker drawing it.
    fn next_frame(&mut self, frame: &mut [u8]) -> Result<bool, SourceError> {
        if u64::from(self.next - self.first) >= self.spec.frame_count {
            return Ok(false);
        }
        loop {
            if let Some(bytes) = self.pending.remove(&self.next) {
                frame.copy_from_slice(&bytes);
                self.next += 1;
                self.window.store(self.next + self.window_size, Ordering::SeqCst);
                return Ok(true);
            }
            match self.rx.recv() {
                Ok((index, Ok(bytes))) => {
                    self.pending.insert(index, bytes);
                }
                Ok((index, Err(message))) => {
                    return Err(SourceError::Frame {
                        file: format!("frame {index}"),
                        message,
                    })
                }
                Err(_) => {
                    return Err(SourceError::Ended {
                        expected: self.spec.frame_count,
                        got: u64::from(self.next - self.first),
                    })
                }
            }
        }
    }
}

impl Drop for ParallelSource {
    /// Never leaves worker threads drawing after the encode ended.
    fn drop(&mut self) {
        self.stop();
    }
}

/// Renders frames of one format of the IR at `ir_path` to an mp4 at `out`.
pub fn render_video(ir_path: &Path, package_dir: Option<&Path>, out: &Path, mut opts: VideoOptions) -> Result<VideoReport, String> {
    let started = Instant::now();
    let package = match package_dir {
        Some(p) => p.to_path_buf(),
        None => ir_path.parent().map_or_else(|| PathBuf::from("."), Path::to_path_buf),
    };
    // Load once on this thread first, so a bad document or asset fails before any worker or ffmpeg starts.
    let probe = Renderer::open(ir_path, Some(&package)).map_err(|e| e.to_string())?;
    let size = probe.frame_size(opts.format).map_err(|e| e.to_string())?;
    let ir = probe.ir().clone();
    drop(probe);
    let duration = ir.film.duration_frames.0;
    let (first, last) = opts.frames.unwrap_or((0, duration - 1));
    if first > last || last >= duration {
        return Err(format!("frames {first}-{last} are not inside the film (frames 0 to {})", duration - 1));
    }
    let plan = audio_plan(&ir, &package, first, last)?;
    let mut source = ParallelSource::start(ir_path, &package, &opts, first, last, size, ir.film.fps.0);
    let mut encode_opts = EncodeOptions::new(opts.profile);
    encode_opts.backend = opts.backend;
    encode_opts.threads = opts.encoder_threads;
    encode_opts.cancel = Some(opts.cancel.clone());
    if let Some(mut callback) = opts.on_progress.take() {
        encode_opts.on_progress = Some(Box::new(move |p| callback(p.frames_done, p.frames_total)));
    }
    let result: Result<EncodeReport, _> = encode(&mut source, plan.as_ref(), out, &mut encode_opts);
    source.stop();
    let report = result.map_err(|e| e.to_string())?;
    let elapsed = started.elapsed().as_secs_f64();
    Ok(VideoReport {
        output: report.output,
        format: opts.format.name(),
        first_frame: first,
        last_frame: last,
        frames: report.frames,
        width: report.width,
        height: report.height,
        raster_threads: opts.threads.max(1),
        encoder: report.backend.encoder(),
        fallback_reason: report.fallback_reason,
        audio_clips: plan.map_or(0, |p| p.clips.len()),
        elapsed_sec: elapsed,
        frames_per_second: report.frames as f64 / elapsed.max(1e-9),
    })
}
