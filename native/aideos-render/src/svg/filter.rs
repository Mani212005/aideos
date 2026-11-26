//! File Description: The SVG filter subset of the retained model: a `<filter>` definition parsed into its region and an ordered list of primitives (`feGaussianBlur`, `feOffset`, `feFlood`, `feComposite`, `feMerge`) with their inputs resolved to indices, following the Filter Effects Module Level 1 rules Chrome implements (the default region -10%/-10%/120%/120% of the element's bounding box, `in` defaulting to the previous result or SourceGraphic, an unknown result name treated as no name, `color-interpolation-filters` defaulting to linearRGB and inherited from the filter's ancestors). It is exactly what glows and drop shadows use; every other primitive, input keyword or attribute that changes rendering (primitive subregions, `primitiveUnits="objectBoundingBox"`, `href` chains, edge modes, other operators) is refused with a message naming it, so a filter is drawn exactly or not at all.
//! Inputs and outputs: a `<filter>` element node -> a `Filter` (or `SvgError`).
//! Used by: crate::svg (document parsing) and crate::raster::filter (building the Skia image filter).

use std::collections::{BTreeMap, HashMap};

use super::color::{parse_color, Rgba};
use super::{attributes, err, number, opacity_value, SvgError};

/// The colour space a primitive operates in (`color-interpolation-filters`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorSpace {
    Srgb,
    LinearRgb,
}

/// Where a primitive reads one of its inputs from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterInput {
    /// The element as drawn, without its opacity.
    SourceGraphic,
    /// The alpha channel of the element as drawn, black elsewhere.
    SourceAlpha,
    /// The result of an earlier primitive, by its index in the filter.
    Result(usize),
}

/// The Porter-Duff operators and the arithmetic combination of `feComposite`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CompositeOperator {
    Over,
    In,
    Out,
    Atop,
    Xor,
    Arithmetic { k1: f64, k2: f64, k3: f64, k4: f64 },
}

/// What one filter primitive does.
#[derive(Debug, Clone, PartialEq)]
pub enum FilterOp {
    /// A Gaussian blur with separate standard deviations in user units; zero on an axis leaves it unblurred.
    Blur {
        input: FilterInput,
        std_x: f64,
        std_y: f64,
    },
    /// Moves the input by (dx, dy) user units.
    Offset {
        input: FilterInput,
        dx: f64,
        dy: f64,
    },
    /// Fills the filter region with one colour (flood-opacity already folded into its alpha).
    Flood { color: Rgba },
    /// Combines `input` (the source) with `input2` (the destination).
    Composite {
        input: FilterInput,
        input2: FilterInput,
        operator: CompositeOperator,
    },
    /// Draws each input over the previous ones in order.
    Merge { inputs: Vec<FilterInput> },
}

/// One primitive and the colour space it works in.
#[derive(Debug, Clone, PartialEq)]
pub struct FilterPrimitive {
    pub op: FilterOp,
    pub space: ColorSpace,
}

/// The filter region: fractions of the element's bounding box, or user units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FilterRegion {
    pub bbox_units: bool,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A parsed `<filter>` definition. An empty primitive list draws nothing, as in Chrome.
#[derive(Debug, Clone, PartialEq)]
pub struct Filter {
    pub region: FilterRegion,
    pub primitives: Vec<FilterPrimitive>,
}

/// Attributes of a `<filter>` element this renderer reads; any other attribute is refused, except inert ones.
const FILTER_ATTRS: &[&str] = &[
    "id",
    "x",
    "y",
    "width",
    "height",
    "filterUnits",
    "primitiveUnits",
    "color-interpolation-filters",
];

/// Attributes that never change how anything is drawn, accepted everywhere in a filter.
const INERT_ATTRS: &[&str] = &["class", "xmlns", "xmlns:xlink"];

/// The attributes each supported primitive reads, besides `color-interpolation-filters` and `result`.
fn primitive_attrs(tag: &str) -> Option<&'static [&'static str]> {
    Some(match tag {
        "feGaussianBlur" => &["in", "stdDeviation", "edgeMode"],
        "feOffset" => &["in", "dx", "dy"],
        "feFlood" => &["flood-color", "flood-opacity"],
        "feComposite" => &["in", "in2", "operator", "k1", "k2", "k3", "k4"],
        "feMerge" => &[],
        _ => return None,
    })
}

/// Refuses any attribute outside `allowed` (plus ids, inert ones and `data-` or `aria-` metadata), naming it.
fn check_attrs(
    tag: &str,
    attrs: &BTreeMap<String, String>,
    allowed: &[&str],
) -> Result<(), SvgError> {
    for name in attrs.keys() {
        let ok = allowed.contains(&name.as_str())
            || INERT_ATTRS.contains(&name.as_str())
            || name == "id"
            || name.starts_with("data-")
            || name.starts_with("aria-");
        if !ok {
            return err(format!("unsupported attribute {name:?} on <{tag}>"));
        }
    }
    Ok(())
}

