//! File Description: The retained SVG model of a scene asset. An asset is parsed once into a tree keyed by element id (shapes, groups, single-run text) with its presentation style, transforms, gradients and clip paths; each frame then draws that tree with its element states (crate::raster::svg). The supported subset is exactly what static scene artwork uses; anything outside it (filters, masks, `use`, images, patterns, markers, `tspan`, SMIL, stylesheets) is refused with a message naming it, because silently dropping part of an asset renders a wrong frame with no sign of it. Like SceneView, the root `<svg>` element's own attributes and viewBox are not drawn: its children are placed in the asset's own coordinates.
//! Inputs and outputs: SVG source text -> `SvgDocument` (or `SvgError`).
//! Used by: crate::renderer (asset loading) and crate::raster::svg (drawing).

pub mod color;

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use skia_safe::{Matrix, Path, PathFillType, PathOp, Point, RRect, Rect};

use self::color::{parse_color, Rgba};

/// Why an SVG asset could not be loaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SvgError(pub String);

impl fmt::Display for SvgError {
    /// Writes the message.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SvgError {}

/// Shorthand for building an `SvgError` result.
fn err<T>(message: impl Into<String>) -> Result<T, SvgError> {
    Err(SvgError(message.into()))
}

/// A fill or stroke paint.
#[derive(Debug, Clone, PartialEq)]
pub enum Paint {
    None,
    Color(Rgba),
    CurrentColor,
    /// A gradient defined in the document, by id.
    Url(String),
}

/// Stroke line cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineCap {
    Butt,
    Round,
    Square,
}

/// Stroke line join.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineJoin {
    Miter,
    Round,
    Bevel,
}

/// Horizontal anchor of a text run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextAnchor {
    Start,
    Middle,
    End,
}

/// Inheritable presentation properties as authored on one element; `None` inherits from the parent.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Style {
    pub fill: Option<Paint>,
    pub fill_opacity: Option<f64>,
    pub fill_rule_even_odd: Option<bool>,
    pub stroke: Option<Paint>,
    pub stroke_width: Option<f64>,
    pub stroke_opacity: Option<f64>,
    pub stroke_linecap: Option<LineCap>,
    pub stroke_linejoin: Option<LineJoin>,
    pub stroke_miterlimit: Option<f64>,
    /// An empty list means `none`.
    pub stroke_dasharray: Option<Vec<f64>>,
    pub stroke_dashoffset: Option<f64>,
    pub color: Option<Rgba>,
    pub font_family: Option<String>,
    pub font_size: Option<f64>,
    pub font_weight: Option<u32>,
    pub text_anchor: Option<TextAnchor>,
    pub letter_spacing: Option<f64>,
    pub visible: Option<bool>,
}

/// The fully resolved presentation properties of an element after inheritance.
#[derive(Debug, Clone, PartialEq)]
pub struct ComputedStyle {
    pub fill: Paint,
    pub fill_opacity: f64,
    pub fill_rule_even_odd: bool,
    pub stroke: Paint,
    pub stroke_width: f64,
    pub stroke_opacity: f64,
    pub stroke_linecap: LineCap,
    pub stroke_linejoin: LineJoin,
    pub stroke_miterlimit: f64,
    pub stroke_dasharray: Vec<f64>,
    pub stroke_dashoffset: f64,
    pub color: Rgba,
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u32,
    pub text_anchor: TextAnchor,
    pub letter_spacing: f64,
    pub visible: bool,
}

