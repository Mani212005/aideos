//! File Description: Draws a retained SVG asset with one frame's element states, matching the browser's rendering of the same markup in src/dl/scene/svgReact.tsx: the animated transform is appended to the authored one (translate, then rotate and scale about the origin), a driven opacity replaces the authored one, `drawOn` dashes a stroke over its own length (inherited by the strokeable shapes inside a group), and line endpoint tracks move a line. A compositing layer is used only where the result needs one: a group below full opacity, or a shape with both a fill and a stroke below full opacity.
//! Inputs and outputs: a Skia canvas positioned in the asset's coordinate space, an `SvgDocument`, element states and the fonts -> pixels on the canvas.
//! Used by: crate::raster (stage drawing).

use std::collections::BTreeMap;

use skia_safe::textlayout::TextAlign;
use skia_safe::{
    gradient::{shaders, Colors, Gradient as SkGradient, Interpolation},
    paint, Canvas, ClipOp, Color4f, ContourMeasureIter, Matrix, Paint as SkPaint, Path, PathEffect,
    PathFillType, Point, Rect, Shader, TileMode,
};

use crate::eval::ElementState;
use crate::raster::text::{Fonts, TextSpec};
use crate::svg::color::Rgba;
use crate::svg::{
    ComputedStyle, Element, Gradient, GradientGeometry, Kind, LineCap, LineJoin, LineOverride,
    Paint, Spread, SvgDocument, TextAnchor,
};

/// Everything a draw of one asset needs besides the canvas.
pub struct SvgDraw<'a> {
    pub doc: &'a SvgDocument,
    pub states: &'a BTreeMap<String, ElementState>,
    pub fonts: &'a Fonts,
}

/// Draws the whole document in the canvas's current coordinate space.
pub fn draw_document(canvas: &Canvas, draw: &SvgDraw) {
    let root = ComputedStyle::default();
    for e in &draw.doc.elements {
        draw_element(canvas, draw, e, &root, None);
    }
}

/// The element's animated transform in its own placed space (`svgElementStateToTransform`).
fn state_matrix(s: &ElementState) -> Matrix {
    let mut m = Matrix::new_identity();
    if s.translate_x != 0.0 || s.translate_y != 0.0 {
        m.pre_translate((s.translate_x as f32, s.translate_y as f32));
    }
    let scaled = s.scale_x != 1.0 || s.scale_y != 1.0;
    if scaled || s.rotate != 0.0 {
        m.pre_translate((s.origin_x as f32, s.origin_y as f32));
        if s.rotate != 0.0 {
            m.pre_rotate(s.rotate as f32, None);
        }
        if scaled {
            m.pre_scale((s.scale_x as f32, s.scale_y as f32), None);
        }
        m.pre_translate((-s.origin_x as f32, -s.origin_y as f32));
    }
    m
}

/// Draws one element and its children; `inherited_draw_on` is a group's reveal carried down.
fn draw_element(
    canvas: &Canvas,
    draw: &SvgDraw,
    e: &Element,
    parent: &ComputedStyle,
    inherited_draw_on: Option<f64>,
) {
    if e.hidden {
        return;
    }
    let style = parent.inherit(&e.style);
    let state = e.id.as_ref().and_then(|id| draw.states.get(id));
    let opacity = state.and_then(|s| s.opacity).unwrap_or(e.opacity);
    if opacity <= 0.0 {
        return;
    }
    let own_draw_on = state.map(|s| s.draw_on).filter(|d| *d != 1.0);
    let draw_on = own_draw_on.or(inherited_draw_on);

    canvas.save();
    canvas.concat(&e.transform);
    if let Some(s) = state {
        canvas.concat(&state_matrix(s));
    }
    if let Some(clip) = e
        .clip_path
        .as_ref()
        .and_then(|id| draw.doc.clip_paths.get(id))
    {
        canvas.clip_path(clip, ClipOp::Intersect, true);
    }
    match &e.kind {
        Kind::Group => {
            let layered = opacity < 1.0;
            if layered {
                canvas.save_layer_alpha_f(None, opacity as f32);
            }
            for child in &e.children {
                draw_element(canvas, draw, child, &style, draw_on);
            }
            if layered {
                canvas.restore();
            }
        }
        Kind::Shape(shape) => {
            let line = state.map_or_else(LineOverride::default, |s| LineOverride {
                x1: s.x1,
                y1: s.y1,
                x2: s.x2,
                y2: s.y2,
            });
            if let Some(path) = shape.to_path(line) {
                draw_shape(
                    canvas,
                    draw,
                    &path,
                    shape.is_line(),
                    &style,
                    opacity,
                    draw_on,
                );
            }
        }
        Kind::Text(run) => {
            if style.visible {
                draw_text(canvas, draw, run.x, run.y, &run.content, &style, opacity);
            }
        }
    }
    canvas.restore();
}

