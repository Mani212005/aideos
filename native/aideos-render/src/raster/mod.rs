//! File Description: Draws one evaluated frame of a Render IR onto a Skia canvas: the background, the `/7` underlay (svg, image and group nodes in frame pixels, no camera), the stage (SVG assets, pictures and groups in scene space, under the camera and the format's cover fit, as SceneStage and SceneView do), then the overlay in frame pixels (groups, rects, text, and the chapter rail, kinetic captions and end card in `chrome`). Opt-in seeded particles and SkSL transitions are evaluated per sample. The opt-in 2D shutter accumulates fractional samples and draws chrome once at the delivered frame. Translucent fills and every compositing layer's restore blend in floating point and round, as the reference Chrome's GPU raster does (Skia's 8-bit legacy blitters truncate). Drawing depends only on the IR, assets and frame number.
//! Inputs and outputs: a canvas, the loaded film (`Loaded`), a format, a frame number and the frame size -> pixels on the canvas.
//! Used by: crate::renderer (CPU raster and the optional GPU surface).

pub mod chrome;
pub mod filter;
pub mod effects;
pub mod stage3d;
pub mod svg;
pub mod text;

use std::collections::BTreeMap;
use std::sync::Arc;

use aideos_render_ir::types::{
    Align, GroupNode, ImageNode, Node, RectNode, RenderIr, Stage3dNode, SvgNode, TextNode,
};
use skia_safe::textlayout::TextAlign;
use skia_safe::gradient::{shaders, Colors, Gradient, Interpolation};
use skia_safe::{
    images, paint, surfaces, AlphaType, Canvas, Color4f, ColorType, Data, FilterMode, Image,
    ImageInfo, Matrix, MipmapMode, Paint, RRect, Rect, SamplingOptions, TileMode,
};

use crate::eval::{self, captions::Phrase, CameraPose, Format, NodeTransform};
use crate::renderer::RenderError;
use crate::svg::color::{parse_color, Rgba};
use crate::svg::SvgDocument;

use self::text::{to_color, Fonts, TextSpec};

/// A film ready to draw: the IR and everything loaded for it.
pub struct Loaded {
    pub ir: RenderIr,
    /// Parsed SVG assets by asset id.
    pub svgs: BTreeMap<String, SvgDocument>,
    /// Decoded pictures (with mipmaps) by image asset id, for the image nodes that draw them (`aideos.render/3`); shared between renderers of one film.
    pub images: Arc<BTreeMap<String, Image>>,
    pub fonts: Fonts,
    /// Caption phrases by (captions node id, format), computed once at load.
    pub phrases: BTreeMap<(String, Format), Vec<Phrase>>,
    /// The Three stage (`aideos.render/2`), shared between renderers of one film so its painted faces are painted once.
    pub stage3d: Option<Arc<stage3d::Stage3dScene>>,
}

/// What drawing a stage node needs besides the node: the frame's size and the camera pose of the frame.
struct StageView {
    width: u32,
    height: u32,
    pose: CameraPose,
}