impl Default for ComputedStyle {
    /// The SVG initial values: black fill, no stroke, 1px stroke width, 16px sans-serif text.
    fn default() -> Self {
        ComputedStyle {
            fill: Paint::Color(Rgba {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            }),
            fill_opacity: 1.0,
            fill_rule_even_odd: false,
            stroke: Paint::None,
            stroke_width: 1.0,
            stroke_opacity: 1.0,
            stroke_linecap: LineCap::Butt,
            stroke_linejoin: LineJoin::Miter,
            stroke_miterlimit: 4.0,
            stroke_dasharray: Vec::new(),
            stroke_dashoffset: 0.0,
            color: Rgba {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
            font_family: "sans-serif".to_string(),
            font_size: 16.0,
            font_weight: 400,
            text_anchor: TextAnchor::Start,
            letter_spacing: 0.0,
            visible: true,
        }
    }
}

impl ComputedStyle {
    /// Applies an element's own style on top of the style it inherits.
    pub fn inherit(&self, own: &Style) -> ComputedStyle {
        let mut s = self.clone();
        macro_rules! take {
            ($($f:ident),*) => { $( if let Some(v) = &own.$f { s.$f = v.clone(); } )* };
        }
        take!(
            fill,
            fill_opacity,
            fill_rule_even_odd,
            stroke,
            stroke_width,
            stroke_opacity,
            stroke_linecap,
            stroke_linejoin,
            stroke_miterlimit,
            stroke_dasharray,
            stroke_dashoffset,
            color,
            font_family,
            font_size,
            font_weight,
            text_anchor,
            letter_spacing,
            visible
        );
        s
    }
}

/// The geometry of a drawable element, kept in authored form so element states can change it.
#[derive(Debug, Clone)]
pub enum Shape {
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        rx: f64,
        ry: f64,
    },
    Circle {
        cx: f64,
        cy: f64,
        r: f64,
    },
    Ellipse {
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
    },
    Line {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
    Poly {
        points: Vec<(f64, f64)>,
        closed: bool,
    },
    Path(Path),
}

/// Line endpoint overrides from an element state (`x1`, `y1`, `x2`, `y2` tracks).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct LineOverride {
    pub x1: Option<f64>,
    pub y1: Option<f64>,
    pub x2: Option<f64>,
    pub y2: Option<f64>,
}

impl Shape {
    /// Builds the shape's path, applying line endpoint overrides; None when the shape draws nothing.
    pub fn to_path(&self, line: LineOverride) -> Option<Path> {
        let p = |x: f64, y: f64| Point::new(x as f32, y as f32);
        match self {
            Shape::Rect { x, y, w, h, rx, ry } => {
                if *w <= 0.0 || *h <= 0.0 {
                    return None;
                }
                let rect = Rect::from_xywh(*x as f32, *y as f32, *w as f32, *h as f32);
                if *rx > 0.0 && *ry > 0.0 {
                    let rr = RRect::new_rect_xy(
                        rect,
                        (*rx).min(w / 2.0) as f32,
                        (*ry).min(h / 2.0) as f32,
                    );
                    Some(Path::rrect(rr, None))
                } else {
                    Some(Path::rect(rect, None))
                }
            }
            Shape::Circle { cx, cy, r } => {
                (*r > 0.0).then(|| Path::circle(p(*cx, *cy), *r as f32, None))
            }
            Shape::Ellipse { cx, cy, rx, ry } => (*rx > 0.0 && *ry > 0.0).then(|| {
                Path::oval(
                    Rect::from_xywh(
                        (cx - rx) as f32,
                        (cy - ry) as f32,
                        (2.0 * rx) as f32,
                        (2.0 * ry) as f32,
                    ),
                    None,
                )
            }),
            Shape::Line { x1, y1, x2, y2 } => Some(Path::line(
                p(line.x1.unwrap_or(*x1), line.y1.unwrap_or(*y1)),
                p(line.x2.unwrap_or(*x2), line.y2.unwrap_or(*y2)),
            )),
            Shape::Poly { points, closed } => {
                let pts: Vec<Point> = points.iter().map(|(x, y)| p(*x, *y)).collect();
                (pts.len() >= 2).then(|| Path::polygon(&pts, *closed, None, None))
            }
            Shape::Path(path) => Some(path.clone()),
        }
    }

    /// Whether this is a line, which has no fill area.
    pub fn is_line(&self) -> bool {
        matches!(self, Shape::Line { .. })
    }
}

