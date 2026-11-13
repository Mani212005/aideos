//! File Description: The renderer's fonts and text layout. Every typeface comes from a font asset of the Render IR (a vendored file in the package), loaded through Skia's FreeType manager with no system font scan; Skia textlayout (HarfBuzz shaping, ICU line breaking) lays text out against exactly those faces with font fallback disabled, so a render never depends on the fonts installed on the host. Each face is registered under its asset id, so a text node's `font` names one exact file.
//! Inputs and outputs: font asset ids, families, weights and file bytes -> `Fonts`; a `TextSpec` -> a laid-out Skia `Paragraph` (or its measured width).
//! Used by: crate::renderer (loading), crate::raster (overlay text, captions, rail, end card) and crate::raster::svg (SVG text).

use std::collections::BTreeMap;

use skia_safe::font_style::{Slant, Weight, Width};
use skia_safe::textlayout::{
    FontCollection, Paragraph, ParagraphBuilder, ParagraphStyle, TextAlign, TextShadow, TextStyle,
    TypefaceFontProvider,
};
use skia_safe::{Color, FontMgr, FontStyle, Typeface};

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
    pub fn paragraph(&self, spec: &TextSpec, width: f32) -> Paragraph {
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
        if let Some(lh) = spec.line_height {
            style.set_height(lh as f32);
            style.set_height_override(true);
            style.set_half_leading(true);
        }
        for (c, dx, dy, blur) in &spec.shadows {
            // A CSS shadow blur radius is twice the Gaussian standard deviation.
            style.add_shadow(TextShadow::new(
                to_color(*c),
                (*dx as f32, *dy as f32),
                blur / 2.0,
            ));
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
        paragraph
    }

    /// The width of a run laid out on one line.
    pub fn measure(&self, spec: &TextSpec) -> f64 {
        f64::from(self.paragraph(spec, f32::INFINITY).max_intrinsic_width())
    }
}
