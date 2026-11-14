//! File Description: The graph pose of a `stage3d` node: which sample a film frame reads, each node's local transform at that sample, and every node's world matrix and the world position of a vertex, with three.js r180's exact f64 arithmetic (`Matrix4.compose`, `Matrix4.multiplyMatrices`, `Vector3.applyMatrix4` including its w divide) written out operation for operation as backend/renderIr/stage3d.ts does, so the Rust rasterizer poses the same vertices the TypeScript reference (and three) does. World vertices round to f32 at the end.
//! Inputs and outputs: a prepared graph (static transforms, parents, channels) and a frame -> world matrices (column-major, three's element order); a matrix and f32 local positions -> f32 world positions.
//! Used by: crate::raster::stage3d (the rasterizer's per-frame vertex stage).

/// A column-major 4x4 matrix in three.js `Matrix4.elements` order.
pub type Matrix = [f64; 16];

/// One graph node's local transform at a sample.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Local {
    pub position: [f64; 3],
    /// x, y, z, w.
    pub quaternion: [f64; 4],
    pub scale: f64,
}

/// The sample a film frame reads: the frame itself, held at the last sample after the channels end.
pub fn sample_index(sample_frames: u32, frame: u32) -> usize {
    frame.min(sample_frames.saturating_sub(1)) as usize
}

/// Builds a local matrix from a position, a quaternion and a uniform scale, as three's `Matrix4.compose`.
pub fn compose(t: &Local) -> Matrix {
    let [x, y, z, w] = t.quaternion;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    let s = t.scale;
    [
        (1.0 - (yy + zz)) * s,
        (xy + wz) * s,
        (xz - wy) * s,
        0.0,
        (xy - wz) * s,
        (1.0 - (xx + zz)) * s,
        (yz + wx) * s,
        0.0,
        (xz + wy) * s,
        (yz - wx) * s,
        (1.0 - (xx + yy)) * s,
        0.0,
        t.position[0],
        t.position[1],
        t.position[2],
        1.0,
    ]
}

/// Multiplies `a * b`, as three's `Matrix4.multiplyMatrices` (the parent's world matrix times the child's local one).
pub fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    let (a11, a12, a13, a14) = (a[0], a[4], a[8], a[12]);
    let (a21, a22, a23, a24) = (a[1], a[5], a[9], a[13]);
    let (a31, a32, a33, a34) = (a[2], a[6], a[10], a[14]);
    let (a41, a42, a43, a44) = (a[3], a[7], a[11], a[15]);
    let (b11, b12, b13, b14) = (b[0], b[4], b[8], b[12]);
    let (b21, b22, b23, b24) = (b[1], b[5], b[9], b[13]);
    let (b31, b32, b33, b34) = (b[2], b[6], b[10], b[14]);
    let (b41, b42, b43, b44) = (b[3], b[7], b[11], b[15]);
    [
        a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41,
        a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41,
        a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41,
        a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41,
        a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42,
        a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42,
        a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42,
        a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42,
        a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43,
        a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43,
        a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43,
        a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43,
        a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44,
        a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44,
        a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44,
        a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44,
    ]
}

/// Applies a world matrix to one f32 local position with three's `Vector3.applyMatrix4` (including its w divide) and rounds each result to f32.
pub fn world_vertex(e: &Matrix, p: [f32; 3]) -> [f32; 3] {
    let (x, y, z) = (f64::from(p[0]), f64::from(p[1]), f64::from(p[2]));
    let w = 1.0 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    [
        ((e[0] * x + e[4] * y + e[8] * z + e[12]) * w) as f32,
        ((e[1] * x + e[5] * y + e[9] * z + e[13]) * w) as f32,
        ((e[2] * x + e[6] * y + e[10] * z + e[14]) * w) as f32,
    ]
}

/// The determinant of a matrix's upper 3x3 block: negative when the transform mirrors, which flips which winding is a front face.
pub fn determinant3(m: &Matrix) -> f64 {
    m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2])
        + m[8] * (m[1] * m[6] - m[5] * m[2])
}

/// The normal matrix (inverse transpose of the upper 3x3 block) as rows, or None for a singular transform.
pub fn normal_matrix(m: &Matrix) -> Option<[[f64; 3]; 3]> {
    let det = determinant3(m);
    if !det.is_finite() || det == 0.0 {
        return None;
    }
    let a = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
    let id = 1.0 / det;
    Some([
        [
            (a[1][1] * a[2][2] - a[1][2] * a[2][1]) * id,
            (a[1][2] * a[2][0] - a[1][0] * a[2][2]) * id,
            (a[1][0] * a[2][1] - a[1][1] * a[2][0]) * id,
        ],
        [
            (a[0][2] * a[2][1] - a[0][1] * a[2][2]) * id,
            (a[0][0] * a[2][2] - a[0][2] * a[2][0]) * id,
            (a[0][1] * a[2][0] - a[0][0] * a[2][1]) * id,
        ],
        [
            (a[0][1] * a[1][2] - a[0][2] * a[1][1]) * id,
            (a[0][2] * a[1][0] - a[0][0] * a[1][2]) * id,
            (a[0][0] * a[1][1] - a[0][1] * a[1][0]) * id,
        ],
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A translation composes to a matrix that moves a point and keeps its determinant at one.
    #[test]
    fn translation_moves_a_point() {
        let m = compose(&Local {
            position: [1.0, 2.0, 3.0],
            quaternion: [0.0, 0.0, 0.0, 1.0],
            scale: 1.0,
        });
        assert_eq!(world_vertex(&m, [1.0, 1.0, 1.0]), [2.0, 3.0, 4.0]);
        assert_eq!(determinant3(&m), 1.0);
    }

    /// A child's world matrix is its parent's world matrix times its local one.
    #[test]
    fn child_follows_parent() {
        let parent = compose(&Local {
            position: [10.0, 0.0, 0.0],
            quaternion: [0.0, 0.0, 0.0, 1.0],
            scale: 2.0,
        });
        let child = compose(&Local {
            position: [1.0, 0.0, 0.0],
            quaternion: [0.0, 0.0, 0.0, 1.0],
            scale: 1.0,
        });
        let world = multiply(&parent, &child);
        assert_eq!(world_vertex(&world, [0.0, 0.0, 0.0]), [12.0, 0.0, 0.0]);
    }

    /// A quarter turn about z sends +x to +y, and a mirror has a negative determinant.
    #[test]
    fn rotation_and_mirror() {
        let h = std::f64::consts::FRAC_1_SQRT_2;
        let rot = compose(&Local {
            position: [0.0; 3],
            quaternion: [0.0, 0.0, h, h],
            scale: 1.0,
        });
        let p = world_vertex(&rot, [1.0, 0.0, 0.0]);
        assert!((p[0]).abs() < 1e-6 && (p[1] - 1.0).abs() < 1e-6);
        let mirror = compose(&Local {
            position: [0.0; 3],
            quaternion: [0.0, 0.0, 0.0, 1.0],
            scale: -1.0,
        });
        assert!(determinant3(&mirror) < 0.0);
    }

    /// A frame past the last sample holds the last sample.
    #[test]
    fn frames_hold_the_last_sample() {
        assert_eq!(sample_index(10, 3), 3);
        assert_eq!(sample_index(10, 99), 9);
    }
}