/// A single run of SVG text.
#[derive(Debug, Clone, PartialEq)]
pub struct TextRun {
    pub x: f64,
    pub y: f64,
    pub content: String,
}

/// What an element is.
#[derive(Debug, Clone)]
pub enum Kind {
    Group,
    Shape(Shape),
    Text(TextRun),
}

/// One drawable element of the retained tree.
#[derive(Debug, Clone)]
pub struct Element {
    pub id: Option<String>,
    pub kind: Kind,
    pub style: Style,
    /// The authored transform attribute.
    pub transform: Matrix,
    /// The authored opacity attribute (not inherited).
    pub opacity: f64,
    /// Id of a clipPath definition.
    pub clip_path: Option<String>,
    /// `display="none"`.
    pub hidden: bool,
    pub children: Vec<Element>,
}

/// Gradient spread outside [0, 1].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Spread {
    Pad,
    Reflect,
    Repeat,
}

/// The geometry of a gradient, in bounding-box fractions or user units depending on `bbox_units`.
#[derive(Debug, Clone, PartialEq)]
pub enum GradientGeometry {
    Linear {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
    Radial {
        cx: f64,
        cy: f64,
        r: f64,
        fx: f64,
        fy: f64,
    },
}

/// One gradient stop.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stop {
    pub offset: f64,
    pub color: Rgba,
}

/// A linear or radial gradient definition.
#[derive(Debug, Clone, PartialEq)]
pub struct Gradient {
    pub geometry: GradientGeometry,
    pub bbox_units: bool,
    pub transform: Matrix,
    pub spread: Spread,
    pub stops: Vec<Stop>,
}

/// A parsed SVG asset.
#[derive(Debug, Clone)]
pub struct SvgDocument {
    /// The root's children, drawn in order.
    pub elements: Vec<Element>,
    pub gradients: BTreeMap<String, Gradient>,
    /// Clip paths, already combined into one path in the clipped element's user space.
    pub clip_paths: BTreeMap<String, Path>,
    /// Every element id in the document.
    pub ids: BTreeSet<String>,
}

/// Elements that carry no rendering and are skipped.
const IGNORED: &[&str] = &["title", "desc", "metadata"];

/// Attributes that change rendering in ways this renderer does not implement.
const UNSUPPORTED_ATTRS: &[&str] = &[
    "filter",
    "mask",
    "marker-start",
    "marker-mid",
    "marker-end",
    "marker",
];

/// The attributes of one element, with `style` declarations folded in (a declaration beats the attribute).
fn attributes(node: roxmltree::Node) -> BTreeMap<String, String> {
    let mut attrs: BTreeMap<String, String> = BTreeMap::new();
    for a in node.attributes() {
        attrs.insert(a.name().to_string(), a.value().to_string());
    }
    if let Some(style) = attrs.remove("style") {
        for decl in style.split(';') {
            if let Some((k, v)) = decl.split_once(':') {
                let (k, v) = (k.trim(), v.trim());
                if !k.is_empty() && !v.is_empty() {
                    attrs.insert(k.to_string(), v.to_string());
                }
            }
        }
    }
    attrs
}

/// Parses a plain number, allowing a `px` suffix; percentages are refused.
fn number(value: &str, what: &str) -> Result<f64, SvgError> {
    let v = value.trim();
    let v = v.strip_suffix("px").unwrap_or(v).trim();
    match v.parse::<f64>() {
        Ok(n) if n.is_finite() => Ok(n),
        _ => err(format!(
            "{what}: {value:?} is not a number this renderer supports"
        )),
    }
}

/// Reads an optional numeric attribute with a default.
fn num_attr(attrs: &BTreeMap<String, String>, name: &str, default: f64) -> Result<f64, SvgError> {
    attrs.get(name).map_or(Ok(default), |v| number(v, name))
}

/// Parses a number list separated by commas and/or whitespace.
fn number_list(value: &str, what: &str) -> Result<Vec<f64>, SvgError> {
    value
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .map(|s| number(s, what))
        .collect()
}

