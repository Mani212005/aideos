//! File Description: Paints a character's face texture natively: replays one recorded Canvas 2D face program (the ops `backend/renderIr/emitStage3d.ts` records from the frozen face painter) into a Skia CPU raster surface, the same library Chrome's canvas draws with, and reads the pixels back as straight-alpha RGB. The canvas state the ops touch (fill and stroke paints, line width, cap, join, global alpha) is saved and restored with `save` and `restore` exactly as a canvas does; paths are built in the user space current when they are filled, which is what the painter relies on (it never changes the transform between building a path and filling it). Arcs and ellipses become cubic Beziers in the canvas's clockwise convention, with the implicit line from the current point.
//! Inputs and outputs: a texture size and a face program's ops -> a `Texture` (size and RGB8 texels) or an error text.
//! Used by: crate::raster::stage3d (the per-program texture cache) and the unit tests below.

use aideos_render_ir::types::{FaceOp, FacePaint, LineCap, LineJoin};
use skia_safe::gradient::{shaders, Colors, Gradient, Interpolation};
use skia_safe::{
    paint, surfaces, AlphaType, Color, Color4f, ColorType, ImageInfo, Matrix, Paint, PathBuilder,
    Point, Rect, TileMode,
};

use crate::svg::color::parse_color;

/// A painted face texture: straight-alpha colour with the alpha dropped (the face material is opaque), rows top to bottom.
#[derive(Debug)]
pub struct Texture {
    pub size: usize,
    /// RGB8, `size * size * 3` bytes.
    pub rgb: Vec<u8>,
}

/// The canvas state `save` and `restore` carry besides the matrix and clip (which Skia saves itself).
#[derive(Clone)]
struct PaintState {
    fill: FacePaint,
    stroke: FacePaint,
    line_width: f32,
    cap: LineCap,
    join: LineJoin,
    alpha: f32,
}

impl Default for PaintState {
    /// The canvas default state: black paints, width 1, butt caps, miter joins, opaque.
    fn default() -> Self {
        let black = FacePaint::Color {
            color: "#000000".to_string(),
            alpha: 1.0,
        };
        PaintState {
            fill: black.clone(),
            stroke: black,
            line_width: 1.0,
            cap: LineCap::Butt,
            join: LineJoin::Miter,
            alpha: 1.0,
        }
    }
}

/// Where the path being built has got to, so an arc knows whether to draw its implicit leading line.
struct PathState {
    builder: PathBuilder,
    has_point: bool,
}

impl PathState {
    /// An empty path.
    fn new() -> Self {
        PathState {
            builder: PathBuilder::new(),
            has_point: false,
        }
    }

    /// Starts a subpath.
    fn move_to(&mut self, x: f64, y: f64) {
        self.builder.move_to((x as f32, y as f32));
        self.has_point = true;
    }

    /// Adds a line (a canvas `lineTo` on an empty path starts a subpath instead).
    fn line_to(&mut self, x: f64, y: f64) {
        if self.has_point {
            self.builder.line_to((x as f32, y as f32));
        } else {
            self.move_to(x, y);
        }
    }

    /// Adds an elliptical arc as cubic Beziers, clockwise in the canvas convention (y down), with the line from the current point to its start.
    fn ellipse(&mut self, a: &[f64; 7]) {
        let [cx, cy, rx, ry, rotation, start, end] = *a;
        let tau = std::f64::consts::TAU;
        let sweep = if end - start >= tau {
            tau
        } else {
            (end - start).rem_euclid(tau)
        };
        let (cos_r, sin_r) = (rotation.cos(), rotation.sin());
        // The point of the ellipse at parameter t, and its derivative direction.
        let point = |t: f64| {
            let (ex, ey) = (rx * t.cos(), ry * t.sin());
            (cx + ex * cos_r - ey * sin_r, cy + ex * sin_r + ey * cos_r)
        };
        let tangent = |t: f64| {
            let (ex, ey) = (-rx * t.sin(), ry * t.cos());
            (ex * cos_r - ey * sin_r, ex * sin_r + ey * cos_r)
        };
        let (sx, sy) = point(start);
        self.line_to(sx, sy);
        let segments = ((sweep / std::f64::consts::FRAC_PI_2).ceil() as usize).max(1);
        let step = sweep / segments as f64;
        let k = 4.0 / 3.0 * (step / 4.0).tan();
        for i in 0..segments {
            let (t0, t1) = (start + step * i as f64, start + step * (i + 1) as f64);
            let (p0, p1) = (point(t0), point(t1));
            let (d0, d1) = (tangent(t0), tangent(t1));
            let c1 = (p0.0 + k * d0.0, p0.1 + k * d0.1);
            let c2 = (p1.0 - k * d1.0, p1.1 - k * d1.1);
            self.builder.cubic_to(
                (c1.0 as f32, c1.1 as f32),
                (c2.0 as f32, c2.1 as f32),
                (p1.0 as f32, p1.1 as f32),
            );
        }
    }
}

