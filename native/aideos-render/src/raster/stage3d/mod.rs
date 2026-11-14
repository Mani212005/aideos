//! File Description: The native rasterizer of the Render IR's `stage3d` node (the Three stage, cel-v1): a deterministic CPU z-buffer renderer for the orthographic, lit cel scene three.js draws in Remotion. It loads the node's graph, channels, drawables, materials and lights plus the binary mesh once, poses the graph for a frame with three's f64 arithmetic (`pose`), projects every drawable through the camera, sets triangles up in 1/16-pixel fixed point (`setup`) and draws them tile by tile with a z-buffer and the SwiftShader sample rules (`tiles`): 4x MSAA with the GL sample pattern, top-left fill, shading once per pixel at its centre, LEQUAL depth, polygon offset, sRGB encode per shaded pixel and an 8-bit box resolve. Face textures are painted by Skia from the recorded Canvas 2D programs (`face`) on first use and cached per program. Draw order is the IR's drawable order, work is split into tiles that never read each other, and nothing depends on a clock, a thread or the machine, so the same frame is byte-identical on every run and at every thread count.
//! Inputs and outputs: a `Stage3dNode`, its decoded mesh parts, a frame number, the camera pose and the frame size -> a premultiplied RGBA8 `Layer` covering the pixels the stage touches (or None when it draws nothing).
//! Used by: crate::raster (composes the layer between the SVG planes in document order) and crate::renderer (loads the scene).

mod face;
pub mod pose;
mod setup;
mod tiles;

use std::sync::{Arc, OnceLock};

use aideos_render_ir::mesh::MeshPartData;
use aideos_render_ir::types::{FaceProgram, Side, Stage3dNode, StageMaterial, Treatment};

use self::face::{paint_face, Texture};
use self::pose::{compose, multiply, sample_index, Local, Matrix};
use crate::eval::CameraPose;

/// One premultiplied RGBA8 layer holding what the stage drew, placed at (`x`, `y`) of the frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layer {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// `width * height * 4` bytes, rows top to bottom, colour premultiplied by alpha.
    pub rgba: Vec<u8>,
}

/// Sub-pixel positions of the four MSAA samples in 1/16 pixel, the GL standard pattern flipped to the y-down frame (SwiftShader's).
pub(crate) const SAMPLES_4X: [(i64, i64); 4] = [(6, 14), (14, 10), (2, 6), (10, 2)];
/// The single sample of an unantialiased stage: the pixel centre.
pub(crate) const SAMPLES_1X: [(i64, i64); 1] = [(8, 8)];
/// Fixed-point steps per pixel: positions snap to 4 sub-pixel bits, as the GL rasterizer does.
pub(crate) const SUBPIXEL: i64 = 16;

/// A graph node with its static transform and the channels that replace parts of it.
struct GraphNode {
    parent: Option<usize>,
    position: [f64; 3],
    quaternion: [f64; 4],
    scale: f64,
    position_samples: Option<Vec<f64>>,
    quaternion_samples: Option<Vec<f64>>,
    scale_samples: Option<Vec<f64>>,
}

/// One mesh part's geometry as the file stores it.
pub(crate) struct Part {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Option<Vec<f32>>,
    pub indices: Vec<u32>,
}

/// How a drawable's pixels get their colour.
pub(crate) enum Shading {
    /// Lit by the toon ramp: the final 8-bit colour of each ramp band (packed RGBA8, opaque), precomputed.
    Toon { bands: Vec<u32> },
    /// One flat colour (basic material or ink), packed RGBA8 opaque.
    Flat { rgba: u32 },
    /// The face texture times a linear colour, unlit.
    Face { texture: usize, color: [f32; 3] },
}

/// One mesh part drawn with one material at one node.
pub(crate) struct Drawable {
    pub node: usize,
    pub part: usize,
    pub shading: Shading,
    pub side: Side,
    /// Polygon offset factor and units.
    pub offset: Option<(f64, f64)>,
    /// The ink outline's push along the vertex normals, in object units.
    pub ink_width: Option<f32>,
}