/// Parses a paint value: `none`, `currentColor`, `url(#id)` or a colour.
fn paint(value: &str, what: &str) -> Result<Paint, SvgError> {
    let v = value.trim();
    if v == "none" {
        return Ok(Paint::None);
    }
    if v == "currentColor" {
        return Ok(Paint::CurrentColor);
    }
    if let Some(rest) = v.strip_prefix("url(") {
        let inner = rest
            .split(')')
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches(['"', '\'']);
        return match inner.strip_prefix('#') {
            Some(id) if !id.is_empty() => Ok(Paint::Url(id.to_string())),
            _ => err(format!(
                "{what}: {value:?} is not a local url(#id) reference"
            )),
        };
    }
    parse_color(v)
        .map(Paint::Color)
        .map_or_else(|| err(format!("{what}: unsupported colour {value:?}")), Ok)
}

/// Parses a 0 to 1 opacity value, also accepting a percentage.
fn opacity_value(value: &str, what: &str) -> Result<f64, SvgError> {
    let v = value.trim();
    let n = match v.strip_suffix('%') {
        Some(p) => number(p, what)? / 100.0,
        None => number(v, what)?,
    };
    Ok(n.clamp(0.0, 1.0))
}

/// Parses a CSS font-weight keyword or number.
fn font_weight(value: &str) -> Result<u32, SvgError> {
    match value.trim() {
        "normal" => Ok(400),
        "bold" => Ok(700),
        v => match v.parse::<u32>() {
            Ok(n) if (1..=1000).contains(&n) => Ok(n),
            _ => err(format!("font-weight: unsupported value {value:?}")),
        },
    }
}

/// Reads an element's inheritable presentation properties.
fn style(attrs: &BTreeMap<String, String>) -> Result<Style, SvgError> {
    let mut s = Style::default();
    for (k, v) in attrs {
        let v = v.as_str();
        if v.trim() == "inherit" {
            continue;
        }
        match k.as_str() {
            "fill" => s.fill = Some(paint(v, "fill")?),
            "fill-opacity" => s.fill_opacity = Some(opacity_value(v, k)?),
            "fill-rule" => s.fill_rule_even_odd = Some(v.trim() == "evenodd"),
            "stroke" => s.stroke = Some(paint(v, "stroke")?),
            "stroke-width" => s.stroke_width = Some(number(v, k)?.max(0.0)),
            "stroke-opacity" => s.stroke_opacity = Some(opacity_value(v, k)?),
            "stroke-linecap" => {
                s.stroke_linecap = Some(match v.trim() {
                    "round" => LineCap::Round,
                    "square" => LineCap::Square,
                    _ => LineCap::Butt,
                })
            }
            "stroke-linejoin" => {
                s.stroke_linejoin = Some(match v.trim() {
                    "round" => LineJoin::Round,
                    "bevel" => LineJoin::Bevel,
                    _ => LineJoin::Miter,
                })
            }
            "stroke-miterlimit" => s.stroke_miterlimit = Some(number(v, k)?.max(1.0)),
            "stroke-dasharray" => {
                s.stroke_dasharray = Some(if v.trim() == "none" {
                    Vec::new()
                } else {
                    number_list(v, k)?
                })
            }
            "stroke-dashoffset" => s.stroke_dashoffset = Some(number(v, k)?),
            "color" => {
                s.color = Some(
                    parse_color(v)
                        .map_or_else(|| err(format!("color: unsupported colour {v:?}")), Ok)?,
                )
            }
            "font-family" => s.font_family = Some(v.trim().to_string()),
            "font-size" => s.font_size = Some(number(v, k)?),
            "font-weight" => s.font_weight = Some(font_weight(v)?),
            "text-anchor" => {
                s.text_anchor = Some(match v.trim() {
                    "middle" => TextAnchor::Middle,
                    "end" => TextAnchor::End,
                    _ => TextAnchor::Start,
                })
            }
            "letter-spacing" => {
                s.letter_spacing = Some(if v.trim() == "normal" {
                    0.0
                } else {
                    number(v, k)?
                })
            }
            "visibility" => s.visible = Some(v.trim() == "visible"),
            _ => {}
        }
    }
    Ok(s)
}

