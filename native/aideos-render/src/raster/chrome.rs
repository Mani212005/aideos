//! File Description: Draws the film chrome of the overlay: the chapter rail (Film.tsx `Rail`), the kinetic captions (KineticSubtitles.tsx: a blurred-backdrop card with word karaoke, glow and the active word's spring settle) and the like-and-subscribe end card (EndCard.tsx: the dim, the staggered entrances, the chips and the subscribe press). Geometry comes from the IR's per-format placement and layout; what the IR does not carry (the end card's surface, hairline and muted colours) is derived from its colours as documented in docs/NATIVE_RENDERER.md.
//! Inputs and outputs: a canvas, the overlay context and a rail, captions or end card node -> pixels on the canvas.
//! Used by: crate::raster (overlay drawing).

use aideos_render_ir::types::{CaptionsNode, EndCardNode, RailNode};
use skia_safe::canvas::SaveLayerRec;
use skia_safe::textlayout::TextAlign;
use skia_safe::{
    gradient::{shaders, Colors, Gradient, Interpolation},
    image_filters, paint, BlurStyle, Canvas, ClipOp, Color4f, MaskFilter, Paint, Path, Point,
    RRect, Rect, TileMode,
};

use crate::eval::{self, captions, Format};
use crate::svg::color::Rgba;

use super::text::{to_color, TextSpec};
use super::{ir_color, OverlayCtx};

/// A solid anti-aliased fill paint.
fn fill(c: Rgba) -> Paint {
    let mut p = Paint::default();
    p.set_anti_alias(true);
    p.set_color(to_color(c));
    p
}

/// An anti-aliased stroke paint.
fn stroke(c: Rgba, width: f64) -> Paint {
    let mut p = fill(c);
    p.set_style(paint::Style::Stroke);
    p.set_stroke_width(width as f32);
    p
}

/// Draws a CSS-style outer box shadow of a rounded rect: offset, blurred, and not painted under the box.
fn box_shadow(canvas: &Canvas, rr: &RRect, dy: f64, blur: f64, color: Rgba) {
    canvas.save();
    canvas.clip_rrect(*rr, ClipOp::Difference, true);
    let mut p = fill(color);
    if blur > 0.0 {
        p.set_mask_filter(MaskFilter::blur(
            BlurStyle::Normal,
            (blur / 2.0) as f32,
            false,
        ));
    }
    canvas.draw_rrect(rr.with_offset((0.0, dy as f32)), &p);
    canvas.restore();
}

/// Draws the chapter rail: its scrim, the chapter label and timestamp, and the chapter bar.
pub fn draw_rail(canvas: &Canvas, ctx: &OverlayCtx, node: &RailNode) {
    if !eval::is_visible(node.visible.as_ref(), ctx.frame) || node.chapters.is_empty() {
        return;
    }
    let Some(b) = ctx.format.pick(&node.placement) else {
        return;
    };
    let state = eval::rail_state(&node.chapters, ctx.fps(), ctx.frame, ctx.dur());
    let (w, h) = (f64::from(ctx.width), f64::from(ctx.height));
    let k = ctx.k();
    super::with_opacity(canvas, node.opacity.unwrap_or(1.0), || {
        // The scrim: opaque for the band the rail sits in, then faded out upward.
        let scrim = ir_color(&node.scrim);
        let top = h - b.scrim_height;
        let colors = [
            Color4f::new(scrim.r, scrim.g, scrim.b, 0.0),
            Color4f::new(scrim.r, scrim.g, scrim.b, scrim.a),
            Color4f::new(scrim.r, scrim.g, scrim.b, scrim.a),
        ];
        let pos = [0.0f32, 0.44, 1.0];
        let gradient = Gradient::new(
            Colors::new(&colors, Some(&pos), TileMode::Clamp, None),
            Interpolation::default(),
        );
        if let Some(shader) =
            shaders::linear_gradient(((0.0, top as f32), (0.0, h as f32)), &gradient, None)
        {
            let mut p = Paint::default();
            p.set_shader(shader);
            p.set_dither(true);
            canvas.draw_rect(
                Rect::from_xywh(0.0, top as f32, w as f32, b.scrim_height as f32),
                &p,
            );
        }
        // The label row: chapter name on the left, timestamp on the right.
        let ink = ir_color(&node.ink);
        let row = |text: &str, align: TextAlign| {
            let spec = TextSpec {
                text,
                font: &node.font,
                size: b.font_size,
                color: ink,
                letter_spacing: 0.14 * b.font_size,
                line_height: None,
                align,
                shadows: Vec::new(),
            };
            ctx.l
                .fonts
                .paragraph(&spec, b.w as f32)
                .paint(canvas, (b.x as f32, b.y as f32));
        };
        row(&state.label, TextAlign::Left);
        row(&state.stamp, TextAlign::Right);
        // The bar at the bottom of the box: chapter segments in the long cut, one continuous bar in a reel.
        let track = ir_color(&node.track_color);
        match ctx.format {
            Format::Long => {
                let n = node.chapters.len() as f64;
                let gap = 8.0 * k;
                let thick = 2.0 * k;
                let seg = ((b.w - gap * (n - 1.0)) / n).max(0.0);
                for i in 0..node.chapters.len() {
                    let x = b.x + i as f64 * (seg + gap);
                    let color = if i <= state.chapter_index { ink } else { track };
                    let r = Rect::from_xywh(
                        x as f32,
                        (b.y + b.h - thick) as f32,
                        seg as f32,
                        thick as f32,
                    );
                    canvas.draw_rect(r, &fill(color));
                }
            }
            Format::Reel => {
                let thick = 3.0 * k;
                let radius = (2.0 * k) as f32;
                let y = (b.y + b.h - thick) as f32;
                let whole = RRect::new_rect_xy(
                    Rect::from_xywh(b.x as f32, y, b.w as f32, thick as f32),
                    radius,
                    radius,
                );
                canvas.draw_rrect(whole, &fill(track));
                let done = (b.w * state.progress) as f32;
                if done > 0.0 {
                    let filled = RRect::new_rect_xy(
                        Rect::from_xywh(b.x as f32, y, done, thick as f32),
                        radius,
                        radius,
                    );
                    canvas.draw_rrect(filled, &fill(ink));
                }
            }
        }
    });
}

