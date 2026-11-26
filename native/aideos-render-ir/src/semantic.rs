//! File Description: The cross-reference and range rules a JSON Schema cannot express (known assets, ordered keyframes, one origin per element, per-format placement, spans inside the film, the Three stage's graph, channels, parts, textures and face programs, a picture's pinned image asset, its one element and the properties that element may animate, and colour tracks' elements, one track per paint and their keyframes). Implements the same rules, issue codes and JSON Pointers as backend/renderIr/validate.ts; both are tested against the same fixtures.
//! Inputs and outputs: a structurally valid `RenderIr` -> every `Issue` found, in document order.
//! Used by: crate::load.

use std::collections::{HashMap, HashSet};

use crate::types::*;
use crate::Issue;

/// Which tree a node list belongs to.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Space {
    Stage,
    Overlay,
}

impl Space {
    /// The tree's name for messages.
    fn name(self) -> &'static str {
        match self {
            Space::Stage => "stage",
            Space::Overlay => "overlay",
        }
    }
}

/// An allowed value range for a keyframe list.
#[derive(Clone, Copy)]
struct Range {
    min: f64,
    max: f64,
    exclusive_min: bool,
}

const UNIT: Range = Range { min: 0.0, max: 1.0, exclusive_min: false };
const POSITIVE: Range = Range { min: 0.0, max: f64::INFINITY, exclusive_min: true };
const GAIN: Range = Range { min: 0.0, max: 4.0, exclusive_min: false };

/// Escapes one JSON Pointer segment (RFC 6901).
fn seg(part: &str) -> String {
    part.replace('~', "~0").replace('/', "~1")
}

/// Appends segments to a JSON Pointer.
fn at(path: &str, parts: &[&dyn ToString]) -> String {
    let mut out = path.to_string();
    for p in parts {
        out.push('/');
        out.push_str(&seg(&p.to_string()));
    }
    out
}

/// Reports whether an asset path stays inside the package: relative, no backslash, no drive letter, no `..`.
pub fn is_safe_relative_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains('\0') {
        return false;
    }
    let b = path.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return false;
    }
    !path.split('/').any(|part| part == ".." || part.is_empty())
}

/// Collects issues while the rules run.
struct Checker<'a> {
    issues: Vec<Issue>,
    duration: u32,
    declared_long: bool,
    declared_reel: bool,
    assets: HashMap<&'a str, &'a Asset>,
    ids: HashSet<&'a str>,
    stage3d_count: usize,
}

impl<'a> Checker<'a> {
    /// Records one issue.
    fn add(&mut self, code: &str, path: String, message: String) {
        self.issues.push(Issue { code: code.to_string(), path, message });
    }

