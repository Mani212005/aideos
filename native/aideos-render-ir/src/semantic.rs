//! File Description: The cross-reference and range rules a JSON Schema cannot express (known assets, ordered keyframes, one origin per element, per-format placement, spans inside the film). Implements the same rules, issue codes and JSON Pointers as backend/renderIr/validate.ts; both are tested against the same fixtures.
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

    /// Walks a node tree in one space, checking each node.
    fn walk(&mut self, nodes: &'a [Node], path: &str, space: Space) {
        for (i, node) in nodes.iter().enumerate() {
            let p = at(path, &[&i]);
            if !self.ids.insert(node.id()) {
                self.add("duplicate_node_id", at(&p, &[&"id"]), format!("node id {} is already used", node.id()));
            }
            let allowed = match space {
                Space::Stage => matches!(node, Node::Svg(_) | Node::Group(_)),
                Space::Overlay => !matches!(node, Node::Svg(_)),
            };
            if !allowed {
                self.add("node_not_allowed", at(&p, &[&"kind"]), format!("a {} node cannot be drawn in the {}", node.kind_name(), space.name()));
            }
            if let Some(v) = node.visible() {
                self.check_span(at(&p, &[&"visible"]), v.from_frame.0, v.to_frame.0);
            }
            match node {
                Node::Group(n) => {
                    self.check_node_tracks(&p, &n.tracks);
                    self.walk(&n.children, &at(&p, &[&"children"]), space);
                }
                Node::Svg(n) => self.check_svg(&p, n),
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
        let mut keys = HashSet::new();
        let mut origins: HashMap<&str, (f64, f64)> = HashMap::new();
        for (j, t) in n.element_tracks.iter().enumerate() {
            let tp = at(p, &[&"elementTracks", &j]);
            if let Some(Asset::Svg(a)) = asset {
                if !a.element_ids.iter().any(|e| e == &t.target) {
                    self.add("unknown_element", at(&tp, &[&"target"]), format!("asset {} declares no element {}", n.asset, t.target));
                }
            }
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
    }

    c.walk(&ir.stage, "/stage", Space::Stage);
    c.walk(&ir.overlay, "/overlay", Space::Overlay);

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
