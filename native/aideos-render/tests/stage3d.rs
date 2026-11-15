//! File Description: Behavioural tests of the Three stage rasterizer (`aideos.render/2`, the stage3d node) through the public `Renderer`, on short synthetic scenes (a few triangles, written as an IR document and a mesh file by the test): a toon triangle takes the ramp band's colour at the pixel the camera puts it, back faces are culled by the material's side, the nearer triangle wins whatever the draw order, a shared edge leaves no gap (top-left rule on a sample that sits exactly on it), a face texture painted from recorded ops reaches the picture, several performers each keep their own face texture and per-frame face program (P4.3), the stage composes between the SVG planes and under the node's opacity, and the picture, for one performer and for several, is byte-identical on a repeat render, in any frame order and across threads. Hand-computed expectations are noted where they appear.
//! Inputs and outputs: synthetic stage3d IR documents and mesh files in scratch packages -> asserted pixels and byte equality.
//! Used by: `cargo test --manifest-path native/Cargo.toml`.

mod common;

use std::sync::Arc;

use aideos_render::{Format, RenderError, Renderer};
use serde_json::{json, Value};

use common::pixel;

/// The film background, #0B0D10.
const BACKGROUND: [u8; 4] = [0x0B, 0x0D, 0x10, 0xFF];

/// One synthetic part: positions (x, y, z per vertex), normals, optional uvs and indices.
struct Part {
    id: &'static str,
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    uvs: Option<Vec<[f32; 2]>>,
    indices: Vec<u32>,
}

/// Encodes parts as the AIDMESH format 1 file.
fn mesh_bytes(parts: &[Part]) -> Vec<u8> {
    let mut out = b"AIDMESH\x01".to_vec();
    out.extend((parts.len() as u32).to_le_bytes());
    for p in parts {
        out.extend((p.positions.len() as u32).to_le_bytes());
        out.extend((p.indices.len() as u32).to_le_bytes());
        out.extend(u32::from(p.uvs.is_some()).to_le_bytes());
    }
    for p in parts {
        for v in &p.positions {
            v.iter().for_each(|f| out.extend(f.to_le_bytes()));
        }
        for v in &p.normals {
            v.iter().for_each(|f| out.extend(f.to_le_bytes()));
        }
        if let Some(uvs) = &p.uvs {
            for v in uvs {
                v.iter().for_each(|f| out.extend(f.to_le_bytes()));
            }
        }
        p.indices.iter().for_each(|i| out.extend(i.to_le_bytes()));
    }
    out
}

/// A scene description: parts, drawables, face programs and the stage node's extras.
struct Scene {
    parts: Vec<Part>,
    drawables: Vec<Value>,
    face_programs: Vec<Value>,
    face_textures: Vec<Value>,
    /// Extra stage-level IR nodes placed after the stage3d node (a foreground plane).
    after: Vec<Value>,
    before: Vec<Value>,
    opacity: Option<f64>,
    camera: (f64, f64, f64),
    frames: u32,
    assets: Vec<Value>,
}

impl Scene {
    /// An empty scene: no parts, camera at the scene centre with zoom 1.
    fn new() -> Scene {
        Scene {
            parts: Vec::new(),
            drawables: Vec::new(),
            face_programs: Vec::new(),
            face_textures: Vec::new(),
            after: Vec::new(),
            before: Vec::new(),
            opacity: None,
            camera: (960.0, 960.0, 1.0),
            frames: 3,
            assets: Vec::new(),
        }
    }

