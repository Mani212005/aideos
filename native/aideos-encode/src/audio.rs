// File Description: The sample-domain audio mixer: decodes each clip with ffmpeg to 48 kHz float samples, applies gain, a gain envelope, equal-power fades and speech ducking (the same curve as src/dl/audio/sectionMixer.ts), sums them into one stereo bed and writes it as a float WAV for the muxer.
// Inputs and outputs: an AudioPlan (voiceover, music and effect clips with placement and gain) and the film duration -> a stereo f32 buffer, its peak and clipped-sample count, and a WAV file.
// Used by: src/encode.rs, src/main.rs, tests/encode.rs.

use crate::probe::probe;
use crate::tools::Tools;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The mix sample rate: every clip is resampled to it, and the muxed AAC track uses it.
pub const SAMPLE_RATE: u32 = 48_000;

/// Window and threshold of the speech detector, as backend/soundtrack.ts measures narration (10 ms RMS windows above -40 dB).
const SPEECH_WINDOW_SAMPLES: usize = (SAMPLE_RATE / 100) as usize;
const SPEECH_THRESHOLD_DB: f64 = -40.0;
/// Phrases closer than this are joined into one speech interval (mergeSpeech in sectionMixer.ts).
const SPEECH_MERGE_GAP_SEC: f64 = 0.6;
/// Ducking is evaluated on a 10 ms control grid and interpolated; its ramps last 0.25 s or more.
const DUCK_GRID_SEC: f64 = 0.01;

/// What a clip is for: voice clips define where the narration speaks, music clips may duck under it.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Voice,
    Music,
    Effect,
}

/// One gain keyframe on the film timeline; gain is linear and interpolated linearly, held before the first and after the last point.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvelopePoint {
    pub time_sec: f64,
    pub gain: f64,
}

/// A span of narration on the film timeline.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeechInterval {
    pub start_sec: f64,
    pub end_sec: f64,
}

/// The ducking levels of a soundtrack; the defaults are the committed `SoundtrackMix` defaults.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct MixSettings {
    /// Music level while narration speaks, in dB.
    pub duck_db: f64,
    /// Music level in a pause between narrated phrases, in dB.
    pub pause_gain_db: f64,
    /// Music level before the first and after the last narration, in dB.
    pub music_only_gain_db: f64,
    /// Where the story ends and the music-only end card begins; the pause level rises to `music_only_gain_db` around it. None means no end card.
    pub story_end_sec: Option<f64>,
}

impl Default for MixSettings {
    /// -18 dB under speech, -10 dB in pauses, -8 dB music only, no end card.
    fn default() -> MixSettings {
        MixSettings { duck_db: -18.0, pause_gain_db: -10.0, music_only_gain_db: -8.0, story_end_sec: None }
    }
}

/// One audio file placed on the film timeline.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioClip {
    /// A file ffmpeg can decode; relative paths resolve against the plan's base directory.
    pub path: PathBuf,
    pub role: Role,
    /// Where the clip begins on the film timeline.
    #[serde(default)]
    pub start_sec: f64,
    /// How much of the clip plays; None plays it to its end (or the end of the film).
    #[serde(default)]
    pub duration_sec: Option<f64>,
    /// Where in the source file playback begins.
    #[serde(default)]
    pub source_start_sec: f64,
    /// Static linear gain, 0 to 4.
    #[serde(default = "unity")]
    pub gain: f64,
    /// Optional gain keyframes in film time, multiplied with `gain`.
    #[serde(default)]
    pub gain_envelope: Vec<EnvelopePoint>,
    /// Equal-power entrance length in seconds.
    #[serde(default)]
    pub fade_in_sec: f64,
    /// Equal-power exit length in seconds.
    #[serde(default)]
    pub fade_out_sec: f64,
    /// Music only: follow the speech ducking curve of the plan's `mix`.
    #[serde(default)]
    pub duck_under_voice: bool,
}

/// Serde default for a gain of one.
fn unity() -> f64 {
    1.0
}

impl AudioClip {
    /// A clip with every optional field at its neutral value.
    pub fn new(path: impl Into<PathBuf>, role: Role) -> AudioClip {
        AudioClip {
            path: path.into(),
            role,
            start_sec: 0.0,
            duration_sec: None,
            source_start_sec: 0.0,
            gain: 1.0,
            gain_envelope: Vec::new(),
            fade_in_sec: 0.0,
            fade_out_sec: 0.0,
            duck_under_voice: false,
        }
    }
}

/// Everything audible in the film.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioPlan {
    #[serde(default)]
    pub mix: MixSettings,
    pub clips: Vec<AudioClip>,
    /// Narration spans already measured by the TypeScript pipeline (`soundtrack.speech`). When absent they are measured from the voice clips.
    #[serde(default)]
    pub speech: Option<Vec<SpeechInterval>>,
}

