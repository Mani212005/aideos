//! File Description: The tile rasterizer of the stage3d node. The frame's triangles are binned, in draw order, into 32 x 32 pixel tiles; each tile is drawn on its own with a depth and a colour buffer of its own (z-buffer, LEQUAL, GL-pattern MSAA samples, coverage from exact integer edge equations with the top-left rule), shading each pixel once at its centre (three's toon, basic, face and ink shaders, sRGB encoded to 8 bits), then resolved by averaging the samples into a premultiplied RGBA layer. A tile reads only its own triangle list and writes only its own pixels, so tiles can run in any order or on any number of threads and the layer is the same bytes.
//! Inputs and outputs: the `Prepared` triangles of a frame and the loaded scene -> a premultiplied RGBA8 `Layer` covering the touched pixels, or None when nothing is drawn.
//! Used by: crate::raster::stage3d (`render_layer`).

use std::sync::OnceLock;

use super::face::Texture;
use super::setup::{Prepared, Tri};
use super::{encode_channel, Layer, Shading, Stage3dScene, SUBPIXEL};
use aideos_render_ir::types::Side;

/// Tile edge in pixels.
const TILE: i32 = 32;

/// The 8-bit sRGB to linear table three's sRGB8 texture decode gives (computed once, in f32 as the shader's formula is).
fn srgb_to_linear_table() -> &'static [f32; 256] {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut t = [0f32; 256];
        for (i, v) in t.iter_mut().enumerate() {
            let c = i as f32 / 255.0;
            *v = if c <= 0.040_45 {
                c * 0.077_399_38
            } else {
                (c * 0.947_867_3 + 0.052_132_7).powf(2.4)
            };
        }
        t
    })
}

/// One texel of a face texture as linear floats, clamped to the edge.
fn texel(tex: &Texture, x: i64, y: i64, table: &[f32; 256]) -> [f32; 3] {
    let last = tex.size as i64 - 1;
    let i = (y.clamp(0, last) as usize * tex.size + x.clamp(0, last) as usize) * 3;
    [
        table[tex.rgb[i] as usize],
        table[tex.rgb[i + 1] as usize],
        table[tex.rgb[i + 2] as usize],
    ]
}

/// Samples a face texture bilinearly in linear light with clamp-to-edge and no mipmaps (three's linear filter on an sRGB8 texture).
fn sample_face(tex: &Texture, u: f32, v: f32, flip_y: bool) -> [f32; 3] {
    let table = srgb_to_linear_table();
    let n = tex.size as f32;
    let row = if flip_y { 1.0 - v } else { v };
    let (x, y) = (u * n - 0.5, row * n - 0.5);
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = (x - x0, y - y0);
    let (ix, iy) = (x0 as i64, y0 as i64);
    let (a, b, c, d) = (
        texel(tex, ix, iy, table),
        texel(tex, ix + 1, iy, table),
        texel(tex, ix, iy + 1, table),
        texel(tex, ix + 1, iy + 1, table),
    );
    let mut out = [0f32; 3];
    for k in 0..3 {
        out[k] =
            (a[k] * (1.0 - fx) + b[k] * fx) * (1.0 - fy) + (c[k] * (1.0 - fx) + d[k] * fx) * fy;
    }
    out
}

