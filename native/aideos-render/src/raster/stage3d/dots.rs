//! File Description: The dots-v1 treatment of the stage3d rasterizer: the vertex stage of materials/dots.ts for a drawable's frozen sample field (view space lighting band, level of detail, density, coverage, the back face cull, the clip depth bias, the point size), the point sprite rasterization rules measured on SwiftShader (the sprite's coverage test per MSAA sample on 1/16-pixel rounded square corners, `gl_PointCoord` from the snapped centre, the 2x2 quad coarse derivative `fwidth`, the point size floor of 1, LEQUAL depth test without a depth write, per-sample 8 bit alpha blending of white) and the prop edge lines as width 1 rectangles. Everything is a pure function of the frame's data, so a frame is the same bytes on every run and at every thread count.
//! Inputs and outputs: a part's samples, a world matrix and the frame's `View` -> `Sprite` values (window space, ready to bin and draw); a sprite and a tile's sample buffers -> blended sample colours; a segment -> its rectangle's corners.
//! Used by: crate::raster::stage3d::setup (prepare: sprites and edge lines) and crate::raster::stage3d::tiles (draws the sprites).

use super::pose::{normal_matrix, world_vertex, Matrix};
use super::setup::View;
use super::SUBPIXEL;

/// The clip depth bias the vertex shader applies (`gl_Position.z -= 0.000002 * w`), in window depth (half of it).
pub(crate) const DEPTH_BIAS: f64 = 0.000_001;
/// The smallest point size the GL implementation draws (the aliased point size range starts at 1).
const MIN_POINT_SIZE: f64 = 1.0;
/// The smallest fragment coverage the dots fragment shader keeps.
const MIN_COVERAGE: f64 = 0.005;
/// The key light of the dots shader, `normalize(vec3(3, 6, 5))`, taken in VIEW space.
const KEY_LIGHT: [f64; 3] = [
    0.358_568_582_800_318_1,
    0.717_137_165_600_636_2,
    0.597_614_304_667_196_8,
];

/// GLSL `smoothstep` for scalars.
pub(crate) fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// One point sprite in window space, ready to bin and rasterize. Coordinates marked GL are in the GL window space SwiftShader measured (y up), in the units the comment names.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Sprite {
    /// Inclusive pixel bounds in the frame (y down), clipped to the frame.
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    /// Coverage bounds in 1/16 pixel, GL space: a sample is covered when `lo <= position < hi` on both axes.
    pub xlo: i64,
    pub xhi: i64,
    pub ylo: i64,
    pub yhi: i64,
    /// The point coordinate origin (the snapped centre minus half the size) in pixels, GL space, and the size.
    pub ox: f64,
    pub oy: f64,
    pub size: f64,
    /// Window depth after the clip bias.
    pub z: f32,
}

/// The camera geometry the dots vertex shader reads besides the view's projection.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DotsCamera {
    /// Depth constants of the orthographic camera.
    pub camera_z: f64,
    pub near: f64,
    pub far: f64,
}

/// Rounds a pixel value to 1/16 pixel units, half up (the GL rounding SwiftShader applies to the sprite's corners and centre).
fn round16(v: f64) -> i64 {
    (v * SUBPIXEL as f64 + 0.5).floor() as i64
}

/// The window depth of a world z: 0 at the near plane, 1 at the far plane, before any bias.
pub(crate) fn window_depth(camera: &DotsCamera, world_z: f64) -> f64 {
    ((camera.camera_z - world_z) - camera.near) / (camera.far - camera.near)
}

/// What one drawable's dots need to run the vertex stage.
pub(crate) struct SampleField<'a> {
    pub positions: &'a [f32],
    pub normals: &'a [f32],
    pub ranks: &'a [f32],
    /// `1 - lightness` of the original material's colour.
    pub tone: f64,
    pub double_sided: bool,
}

