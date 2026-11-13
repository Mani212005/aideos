//! File Description: Text measurement with the renderer's own fonts and layout engine, so the TypeScript emitter lays out text cards with exactly the metrics the raster draws them with (one set of metrics for layout and drawing). A request names vendored font files and the runs to measure; the answer gives each run's single-line width and each requested face's line metrics.
//! Inputs and outputs: a `MeasureRequest` (font files, runs, line-metric queries) -> a `MeasureReport` (widths and line metrics, all in pixels).
//! Used by: the `aideos-render measure` CLI (src/main.rs), backend/renderIr/emit.ts through it, and tests/measure.rs.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use skia_safe::textlayout::TextAlign;

use crate::raster::text::{Fonts, TextSpec};
use crate::svg::color::Rgba;

/// One font file to load for measuring.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeasureFont {
    pub id: String,
    /// Absolute, or relative to the request file's directory.
    pub path: PathBuf,
    pub family: String,
    pub weight: u32,
}

/// One run of text measured on a single line.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeasureRun {
    pub text: String,
    pub font: String,
    pub size: f64,
    /// Extra advance after each glyph, in pixels (CSS `letter-spacing` resolved to pixels).
    #[serde(default)]
    pub letter_spacing: f64,
}

/// A face and size whose `line-height: normal` metrics are wanted.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricsQuery {
    pub font: String,
    pub size: f64,
}

/// What to measure.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeasureRequest {
    pub fonts: Vec<MeasureFont>,
    #[serde(default)]
    pub runs: Vec<MeasureRun>,
    #[serde(default)]
    pub metrics: Vec<MetricsQuery>,
}

/// The line metrics of one face at one size, from a single laid-out line with no line-height override.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct LineMetrics {
    /// Distance from the line top to the baseline.
    pub baseline: f64,
    /// The line's height (`line-height: normal`).
    pub height: f64,
    pub ascent: f64,
    pub descent: f64,
}

/// The measured widths (in run order) and line metrics (in query order).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MeasureReport {
    pub widths: Vec<f64>,
    pub metrics: Vec<LineMetrics>,
}

/// A white run spec for measuring (colour does not affect metrics).
fn spec<'a>(text: &'a str, font: &'a str, size: f64, letter_spacing: f64) -> TextSpec<'a> {
    TextSpec {
        text,
        font,
        size,
        color: Rgba {
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
        },
        letter_spacing,
        line_height: None,
        align: TextAlign::Left,
        shadows: Vec::new(),
    }
}

/// Loads the request's fonts and measures every run and metrics query; `base` resolves relative font paths.
pub fn measure(request: &MeasureRequest, base: &Path) -> Result<MeasureReport, String> {
    let mut files = Vec::new();
    for f in &request.fonts {
        let path = if f.path.is_absolute() {
            f.path.clone()
        } else {
            base.join(&f.path)
        };
        let bytes = std::fs::read(&path)
            .map_err(|e| format!("font {:?}: cannot read {}: {e}", f.id, path.display()))?;
        files.push((f.id.clone(), f.family.clone(), f.weight, bytes));
    }
    let fonts = Fonts::load(files).map_err(|e| e.0)?;
    let known = |id: &str| -> Result<(), String> {
        fonts
            .face(id)
            .map(|_| ())
            .ok_or_else(|| format!("no font {id:?} in the request"))
    };
    let mut widths = Vec::with_capacity(request.runs.len());
    for run in &request.runs {
        known(&run.font)?;
        if !(run.size.is_finite() && run.size > 0.0) {
            return Err(format!("run {:?}: size must be above 0", run.text));
        }
        widths.push(fonts.measure(&spec(&run.text, &run.font, run.size, run.letter_spacing)));
    }
    let mut metrics = Vec::with_capacity(request.metrics.len());
    for q in &request.metrics {
        known(&q.font)?;
        if !(q.size.is_finite() && q.size > 0.0) {
            return Err(format!("metrics for {:?}: size must be above 0", q.font));
        }
        let paragraph = fonts.paragraph(&spec("Hx", &q.font, q.size, 0.0), f32::INFINITY);
        let line = paragraph
            .get_line_metrics()
            .into_iter()
            .next()
            .ok_or_else(|| format!("metrics for {:?}: no line was laid out", q.font))?;
        metrics.push(LineMetrics {
            baseline: line.baseline,
            height: line.height,
            ascent: line.ascent,
            descent: line.descent,
        });
    }
    Ok(MeasureReport { widths, metrics })
}
