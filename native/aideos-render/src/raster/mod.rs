//! File Description: Draws one evaluated frame of a Render IR onto a Skia canvas: the background, the stage (SVG assets and groups in scene space, under the camera and the format's cover fit, as SceneStage and SceneView do), then the overlay in frame pixels (groups, rects, text, and the chapter rail, kinetic captions and end card in `chrome`). Drawing reads only the IR, the loaded assets and the frame number, so the same frame always draws the same pixels.
//! Inputs and outputs: a canvas, the loaded film (`Loaded`), a format, a frame number and the frame size -> pixels on the canvas.
//! Used by: crate::renderer (CPU raster and the optional GPU surface).

pub mod chrome;
pub mod svg;
pub mod text;

use std::collections::BTreeMap;

use aideos_render_ir::types::{Align, GroupNode, Node, RectNode, RenderIr, SvgNode, TextNode};
use skia_safe::textlayout::TextAlign;
use skia_safe::{paint, Canvas, Matrix, Paint, RRect, Rect};

use crate::eval::{self, captions::Phrase, Format, NodeTransform};
use crate::svg::color::{parse_color, Rgba};
use crate::svg::SvgDocument;

use self::text::{to_color, Fonts, TextSpec};

/// A film ready to draw: the IR and everything loaded for it.
pub struct Loaded {
    pub ir: RenderIr,
    /// Parsed SVG assets by asset id.
    pub svgs: BTreeMap<String, SvgDocument>,
    pub fonts: Fonts,
    /// Caption phrases by (captions node id, format), computed once at load.
    pub phrases: BTreeMap<(String, Format), Vec<Phrase>>,
}

/// Reads an IR colour (`#RRGGBB` or `#RRGGBBAA`, already checked by the loader).
pub fn ir_color(s: &str) -> Rgba {
    parse_color(s).unwrap_or(Rgba {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    })
}

/// Draws a whole frame of one format at `width` x `height` pixels.
pub fn draw_frame(
    canvas: &Canvas,
    l: &Loaded,
    format: Format,
    frame: u32,
    width: u32,
    height: u32,
) {
    canvas.clear(to_color(ir_color(&l.ir.background)));
    let pose = eval::camera(&l.ir, frame);
    let fit = eval::cover_fit(&l.ir, width, height) as f32;
    canvas.save();
    // Frame centre, cover fit, then the camera: rotate, zoom and bring its centre to the origin.
    canvas.translate((width as f32 / 2.0, height as f32 / 2.0));
    canvas.scale((fit, fit));
    canvas.rotate(pose.rotation as f32, None);
    canvas.scale((pose.zoom as f32, pose.zoom as f32));
    canvas.translate((-pose.center_x as f32, -pose.center_y as f32));
    for node in stage_order(&l.ir.stage) {
        draw_stage_node(canvas, l, node, frame);
    }
    canvas.restore();
    let ctx = OverlayCtx {
        l,
        format,
        frame,
        width,
        height,
    };
    for node in &l.ir.overlay {
        draw_overlay_node(canvas, &ctx, node);
    }
}

/// Stage siblings in drawing order: by svg `layer` (groups count as layer 0), document order breaking ties.
fn stage_order(nodes: &[Node]) -> Vec<&Node> {
    let mut ordered: Vec<&Node> = nodes.iter().collect();
    ordered.sort_by_key(|n| match n {
        Node::Svg(s) => s.layer,
        _ => 0,
    });
    ordered
}

/// Applies a placed node's transform: translate, uniform scale, then rotation in degrees.
fn apply_placement(canvas: &Canvas, t: &NodeTransform) {
    canvas.translate((t.x as f32, t.y as f32));
    canvas.scale((t.scale as f32, t.scale as f32));
    canvas.rotate(t.rotation as f32, None);
}

