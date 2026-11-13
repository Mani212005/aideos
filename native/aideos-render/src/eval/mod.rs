//! File Description: The frame evaluator: resolves everything a frame depends on from the Render IR as a pure function of (IR, format, frame number), with no clocks and no state carried between frames, so frames can be evaluated in any order. It covers the camera, node and element tracks, visibility, the chapter rail, the end card's entrances and press, and (in `captions`) the kinetic caption phrases.
//! Inputs and outputs: a loaded `RenderIr`, a frame number and a format -> plain value structs (camera pose, transforms, element states, rail and end card state).
//! Used by: crate::raster (drawing), crate::renderer, and the evaluator tests in tests/evaluator.rs.

pub mod captions;
pub mod spring;
pub mod track;

use std::collections::BTreeMap;

use aideos_render_ir::types::{
    Chapter, ElementProperty, ElementTrack, NodeProperty, NodeTrack, RenderIr, SvgNode, Visible,
};

use self::track::{ease_expo_out, quantize, sample};

/// One of the two output formats a Render IR may declare.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Format {
    /// 16:9, normally 1920 x 1080.
    Long,
    /// 9:16, normally 1080 x 1920.
    Reel,
}

impl Format {
    /// Parses the wire and CLI name of a format.
    pub fn parse(name: &str) -> Option<Format> {
        match name {
            "long" => Some(Format::Long),
            "reel" => Some(Format::Reel),
            _ => None,
        }
    }

    /// The wire name of the format.
    pub fn name(self) -> &'static str {
        match self {
            Format::Long => "long",
            Format::Reel => "reel",
        }
    }

    /// Picks this format's value out of a per-format object.
    pub fn pick<T>(self, per: &aideos_render_ir::types::PerFormat<T>) -> Option<&T> {
        match self {
            Format::Long => per.long.as_ref(),
            Format::Reel => per.reel.as_ref(),
        }
    }
}

/// The scene camera at one frame, in scene units and degrees.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CameraPose {
    pub center_x: f64,
    pub center_y: f64,
    pub zoom: f64,
    pub rotation: f64,
}

/// Evaluates the camera at a frame; without a camera the scene centre is held at zoom 1.
pub fn camera(ir: &RenderIr, frame: u32) -> CameraPose {
    let dur = ir.film.duration_frames.0;
    match &ir.camera {
        Some(c) => CameraPose {
            center_x: sample(&c.center_x, frame, dur),
            center_y: sample(&c.center_y, frame, dur),
            zoom: sample(&c.zoom, frame, dur),
            rotation: sample(&c.rotation, frame, dur),
        },
        None => CameraPose {
            center_x: f64::from(ir.scene.width.0) / 2.0,
            center_y: f64::from(ir.scene.height.0) / 2.0,
            zoom: 1.0,
            rotation: 0.0,
        },
    }
}

/// The cover-fit scale of the scene square in a frame of the given size (`stageViewport` in projection.ts).
pub fn cover_fit(ir: &RenderIr, width: u32, height: u32) -> f64 {
    (f64::from(width) / f64::from(ir.scene.width.0))
        .max(f64::from(height) / f64::from(ir.scene.height.0))
}

/// Projects a scene point into frame pixels through the camera and the cover fit (`projectStagePoint`).
pub fn project(
    ir: &RenderIr,
    pose: &CameraPose,
    width: u32,
    height: u32,
    x: f64,
    y: f64,
) -> (f64, f64) {
    let fit = cover_fit(ir, width, height);
    let r = pose.rotation.to_radians();
    let (dx, dy) = (x - pose.center_x, y - pose.center_y);
    (
        f64::from(width) / 2.0 + (dx * r.cos() - dy * r.sin()) * pose.zoom * fit,
        f64::from(height) / 2.0 + (dx * r.sin() + dy * r.cos()) * pose.zoom * fit,
    )
}

/// Whether a node with this visibility span is drawn at a frame (half-open span; absent means always).
pub fn is_visible(visible: Option<&Visible>, frame: u32) -> bool {
    visible.is_none_or(|v| frame >= v.from_frame.0 && frame < v.to_frame.0)
}