/// Splits a phrase's word widths into rows: the stored breaks for a fixed card, else balanced to fit `inner`.
fn caption_rows(widths: &[f64], fixed_breaks: Option<&[usize]>, inner: f64) -> Vec<(usize, usize)> {
    let n = widths.len();
    let breaks: Vec<usize> = match fixed_breaks {
        Some(b) => b.to_vec(),
        None => {
            let total: f64 = widths.iter().sum();
            if total <= inner || n < 2 {
                Vec::new()
            } else {
                // Two rows as even as they can be (CSS `text-wrap: balance`), else greedy rows.
                let best = (1..n)
                    .map(|i| {
                        let a: f64 = widths[..i].iter().sum();
                        (i, a.max(total - a), a <= inner && total - a <= inner)
                    })
                    .filter(|(_, _, fits)| *fits)
                    .min_by(|x, y| x.1.total_cmp(&y.1));
                match best {
                    Some((i, _, _)) => vec![i],
                    None => {
                        let mut out = Vec::new();
                        let mut used = 0.0;
                        for (i, w) in widths.iter().enumerate() {
                            if used > 0.0 && used + w > inner {
                                out.push(i);
                                used = 0.0;
                            }
                            used += w;
                        }
                        out
                    }
                }
            }
        }
    };
    let mut rows = Vec::new();
    let mut start = 0;
    for b in breaks.into_iter().chain(std::iter::once(n)) {
        if b > start {
            rows.push((start, b));
            start = b;
        }
    }
    rows
}

/// Card padding in CSS pixels: vertical (SUBTITLE_CARD_PADDING_Y) and horizontal.
const CAPTION_PAD_Y: f64 = 12.0;
const CAPTION_PAD_X: f64 = 28.0;
/// Caption line height as a multiple of the font size (SUBTITLE_LINE_HEIGHT).
const CAPTION_LINE_HEIGHT: f64 = 1.35;