/// Runs the dots vertex stage for every sample of a drawable and pushes the sprites that survive (coverage, cull, clip), in file order.
pub(crate) fn push_sprites(
    out: &mut Vec<Sprite>,
    field: &SampleField,
    m: &Matrix,
    view: &View,
    camera: &DotsCamera,
) {
    let Some(nm) = normal_matrix(m) else {
        return;
    };
    let scale_y = (m[4] * m[4] + m[5] * m[5] + m[6] * m[6]).sqrt();
    // Pixels per object unit: viewportHeight * projectionMatrix[1][1] * length(modelMatrix[1].xyz) * 0.5.
    let ppu = view.zoom_fit() * scale_y;
    let lod = (ppu / 100.0).clamp(0.18, 1.0);
    let base_size = (ppu * 0.024).clamp(2.0, 4.6);
    let height = f64::from(view.height);
    let width = f64::from(view.width);
    for i in 0..field.ranks.len() {
        let p = [
            field.positions[i * 3],
            field.positions[i * 3 + 1],
            field.positions[i * 3 + 2],
        ];
        let wp = world_vertex(m, p);
        let v = view.to_view_space(
            f64::from(wp[0]),
            f64::from(wp[1]),
            f64::from(wp[2]),
            camera.camera_z,
        );
        let n = [
            f64::from(field.normals[i * 3]),
            f64::from(field.normals[i * 3 + 1]),
            f64::from(field.normals[i * 3 + 2]),
        ];
        let nw = [
            nm[0][0] * n[0] + nm[0][1] * n[1] + nm[0][2] * n[2],
            nm[1][0] * n[0] + nm[1][1] * n[1] + nm[1][2] * n[2],
            nm[2][0] * n[0] + nm[2][1] * n[1] + nm[2][2] * n[2],
        ];
        let nv = view.rotate_to_view(nw);
        let len = (nv[0] * nv[0] + nv[1] * nv[1] + nv[2] * nv[2]).sqrt();
        if !(len > 0.0 && len.is_finite()) {
            continue;
        }
        let nv = [nv[0] / len, nv[1] / len, nv[2] / len];
        let light = nv[0] * KEY_LIGHT[0] + nv[1] * KEY_LIGHT[1] + nv[2] * KEY_LIGHT[2];
        let band = if light > 0.65 {
            0.25
        } else if light > 0.1 {
            0.58
        } else {
            0.93
        };
        let density = ((0.2 + field.tone * 0.45 + band * 0.4) * lod).clamp(0.08, 1.0);
        let rank = f64::from(field.ranks[i]);
        let coverage = smoothstep(rank - 0.1, rank + 0.1, density);
        if coverage < MIN_COVERAGE {
            continue;
        }
        if !field.double_sided {
            // The shader's view vector points at the camera origin, not down the z axis.
            let vl = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
            if vl > 0.0 && -(nv[0] * v[0] + nv[1] * v[1] + nv[2] * v[2]) / vl < 0.04 {
                continue;
            }
        }
        let (sx, sy) = view.project(f64::from(wp[0]), f64::from(wp[1]));
        let z = window_depth(camera, f64::from(wp[2])) - DEPTH_BIAS;
        // The point's centre must be inside the clip volume.
        let inside = sx.is_finite()
            && sy.is_finite()
            && z.is_finite()
            && (0.0..=width).contains(&sx)
            && (0.0..=height).contains(&sy)
            && (0.0..=1.0).contains(&z);
        if !inside {
            continue;
        }
        let size = (base_size * coverage.sqrt()).max(MIN_POINT_SIZE);
        if let Some(sprite) = Sprite::new(sx, height - sy, size, z as f32, view) {
            out.push(sprite);
        }
    }
}

impl Sprite {
    /// Builds a sprite from its window centre (GL space), size and depth, or None when no sample can be covered or it lies outside the frame.
    fn new(cx: f64, cy: f64, size: f64, z: f32, view: &View) -> Option<Sprite> {
        let half = size / 2.0;
        let (xlo, xhi) = (round16(cx - half), round16(cx + half));
        let (ylo, yhi) = (round16(cy - half), round16(cy + half));
        if xhi <= xlo || yhi <= ylo {
            return None;
        }
        let h = i64::from(view.height);
        let (px0, px1) = (xlo.div_euclid(SUBPIXEL), (xhi - 1).div_euclid(SUBPIXEL));
        let (gy0, gy1) = (ylo.div_euclid(SUBPIXEL), (yhi - 1).div_euclid(SUBPIXEL));
        let (x0, x1) = (px0.max(0), px1.min(i64::from(view.width) - 1));
        let (y0, y1) = ((h - 1 - gy1).max(0), (h - 1 - gy0).min(h - 1));
        if x0 > x1 || y0 > y1 {
            return None;
        }
        Some(Sprite {
            x0: x0 as i32,
            y0: y0 as i32,
            x1: x1 as i32,
            y1: y1 as i32,
            xlo,
            xhi,
            ylo,
            yhi,
            ox: round16(cx) as f64 / SUBPIXEL as f64 - half,
            oy: round16(cy) as f64 / SUBPIXEL as f64 - half,
            size,
            z,
        })
    }

    /// `r` of the fragment shader (the distance of the point coordinate from the sprite's centre) at the centre of GL pixel (`x`, `gl_row`).
    fn radius(&self, x: i64, gl_row: i64) -> f64 {
        let u = ((x as f64 + 0.5) - self.ox) / self.size;
        let v = ((gl_row as f64 + 0.5) - self.oy) / self.size;
        (u - 0.5).hypot(v - 0.5)
    }

