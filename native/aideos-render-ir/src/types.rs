//! File Description: The serde types of the Render IR (`aideos.render/1` and its superset `aideos.render/2`, which adds the stage3d node and the mesh asset), mirroring backend/renderIr/schema.ts field for field (camelCase on the wire, unknown fields refused).
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
    Stage3d(Stage3dNode),
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
            Node::Stage3d(n) => &n.id,
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
            Node::Stage3d(n) => n.visible.as_ref(),
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
            Node::Stage3d(_) => "stage3d",
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
    /// Face of the chip labels; absent means `mono_font`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chip_font: Option<String>,
    pub fill: String,
    pub ink: String,
    pub dim: String,
    /// The panel colour; absent means derived from `dim` and `ink`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    /// The panel's 1 px border; absent means `ink` at 12%.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hairline: Option<String>,
    /// The label and handle colour; absent means `ink` at 60%.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muted: Option<String>,
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
    Mesh(MeshAsset),
}

impl Asset {
    /// The asset's id, whatever its kind.
    pub fn id(&self) -> &str {
        match self {
            Asset::Svg(a) => &a.id,
            Asset::Font(a) => &a.id,
            Asset::Image(a) => &a.id,
            Asset::Audio(a) => &a.id,
            Asset::Mesh(a) => &a.id,
        }
    }

    /// The asset's package-relative path, whatever its kind.
    pub fn path(&self) -> &str {
        match self {
            Asset::Svg(a) => &a.path,
            Asset::Font(a) => &a.path,
            Asset::Image(a) => &a.path,
            Asset::Audio(a) => &a.path,
            Asset::Mesh(a) => &a.path,
        }
    }

    /// The asset's kind as the wire name.
    pub fn kind_name(&self) -> &'static str {
        match self {
            Asset::Svg(_) => "svg",
            Asset::Font(_) => "font",
            Asset::Image(_) => "image",
            Asset::Audio(_) => "audio",
            Asset::Mesh(_) => "mesh",
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

// ---------------------------------------------------------------------------------------------
// aideos.render/2: the Three stage. Everything above is `/1`; `/2` adds the stage3d node and the mesh asset.
// ---------------------------------------------------------------------------------------------

/// One part of a mesh asset: its vertex and index counts and whether it carries texture coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeshPart {
    pub id: String,
    pub vertices: Whole,
    pub indices: Whole,
    pub uv: bool,
}

/// A binary mesh file holding every part's positions, normals, uvs and indices (see crate::mesh).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeshAsset {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub parts: Vec<MeshPart>,
}

/// Which faces a material draws (three's FrontSide, BackSide or DoubleSide).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Front,
    Back,
    Double,
}

/// Polygon offset: depth pushed by `factor` times the slope plus `units` steps.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolygonOffset {
    pub factor: f64,
    pub units: f64,
}

/// A flat-coloured material (toon or basic): linear colour and sidedness.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ColorMaterial {
    pub color: [f64; 3],
    pub side: Side,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polygon_offset: Option<PolygonOffset>,
}

/// The face material: a face texture times a linear colour, unlit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FaceMaterial {
    pub texture: String,
    pub color: [f64; 3],
    pub side: Side,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polygon_offset: Option<PolygonOffset>,
}

/// The ink outline: the part pushed out along its normals by `width` object units, one colour.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InkMaterial {
    pub color: [f64; 3],
    pub width: f64,
    pub side: Side,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polygon_offset: Option<PolygonOffset>,
}

/// How one drawable is shaded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StageMaterial {
    Toon(ColorMaterial),
    Basic(ColorMaterial),
    Face(FaceMaterial),
    Ink(InkMaterial),
}

/// A transform node of the stage graph: a static local transform under an optional parent listed before it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StageGraphNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub position: [f64; 3],
    /// x, y, z, w.
    pub quaternion: [f64; 4],
    pub scale: f64,
}

/// Dense per-frame local channels of one node (3, 4 and 1 numbers per sample).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StageChannel {
    pub node: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quaternion: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<Vec<f64>>,
}

