//! File Description: The renderer's fonts and text layout. Every typeface comes from a font asset of the Render IR (a vendored file in the package), loaded through Skia's FreeType manager with no system font scan; Skia textlayout (HarfBuzz shaping, ICU line breaking) lays text out against exactly those faces with font fallback disabled, so a render never depends on the fonts installed on the host. Each face is registered under its asset id, so a text node's `font` names one exact file. Text is shaped and placed as Blink does: optional ligatures off when letter spacing is not zero, all of the letter spacing after each glyph whatever the alignment, HTML baselines on whole pixels and SVG baselines exactly on `y`.
//! Inputs and outputs: font asset ids, families, weights and file bytes -> `Fonts`; a `TextSpec` -> a laid-out `Text` (a Skia `Paragraph` plus the way its glyphs are painted) or its measured width.
//! Used by: crate::renderer (loading), crate::raster (overlay text, captions, rail, end card) and crate::raster::svg (SVG text).

use std::cell::RefCell;
use std::collections::BTreeMap;

use aideos_render_ir::types::{GlyphProperty, GlyphTrack};

use skia_safe::font_style::{Slant, Weight, Width};
use skia_safe::textlayout::{
    FontCollection, Paragraph, ParagraphBuilder, ParagraphStyle, TextAlign, TextStyle, TypefaceFontProvider,
};
use skia_safe::font_arguments::{variation_position::Coordinate, VariationPosition};
use skia_safe::canvas::GlyphPositions;
use skia_safe::{
    Canvas, Color, FontArguments, FontHinting, FontMgr, FontStyle, FourByteTag, MaskFilter, Paint, Point,
    Typeface,
};
use skia_safe::BlurStyle;

use crate::svg::color::Rgba;

/// One loaded font file.
#[derive(Debug, Clone)]
pub struct Face {
    pub family: String,
    pub weight: u32,
}

/// What to lay out: one run of text in one face.
#[derive(Debug, Clone)]
pub struct TextSpec<'a> {
    pub text: &'a str,
    /// Font asset id.
    pub font: &'a str,
    pub size: f64,
    pub color: Rgba,
    /// Extra advance after each glyph, in pixels.
    pub letter_spacing: f64,
    /// Line height as a multiple of the font size (CSS `line-height`), or the font's own when None.
    pub line_height: Option<f64>,
    pub align: TextAlign,
    /// Shadows as (colour, dx, dy, blur radius in CSS pixels).
    pub shadows: Vec<(Rgba, f64, f64, f64)>,
}

/// Converts a straight-alpha colour to Skia's 8-bit colour.
pub fn to_color(c: Rgba) -> Color {
    let ch = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    Color::from_argb(ch(c.a), ch(c.r), ch(c.g), ch(c.b))
}

/// Sets a variable font's weight axis to the asset's `weight` (clamped to the axis range), as a browser does for
/// `font-weight` on a variable face; a static font is returned unchanged.
fn instance_at_weight(typeface: Typeface, weight: u32) -> Option<Typeface> {
    let wght = FourByteTag::from_chars('w', 'g', 'h', 't');
    let Some(axis) = typeface
        .variation_design_parameters()
        .and_then(|axes| axes.into_iter().find(|a| a.tag == wght))
    else {
        return Some(typeface);
    };
    let value = (weight as f32).clamp(axis.min, axis.max);
    let coordinates = [Coordinate { axis: wght, value }];
    let args = FontArguments::new().set_variation_design_position(VariationPosition {
        coordinates: &coordinates,
    });
    typeface.clone_with_arguments(&args)
}

/// The vendored faces and the font collection that lays text out with them.
pub struct Fonts {
    collection: FontCollection,
    faces: BTreeMap<String, Face>,
}

/// Why a font file could not be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontError(pub String);