/// A node's resolved placement: translation, scale (uniform, times a per-axis factor), rotation in degrees and opacity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NodeTransform {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    /// Horizontal factor multiplying `scale` (a `scaleX` track; 1 without one).
    pub scale_x: f64,
    /// Vertical factor multiplying `scale` (a `scaleY` track; 1 without one).
    pub scale_y: f64,
    pub rotation: f64,
    pub opacity: f64,
}

/// The value of the node track driving `property`, if one does.
fn node_track_value(
    tracks: &[NodeTrack],
    property: NodeProperty,
    frame: u32,
    dur: u32,
) -> Option<f64> {
    tracks
        .iter()
        .find(|t| t.property == property)
        .map(|t| sample(&t.keyframes, frame, dur))
}

/// Resolves a placed node (svg or group): a track replaces its static field; opacity multiplies the static opacity.
pub fn placed_transform(
    base: NodeTransform,
    static_opacity: Option<f64>,
    tracks: &[NodeTrack],
    frame: u32,
    dur: u32,
) -> NodeTransform {
    let pick = |p: NodeProperty, fallback: f64| {
        node_track_value(tracks, p, frame, dur).unwrap_or(fallback)
    };
    NodeTransform {
        x: pick(NodeProperty::X, base.x),
        y: pick(NodeProperty::Y, base.y),
        scale: pick(NodeProperty::Scale, base.scale),
        scale_x: pick(NodeProperty::ScaleX, base.scale_x),
        scale_y: pick(NodeProperty::ScaleY, base.scale_y),
        rotation: pick(NodeProperty::Rotation, base.rotation),
        opacity: (static_opacity.unwrap_or(1.0) * pick(NodeProperty::Opacity, 1.0)).clamp(0.0, 1.0),
    }
}

/// Resolves a boxed overlay node (rect or text): tracks are an offset, a scale and a rotation about the box centre.
pub fn boxed_transform(
    static_opacity: Option<f64>,
    tracks: &[NodeTrack],
    frame: u32,
    dur: u32,
) -> NodeTransform {
    let identity = NodeTransform {
        x: 0.0,
        y: 0.0,
        scale: 1.0,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation: 0.0,
        opacity: 1.0,
    };
    placed_transform(identity, static_opacity, tracks, frame, dur)
}

/// The animated state of one element inside an SVG asset at a frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ElementState {
    pub translate_x: f64,
    pub translate_y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotate: f64,
    /// Set only when a track drives opacity, so an authored opacity is otherwise kept.
    pub opacity: Option<f64>,
    pub draw_on: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub x1: Option<f64>,
    pub y1: Option<f64>,
    pub x2: Option<f64>,
    pub y2: Option<f64>,
}

impl Default for ElementState {
    /// The identity state: no motion, full draw-on, authored opacity kept.
    fn default() -> Self {
        ElementState {
            translate_x: 0.0,
            translate_y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotate: 0.0,
            opacity: None,
            draw_on: 1.0,
            origin_x: 0.0,
            origin_y: 0.0,
            x1: None,
            y1: None,
            x2: None,
            y2: None,
        }
    }
}

/// Samples one element track and quantizes it like the scene compiler (opacity and drawOn clamped to [0, 1]).
fn element_value(track: &ElementTrack, frame: u32, dur: u32) -> f64 {
    let v = sample(&track.keyframes, frame, dur);
    match track.property {
        ElementProperty::Opacity | ElementProperty::DrawOn => quantize(v.clamp(0.0, 1.0)),
        _ => quantize(v),
    }
}

/// Evaluates every element track of an SVG node at a frame, keyed by element id.
/// `scale` sets both axes; a `scaleX` or `scaleY` track, when present, wins on its own axis.
pub fn element_states(node: &SvgNode, frame: u32, dur: u32) -> BTreeMap<String, ElementState> {
    let mut states: BTreeMap<String, ElementState> = BTreeMap::new();
    for track in &node.element_tracks {
        let state = states.entry(track.target.clone()).or_default();
        if let Some(origin) = &track.origin {
            state.origin_x = origin.x;
            state.origin_y = origin.y;
        }
    }
    // Uniform scale first so a per-axis track applied after it overrides its axis.
    let mut ordered: Vec<&ElementTrack> = node.element_tracks.iter().collect();
    ordered.sort_by_key(|t| u8::from(t.property != ElementProperty::Scale));
    for track in ordered {
        let v = element_value(track, frame, dur);
        let state = states.entry(track.target.clone()).or_default();
        match track.property {
            ElementProperty::TranslateX => state.translate_x = v,
            ElementProperty::TranslateY => state.translate_y = v,
            ElementProperty::Scale => {
                state.scale_x = v;
                state.scale_y = v;
            }
            ElementProperty::ScaleX => state.scale_x = v,
            ElementProperty::ScaleY => state.scale_y = v,
            ElementProperty::Rotate => state.rotate = v,
            ElementProperty::Opacity => state.opacity = Some(v),
            ElementProperty::DrawOn => state.draw_on = v,
            ElementProperty::X1 => state.x1 = Some(v),
            ElementProperty::Y1 => state.y1 = Some(v),
            ElementProperty::X2 => state.x2 = Some(v),
            ElementProperty::Y2 => state.y2 = Some(v),
        }
    }
    states
}