/// The mixed result held in memory.
#[derive(Clone, Debug)]
pub struct MixedAudio {
    /// Interleaved left, right samples at `SAMPLE_RATE`, clamped to [-1, 1].
    pub samples: Vec<f32>,
    /// Largest absolute sample before clamping (1.0 is full scale).
    pub peak: f32,
    /// Samples that exceeded full scale and were clamped.
    pub clipped_samples: u64,
    /// Narration spans used for ducking (given or measured).
    pub speech: Vec<SpeechInterval>,
}

/// Why a mix failed.
#[derive(Debug)]
pub enum AudioError {
    /// The plan itself is invalid.
    Plan(String),
    /// A source file could not be probed or decoded.
    Source { path: PathBuf, message: String },
    /// Writing the mix failed.
    Io(io::Error),
}

impl fmt::Display for AudioError {
    /// Writes a one-line description naming the file at fault.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AudioError::Plan(m) => write!(f, "audio plan: {m}"),
            AudioError::Source { path, message } => write!(f, "audio source {}: {message}", path.display()),
            AudioError::Io(e) => write!(f, "writing the audio mix failed: {e}"),
        }
    }
}

impl std::error::Error for AudioError {}

impl From<io::Error> for AudioError {
    /// Wraps an I/O error.
    fn from(e: io::Error) -> Self {
        AudioError::Io(e)
    }
}

