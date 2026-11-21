//! File Description: Behavioural tests of the dots-v1 treatment of the Three stage rasterizer (P4.4) through the public `Renderer`, on short synthetic scenes (one paper triangle, a few dot samples, one edge segment, written as an IR document and a mesh file): the paper replaces the cel look only while the treatment is dots-v1 (scene default, cast group and scene spans over time), a dot sprite lands as the shader's white blob with the measured SwiftShader alpha, a dot behind the paper is hidden and a dot in front of it is not (depth tested, never written), an edge line is a one pixel white line, and a frame with dots is the same bytes on every run, in any frame order and on any number of threads.
//! Inputs and outputs: synthetic stage3d IR documents and mesh files in scratch packages -> asserted pixels and byte equality.
//! Used by: `cargo test --manifest-path native/Cargo.toml`; the captain asked for the P4.4 dots step and its tests.

mod common;

use std::sync::Arc;

use aideos_render::{Format, RenderedFrame, Renderer};
use serde_json::{json, Value};

use common::pixel;

/// The film background, #0B0D10.
const BACKGROUND: [u8; 4] = [0x0B, 0x0D, 0x10, 0xFF];
/// The dots paper (0x0a0a0b) in linear light, as three's Color holds it.
const PAPER_LINEAR: [f64; 3] = [
    0.003_035_269_835_488_375,
    0.003_035_269_835_488_375,
    0.003_346_535_763_899_16,
];
/// The same paper as the 8 bit sRGB the frame stores.
const PAPER: [u8; 4] = [10, 10, 11, 255];
/// The lit white of the cel toon material at this normal and light (band 2).
const CEL: [u8; 4] = [248, 248, 248, 255];

/// One synthetic part: triangles, a dot sample field (positions, normals, ranks) or line segment end points.
enum Part {
    Triangle {
        id: &'static str,
        corners: [[f32; 3]; 3],
    },
    Points {
        id: &'static str,
        samples: Vec<([f32; 3], f32)>,
    },
    Lines {
        id: &'static str,
        ends: Vec<[f32; 3]>,
    },
}

impl Part {
    /// The part's id.
    fn id(&self) -> &str {
        match self {
            Part::Triangle { id, .. } | Part::Points { id, .. } | Part::Lines { id, .. } => id,
        }
    }

    /// The part's IR declaration.
    fn declare(&self) -> Value {
        match self {
            Part::Triangle { id, .. } => {
                json!({"id": id, "vertices": 3, "indices": 3, "uv": false})
            }
            Part::Points { id, samples } => {
                json!({"id": id, "kind": "points", "vertices": samples.len(), "indices": 0, "uv": false})
            }
            Part::Lines { id, ends } => {
                json!({"id": id, "kind": "lines", "vertices": ends.len(), "indices": 0, "uv": false})
            }
        }
    }
}

/// Encodes parts as the AIDMESH format 1 file (flag bit 4: points, bit 5: lines).
fn mesh_bytes(parts: &[Part]) -> Vec<u8> {
    let mut out = b"AIDMESH\x01".to_vec();
    out.extend((parts.len() as u32).to_le_bytes());
    for p in parts {
        let (v, i, flags) = match p {
            Part::Triangle { .. } => (3, 3, 0u32),
            Part::Points { samples, .. } => (samples.len(), 0, 16),
            Part::Lines { ends, .. } => (ends.len(), 0, 32),
        };
        out.extend((v as u32).to_le_bytes());
        out.extend((i as u32).to_le_bytes());
        out.extend(flags.to_le_bytes());
    }
    let floats =
        |out: &mut Vec<u8>, values: &[f32]| values.iter().for_each(|f| out.extend(f.to_le_bytes()));
    for p in parts {
        match p {
            Part::Triangle { corners, .. } => {
                corners.iter().for_each(|c| floats(&mut out, c));
                (0..3).for_each(|_| floats(&mut out, &[0.0, 0.0, 1.0]));
                [0u32, 1, 2]
                    .iter()
                    .for_each(|i| out.extend(i.to_le_bytes()));
            }
            Part::Points { samples, .. } => {
                samples.iter().for_each(|(p, _)| floats(&mut out, p));
                samples
                    .iter()
                    .for_each(|_| floats(&mut out, &[0.0, 0.0, 1.0]));
                samples.iter().for_each(|(_, r)| floats(&mut out, &[*r]));
            }
            Part::Lines { ends, .. } => ends.iter().for_each(|e| floats(&mut out, e)),
        }
    }
    out
}