/// Draws the kinetic captions' visible phrase, if any, at the frame.
pub fn draw_captions<'n>(canvas: &Canvas, ctx: &OverlayCtx, node: &'n CaptionsNode) {
    if !eval::is_visible(node.visible.as_ref(), ctx.frame) {
        return;
    }
    let Some(placement) = ctx.format.pick(&node.placement) else {
        return;
    };
    let Some(phrases) = ctx.l.phrases.get(&(node.id.clone(), ctx.format)) else {
        return;
    };
    let Some(cf) = captions::caption_frame(&node.words, phrases, ctx.fps(), ctx.frame) else {
        return;
    };
    let phrase = &phrases[cf.phrase_index];
    let span = &placement.spans[phrase.span_index];
    let (w, h) = (f64::from(ctx.width), f64::from(ctx.height));
    let card = captions::card_width(span, w);
    let size = placement.font_size;
    let primary = ir_color(&node.color);
    let highlight = ir_color(&node.highlight_color);
    let spec_for = |text: &'n str| -> TextSpec<'n> {
        TextSpec {
            text: "",
            font: &node.font,
            size,
            color: primary,
            letter_spacing: 0.0,
            line_height: Some(CAPTION_LINE_HEIGHT),
            align: TextAlign::Left,
            shadows: Vec::new(),
        }
        .with_text(text)
    };
    let natural_word_widths: Vec<f64> = cf
        .words
        .iter()
        .map(|wf| ctx.l.fonts.measure(&spec_for(&node.words[wf.index].text)))
        .collect();
    let max_word_width = (card.inner_width - captions::WORD_MARGIN_X).max(0.0);
    let word_widths: Vec<f64> = natural_word_widths
        .iter()
        .map(|width| width.min(max_word_width))
        .collect();
    let wrapped_words: Vec<String> = cf
        .words
        .iter()
        .enumerate()
        .map(|(i, wf)| {
            let text = &node.words[wf.index].text;
            if natural_word_widths[i] > max_word_width {
                text.chars()
                    .map(|character| format!("{character}\u{200b}"))
                    .collect::<Vec<_>>()
                    .concat()
            } else {
                text.clone()
            }
        })
        .collect();
    let word_heights: Vec<f64> = wrapped_words
        .iter()
        .enumerate()
        .map(|(i, text)| {
            let spec = TextSpec {
                text,
                font: &node.font,
                size,
                color: primary,
                letter_spacing: 0.0,
                line_height: Some(CAPTION_LINE_HEIGHT),
                align: TextAlign::Left,
                shadows: Vec::new(),
            };
            f64::from(
                ctx.l
                    .fonts
                    .paragraph(&spec, word_widths[i].max(1.0) as f32)
                    .height(),
            )
        })
        .collect();
    let boxes: Vec<f64> = word_widths
        .iter()
        .map(|ww| ww + captions::WORD_MARGIN_X)
        .collect();
    let fixed_breaks = card.fixed.then_some(phrase.line_breaks.as_slice());
    let rows = caption_rows(&boxes, fixed_breaks, card.inner_width);
    let row_widths: Vec<f64> = rows
        .iter()
        .map(|(a, b)| boxes[*a..*b].iter().sum())
        .collect();
    let text_w = row_widths.iter().copied().fold(0.0, f64::max);
    let base_row_h = size * CAPTION_LINE_HEIGHT + 8.0;
    let row_heights: Vec<f64> = rows
        .iter()
        .map(|(a, b)| {
            word_heights[*a..*b]
                .iter()
                .map(|height| height + 8.0)
                .fold(base_row_h, f64::max)
        })
        .collect();
    let card_w = if card.fixed {
        card.width
    } else {
        (text_w + 2.0 * CAPTION_PAD_X + 2.0).min(card.width * 0.92)
    };
    let card_h = 2.0 * CAPTION_PAD_Y + 2.0 + row_heights.iter().sum::<f64>();
    let left = span.x * w - card_w / 2.0;
    let top = span.y * h;
    let rr = RRect::new_rect_xy(
        Rect::from_xywh(left as f32, top as f32, card_w as f32, card_h as f32),
        16.0,
        16.0,
    );
    let opacity = cf.opacity * node.opacity.unwrap_or(1.0);
    super::with_opacity(canvas, opacity, || {
        box_shadow(
            canvas,
            &rr,
            12.0,
            32.0,
            Rgba {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.45,
            },
        );
        // Chrome's backdrop blur sees the stage only when no partial opacity isolates the card.
        if opacity >= 1.0 {
            canvas.save();
            canvas.clip_rrect(rr, ClipOp::Intersect, true);
            if let Some(blur) = image_filters::blur((16.0, 16.0), TileMode::Clamp, None, None) {
                canvas.save_layer(&SaveLayerRec::default().backdrop(&blur));
                canvas.restore();
            }
            canvas.restore();
        }
        canvas.draw_rrect(rr, &fill(ir_color(&node.background_color)));
        canvas.draw_rrect(
            rr.with_inset((0.5, 0.5)),
            &stroke(
                Rgba {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 0.12,
                },
                1.0,
            ),
        );
        let content_left = left + 1.0 + CAPTION_PAD_X;
        let content_w = card_w - 2.0 - 2.0 * CAPTION_PAD_X;
        canvas.save();
        canvas.clip_rect(
            Rect::from_xywh(
                content_left as f32,
                top as f32,
                content_w as f32,
                card_h as f32,
            ),
            ClipOp::Intersect,
            false,
        );
        let mut row_top = top + 1.0 + CAPTION_PAD_Y;
        for (r, (a, b)) in rows.iter().enumerate() {
            let mut x = content_left + (content_w - row_widths[r]) / 2.0;
            let row_h = row_heights[r];
            let y = row_top + 4.0;
            canvas.save();
            canvas.clip_rect(
                Rect::from_xywh(
                    content_left as f32,
                    row_top as f32,
                    content_w as f32,
                    row_h as f32,
                ),
                ClipOp::Intersect,
                false,
            );
            for i in *a..*b {
                let wf = cf.words[i];
                let (color, shadows) = match wf.role {
                    captions::WordRole::Active => (
                        highlight,
                        vec![
                            (
                                highlight.with_alpha_scaled(f64::from(0x88u8) / 255.0),
                                0.0,
                                0.0,
                                20.0,
                            ),
                            (
                                Rgba {
                                    r: 0.0,
                                    g: 0.0,
                                    b: 0.0,
                                    a: 0.8,
                                },
                                0.0,
                                2.0,
                                6.0,
                            ),
                        ],
                    ),
                    captions::WordRole::Past => (
                        primary,
                        vec![(
                            Rgba {
                                r: 0.0,
                                g: 0.0,
                                b: 0.0,
                                a: 0.5,
                            },
                            0.0,
                            2.0,
                            4.0,
                        )],
                    ),
                    captions::WordRole::Future => (Rgba { a: 0.38, ..primary }, Vec::new()),
                };
                let spec = TextSpec {
                    text: &wrapped_words[i],
                    font: &node.font,
                    size,
                    color,
                    letter_spacing: 0.0,
                    line_height: Some(CAPTION_LINE_HEIGHT),
                    align: TextAlign::Left,
                    shadows,
                };
                let paragraph = ctx.l.fonts.paragraph(&spec, word_widths[i] as f32);
                let (wx, ww) = (x + captions::WORD_MARGIN_X / 2.0, word_widths[i]);
                canvas.save();
                // The word scales about its own centre, as a CSS transform on an inline block does.
                let (cx, cy) = (
                    (wx + ww / 2.0) as f32,
                    (y + size * CAPTION_LINE_HEIGHT / 2.0) as f32,
                );
                canvas.translate((cx, cy));
                canvas.scale((wf.scale as f32, wf.scale as f32));
                canvas.translate((-cx, -cy));
                paragraph.paint(canvas, (wx as f32, y as f32));
                canvas.restore();
                x += boxes[i];
            }
            canvas.restore();
            row_top += row_h;
        }
        canvas.restore();
    });
}

