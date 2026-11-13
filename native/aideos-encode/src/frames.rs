// File Description: The frame-source interface the encoder pulls from, plus three concrete sources: a synthetic pattern generator, a PNG sequence reader and a raw byte stream reader. R2's evaluator implements `FrameSource` to plug in.
// Inputs and outputs: a directory of PNG frames, a raw RGBA or I420 byte stream, or a pattern description -> one tightly packed frame per `next_frame` call.
// Used by: src/encode.rs, src/main.rs, tests/encode.rs, and the R2 evaluator.

use std::fmt;
use std::fs;
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};

/// The two raw layouts the encoder accepts: packed RGBA (ffmpeg converts to BT.709 limited range) or planar I420 that already is limited-range BT.709.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelFormat {
    /// Packed 8-bit R, G, B, A per pixel; alpha is ignored by the encoder (frames are opaque).
    Rgba8,
    /// Planar Y then U then V, 4:2:0, limited-range BT.709, as the GPU conversion in R2 produces.
    I420,
}

impl PixelFormat {
    /// Bytes in one tightly packed frame of this layout (width and height must be even).
    pub fn frame_bytes(self, width: u32, height: u32) -> usize {
        let (w, h) = (width as usize, height as usize);
        match self {
            PixelFormat::Rgba8 => w * h * 4,
            PixelFormat::I420 => w * h + 2 * ((w / 2) * (h / 2)),
        }
    }

    /// The name ffmpeg's rawvideo demuxer uses for this layout.
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            PixelFormat::Rgba8 => "rgba",
            PixelFormat::I420 => "yuv420p",
        }
    }

    /// Parses the CLI spelling (`rgba` or `i420`).
    pub fn parse(text: &str) -> Option<PixelFormat> {
        match text {
            "rgba" => Some(PixelFormat::Rgba8),
            "i420" => Some(PixelFormat::I420),
            _ => None,
        }
    }
}

/// A frame rate as an exact fraction, so 30000/1001 survives to the container unrounded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fps {
    pub num: u32,
    pub den: u32,
}

impl Fps {
    /// Builds a frame rate, refusing zero parts.
    pub fn new(num: u32, den: u32) -> Result<Fps, SourceError> {
        if num == 0 || den == 0 {
            return Err(SourceError::Spec(format!("frame rate {num}/{den} must have a positive numerator and denominator")));
        }
        Ok(Fps { num, den })
    }

    /// Parses `30` or `30000/1001`.
    pub fn parse(text: &str) -> Result<Fps, SourceError> {
        let bad = || SourceError::Spec(format!("frame rate \"{text}\" is not a whole number or a fraction like 30000/1001"));
        match text.split_once('/') {
            Some((n, d)) => Fps::new(n.parse().map_err(|_| bad())?, d.parse().map_err(|_| bad())?),
            None => Fps::new(text.parse().map_err(|_| bad())?, 1),
        }
    }

    /// The rate as a float, for durations and display only.
    pub fn as_f64(self) -> f64 {
        self.num as f64 / self.den as f64
    }

    /// The `num/den` spelling ffmpeg takes for `-framerate`.
    pub fn ffmpeg_string(self) -> String {
        format!("{}/{}", self.num, self.den)
    }
}

/// Everything the encoder needs to know about a frame stream before the first frame arrives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameSpec {
    pub width: u32,
    pub height: u32,
    pub fps: Fps,
    pub pixel_format: PixelFormat,
    /// Exact number of frames the source will deliver (the audio mix length is derived from it).
    pub frame_count: u64,
}

impl FrameSpec {
    /// Bytes in one frame of this stream.
    pub fn frame_bytes(&self) -> usize {
        self.pixel_format.frame_bytes(self.width, self.height)
    }

    /// Playing time of the whole stream in seconds.
    pub fn duration_sec(&self) -> f64 {
        self.frame_count as f64 * self.fps.den as f64 / self.fps.num as f64
    }