/// Parses a transform list: matrix, translate, scale, rotate (with an optional centre), skewX and skewY.
pub fn parse_transform(value: &str) -> Result<Matrix, SvgError> {
    let mut m = Matrix::new_identity();
    let mut rest = value.trim();
    while !rest.is_empty() {
        let open = rest
            .find('(')
            .map_or_else(|| err(format!("transform: cannot read {value:?}")), Ok)?;
        let close = rest
            .find(')')
            .map_or_else(|| err(format!("transform: cannot read {value:?}")), Ok)?;
        let name = rest[..open].trim().trim_start_matches(',').trim();
        let args = number_list(&rest[open + 1..close], "transform")?;
        let f = |i: usize| args.get(i).copied().unwrap_or(0.0) as f32;
        let step = match (name, args.len()) {
            ("matrix", 6) => Matrix::new_all(f(0), f(2), f(4), f(1), f(3), f(5), 0.0, 0.0, 1.0),
            ("translate", 1 | 2) => Matrix::translate((f(0), f(1))),
            ("scale", 1) => Matrix::scale((f(0), f(0))),
            ("scale", 2) => Matrix::scale((f(0), f(1))),
            ("rotate", 1) => Matrix::rotate_deg(f(0)),
            ("rotate", 3) => Matrix::rotate_deg_pivot(f(0), (f(1), f(2))),
            ("skewX", 1) => Matrix::skew((f(0).to_radians().tan(), 0.0)),
            ("skewY", 1) => Matrix::skew((0.0, f(0).to_radians().tan())),
            _ => {
                return err(format!(
                    "transform: unsupported {name}() with {} arguments",
                    args.len()
                ))
            }
        };
        m = Matrix::concat(&m, &step);
        rest = rest[close + 1..].trim_start_matches(|c: char| c == ',' || c.is_whitespace());
    }
    Ok(m)
}

/// Parses a gradient coordinate: a fraction or percentage in bounding-box units, user units otherwise.
fn gradient_coord(
    attrs: &BTreeMap<String, String>,
    name: &str,
    default: f64,
    bbox_units: bool,
) -> Result<f64, SvgError> {
    let Some(v) = attrs.get(name) else {
        return Ok(default);
    };
    match v.trim().strip_suffix('%') {
        Some(p) if bbox_units => Ok(number(p, name)? / 100.0),
        Some(_) => err(format!(
            "{name}: percentages in userSpaceOnUse gradients are not supported"
        )),
        None => number(v, name),
    }
}