/// A face texture: its size, sampling and the program painted at each sample frame, with a cache of painted programs.
pub(crate) struct FaceSlot {
    pub size: usize,
    pub flip_y: bool,
    /// The program index at each sample frame.
    pub programs: Vec<usize>,
    /// One painted result per program index, filled on first use.
    painted: Vec<OnceLock<Result<Arc<Texture>, String>>>,
}

/// The loaded Three stage: everything frame-independent, shareable between threads (the face cache fills itself, deterministically).
pub struct Stage3dScene {
    pub(crate) camera_z: f64,
    pub(crate) near: f64,
    pub(crate) far: f64,
    /// Unit direction toward the directional light.
    pub(crate) light_dir: [f32; 3],
    pub(crate) samples: &'static [(i64, i64)],
    sample_frames: u32,
    graph: Vec<GraphNode>,
    pub(crate) parts: Vec<Part>,
    pub(crate) drawables: Vec<Drawable>,
    textures: Vec<FaceSlot>,
    programs: Vec<FaceProgram>,
}

/// Three's sRGB transfer, encoding one linear channel (`LinearTosRGB`), as the fragment shader's output stage does.
pub(crate) fn linear_to_srgb(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(0.416_66) - 0.055
    }
}

/// One linear channel as the 8-bit value the framebuffer stores.
pub(crate) fn encode_channel(c: f32) -> u32 {
    (linear_to_srgb(c) * 255.0).round() as u32
}

/// Packs an opaque colour from linear floats into RGBA8 (little endian: red in the lowest byte).
pub(crate) fn pack_linear(rgb: [f32; 3]) -> u32 {
    encode_channel(rgb[0])
        | (encode_channel(rgb[1]) << 8)
        | (encode_channel(rgb[2]) << 16)
        | 0xff00_0000
}

/// Converts a colour triple of f64 to f32.
fn rgb32(c: [f64; 3]) -> [f32; 3] {
    [c[0] as f32, c[1] as f32, c[2] as f32]
}

