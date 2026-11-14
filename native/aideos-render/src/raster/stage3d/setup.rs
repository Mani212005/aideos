//! File Description: The vertex and triangle-setup stage of the stage3d rasterizer. For one frame it poses every drawable's vertices (world matrix, three's `applyMatrix4` rounding to f32, the ink outline's push along the normals), projects them through the document camera and the cover fit exactly as `stagePointProjector` does (so the 3D layer lines up with the SVG planes), snaps them to the 1/16-pixel grid GL rasterizes on, culls faces by the material's side, and turns each surviving triangle into integer edge equations (exact in i64, so coverage and the top-left fill rule are exact), a depth interpolation and a polygon-offset bias. Output triangles keep the IR's drawable order.
//! Inputs and outputs: the loaded `Stage3dScene`, the frame's world matrices and a `View` -> `Prepared`: triangles in draw order, per-drawable world normals for the toon shader and the painted face textures the frame needs.
//! Used by: crate::raster::stage3d (`render_layer`) and the tile rasterizer in tiles.rs.

use std::sync::Arc;

use super::face::Texture;
use super::pose::{determinant3, normal_matrix, world_vertex, Matrix};
use super::{Shading, Stage3dScene, SUBPIXEL};
use aideos_render_ir::types::Side;

use crate::eval::CameraPose;

/// Coordinates beyond this many sub-pixel steps (about 33 million pixels) are not drawn: they keep the edge equations inside i64.
const FIXED_LIMIT: f64 = (1i64 << 29) as f64;
/// The smallest depth step of a 24-bit depth buffer, which polygon offset's `units` multiplies.
const DEPTH_RESOLUTION: f64 = 1.0 / 16_777_216.0;

/// The camera and frame geometry a frame projects through: `stagePointProjector` with the stage's cover fit.
pub(crate) struct View {
    half_width: f64,
    half_height: f64,
    scene_half: (f64, f64),
    center: (f64, f64),
    zoom_fit: f64,
    cos: f64,
    sin: f64,
    pub width: u32,
    pub height: u32,
}

impl View {
    /// Binds a camera pose, the scene's size and the frame's size.
    pub fn new(camera: &CameraPose, scene: (f64, f64), width: u32, height: u32) -> View {
        let fit = (f64::from(width) / scene.0).max(f64::from(height) / scene.1);
        let r = camera.rotation * std::f64::consts::PI / 180.0;
        View {
            half_width: f64::from(width) / 2.0,
            half_height: f64::from(height) / 2.0,
            scene_half: (scene.0 / 2.0, scene.1 / 2.0),
            center: (camera.center_x, camera.center_y),
            zoom_fit: camera.zoom * fit,
            cos: r.cos(),
            sin: r.sin(),
            width,
            height,
        }
    }

    /// Projects a world point to frame pixels (y down).
    fn project(&self, x: f64, y: f64) -> (f64, f64) {
        let (dx, dy) = (
            x + self.scene_half.0 - self.center.0,
            self.scene_half.1 - y - self.center.1,
        );
        (
            self.half_width + (dx * self.cos - dy * self.sin) * self.zoom_fit,
            self.half_height + (dx * self.sin + dy * self.cos) * self.zoom_fit,
        )
    }
}