/// Parses `color-interpolation-filters`; `inherit` and absence return None.
fn color_space(
    attrs: &BTreeMap<String, String>,
    tag: &str,
) -> Result<Option<ColorSpace>, SvgError> {
    match attrs.get("color-interpolation-filters").map(|v| v.trim()) {
        None | Some("inherit") => Ok(None),
        Some("linearRGB") => Ok(Some(ColorSpace::LinearRgb)),
        // `auto` lets the user agent choose; Chrome uses sRGB for it.
        Some("sRGB") | Some("auto") => Ok(Some(ColorSpace::Srgb)),
        Some(other) => err(format!(
            "color-interpolation-filters on <{tag}>: unsupported value {other:?}"
        )),
    }
}

/// The colour space a filter inherits from its ancestors (linearRGB, the initial value, when none sets it).
fn inherited_space(node: roxmltree::Node) -> Result<ColorSpace, SvgError> {
    for ancestor in node.ancestors().skip(1).filter(|n| n.is_element()) {
        let attrs = attributes(ancestor);
        if let Some(space) = color_space(&attrs, ancestor.tag_name().name())? {
            return Ok(space);
        }
    }
    Ok(ColorSpace::LinearRgb)
}

/// Parses one region coordinate: a fraction or percentage in bounding-box units, a plain number in user units.
fn region_coord(
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
            "filter {name}: percentages in userSpaceOnUse filters are not supported"
        )),
        None => number(v, name),
    }
}

/// Parses `stdDeviation`: one value for both axes or two; negative values are refused.
fn std_deviation(value: Option<&String>) -> Result<(f64, f64), SvgError> {
    let Some(value) = value else {
        return Ok((0.0, 0.0));
    };
    let parts: Vec<f64> = value
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .map(|s| number(s, "stdDeviation"))
        .collect::<Result<_, _>>()?;
    let (x, y) = match parts.as_slice() {
        [v] => (*v, *v),
        [x, y] => (*x, *y),
        _ => {
            return err(format!(
                "stdDeviation: {value:?} must be one or two numbers"
            ))
        }
    };
    if x < 0.0 || y < 0.0 {
        return err(format!("stdDeviation: {value:?} is negative"));
    }
    Ok((x, y))
}

/// Resolves an `in` or `in2` value against the results named so far; `previous` is the default.
fn input(
    value: Option<&String>,
    named: &HashMap<String, usize>,
    previous: FilterInput,
    tag: &str,
) -> Result<FilterInput, SvgError> {
    let Some(v) = value.map(|v| v.trim()).filter(|v| !v.is_empty()) else {
        return Ok(previous);
    };
    match v {
        "SourceGraphic" => Ok(FilterInput::SourceGraphic),
        "SourceAlpha" => Ok(FilterInput::SourceAlpha),
        "BackgroundImage" | "BackgroundAlpha" | "FillPaint" | "StrokePaint" => {
            err(format!("<{tag}>: the {v} input is not supported"))
        }
        // A reference to a result no earlier primitive names is treated as no reference (Filter Effects 1).
        name => Ok(named
            .get(name)
            .map_or(previous, |i| FilterInput::Result(*i))),
    }
}

/// Parses a numeric attribute that defaults to zero.
fn num_or_zero(attrs: &BTreeMap<String, String>, name: &str) -> Result<f64, SvgError> {
    attrs.get(name).map_or(Ok(0.0), |v| number(v, name))
}

/// Parses the `feMergeNode` children of an `feMerge` into its inputs.
fn merge_inputs(
    node: roxmltree::Node,
    named: &HashMap<String, usize>,
    previous: FilterInput,
) -> Result<Vec<FilterInput>, SvgError> {
    let mut inputs = Vec::new();
    for child in node.children().filter(|c| c.is_element()) {
        let tag = child.tag_name().name();
        if tag != "feMergeNode" {
            return err(format!("unsupported element <{tag}> inside <feMerge>"));
        }
        let attrs = attributes(child);
        check_attrs(tag, &attrs, &["in"])?;
        if child.children().any(|c| c.is_element()) {
            return err("<feMergeNode> may not have child elements");
        }
        inputs.push(input(attrs.get("in"), named, previous, tag)?);
    }
    Ok(inputs)
}