    /// Refuses a spec yuv420p cannot carry: zero or odd sizes, absurd sizes, no frames.
    pub fn validate(&self) -> Result<(), SourceError> {
        if self.width == 0 || self.height == 0 || self.width > 16384 || self.height > 16384 {
            return Err(SourceError::Spec(format!("frame size {}x{} is outside 1..16384", self.width, self.height)));
        }
        if self.width % 2 != 0 || self.height % 2 != 0 {
            return Err(SourceError::Spec(format!("frame size {}x{} must be even in both directions for 4:2:0 chroma", self.width, self.height)));
        }
        if self.frame_count == 0 {
            return Err(SourceError::Spec("a video needs at least one frame".to_string()));
        }
        if self.fps.num == 0 || self.fps.den == 0 {
            return Err(SourceError::Spec("frame rate must have a positive numerator and denominator".to_string()));
        }
        Ok(())
    }
}

/// Why a frame source could not deliver its frames.
#[derive(Debug)]
pub enum SourceError {
    /// The stream description itself is unusable.
    Spec(String),
    /// A read failed.
    Io(io::Error),
    /// A frame file could not be decoded or does not match the rest of the sequence.
    Frame { file: String, message: String },
    /// The stream ended before its declared frame count.
    Ended { expected: u64, got: u64 },
}

impl fmt::Display for SourceError {
    /// Writes a one-line description naming the file or count at fault.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SourceError::Spec(m) => write!(f, "{m}"),
            SourceError::Io(e) => write!(f, "reading frames failed: {e}"),
            SourceError::Frame { file, message } => write!(f, "frame {file}: {message}"),
            SourceError::Ended { expected, got } => write!(f, "the frame stream ended after {got} of {expected} frames"),
        }
    }
}

impl std::error::Error for SourceError {}

impl From<io::Error> for SourceError {
    /// Wraps an I/O error.
    fn from(e: io::Error) -> Self {
        SourceError::Io(e)
    }
}

/// A pull-based, in-order frame producer. R2's evaluator implements this and the encoder calls it once per frame.
pub trait FrameSource {
    /// The stream description; constant for the life of the source.
    fn spec(&self) -> FrameSpec;

    /// Fills `frame` (exactly `spec().frame_bytes()` long) with the next frame and returns true, or returns false once all `frame_count` frames were delivered.
    fn next_frame(&mut self, frame: &mut [u8]) -> Result<bool, SourceError>;
}

/// What a synthetic source draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pattern {
    /// Every pixel of every frame is this colour.
    Solid([u8; 3]),
    /// A horizontal gradient with a bright bar that moves right by 7 pixels per frame, so consecutive frames differ.
    Moving,
}

/// Generates deterministic frames with no input files, for tests, smoke runs and the CLI's `--synthetic` mode.
pub struct SyntheticSource {
    spec: FrameSpec,
    pattern: Pattern,
    next: u64,
}

impl SyntheticSource {
    /// Creates a generator after validating the spec.
    pub fn new(spec: FrameSpec, pattern: Pattern) -> Result<SyntheticSource, SourceError> {
        spec.validate()?;
        Ok(SyntheticSource { spec, pattern, next: 0 })
    }

    /// The RGB colour of pixel (x, y) in frame `index`.
    fn pixel(&self, x: u32, y: u32, index: u64) -> [u8; 3] {
        match self.pattern {
            Pattern::Solid(rgb) => rgb,
            Pattern::Moving => {
                let bar = ((index * 7) % self.spec.width as u64) as u32;
                if x >= bar && x < bar + 8 {
                    return [255, 255, 255];
                }
                let r = (x as u64 * 255 / self.spec.width as u64) as u8;
                let g = (y as u64 * 255 / self.spec.height as u64) as u8;
                [r, g, 96]
            }
        }
    }
}

/// Converts one sRGB pixel to limited-range BT.709 Y, U, V (the layout I420 frames must already be in).
pub fn rgb_to_yuv709_limited(rgb: [u8; 3]) -> [u8; 3] {
    let (r, g, b) = (rgb[0] as f64 / 255.0, rgb[1] as f64 / 255.0, rgb[2] as f64 / 255.0);
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let cb = (b - y) / 1.8556;
    let cr = (r - y) / 1.5748;
    let clamp = |v: f64| v.round().clamp(0.0, 255.0) as u8;
    [clamp(16.0 + 219.0 * y), clamp(128.0 + 224.0 * cb), clamp(128.0 + 224.0 * cr)]
}