impl Fonts {
    /// Loads font files (asset id, family, weight, bytes) into a collection that sees only them.
    pub fn load(files: Vec<(String, String, u32, Vec<u8>)>) -> Result<Fonts, FontError> {
        // FreeType with no system scan where Skia has it (Linux, the reference); macOS Skia has no FreeType,
        // so the platform manager reads the same files there. Either way only these files are ever used.
        let manager = FontMgr::custom_empty().unwrap_or_default();
        let mut provider = TypefaceFontProvider::new();
        let mut faces = BTreeMap::new();
        for (id, family, weight, bytes) in files {
            let typeface: Typeface = manager
                .new_from_data(skia_safe::Data::new_copy(&bytes), None)
                .ok_or_else(|| {
                    FontError(format!(
                        "font asset {id:?} is not a font file Skia can read"
                    ))
                })?;
            let typeface = instance_at_weight(typeface, weight).ok_or_else(|| {
                FontError(format!(
                    "font asset {id:?} is a variable font that cannot be set to weight {weight}"
                ))
            })?;
            provider.register_typeface(typeface, Some(id.as_str()));
            faces.insert(id, Face { family, weight });
        }
        let mut collection = FontCollection::new();
        collection.set_asset_font_manager(Some(provider.into()));
        collection.set_dynamic_font_manager(None);
        collection.disable_font_fallback();
        Ok(Fonts { collection, faces })
    }

    /// The face of a font asset.
    pub fn face(&self, id: &str) -> Option<&Face> {
        self.faces.get(id)
    }

    /// Resolves a CSS font-family list and weight to a font asset id: the first family that has a face,
    /// at the nearest weight. Generic `monospace` picks a family whose name contains "Mono"; other generic
    /// names pick the first family that does not.
    pub fn resolve_family(&self, family_list: &str, weight: u32) -> Option<&str> {
        for raw in family_list.split(',') {
            let name = raw.trim().trim_matches(['"', '\'']).to_ascii_lowercase();
            let matches = |f: &Face| -> bool {
                let fam = f.family.to_ascii_lowercase();
                match name.as_str() {
                    "monospace" | "ui-monospace" => fam.contains("mono"),
                    "sans-serif" | "serif" | "system-ui" | "ui-sans-serif" | "cursive"
                    | "fantasy" => !fam.contains("mono"),
                    _ => fam == name,
                }
            };
            let candidates: Vec<(&String, &Face)> =
                self.faces.iter().filter(|(_, f)| matches(f)).collect();
            let generic_pick = candidates.first().map(|(_, f)| f.family.clone());
            // A generic name settles on one family before picking the weight.
            let best = candidates
                .iter()
                .filter(|(_, f)| Some(&f.family) == generic_pick.as_ref())
                .min_by_key(|(id, f)| (f.weight.abs_diff(weight), (*id).clone()));
            if let Some((id, _)) = best {
                return Some(id.as_str());
            }
        }
        None
    }

    /// Lays a text run out to `width` pixels (use `f32::INFINITY` for a single unwrapped line).
    pub fn paragraph(&self, spec: &TextSpec, width: f32) -> Text {
        let weight = self.faces.get(spec.font).map_or(400, |f| f.weight);
        let mut style = TextStyle::new();
        style.set_font_families(&[spec.font]);
        style.set_font_style(FontStyle::new(
            Weight::from(weight as i32),
            Width::NORMAL,
            Slant::Upright,
        ));
        style.set_font_size(spec.size as f32);
        style.set_color(to_color(spec.color));
        style.set_letter_spacing(spec.letter_spacing as f32);
        if spec.letter_spacing != 0.0 {
            // Blink turns the optional ligatures off when letter spacing is not zero (CSS Text 3, `letter-spacing`):
            // Geist joins "tt" and "ti", so a spaced word set with them would be up to 2 px narrower than Chrome's.
            style.add_font_feature("liga", 0);
            style.add_font_feature("clig", 0);
        }
        if let Some(lh) = spec.line_height {
            style.set_height(lh as f32);
            style.set_height_override(true);
            style.set_half_leading(true);
        }
        let mut pstyle = ParagraphStyle::new();
        pstyle.set_text_style(&style);
        pstyle.set_text_align(spec.align);
        pstyle.set_apply_rounding_hack(false);
        pstyle.turn_hinting_off();
        let mut builder = ParagraphBuilder::new(&pstyle, self.collection.clone());
        builder.push_style(&style);
        builder.add_text(spec.text);
        let mut paragraph = builder.build();
        paragraph.layout(width);
        Text {
            paragraph: RefCell::new(paragraph),
            color: to_color(spec.color),
            shadows: spec.shadows.clone(),
            line_height_px: spec.line_height.map(|lh| lh * spec.size),
            letter_spacing: spec.letter_spacing,
            align: spec.align,
        }
    }

    /// The width of a run laid out on one line.
    pub fn measure(&self, spec: &TextSpec) -> f64 {
        f64::from(self.paragraph(spec, f32::INFINITY).max_intrinsic_width())
    }
}