impl Stage3dScene {
    /// Prepares a stage3d node and its decoded mesh parts for drawing, refusing what this rasterizer does not draw.
    pub fn load(node: &Stage3dNode, mesh: Vec<MeshPartData>) -> Result<Stage3dScene, String> {
        let id = &node.id;
        let part_ids: Vec<String> = mesh.iter().map(|p| p.id.clone()).collect();
        if node.treatment != Treatment::CelV1 {
            return Err(format!("stage3d {id}: only the cel-v1 treatment is drawn"));
        }
        if (node.output.dpr - 1.0).abs() > f64::EPSILON {
            return Err(format!(
                "stage3d {id}: a device pixel ratio of {} is not drawn (dpr is 1)",
                node.output.dpr
            ));
        }
        if (node.output.exposure - 1.0).abs() > f64::EPSILON {
            return Err(format!(
                "stage3d {id}: an exposure of {} is not drawn (tone mapping is off)",
                node.output.exposure
            ));
        }
        if node.ramp.is_empty() {
            return Err(format!("stage3d {id}: the toon ramp has no texels"));
        }
        let samples: &'static [(i64, i64)] = if node.output.antialias {
            &SAMPLES_4X
        } else {
            &SAMPLES_1X
        };
        let n = node.sample_frames.0 as usize;
        if n == 0 {
            return Err(format!("stage3d {id}: sampleFrames is zero"));
        }
        // The graph, parents first.
        let index: std::collections::BTreeMap<&str, usize> = node
            .nodes
            .iter()
            .enumerate()
            .map(|(i, g)| (g.id.as_str(), i))
            .collect();
        let mut graph = Vec::with_capacity(node.nodes.len());
        for g in &node.nodes {
            let parent = match &g.parent {
                None => None,
                Some(p) => Some(*index.get(p.as_str()).ok_or_else(|| {
                    format!("stage3d {id}: node {} names the unknown parent {p}", g.id)
                })?),
            };
            let channel = node.channels.iter().find(|c| c.node == g.id);
            let samples_of = |v: &Option<Vec<f64>>,
                              per: usize,
                              what: &str|
             -> Result<Option<Vec<f64>>, String> {
                match v {
                    None => Ok(None),
                    Some(v) if v.len() == per * n => Ok(Some(v.clone())),
                    Some(v) => Err(format!(
                        "stage3d {id}: node {} {what} channel has {} numbers, {} expected",
                        g.id,
                        v.len(),
                        per * n
                    )),
                }
            };
            graph.push(GraphNode {
                parent,
                position: g.position,
                quaternion: g.quaternion,
                scale: g.scale,
                position_samples: samples_of(
                    &channel.and_then(|c| c.position.clone()),
                    3,
                    "position",
                )?,
                quaternion_samples: samples_of(
                    &channel.and_then(|c| c.quaternion.clone()),
                    4,
                    "quaternion",
                )?,
                scale_samples: samples_of(&channel.and_then(|c| c.scale.clone()), 1, "scale")?,
            });
        }
        // Lights: the directional light's direction and the premultiplied light colours.
        let d = &node.lighting.directional;
        let toward = [
            d.position[0] - d.target[0],
            d.position[1] - d.target[1],
            d.position[2] - d.target[2],
        ];
        let len = (toward[0] * toward[0] + toward[1] * toward[1] + toward[2] * toward[2]).sqrt();
        if !(len > 0.0 && len.is_finite()) {
            return Err(format!(
                "stage3d {id}: the directional light has no direction"
            ));
        }
        let light_dir = [
            (toward[0] / len) as f32,
            (toward[1] / len) as f32,
            (toward[2] / len) as f32,
        ];
        let dir_rgb = rgb32([
            d.color[0] * d.intensity,
            d.color[1] * d.intensity,
            d.color[2] * d.intensity,
        ]);
        let a = &node.lighting.ambient;
        let amb_rgb = rgb32([
            a.color[0] * a.intensity,
            a.color[1] * a.intensity,
            a.color[2] * a.intensity,
        ]);
        let ramp: Vec<f32> = node.ramp.iter().map(|t| t.0 as f32 / 255.0).collect();
        // Face textures and their programs.
        let mut textures = Vec::with_capacity(node.face_textures.len());
        for t in &node.face_textures {
            if t.programs.len() != n {
                return Err(format!(
                    "stage3d {id}: face texture {} has {} programs, {n} expected",
                    t.id,
                    t.programs.len()
                ));
            }
            let programs: Vec<usize> = t.programs.iter().map(|p| p.0 as usize).collect();
            if let Some(bad) = programs.iter().find(|p| **p >= node.face_programs.len()) {
                return Err(format!(
                    "stage3d {id}: face texture {} names the missing program {bad}",
                    t.id
                ));
            }
            textures.push(FaceSlot {
                size: t.size.0 as usize,
                flip_y: t.flip_y,
                programs,
                painted: (0..node.face_programs.len())
                    .map(|_| OnceLock::new())
                    .collect(),
            });
        }
        // Parts, in the mesh asset's order.
        let parts: Vec<Part> = mesh
            .into_iter()
            .map(|p| Part {
                positions: p.positions,
                normals: p.normals,
                uvs: p.uvs,
                indices: p.indices,
            })
            .collect();
        // Drawables in draw order, with each material's colours precomputed.
        let mut drawables = Vec::with_capacity(node.drawables.len());
        for dr in &node.drawables {
            let node_ix = *index.get(dr.node.as_str()).ok_or_else(|| {
                format!(
                    "stage3d {id}: drawable {} names the unknown node {}",
                    dr.id, dr.node
                )
            })?;
            let part = part_ids.iter().position(|p| *p == dr.part).ok_or_else(|| {
                format!(
                    "stage3d {id}: drawable {} names the unknown mesh part {}",
                    dr.id, dr.part
                )
            })?;
            let (shading, side, offset, ink_width) = match &dr.material {
                StageMaterial::Toon(m) => {
                    let diffuse = rgb32(m.color);
                    let bands = ramp
                        .iter()
                        .map(|r| {
                            let mut lit = [0f32; 3];
                            for c in 0..3 {
                                // BRDF_Lambert: diffuse / PI times the gradient-lit directional light plus the ambient light.
                                lit[c] = diffuse[c]
                                    * ((r * dir_rgb[c] + amb_rgb[c]) / std::f32::consts::PI);
                            }
                            pack_linear(lit)
                        })
                        .collect();
                    (
                        Shading::Toon { bands },
                        m.side,
                        m.polygon_offset.as_ref().map(|o| (o.factor, o.units)),
                        None,
                    )
                }
                StageMaterial::Basic(m) => (
                    Shading::Flat {
                        rgba: pack_linear(rgb32(m.color)),
                    },
                    m.side,
                    m.polygon_offset.as_ref().map(|o| (o.factor, o.units)),
                    None,
                ),
                StageMaterial::Face(m) => {
                    let texture = node
                        .face_textures
                        .iter()
                        .position(|t| t.id == m.texture)
                        .ok_or_else(|| {
                            format!(
                                "stage3d {id}: drawable {} names the unknown face texture {}",
                                dr.id, m.texture
                            )
                        })?;
                    (
                        Shading::Face {
                            texture,
                            color: rgb32(m.color),
                        },
                        m.side,
                        m.polygon_offset.as_ref().map(|o| (o.factor, o.units)),
                        None,
                    )
                }
                StageMaterial::Ink(m) => (
                    Shading::Flat {
                        rgba: pack_linear(rgb32(m.color)),
                    },
                    m.side,
                    m.polygon_offset.as_ref().map(|o| (o.factor, o.units)),
                    Some(m.width as f32),
                ),
            };
            drawables.push(Drawable {
                node: node_ix,
                part,
                shading,
                side,
                offset,
                ink_width,
            });
        }
        Ok(Stage3dScene {
            camera_z: node.projection.camera_z,
            near: node.projection.near,
            far: node.projection.far,
            light_dir,
            samples,
            sample_frames: node.sample_frames.0,
            graph,
            parts,
            drawables,
            textures,
            programs: node.face_programs.clone(),
        })
    }

    /// World matrices of every graph node at a film frame: a root's world is its local matrix, a child's is its parent's world times its local one.
    fn world_matrices(&self, frame: u32) -> Vec<Matrix> {
        let s = sample_index(self.sample_frames, frame);
        let mut world: Vec<Matrix> = Vec::with_capacity(self.graph.len());
        for g in &self.graph {
            let pick = |channel: &Option<Vec<f64>>, per: usize, fallback: &[f64]| -> Vec<f64> {
                match channel {
                    Some(v) => v[s * per..(s + 1) * per].to_vec(),
                    None => fallback.to_vec(),
                }
            };
            let p = pick(&g.position_samples, 3, &g.position);
            let q = pick(&g.quaternion_samples, 4, &g.quaternion);
            let scale = match &g.scale_samples {
                Some(v) => v[s],
                None => g.scale,
            };
            let local = compose(&Local {
                position: [p[0], p[1], p[2]],
                quaternion: [q[0], q[1], q[2], q[3]],
                scale,
            });
            world.push(match g.parent {
                None => local,
                Some(parent) => multiply(&world[parent], &local),
            });
        }
        world
    }

    /// The painted face texture of one slot at a frame, painting its program on first use.
    pub(crate) fn face_texture(&self, slot: usize, frame: u32) -> Result<Arc<Texture>, String> {
        let t = &self.textures[slot];
        let program = t.programs[sample_index(self.sample_frames, frame)];
        t.painted[program]
            .get_or_init(|| paint_face(t.size, &self.programs[program].ops).map(Arc::new))
            .clone()
    }

    /// Whether a face texture is sampled with its rows flipped (three's `flipY`).
    pub(crate) fn texture_flip_y(&self, slot: usize) -> bool {
        self.textures[slot].flip_y
    }

    /// Draws the stage at one frame into a premultiplied layer, or None when no triangle lands in the frame.
    pub fn render_layer(
        &self,
        frame: u32,
        camera: &CameraPose,
        scene_size: (f64, f64),
        width: u32,
        height: u32,
    ) -> Result<Option<Layer>, String> {
        let world = self.world_matrices(frame);
        let view = setup::View::new(camera, scene_size, width, height);
        let prepared = setup::prepare(self, &world, &view, frame)?;
        Ok(tiles::draw(self, &prepared, width, height))
    }
}