impl FrameSource for SyntheticSource {
    /// Returns the spec this generator was built with.
    fn spec(&self) -> FrameSpec {
        self.spec
    }

    /// Draws the next frame in the spec's pixel format.
    fn next_frame(&mut self, frame: &mut [u8]) -> Result<bool, SourceError> {
        if self.next >= self.spec.frame_count {
            return Ok(false);
        }
        let (w, h) = (self.spec.width as usize, self.spec.height as usize);
        match self.spec.pixel_format {
            PixelFormat::Rgba8 => {
                for y in 0..h {
                    for x in 0..w {
                        let [r, g, b] = self.pixel(x as u32, y as u32, self.next);
                        let at = (y * w + x) * 4;
                        frame[at..at + 4].copy_from_slice(&[r, g, b, 255]);
                    }
                }
            }
            PixelFormat::I420 => {
                let (luma, chroma) = frame.split_at_mut(w * h);
                let (u_plane, v_plane) = chroma.split_at_mut((w / 2) * (h / 2));
                for y in 0..h {
                    for x in 0..w {
                        let yuv = rgb_to_yuv709_limited(self.pixel(x as u32, y as u32, self.next));
                        luma[y * w + x] = yuv[0];
                        if x % 2 == 0 && y % 2 == 0 {
                            u_plane[(y / 2) * (w / 2) + x / 2] = yuv[1];
                            v_plane[(y / 2) * (w / 2) + x / 2] = yuv[2];
                        }
                    }
                }
            }
        }
        self.next += 1;
        Ok(true)
    }
}

/// Orders file names the way a person reads them: digit runs compare as numbers, so `f2.png` sorts before `f10.png`.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars<'_>>| {
                    let mut digits = String::new();
                    while let Some(&c) = it.peek() {
                        if !c.is_ascii_digit() {
                            break;
                        }
                        digits.push(c);
                        it.next();
                    }
                    digits
                };
                let (da, db) = (take(&mut a), take(&mut b));
                let (ta, tb) = (da.trim_start_matches('0'), db.trim_start_matches('0'));
                let order = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb)).then_with(|| da.len().cmp(&db.len()));
                if order != std::cmp::Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                a.next();
                b.next();
            }
        }
    }
}

/// Reads the PNG files of one directory, in natural file-name order, as RGBA frames.
pub struct PngSequenceSource {
    spec: FrameSpec,
    files: Vec<PathBuf>,
    next: usize,
}

impl PngSequenceSource {
    /// Lists `dir`, checks every file header agrees on one even size, and prepares to decode lazily.
    pub fn open(dir: &Path, fps: Fps) -> Result<PngSequenceSource, SourceError> {
        let mut files: Vec<PathBuf> = fs::read_dir(dir)
            .map_err(|e| SourceError::Spec(format!("cannot read frame directory {}: {e}", dir.display())))?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|p| p.is_file() && p.extension().map(|e| e.eq_ignore_ascii_case("png")).unwrap_or(false))
            .collect();
        files.sort_by(|a, b| natural_cmp(&a.file_name().unwrap_or_default().to_string_lossy(), &b.file_name().unwrap_or_default().to_string_lossy()));
        if files.is_empty() {
            return Err(SourceError::Spec(format!("no .png files in {}", dir.display())));
        }
        let mut size: Option<(u32, u32)> = None;
        for file in &files {
            let reader = png::Decoder::new(BufReader::new(open_file(file)?)).read_info().map_err(|e| frame_error(file, &e))?;
            let here = (reader.info().width, reader.info().height);
            match size {
                None => size = Some(here),
                Some(first) if first != here => {
                    return Err(SourceError::Frame {
                        file: file_label(file),
                        message: format!("is {}x{} but the first frame is {}x{}", here.0, here.1, first.0, first.1),
                    })
                }
                Some(_) => {}
            }
        }
        let (width, height) = size.unwrap_or((0, 0));
        let spec = FrameSpec { width, height, fps, pixel_format: PixelFormat::Rgba8, frame_count: files.len() as u64 };
        spec.validate()?;
        Ok(PngSequenceSource { spec, files, next: 0 })
    }
}