/// Reads an IR colour (`#RRGGBB` or `#RRGGBBAA`). The loader's schema guarantees that format for every colour field of a loaded IR, so a parse failure is unreachable there: no silent black fallback and no panic on bad input. The opaque black fallback only keeps this a total function for hand-built IR that skipped the loader.
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
) -> Result<(), RenderError> {
    let Some(shutter) = &l.ir.shutter else {
        return draw_frame_at(canvas, l, format, frame, f64::from(frame), width, height, true);
    };
    if !(2..=16).contains(&shutter.samples.0) || !shutter.angle.is_finite() || !(0.0 < shutter.angle && shutter.angle <= 360.0) {
        return Err(RenderError::Unsupported("shutter needs 2 to 16 samples and an angle in (0, 360]".into()));
    }
    let surface_info = ImageInfo::new_n32_premul((width as i32, height as i32), None);
    let mut surface = surfaces::raster(&surface_info, None, Some(&crate::renderer::frame_surface_props()))
        .ok_or_else(|| RenderError::Skia("cannot create shutter surface".into()))?;
    let mut sum = vec![0u16; width as usize * height as usize * 4];
    let count = shutter.samples.0;
    for i in 0..count {
        let offset = ((f64::from(i) + 0.5) / f64::from(count) - 0.5) * shutter.angle / 360.0;
        let time = (f64::from(frame) + offset).clamp(0.0, f64::from(l.ir.film.duration_frames.0) - 1e-9);
        draw_frame_at(surface.canvas(), l, format, frame, time, width, height, false)?;
        let pixmap = surface.peek_pixels().ok_or_else(|| RenderError::Skia("cannot access shutter sample".into()))?;
        let stride = pixmap.row_bytes();
        let bytes = pixmap.bytes().ok_or_else(|| RenderError::Skia("cannot read shutter sample".into()))?;
        let row_len = width as usize * 4;
        for row in 0..height as usize {
            for (total, pixel) in sum[row * row_len..(row + 1) * row_len].iter_mut().zip(&bytes[row * stride..row * stride + row_len]) {
                *total += u16::from(*pixel);
            }
        }
    }
    let divisor = count as u16;
    let averaged: Vec<u8> = sum.iter().map(|total| ((*total + divisor / 2) / divisor) as u8).collect();
    let image = images::raster_from_data(&surface_info, Data::new_copy(&averaged), width as usize * 4)
        .ok_or_else(|| RenderError::Skia("cannot wrap shutter image".into()))?;
    canvas.clear(skia_safe::Color::TRANSPARENT);
    canvas.draw_image(&image, (0.0, 0.0), None);
    let ctx = OverlayCtx { l, format, frame, time: f64::from(frame), width, height };
    for node in &l.ir.overlay {
        if is_chrome(node) { draw_overlay_node(canvas, &ctx, node); }
    }
    Ok(())
}

/// Draws a single fractional 2D sample while keeping chrome on the delivered frame.
fn draw_frame_at(
    canvas: &Canvas, l: &Loaded, format: Format, frame: u32, time: f64, width: u32, height: u32, include_chrome: bool,
) -> Result<(), RenderError> {
    canvas.clear(to_color(ir_color(&l.ir.background)));
    let pose = eval::camera_at(&l.ir, time);
    let view = StageView { width, height, pose };
    let fit = eval::cover_fit(&l.ir, width, height) as f32;
    // `/7`: the underlay is drawn in frame pixels, with no camera, between the background and the stage.
    if let Some(underlay) = &l.ir.underlay {
        for node in stage_order(underlay) {
            match node {
                Node::Group(g) => draw_underlay_layer(canvas, l, g, time, frame, &view)?,
                other => draw_stage_node(canvas, l, other, time, frame, &view)?,
            }
        }
    }
    canvas.save();
    // Frame centre, cover fit, then the camera: rotate, zoom and bring its centre to the origin.
    canvas.translate((width as f32 / 2.0, height as f32 / 2.0));
    canvas.scale((fit, fit));
    canvas.rotate(pose.rotation as f32, None);
    canvas.scale((pose.zoom as f32, pose.zoom as f32));
    canvas.translate((-pose.center_x as f32, -pose.center_y as f32));
    for node in stage_order(&l.ir.stage) {
        draw_stage_node(canvas, l, node, time, frame, &view)?;
    }
    if let Some(emitters) = &l.ir.particles { effects::draw_particles(canvas, emitters, time)?; }
    canvas.restore();
    if let Some(transition) = &l.ir.transition { effects::draw_transition(canvas, transition, time, width, height)?; }
    let ctx = OverlayCtx {
        l,
        format,
        frame,
        time,
        width,
        height,
    };
    for node in &l.ir.overlay {
        if include_chrome || !is_chrome(node) { draw_overlay_node(canvas, &ctx, node); }
    }
    Ok(())
}

/// Identifies the sharp overlay chrome composited once after shutter accumulation.
fn is_chrome(node: &Node) -> bool {
    matches!(node, Node::Rail(_) | Node::Captions(_) | Node::EndCard(_))
}

thread_local! {
    /// The one-colour shader `exact_colour` builds from (compiled once per thread).
    static SOLID_COLOUR: Option<skia_safe::RuntimeEffect> = skia_safe::RuntimeEffect::make_for_shader("uniform float4 c; half4 main(float2 p) { return half4(c); }", None).ok();
}