/// A scene with one paper triangle (cel toon, dots paper) and optional dots and edges on it.
struct Scene {
    parts: Vec<Part>,
    /// The scene's default treatment, the group's own and the scene spans.
    default: &'static str,
    group: &'static str,
    spans: Vec<(u32, u32, &'static str)>,
    samples: Option<&'static str>,
    edges: Option<&'static str>,
    /// Whether the drawable carries a dots look at all.
    dotted: bool,
    /// The sidedness of the cel toon material and of the dots paper, which three keeps apart.
    cel_side: &'static str,
    dots_side: &'static str,
}

/// The big triangle around the origin: 600 units is 100 px.
const BIG: [[f32; 3]; 3] = [
    [-600.0, -600.0, 0.0],
    [600.0, -600.0, 0.0],
    [0.0, 600.0, 0.0],
];

impl Scene {
    /// A paper triangle drawn in the given group treatment.
    fn new(group: &'static str) -> Scene {
        Scene {
            parts: vec![Part::Triangle {
                id: "paper",
                corners: BIG,
            }],
            default: "cel-v1",
            group,
            spans: Vec::new(),
            samples: None,
            edges: None,
            dotted: true,
            cel_side: "double",
            dots_side: "double",
        }
    }

    /// The IR document.
    fn ir(&self) -> Value {
        let mut dots = json!({"material": {"kind": "basic", "color": PAPER_LINEAR, "side": self.dots_side}, "order": 5});
        if let Some(part) = self.samples {
            dots["samples"] = json!({"part": part, "tone": 0.5});
        }
        if let Some(part) = self.edges {
            dots["edges"] = json!({"part": part, "color": [1, 1, 1], "order": 6});
        }
        let mut drawable = json!({"id": "paper", "node": "paper", "part": "paper", "order": 1,
            "material": {"kind": "toon", "color": [1, 1, 1], "side": self.cel_side}});
        if self.dotted {
            drawable["group"] = json!("g");
            drawable["dots"] = dots;
        }
        let mut stage3d = json!({
            "kind": "stage3d", "id": "stage", "mesh": "stage-mesh", "treatment": self.default,
            "projection": {"cameraZ": 2000, "near": 0.1, "far": 10000},
            "lighting": {"directional": {"position": [3, 6, 5], "target": [0, 0, 0], "color": [1, 1, 1], "intensity": 2},
                         "ambient": {"color": [1, 1, 1], "intensity": 0.9424777960769379}},
            "ramp": [90, 175, 255],
            "output": {"dpr": 1, "antialias": true, "colorSpace": "srgb", "toneMapping": "none", "exposure": 1},
            "sampleFrames": 6,
            "nodes": [{"id": "paper", "position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "scale": 1}],
            "channels": [], "drawables": [drawable], "faceTextures": [], "facePrograms": [],
        });
        if self.dotted {
            stage3d["groups"] = json!([{"id": "g", "treatment": self.group}]);
        }
        if !self.spans.is_empty() {
            stage3d["spans"] = json!(self
                .spans
                .iter()
                .map(|(a, b, t)| json!({"startFrame": a, "endFrame": b, "treatment": t}))
                .collect::<Vec<_>>());
        }
        json!({
            "schema": "aideos.render/2",
            "film": {"id": "stage3d-dots-test", "fps": 30, "durationFrames": 6},
            "scene": {"width": 1920, "height": 1920},
            "formats": {"long": {"width": 320, "height": 180}},
            "background": "#0B0D10",
            "assets": [{"kind": "mesh", "id": "stage-mesh", "path": "meshes/stage.mesh", "parts": self.parts.iter().map(Part::declare).collect::<Vec<_>>()}],
            "camera": {"centerX": [{"frame": 0, "value": 960}], "centerY": [{"frame": 0, "value": 960}],
                       "zoom": [{"frame": 0, "value": 1}], "rotation": [{"frame": 0, "value": 0}]},
            "stage": [stage3d],
            "overlay": [],
            "audio": [],
        })
    }

    /// Writes the package into a scratch directory and returns the IR path and package directory.
    fn write(&self, name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = common::scratch_dir(name);
        std::fs::create_dir_all(dir.join("meshes")).expect("create meshes");
        std::fs::write(dir.join("meshes/stage.mesh"), mesh_bytes(&self.parts))
            .expect("write the mesh");
        let ir = dir.join("render.json");
        std::fs::write(&ir, serde_json::to_vec(&self.ir()).expect("serialize"))
            .expect("write the IR");
        (ir, dir)
    }

    /// Opens a renderer over the scene.
    fn renderer(&self, name: &str) -> Renderer {
        let (ir, dir) = self.write(name);
        Renderer::open(ir, Some(&dir)).expect("the synthetic stage loads")
    }
}

/// The frame pixel of a world point: the scene is covered at 1/6, so world (x, y) lands at (160 + x / 6, 90 - y / 6).
fn at(frame: &RenderedFrame, wx: f32, wy: f32) -> [u8; 4] {
    pixel(
        frame,
        (160.0 + wx / 6.0).floor() as u32,
        (90.0 - wy / 6.0).floor() as u32,
    )
}

/// The world position of the corner between frame pixels (x - 1, x) and rows (y - 1, y): both odd, so the four pixels around it are one 2 x 2 quad.
fn corner(x: u32, y: u32) -> [f32; 3] {
    [(x as f32 - 160.0) * 6.0, (90.0 - y as f32) * 6.0, 0.0]
}

/// The paper replaces the cel look only while the treatment is dots-v1.
#[test]
fn the_paper_replaces_the_cel_look_only_while_the_treatment_is_dots() {
    let render = |scene: &Scene, name: &str, frame: u32| {
        scene
            .renderer(name)
            .render_frame(Format::Long, frame)
            .expect("renders")
    };
    // Cel: the toon band colour (the same lit white as the cel stage tests, 248); dots: the flat paper.
    assert_eq!(
        at(&render(&Scene::new("cel-v1"), "paper-cel", 0), 0.0, -300.0),
        CEL
    );
    assert_eq!(
        at(
            &render(&Scene::new("dots-v1"), "paper-dots", 0),
            0.0,
            -300.0
        ),
        PAPER
    );
    // A scene default of dots-v1 reaches a group of its own too only through the group's resolved treatment: the group says what it is.
    let mut default_dots = Scene::new("cel-v1");
    default_dots.default = "dots-v1";
    assert_eq!(
        at(&render(&default_dots, "paper-default", 0), 0.0, -300.0),
        CEL
    );
    // A drawable with no dots look is always cel, whatever the spans say.
    let mut plain = Scene::new("dots-v1");
    plain.dotted = false;
    plain.spans = vec![(0, 6, "dots-v1")];
    assert_eq!(at(&render(&plain, "paper-plain", 0), 0.0, -300.0), CEL);
}

/// Each look culls by its own material's side: the dots paper is not drawn or hidden by the cel look's side.
#[test]
fn the_dots_paper_culls_by_its_own_side_not_the_cel_looks() {
    let centre = |cel_side: &'static str, dots_side: &'static str, treatment: &'static str, name: &str| {
        let mut scene = Scene::new(treatment);
        scene.cel_side = cel_side;
        scene.dots_side = dots_side;
        let frame = scene.renderer(name).render_frame(Format::Long, 0).expect("renders");
        at(&frame, 0.0, -300.0)
    };
    // The triangle faces the camera. A back-side dots paper hides it even though the cel look is double sided.
    assert_eq!(centre("double", "back", "dots-v1", "side-dots-back"), BACKGROUND);
    // A front-side dots paper draws it even though the cel look is back sided.
    assert_eq!(centre("back", "front", "dots-v1", "side-dots-front"), PAPER);
    // The cel look still follows its own side while the treatment is cel.
    assert_eq!(centre("back", "front", "cel-v1", "side-cel-back"), BACKGROUND);
}

/// Scene spans switch the look over time, and win over the group's own treatment; frames past the last sample hold its treatment.
#[test]
fn spans_switch_the_treatment_over_time() {
    let mut scene = Scene::new("cel-v1");
    scene.spans = vec![(2, 4, "dots-v1")];
    let r = scene.renderer("spans");
    let look = |f: u32| {
        at(
            &r.render_frame(Format::Long, f).expect("renders"),
            0.0,
            -300.0,
        )
    };
    assert_eq!(look(0), CEL);
    assert_eq!(look(1), CEL);
    assert_eq!(look(2), PAPER);
    assert_eq!(look(3), PAPER);
    assert_eq!(look(4), CEL, "a span ends before its end frame");
    // Reverse seeks keep no state: the same frame again gives the same look.
    assert_eq!(look(3), PAPER);
    assert_eq!(look(1), CEL);
    // The group's own dots treatment is overridden by a cel span.
    let mut over = Scene::new("dots-v1");
    over.spans = vec![(1, 3, "cel-v1")];
    let r = over.renderer("spans-over");
    let look = |f: u32| {
        at(
            &r.render_frame(Format::Long, f).expect("renders"),
            0.0,
            -300.0,
        )
    };
    assert_eq!(
        (look(0), look(1), look(2), look(3)),
        (PAPER, CEL, CEL, PAPER)
    );
}

/// A dot is a white blob over the paper: a sprite centred on a pixel corner is a 2 x 2 block of full white (its quad derivative is zero, so the edge is the 0.04 floor), and the pixels around it stay paper.
#[test]
fn a_dot_lands_as_a_white_blob_over_the_paper() {
    let mut scene = Scene::new("dots-v1");
    let c = corner(161, 81);
    scene.parts.push(Part::Points {
        id: "dots",
        samples: vec![([c[0], c[1], 10.0], 0.0)],
    });
    scene.samples = Some("dots");
    let frame = scene
        .renderer("dot")
        .render_frame(Format::Long, 0)
        .expect("renders");
    for (x, y) in [(160, 80), (161, 80), (160, 81), (161, 81)] {
        assert_eq!(
            pixel(&frame, x, y),
            [255, 255, 255, 255],
            "pixel {x},{y} of the 2 x 2 block"
        );
    }
    for (x, y) in [(159, 80), (162, 80), (160, 79), (161, 82), (158, 78)] {
        assert_eq!(pixel(&frame, x, y), PAPER, "pixel {x},{y} outside the dot");
    }
    // The cel treatment draws no dots.
    let mut cel = Scene::new("cel-v1");
    cel.parts.push(Part::Points {
        id: "dots",
        samples: vec![([c[0], c[1], 10.0], 0.0)],
    });
    cel.samples = Some("dots");
    let frame = cel
        .renderer("dot-cel")
        .render_frame(Format::Long, 0)
        .expect("renders");
    assert_eq!(pixel(&frame, 160, 80), CEL);
}

/// A dot off the corner is partly covered and fades with the shader's alpha, and a dot whose rank is above the density is not drawn at all.
#[test]
fn a_dot_between_pixels_fades_and_a_high_rank_dot_is_not_drawn() {
    let mut scene = Scene::new("dots-v1");
    let c = corner(161, 81);
    // Half a pixel to the right: the 2 x 2 block's alpha is no longer symmetric, so some pixels are grey rather than white.
    scene.parts.push(Part::Points {
        id: "dots",
        samples: vec![([c[0] + 3.0, c[1], 10.0], 0.0)],
    });
    scene.samples = Some("dots");
    let frame = scene
        .renderer("dot-shifted")
        .render_frame(Format::Long, 0)
        .expect("renders");
    let values: Vec<u8> = [
        (160, 80),
        (161, 80),
        (162, 80),
        (160, 81),
        (161, 81),
        (162, 81),
    ]
    .iter()
    .map(|&(x, y)| pixel(&frame, x, y)[0])
    .collect();
    assert!(
        values.iter().any(|v| *v > 40 && *v < 255),
        "no fading pixel: {values:?}"
    );
    assert!(values.iter().all(|v| *v >= 10), "{values:?}");
    // Density here is 0.118; a rank of 0.5 gives coverage 0 (the shader discards it).
    let mut hidden = Scene::new("dots-v1");
    hidden.parts.push(Part::Points {
        id: "dots",
        samples: vec![([c[0], c[1], 10.0], 0.5)],
    });
    hidden.samples = Some("dots");
    let frame = hidden
        .renderer("dot-rank")
        .render_frame(Format::Long, 0)
        .expect("renders");
    assert_eq!(pixel(&frame, 160, 80), PAPER);
    assert_eq!(pixel(&frame, 161, 81), PAPER);
}

/// A dot behind the paper is hidden by it; a dot in front is seen; and the dot's own depth is never written, so a second dot behind the first still blends.
#[test]
fn dots_are_depth_tested_and_never_write_depth() {
    let c = corner(161, 81);
    let render = |z: f32, name: &str| {
        let mut scene = Scene::new("dots-v1");
        scene.parts.push(Part::Points {
            id: "dots",
            samples: vec![([c[0], c[1], z], 0.0)],
        });
        scene.samples = Some("dots");
        scene
            .renderer(name)
            .render_frame(Format::Long, 0)
            .expect("renders")
    };
    assert_eq!(
        pixel(&render(-50.0, "dot-behind"), 160, 80),
        PAPER,
        "a dot behind the paper is hidden"
    );
    assert_eq!(
        pixel(&render(50.0, "dot-front"), 160, 80),
        [255, 255, 255, 255]
    );
    // Two dots at one place, the second farther back (but still in front of the paper): the first writes no depth, so both blend and the result is still white.
    let mut two = Scene::new("dots-v1");
    two.parts.push(Part::Points {
        id: "dots",
        samples: vec![([c[0], c[1], 50.0], 0.0), ([c[0], c[1], 5.0], 0.0)],
    });
    two.samples = Some("dots");
    assert_eq!(
        pixel(
            &two.renderer("dot-two")
                .render_frame(Format::Long, 0)
                .expect("renders"),
            160,
            80
        ),
        [255, 255, 255, 255]
    );
}

/// An edge line is a one pixel white line: the row it runs along is white, the rows beside it are paper.
#[test]
fn an_edge_line_is_a_one_pixel_white_line() {
    let mut scene = Scene::new("dots-v1");
    let y = (90.0 - 81.5) * 6.0;
    scene.parts.push(Part::Lines {
        id: "edge",
        ends: vec![[-300.0, y, 10.0], [300.0, y, 10.0]],
    });
    scene.edges = Some("edge");
    let frame = scene
        .renderer("edge")
        .render_frame(Format::Long, 0)
        .expect("renders");
    assert_eq!(pixel(&frame, 160, 81), [255, 255, 255, 255]);
    assert_eq!(pixel(&frame, 160, 80), PAPER);
    assert_eq!(pixel(&frame, 160, 82), PAPER);
    assert_eq!(pixel(&frame, 160, 85), PAPER);
    // Beyond the segment's end points the paper shows again, and the cel look has no edge lines.
    assert_eq!(pixel(&frame, 160 + 60, 81), BACKGROUND);
    let mut cel = Scene::new("cel-v1");
    cel.parts.push(Part::Lines {
        id: "edge",
        ends: vec![[-300.0, y, 10.0], [300.0, y, 10.0]],
    });
    cel.edges = Some("edge");
    let frame = cel
        .renderer("edge-cel")
        .render_frame(Format::Long, 0)
        .expect("renders");
    assert_eq!(pixel(&frame, 160, 81), CEL);
}

/// A frame with dots, edges and spans is the same bytes on a repeat render, after other frames and on four threads sharing one stage.
#[test]
fn a_dots_frame_is_deterministic_in_any_order_and_on_any_number_of_threads() {
    let mut scene = Scene::new("dots-v1");
    let c = corner(161, 81);
    let samples: Vec<([f32; 3], f32)> = (0..400u32)
        .map(|i| {
            (
                [
                    -500.0 + (i % 20) as f32 * 47.3,
                    -500.0 + (i / 20) as f32 * 43.1,
                    5.0 + (i % 7) as f32,
                ],
                (i % 10) as f32 / 40.0,
            )
        })
        .collect();
    scene.parts.push(Part::Points {
        id: "dots",
        samples,
    });
    scene.parts.push(Part::Lines {
        id: "edge",
        ends: vec![[c[0], c[1], 10.0], [c[0] + 301.0, c[1] + 207.0, 12.0]],
    });
    scene.samples = Some("dots");
    scene.edges = Some("edge");
    scene.spans = vec![(4, 6, "cel-v1")];
    let (ir, dir) = scene.write("dots-determinism");
    let first = Renderer::open(&ir, Some(&dir)).expect("opens");
    let reference: Vec<Vec<u8>> = (0..6u32)
        .map(|f| first.render_frame(Format::Long, f).unwrap().rgba)
        .collect();
    assert!(reference[0] != reference[4], "the span changed nothing");
    assert!(
        first.render_frame(Format::Long, 0).unwrap().rgba == reference[0],
        "a repeat render differs"
    );
    assert!(first.render_frame(Format::Long, 5).unwrap().rgba == reference[5]);
    assert!(
        first.render_frame(Format::Long, 1).unwrap().rgba == reference[1],
        "a frame after another differs"
    );
    let shared = first.stage3d_scene();
    assert!(shared.is_some());
    let reference = Arc::new(reference);
    let handles: Vec<_> = (0..4u32)
        .map(|t| {
            let (ir, dir, shared, reference) =
                (ir.clone(), dir.clone(), shared.clone(), reference.clone());
            std::thread::spawn(move || {
                let r = Renderer::open_sharing(&ir, Some(&dir), shared).expect("opens");
                for k in 0..6u32 {
                    let f = (k * 5 + t) % 6;
                    assert!(
                        r.render_frame(Format::Long, f).unwrap().rgba == reference[f as usize],
                        "thread {t} frame {f} differs"
                    );
                }
            })
        })
        .collect();
    for h in handles {
        h.join().expect("a render thread panicked");
    }
}