/// Opens a file, naming it in the error.
fn open_file(path: &Path) -> Result<fs::File, SourceError> {
    fs::File::open(path).map_err(|e| SourceError::Frame { file: file_label(path), message: e.to_string() })
}

/// The file name of a path for messages.
fn file_label(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

/// Wraps a PNG decoding error with the file it came from.
fn frame_error(path: &Path, error: &png::DecodingError) -> SourceError {
    SourceError::Frame { file: file_label(path), message: error.to_string() }
}

impl FrameSource for PngSequenceSource {
    /// Returns the spec derived from the directory listing.
    fn spec(&self) -> FrameSpec {
        self.spec
    }

    /// Decodes the next file to RGBA, compositing any transparency over black so the encoder sees opaque pixels.
    fn next_frame(&mut self, frame: &mut [u8]) -> Result<bool, SourceError> {
        let Some(path) = self.files.get(self.next) else { return Ok(false) };
        self.next += 1;
        let mut decoder = png::Decoder::new(BufReader::new(open_file(path)?));
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().map_err(|e| frame_error(path, &e))?;
        let size = reader.output_buffer_size().ok_or_else(|| SourceError::Frame { file: file_label(path), message: "image is too large to decode".to_string() })?;
        let mut pixels = vec![0u8; size];
        let info = reader.next_frame(&mut pixels).map_err(|e| frame_error(path, &e))?;
        if (info.width, info.height) != (self.spec.width, self.spec.height) {
            return Err(SourceError::Frame { file: file_label(path), message: "changed size since it was listed".to_string() });
        }
        let source = &pixels[..info.buffer_size()];
        let channels = match info.color_type {
            png::ColorType::Rgba => 4,
            png::ColorType::Rgb => 3,
            png::ColorType::GrayscaleAlpha => 2,
            png::ColorType::Grayscale => 1,
            png::ColorType::Indexed => {
                return Err(SourceError::Frame { file: file_label(path), message: "palette image was not expanded".to_string() })
            }
        };
        for (dst, src) in frame.chunks_exact_mut(4).zip(source.chunks_exact(channels)) {
            let (rgb, alpha) = match channels {
                4 => ([src[0], src[1], src[2]], src[3]),
                3 => ([src[0], src[1], src[2]], 255),
                2 => ([src[0]; 3], src[1]),
                _ => ([src[0]; 3], 255),
            };
            for (out, c) in dst.iter_mut().zip(rgb) {
                *out = if alpha == 255 { c } else { ((c as u32 * alpha as u32 + 127) / 255) as u8 };
            }
            dst[3] = 255;
        }
        Ok(true)
    }
}

/// Reads back-to-back raw frames from any reader (a pipe, a file), `frame_count` of them.
pub struct RawStreamSource<R: Read> {
    spec: FrameSpec,
    reader: R,
    delivered: u64,
}

impl<R: Read> RawStreamSource<R> {
    /// Wraps a reader that carries `spec.frame_count` tightly packed frames.
    pub fn new(spec: FrameSpec, reader: R) -> Result<RawStreamSource<R>, SourceError> {
        spec.validate()?;
        Ok(RawStreamSource { spec, reader, delivered: 0 })
    }
}

impl<R: Read> FrameSource for RawStreamSource<R> {
    /// Returns the declared spec.
    fn spec(&self) -> FrameSpec {
        self.spec
    }

    /// Reads exactly one frame, failing when the stream ends early or mid-frame.
    fn next_frame(&mut self, frame: &mut [u8]) -> Result<bool, SourceError> {
        if self.delivered >= self.spec.frame_count {
            return Ok(false);
        }
        match self.reader.read_exact(frame) {
            Ok(()) => {
                self.delivered += 1;
                Ok(true)
            }
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => Err(SourceError::Ended { expected: self.spec.frame_count, got: self.delivered }),
            Err(e) => Err(SourceError::Io(e)),
        }
    }
}