/// A shader that paints one translucent colour, or None for an opaque or fully transparent colour (a plain paint is exact
/// there). Skia's CPU pipeline blends a plain translucent colour in 8 bits with truncation, one level darker than Chrome's
/// rounding compositor on a flat dark pixel (0.005 SSIM); a runtime-effect shader is blended in floating point and rounded.
pub(crate) fn exact_colour(colour: skia_safe::Color) -> Option<skia_safe::Shader> {
    if colour.a() == 255 || colour.a() == 0 {
        return None;
    }
    let a = f32::from(colour.a()) / 255.0;
    let premul = [f32::from(colour.r()) / 255.0 * a, f32::from(colour.g()) / 255.0 * a, f32::from(colour.b()) / 255.0 * a, a];
    let uniform: Vec<u8> = premul.iter().flat_map(|v| v.to_le_bytes()).collect();
    SOLID_COLOUR.with(|effect| effect.as_ref().and_then(|e| e.make_shader(skia_safe::Data::new_copy(&uniform), &[], None)))
}

thread_local! {
    /// The identity colour filter `rounding_layer_paint` puts on a layer's restore (compiled once per thread).
    static IDENTITY_FILTER: Option<skia_safe::RuntimeEffect> = skia_safe::RuntimeEffect::make_for_color_filter("half4 main(half4 c) { return c; }", None).ok();
}

/// The paint a compositing layer is restored with at `alpha`. Skia restores a plain layer through its legacy 8-bit sprite
/// blitter, which truncates (`(d * (256 - a)) >> 8`); the reference Chrome (swangle, GPU raster) blends a layer in floating
/// point and rounds. An identity runtime colour filter sends the restore through the float pipeline, which rounds as it does.
pub(crate) fn rounding_layer_paint(alpha: f32) -> skia_safe::Paint {
    let mut paint = skia_safe::Paint::default();
    paint.set_alpha_f(alpha);
    if let Some(filter) = IDENTITY_FILTER.with(|e| e.as_ref().and_then(|e| e.make_color_filter(skia_safe::Data::new_empty(), None))) {
        paint.set_color_filter(filter);
    }
    paint
}

/// Stage siblings in drawing order: by svg or image `layer` (groups count as layer 0), document order breaking ties.
fn stage_order(nodes: &[Node]) -> Vec<&Node> {
    let mut ordered: Vec<&Node> = nodes.iter().collect();
    ordered.sort_by_key(|n| match n {
        Node::Svg(s) => s.layer,
        Node::Image(i) => i.layer,
        _ => 0,
    });
    ordered
}

/// Applies a placed node's transform: translate, scale (uniform times the per-axis factors), then rotation in degrees.
fn apply_placement(canvas: &Canvas, t: &NodeTransform) {
    canvas.translate((t.x as f32, t.y as f32));
    canvas.scale(((t.scale * t.scale_x) as f32, (t.scale * t.scale_y) as f32));
    canvas.rotate(t.rotation as f32, None);
}

/// Runs `body` inside a group opacity: a layer when it is partial, nothing at all when it is zero.
fn with_opacity(canvas: &Canvas, opacity: f64, body: impl FnOnce()) {
    if opacity <= 0.0 {
        return;
    }
    if opacity < 1.0 {
        canvas.save_layer(&skia_safe::canvas::SaveLayerRec::default().paint(&rounding_layer_paint(opacity as f32)));
        body();
        canvas.restore();
    } else {
        body();
    }
}

/// Draws one stage node in scene space.
fn draw_stage_node(
    canvas: &Canvas,
    l: &Loaded,
    node: &Node,
    time: f64,
    frame: u32,
    view: &StageView,
) -> Result<(), RenderError> {
    let dur = l.ir.film.duration_frames.0;
    match node {
        Node::Svg(n) => draw_svg_node(canvas, l, n, time),
        Node::Image(n) => draw_image_node(canvas, l, n, time),
        Node::Stage3d(n) => return draw_stage3d_node(canvas, l, n, frame, view),
        Node::Group(g) => {
            if !eval::is_visible_at(g.visible.as_ref(), time) {
                return Ok(());
            }
            let t = group_transform(g, time, dur);
            canvas.save();
            apply_placement(canvas, &t);
            let mut result = Ok(());
            with_opacity(canvas, t.opacity, || {
                for child in stage_order(&g.children) {
                    if let Err(e) = draw_stage_node(canvas, l, child, time, frame, view) {
                        result = Err(e);
                        break;
                    }
                }
            });
            canvas.restore();
            return result;
        }
        // The loader refuses overlay kinds on the stage.
        _ => {}
    }
    Ok(())
}