impl<'a> TextSpec<'a> {
    /// The same spec with different text.
    fn with_text(self, text: &'a str) -> TextSpec<'a> {
        TextSpec { text, ..self }
    }
}

/// Relative luminance of a colour (WCAG 2), ignoring alpha.
fn luminance(c: Rgba) -> f64 {
    let ch = |v: f32| {
        let v = f64::from(v);
        if v <= 0.03928 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
}

/// WCAG contrast ratio of two colours.
fn contrast(a: Rgba, b: Rgba) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// Mixes `a` toward `b` by `t`, opaque.
fn mix(a: Rgba, b: Rgba, t: f32) -> Rgba {
    Rgba {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
        a: 1.0,
    }
}

/// The outline thumbs-up icon on a 24 unit grid (EndCard.tsx).
const THUMBS_UP: &[&str] = &[
    "M7 10v11",
    "M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7.9A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z",
];
/// The bell icon on a 24 unit grid (EndCard.tsx).
const BELL: &[&str] = &[
    "M10.3 21a2 2 0 0 0 3.4 0",
    "M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3",
];

/// Strokes a 24-unit icon at (x, y) with the given pixel size and colour.
fn draw_icon(canvas: &Canvas, paths: &[&str], x: f64, y: f64, size: f64, color: Rgba) {
    canvas.save();
    canvas.translate((x as f32, y as f32));
    canvas.scale(((size / 24.0) as f32, (size / 24.0) as f32));
    let mut p = stroke(color, 2.0);
    p.set_stroke_cap(paint::Cap::Round);
    p.set_stroke_join(paint::Join::Round);
    for d in paths {
        if let Some(path) = Path::from_svg(d) {
            canvas.draw_path(&path, &p);
        }
    }
    canvas.restore();
}

/// Draws the end card: the dim over the held stage, then the card with its entering parts and the press.
pub fn draw_end_card(canvas: &Canvas, ctx: &OverlayCtx, node: &EndCardNode) {
    if !eval::is_visible(node.visible.as_ref(), ctx.frame) {
        return;
    }
    let Some(geo) = ctx.format.pick(&node.layout) else {
        return;
    };
    let from = node.visible.as_ref().map_or(0, |v| v.from_frame.0);
    let st = eval::end_card_state(from, node.press_frame.0, ctx.fps(), ctx.frame);
    let (w, h) = (f64::from(ctx.width), f64::from(ctx.height));
    let k = ctx.k();
    let fonts = &ctx.l.fonts;
    let dim = ir_color(&node.dim);
    let ink = ir_color(&node.ink);
    let accent = ir_color(&node.fill);
    let canvas_rgb = Rgba { a: 1.0, ..dim };
    // Derived colours (the IR carries the dim, ink and accent only): see docs/NATIVE_RENDERER.md.
    let surface = mix(canvas_rgb, ink, 0.06);
    let hairline = Rgba { a: 0.12, ..ink };
    let muted = Rgba { a: 0.6, ..ink };
    let pill_ink = if contrast(accent, canvas_rgb) > contrast(accent, ink) {
        canvas_rgb
    } else {
        ink
    };

    super::with_opacity(canvas, node.opacity.unwrap_or(1.0), || {
        canvas.draw_rect(
            Rect::from_xywh(0.0, 0.0, w as f32, h as f32),
            &fill(dim.with_alpha_scaled(st.dim)),
        );
        let text = |t: String, font: &str, size: f64, spacing_em: f64, line: f64, color: Rgba| {
            let spec = TextSpec {
                text: "",
                font,
                size,
                color,
                letter_spacing: spacing_em * size,
                line_height: Some(line),
                align: TextAlign::Left,
                shadows: Vec::new(),
            };
            fonts.paragraph(&TextSpec { text: &t, ..spec }, f32::INFINITY)
        };
        let label = text(
            node.copy.label.to_uppercase(),
            &node.mono_font,
            geo.type_sizes.label,
            0.14,
            1.4,
            muted,
        );
        let headline = text(
            node.copy.headline.clone(),
            &node.sans_font,
            geo.type_sizes.headline,
            -0.025,
            1.06,
            ink,
        );
        let like = text(
            node.copy.like_label.to_uppercase(),
            &node.mono_font,
            geo.type_sizes.chip,
            0.08,
            1.0,
            ink,
        );
        let sub = text(
            node.copy.subscribe_label.to_uppercase(),
            &node.mono_font,
            geo.type_sizes.chip,
            0.08,
            1.0,
            pill_ink,
        );
        let has_handle = !node.copy.handle.trim().is_empty();
        let handle = text(
            node.copy.handle.clone(),
            &node.mono_font,
            geo.type_sizes.handle,
            0.04,
            1.4,
            muted,
        );
        let chip_w = |p: &skia_safe::textlayout::Paragraph| {
            2.0 * geo.chip.pad_x
                + geo.chip.icon
                + geo.chip.icon * 0.36
                + f64::from(p.max_intrinsic_width())
        };
        let (like_w, sub_w) = (chip_w(&like), chip_w(&sub));
        let chips_w = like_w + geo.chip.gap + sub_w;
        let pw = |p: &skia_safe::textlayout::Paragraph| f64::from(p.max_intrinsic_width());
        let content_w = pw(&label)
            .max(pw(&headline))
            .max(chips_w)
            .max(if has_handle { pw(&handle) } else { 0.0 });
        let mut content_h = f64::from(label.height())
            + geo.gap
            + f64::from(headline.height())
            + geo.gap * 1.4
            + geo.chip.height;
        if has_handle {
            content_h += geo.gap + f64::from(handle.height());
        }
        let panel_w = (content_w + 2.0 * geo.pad_x).min(geo.card.w);
        let panel_h = (content_h + 2.0 * geo.pad_y).min(geo.card.h);
        let px = geo.card.x + (geo.card.w - panel_w) / 2.0;
        let py = geo.card.y + (geo.card.h - panel_h) / 2.0 + st.panel.rise;
        let cx = px + panel_w / 2.0;
        let panel = RRect::new_rect_xy(
            Rect::from_xywh(px as f32, py as f32, panel_w as f32, panel_h as f32),
            geo.radius as f32,
            geo.radius as f32,
        );
        super::with_opacity(canvas, st.panel.opacity, || {
            box_shadow(
                canvas,
                &panel,
                16.0 * k,
                40.0 * k,
                Rgba {
                    a: 0.45,
                    ..canvas_rgb
                },
            );
            canvas.draw_rrect(panel, &fill(surface));
            canvas.draw_rrect(panel.with_inset((0.5, 0.5)), &stroke(hairline, 1.0));
            let mut y = py + (panel_h - content_h) / 2.0;
            // Each part enters on its own stagger, centred in the panel.
            let part = |p: &skia_safe::textlayout::Paragraph, y: f64, e: eval::Entrance| {
                super::with_opacity(canvas, e.opacity, || {
                    p.paint(canvas, ((cx - pw(p) / 2.0) as f32, (y + e.rise) as f32));
                });
            };
            part(&label, y, st.label);
            y += f64::from(label.height()) + geo.gap;
            part(&headline, y, st.headline);
            y += f64::from(headline.height()) + geo.gap * 1.4;
            let chips_y = y + st.chips.rise;
            super::with_opacity(canvas, st.chips.opacity, || {
                let lx = cx - chips_w / 2.0;
                draw_chip(
                    canvas, &like, lx, chips_y, like_w, geo, THUMBS_UP, ink, None, 1.0,
                );
                let sx = lx + like_w + geo.chip.gap;
                let ring = Rgba {
                    a: (0.28 * st.press) as f32,
                    ..accent
                };
                let scale = 1.0 - 0.06 * st.press;
                draw_chip(
                    canvas,
                    &sub,
                    sx,
                    chips_y,
                    sub_w,
                    geo,
                    BELL,
                    pill_ink,
                    Some((accent, ring, 10.0 * k * st.press)),
                    scale,
                );
            });
            y += geo.chip.height;
            if has_handle {
                part(&handle, y + geo.gap, st.handle);
            }
        });
    });
}

/// Draws one end card chip: an outlined chip, or a filled pill with a press ring and scale.
#[allow(clippy::too_many_arguments)]
fn draw_chip(
    canvas: &Canvas,
    label: &skia_safe::textlayout::Paragraph,
    x: f64,
    y: f64,
    w: f64,
    geo: &aideos_render_ir::types::EndCardLayout,
    icon: &[&str],
    ink: Rgba,
    pill: Option<(Rgba, Rgba, f64)>,
    scale: f64,
) {
    let hgt = geo.chip.height;
    let r = (hgt / 2.0) as f32;
    let rect = Rect::from_xywh(x as f32, y as f32, w as f32, hgt as f32);
    canvas.save();
    let (cx, cy) = ((x + w / 2.0) as f32, (y + hgt / 2.0) as f32);
    canvas.translate((cx, cy));
    canvas.scale((scale as f32, scale as f32));
    canvas.translate((-cx, -cy));
    let rr = RRect::new_rect_xy(rect, r, r);
    match pill {
        Some((fill_color, ring, spread)) => {
            if spread > 0.0 && ring.a > 0.0 {
                let outer = rr.with_outset((spread as f32, spread as f32));
                canvas.save();
                canvas.clip_rrect(rr, ClipOp::Difference, true);
                canvas.draw_rrect(outer, &fill(ring));
                canvas.restore();
            }
            canvas.draw_rrect(rr, &fill(fill_color));
        }
        None => {
            canvas.draw_rrect(
                rr.with_inset((1.0, 1.0)),
                &stroke(Rgba { a: 0.35, ..ink }, 2.0),
            );
        }
    }
    let icon_x = x + geo.chip.pad_x;
    draw_icon(
        canvas,
        icon,
        icon_x,
        y + (hgt - geo.chip.icon) / 2.0,
        geo.chip.icon,
        ink,
    );
    let text_x = icon_x + geo.chip.icon + geo.chip.icon * 0.36;
    label.paint(
        canvas,
        Point::new(
            text_x as f32,
            (y + (hgt - f64::from(label.height())) / 2.0) as f32,
        ),
    );
    canvas.restore();
}