/// A laid-out run of text. Skia's paragraph does the shaping and line breaking; the glyphs are painted here, because the
/// paragraph painter draws them with FreeType's slight vertical hinting whatever the paragraph style says, while the
/// Chrome render draws unhinted outlines (a cap height of 32 px at 45 px Geist, where slight hinting snaps it to 33).
pub struct Text {
    paragraph: RefCell<Paragraph>,
    color: Color,
    /// CSS `text-shadow` list as (colour, dx, dy, blur radius): the first shadow is the top one.
    shadows: Vec<(Rgba, f64, f64, f64)>,
    /// The CSS line height in pixels, or None for `line-height: normal`.
    line_height_px: Option<f64>,
    /// Extra advance after each glyph in pixels (CSS `letter-spacing`).
    letter_spacing: f64,
    /// The alignment the paragraph was laid out with.
    align: TextAlign,
}

/// Whether Skia still shifts a laid-out line right by half the letter spacing. Skia puts that half before the first glyph
/// of every line, but `TextLine::format` replaces the line's shift with the alignment offset when a right-aligned or
/// centred line is narrower than the layout width, which drops the half.
fn keeps_half_letter_spacing(align: TextAlign, layout_width: f32, line_width: f64) -> bool {
    match align {
        TextAlign::Right | TextAlign::End | TextAlign::Center => f64::from(layout_width) - line_width <= 0.0,
        _ => true,
    }
}

/// One shaped run read back from the paragraph: its font, glyph ids and positions relative to the origin.
struct GlyphRun {
    /// Where the browser puts the baseline of that line, relative to the paragraph's top.
    baseline: f64,
    /// The horizontal shift that moves Skia's glyphs to CSS positions (all of the letter spacing after each glyph).
    dx: f32,
    font: skia_safe::Font,
    glyphs: Vec<u16>,
    positions: Vec<Point>,
    origin: Point,
}

impl Text {
    /// The laid-out height in pixels: each line is as tall as the browser makes it (the CSS line height in 1/64 px, or
    /// the sum of the font's rounded ascent, descent and gap for `normal`), where Skia rounds a line up to whole pixels.
    pub fn height(&self) -> f32 {
        let paragraph = self.paragraph.borrow();
        let lines = paragraph.line_number().max(1) as f64;
        let line = match self.line_height_px {
            Some(px) => (px * 64.0).floor() / 64.0,
            None => return paragraph.height(),
        };
        (lines * line) as f32
    }

    /// The width of the text on one unwrapped line.
    pub fn max_intrinsic_width(&self) -> f32 {
        self.paragraph.borrow().max_intrinsic_width()
    }

    /// The first laid-out line's (baseline, height, ascent, descent), or None when nothing was laid out.
    pub fn first_line(&self) -> Option<(f64, f64, f64, f64)> {
        let paragraph = self.paragraph.borrow();
        let lines = paragraph.get_line_metrics();
        lines.first().map(|l| (l.baseline, l.height, l.ascent, l.descent))
    }

    /// Reads the shaped runs back from the paragraph, each with its font set to no hinting.
    fn runs(&self) -> Vec<GlyphRun> {
        let mut runs: Vec<GlyphRun> = Vec::new();
        let line_height = self.line_height_px;
        let (layout_width, line_widths) = {
            let paragraph = self.paragraph.borrow();
            (paragraph.max_width(), paragraph.get_line_metrics().iter().map(|l| l.width).collect::<Vec<f64>>())
        };
        let (align, half) = (self.align, self.letter_spacing / 2.0);
        self.paragraph.borrow_mut().visit(|line, info| {
            let Some(info) = info else { return };
            let mut font = info.font().clone();
            font.set_hinting(FontHinting::None);
            let count = info.count();
            // Blink rounds the font's ascent, descent and gap to whole pixels, puts half of the leading above the line
            // (rounded down) and rounds the baseline to a whole pixel when it paints, so the glyphs sit on the pixel grid.
            let (_, metrics) = font.metrics();
            let (ascent, descent) = (f64::from(-metrics.ascent).round(), f64::from(metrics.descent).round());
            let height = line_height.unwrap_or(ascent + descent + f64::from(metrics.leading).round());
            let baseline = ascent + ((height - (ascent + descent)) / 2.0).floor() + line as f64 * height;
            // CSS puts all of the letter spacing after each glyph; take back the half Skia puts before the line.
            let line_width = line_widths.get(line).copied().unwrap_or(0.0);
            let dx = if keeps_half_letter_spacing(align, layout_width, line_width) { -half as f32 } else { 0.0 };
            runs.push(GlyphRun {
                baseline,
                dx,
                font,
                glyphs: info.glyphs()[..count].to_vec(),
                positions: info.positions()[..count].to_vec(),
                origin: info.origin(),
            });
        });
        runs
    }