/// Runs `body` inside a group opacity: a layer when it is partial, nothing at all when it is zero.
fn with_opacity(canvas: &Canvas, opacity: f64, body: impl FnOnce()) {
    if opacity <= 0.0 {
        return;
    }
    if opacity < 1.0 {
        canvas.save_layer_alpha_f(None, opacity as f32);
        body();
        canvas.restore();
    } else {
        body();
    }
}

/// Draws one stage node in scene space.
fn draw_stage_node(canvas: &Canvas, l: &Loaded, node: &Node, frame: u32) {
    let dur = l.ir.film.duration_frames.0;
    match node {
        Node::Svg(n) => draw_svg_node(canvas, l, n, frame),
        Node::Group(g) => {
            if !eval::is_visible(g.visible.as_ref(), frame) {
                return;
            }
            let t = group_transform(g, frame, dur);
            canvas.save();
            apply_placement(canvas, &t);
            with_opacity(canvas, t.opacity, || {
                for child in stage_order(&g.children) {
                    draw_stage_node(canvas, l, child, frame);
                }
            });
            canvas.restore();
        }
        // The loader refuses overlay kinds on the stage.
        _ => {}
    }
}

/// A group's resolved transform at a frame.
fn group_transform(g: &GroupNode, frame: u32, dur: u32) -> NodeTransform {
    let base = NodeTransform {
        x: g.x,
        y: g.y,
        scale: g.scale,
        rotation: g.rotation,
        opacity: 1.0,
    };
    eval::placed_transform(base, g.opacity, &g.tracks, frame, dur)
}

/// Draws an SVG asset placed on the stage with its element states for the frame.
fn draw_svg_node(canvas: &Canvas, l: &Loaded, n: &SvgNode, frame: u32) {
    if !eval::is_visible(n.visible.as_ref(), frame) {
        return;
    }
    let Some(doc) = l.svgs.get(&n.asset) else {
        return;
    };
    let dur = l.ir.film.duration_frames.0;
    let base = NodeTransform {
        x: n.x,
        y: n.y,
        scale: n.scale,
        rotation: n.rotation,
        opacity: 1.0,
    };
    let t = eval::placed_transform(base, n.opacity, &n.tracks, frame, dur);
    let states = eval::element_states(n, frame, dur);
    canvas.save();
    apply_placement(canvas, &t);
    with_opacity(canvas, t.opacity, || {
        svg::draw_document(
            canvas,
            &svg::SvgDraw {
                doc,
                states: &states,
                fonts: &l.fonts,
            },
        );
    });
    canvas.restore();
}

/// What every overlay draw needs.
pub struct OverlayCtx<'a> {
    pub l: &'a Loaded,
    pub format: Format,
    pub frame: u32,
    pub width: u32,
    pub height: u32,
}

impl OverlayCtx<'_> {
    /// The film length in frames.
    pub fn dur(&self) -> u32 {
        self.l.ir.film.duration_frames.0
    }

    /// The film's frame rate.
    pub fn fps(&self) -> u32 {
        self.l.ir.film.fps.0
    }

    /// The format's pixel scale against its reference width (1920 long, 1080 reel), as `useLayout().px`.
    pub fn k(&self) -> f64 {
        let reference = match self.format {
            Format::Long => 1920.0,
            Format::Reel => 1080.0,
        };
        f64::from(self.width) / reference
    }
}

/// Draws one overlay node in frame pixels.
fn draw_overlay_node(canvas: &Canvas, ctx: &OverlayCtx, node: &Node) {
    let frame = ctx.frame;
    match node {
        Node::Group(g) => {
            if !eval::is_visible(g.visible.as_ref(), frame) {
                return;
            }
            let t = group_transform(g, frame, ctx.dur());
            canvas.save();
            apply_placement(canvas, &t);
            with_opacity(canvas, t.opacity, || {
                for child in &g.children {
                    draw_overlay_node(canvas, ctx, child);
                }
            });
            canvas.restore();
        }
        Node::Rect(r) => draw_rect_node(canvas, ctx, r),
        Node::Text(t) => draw_text_node(canvas, ctx, t),
        Node::Rail(r) => chrome::draw_rail(canvas, ctx, r),
        Node::Captions(c) => chrome::draw_captions(canvas, ctx, c),
        Node::EndCard(e) => chrome::draw_end_card(canvas, ctx, e),
        // The loader refuses svg nodes in the overlay.
        Node::Svg(_) => {}
    }
}