/// Converts decibels to a linear amplitude factor.
pub fn db_gain(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

/// Clamps a ramp position to [0, 1].
fn progress(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

/// Sorts narration spans and joins those separated by less than 0.6 s, dropping empty ones.
pub fn merge_speech(intervals: &[SpeechInterval]) -> Vec<SpeechInterval> {
    let mut sorted: Vec<SpeechInterval> = intervals.iter().copied().filter(|i| i.end_sec > i.start_sec).collect();
    sorted.sort_by(|a, b| a.start_sec.total_cmp(&b.start_sec));
    let mut merged: Vec<SpeechInterval> = Vec::new();
    for interval in sorted {
        match merged.last_mut() {
            Some(previous) if interval.start_sec - previous.end_sec < SPEECH_MERGE_GAP_SEC - 1e-9 => {
                previous.end_sec = previous.end_sec.max(interval.end_sec);
            }
            _ => merged.push(interval),
        }
    }
    merged
}

/// The music gain at `time_sec` for merged, sorted `speech`: flat at the duck level inside a phrase, a 0.25 s attack into it and a 0.6 s release out of it (speechGain in sectionMixer.ts).
pub fn speech_gain(time_sec: f64, speech: &[SpeechInterval], mix: &MixSettings) -> f64 {
    let first_not_ended = speech.partition_point(|i| i.end_sec < time_sec);
    if let Some(interval) = speech.get(first_not_ended) {
        if interval.start_sec <= time_sec {
            return db_gain(mix.duck_db);
        }
    }
    let previous_end = if first_not_ended > 0 { speech[first_not_ended - 1].end_sec } else { f64::NEG_INFINITY };
    let next_start = speech.get(first_not_ended).map(|i| i.start_sec).unwrap_or(f64::INFINITY);
    let music_only = previous_end == f64::NEG_INFINITY || next_start == f64::INFINITY;
    let story = mix.story_end_sec.unwrap_or(f64::INFINITY);
    let card_rise = progress((time_sec - story + 0.25) / 0.25);
    let open_db = if music_only { mix.music_only_gain_db } else { mix.pause_gain_db + (mix.music_only_gain_db - mix.pause_gain_db) * card_rise };
    let release = mix.duck_db + (open_db - mix.duck_db) * progress((time_sec - previous_end) / SPEECH_MERGE_GAP_SEC);
    let attack = mix.duck_db + (open_db - mix.duck_db) * progress((next_start - time_sec) / 0.25);
    db_gain(open_db.min(release).min(attack))
}

/// Finds narration in decoded stereo samples: every 10 ms window with RMS above -40 dBFS, offset to film time, merged.
pub fn measure_speech(stereo: &[f32], start_sec: f64) -> Vec<SpeechInterval> {
    let mut windows = Vec::new();
    for (index, window) in stereo.chunks_exact(SPEECH_WINDOW_SAMPLES * 2).enumerate() {
        let power = window.iter().map(|s| (*s as f64) * (*s as f64)).sum::<f64>() / window.len() as f64;
        let db = 10.0 * power.max(1e-20).log10();
        if db > SPEECH_THRESHOLD_DB {
            let at = start_sec + (index * SPEECH_WINDOW_SAMPLES) as f64 / SAMPLE_RATE as f64;
            windows.push(SpeechInterval { start_sec: at, end_sec: at + 0.01 });
        }
    }
    merge_speech(&windows)
}

/// Checks the plan's numbers before any decoding happens.
fn validate_plan(plan: &AudioPlan, total_sec: f64) -> Result<(), AudioError> {
    let bad = |message: String| Err(AudioError::Plan(message));
    for (n, clip) in plan.clips.iter().enumerate() {
        let name = format!("clip {} ({})", n + 1, clip.path.display());
        if !(0.0..=4.0).contains(&clip.gain) {
            return bad(format!("{name}: gain {} is outside 0 to 4", clip.gain));
        }
        for (field, value) in [("startSec", clip.start_sec), ("sourceStartSec", clip.source_start_sec), ("fadeInSec", clip.fade_in_sec), ("fadeOutSec", clip.fade_out_sec)] {
            if !value.is_finite() || value < 0.0 {
                return bad(format!("{name}: {field} must be a number of at least 0"));
            }
        }
        if let Some(d) = clip.duration_sec {
            if !d.is_finite() || d <= 0.0 {
                return bad(format!("{name}: durationSec must be above 0"));
            }
        }
        let mut last = f64::NEG_INFINITY;
        for point in &clip.gain_envelope {
            if !point.time_sec.is_finite() || point.time_sec <= last {
                return bad(format!("{name}: gainEnvelope times must be finite and strictly increasing"));
            }
            if !(0.0..=4.0).contains(&point.gain) {
                return bad(format!("{name}: gainEnvelope gain {} is outside 0 to 4", point.gain));
            }
            last = point.time_sec;
        }
    }
    for (what, value) in [("duckDb", plan.mix.duck_db), ("pauseGainDb", plan.mix.pause_gain_db), ("musicOnlyGainDb", plan.mix.music_only_gain_db)] {
        if !value.is_finite() || value > 12.0 {
            return bad(format!("mix.{what} must be a finite level of at most 12 dB"));
        }
    }
    if let Some(story_end) = plan.mix.story_end_sec {
        if !story_end.is_finite() || !(0.0..=total_sec).contains(&story_end) {
            return bad(format!("mix.storyEndSec must be between 0 and the film duration ({total_sec})"));
        }
    }
    if let Some(speech) = &plan.speech {
        for (n, interval) in speech.iter().enumerate() {
            if !interval.start_sec.is_finite() || !interval.end_sec.is_finite() || interval.start_sec < 0.0 || interval.start_sec > total_sec || interval.end_sec < interval.start_sec || interval.end_sec > total_sec {
                return bad(format!("speech[{}] must be ordered within 0 to the film duration ({total_sec})", n));
            }
        }
    }
    Ok(())
}

/// Decodes one clip to interleaved stereo f32 at 48 kHz. Mono sources are copied to both channels at unity, as the Chrome-based pipeline does; more than two channels are downmixed by ffmpeg.
fn decode_clip(tools: &Tools, clip: &AudioClip, path: &Path) -> Result<Vec<f32>, AudioError> {
    let fail = |message: String| AudioError::Source { path: path.to_path_buf(), message };
    let facts = probe(&tools.ffprobe, path).map_err(&fail)?;
    let channels = facts.audio().ok_or_else(|| fail("has no audio stream".to_string()))?.channels.unwrap_or(2);
    let mut command = Command::new(&tools.ffmpeg);
    command.args(["-v", "error", "-nostdin", "-ss"]).arg(format!("{:.6}", clip.source_start_sec)).arg("-i").arg(path);
    if let Some(d) = clip.duration_sec {
        command.arg("-t").arg(format!("{d:.6}"));
    }
    command.args(["-vn", "-map", "0:a:0", "-ar"]).arg(SAMPLE_RATE.to_string());
    command.args(["-ac", if channels == 1 { "1" } else { "2" }, "-f", "f32le", "pipe:1"]);
    let output = command.stdin(Stdio::null()).output().map_err(|e| fail(format!("cannot run {}: {e}", tools.ffmpeg.display())))?;
    if !output.status.success() {
        return Err(fail(format!("ffmpeg could not decode it: {}", String::from_utf8_lossy(&output.stderr).trim())));
    }
    let mono_or_stereo: Vec<f32> = output.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    if channels == 1 {
        Ok(mono_or_stereo.iter().flat_map(|s| [*s, *s]).collect())
    } else {
        Ok(mono_or_stereo)
    }
}

/// The envelope gain at `time_sec`: linear between keyframes, held outside them, 1 when there are none. `cursor` only moves forward, so a pass over increasing times is linear.
fn envelope_at(points: &[EnvelopePoint], time_sec: f64, cursor: &mut usize) -> f64 {
    let (Some(first), Some(last)) = (points.first(), points.last()) else { return 1.0 };
    if time_sec <= first.time_sec {
        return first.gain;
    }
    if time_sec >= last.time_sec {
        return last.gain;
    }
    while points[*cursor + 1].time_sec <= time_sec {
        *cursor += 1;
    }
    let (a, b) = (points[*cursor], points[*cursor + 1]);
    a.gain + (b.gain - a.gain) * (time_sec - a.time_sec) / (b.time_sec - a.time_sec)
}

/// Mixes the whole plan into a stereo bed exactly `total_sec` long. Relative clip paths resolve against `base_dir`.
pub fn mix_plan(tools: &Tools, plan: &AudioPlan, total_sec: f64, base_dir: &Path) -> Result<MixedAudio, AudioError> {
    if !total_sec.is_finite() || total_sec <= 0.0 {
        return Err(AudioError::Plan("the film duration must be above 0".to_string()));
    }
    validate_plan(plan, total_sec)?;
    let total_samples = (total_sec * SAMPLE_RATE as f64).round() as usize;
    let mut decoded: Vec<(usize, Vec<f32>)> = Vec::with_capacity(plan.clips.len());
    for clip in &plan.clips {
        let path = if clip.path.is_absolute() { clip.path.clone() } else { base_dir.join(&clip.path) };
        let samples = decode_clip(tools, clip, &path)?;
        decoded.push(((clip.start_sec * SAMPLE_RATE as f64).round() as usize, samples));
    }
    let speech = match &plan.speech {
        Some(given) => merge_speech(given),
        None => {
            let mut found = Vec::new();
            for (clip, (_, samples)) in plan.clips.iter().zip(&decoded) {
                if clip.role == Role::Voice {
                    found.extend(measure_speech(samples, clip.start_sec));
                }
            }
            merge_speech(&found)
        }
    };
    let duck_grid: Vec<f32> = if plan.clips.iter().any(|c| c.duck_under_voice) {
        let points = (total_sec / DUCK_GRID_SEC).ceil() as usize + 2;
        (0..points).map(|k| speech_gain(k as f64 * DUCK_GRID_SEC, &speech, &plan.mix) as f32).collect()
    } else {
        Vec::new()
    };
    let mut bed = vec![0f32; total_samples * 2];
    for (clip, (start, samples)) in plan.clips.iter().zip(&decoded) {
        let frames = (samples.len() / 2).min(total_samples.saturating_sub(*start));
        let fade_in = (clip.fade_in_sec * SAMPLE_RATE as f64).round() as usize;
        let fade_out = (clip.fade_out_sec * SAMPLE_RATE as f64).round() as usize;
        let mut cursor = 0usize;
        for i in 0..frames {
            let at = start + i;
            let time = at as f64 / SAMPLE_RATE as f64;
            let mut gain = clip.gain * envelope_at(&clip.gain_envelope, time, &mut cursor);
            if fade_in > 0 && i < fade_in {
                gain *= (progress(i as f64 / fade_in as f64) * std::f64::consts::FRAC_PI_2).sin();
            }
            if fade_out > 0 && frames - i < fade_out {
                gain *= (progress((frames - i) as f64 / fade_out as f64) * std::f64::consts::FRAC_PI_2).sin();
            }
            if clip.duck_under_voice {
                let position = time / DUCK_GRID_SEC;
                let lower = position.floor() as usize;
                let t = position - lower as f64;
                gain *= duck_grid[lower] as f64 * (1.0 - t) + duck_grid[(lower + 1).min(duck_grid.len() - 1)] as f64 * t;
            }
            let g = gain as f32;
            bed[at * 2] += samples[i * 2] * g;
            bed[at * 2 + 1] += samples[i * 2 + 1] * g;
        }
    }
    let mut peak = 0f32;
    let mut clipped = 0u64;
    for sample in bed.iter_mut() {
        peak = peak.max(sample.abs());
        if sample.abs() > 1.0 {
            clipped += 1;
            *sample = sample.clamp(-1.0, 1.0);
        }
    }
    Ok(MixedAudio { samples: bed, peak, clipped_samples: clipped, speech })
}

/// Writes stereo f32 samples as an IEEE-float WAV file.
pub fn write_wav_f32(path: &Path, stereo: &[f32]) -> io::Result<()> {
    let data_bytes = (stereo.len() * 4) as u32;
    let mut file = io::BufWriter::new(fs::File::create(path)?);
    file.write_all(b"RIFF")?;
    file.write_all(&(36 + data_bytes).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&3u16.to_le_bytes())?; // WAVE_FORMAT_IEEE_FLOAT
    file.write_all(&2u16.to_le_bytes())?;
    file.write_all(&SAMPLE_RATE.to_le_bytes())?;
    file.write_all(&(SAMPLE_RATE * 8).to_le_bytes())?;
    file.write_all(&8u16.to_le_bytes())?;
    file.write_all(&32u16.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_bytes.to_le_bytes())?;
    for sample in stereo {
        file.write_all(&sample.to_le_bytes())?;
    }
    file.flush()
}
