//! File Description: The serde types of the Render IR `aideos.render/1`, mirroring backend/renderIr/schema.ts field for field (camelCase on the wire, unknown fields refused).
//! Inputs and outputs: a JSON document that already passed the JSON Schema check -> a typed `RenderIr`; a `RenderIr` -> the same JSON again.
//! Used by: crate::load, crate::semantic, and the native renderer crates that evaluate the IR.

use serde::de::{Deserializer, Error as _};
use serde::{Deserialize, Serialize};

/// A whole number of frames, pixels or other counts; accepts `30`, `30.0` and `3e1` like JavaScript does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Whole(pub u32);

impl<'de> Deserialize<'de> for Whole {
    /// Reads a JSON number and requires it to be a non-negative integer value.
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = f64::deserialize(d)?;
        if v.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&v) {
            Ok(Whole(v as u32))
        } else {
            Err(D::Error::custom(format!("expected a whole number, got {v}")))
        }
    }
}

/// Reads a JSON number that must be a whole number, for a signed integer field.
fn de_whole_i32<'de, D: Deserializer<'de>>(d: D) -> Result<i32, D::Error> {
    let v = f64::deserialize(d)?;
    if v.fract() == 0.0 && (f64::from(i32::MIN)..=f64::from(i32::MAX)).contains(&v) {
        Ok(v as i32)
    } else {
        Err(D::Error::custom(format!("expected a whole number, got {v}")))
    }
}

/// The whole document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderIr {
    pub schema: String,
    pub film: Film,
    pub scene: Size,
    pub formats: PerFormat<Size>,
    pub background: String,
    pub assets: Vec<Asset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<Camera>,
    pub stage: Vec<Node>,
    pub overlay: Vec<Node>,
    pub audio: Vec<AudioClip>,
}

/// Film identity and clock.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Film {
    pub id: String,
    pub fps: Whole,
    pub duration_frames: Whole,
}

/// A width and height in pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Size {
    pub width: Whole,
    pub height: Whole,
}

/// A value for each output format the document may declare.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerFormat<T> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub long: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reel: Option<T>,
}

/// An axis-aligned rectangle in render pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Easing of the segment that starts at a keyframe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Ease {
    Linear,
    Hold,
    ExpoIn,
    ExpoOut,
    ExpoInOut,
    Spline,
}

/// The value at a frame and the easing of the segment after it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Keyframe {
    pub frame: Whole,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease: Option<Ease>,
}

/// A point in an asset's own coordinate space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Properties a node-level track may drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeProperty {
    X,
    Y,
    Scale,
    ScaleX,
    ScaleY,
    Rotation,
    Opacity,
}

/// A keyframed property of a whole node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeTrack {
    pub property: NodeProperty,
    pub keyframes: Vec<Keyframe>,
}

/// Properties a track may drive on one element inside an SVG asset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ElementProperty {
    TranslateX,
    TranslateY,
    Scale,
    ScaleX,
    ScaleY,
    Rotate,
    Opacity,
    DrawOn,
    X1,
    Y1,
    X2,
    Y2,
}

/// A keyframed property of one element of an SVG asset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ElementTrack {
    pub target: String,
    pub property: ElementProperty,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Point>,
    pub keyframes: Vec<Keyframe>,
}

/// A half-open span of frames in which a node is drawn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Visible {
    pub from_frame: Whole,
    pub to_frame: Whole,
}

/// A stroke colour and width.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stroke {
    pub color: String,
    pub width: f64,
}

/// Where a text node sits in one format, with its font size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub font_size: f64,
}

/// Where the chapter rail sits in one format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RailBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub font_size: f64,
    pub scrim_height: f64,
}

/// One chapter of the rail: a title and the frames it spans.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Chapter {
    pub title: String,
    pub start_frame: Whole,
    pub end_frame: Whole,
}

/// One spoken word with its frames.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CaptionWord {
    pub text: String,
    pub start_frame: Whole,
    pub end_frame: Whole,
}

/// The caption card position from a frame on, normalized to the frame; absent `w` means content-sized.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CaptionSpan {
    pub from_frame: Whole,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
}

/// Caption size and placement spans for one format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CaptionPlacement {
    pub font_size: f64,
    pub spans: Vec<CaptionSpan>,
}

/// Type sizes of the end card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndCardType {
    pub label: f64,
    pub headline: f64,
    pub chip: f64,
    pub handle: f64,
}

/// Chip metrics of the end card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EndCardChip {
    pub height: f64,
    pub pad_x: f64,
    pub gap: f64,
    pub icon: f64,
}

/// The resolved layout of the end card in one format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EndCardLayout {
    pub card: Rect,
    pub scale: f64,
    pub pad_x: f64,
    pub pad_y: f64,
    pub gap: f64,
    pub radius: f64,
    #[serde(rename = "type")]
    pub type_sizes: EndCardType,
    pub chip: EndCardChip,
}

/// The words of the end card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EndCardCopy {
    pub label: String,
    pub headline: String,
    pub like_label: String,
    pub subscribe_label: String,
    pub handle: String,
}

/// A node of the stage (scene space) or overlay (frame space) tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Node {
    Svg(SvgNode),
    Rect(RectNode),
    Text(TextNode),
    Rail(RailNode),
    Captions(CaptionsNode),
    EndCard(EndCardNode),
    Group(GroupNode),
}