/// Draws a top-level `/7` underlay group as Chrome composites a layer it does not re-raster when it scales: the children
/// are drawn in frame pixels without the group's transform, then the result is placed through the transform (scale, x, y,
/// rotation) with bilinear sampling at the group's opacity. A theme texture under the end card's 1% push is drawn this way
/// (redrawing its 0.25 px lines at the new scale measured SSIM 0.960 against Chrome, resampling 0.996). At the identity
/// transform the children are drawn directly, which gives the same pixels.
fn draw_underlay_layer(
    canvas: &Canvas,
    l: &Loaded,
    g: &GroupNode,
    time: f64,
    frame: u32,
    view: &StageView,
) -> Result<(), RenderError> {
    if !eval::is_visible_at(g.visible.as_ref(), time) {
        return Ok(());
    }
    let t = group_transform(g, time, l.ir.film.duration_frames.0);
    if t.opacity <= 0.0 {
        return Ok(());
    }
    let identity = t.x == 0.0 && t.y == 0.0 && t.scale * t.scale_x == 1.0 && t.scale * t.scale_y == 1.0 && t.rotation == 0.0;
    if identity {
        let mut result = Ok(());
        with_opacity(canvas, t.opacity, || {
            for child in stage_order(&g.children) {
                if let Err(e) = draw_stage_node(canvas, l, child, time, frame, view) {
                    result = Err(e);
                    break;
                }
            }
        });
        return result;
    }
    let info = skia_safe::ImageInfo::new_n32_premul((view.width as i32, view.height as i32), None);
    let mut layer = canvas
        .new_surface(&info, None)
        .or_else(|| skia_safe::surfaces::raster(&info, None, None))
        .ok_or_else(|| RenderError::Skia("cannot allocate the underlay layer".into()))?;
    for child in stage_order(&g.children) {
        draw_stage_node(layer.canvas(), l, child, time, frame, view)?;
    }
    let image = layer.image_snapshot();
    canvas.save();
    apply_placement(canvas, &t);
    let sampling = skia_safe::SamplingOptions::new(skia_safe::FilterMode::Linear, skia_safe::MipmapMode::None);
    canvas.draw_image_with_sampling_options(&image, (0.0, 0.0), sampling, Some(&rounding_layer_paint(t.opacity as f32)));
    canvas.restore();
    Ok(())
}

/// Draws the Three stage: the rasterizer renders its own layer under the document camera, composited over what the canvas holds in frame pixels (the camera transform the SVG planes use is set aside), at the node's opacity.
fn draw_stage3d_node(
    canvas: &Canvas,
    l: &Loaded,
    n: &Stage3dNode,
    frame: u32,
    view: &StageView,
) -> Result<(), RenderError> {
    if !eval::is_visible(n.visible.as_ref(), frame) {
        return Ok(());
    }
    let opacity = n.opacity.unwrap_or(1.0);
    if opacity <= 0.0 {
        return Ok(());
    }
    let Some(scene) = &l.stage3d else {
        return Err(RenderError::Unsupported(format!(
            "stage3d node {:?} was not prepared at load",
            n.id
        )));
    };
    let size = (f64::from(l.ir.scene.width.0), f64::from(l.ir.scene.height.0));
    let layer = scene
        .render_layer(frame, &view.pose, size, view.width, view.height)
        .map_err(|e| RenderError::Stage3d(format!("{}: {e}", n.id)))?;
    let Some(layer) = layer else {
        return Ok(());
    };
    let info = ImageInfo::new(
        (layer.width as i32, layer.height as i32),
        ColorType::RGBA8888,
        AlphaType::Premul,
        None,
    );
    let image = images::raster_from_data(&info, Data::new_copy(&layer.rgba), layer.width as usize * 4)
        .ok_or_else(|| RenderError::Skia("cannot wrap the Three stage layer".into()))?;
    canvas.save();
    canvas.reset_matrix();
    let mut paint = Paint::default();
    paint.set_alpha_f(opacity as f32);
    canvas.draw_image(&image, (layer.x as f32, layer.y as f32), Some(&paint));
    canvas.restore();
    Ok(())
}