/// One triangle ready to rasterize: edge equations in 1/16-pixel fixed point and its depth plane.
pub(crate) struct Tri {
    pub drawable: u32,
    /// Vertex indices into the drawable's part, in the winding the edge equations use (positive area).
    pub v: [u32; 3],
    /// Edge i's equation is `a[i] * X + b[i] * Y + c[i]` (X and Y in 1/16 pixel), positive inside; `c` already includes the top-left tie rule, so a sample is covered when all three are not negative.
    pub a: [i64; 3],
    pub b: [i64; 3],
    pub c: [i64; 3],
    /// Add to `c[i]`'s value to get the true edge value (undoes the tie-rule adjustment).
    pub off: [i64; 3],
    pub z: [f64; 3],
    pub inv_area: f64,
    pub bias: f64,
    pub front: bool,
    /// Inclusive pixel bounds, clipped to the frame.
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

/// What a frame draws: triangles in draw order plus the per-frame inputs the shaders read.
pub(crate) struct Prepared {
    pub tris: Vec<Tri>,
    /// Unit world-space vertex normals per drawable (empty unless the drawable is toon shaded).
    pub normals: Vec<Vec<f32>>,
    /// The painted face texture of each texture slot a drawable uses.
    pub textures: Vec<Option<Arc<Texture>>>,
}

/// Normalizes a vector, returning zeros for one with no length.
fn normalize(v: [f64; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len > 0.0 && len.is_finite() {
        [
            (v[0] / len) as f32,
            (v[1] / len) as f32,
            (v[2] / len) as f32,
        ]
    } else {
        [0.0; 3]
    }
}

/// A projected vertex: fixed-point screen position and window depth, or None when it cannot be drawn.
type Projected = Option<(i64, i64, f64)>;

/// Poses and projects every drawable's vertices for the frame and sets its triangles up.
pub(crate) fn prepare(
    scene: &Stage3dScene,
    world: &[Matrix],
    view: &View,
    frame: u32,
) -> Result<Prepared, String> {
    let mut textures: Vec<Option<Arc<Texture>>> = vec![None; scene.textures.len()];
    let mut tris: Vec<Tri> = Vec::new();
    let mut normals: Vec<Vec<f32>> = Vec::with_capacity(scene.drawables.len());
    let mut projected: Vec<Projected> = Vec::new();
    for (di, d) in scene.drawables.iter().enumerate() {
        let part = &scene.parts[d.part];
        let m = &world[d.node];
        if let Shading::Face { texture, .. } = &d.shading {
            if textures[*texture].is_none() {
                textures[*texture] = Some(scene.face_texture(*texture, frame)?);
            }
        }
        let count = part.positions.len() / 3;
        // Vertex stage: local position (pushed along the normal for ink), world position, screen position.
        projected.clear();
        for i in 0..count {
            let mut p = [
                part.positions[i * 3],
                part.positions[i * 3 + 1],
                part.positions[i * 3 + 2],
            ];
            if let Some(w) = d.ink_width {
                for (k, v) in p.iter_mut().enumerate() {
                    *v += part.normals[i * 3 + k] * w;
                }
            }
            let wp = world_vertex(m, p);
            let (sx, sy) = view.project(f64::from(wp[0]), f64::from(wp[1]));
            let depth =
                ((scene.camera_z - f64::from(wp[2])) - scene.near) / (scene.far - scene.near);
            let (fx, fy) = (sx * SUBPIXEL as f64, sy * SUBPIXEL as f64);
            projected.push(
                if fx.is_finite()
                    && fy.is_finite()
                    && depth.is_finite()
                    && fx.abs() < FIXED_LIMIT
                    && fy.abs() < FIXED_LIMIT
                {
                    Some((fx.round() as i64, fy.round() as i64, depth))
                } else {
                    None
                },
            );
        }
        // World normals for the toon shader: the inverse transpose of the world matrix, normalized.
        let mut world_normals = Vec::new();
        if matches!(d.shading, Shading::Toon { .. }) {
            if let Some(nm) = normal_matrix(m) {
                world_normals.reserve(count * 3);
                for i in 0..count {
                    let n = [
                        f64::from(part.normals[i * 3]),
                        f64::from(part.normals[i * 3 + 1]),
                        f64::from(part.normals[i * 3 + 2]),
                    ];
                    let v = [
                        nm[0][0] * n[0] + nm[0][1] * n[1] + nm[0][2] * n[2],
                        nm[1][0] * n[0] + nm[1][1] * n[1] + nm[1][2] * n[2],
                        nm[2][0] * n[0] + nm[2][1] * n[1] + nm[2][2] * n[2],
                    ];
                    world_normals.extend_from_slice(&normalize(v));
                }
            } else {
                // A singular transform collapses the part; its triangles have no area and are culled below.
                world_normals.resize(count * 3, 0.0);
            }
        }
        normals.push(world_normals);
        let mirrored = determinant3(m) < 0.0;
        for t in part.indices.chunks_exact(3) {
            let (Some(p0), Some(p1), Some(p2)) = (
                projected[t[0] as usize],
                projected[t[1] as usize],
                projected[t[2] as usize],
            ) else {
                continue;
            };
            if let Some(tri) = set_up(
                di as u32,
                d.side,
                d.offset,
                mirrored,
                [t[0], t[1], t[2]],
                [p0, p1, p2],
                view,
            ) {
                tris.push(tri);
            }
        }
    }
    Ok(Prepared {
        tris,
        normals,
        textures,
    })
}

/// Sets one triangle up, or None when it is culled, has no area or lies outside the frame.
fn set_up(
    drawable: u32,
    side: Side,
    offset: Option<(f64, f64)>,
    mirrored: bool,
    mut v: [u32; 3],
    p: [(i64, i64, f64); 3],
    view: &View,
) -> Option<Tri> {
    let (mut x, mut y, mut z) = (
        [p[0].0, p[1].0, p[2].0],
        [p[0].1, p[1].1, p[2].1],
        [p[0].2, p[1].2, p[2].2],
    );
    let area = (x[1] - x[0]) * (y[2] - y[0]) - (y[1] - y[0]) * (x[2] - x[0]);
    if area == 0 {
        return None;
    }
    // Screen y is down, so a world counter-clockwise (front) triangle has a negative area here; a mirroring transform flips that.
    let front = (area < 0) != mirrored;
    let draws = match side {
        Side::Front => front,
        Side::Back => !front,
        Side::Double => true,
    };
    if !draws {
        return None;
    }
    // Edge equations want a positive area: swap two vertices of a negative one.
    let area = if area < 0 {
        v.swap(1, 2);
        x.swap(1, 2);
        y.swap(1, 2);
        z.swap(1, 2);
        -area
    } else {
        area
    };
    let (mut a, mut b, mut c, mut off) = ([0i64; 3], [0i64; 3], [0i64; 3], [0i64; 3]);
    for i in 0..3 {
        // Edge i runs from vertex i+1 to vertex i+2 and faces vertex i.
        let (p0, p1) = ((i + 1) % 3, (i + 2) % 3);
        let (dx, dy) = (x[p1] - x[p0], y[p1] - y[p0]);
        a[i] = -dy;
        b[i] = dx;
        let true_c = dy * x[p0] - dx * y[p0];
        // Top-left rule (y down, interior positive): a sample exactly on a top or left edge is inside, on any other edge outside.
        let top_left = dy < 0 || (dy == 0 && dx > 0);
        off[i] = if top_left { 0 } else { 1 };
        c[i] = true_c - off[i];
    }
    let inv_area = 1.0 / area as f64;
    let bias = match offset {
        None => 0.0,
        Some((factor, units)) => {
            // Slope-scaled depth bias, as glPolygonOffset: the larger window-space depth slope times the factor plus units of depth resolution.
            let (mut dzdx, mut dzdy) = (0.0, 0.0);
            for i in 0..3 {
                dzdx += a[i] as f64 * z[i];
                dzdy += b[i] as f64 * z[i];
            }
            let slope = (dzdx.abs().max(dzdy.abs())) * inv_area * SUBPIXEL as f64;
            factor * slope + units * DEPTH_RESOLUTION
        }
    };
    let shift = SUBPIXEL.trailing_zeros();
    let min_x = (x[0].min(x[1]).min(x[2]) >> shift).max(0);
    let max_x = (x[0].max(x[1]).max(x[2]) >> shift).min(i64::from(view.width) - 1);
    let min_y = (y[0].min(y[1]).min(y[2]) >> shift).max(0);
    let max_y = (y[0].max(y[1]).max(y[2]) >> shift).min(i64::from(view.height) - 1);
    if min_x > max_x || min_y > max_y {
        return None;
    }
    Some(Tri {
        drawable,
        v,
        a,
        b,
        c,
        off,
        z,
        inv_area,
        bias,
        front,
        x0: min_x as i32,
        y0: min_y as i32,
        x1: max_x as i32,
        y1: max_y as i32,
    })
}