/// The chapter rail at one frame.
#[derive(Debug, Clone, PartialEq)]
pub struct RailState {
    /// Index of the chapter the frame is in (the last one whose start is not after the frame).
    pub chapter_index: usize,
    /// "CHAPTER 01: TITLE", uppercased as the rail draws it.
    pub label: String,
    /// "MM:SS" of the frame.
    pub stamp: String,
    /// Fraction of `duration_frames` played, 0 to 1 (the reel's continuous bar).
    pub progress: f64,
}

/// Evaluates the rail's chapter, label, timestamp and progress at a frame; progress runs over `duration_frames` (the film, or the rail's `progressFrames`).
pub fn rail_state(chapters: &[Chapter], fps: u32, frame: u32, duration_frames: u32) -> RailState {
    let chapter_index = chapters
        .iter()
        .rposition(|c| c.start_frame.0 <= frame)
        .unwrap_or(0);
    let title = chapters
        .get(chapter_index)
        .map(|c| c.title.as_str())
        .unwrap_or("");
    let total = duration_frames.max(1);
    let seconds = frame / fps.max(1);
    RailState {
        chapter_index,
        label: format!("chapter {:02}: {}", chapter_index + 1, title).to_uppercase(),
        stamp: format!("{:02}:{:02}", seconds / 60, seconds % 60),
        progress: (f64::from(frame) / f64::from(total)).clamp(0.0, 1.0),
    }
}

/// How far a part has entered: opacity 0 to 1 and the distance in pixels it still sits below its place.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Entrance {
    pub opacity: f64,
    pub rise: f64,
}

/// The one entrance (motion.ts `useEntrance`): 400 ms on ease-out-expo, staggered 70 ms per index, rising 12 px.
pub fn entrance(frame: u32, start: f64, index: u32, fps: f64) -> Entrance {
    let from = start + 0.070 * fps * f64::from(index);
    let p = ease_expo_out((f64::from(frame) - from) / (0.400 * fps));
    Entrance {
        opacity: p,
        rise: (1.0 - p) * 12.0,
    }
}

/// The end card at one frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EndCardState {
    /// Fraction of the dim colour's own alpha applied over the stage, 0 to 1.
    pub dim: f64,
    pub panel: Entrance,
    pub label: Entrance,
    pub headline: Entrance,
    pub chips: Entrance,
    pub handle: Entrance,
    /// Depth of the subscribe press, 0 to 1.
    pub press: f64,
}

/// Evaluates the end card (EndCard.tsx): the dim settles over 600 ms, parts enter 150 ms in, the pill presses for 360 ms.
pub fn end_card_state(from_frame: u32, press_frame: u32, fps: u32, frame: u32) -> EndCardState {
    let fps = f64::from(fps);
    let start = f64::from(from_frame) + 0.150 * fps;
    let t = (f64::from(frame) - f64::from(press_frame)) / (0.360 * fps);
    let press = if !(0.0..=1.0).contains(&t) {
        0.0
    } else if t < 0.25 {
        ease_expo_out(t / 0.25)
    } else {
        1.0 - ease_expo_out((t - 0.25) / 0.75)
    };
    EndCardState {
        dim: ease_expo_out((f64::from(frame) - f64::from(from_frame)) / (0.600 * fps)),
        panel: entrance(frame, start, 0, fps),
        label: entrance(frame, start, 1, fps),
        headline: entrance(frame, start, 2, fps),
        chips: entrance(frame, start, 3, fps),
        handle: entrance(frame, start, 4, fps),
        press,
    }
}