impl Node {
    /// The node's id, whatever its kind.
    pub fn id(&self) -> &str {
        match self {
            Node::Svg(n) => &n.id,
            Node::Rect(n) => &n.id,
            Node::Text(n) => &n.id,
            Node::Rail(n) => &n.id,
            Node::Captions(n) => &n.id,
            Node::EndCard(n) => &n.id,
            Node::Group(n) => &n.id,
        }
    }

    /// The node's visibility span, whatever its kind.
    pub fn visible(&self) -> Option<&Visible> {
        match self {
            Node::Svg(n) => n.visible.as_ref(),
            Node::Rect(n) => n.visible.as_ref(),
            Node::Text(n) => n.visible.as_ref(),
            Node::Rail(n) => n.visible.as_ref(),
            Node::Captions(n) => n.visible.as_ref(),
            Node::EndCard(n) => n.visible.as_ref(),
            Node::Group(n) => n.visible.as_ref(),
        }
    }

    /// The node's kind as the wire name, for messages.
    pub fn kind_name(&self) -> &'static str {
        match self {
            Node::Svg(_) => "svg",
            Node::Rect(_) => "rect",
            Node::Text(_) => "text",
            Node::Rail(_) => "rail",
            Node::Captions(_) => "captions",
            Node::EndCard(_) => "endCard",
            Node::Group(_) => "group",
        }
    }
}

/// An SVG asset placed on the stage, with element-level motion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SvgNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Visible>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    pub asset: String,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub rotation: f64,
    #[serde(deserialize_with = "de_whole_i32")]
    pub layer: i32,
    pub tracks: Vec<NodeTrack>,
    pub element_tracks: Vec<ElementTrack>,
}

/// A rounded rectangle in frame space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RectNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Visible>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    /// A vertical gradient painted over the fill and under the stroke.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gradient: Option<Gradient>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
    pub radius: f64,
    pub tracks: Vec<NodeTrack>,
    pub placement: PerFormat<Rect>,
}

/// A vertical linear gradient across a box: offset 0 is the box top, 1 its bottom.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Gradient {
    pub stops: Vec<GradientStop>,
}

/// One colour stop of a gradient.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GradientStop {
    pub offset: f64,
    pub color: String,
}

/// A run of text in frame space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Visible>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    pub text: String,
    pub font: String,
    pub color: String,
    pub align: Align,
    pub line_height: f64,
    pub letter_spacing: f64,
    pub tracks: Vec<NodeTrack>,
    pub placement: PerFormat<TextBox>,
}

/// Horizontal text alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    Left,
    Center,
    Right,
}

/// The chapter rail.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RailNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Visible>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    pub font: String,
    pub ink: String,
    /// Colour of the chapter label and timestamp row.
    pub label_color: String,
    pub accent: String,
    pub track_color: String,
    pub scrim: String,
    pub chapters: Vec<Chapter>,
    /// Frames the reel's continuous bar fills over; absent means the film duration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_frames: Option<Whole>,
    pub placement: PerFormat<RailBox>,
}

/// Kinetic captions: words with timings and the owner-resolved card placement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CaptionsNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Visible>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    pub font: String,
    pub color: String,
    pub highlight_color: String,
    pub background_color: String,
    pub words: Vec<CaptionWord>,
    pub placement: PerFormat<CaptionPlacement>,
}

/// The like-and-subscribe end card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EndCardNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Visible>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    pub sans_font: String,
    pub mono_font: String,
    pub fill: String,
    pub ink: String,
    pub dim: String,
    pub copy: EndCardCopy,
    pub press_frame: Whole,
    pub layout: PerFormat<EndCardLayout>,
}

/// A transform, an opacity and children drawn in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Visible>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub rotation: f64,
    pub tracks: Vec<NodeTrack>,
    pub children: Vec<Node>,
}

/// A file the renderer reads, named by id and located relative to the package directory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Asset {
    Svg(SvgAsset),
    Font(FontAsset),
    Image(ImageAsset),
    Audio(AudioAsset),
}

impl Asset {
    /// The asset's id, whatever its kind.
    pub fn id(&self) -> &str {
        match self {
            Asset::Svg(a) => &a.id,
            Asset::Font(a) => &a.id,
            Asset::Image(a) => &a.id,
            Asset::Audio(a) => &a.id,
        }
    }

    /// The asset's package-relative path, whatever its kind.
    pub fn path(&self) -> &str {
        match self {
            Asset::Svg(a) => &a.path,
            Asset::Font(a) => &a.path,
            Asset::Image(a) => &a.path,
            Asset::Audio(a) => &a.path,
        }
    }

    /// The asset's kind as the wire name.
    pub fn kind_name(&self) -> &'static str {
        match self {
            Asset::Svg(_) => "svg",
            Asset::Font(_) => "font",
            Asset::Image(_) => "image",
            Asset::Audio(_) => "audio",
        }
    }
}

/// An SVG document and the element ids it declares.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SvgAsset {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub element_ids: Vec<String>,
}

/// A vendored font file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FontAsset {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub family: String,
    pub weight: Whole,
}

/// A raster image.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageAsset {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub width: Whole,
    pub height: Whole,
}

/// An audio file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioAsset {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// One audio clip placed on the film timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AudioClip {
    pub id: String,
    pub asset: String,
    pub start_frame: Whole,
    pub duration_frames: Whole,
    pub source_start_ms: f64,
    pub gain: f64,
    pub gain_envelope: Vec<Keyframe>,
}

/// The scene camera as four keyframed properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Camera {
    pub center_x: Vec<Keyframe>,
    pub center_y: Vec<Keyframe>,
    pub zoom: Vec<Keyframe>,
    pub rotation: Vec<Keyframe>,
}