    /// Looks an asset up by id and kind, reporting a missing or wrongly typed reference.
    fn need_asset(&mut self, path: String, id: &str, kind: &str) -> Option<&'a Asset> {
        match self.assets.get(id).copied() {
            None => {
                self.add("unknown_asset", path, format!("no asset with id {id}"));
                None
            }
            Some(a) if a.kind_name() != kind => {
                self.add("asset_kind_mismatch", path, format!("asset {id} is a {} asset, expected a {kind} asset", a.kind_name()));
                None
            }
            Some(a) => Some(a),
        }
    }

    /// Checks a keyframe list: strictly increasing frames inside the film, an ease on every segment, values in range.
    fn check_keyframes(&mut self, path: &str, keys: &[Keyframe], range: Option<Range>) {
        for (i, k) in keys.iter().enumerate() {
            let kp = at(path, &[&i]);
            if i > 0 && k.frame.0 <= keys[i - 1].frame.0 {
                self.add("keyframes_unordered", at(&kp, &[&"frame"]), "keyframe frames must strictly increase".into());
            }
            if k.frame.0 > self.duration {
                self.add("frame_out_of_range", at(&kp, &[&"frame"]), format!("frame {} is past the film's {} frames", k.frame.0, self.duration));
            }
            if i + 1 < keys.len() && k.ease.is_none() {
                self.add("ease_missing", kp.clone(), "every keyframe but the last names the easing of the segment after it".into());
            }
            if i + 1 == keys.len() && k.ease.is_some() {
                self.add("ease_on_last", at(&kp, &[&"ease"]), "the last keyframe has no segment after it".into());
            }
            if let Some(r) = range {
                if k.value < r.min || k.value > r.max || (r.exclusive_min && k.value <= r.min) {
                    self.add("value_out_of_range", at(&kp, &[&"value"]), format!("value {} is outside the allowed range", k.value));
                }
            }
        }
    }

    /// Checks a node-level track list.
    fn check_node_tracks(&mut self, path: &str, tracks: &[NodeTrack]) {
        let mut seen = HashSet::new();
        for (i, t) in tracks.iter().enumerate() {
            let tp = at(path, &[&"tracks", &i]);
            if !seen.insert(t.property) {
                self.add("duplicate_track", tp.clone(), format!("property {:?} is driven by two tracks", t.property));
            }
            let range = match t.property {
                NodeProperty::Opacity => Some(UNIT),
                NodeProperty::Scale => Some(POSITIVE),
                _ => None,
            };
            self.check_keyframes(&at(&tp, &[&"keyframes"]), &t.keyframes, range);
        }
    }

    /// Checks that a per-format object has exactly the declared formats.
    fn check_formats<T>(&mut self, path: &str, value: &PerFormat<T>) {
        for (name, present, wanted) in [("long", value.long.is_some(), self.declared_long), ("reel", value.reel.is_some(), self.declared_reel)] {
            if wanted && !present {
                self.add("missing_format_entry", at(path, &[&name]), format!("format {name} is declared but has no entry"));
            }
            if !wanted && present {
                self.add("undeclared_format", at(path, &[&name]), format!("format {name} is not declared in formats"));
            }
        }
    }

    /// Checks a half-open frame span.
    fn check_span(&mut self, path: String, from: u32, to: u32) {
        if to <= from {
            self.add("invalid_span", path, "a span must end after it starts".into());
        } else if to > self.duration {
            let d = self.duration;
            self.add("invalid_span", path, format!("a span may not run past the film's {d} frames"));
        }
    }

    /// Walks a node tree in one space, checking each node; `top` is true for the space's own list.
    fn walk(&mut self, nodes: &'a [Node], path: &str, space: Space, top: bool) {
        for (i, node) in nodes.iter().enumerate() {
            let p = at(path, &[&i]);
            if !self.ids.insert(node.id()) {
                self.add("duplicate_node_id", at(&p, &[&"id"]), format!("node id {} is already used", node.id()));
            }
            let allowed = match (node, space) {
                (Node::Stage3d(_), _) => space == Space::Stage && top,
                (_, Space::Stage) => matches!(node, Node::Svg(_) | Node::Image(_) | Node::Group(_)),
                (_, Space::Overlay) => !matches!(node, Node::Svg(_) | Node::Image(_)),
            };
            if !allowed {
                let message = if matches!(node, Node::Stage3d(_)) {
                    "a stage3d node is drawn only at the top of the stage".to_string()
                } else {
                    format!("a {} node cannot be drawn in the {}", node.kind_name(), space.name())
                };
                self.add("node_not_allowed", at(&p, &[&"kind"]), message);
            }
            if let Some(v) = node.visible() {
                self.check_span(at(&p, &[&"visible"]), v.from_frame.0, v.to_frame.0);
            }
            match node {
                Node::Group(n) => {
                    self.check_node_tracks(&p, &n.tracks);
                    self.walk(&n.children, &at(&p, &[&"children"]), space, false);
                }
                Node::Stage3d(n) => {
                    // Only a stage3d node in its place counts toward the one a document may draw.
                    if allowed {
                        self.stage3d_count += 1;
                    }
                    if allowed && self.stage3d_count > 1 {
                        self.add("node_not_allowed", at(&p, &[&"kind"]), "a document draws at most one stage3d node".into());
                    }
                    let mesh = match self.need_asset(at(&p, &[&"mesh"]), &n.mesh, "mesh") {
                        Some(Asset::Mesh(m)) => Some(m),
                        _ => None,
                    };
                    self.check_stage3d(&p, n, mesh);
                }
                Node::Svg(n) => self.check_svg(&p, n),
                Node::Image(n) => self.check_image(&p, n),
                Node::Rect(n) => {
                    self.check_node_tracks(&p, &n.tracks);
                    self.check_formats(&at(&p, &[&"placement"]), &n.placement);
                    if let Some(g) = &n.gradient {
                        for (j, pair) in g.stops.windows(2).enumerate() {
                            if pair[1].offset < pair[0].offset {
                                self.add("stops_unordered", at(&p, &[&"gradient", &"stops", &(j + 1), &"offset"]), "gradient stop offsets may not decrease".into());
                            }
                        }
                    }
                }
                Node::Text(n) => {
                    self.need_asset(at(&p, &[&"font"]), &n.font, "font");
                    self.check_node_tracks(&p, &n.tracks);
                    self.check_formats(&at(&p, &[&"placement"]), &n.placement);
                }
                Node::Rail(n) => {
                    self.need_asset(at(&p, &[&"font"]), &n.font, "font");
                    if let Some(total) = n.progress_frames {
                        if total.0 > self.duration {
                            let d = self.duration;
                            self.add("frame_out_of_range", at(&p, &[&"progressFrames"]), format!("progressFrames {} is past the film's {d} frames", total.0));
                        }
                    }
                    self.check_formats(&at(&p, &[&"placement"]), &n.placement);
                    let mut prev_end = 0u32;
                    for (j, c) in n.chapters.iter().enumerate() {
                        let cp = at(&p, &[&"chapters", &j]);
                        self.check_span(at(&cp, &[&"endFrame"]), c.start_frame.0, c.end_frame.0);
                        if c.start_frame.0 < prev_end {
                            self.add("chapters_unordered", at(&cp, &[&"startFrame"]), "chapters must follow one another without overlap".into());
                        }
                        prev_end = prev_end.max(c.end_frame.0);
                    }
                }
                Node::Captions(n) => self.check_captions(&p, n),
                Node::EndCard(n) => {
                    self.need_asset(at(&p, &[&"sansFont"]), &n.sans_font, "font");
                    self.need_asset(at(&p, &[&"monoFont"]), &n.mono_font, "font");
                    if let Some(chip) = &n.chip_font {
                        self.need_asset(at(&p, &[&"chipFont"]), chip, "font");
                    }
                    self.check_formats(&at(&p, &[&"layout"]), &n.layout);
                    if n.press_frame.0 > self.duration {
                        self.add("frame_out_of_range", at(&p, &[&"pressFrame"]), format!("frame {} is past the film's {} frames", n.press_frame.0, self.duration));
                    }
                }
            }
        }
    }

    /// Checks an svg node's asset reference and element tracks.
    fn check_svg(&mut self, p: &str, n: &'a SvgNode) {
        self.check_node_tracks(p, &n.tracks);
        let asset = self.need_asset(at(p, &[&"asset"]), &n.asset, "svg");
        for (j, t) in n.element_tracks.iter().enumerate() {
            if let Some(Asset::Svg(a)) = asset {
                if !a.element_ids.iter().any(|e| e == &t.target) {
                    self.add("unknown_element", at(p, &[&"elementTracks", &j, &"target"]), format!("asset {} declares no element {}", n.asset, t.target));
                }
            }
        }
        self.check_element_tracks(p, &n.element_tracks);
        // Colour tracks (`/5`): each names an element the asset declares, and one paint of an element has one track.
        let mut paints = HashSet::new();
        for (j, t) in n.color_tracks.iter().flatten().enumerate() {
            let tp = at(p, &[&"colorTracks", &j]);
            if let Some(Asset::Svg(a)) = asset {
                if !a.element_ids.iter().any(|e| e == &t.target) {
                    self.add("unknown_element", at(&tp, &[&"target"]), format!("asset {} declares no element {}", n.asset, t.target));
                }
            }
            if !paints.insert((t.target.as_str(), t.property)) {
                self.add("duplicate_track", tp.clone(), format!("{:?} of {} is driven by two tracks", t.property, t.target));
            }
            self.check_color_keyframes(&at(&tp, &[&"keyframes"]), &t.keyframes);
        }
    }

    /// Checks a colour keyframe list with the rules of a numeric one: strictly increasing frames inside the film and an ease on every segment.
    fn check_color_keyframes(&mut self, path: &str, keys: &[ColorKeyframe]) {
        for (i, k) in keys.iter().enumerate() {
            let kp = at(path, &[&i]);
            if i > 0 && k.frame.0 <= keys[i - 1].frame.0 {
                self.add("keyframes_unordered", at(&kp, &[&"frame"]), "keyframe frames must strictly increase".into());
            }
            if k.frame.0 > self.duration {
                self.add("frame_out_of_range", at(&kp, &[&"frame"]), format!("frame {} is past the film's {} frames", k.frame.0, self.duration));
            }
            if i + 1 < keys.len() && k.ease.is_none() {
                self.add("ease_missing", kp.clone(), "every keyframe but the last names the easing of the segment after it".into());
            }
            if i + 1 == keys.len() && k.ease.is_some() {
                self.add("ease_on_last", at(&kp, &[&"ease"]), "the last keyframe has no segment after it".into());
            }
        }
    }

    /// Checks an image node: a pinned image asset, its node tracks, and element tracks only on its one element and only of placement, scale, rotation and opacity.
    fn check_image(&mut self, p: &str, n: &'a ImageNode) {
        self.check_node_tracks(p, &n.tracks);
        if let Some(Asset::Image(a)) = self.need_asset(at(p, &[&"asset"]), &n.asset, "image") {
            if a.sha256.is_none() {
                self.add("image_unpinned", at(p, &[&"asset"]), format!("image asset {} carries no sha256; a drawn picture is pinned", a.id));
            }
        }
        for (j, t) in n.element_tracks.iter().enumerate() {
            let tp = at(p, &[&"elementTracks", &j]);
            if t.target != n.element {
                self.add("unknown_element", at(&tp, &[&"target"]), format!("image node {} has the one element {}, not {}", n.id, n.element, t.target));
            }
            if matches!(t.property, ElementProperty::DrawOn | ElementProperty::X1 | ElementProperty::Y1 | ElementProperty::X2 | ElementProperty::Y2 | ElementProperty::DashOffset) {
                self.add("property_not_allowed", at(&tp, &[&"property"]), format!("a picture's {:?} cannot be animated; move, scale, rotate or fade it", t.property));
            }
        }
        self.check_element_tracks(p, &n.element_tracks);
    }

    /// Checks the element tracks of an svg or image node: one track per element and property, one origin per element, values in range.
    fn check_element_tracks(&mut self, p: &str, tracks: &'a [ElementTrack]) {
        let mut keys = HashSet::new();
        let mut origins: HashMap<&str, (f64, f64)> = HashMap::new();
        for (j, t) in tracks.iter().enumerate() {
            let tp = at(p, &[&"elementTracks", &j]);
            if !keys.insert((t.target.as_str(), t.property)) {
                self.add("duplicate_track", tp.clone(), format!("{:?} of {} is driven by two tracks", t.property, t.target));
            }
            let takes_origin = matches!(t.property, ElementProperty::Scale | ElementProperty::ScaleX | ElementProperty::ScaleY | ElementProperty::Rotate);
            if t.origin.is_some() && !takes_origin {
                self.add("origin_misplaced", at(&tp, &[&"origin"]), "only scale and rotate tracks take an origin".into());
            }
            if takes_origin {
                let origin = t.origin.as_ref().map_or((0.0, 0.0), |o| (o.x, o.y));
                match origins.get(t.target.as_str()) {
                    Some(first) if *first != origin => {
                        self.add("origin_conflict", tp.clone(), format!("element {} already has a different transform origin", t.target));
                    }
                    Some(_) => {}
                    None => {
                        origins.insert(t.target.as_str(), origin);
                    }
                }
            }
            let range = match t.property {
                ElementProperty::Scale => Some(POSITIVE),
                ElementProperty::Opacity | ElementProperty::DrawOn => Some(UNIT),
                _ => None,
            };
            self.check_keyframes(&at(&tp, &[&"keyframes"]), &t.keyframes, range);
        }
    }

    /// Checks that a part exists in the mesh asset and is of the wanted kind.
    fn need_part(&mut self, mesh: Option<&MeshAsset>, parts: &HashMap<&str, MeshPartKind>, path: String, id: &str, want: MeshPartKind) {
        let Some(m) = mesh else { return };
        match parts.get(id) {
            None => self.add("unknown_part", path, format!("mesh {} has no part {id}", m.id)),
            Some(kind) if *kind != want => self.add("part_kind_mismatch", path, format!("part {id} is a {kind:?} part, a {want:?} part is needed here")),
            Some(_) => {}
        }
    }

    /// Checks one stage3d node: its graph (unique ids, parents listed first), channels (one per node, every channel `sampleFrames` samples long, scale above zero), drawables (known node, part and texture) and face textures (programs that exist, one per sample frame).
    fn check_stage3d(&mut self, p: &str, n: &Stage3dNode, mesh: Option<&MeshAsset>) {
        let samples = n.sample_frames.0 as usize;
        if n.sample_frames.0 > self.duration {
            let d = self.duration;
            self.add("frame_out_of_range", at(p, &[&"sampleFrames"]), format!("sampleFrames {} is past the film's {d} frames", n.sample_frames.0));
        }
        let mut node_ids: HashSet<&str> = HashSet::new();
        for (i, g) in n.nodes.iter().enumerate() {
            let gp = at(p, &[&"nodes", &i]);
            if node_ids.contains(g.id.as_str()) {
                self.add("duplicate_stage3d_id", at(&gp, &[&"id"]), format!("stage3d nodes id {} is already used", g.id));
            }
            if let Some(parent) = &g.parent {
                if !node_ids.contains(parent.as_str()) {
                    self.add("unknown_node", at(&gp, &[&"parent"]), format!("parent {parent} is not a node listed before {}", g.id));
                }
            }
            node_ids.insert(g.id.as_str());
        }
        let mut tracked: HashSet<&str> = HashSet::new();
        for (i, t) in n.channels.iter().enumerate() {
            let tp = at(p, &[&"channels", &i]);
            if !node_ids.contains(t.node.as_str()) {
                self.add("unknown_node", at(&tp, &[&"node"]), format!("no stage3d node {}", t.node));
            }
            if !tracked.insert(t.node.as_str()) {
                self.add("duplicate_track", tp.clone(), format!("node {} is driven by two tracks", t.node));
            }
            for (name, values, width) in [("position", &t.position, 3usize), ("quaternion", &t.quaternion, 4), ("scale", &t.scale, 1)] {
                let Some(values) = values else { continue };
                let want = samples * width;
                if values.len() != want {
                    self.add("sample_count_mismatch", at(&tp, &[&name]), format!("{name} has {} numbers, {samples} samples need {want}", values.len()));
                }
                if name == "scale" {
                    if let Some(bad) = values.iter().position(|v| v.is_nan() || *v <= 0.0) {
                        self.add("value_out_of_range", at(&tp, &[&name, &bad]), format!("scale {} is not above 0", values[bad]));
                    }
                }
            }
        }
        let textures: HashSet<&str> = n.face_textures.iter().map(|t| t.id.as_str()).collect();
        let parts: HashMap<&str, MeshPartKind> = mesh.map(|m| m.parts.iter().map(|part| (part.id.as_str(), part.kind())).collect()).unwrap_or_default();
        let mut group_ids: HashSet<&str> = HashSet::new();
        for (i, g) in n.groups.iter().flatten().enumerate() {
            if !group_ids.insert(g.id.as_str()) {
                self.add("duplicate_stage3d_id", at(p, &[&"groups", &i, &"id"]), format!("stage3d groups id {} is already used", g.id));
            }
        }
        for (i, span) in n.spans.iter().flatten().enumerate() {
            let sp = at(p, &[&"spans", &i, &"endFrame"]);
            if span.end_frame.0 <= span.start_frame.0 {
                self.add("invalid_span", sp, "a span must end after it starts".into());
            } else if span.end_frame.0 > self.duration {
                let d = self.duration;
                self.add("invalid_span", sp, format!("a span may not run past the film's {d} frames"));
            }
        }
        let uses_dots = n.drawables.iter().any(|d| d.dots.is_some());
        let mut drawable_ids: HashSet<&str> = HashSet::new();
        for (i, d) in n.drawables.iter().enumerate() {
            let dp = at(p, &[&"drawables", &i]);
            if !drawable_ids.insert(d.id.as_str()) {
                self.add("duplicate_stage3d_id", at(&dp, &[&"id"]), format!("stage3d drawables id {} is already used", d.id));
            }
            if !node_ids.contains(d.node.as_str()) {
                self.add("unknown_node", at(&dp, &[&"node"]), format!("no stage3d node {}", d.node));
            }
            self.need_part(mesh, &parts, at(&dp, &[&"part"]), &d.part, MeshPartKind::Triangles);
            if let StageMaterial::Face(f) = &d.material {
                if !textures.contains(f.texture.as_str()) {
                    self.add("unknown_texture", at(&dp, &[&"material", &"texture"]), format!("no face texture {}", f.texture));
                }
            }
            if let Some(g) = &d.group {
                if !group_ids.contains(g.as_str()) {
                    self.add("unknown_group", at(&dp, &[&"group"]), format!("no treatment group {g}"));
                }
            }
            if uses_dots && d.order.is_none() {
                self.add("dots_incomplete", at(&dp, &[&"order"]), "every drawable of a document that uses dots-v1 carries its draw order".into());
            }
            if let Some(look) = &d.dots {
                if d.group.is_none() {
                    self.add("dots_incomplete", at(&dp, &[&"group"]), "a drawable with a dots-v1 look belongs to a treatment group".into());
                }
                if let DotsMaterial::FaceLuma(f) = &look.material {
                    if !textures.contains(f.texture.as_str()) {
                        self.add("unknown_texture", at(&dp, &[&"dots", &"material", &"texture"]), format!("no face texture {}", f.texture));
                    }
                }
                if let Some(samples) = &look.samples {
                    self.need_part(mesh, &parts, at(&dp, &[&"dots", &"samples", &"part"]), &samples.part, MeshPartKind::Points);
                }
                if let Some(edges) = &look.edges {
                    self.need_part(mesh, &parts, at(&dp, &[&"dots", &"edges", &"part"]), &edges.part, MeshPartKind::Lines);
                }
            }
        }
        let mut texture_ids: HashSet<&str> = HashSet::new();
        for (i, t) in n.face_textures.iter().enumerate() {
            let fp = at(p, &[&"faceTextures", &i]);
            if !texture_ids.insert(t.id.as_str()) {
                self.add("duplicate_stage3d_id", at(&fp, &[&"id"]), format!("stage3d faceTextures id {} is already used", t.id));
            }
            if t.programs.len() != samples {
                self.add("sample_count_mismatch", at(&fp, &[&"programs"]), format!("{} program indices, {samples} samples need {samples}", t.programs.len()));
            }
            if let Some(bad) = t.programs.iter().position(|index| index.0 as usize >= n.face_programs.len()) {
                self.add("unknown_program", at(&fp, &[&"programs", &bad]), format!("program {} is not one of the {} face programs", t.programs[bad].0, n.face_programs.len()));
            }
        }
        if n.projection.far <= n.projection.near {
            self.add("value_out_of_range", at(p, &[&"projection", &"far"]), "the far plane must be beyond the near plane".into());
        }
    }

    /// Checks a captions node: font, per-format placement, word order and span order.
    fn check_captions(&mut self, p: &str, n: &CaptionsNode) {
        self.need_asset(at(p, &[&"font"]), &n.font, "font");
        self.check_formats(&at(p, &[&"placement"]), &n.placement);
        let mut prev_start = 0u32;
        for (j, w) in n.words.iter().enumerate() {
            let wp = at(p, &[&"words", &j]);
            self.check_span(at(&wp, &[&"endFrame"]), w.start_frame.0, w.end_frame.0);
            if w.start_frame.0 < prev_start {
                self.add("words_unordered", at(&wp, &[&"startFrame"]), "caption words must be in spoken order".into());
            }
            prev_start = w.start_frame.0;
        }
        for (name, placement) in [("long", &n.placement.long), ("reel", &n.placement.reel)] {
            let Some(placement) = placement else { continue };
            for (j, s) in placement.spans.iter().enumerate() {
                if s.from_frame.0 >= self.duration {
                    self.add("frame_out_of_range", at(p, &[&"placement", &name, &"spans", &j, &"fromFrame"]), format!("frame {} is not inside the film's {} frames", s.from_frame.0, self.duration));
                }
                if j > 0 && s.from_frame.0 <= placement.spans[j - 1].from_frame.0 {
                    self.add("spans_unordered", at(p, &[&"placement", &name, &"spans", &j, &"fromFrame"]), "placement spans must start in increasing frame order".into());
                }
            }
        }
    }
}