/// Builds a Skia paint from a face paint, the line style and the global alpha.
fn make_paint(p: &FacePaint, alpha: f32, stroke: Option<&PaintState>) -> Result<Paint, String> {
    let mut out = Paint::default();
    out.set_anti_alias(true);
    match p {
        FacePaint::Color { color, alpha: a } => {
            let c = parse_color(color)
                .ok_or_else(|| format!("face colour {color:?} is not a colour"))?;
            out.set_color4f(Color4f::new(c.r, c.g, c.b, *a as f32 * alpha), None);
        }
        FacePaint::LinearGradient {
            x0,
            y0,
            x1,
            y1,
            stops,
        } => {
            let mut colors = Vec::with_capacity(stops.len());
            let mut positions = Vec::with_capacity(stops.len());
            for s in stops {
                let c = parse_color(&s.color)
                    .ok_or_else(|| format!("face gradient colour {:?} is not a colour", s.color))?;
                colors.push(Color4f::new(c.r, c.g, c.b, s.alpha as f32));
                positions.push(s.offset as f32);
            }
            let gradient = Gradient::new(
                Colors::new(&colors, Some(&positions), TileMode::Clamp, None),
                Interpolation::default(),
            );
            let ends = (
                Point::new(*x0 as f32, *y0 as f32),
                Point::new(*x1 as f32, *y1 as f32),
            );
            let shader = shaders::linear_gradient(ends, &gradient, None)
                .ok_or_else(|| "a face gradient could not be built".to_string())?;
            out.set_shader(shader);
            out.set_alpha_f(alpha);
        }
    }
    if let Some(state) = stroke {
        out.set_style(paint::Style::Stroke);
        out.set_stroke_width(state.line_width);
        out.set_stroke_miter(10.0);
        out.set_stroke_cap(match state.cap {
            LineCap::Butt => paint::Cap::Butt,
            LineCap::Round => paint::Cap::Round,
            LineCap::Square => paint::Cap::Square,
        });
        out.set_stroke_join(match state.join {
            LineJoin::Miter => paint::Join::Miter,
            LineJoin::Round => paint::Join::Round,
            LineJoin::Bevel => paint::Join::Bevel,
        });
    }
    Ok(out)
}