/// A group's resolved transform at a frame.
fn group_transform(g: &GroupNode, time: f64, dur: u32) -> NodeTransform {
    let base = NodeTransform {
        x: g.x,
        y: g.y,
        scale: g.scale,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation: g.rotation,
        opacity: 1.0,
    };
    eval::placed_transform_at(base, g.opacity, &g.tracks, time, dur)
}

/// Draws an SVG asset placed on the stage with its element states for the frame.
fn draw_svg_node(canvas: &Canvas, l: &Loaded, n: &SvgNode, time: f64) {
    if !eval::is_visible_at(n.visible.as_ref(), time) {
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
        scale_x: 1.0,
        scale_y: 1.0,
        rotation: n.rotation,
        opacity: 1.0,
    };
    let t = eval::placed_transform_at(base, n.opacity, &n.tracks, time, dur);
    let states = eval::element_states_at(n, time, dur);
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

/// How a picture is sampled at a given device scale, matched to how Chrome paints an SVG `<image>` in the
/// Remotion render: bilinear when the picture is enlarged (measured closer to Chrome than Mitchell or
/// Catmull-Rom cubics), bilinear on the nearest mipmap level when it is reduced (the same measured parity
/// as blending two levels, at about two thirds of the cost; without mipmaps parity falls to 0.988 SSIM).
fn image_sampling(device_scale: f64) -> SamplingOptions {
    if device_scale > 1.0 {
        SamplingOptions::new(FilterMode::Linear, MipmapMode::None)
    } else {
        SamplingOptions::new(FilterMode::Linear, MipmapMode::Nearest)
    }
}

/// Draws a picture placed on the stage: the node placement, then its element state about its origin, then the image
/// stretched over the `width` x `height` box centred there, with straight alpha blended over what is below (SceneView's
/// `<image preserveAspectRatio="none">`). Opacity is the node's (a layer, like an svg node) times the element's own.
fn draw_image_node(canvas: &Canvas, l: &Loaded, n: &ImageNode, time: f64) {
    if !eval::is_visible_at(n.visible.as_ref(), time) {
        return;
    }
    let Some(image) = l.images.get(&n.asset) else {
        return;
    };
    let dur = l.ir.film.duration_frames.0;
    let base = NodeTransform {
        x: n.x,
        y: n.y,
        scale: n.scale,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation: n.rotation,
        opacity: 1.0,
    };
    let t = eval::placed_transform_at(base, n.opacity, &n.tracks, time, dur);
    let state = eval::element_states_of_at(&n.element_tracks, time, dur)
        .remove(&n.element)
        .unwrap_or_default();
    let element_opacity = state.opacity.unwrap_or(1.0);
    if element_opacity <= 0.0 {
        return;
    }
    canvas.save();
    apply_placement(canvas, &t);
    with_opacity(canvas, t.opacity, || {
        canvas.save();
        canvas.concat(&svg::state_matrix(&state));
        let dst = Rect::from_xywh(
            (-n.width / 2.0) as f32,
            (-n.height / 2.0) as f32,
            n.width as f32,
            n.height as f32,
        );
        // Device pixels per image pixel along the smaller axis decide enlarging against reducing.
        let m = canvas.local_to_device_as_3x3();
        let axis = |a: f32, b: f32| f64::from(a).hypot(f64::from(b));
        let device_scale = (axis(m.scale_x(), m.skew_y()) * n.width / f64::from(image.width()))
            .min(axis(m.skew_x(), m.scale_y()) * n.height / f64::from(image.height()));
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_alpha_f(element_opacity as f32);
        canvas.draw_image_rect_with_sampling_options(image, None, dst, image_sampling(device_scale), &paint);
        canvas.restore();
    });
    canvas.restore();
}

/// What every overlay draw needs.
pub struct OverlayCtx<'a> {
    pub l: &'a Loaded,
    pub format: Format,
    pub frame: u32,
    pub time: f64,
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
    let time = ctx.time;
    match node {
        Node::Group(g) => {
            if !eval::is_visible_at(g.visible.as_ref(), time) {
                return;
            }
            let t = group_transform(g, time, ctx.dur());
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
        // The loader refuses svg, image and stage3d nodes in the overlay.
        Node::Svg(_) | Node::Image(_) | Node::Stage3d(_) => {}
    }
}

/// Positions a boxed node: its track offset, then its scale and rotation about the box centre.
fn apply_boxed(canvas: &Canvas, t: &NodeTransform, x: f64, y: f64, w: f64, h: f64) {
    let (cx, cy) = ((x + w / 2.0) as f32, (y + h / 2.0) as f32);
    let mut m = Matrix::translate((t.x as f32, t.y as f32));
    m.pre_translate((cx, cy));
    m.pre_rotate(t.rotation as f32, None);
    m.pre_scale(((t.scale * t.scale_x) as f32, (t.scale * t.scale_y) as f32), None);
    m.pre_translate((-cx, -cy));
    canvas.concat(&m);
}

/// Draws a rounded rectangle node with its fill and centred stroke.
fn draw_rect_node(canvas: &Canvas, ctx: &OverlayCtx, r: &RectNode) {
    if !eval::is_visible_at(r.visible.as_ref(), ctx.time) {
        return;
    }
    let Some(b) = ctx.format.pick(&r.placement) else {
        return;
    };
    let t = eval::boxed_transform_at(r.opacity, &r.tracks, ctx.time, ctx.dur());
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
        if let Some(g) = &r.gradient {
            draw_gradient(canvas, rr, b.y, b.h, g);
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

/// Paints a vertical gradient (offset 0 at the box top, 1 at its bottom) into a rounded rectangle, dithered.
fn draw_gradient(canvas: &Canvas, rr: RRect, top: f64, height: f64, g: &aideos_render_ir::types::Gradient) {
    let colors: Vec<Color4f> = g
        .stops
        .iter()
        .map(|s| {
            let c = ir_color(&s.color);
            Color4f::new(c.r, c.g, c.b, c.a)
        })
        .collect();
    let pos: Vec<f32> = g.stops.iter().map(|s| s.offset as f32).collect();
    let gradient = Gradient::new(
        Colors::new(&colors, Some(&pos), TileMode::Clamp, None),
        Interpolation::default(),
    );
    let ends = ((0.0, top as f32), (0.0, (top + height) as f32));
    if let Some(shader) = shaders::linear_gradient(ends, &gradient, None) {
        let mut p = Paint::default();
        p.set_anti_alias(true);
        p.set_shader(shader);
        p.set_dither(true);
        canvas.draw_rrect(rr, &p);
    }
}

/// Maps the IR alignment to textlayout's.
fn text_align(a: Align) -> TextAlign {
    match a {
        Align::Left => TextAlign::Left,
        Align::Center => TextAlign::Center,
        Align::Right => TextAlign::Right,
    }
}

/// Builds the one text layout contract of a text node at a box font size, shared by drawing and glyph track validation.
pub(crate) fn text_spec(t: &TextNode, font_size: f64) -> TextSpec<'_> {
    TextSpec {
        text: &t.text,
        font: &t.font,
        size: font_size,
        color: ir_color(&t.color),
        letter_spacing: t.letter_spacing * font_size,
        line_height: Some(t.line_height),
        align: text_align(t.align),
        shadows: Vec::new(),
    }
}

/// Draws a text node wrapped to its box width, top-aligned in the box. Letter spacing is in ems.
fn draw_text_node(canvas: &Canvas, ctx: &OverlayCtx, t: &TextNode) {
    if !eval::is_visible_at(t.visible.as_ref(), ctx.time) {
        return;
    }
    let Some(b) = ctx.format.pick(&t.placement) else {
        return;
    };
    let tr = eval::boxed_transform_at(t.opacity, &t.tracks, ctx.time, ctx.dur());
    canvas.save();
    apply_boxed(canvas, &tr, b.x, b.y, b.w, b.h);
    with_opacity(canvas, tr.opacity, || {
        let paragraph = ctx.l.fonts.paragraph(&text_spec(t, b.font_size), b.w as f32);
        if let Some(tracks) = t.glyph_tracks.as_ref().filter(|tracks| !tracks.is_empty()) {
            paragraph.paint_glyph_tracks(canvas, (b.x as f32, b.y as f32).into(), tracks, ctx.time, ctx.dur());
        } else {
            paragraph.paint(canvas, (b.x as f32, b.y as f32));
        }
    });
    canvas.restore();
}