/// Builds a paint for a fill or stroke paint value, or None when it paints nothing.
fn make_paint(
    draw: &SvgDraw,
    p: &Paint,
    style: &ComputedStyle,
    alpha: f64,
    bbox: Rect,
) -> Option<SkPaint> {
    let mut paint = SkPaint::default();
    paint.set_anti_alias(true);
    match p {
        Paint::None => return None,
        Paint::Color(c) => {
            paint.set_color4f(color4f(c.with_alpha_scaled(alpha)), None);
        }
        Paint::CurrentColor => {
            paint.set_color4f(color4f(style.color.with_alpha_scaled(alpha)), None);
        }
        Paint::Url(id) => {
            let g = draw.doc.gradients.get(id)?;
            paint.set_shader(gradient_shader(g, bbox, alpha)?);
            paint.set_dither(true);
        }
    };
    Some(paint)
}

/// Converts a straight-alpha colour to Skia's float colour.
fn color4f(c: Rgba) -> Color4f {
    Color4f::new(c.r, c.g, c.b, c.a)
}

/// Builds the Skia shader of a gradient for a shape with bounding box `bbox`, scaled by `alpha`.
fn gradient_shader(g: &Gradient, bbox: Rect, alpha: f64) -> Option<Shader> {
    if g.stops.is_empty() {
        return None;
    }
    let colors: Vec<Color4f> = g
        .stops
        .iter()
        .map(|s| color4f(s.color.with_alpha_scaled(alpha)))
        .collect();
    if g.stops.len() == 1 {
        return Some(skia_safe::shaders::color(colors[0].to_color()));
    }
    let pos: Vec<f32> = g.stops.iter().map(|s| s.offset as f32).collect();
    let tile = match g.spread {
        Spread::Pad => TileMode::Clamp,
        Spread::Reflect => TileMode::Mirror,
        Spread::Repeat => TileMode::Repeat,
    };
    let mut local = Matrix::new_identity();
    if g.bbox_units {
        if bbox.width() <= 0.0 || bbox.height() <= 0.0 {
            return None;
        }
        local = Matrix::concat(
            &Matrix::translate((bbox.left, bbox.top)),
            &Matrix::scale((bbox.width(), bbox.height())),
        );
    }
    local = Matrix::concat(&local, &g.transform);
    let gradient = SkGradient::new(
        Colors::new(&colors, Some(&pos), tile, None),
        Interpolation::default(),
    );
    let pt = |x: f64, y: f64| Point::new(x as f32, y as f32);
    match g.geometry {
        GradientGeometry::Linear { x1, y1, x2, y2 } => {
            shaders::linear_gradient((pt(x1, y1), pt(x2, y2)), &gradient, Some(&local))
        }
        GradientGeometry::Radial { cx, cy, r, fx, fy } => {
            if r <= 0.0 {
                return Some(skia_safe::shaders::color(
                    colors[colors.len() - 1].to_color(),
                ));
            }
            if (fx - cx).abs() < 1e-9 && (fy - cy).abs() < 1e-9 {
                shaders::radial_gradient((pt(cx, cy), r as f32), &gradient, Some(&local))
            } else {
                shaders::two_point_conical_gradient(
                    (pt(fx, fy), 0.0),
                    (pt(cx, cy), r as f32),
                    &gradient,
                    Some(&local),
                )
            }
        }
    }
}

/// Total length of all contours of a path.
fn path_length(path: &Path) -> f64 {
    ContourMeasureIter::new(path, false, None)
        .map(|c| f64::from(c.length()))
        .sum()
}