/// One mesh part drawn with one material at one node, in draw order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StageDrawable {
    pub id: String,
    pub node: String,
    pub part: String,
    pub material: StageMaterial,
}

/// One stop of a face gradient.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceStop {
    pub offset: f64,
    pub color: String,
    pub alpha: f64,
}

/// A paint as the face painter sets it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FacePaint {
    Color { color: String, alpha: f64 },
    LinearGradient { x0: f64, y0: f64, x1: f64, y1: f64, stops: Vec<FaceStop> },
}

/// A canvas line cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineCap {
    Butt,
    Round,
    Square,
}

/// A canvas line join.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineJoin {
    Miter,
    Round,
    Bevel,
}

/// One recorded Canvas 2D call of the face painter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum FaceOp {
    SetTransform { args: [f64; 6] },
    Save,
    Restore,
    Scale { args: [f64; 2] },
    Translate { args: [f64; 2] },
    FillStyle { paint: FacePaint },
    StrokeStyle { paint: FacePaint },
    LineWidth { value: f64 },
    LineCap { value: LineCap },
    LineJoin { value: LineJoin },
    GlobalAlpha { value: f64 },
    FillRect { args: [f64; 4] },
    BeginPath,
    MoveTo { args: [f64; 2] },
    LineTo { args: [f64; 2] },
    QuadraticCurveTo { args: [f64; 4] },
    BezierCurveTo { args: [f64; 6] },
    /// x, y, radiusX, radiusY, rotation, startAngle, endAngle (clockwise).
    Ellipse { args: [f64; 7] },
    /// x, y, radius, startAngle, endAngle (clockwise).
    Arc { args: [f64; 5] },
    Fill,
    Stroke,
    Clip,
}

/// A recorded face program.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceProgram {
    pub ops: Vec<FaceOp>,
}

/// The only texture filter a face uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextureFilter {
    Linear,
}

/// The only colour space the stage uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorSpace {
    Srgb,
}

/// The only tone mapping the stage uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToneMapping {
    None,
}

/// The stage treatments the IR carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Treatment {
    #[serde(rename = "cel-v1")]
    CelV1,
}

/// A painted face texture: canvas size, sampling and the program index at each sample frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FaceTexture {
    pub id: String,
    pub size: Whole,
    pub flip_y: bool,
    pub filter: TextureFilter,
    pub mipmaps: bool,
    pub color_space: ColorSpace,
    pub programs: Vec<Whole>,
}

/// The orthographic stage camera's depth constants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Projection {
    pub camera_z: f64,
    pub near: f64,
    pub far: f64,
}

/// The directional light, as three positions it (direction = position - target).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectionalLight {
    pub position: [f64; 3],
    pub target: [f64; 3],
    pub color: [f64; 3],
    pub intensity: f64,
}

/// The ambient light.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmbientLight {
    pub color: [f64; 3],
    pub intensity: f64,
}

/// The stage's two lights.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lighting {
    pub directional: DirectionalLight,
    pub ambient: AmbientLight,
}

/// The stage's output settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StageOutput {
    pub dpr: f64,
    pub antialias: bool,
    pub color_space: ColorSpace,
    pub tone_mapping: ToneMapping,
    pub exposure: f64,
}

/// The Three stage: an orthographic, lit cel scene drawn between the ground and foreground SVG planes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Stage3dNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Visible>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    pub mesh: String,
    pub treatment: Treatment,
    pub projection: Projection,
    pub lighting: Lighting,
    pub ramp: Vec<Whole>,
    pub output: StageOutput,
    /// Samples every channel and face texture holds; frame f reads sample min(f, sample_frames - 1).
    pub sample_frames: Whole,
    pub nodes: Vec<StageGraphNode>,
    pub channels: Vec<StageChannel>,
    pub drawables: Vec<StageDrawable>,
    pub face_textures: Vec<FaceTexture>,
    pub face_programs: Vec<FaceProgram>,
}