/// Runs the rules the structural schema cannot express and returns every issue, in document order.
pub fn check(ir: &RenderIr) -> Vec<Issue> {
    let mut c = Checker {
        issues: Vec::new(),
        duration: ir.film.duration_frames.0,
        declared_long: ir.formats.long.is_some(),
        declared_reel: ir.formats.reel.is_some(),
        assets: HashMap::new(),
        ids: HashSet::new(),
        stage3d_count: 0,
    };
    if !c.declared_long && !c.declared_reel {
        c.add("no_formats", "/formats".into(), "declare at least one of long or reel".into());
    }

    for (i, asset) in ir.assets.iter().enumerate() {
        let p = at("", &[&"assets", &i]);
        if c.assets.contains_key(asset.id()) {
            c.add("duplicate_asset_id", at(&p, &[&"id"]), format!("asset id {} is already used", asset.id()));
        } else {
            c.assets.insert(asset.id(), asset);
        }
        if !is_safe_relative_path(asset.path()) {
            c.add("unsafe_asset_path", at(&p, &[&"path"]), "an asset path is relative to the package and may not leave it".into());
        }
        if let Asset::Svg(svg) = asset {
            let mut seen = HashSet::new();
            for (j, e) in svg.element_ids.iter().enumerate() {
                if !seen.insert(e.as_str()) {
                    c.add("duplicate_element_id", at(&p, &[&"elementIds", &j]), format!("element id {e} is listed twice"));
                }
            }
        }
        if let Asset::Mesh(mesh) = asset {
            let mut seen = HashSet::new();
            for (j, part) in mesh.parts.iter().enumerate() {
                if !seen.insert(part.id.as_str()) {
                    c.add("duplicate_part_id", at(&p, &[&"parts", &j, &"id"]), format!("mesh part id {} is listed twice", part.id));
                }
                if part.indices.0 % 3 != 0 {
                    c.add("indices_not_triangles", at(&p, &[&"parts", &j, &"indices"]), format!("{} indices are not a whole number of triangles", part.indices.0));
                }
                let kind = part.kind();
                if kind == MeshPartKind::Triangles && part.indices.0 == 0 {
                    c.add("indices_not_triangles", at(&p, &[&"parts", &j, &"indices"]), "a triangles part holds at least one triangle".into());
                }
                if kind != MeshPartKind::Triangles {
                    let name = if kind == MeshPartKind::Points { "points" } else { "lines" };
                    if part.indices.0 != 0 {
                        c.add("part_kind_mismatch", at(&p, &[&"parts", &j, &"indices"]), format!("a {name} part has no indices"));
                    }
                    if part.uv {
                        c.add("part_kind_mismatch", at(&p, &[&"parts", &j, &"uv"]), format!("a {name} part has no uvs"));
                    }
                    if kind == MeshPartKind::Lines && part.vertices.0 % 2 != 0 {
                        c.add("part_kind_mismatch", at(&p, &[&"parts", &j, &"vertices"]), "a lines part holds whole segments (an even number of end points)".into());
                    }
                }
            }
        }
    }

    c.walk(&ir.stage, "/stage", Space::Stage, true);
    c.walk(&ir.overlay, "/overlay", Space::Overlay, true);

    if let Some(cam) = &ir.camera {
        c.check_keyframes("/camera/centerX", &cam.center_x, None);
        c.check_keyframes("/camera/centerY", &cam.center_y, None);
        c.check_keyframes("/camera/zoom", &cam.zoom, Some(POSITIVE));
        c.check_keyframes("/camera/rotation", &cam.rotation, None);
    }

    let mut audio_ids = HashSet::new();
    for (i, clip) in ir.audio.iter().enumerate() {
        let p = at("", &[&"audio", &i]);
        if !audio_ids.insert(clip.id.as_str()) {
            c.add("duplicate_audio_id", at(&p, &[&"id"]), format!("audio clip id {} is already used", clip.id));
        }
        c.need_asset(at(&p, &[&"asset"]), &clip.asset, "audio");
        if u64::from(clip.start_frame.0) + u64::from(clip.duration_frames.0) > u64::from(c.duration) {
            let d = c.duration;
            c.add("invalid_span", p.clone(), format!("the clip runs past the film's {d} frames"));
        }
        c.check_keyframes(&at(&p, &[&"gainEnvelope"]), &clip.gain_envelope, Some(GAIN));
    }
    c.issues
}