/// Positions a boxed node: its track offset, then its scale and rotation about the box centre.
fn apply_boxed(canvas: &Canvas, t: &NodeTransform, x: f64, y: f64, w: f64, h: f64) {
    let (cx, cy) = ((x + w / 2.0) as f32, (y + h / 2.0) as f32);
    let mut m = Matrix::translate((t.x as f32, t.y as f32));
    m.pre_translate((cx, cy));
    m.pre_rotate(t.rotation as f32, None);
    m.pre_scale((t.scale as f32, t.scale as f32), None);
    m.pre_translate((-cx, -cy));
    canvas.concat(&m);
}

/// Draws a rounded rectangle node with its fill and centred stroke.
fn draw_rect_node(canvas: &Canvas, ctx: &OverlayCtx, r: &RectNode) {
    if !eval::is_visible(r.visible.as_ref(), ctx.frame) {
        return;
    }
    let Some(b) = ctx.format.pick(&r.placement) else {
        return;
    };
    let t = eval::boxed_transform(r.opacity, &r.tracks, ctx.frame, ctx.dur());
    canvas.save();
    apply_boxed(canvas, &t, b.x, b.y, b.w, b.h);
    with_opacity(canvas, t.opacity, || {
        let rect = Rect::from_xywh(b.x as f32, b.y as f32, b.w as f32, b.h as f32);
        let rr = RRect::new_rect_xy(rect, r.radius as f32, r.radius as f32);
        if let Some(fill) = &r.fill {
            let mut p = Paint::default();
            p.set_anti_alias(true);
            p.set_color(to_color(ir_color(fill)));
            canvas.draw_rrect(rr, &p);
        }
        if let Some(stroke) = &r.stroke {
            let mut p = Paint::default();
            p.set_anti_alias(true);
            p.set_style(paint::Style::Stroke);
            p.set_stroke_width(stroke.width as f32);
            p.set_color(to_color(ir_color(&stroke.color)));
            canvas.draw_rrect(rr, &p);
        }
    });
    canvas.restore();
}

/// Maps the IR alignment to textlayout's.
fn text_align(a: Align) -> TextAlign {
    match a {
        Align::Left => TextAlign::Left,
        Align::Center => TextAlign::Center,
        Align::Right => TextAlign::Right,
    }
}

/// Draws a text node wrapped to its box width, top-aligned in the box. Letter spacing is in ems.
fn draw_text_node(canvas: &Canvas, ctx: &OverlayCtx, t: &TextNode) {
    if !eval::is_visible(t.visible.as_ref(), ctx.frame) {
        return;
    }
    let Some(b) = ctx.format.pick(&t.placement) else {
        return;
    };
    let tr = eval::boxed_transform(t.opacity, &t.tracks, ctx.frame, ctx.dur());
    canvas.save();
    apply_boxed(canvas, &tr, b.x, b.y, b.w, b.h);
    with_opacity(canvas, tr.opacity, || {
        let spec = TextSpec {
            text: &t.text,
            font: &t.font,
            size: b.font_size,
            color: ir_color(&t.color),
            letter_spacing: t.letter_spacing * b.font_size,
            line_height: Some(t.line_height),
            align: text_align(t.align),
            shadows: Vec::new(),
        };
        let paragraph = ctx.l.fonts.paragraph(&spec, b.w as f32);
        paragraph.paint(canvas, (b.x as f32, b.y as f32));
    });
    canvas.restore();
}