/// Shades one pixel of a triangle from its barycentric coordinates at the pixel centre; the result is opaque RGBA8.
fn shade(scene: &Stage3dScene, prep: &Prepared, t: &Tri, lam: [f32; 3]) -> u32 {
    let d = &scene.drawables[t.drawable as usize];
    match &d.shading {
        Shading::Flat { rgba } => *rgba,
        Shading::Toon { bands } => {
            let normals = &prep.normals[t.drawable as usize];
            let mut n = [0f32; 3];
            for k in 0..3 {
                n[k] = lam[0] * normals[t.v[0] as usize * 3 + k]
                    + lam[1] * normals[t.v[1] as usize * 3 + k]
                    + lam[2] * normals[t.v[2] as usize * 3 + k];
            }
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt().max(1e-12);
            let l = scene.light_dir;
            let mut dot = (n[0] * l[0] + n[1] * l[1] + n[2] * l[2]) / len;
            // Back faces of a double-sided material, and every face of a back-side one, light with the flipped normal.
            if d.side == Side::Back || (d.side == Side::Double && !t.front) {
                dot = -dot;
            }
            let count = bands.len() as i32;
            let band = (((dot * 0.5 + 0.5) * count as f32).floor() as i32).clamp(0, count - 1);
            bands[band as usize]
        }
        Shading::Face { texture, color } => {
            let part = &scene.parts[d.part];
            let (u, v) = match &part.uvs {
                Some(uvs) => {
                    let at = |k: usize| {
                        lam[0] * uvs[t.v[0] as usize * 2 + k]
                            + lam[1] * uvs[t.v[1] as usize * 2 + k]
                            + lam[2] * uvs[t.v[2] as usize * 2 + k]
                    };
                    (at(0), at(1))
                }
                None => (0.0, 0.0),
            };
            match &prep.textures[*texture] {
                Some(tex) => {
                    let s = sample_face(tex, u, v, scene.texture_flip_y(*texture));
                    let lit = [s[0] * color[0], s[1] * color[1], s[2] * color[2]];
                    encode_channel(lit[0])
                        | (encode_channel(lit[1]) << 8)
                        | (encode_channel(lit[2]) << 16)
                        | 0xff00_0000
                }
                None => 0xff00_0000,
            }
        }
    }
}

/// Draws one triangle into one tile's sample buffers.
fn raster_triangle(
    scene: &Stage3dScene,
    prep: &Prepared,
    t: &Tri,
    tile: (i32, i32),
    depth: &mut [f32],
    color: &mut [u32],
) {
    let samples = scene.samples;
    let count = samples.len();
    let (x0, x1) = (t.x0.max(tile.0), t.x1.min(tile.0 + TILE - 1));
    let (y0, y1) = (t.y0.max(tile.1), t.y1.min(tile.1 + TILE - 1));
    let step = [t.a[0] * SUBPIXEL, t.a[1] * SUBPIXEL, t.a[2] * SUBPIXEL];
    for py in y0..=y1 {
        // Edge values at every sample of the row's first pixel, stepped along the row.
        let mut e = [[0i64; 3]; 4];
        for (s, &(sx, sy)) in samples.iter().enumerate() {
            let (px, py_fixed) = (i64::from(x0) * SUBPIXEL + sx, i64::from(py) * SUBPIXEL + sy);
            for (i, v) in e[s].iter_mut().enumerate() {
                *v = t.a[i] * px + t.b[i] * py_fixed + t.c[i];
            }
        }
        for px in x0..=x1 {
            let mut mask = 0u32;
            for (s, es) in e.iter().take(count).enumerate() {
                if (es[0] | es[1] | es[2]) >= 0 {
                    mask |= 1 << s;
                }
            }
            if mask != 0 {
                let base = (((py - tile.1) * TILE + (px - tile.0)) as usize) * count;
                // Depth first: when no covered sample passes, the pixel is not shaded at all.
                let mut pass = 0u32;
                let mut zs = [0f32; 4];
                for s in 0..count {
                    if mask >> s & 1 == 0 {
                        continue;
                    }
                    let w0 = (e[s][0] + t.off[0]) as f64;
                    let w1 = (e[s][1] + t.off[1]) as f64;
                    let w2 = (e[s][2] + t.off[2]) as f64;
                    let z = (w0 * t.z[0] + w1 * t.z[1] + w2 * t.z[2]) * t.inv_area;
                    // The clip planes: a sample outside the near and far planes is not drawn.
                    if !(0.0..=1.0).contains(&z) {
                        continue;
                    }
                    let zt = (z + t.bias).clamp(0.0, 1.0) as f32;
                    if zt <= depth[base + s] {
                        pass |= 1 << s;
                        zs[s] = zt;
                    }
                }
                if pass != 0 {
                    // Shade once at the pixel centre, whatever the covered samples are (no centroid sampling).
                    let (cx, cy) = (
                        i64::from(px) * SUBPIXEL + SUBPIXEL / 2,
                        i64::from(py) * SUBPIXEL + SUBPIXEL / 2,
                    );
                    let mut lam = [0f32; 3];
                    for (i, v) in lam.iter_mut().enumerate() {
                        *v = ((t.a[i] * cx + t.b[i] * cy + t.c[i] + t.off[i]) as f64
                            * t.inv_area) as f32;
                    }
                    let rgba = shade(scene, prep, t, lam);
                    for s in 0..count {
                        if pass >> s & 1 == 1 {
                            depth[base + s] = zs[s];
                            color[base + s] = rgba;
                        }
                    }
                }
            }
            for es in e.iter_mut().take(count) {
                for (v, st) in es.iter_mut().zip(step) {
                    *v += st;
                }
            }
        }
    }
}