    /// Paints HTML text with its top-left corner at `at`, placed as Blink places it (baseline on a whole pixel).
    pub fn paint(&self, canvas: &Canvas, at: impl Into<Point>) {
        self.paint_with(canvas, at.into(), true);
    }

    /// Counts shaped glyphs in the paragraph's paint order, including spaces and ligatures.
    pub fn glyph_count(&self) -> usize {
        self.runs().iter().map(|run| run.glyphs.len()).sum()
    }

    /// Paints individually tracked glyphs at their shaped positions, without changing layout or advances.
    pub fn paint_glyph_tracks(&self, canvas: &Canvas, at: Point, tracks: &[GlyphTrack], time: f64, duration: u32) {
        let mut poses: BTreeMap<u32, (f64, f64, f64, f64, f64)> = BTreeMap::new();
        for track in tracks {
            let pose = poses.entry(track.glyph.0).or_insert((0.0, 0.0, 1.0, 0.0, 1.0));
            let value = crate::eval::track::sample_at(&track.keyframes, time, duration);
            match track.property {
                GlyphProperty::X => pose.0 = value,
                GlyphProperty::Y => pose.1 = value,
                GlyphProperty::Scale => pose.2 = value,
                GlyphProperty::Rotation => pose.3 = value,
                GlyphProperty::Opacity => pose.4 = value,
            }
        }
        let mut index = 0u32;
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        for run in self.runs() {
            let baseline = (f64::from(at.y) + run.baseline).round() as f32;
            for (&glyph, position) in run.glyphs.iter().zip(&run.positions) {
                let &(x, y, scale, rotation, opacity) = poses.get(&index).unwrap_or(&(0.0, 0.0, 1.0, 0.0, 1.0));
                index += 1;
                if opacity <= 0.0 { continue; }
                paint.set_color(self.color);
                paint.set_alpha_f(self.color.a() as f32 / 255.0 * opacity as f32);
                canvas.save();
                canvas.translate((run.origin.x + at.x + run.dx + position.x + x as f32, baseline + position.y + y as f32));
                canvas.rotate(rotation as f32, None);
                canvas.scale((scale as f32, scale as f32));
                canvas.draw_glyphs_at(&[glyph], GlyphPositions::Points(&[Point::new(0.0, 0.0)]), Point::new(0.0, 0.0), &run.font, &paint);
                canvas.restore();
            }
        }
    }

    /// Paints SVG text with its first line's baseline exactly at `at` (an SVG `y` is the baseline), unrounded.
    pub fn paint_on_baseline(&self, canvas: &Canvas, at: impl Into<Point>) {
        self.paint_with(canvas, at.into(), false);
    }

    /// Paints the text: the shadows from the last to the first, then the glyphs, with `at` the top-left corner and the
    /// baseline snapped (HTML) or `at` the first baseline, unrounded (SVG).
    fn paint_with(&self, canvas: &Canvas, at: Point, snap_baseline: bool) {
        let runs = self.runs();
        // Skia's run origin sits on its own rounded ascent, not on `alphabetic_baseline`, so SVG text is placed from the run.
        let first_baseline = runs.first().map_or(0.0, |run| run.origin.y);
        let draw = |paint: &Paint, offset: Point| {
            for run in &runs {
                let y = if snap_baseline {
                    (f64::from(at.y) + run.baseline).round() as f32
                } else {
                    at.y + run.origin.y - first_baseline
                };
                let origin = Point::new(run.origin.x + at.x + offset.x + run.dx, y + offset.y);
                canvas.draw_glyphs_at(&run.glyphs, GlyphPositions::Points(&run.positions), origin, &run.font, paint);
            }
        };
        for (color, dx, dy, blur) in self.shadows.iter().rev() {
            let color = to_color(*color);
            if color.a() == 0 {
                continue;
            }
            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_color(color);
            if *blur > 0.0 {
                // A CSS shadow blur radius is twice the Gaussian standard deviation.
                paint.set_mask_filter(MaskFilter::blur(BlurStyle::Normal, (*blur / 2.0) as f32, false));
            }
            draw(&paint, Point::new(*dx as f32, *dy as f32));
        }
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_color(self.color);
        draw(&paint, Point::new(0.0, 0.0));
    }
}