    /// The IR document: one root node at the origin with scale 1, one drawable node per drawable under it.
    fn ir(&self) -> Value {
        let mut nodes = vec![
            json!({"id": "root", "position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "scale": 1}),
        ];
        for d in &self.drawables {
            nodes.push(json!({"id": d["node"], "parent": "root", "position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "scale": 1}));
        }
        let parts: Vec<Value> = self
            .parts
            .iter()
            .map(|p| json!({"id": p.id, "vertices": p.positions.len(), "indices": p.indices.len(), "uv": p.uvs.is_some()}))
            .collect();
        let mut assets = vec![
            json!({"kind": "mesh", "id": "stage-mesh", "path": "meshes/stage.mesh", "parts": parts}),
        ];
        assets.extend(self.assets.clone());
        let mut stage3d = json!({
            "kind": "stage3d", "id": "stage", "mesh": "stage-mesh", "treatment": "cel-v1",
            "projection": {"cameraZ": 2000, "near": 0.1, "far": 10000},
            "lighting": {"directional": {"position": [3, 6, 5], "target": [0, 0, 0], "color": [1, 1, 1], "intensity": 2},
                         "ambient": {"color": [1, 1, 1], "intensity": 0.9424777960769379}},
            "ramp": [90, 175, 255],
            "output": {"dpr": 1, "antialias": true, "colorSpace": "srgb", "toneMapping": "none", "exposure": 1},
            "sampleFrames": self.frames,
            "nodes": nodes, "channels": [], "drawables": self.drawables,
            "faceTextures": self.face_textures, "facePrograms": self.face_programs,
        });
        if let Some(o) = self.opacity {
            stage3d["opacity"] = json!(o);
        }
        let mut stage = self.before.clone();
        stage.push(stage3d);
        stage.extend(self.after.clone());
        json!({
            "schema": "aideos.render/2",
            "film": {"id": "stage3d-test", "fps": 30, "durationFrames": 6},
            "scene": {"width": 1920, "height": 1920},
            "formats": {"long": {"width": 320, "height": 180}},
            "background": "#0B0D10",
            "assets": assets,
            "camera": {"centerX": [{"frame": 0, "value": self.camera.0}], "centerY": [{"frame": 0, "value": self.camera.1}],
                       "zoom": [{"frame": 0, "value": self.camera.2}], "rotation": [{"frame": 0, "value": 0}]},
            "stage": stage,
            "overlay": [],
            "audio": [],
        })
    }

    /// Writes the package (IR, mesh file) into a scratch directory and returns the IR path and package directory.
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

/// A toon drawable of a part at the root, white diffuse.
fn toon(id: &str, part: &str, side: &str) -> Value {
    json!({"id": id, "node": id, "part": part, "material": {"kind": "toon", "color": [1, 1, 1], "side": side}})
}

/// A triangle facing the camera (counter-clockwise seen from +z) with the given corners in world units at depth z.
fn triangle(id: &'static str, corners: [[f32; 2]; 3], z: f32, normal: [f32; 3]) -> Part {
    Part {
        id,
        positions: corners.iter().map(|c| [c[0], c[1], z]).collect(),
        normals: vec![normal; 3],
        uvs: None,
        indices: vec![0, 1, 2],
    }
}

/// The 320 x 180 frame's pixel for a world point: the scene is covered at 1/6, so world (x, y) lands at (160 + x / 6, 90 - y / 6).
fn at(frame: &aideos_render::RenderedFrame, wx: f32, wy: f32) -> [u8; 4] {
    pixel(
        frame,
        (160.0 + wx / 6.0).floor() as u32,
        (90.0 - wy / 6.0).floor() as u32,
    )
}

/// A big triangle around the origin: 600 units is 100 px.
const BIG: [[f32; 2]; 3] = [[-600.0, -600.0], [600.0, -600.0], [0.0, 600.0]];

/// A toon triangle takes the ramp band's colour at the pixel the camera puts it and leaves the rest of the frame alone.
#[test]
fn a_toon_triangle_lands_where_the_camera_puts_it_with_its_band_colour() {
    // Hand computed: normal +z against the light (3, 6, 5) / 7.8102 gives n.l = 0.640, ramp coordinate 0.82, band 2 (255).
    // Lambert: (1 * 2 + 0.3 pi) / pi = 0.9366 linear, sRGB 0.9717, 247.8 -> 248.
    let mut scene = Scene::new();
    scene.parts.push(triangle("t", BIG, 0.0, [0.0, 0.0, 1.0]));
    scene.drawables.push(toon("t", "t", "front"));
    let frame = scene
        .renderer("band-lit")
        .render_frame(Format::Long, 0)
        .expect("renders");
    assert_eq!(at(&frame, 0.0, -300.0), [248, 248, 248, 255]);
    assert_eq!(pixel(&frame, 5, 5), BACKGROUND);
    assert_eq!(pixel(&frame, 300, 100), BACKGROUND, "right of the triangle");
    // A normal pointing away from the light falls in band 0: (90/255 * 2 + 0.3 pi) / pi = 0.5247 linear, sRGB 0.7514, 191.6 -> 192.
    let mut dark = Scene::new();
    dark.parts.push(triangle("t", BIG, 0.0, [-0.3, -0.6, -0.5]));
    dark.drawables.push(toon("t", "t", "double"));
    let frame = dark
        .renderer("band-dark")
        .render_frame(Format::Long, 0)
        .expect("renders");
    assert_eq!(at(&frame, 0.0, -300.0), [192, 192, 192, 255]);
}

/// A face away from the camera is drawn only when the material's side says so.
#[test]
fn sides_cull_back_faces() {
    // The same triangle with its winding reversed faces away from the camera.
    let corners = [BIG[0], BIG[2], BIG[1]];
    let draw = |side: &str, name: &str| {
        let mut scene = Scene::new();
        scene
            .parts
            .push(triangle("t", corners, 0.0, [0.0, 0.0, 1.0]));
        scene.drawables.push(toon("t", "t", side));
        scene
            .renderer(name)
            .render_frame(Format::Long, 0)
            .expect("renders")
    };
    assert_eq!(at(&draw("front", "cull-front"), 0.0, -300.0), BACKGROUND);
    assert_ne!(at(&draw("back", "cull-back"), 0.0, -300.0), BACKGROUND);
    assert_ne!(at(&draw("double", "cull-double"), 0.0, -300.0), BACKGROUND);
}

/// The nearer of two overlapping triangles wins whichever is drawn first, and the farther one still shows where it is not covered.
#[test]
fn the_nearer_triangle_wins_in_any_draw_order() {
    let make = |near_first: bool, name: &str| {
        let mut scene = Scene::new();
        scene
            .parts
            .push(triangle("near", BIG, 100.0, [0.0, 0.0, 1.0]));
        scene.parts.push(triangle(
            "far",
            [[-600.0, -600.0], [900.0, -600.0], [150.0, 700.0]],
            -100.0,
            [-0.3, -0.6, -0.5],
        ));
        let mut near = toon("near", "near", "double");
        near["material"]["color"] = json!([1.0, 0.0, 0.0]);
        let far = toon("far", "far", "double");
        scene.drawables = if near_first {
            vec![near, far]
        } else {
            vec![far, near]
        };
        scene
            .renderer(name)
            .render_frame(Format::Long, 0)
            .expect("renders")
    };
    let (a, b) = (make(true, "order-a"), make(false, "order-b"));
    assert_eq!(a.rgba, b.rgba, "draw order changed the picture");
    // Inside the nearer triangle the red one shows; to the right of it only the farther, grey one does.
    assert!(at(&a, 0.0, -300.0)[0] > 200 && at(&a, 0.0, -300.0)[1] < 20);
    assert_eq!(
        at(&a, 600.0, -300.0)[0],
        at(&a, 600.0, -300.0)[2],
        "the farther triangle is grey"
    );
    assert_ne!(at(&a, 600.0, -300.0), BACKGROUND);
}

/// Two triangles sharing an edge that passes exactly through a sample point leave no gap: the top-left rule gives that sample to one of them.
#[test]
fn a_shared_edge_through_a_sample_leaves_no_gap() {
    // The shared vertical edge sits at x = 110.375 px: sample 0 of pixel column 110 (6/16 across) is exactly on it.
    let edge_x = (110.375 - 160.0) * 6.0;
    let mut scene = Scene::new();
    scene.parts.push(triangle(
        "left",
        [[-600.0, -300.0], [edge_x, -300.0], [edge_x, 300.0]],
        0.0,
        [0.0, 0.0, 1.0],
    ));
    scene.parts.push(triangle(
        "right",
        [[edge_x, -300.0], [300.0, -300.0], [edge_x, 300.0]],
        0.0,
        [0.0, 0.0, 1.0],
    ));
    scene.drawables.push(toon("left", "left", "front"));
    scene.drawables.push(toon("right", "right", "front"));
    let frame = scene
        .renderer("seam")
        .render_frame(Format::Long, 0)
        .expect("renders");
    for y in 45..135 {
        let p = pixel(&frame, 110, y);
        assert_eq!(p, pixel(&frame, 111, y), "a seam shows at row {y}: {p:?}");
        assert_eq!(p[3], 255);
    }
}

/// A face program painted by Skia reaches the picture through the texture sampler (a solid fill comes back exactly).
#[test]
fn a_face_texture_reaches_the_picture() {
    let mut scene = Scene::new();
    scene.parts.push(Part {
        id: "head",
        positions: vec![
            [-600.0, -600.0, 0.0],
            [600.0, -600.0, 0.0],
            [0.0, 600.0, 0.0],
        ],
        normals: vec![[0.0, 0.0, 1.0]; 3],
        uvs: Some(vec![[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]]),
        indices: vec![0, 1, 2],
    });
    scene.drawables.push(json!({"id": "head", "node": "head", "part": "head", "material": {"kind": "face", "texture": "face", "color": [1, 1, 1], "side": "front"}}));
    scene.face_textures.push(json!({"id": "face", "size": 64, "flipY": true, "filter": "linear", "mipmaps": false, "colorSpace": "srgb", "programs": [0, 0, 1]}));
    let fill = |hex: &str| json!({"ops": [{"op": "fillStyle", "paint": {"kind": "color", "color": hex, "alpha": 1}}, {"op": "fillRect", "args": [0, 0, 64, 64]}]});
    scene.face_programs = vec![fill("#c86432"), fill("#2f80ed")];
    let renderer = scene.renderer("face");
    // The texture is flat (200, 100, 50) at frames 0 and 1 and a different flat colour at frame 2; the sampler and the sRGB round trip must not change it.
    assert_eq!(
        at(
            &renderer.render_frame(Format::Long, 0).unwrap(),
            0.0,
            -300.0
        ),
        [200, 100, 50, 255]
    );
    assert_eq!(
        at(
            &renderer.render_frame(Format::Long, 1).unwrap(),
            0.0,
            -300.0
        ),
        [200, 100, 50, 255]
    );
    assert_eq!(
        at(
            &renderer.render_frame(Format::Long, 2).unwrap(),
            0.0,
            -300.0
        ),
        [0x2f, 0x80, 0xed, 255]
    );
    // Frames past the last sample hold it.
    assert_eq!(
        at(
            &renderer.render_frame(Format::Long, 5).unwrap(),
            0.0,
            -300.0
        ),
        [0x2f, 0x80, 0xed, 255]
    );
}

/// Two performers' heads: head `name` is a triangle of 600 world units centred at x = `cx` on y = 0, drawn with the face texture `face`.
fn performer_head(name: &'static str, cx: f32, face: &str) -> (Part, Value) {
    let part = Part {
        id: name,
        positions: vec![
            [cx - 300.0, -300.0, 0.0],
            [cx + 300.0, -300.0, 0.0],
            [cx, 300.0, 0.0],
        ],
        normals: vec![[0.0, 0.0, 1.0]; 3],
        uvs: Some(vec![[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]]),
        indices: vec![0, 1, 2],
    };
    let drawable = json!({"id": name, "node": name, "part": name, "material": {"kind": "face", "texture": face, "color": [1, 1, 1], "side": "front"}});
    (part, drawable)
}

/// A stage of two performers, each with its own face texture and its own per-frame program track (the several-performer films of P4.3).
fn two_performer_scene() -> Scene {
    let mut scene = Scene::new();
    for (name, cx, face, programs) in [
        ("head-a", -600.0, "face-a", [0, 1, 1]),
        ("head-b", 600.0, "face-b", [1, 1, 0]),
    ] {
        let (part, drawable) = performer_head(name, cx, face);
        scene.parts.push(part);
        scene.drawables.push(drawable);
        scene.face_textures.push(json!({"id": face, "size": 64, "flipY": true, "filter": "linear", "mipmaps": false, "colorSpace": "srgb", "programs": programs}));
    }
    let fill = |hex: &str| json!({"ops": [{"op": "fillStyle", "paint": {"kind": "color", "color": hex, "alpha": 1}}, {"op": "fillRect", "args": [0, 0, 64, 64]}]});
    scene.face_programs = vec![fill("#c86432"), fill("#2f80ed")];
    scene
}

/// Several performers each paint their own face: a face texture is bound to its own head and follows its own program track frame by frame.
#[test]
fn several_performers_keep_their_own_face_and_program_track() {
    let renderer = two_performer_scene().renderer("two-faces");
    let orange = [200, 100, 50, 255];
    let blue = [0x2f, 0x80, 0xed, 255];
    // Frame 0: A shows program 0 and B program 1; frame 1: both program 1; frame 2: A program 1 and B program 0.
    for (frame, want_a, want_b) in [
        (0, orange, blue),
        (1, blue, blue),
        (2, blue, orange),
        (5, blue, orange),
    ] {
        let f = renderer.render_frame(Format::Long, frame).unwrap();
        assert_eq!(
            at(&f, -600.0, -150.0),
            want_a,
            "performer A at frame {frame}"
        );
        assert_eq!(
            at(&f, 600.0, -150.0),
            want_b,
            "performer B at frame {frame}"
        );
        // Between the two heads nothing is drawn.
        assert_eq!(
            at(&f, 0.0, -150.0),
            BACKGROUND,
            "between the performers at frame {frame}"
        );
    }
}

/// Several performers, with faces, are the same bytes on a repeat render, in any frame order and on four threads.
#[test]
fn several_performers_render_deterministically() {
    assert_deterministic(&two_performer_scene(), "two-performers-determinism");
}

/// A plane before the stage is drawn under it and one after the stage over it, as the document order says.
#[test]
fn the_stage_sits_between_the_planes_in_document_order() {
    let svg_node = |id: &str, asset: &str| json!({"kind": "svg", "id": id, "asset": asset, "x": 960, "y": 960, "scale": 1, "rotation": 0, "layer": 0, "tracks": [], "elementTracks": []});
    let mut scene = Scene::new();
    // Green fills the scene behind the stage; a blue square over the triangle's lower middle sits in front of it.
    scene.assets.push(
        json!({"kind": "svg", "id": "ground", "path": "visuals/ground.svg", "elementIds": []}),
    );
    scene
        .assets
        .push(json!({"kind": "svg", "id": "front", "path": "visuals/front.svg", "elementIds": []}));
    scene.before.push(svg_node("ground-plane", "ground"));
    scene.after.push(svg_node("front-plane", "front"));
    scene.parts.push(triangle("t", BIG, 0.0, [0.0, 0.0, 1.0]));
    scene.drawables.push(toon("t", "t", "front"));
    let (ir, dir) = scene.write("planes");
    std::fs::create_dir_all(dir.join("visuals")).unwrap();
    std::fs::write(dir.join("visuals/ground.svg"), r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="-960 -960 1920 1920"><rect x="-960" y="-960" width="1920" height="1920" fill="#00ff00"/></svg>"##).unwrap();
    std::fs::write(dir.join("visuals/front.svg"), r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="-960 -960 1920 1920"><rect x="-120" y="120" width="240" height="120" fill="#0000ff"/></svg>"##).unwrap();
    let frame = Renderer::open(ir, Some(&dir))
        .expect("opens")
        .render_frame(Format::Long, 0)
        .expect("renders");
    assert_eq!(
        pixel(&frame, 5, 5),
        [0, 255, 0, 255],
        "the ground plane is behind everything"
    );
    assert_eq!(
        at(&frame, 0.0, -400.0),
        [248, 248, 248, 255],
        "the triangle is over the ground"
    );
    assert_eq!(
        at(&frame, 0.0, -180.0),
        [0, 0, 255, 255],
        "the foreground plane is over the triangle"
    );
}

/// The node's opacity mixes the stage with what is under it.
#[test]
fn the_stage_honours_its_opacity() {
    let mut scene = Scene::new();
    scene.opacity = Some(0.5);
    scene.parts.push(triangle("t", BIG, 0.0, [0.0, 0.0, 1.0]));
    scene.drawables.push(toon("t", "t", "front"));
    let frame = scene
        .renderer("opacity")
        .render_frame(Format::Long, 0)
        .expect("renders");
    let p = at(&frame, 0.0, -300.0);
    // Half of 248 over the background (11, 13, 16): about (130, 131, 132), give or take Skia's rounding.
    for (got, want) in p.iter().zip([130, 131, 132, 255]) {
        assert!((i32::from(*got) - want).abs() <= 2, "{p:?}");
    }
}

/// Asserts that a scene's picture is the same bytes on a repeat render, after other frames and on four threads sharing one stage.
fn assert_deterministic(scene: &Scene, name: &str) {
    let (ir, dir) = scene.write(name);
    let serial = Renderer::open(&ir, Some(&dir)).expect("opens");
    let reference: Vec<Vec<u8>> = (0..6)
        .map(|f| serial.render_frame(Format::Long, f).unwrap().rgba)
        .collect();
    // Backwards, after other frames: the same.
    for f in (0..6).rev() {
        assert!(
            serial.render_frame(Format::Long, f).unwrap().rgba == reference[f as usize],
            "frame {f} changed on a re-render"
        );
    }
    // Four threads, each with its own renderer sharing the stage, each drawing every frame in a different order.
    let shared = serial.stage3d_scene();
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

/// A repeat render, a render after other frames and renders on several threads over one shared stage are all the same bytes.
#[test]
fn rendering_is_deterministic_in_any_order_and_on_any_number_of_threads() {
    let mut scene = Scene::new();
    scene.parts.push(triangle("a", BIG, 0.0, [0.0, 0.0, 1.0]));
    scene.parts.push(triangle(
        "b",
        [[-300.0, -500.0], [700.0, -100.0], [100.0, 500.0]],
        50.0,
        [-0.3, -0.6, -0.5],
    ));
    scene.drawables.push(toon("a", "a", "double"));
    scene.drawables.push(toon("b", "b", "double"));
    assert_deterministic(&scene, "determinism");
}

/// A stage whose mesh file is missing, or whose file does not match the IR, is refused with the asset named.
#[test]
fn a_stage_with_a_bad_mesh_file_names_the_asset() {
    let mut scene = Scene::new();
    scene.parts.push(triangle("t", BIG, 0.0, [0.0, 0.0, 1.0]));
    scene.drawables.push(toon("t", "t", "front"));
    let (ir, dir) = scene.write("bad-mesh");
    std::fs::remove_file(dir.join("meshes/stage.mesh")).unwrap();
    match Renderer::open(&ir, Some(&dir)) {
        Err(RenderError::Asset { id, .. }) => assert_eq!(id, "stage-mesh"),
        other => panic!("expected an asset error, got {:?}", other.map(|_| ())),
    }
    std::fs::write(dir.join("meshes/stage.mesh"), b"not a mesh").unwrap();
    match Renderer::open(&ir, Some(&dir)) {
        Err(RenderError::Asset { id, reason, .. }) => {
            assert_eq!(id, "stage-mesh");
            assert!(reason.contains("AIDMESH"), "{reason}");
        }
        other => panic!("expected an asset error, got {:?}", other.map(|_| ())),
    }
}