/// Replays one face program onto a transparent `size` x `size` canvas and returns its pixels (straight alpha, alpha dropped).
pub fn paint_face(size: usize, ops: &[FaceOp]) -> Result<Texture, String> {
    let n = i32::try_from(size).map_err(|_| format!("face size {size} is too large"))?;
    let mut surface = surfaces::raster_n32_premul((n, n))
        .ok_or_else(|| format!("cannot create a {size}x{size} face surface"))?;
    {
        let canvas = surface.canvas();
        canvas.clear(Color::TRANSPARENT);
        let mut state = PaintState::default();
        let mut saved: Vec<PaintState> = Vec::new();
        let mut path = PathState::new();
        for op in ops {
            match op {
                FaceOp::SetTransform { args: a } => {
                    let m = Matrix::new_all(
                        a[0] as f32,
                        a[2] as f32,
                        a[4] as f32,
                        a[1] as f32,
                        a[3] as f32,
                        a[5] as f32,
                        0.0,
                        0.0,
                        1.0,
                    );
                    canvas.set_matrix(&m.into());
                }
                FaceOp::Save => {
                    saved.push(state.clone());
                    canvas.save();
                }
                FaceOp::Restore => {
                    // A restore with nothing saved does nothing, as on a canvas.
                    if let Some(previous) = saved.pop() {
                        state = previous;
                        canvas.restore();
                    }
                }
                FaceOp::Scale { args: a } => {
                    canvas.scale((a[0] as f32, a[1] as f32));
                }
                FaceOp::Translate { args: a } => {
                    canvas.translate((a[0] as f32, a[1] as f32));
                }
                FaceOp::FillStyle { paint } => state.fill = paint.clone(),
                FaceOp::StrokeStyle { paint } => state.stroke = paint.clone(),
                FaceOp::LineWidth { value } => state.line_width = *value as f32,
                FaceOp::LineCap { value } => state.cap = *value,
                FaceOp::LineJoin { value } => state.join = *value,
                FaceOp::GlobalAlpha { value } => state.alpha = *value as f32,
                FaceOp::FillRect { args: a } => {
                    let p = make_paint(&state.fill, state.alpha, None)?;
                    canvas.draw_rect(
                        Rect::from_xywh(a[0] as f32, a[1] as f32, a[2] as f32, a[3] as f32),
                        &p,
                    );
                }
                FaceOp::BeginPath => path = PathState::new(),
                FaceOp::MoveTo { args: a } => path.move_to(a[0], a[1]),
                FaceOp::LineTo { args: a } => path.line_to(a[0], a[1]),
                FaceOp::QuadraticCurveTo { args: a } => {
                    if !path.has_point {
                        path.move_to(a[0], a[1]);
                    }
                    path.builder
                        .quad_to((a[0] as f32, a[1] as f32), (a[2] as f32, a[3] as f32));
                }
                FaceOp::BezierCurveTo { args: a } => {
                    if !path.has_point {
                        path.move_to(a[0], a[1]);
                    }
                    path.builder.cubic_to(
                        (a[0] as f32, a[1] as f32),
                        (a[2] as f32, a[3] as f32),
                        (a[4] as f32, a[5] as f32),
                    );
                }
                FaceOp::Ellipse { args } => path.ellipse(args),
                FaceOp::Arc { args: a } => path.ellipse(&[a[0], a[1], a[2], a[2], 0.0, a[3], a[4]]),
                FaceOp::Fill => {
                    let p = make_paint(&state.fill, state.alpha, None)?;
                    canvas.draw_path(&path.builder.snapshot(), &p);
                }
                FaceOp::Stroke => {
                    let p = make_paint(&state.stroke, state.alpha, Some(&state))?;
                    canvas.draw_path(&path.builder.snapshot(), &p);
                }
                FaceOp::Clip => {
                    canvas.clip_path(&path.builder.snapshot(), None, Some(true));
                }
            }
        }
    }
    let info = ImageInfo::new((n, n), ColorType::RGBA8888, AlphaType::Unpremul, None);
    let mut rgba = vec![0u8; size * size * 4];
    if !surface.read_pixels(&info, &mut rgba, size * 4, (0, 0)) {
        return Err("cannot read the face texture's pixels".to_string());
    }
    let mut rgb = Vec::with_capacity(size * size * 3);
    for px in rgba.chunks_exact(4) {
        rgb.extend_from_slice(&px[..3]);
    }
    Ok(Texture { size, rgb })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aideos_render_ir::types::FaceStop;

    /// A solid fill paints exactly its colour and leaves the rest transparent (read back as black RGB).
    #[test]
    fn a_fill_paints_its_colour() {
        let ops = vec![
            FaceOp::FillStyle {
                paint: FacePaint::Color {
                    color: "#ff8000".into(),
                    alpha: 1.0,
                },
            },
            FaceOp::FillRect {
                args: [0.0, 0.0, 4.0, 8.0],
            },
        ];
        let t = paint_face(8, &ops).expect("paints");
        assert_eq!(&t.rgb[0..3], &[255, 128, 0]);
        // Row 0, column 6 is outside the rectangle.
        assert_eq!(&t.rgb[6 * 3..6 * 3 + 3], &[0, 0, 0]);
    }

    /// Restore brings back the paint that save kept, as a canvas does.
    #[test]
    fn restore_restores_the_paint_state() {
        let red = FacePaint::Color {
            color: "#ff0000".into(),
            alpha: 1.0,
        };
        let blue = FacePaint::Color {
            color: "#0000ff".into(),
            alpha: 1.0,
        };
        let ops = vec![
            FaceOp::FillStyle { paint: red },
            FaceOp::Save,
            FaceOp::FillStyle { paint: blue },
            FaceOp::Restore,
            FaceOp::FillRect {
                args: [0.0, 0.0, 8.0, 8.0],
            },
        ];
        let t = paint_face(8, &ops).expect("paints");
        assert_eq!(&t.rgb[0..3], &[255, 0, 0]);
    }

    /// A full-circle ellipse fills its centre and not the corners; a clip confines later fills.
    #[test]
    fn circles_fill_and_clips_confine() {
        let ops = vec![
            FaceOp::FillStyle {
                paint: FacePaint::Color {
                    color: "#00ff00".into(),
                    alpha: 1.0,
                },
            },
            FaceOp::BeginPath,
            FaceOp::Ellipse {
                args: [8.0, 8.0, 6.0, 6.0, 0.0, 0.0, 7.0],
            },
            FaceOp::Fill,
        ];
        let t = paint_face(16, &ops).expect("paints");
        let at = |x: usize, y: usize| &t.rgb[(y * 16 + x) * 3..(y * 16 + x) * 3 + 3];
        assert_eq!(at(8, 8), &[0, 255, 0]);
        assert_eq!(at(0, 0), &[0, 0, 0]);
        let clipped = vec![
            FaceOp::BeginPath,
            FaceOp::Ellipse {
                args: [8.0, 8.0, 3.0, 3.0, 0.0, 0.0, 7.0],
            },
            FaceOp::Clip,
            FaceOp::FillStyle {
                paint: FacePaint::Color {
                    color: "#ffffff".into(),
                    alpha: 1.0,
                },
            },
            FaceOp::FillRect {
                args: [0.0, 0.0, 16.0, 16.0],
            },
        ];
        let t = paint_face(16, &clipped).expect("paints");
        let at = |x: usize, y: usize| &t.rgb[(y * 16 + x) * 3..(y * 16 + x) * 3 + 3];
        assert_eq!(at(8, 8), &[255, 255, 255]);
        assert_eq!(at(1, 1), &[0, 0, 0]);
    }

    /// A vertical gradient runs from its first stop to its last.
    #[test]
    fn gradients_interpolate() {
        let g = FacePaint::LinearGradient {
            x0: 0.0,
            y0: 0.0,
            x1: 0.0,
            y1: 16.0,
            stops: vec![
                FaceStop {
                    offset: 0.0,
                    color: "#000000".into(),
                    alpha: 1.0,
                },
                FaceStop {
                    offset: 1.0,
                    color: "#ffffff".into(),
                    alpha: 1.0,
                },
            ],
        };
        let ops = vec![
            FaceOp::FillStyle { paint: g },
            FaceOp::FillRect {
                args: [0.0, 0.0, 16.0, 16.0],
            },
        ];
        let t = paint_face(16, &ops).expect("paints");
        assert!(t.rgb[0] < 24, "the top is nearly black");
        assert!(t.rgb[15 * 16 * 3] > 230, "the bottom is nearly white");
    }

    /// The same program paints the same texels twice.
    #[test]
    fn painting_is_deterministic() {
        let ops = vec![
            FaceOp::FillStyle {
                paint: FacePaint::Color {
                    color: "#3366cc".into(),
                    alpha: 0.5,
                },
            },
            FaceOp::BeginPath,
            FaceOp::MoveTo { args: [1.0, 1.0] },
            FaceOp::BezierCurveTo {
                args: [10.0, 0.0, 12.0, 10.0, 3.0, 14.0],
            },
            FaceOp::Fill,
        ];
        let a = paint_face(16, &ops).expect("paints");
        let b = paint_face(16, &ops).expect("paints");
        assert_eq!(a.rgb, b.rgb);
    }
}