/// Fills and strokes one shape, with its opacity and an optional draw-on reveal.
fn draw_shape(
    canvas: &Canvas,
    draw: &SvgDraw,
    path: &Path,
    is_line: bool,
    style: &ComputedStyle,
    opacity: f64,
    draw_on: Option<f64>,
) {
    if !style.visible {
        return;
    }
    let bbox = path.compute_tight_bounds();
    let has_fill = !is_line && style.fill != Paint::None;
    let has_stroke = style.stroke != Paint::None && style.stroke_width > 0.0;
    if !has_fill && !has_stroke {
        return;
    }
    // A shape with both a fill and a stroke fades as one picture, which needs a layer; otherwise the
    // opacity goes straight into the paint.
    let layered = opacity < 1.0 && has_fill && has_stroke;
    let paint_alpha = if layered { 1.0 } else { opacity };
    if layered {
        canvas.save_layer_alpha_f(None, opacity as f32);
    }
    if has_fill {
        if let Some(paint) = make_paint(
            draw,
            &style.fill,
            style,
            style.fill_opacity * paint_alpha,
            bbox,
        ) {
            let fill = path.with_fill_type(if style.fill_rule_even_odd {
                PathFillType::EvenOdd
            } else {
                PathFillType::Winding
            });
            canvas.draw_path(&fill, &paint);
        }
    }
    if has_stroke {
        if let Some(mut paint) = make_paint(
            draw,
            &style.stroke,
            style,
            style.stroke_opacity * paint_alpha,
            bbox,
        ) {
            paint.set_style(paint::Style::Stroke);
            paint.set_stroke_width(style.stroke_width as f32);
            paint.set_stroke_cap(match style.stroke_linecap {
                LineCap::Butt => paint::Cap::Butt,
                LineCap::Round => paint::Cap::Round,
                LineCap::Square => paint::Cap::Square,
            });
            paint.set_stroke_join(match style.stroke_linejoin {
                LineJoin::Miter => paint::Join::Miter,
                LineJoin::Round => paint::Join::Round,
                LineJoin::Bevel => paint::Join::Bevel,
            });
            paint.set_stroke_miter(style.stroke_miterlimit as f32);
            let effect = match draw_on {
                // One dash the length of the path plus an offset of the undrawn fraction reveals it evenly.
                Some(d) => {
                    let len = path_length(path) as f32;
                    if len > 0.0 {
                        PathEffect::dash(&[len, len], (1.0 - d.clamp(0.0, 1.0)) as f32 * len)
                    } else {
                        None
                    }
                }
                None => dash_effect(style),
            };
            if draw_on.is_some_and(|d| d <= 0.0) {
                // Fully undrawn: nothing of the stroke shows.
            } else {
                paint.set_path_effect(effect);
                canvas.draw_path(path, &paint);
            }
        }
    }
    if layered {
        canvas.restore();
    }
}

/// The authored `stroke-dasharray` as a Skia dash, or None when it is absent or draws solid.
fn dash_effect(style: &ComputedStyle) -> Option<PathEffect> {
    let mut intervals: Vec<f32> = style.stroke_dasharray.iter().map(|v| *v as f32).collect();
    if intervals.is_empty()
        || intervals.iter().any(|v| *v < 0.0)
        || intervals.iter().all(|v| *v == 0.0)
    {
        return None;
    }
    if intervals.len() % 2 == 1 {
        intervals.extend(intervals.clone());
    }
    PathEffect::dash(&intervals, style.stroke_dashoffset as f32)
}

/// Draws one run of SVG text with its baseline at (x, y), anchored start, middle or end.
fn draw_text(
    canvas: &Canvas,
    draw: &SvgDraw,
    x: f64,
    y: f64,
    content: &str,
    style: &ComputedStyle,
    opacity: f64,
) {
    let Paint::Color(color) = (match &style.fill {
        Paint::CurrentColor => Paint::Color(style.color),
        other => other.clone(),
    }) else {
        return;
    };
    // The renderer checked at load that every text's family resolves, so a miss here draws nothing.
    let Some(font) = draw
        .fonts
        .resolve_family(&style.font_family, style.font_weight)
    else {
        return;
    };
    let spec = TextSpec {
        text: content,
        font,
        size: style.font_size,
        color: color.with_alpha_scaled(style.fill_opacity * opacity),
        letter_spacing: style.letter_spacing,
        line_height: None,
        align: TextAlign::Left,
        shadows: Vec::new(),
    };
    let paragraph = draw.fonts.paragraph(&spec, f32::INFINITY);
    let width = f64::from(paragraph.max_intrinsic_width());
    let left = match style.text_anchor {
        TextAnchor::Start => x,
        TextAnchor::Middle => x - width / 2.0,
        TextAnchor::End => x - width,
    };
    paragraph.paint(
        canvas,
        Point::new(
            left as f32,
            (y - f64::from(paragraph.alphabetic_baseline())) as f32,
        ),
    );
}

/// Every text element's (font-family, font-weight) in a document, for checking at load that each resolves.
pub fn text_fonts(doc: &SvgDocument) -> Vec<(String, u32)> {
    /// Walks the tree collecting the computed font of each text run.
    fn walk(elements: &[Element], parent: &ComputedStyle, out: &mut Vec<(String, u32)>) {
        for e in elements {
            let style = parent.inherit(&e.style);
            if matches!(e.kind, Kind::Text(_)) {
                out.push((style.font_family.clone(), style.font_weight));
            }
            walk(&e.children, &style, out);
        }
    }
    let mut out = Vec::new();
    walk(&doc.elements, &ComputedStyle::default(), &mut out);
    out
}