/// Draws every triangle of a frame tile by tile and resolves the samples into one premultiplied layer.
pub(crate) fn draw(
    scene: &Stage3dScene,
    prep: &Prepared,
    width: u32,
    height: u32,
) -> Option<Layer> {
    if prep.tris.is_empty() {
        return None;
    }
    let (mut bx0, mut by0, mut bx1, mut by1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for t in &prep.tris {
        bx0 = bx0.min(t.x0);
        by0 = by0.min(t.y0);
        bx1 = bx1.max(t.x1);
        by1 = by1.max(t.y1);
    }
    debug_assert!(bx0 >= 0 && by0 >= 0 && bx1 < width as i32 && by1 < height as i32);
    let (tx0, ty0, tx1, ty1) = (bx0 / TILE, by0 / TILE, bx1 / TILE, by1 / TILE);
    let tiles_w = (tx1 - tx0 + 1) as usize;
    let tiles_h = (ty1 - ty0 + 1) as usize;
    // Bin the triangles into tiles, keeping their draw order inside each tile.
    let mut bins: Vec<Vec<u32>> = vec![Vec::new(); tiles_w * tiles_h];
    for (i, t) in prep.tris.iter().enumerate() {
        for ty in t.y0 / TILE..=t.y1 / TILE {
            for tx in t.x0 / TILE..=t.x1 / TILE {
                bins[(ty - ty0) as usize * tiles_w + (tx - tx0) as usize].push(i as u32);
            }
        }
    }
    let (lw, lh) = ((bx1 - bx0 + 1) as usize, (by1 - by0 + 1) as usize);
    let mut rgba = vec![0u8; lw * lh * 4];
    let count = scene.samples.len();
    let mut depth = vec![1f32; (TILE * TILE) as usize * count];
    let mut color = vec![0u32; (TILE * TILE) as usize * count];
    for ty in ty0..=ty1 {
        for tx in tx0..=tx1 {
            let list = &bins[(ty - ty0) as usize * tiles_w + (tx - tx0) as usize];
            if list.is_empty() {
                continue;
            }
            let origin = (tx * TILE, ty * TILE);
            depth.fill(1.0);
            color.fill(0);
            for &i in list {
                raster_triangle(
                    scene,
                    prep,
                    &prep.tris[i as usize],
                    origin,
                    &mut depth,
                    &mut color,
                );
            }
            // Resolve: the box average of the samples' 8-bit values, rounded to nearest.
            for ly in 0..TILE {
                let py = origin.1 + ly;
                if py < by0 || py > by1 {
                    continue;
                }
                for lx in 0..TILE {
                    let px = origin.0 + lx;
                    if px < bx0 || px > bx1 {
                        continue;
                    }
                    let base = ((ly * TILE + lx) as usize) * count;
                    let mut sum = [0u32; 4];
                    for s in 0..count {
                        let c = color[base + s];
                        for (k, slot) in sum.iter_mut().enumerate() {
                            *slot += (c >> (8 * k)) & 0xff;
                        }
                    }
                    let out = ((py - by0) as usize * lw + (px - bx0) as usize) * 4;
                    for k in 0..4 {
                        rgba[out + k] = ((sum[k] + count as u32 / 2) / count as u32) as u8;
                    }
                }
            }
        }
    }
    Some(Layer {
        x: bx0,
        y: by0,
        width: lw as u32,
        height: lh as u32,
        rgba,
    })
}
