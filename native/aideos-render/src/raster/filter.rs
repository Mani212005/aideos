//! File Description: Builds the Skia image filter of a parsed SVG filter the way Chrome's Blink builds it (SkiaImageFilterBuilder): SourceGraphic is the element's layer cropped to the filter region, SourceAlpha its alpha on black, every primitive is cropped to the region (the subset has no primitive subregions, so each subregion is the region), each input is converted into the primitive's colour space (sRGB to linearRGB and back with Skia's gamma colour filters, the flood colour converted once) and the last result is converted back to sRGB. Blur is Skia's Gaussian with the standard deviation as sigma and transparent edges, composite is the Porter-Duff blend or the arithmetic filter with premultiplied clamping, and merge is source-over in order.
//! Inputs and outputs: a `Filter` and its region in the element's user space -> a Skia `ImageFilter` for the element's layer, or None when the filter draws nothing.
//! Used by: crate::raster::svg (drawing an element with a `filter` attribute).

use skia_safe::{
    color_filters, image_filters, BlendMode, Color4f, ColorFilter, ColorSpace as SkColorSpace,
    ImageFilter, Rect, TileMode,
};

use crate::svg::color::Rgba;
use crate::svg::filter::{ColorSpace, CompositeOperator, Filter, FilterInput, FilterOp};

/// One built result: its filter (None never occurs for a result; SourceGraphic is an explicit crop) and its colour space.
#[derive(Clone)]
struct Built {
    filter: ImageFilter,
    space: ColorSpace,
}

/// The region of a filter for an element whose bounding box (in its user space) is `bbox`; None when it is empty.
pub fn filter_region(filter: &Filter, bbox: Option<Rect>) -> Option<Rect> {
    let r = filter.region;
    let rect = if r.bbox_units {
        let b = bbox?;
        Rect::from_xywh(
            (f64::from(b.left) + r.x * f64::from(b.width())) as f32,
            (f64::from(b.top) + r.y * f64::from(b.height())) as f32,
            (r.width * f64::from(b.width())) as f32,
            (r.height * f64::from(b.height())) as f32,
        )
    } else {
        Rect::from_xywh(r.x as f32, r.y as f32, r.width as f32, r.height as f32)
    };
    (rect.width() > 0.0 && rect.height() > 0.0).then_some(rect)
}

/// Converts a filter's output from one colour space to another (a no-op when they match).
fn convert(built: Built, to: ColorSpace) -> Option<Built> {
    if built.space == to {
        return Some(built);
    }
    let cf: ColorFilter = match to {
        ColorSpace::LinearRgb => color_filters::srgb_to_linear_gamma(),
        ColorSpace::Srgb => color_filters::linear_to_srgb_gamma(),
    };
    Some(Built {
        filter: image_filters::color_filter(cf, built.filter, None)?,
        space: to,
    })
}

/// The sRGB transfer function decoded to linear light, for one channel in [0, 1].
fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// A flood colour expressed in the primitive's colour space (Blink's AdaptColorToOperatingInterpolationSpace).
fn flood_color(c: Rgba, space: ColorSpace) -> Color4f {
    match space {
        ColorSpace::Srgb => Color4f::new(c.r, c.g, c.b, c.a),
        ColorSpace::LinearRgb => Color4f::new(
            srgb_to_linear(c.r),
            srgb_to_linear(c.g),
            srgb_to_linear(c.b),
            c.a,
        ),
    }
}

/// The alpha channel of the input on black: SourceAlpha.
fn alpha_only() -> ColorFilter {
    #[rustfmt::skip]
    let m: [f32; 20] = [
        0.0, 0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 1.0, 0.0,
    ];
    color_filters::matrix_row_major(&m, None)
}

/// Builds the image filter of `filter` over the region `region` (user space); None when it draws nothing.
pub fn build(filter: &Filter, region: Rect) -> Option<ImageFilter> {
    if filter.primitives.is_empty() {
        // A filter with no primitives makes the element draw nothing (Filter Effects 1, as Chrome does).
        return None;
    }
    let source = Built {
        filter: image_filters::offset((0.0, 0.0), None, region)?,
        space: ColorSpace::Srgb,
    };
    let source_alpha = Built {
        filter: image_filters::color_filter(alpha_only(), source.filter.clone(), region)?,
        space: ColorSpace::Srgb,
    };
    let mut results: Vec<Built> = Vec::with_capacity(filter.primitives.len());
    for p in &filter.primitives {
        let take = |i: FilterInput, results: &Vec<Built>| -> Option<Built> {
            let built = match i {
                FilterInput::SourceGraphic => source.clone(),
                FilterInput::SourceAlpha => source_alpha.clone(),
                FilterInput::Result(index) => results.get(index)?.clone(),
            };
            convert(built, p.space)
        };
        let out = match &p.op {
            FilterOp::Blur {
                input,
                std_x,
                std_y,
            } => {
                let i = take(*input, &results)?;
                if *std_x == 0.0 && *std_y == 0.0 {
                    // A zero deviation disables the blur: the result is the input.
                    image_filters::offset((0.0, 0.0), i.filter, region)?
                } else {
                    image_filters::blur(
                        (*std_x as f32, *std_y as f32),
                        TileMode::Decal,
                        i.filter,
                        region,
                    )?
                }
            }
            FilterOp::Offset { input, dx, dy } => {
                let i = take(*input, &results)?;
                image_filters::offset((*dx as f32, *dy as f32), i.filter, region)?
            }
            FilterOp::Flood { color } => {
                let shader = skia_safe::shaders::color_in_space(
                    flood_color(*color, p.space),
                    SkColorSpace::new_srgb(),
                );
                image_filters::shader(shader, region)?
            }
            FilterOp::Composite {
                input,
                input2,
                operator,
            } => {
                let fg = take(*input, &results)?;
                let bg = take(*input2, &results)?;
                match operator {
                    CompositeOperator::Arithmetic { k1, k2, k3, k4 } => image_filters::arithmetic(
                        *k1 as f32, *k2 as f32, *k3 as f32, *k4 as f32, true, bg.filter, fg.filter,
                        region,
                    )?,
                    op => {
                        let mode = match op {
                            CompositeOperator::Over => BlendMode::SrcOver,
                            CompositeOperator::In => BlendMode::SrcIn,
                            CompositeOperator::Out => BlendMode::SrcOut,
                            CompositeOperator::Atop => BlendMode::SrcATop,
                            _ => BlendMode::Xor,
                        };
                        image_filters::blend(mode, bg.filter, fg.filter, region)?
                    }
                }
            }
            FilterOp::Merge { inputs } => {
                let mut layers = Vec::with_capacity(inputs.len());
                for i in inputs {
                    layers.push(Some(take(*i, &results)?.filter));
                }
                if layers.is_empty() {
                    // An empty merge is transparent black over the region.
                    image_filters::shader(
                        skia_safe::shaders::color(skia_safe::Color::TRANSPARENT),
                        region,
                    )?
                } else {
                    image_filters::merge(layers, region)?
                }
            }
        };
        results.push(Built {
            filter: out,
            space: p.space,
        });
    }
    let last = convert(results.pop()?, ColorSpace::Srgb)?;
    image_filters::crop(region, TileMode::Decal, last.filter)
}