    /// The fragment's alpha at frame pixel (`px`, `py`), or None when the fragment discards: `1 - smoothstep(0.5 - edge, 0.5, r)` with `edge = max(fwidth(r), 0.04)`, `fwidth` taken as the coarse derivative of the pixel's 2x2 quad.
    pub(crate) fn alpha(&self, px: i32, py: i32, height: i32) -> Option<f32> {
        // The quad is the pair of columns (x & !1, +1) and the pair of GL rows (row & !1, +1); the coarse derivative reads its first (even GL) row and column, as SwiftShader does (measured by the probe).
        let row = i64::from(height - 1 - py);
        let (qx, qy) = (i64::from(px & !1), row & !1);
        let r = self.radius(i64::from(px), row);
        let dx = self.radius(qx + 1, qy) - self.radius(qx, qy);
        let dy = self.radius(qx, qy + 1) - self.radius(qx, qy);
        let edge = (dx.abs() + dy.abs()).max(0.04);
        let alpha = 1.0 - smoothstep(0.5 - edge, 0.5, r);
        if alpha < 0.01 {
            None
        } else {
            Some(alpha as f32)
        }
    }

    /// Which of the frame's MSAA samples at pixel (`px`, `py`) the sprite's square covers (a bit per sample); `samples` are the frame's sample positions in 1/16 pixel with y down.
    pub(crate) fn coverage(&self, px: i32, py: i32, height: i32, samples: &[(i64, i64)]) -> u32 {
        let mut mask = 0;
        let row = i64::from(height - 1 - py);
        for (k, &(sx, sy)) in samples.iter().enumerate() {
            // The GL sample position is the frame's, mirrored in y.
            let x = i64::from(px) * SUBPIXEL + sx;
            let y = row * SUBPIXEL + (SUBPIXEL - sy);
            if self.xlo <= x && x < self.xhi && self.ylo <= y && y < self.yhi {
                mask |= 1 << k;
            }
        }
        mask
    }
}

/// Blends white at `alpha` over one 8 bit sample colour (packed RGBA8, red lowest): each channel is `round(255 * (alpha + dst / 255 * (1 - alpha)))`, alpha included (three's separate blend: SRC_ALPHA and ONE over ONE_MINUS_SRC_ALPHA).
pub(crate) fn blend_white(dst: u32, alpha: f32) -> u32 {
    let mut out = 0u32;
    for k in 0..4 {
        let d = ((dst >> (8 * k)) & 0xff) as f32 / 255.0;
        let v = ((alpha + d * (1.0 - alpha)) * 255.0 + 0.5)
            .floor()
            .clamp(0.0, 255.0) as u32;
        out |= v << (8 * k);
    }
    out
}

/// The four corners of the width 1 rectangle around the segment (`a` to `b`, window pixels, y down), exact endpoints, or None for a segment with no length.
pub(crate) fn line_rect(a: (f64, f64), b: (f64, f64)) -> Option<[(f64, f64); 4]> {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len = dx.hypot(dy);
    if !(len > 0.0 && len.is_finite()) {
        return None;
    }
    let (nx, ny) = (-dy / len * 0.5, dx / len * 0.5);
    Some([
        (a.0 + nx, a.1 + ny),
        (b.0 + nx, b.1 + ny),
        (b.0 - nx, b.1 - ny),
        (a.0 - nx, a.1 - ny),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A white layer over opaque black at half alpha is mid grey, rounded to nearest, and over nothing is premultiplied white.
    #[test]
    fn blends_white_over_the_destination() {
        assert_eq!(blend_white(0xff00_0000, 0.5) & 0xffff, 0x8080);
        assert_eq!(blend_white(0, 0.25), 0x4040_4040);
        assert_eq!(blend_white(0xffff_ffff, 0.3), 0xffff_ffff);
    }

    /// The width 1 rectangle of a horizontal segment is one pixel tall around it.
    #[test]
    fn a_horizontal_line_is_one_pixel_tall() {
        let r = line_rect((1.0, 2.0), (5.0, 2.0)).unwrap();
        assert_eq!(r[0], (1.0, 2.5));
        assert_eq!(r[3], (1.0, 1.5));
        assert!(line_rect((1.0, 1.0), (1.0, 1.0)).is_none());
    }

    /// GLSL smoothstep is 0 below, 1 above and 0.5 in the middle.
    #[test]
    fn smoothstep_matches_glsl() {
        assert_eq!(smoothstep(0.0, 1.0, -1.0), 0.0);
        assert_eq!(smoothstep(0.0, 1.0, 2.0), 1.0);
        assert!((smoothstep(0.0, 1.0, 0.5) - 0.5).abs() < 1e-12);
    }
}