/// Parses one primitive element into its operation.
fn primitive_op(
    node: roxmltree::Node,
    tag: &str,
    attrs: &BTreeMap<String, String>,
    named: &HashMap<String, usize>,
    previous: FilterInput,
) -> Result<FilterOp, SvgError> {
    Ok(match tag {
        "feGaussianBlur" => {
            if let Some(mode) = attrs.get("edgeMode").map(|m| m.trim()) {
                if mode != "none" {
                    return err(format!(
                        "feGaussianBlur: edgeMode {mode:?} is not supported"
                    ));
                }
            }
            let (std_x, std_y) = std_deviation(attrs.get("stdDeviation"))?;
            FilterOp::Blur {
                input: input(attrs.get("in"), named, previous, tag)?,
                std_x,
                std_y,
            }
        }
        "feOffset" => FilterOp::Offset {
            input: input(attrs.get("in"), named, previous, tag)?,
            dx: num_or_zero(attrs, "dx")?,
            dy: num_or_zero(attrs, "dy")?,
        },
        "feFlood" => {
            let base = match attrs.get("flood-color") {
                Some(c) => parse_color(c)
                    .map_or_else(|| err(format!("flood-color: unsupported colour {c:?}")), Ok)?,
                None => Rgba::from_u8(0, 0, 0, 255),
            };
            let alpha = match attrs.get("flood-opacity") {
                Some(v) => opacity_value(v, "flood-opacity")?,
                None => 1.0,
            };
            FilterOp::Flood {
                color: base.with_alpha_scaled(alpha),
            }
        }
        "feComposite" => {
            let operator = match attrs.get("operator").map(|o| o.trim()).unwrap_or("over") {
                "over" => CompositeOperator::Over,
                "in" => CompositeOperator::In,
                "out" => CompositeOperator::Out,
                "atop" => CompositeOperator::Atop,
                "xor" => CompositeOperator::Xor,
                "arithmetic" => CompositeOperator::Arithmetic {
                    k1: num_or_zero(attrs, "k1")?,
                    k2: num_or_zero(attrs, "k2")?,
                    k3: num_or_zero(attrs, "k3")?,
                    k4: num_or_zero(attrs, "k4")?,
                },
                other => return err(format!("feComposite: unsupported operator {other:?}")),
            };
            FilterOp::Composite {
                input: input(attrs.get("in"), named, previous, tag)?,
                input2: input(attrs.get("in2"), named, previous, tag)?,
                operator,
            }
        }
        "feMerge" => FilterOp::Merge {
            inputs: merge_inputs(node, named, previous)?,
        },
        _ => return err(format!("unsupported filter primitive <{tag}>")),
    })
}

/// Parses a `<filter>` element.
pub fn parse_filter(node: roxmltree::Node) -> Result<Filter, SvgError> {
    let attrs = attributes(node);
    check_attrs("filter", &attrs, FILTER_ATTRS)?;
    let bbox_units = match attrs.get("filterUnits").map(|u| u.trim()) {
        None | Some("objectBoundingBox") => true,
        Some("userSpaceOnUse") => false,
        Some(other) => return err(format!("filterUnits: unsupported value {other:?}")),
    };
    match attrs.get("primitiveUnits").map(|u| u.trim()) {
        None | Some("userSpaceOnUse") => {}
        Some(other) => return err(format!("primitiveUnits {other:?} is not supported")),
    }
    let (dx, dy, dw, dh) = if bbox_units {
        (-0.1, -0.1, 1.2, 1.2)
    } else {
        // A user-space region with no geometry would be a percentage of the viewport, which is not supported.
        for name in ["x", "y", "width", "height"] {
            if !attrs.contains_key(name) {
                return err(format!(
                    "a userSpaceOnUse filter must give its {name} (the viewport-relative default is not supported)"
                ));
            }
        }
        (0.0, 0.0, 0.0, 0.0)
    };
    let region = FilterRegion {
        bbox_units,
        x: region_coord(&attrs, "x", dx, bbox_units)?,
        y: region_coord(&attrs, "y", dy, bbox_units)?,
        width: region_coord(&attrs, "width", dw, bbox_units)?,
        height: region_coord(&attrs, "height", dh, bbox_units)?,
    };
    let filter_space = match color_space(&attrs, "filter")? {
        Some(space) => space,
        None => inherited_space(node)?,
    };
    let mut primitives: Vec<FilterPrimitive> = Vec::new();
    let mut named: HashMap<String, usize> = HashMap::new();
    for child in node.children().filter(|c| c.is_element()) {
        let tag = child.tag_name().name();
        if matches!(tag, "title" | "desc" | "metadata") {
            continue;
        }
        let Some(allowed) = primitive_attrs(tag) else {
            return err(format!("unsupported filter primitive <{tag}>"));
        };
        let child_attrs = attributes(child);
        let mut all: Vec<&str> = allowed.to_vec();
        all.extend(["result", "color-interpolation-filters"]);
        check_attrs(tag, &child_attrs, &all)?;
        if tag != "feMerge" && child.children().any(|c| c.is_element()) {
            return err(format!("<{tag}> may not have child elements"));
        }
        let previous = primitives
            .len()
            .checked_sub(1)
            .map_or(FilterInput::SourceGraphic, FilterInput::Result);
        let op = primitive_op(child, tag, &child_attrs, &named, previous)?;
        let space = color_space(&child_attrs, tag)?.unwrap_or(filter_space);
        if let Some(name) = child_attrs
            .get("result")
            .map(|r| r.trim())
            .filter(|r| !r.is_empty())
        {
            named.insert(name.to_string(), primitives.len());
        }
        primitives.push(FilterPrimitive { op, space });
    }
    Ok(Filter { region, primitives })
}