/// Parses a gradient's stops, keeping offsets clamped and non-decreasing.
fn gradient_stops(node: roxmltree::Node) -> Result<Vec<Stop>, SvgError> {
    let mut stops: Vec<Stop> = Vec::new();
    for child in node.children().filter(|c| c.is_element()) {
        if child.tag_name().name() != "stop" {
            return err(format!(
                "unsupported element <{}> inside a gradient",
                child.tag_name().name()
            ));
        }
        let attrs = attributes(child);
        let offset = match attrs.get("offset").map(|s| s.trim()) {
            Some(v) => match v.strip_suffix('%') {
                Some(p) => number(p, "offset")? / 100.0,
                None => number(v, "offset")?,
            },
            None => 0.0,
        }
        .clamp(0.0, 1.0);
        let offset = stops.last().map_or(offset, |s| offset.max(s.offset));
        let base = match attrs.get("stop-color") {
            Some(c) => parse_color(c)
                .map_or_else(|| err(format!("stop-color: unsupported colour {c:?}")), Ok)?,
            None => Rgba {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        };
        let alpha = match attrs.get("stop-opacity") {
            Some(v) => opacity_value(v, "stop-opacity")?,
            None => 1.0,
        };
        stops.push(Stop {
            offset,
            color: base.with_alpha_scaled(alpha),
        });
    }
    Ok(stops)
}

/// A gradient as parsed, before `href` stop inheritance is resolved.
struct RawGradient {
    gradient: Gradient,
    href: Option<String>,
}

/// Parses a linearGradient or radialGradient element.
fn parse_gradient(node: roxmltree::Node, linear: bool) -> Result<RawGradient, SvgError> {
    let attrs = attributes(node);
    let bbox_units = attrs
        .get("gradientUnits")
        .is_none_or(|u| u.trim() != "userSpaceOnUse");
    let c = |name: &str, default: f64| gradient_coord(&attrs, name, default, bbox_units);
    let geometry = if linear {
        GradientGeometry::Linear {
            x1: c("x1", 0.0)?,
            y1: c("y1", 0.0)?,
            x2: c("x2", 1.0)?,
            y2: c("y2", 0.0)?,
        }
    } else {
        let (cx, cy) = (c("cx", 0.5)?, c("cy", 0.5)?);
        GradientGeometry::Radial {
            cx,
            cy,
            r: c("r", 0.5)?,
            fx: c("fx", cx)?,
            fy: c("fy", cy)?,
        }
    };
    let spread = match attrs.get("spreadMethod").map(|s| s.trim()) {
        Some("reflect") => Spread::Reflect,
        Some("repeat") => Spread::Repeat,
        _ => Spread::Pad,
    };
    let transform = match attrs.get("gradientTransform") {
        Some(t) => parse_transform(t)?,
        None => Matrix::new_identity(),
    };
    let href = attrs
        .get("href")
        .map(|h| h.trim().trim_start_matches('#').to_string());
    Ok(RawGradient {
        gradient: Gradient {
            geometry,
            bbox_units,
            transform,
            spread,
            stops: gradient_stops(node)?,
        },
        href,
    })
}

/// Reads `clip-path="url(#id)"` into the id.
fn clip_ref(attrs: &BTreeMap<String, String>) -> Result<Option<String>, SvgError> {
    match attrs.get("clip-path").map(|s| s.trim()) {
        None | Some("none") => Ok(None),
        Some(v) => match paint(v, "clip-path")? {
            Paint::Url(id) => Ok(Some(id)),
            _ => err(format!("clip-path: {v:?} is not a url(#id) reference")),
        },
    }
}

/// Parses `points` of a polyline or polygon.
fn points(attrs: &BTreeMap<String, String>) -> Result<Vec<(f64, f64)>, SvgError> {
    let nums = number_list(
        attrs.get("points").map(String::as_str).unwrap_or(""),
        "points",
    )?;
    Ok(nums.chunks_exact(2).map(|c| (c[0], c[1])).collect())
}

/// Reads the shape of a geometry element, or None for a tag that is not a shape.
fn shape(tag: &str, attrs: &BTreeMap<String, String>) -> Result<Option<Shape>, SvgError> {
    let n = |name: &str| num_attr(attrs, name, 0.0);
    Ok(Some(match tag {
        "rect" => {
            let (rx, ry) = (attrs.get("rx"), attrs.get("ry"));
            let rx_v = rx.map(|v| number(v, "rx")).transpose()?;
            let ry_v = ry.map(|v| number(v, "ry")).transpose()?;
            let (rx, ry) = match (rx_v, ry_v) {
                (Some(a), Some(b)) => (a, b),
                (Some(a), None) => (a, a),
                (None, Some(b)) => (b, b),
                (None, None) => (0.0, 0.0),
            };
            Shape::Rect {
                x: n("x")?,
                y: n("y")?,
                w: n("width")?,
                h: n("height")?,
                rx,
                ry,
            }
        }
        "circle" => Shape::Circle {
            cx: n("cx")?,
            cy: n("cy")?,
            r: n("r")?,
        },
        "ellipse" => Shape::Ellipse {
            cx: n("cx")?,
            cy: n("cy")?,
            rx: n("rx")?,
            ry: n("ry")?,
        },
        "line" => Shape::Line {
            x1: n("x1")?,
            y1: n("y1")?,
            x2: n("x2")?,
            y2: n("y2")?,
        },
        "polyline" => Shape::Poly {
            points: points(attrs)?,
            closed: false,
        },
        "polygon" => Shape::Poly {
            points: points(attrs)?,
            closed: true,
        },
        "path" => {
            let d = attrs.get("d").map(String::as_str).unwrap_or("").trim();
            if d.is_empty() {
                Shape::Poly {
                    points: Vec::new(),
                    closed: false,
                }
            } else {
                Shape::Path(
                    skia_safe::utils::parse_path::from_svg(d)
                        .map_or_else(|| err(format!("path: cannot parse d={d:?}")), Ok)?,
                )
            }
        }
        _ => return Ok(None),
    }))
}

/// Collapses whitespace in text content the way SVG does by default.
fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Mutable state threaded through the parse.
#[derive(Default)]
struct Parse {
    gradients: BTreeMap<String, RawGradient>,
    clip_nodes: Vec<(String, Matrix, Vec<Element>)>,
    ids: BTreeSet<String>,
}

impl Parse {
    /// Records an element id, refusing a duplicate.
    fn record_id(&mut self, id: &str) -> Result<(), SvgError> {
        if !self.ids.insert(id.to_string()) {
            return err(format!("duplicate element id {id:?}"));
        }
        Ok(())
    }

    /// Parses the element children of a node into drawable elements; definitions are recorded, not returned.
    fn children(&mut self, node: roxmltree::Node) -> Result<Vec<Element>, SvgError> {
        let mut out = Vec::new();
        for child in node.children().filter(|c| c.is_element()) {
            if let Some(e) = self.element(child)? {
                out.push(e);
            }
        }
        Ok(out)
    }

    /// Parses one element; returns None for definitions and ignorable elements.
    fn element(&mut self, node: roxmltree::Node) -> Result<Option<Element>, SvgError> {
        let tag = node.tag_name().name();
        let attrs = attributes(node);
        if let Some(bad) = UNSUPPORTED_ATTRS.iter().find(|a| attrs.contains_key(**a)) {
            return err(format!("unsupported attribute {bad:?} on <{tag}>"));
        }
        let id = attrs
            .get("id")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(id) = &id {
            self.record_id(id)?;
        }
        match tag {
            _ if IGNORED.contains(&tag) => return Ok(None),
            "defs" => {
                // Definitions are parsed for their gradients and clip paths; plain shapes inside are never drawn.
                self.children(node)?;
                return Ok(None);
            }
            "linearGradient" | "radialGradient" => {
                let Some(id) = id else { return Ok(None) };
                let g = parse_gradient(node, tag == "linearGradient")?;
                self.gradients.insert(id, g);
                return Ok(None);
            }
            "clipPath" => {
                if attrs
                    .get("clipPathUnits")
                    .is_some_and(|u| u.trim() == "objectBoundingBox")
                {
                    return err("clipPath: clipPathUnits=\"objectBoundingBox\" is not supported");
                }
                let transform = match attrs.get("transform") {
                    Some(t) => parse_transform(t)?,
                    None => Matrix::new_identity(),
                };
                let kids = self.children(node)?;
                if let Some(id) = id {
                    self.clip_nodes.push((id, transform, kids));
                }
                return Ok(None);
            }
            _ => {}
        }
        let kind = if tag == "g" {
            Kind::Group
        } else if tag == "text" {
            if node.children().any(|c| c.is_element()) {
                return err("<text> with child elements (tspan, textPath) is not supported");
            }
            let content =
                collapse_whitespace(&node.children().filter_map(|c| c.text()).collect::<String>());
            Kind::Text(TextRun {
                x: num_attr(&attrs, "x", 0.0)?,
                y: num_attr(&attrs, "y", 0.0)?,
                content,
            })
        } else if let Some(s) = shape(tag, &attrs)? {
            Kind::Shape(s)
        } else {
            return err(format!("unsupported element <{tag}>"));
        };
        let transform = match attrs.get("transform") {
            Some(t) => parse_transform(t)?,
            None => Matrix::new_identity(),
        };
        let opacity = match attrs.get("opacity") {
            Some(v) => opacity_value(v, "opacity")?,
            None => 1.0,
        };
        let children = if matches!(kind, Kind::Group) {
            self.children(node)?
        } else {
            Vec::new()
        };
        Ok(Some(Element {
            id,
            kind,
            style: style(&attrs)?,
            transform,
            opacity,
            clip_path: clip_ref(&attrs)?,
            hidden: attrs.get("display").is_some_and(|d| d.trim() == "none"),
            children,
        }))
    }
}

/// Combines the shapes of a clipPath into one path in the clipped element's user space.
fn clip_path_union(transform: &Matrix, kids: &[Element]) -> Result<Path, SvgError> {
    let mut union: Option<Path> = None;
    for kid in kids {
        let Kind::Shape(s) = &kid.kind else {
            return err("clipPath may only contain shapes");
        };
        let Some(mut path) = s.to_path(LineOverride::default()) else {
            continue;
        };
        if kid.style.fill_rule_even_odd == Some(true) {
            path = path.with_fill_type(PathFillType::EvenOdd);
        }
        let placed = path.with_transform(&Matrix::concat(transform, &kid.transform));
        union = Some(match union {
            None => placed,
            Some(u) => skia_safe::op(&u, &placed, PathOp::Union)
                .map_or_else(|| err("clipPath: cannot combine shapes"), Ok)?,
        });
    }
    Ok(union.unwrap_or_default())
}

/// Parses an SVG document into the retained model.
pub fn parse(source: &str) -> Result<SvgDocument, SvgError> {
    let opts = roxmltree::ParsingOptions {
        allow_dtd: false,
        ..Default::default()
    };
    let doc = roxmltree::Document::parse_with_options(source, opts)
        .map_err(|e| SvgError(format!("not XML: {e}")))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" {
        return err(format!(
            "root element is <{}>, not <svg>",
            root.tag_name().name()
        ));
    }
    let mut p = Parse::default();
    let elements = p.children(root)?;
    // A gradient without stops takes them from the gradient its href names.
    let mut gradients: BTreeMap<String, Gradient> = BTreeMap::new();
    for (id, raw) in &p.gradients {
        let mut g = raw.gradient.clone();
        let mut href = raw.href.clone();
        let mut hops = 0;
        while g.stops.is_empty() {
            let Some(target) = href.take() else { break };
            let Some(next) = p.gradients.get(&target) else {
                return err(format!(
                    "gradient {id:?} references unknown gradient {target:?}"
                ));
            };
            g.stops = next.gradient.stops.clone();
            href = next.href.clone();
            hops += 1;
            if hops > 16 {
                return err(format!("gradient {id:?} has a reference cycle"));
            }
        }
        gradients.insert(id.clone(), g);
    }
    let mut clip_paths = BTreeMap::new();
    for (id, transform, kids) in &p.clip_nodes {
        clip_paths.insert(id.clone(), clip_path_union(transform, kids)?);
    }
    let svg_doc = SvgDocument {
        elements,
        gradients,
        clip_paths,
        ids: p.ids,
    };
    check_references(&svg_doc.elements, &svg_doc)?;
    Ok(svg_doc)
}

/// Refuses a fill, stroke or clip-path that names a definition the document does not have.
fn check_references(elements: &[Element], doc: &SvgDocument) -> Result<(), SvgError> {
    for e in elements {
        for p in [&e.style.fill, &e.style.stroke].into_iter().flatten() {
            if let Paint::Url(id) = p {
                if !doc.gradients.contains_key(id) {
                    return err(format!("paint references unknown gradient {id:?}"));
                }
            }
        }
        if let Some(id) = &e.clip_path {
            if !doc.clip_paths.contains_key(id) {
                return err(format!("clip-path references unknown clipPath {id:?}"));
            }
        }
        check_references(&e.children, doc)?;
    }
    Ok(())
}
