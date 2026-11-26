//! File Description: Behavioral coverage of SVG parsing through its public API, including definition inheritance, hidden clip geometry, the filter subset's input and colour-space rules, and explicit refusal of unsupported rendering declarations and filter features.
//! Inputs and outputs: SVG documents -> parsed public SVG models or named parse errors.
//! Used by: `cargo test --manifest-path native/Cargo.toml`.

use aideos_render::svg::{parse, GradientGeometry, Spread};

/// Resolves supported gradient properties through multiple href links and refuses broken chains.
#[test]
fn gradient_href_inherits_supported_properties_and_rejects_bad_chains() {
    let doc = parse(
        r##"<svg xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="base" x1="10%" y1="20%" x2="80%" y2="90%" gradientUnits="objectBoundingBox" gradientTransform="translate(3 4)" spreadMethod="reflect">
              <stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/>
            </linearGradient>
            <linearGradient id="middle" href="#base" gradientTransform="rotate(15)"/>
            <linearGradient id="derived" href="#middle" x2="60%"/>
          </defs>
          <rect width="100" height="100" fill="url(#derived)"/>
        </svg>"##,
    )
    .expect("gradient references resolve");
    let gradient = &doc.gradients["derived"];
    assert!(gradient.bbox_units);
    assert_eq!(gradient.spread, Spread::Reflect);
    assert_eq!(gradient.stops.len(), 2);
    assert_eq!(gradient.transform, doc.gradients["middle"].transform);
    assert_eq!(
        gradient.geometry,
        GradientGeometry::Linear {
            x1: 0.1,
            y1: 0.2,
            x2: 0.6,
            y2: 0.9,
        }
    );
    let transformed = parse(
        r##"<svg><defs><linearGradient id="base" x1="10" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse"><stop stop-color="#ff0000"/></linearGradient><linearGradient id="derived" href="#base"/></defs><rect width="10" height="10" fill="url(#derived)"/></svg>"##,
    )
    .expect("user-space geometry resolves");
    assert!(!transformed.gradients["derived"].bbox_units);
    for source in [
        r##"<svg><defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs></svg>"##,
        r##"<svg><defs><linearGradient id="a" href="#missing"/></defs></svg>"##,
    ] {
        assert!(
            parse(source).is_err(),
            "invalid gradient chain was accepted"
        );
    }
}

/// Omits clip geometry hidden by display or visibility while retaining visible shapes.
#[test]
fn clip_paths_exclude_non_rendered_children() {
    let doc = parse(
        r##"<svg><defs><clipPath id="clip"><rect x="-100" y="-100" width="400" height="400" display="none"/><rect x="-50" y="-50" width="300" height="300" visibility="hidden"/><rect x="10" y="20" width="30" height="40"/></clipPath></defs><rect width="100" height="100" clip-path="url(#clip)"/></svg>"##,
    )
    .expect("clipPath parses");
    let bounds = doc.clip_paths["clip"].bounds();
    assert_eq!(
        (bounds.left, bounds.top, bounds.right, bounds.bottom),
        (10.0, 20.0, 40.0, 60.0)
    );
    let ordinary = parse(r##"<svg><rect width="10" height="10" clip-rule="evenodd"/></svg>"##)
        .expect("clip-rule remains accepted on ordinary shapes");
    assert_eq!(ordinary.elements[0].style.clip_rule_even_odd, Some(true));
}

/// Names unsupported rendering declarations while permitting inert root and metadata attributes.
#[test]
fn unsupported_rendering_attributes_and_styles_are_refused() {
    for (source, unsupported) in [
        (
            r##"<svg><rect width="10" height="10" vector-effect="non-scaling-stroke"/></svg>"##,
            "vector-effect",
        ),
        (
            r##"<svg><rect width="10" height="10" style="paint-order: stroke; fill: red"/></svg>"##,
            "paint-order",
        ),
        (
            r##"<svg><text font-style="italic">text</text></svg>"##,
            "font-style",
        ),
    ] {
        let error = parse(source).expect_err("unsupported rendering declaration was accepted");
        assert!(error.to_string().contains(unsupported), "{error}");
    }
    parse(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="none" id="root" class="asset" data-note="x" aria-label="art"><rect width="10" height="10" id="shape"/></svg>"##)
        .expect("inert attributes remain accepted");
}

/// Resolves filter inputs as Filter Effects 1 does: `in` defaults to the previous result (SourceGraphic first), a name no
/// earlier primitive gives counts as no name, and `color-interpolation-filters` is linearRGB unless the filter, an
/// ancestor of it or the primitive itself says otherwise; ids inside a filter are element ids of the asset.
#[test]
fn filter_inputs_and_colour_spaces_follow_the_filter_effects_rules() {
    use aideos_render::svg::filter::{ColorSpace, CompositeOperator, FilterInput, FilterOp};
    let doc = parse(
        r##"<svg><defs color-interpolation-filters="sRGB">
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="linearRGB">
            <feGaussianBlur id="first-blur" stdDeviation="4" result="blur1"/>
            <feGaussianBlur stdDeviation="8 2" result="blur2"/>
            <feMerge><feMergeNode in="blur2"/><feMergeNode in="blur1"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="shadow">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
            <feOffset dy="2" in="no-such-result" result="off" color-interpolation-filters="linearRGB"/>
            <feFlood flood-color="#102030" flood-opacity="0.5"/>
            <feComposite in2="off" operator="in"/>
          </filter>
        </defs><path d="M0 0 L10 10" stroke="red" filter="url(#glow)"/><rect width="4" height="4" filter="url(#shadow)"/></svg>"##,
    )
    .expect("the glow and shadow filters parse");
    let glow = &doc.filters["glow"];
    assert!(glow.region.bbox_units);
    assert_eq!((glow.region.x, glow.region.width), (-0.3, 1.6));
    assert!(glow
        .primitives
        .iter()
        .all(|p| p.space == ColorSpace::LinearRgb));
    assert_eq!(
        glow.primitives[1].op,
        FilterOp::Blur {
            input: FilterInput::Result(0),
            std_x: 8.0,
            std_y: 2.0
        }
    );
    assert_eq!(
        glow.primitives[2].op,
        FilterOp::Merge {
            inputs: vec![
                FilterInput::Result(1),
                FilterInput::Result(0),
                FilterInput::SourceGraphic
            ]
        }
    );
    let shadow = &doc.filters["shadow"];
    assert!(
        shadow.region.bbox_units,
        "the default region is in bounding-box units"
    );
    assert_eq!(
        (
            shadow.region.x,
            shadow.region.y,
            shadow.region.width,
            shadow.region.height
        ),
        (-0.1, -0.1, 1.2, 1.2)
    );
    assert_eq!(
        shadow.primitives[0].space,
        ColorSpace::Srgb,
        "inherited from <defs>"
    );
    assert_eq!(
        shadow.primitives[1].space,
        ColorSpace::LinearRgb,
        "the primitive's own value wins"
    );
    assert_eq!(
        shadow.primitives[1].op,
        FilterOp::Offset {
            input: FilterInput::Result(0),
            dx: 0.0,
            dy: 2.0
        },
        "an unknown result name reads the previous result"
    );
    let FilterOp::Flood { color } = shadow.primitives[2].op else {
        panic!("feFlood")
    };
    assert_eq!((color.a, color.r), (0.5, 16.0 / 255.0));
    assert_eq!(
        shadow.primitives[3].op,
        FilterOp::Composite {
            input: FilterInput::Result(2),
            input2: FilterInput::Result(1),
            operator: CompositeOperator::In
        }
    );
    assert_eq!(doc.elements[0].filter.as_deref(), Some("glow"));
    assert!(
        doc.ids.contains("first-blur"),
        "a primitive's id is an element id of the asset, as the emitter lists it"
    );
}

/// Names every filter feature outside the drawn subset instead of drawing a filter partly.
#[test]
fn unsupported_filter_features_are_refused_by_name() {
    for (source, named) in [
        (
            r##"<svg><filter id="f"><feColorMatrix values="0"/></filter></svg>"##,
            "feColorMatrix",
        ),
        (
            r##"<svg><filter id="f"><feGaussianBlur x="0" stdDeviation="2"/></filter></svg>"##,
            "\"x\"",
        ),
        (
            r##"<svg><filter id="f" primitiveUnits="objectBoundingBox"><feOffset dx="1"/></filter></svg>"##,
            "primitiveUnits",
        ),
        (
            r##"<svg><filter id="f"><feGaussianBlur in="BackgroundImage" stdDeviation="2"/></filter></svg>"##,
            "BackgroundImage",
        ),
        (
            r##"<svg><filter id="f"><feGaussianBlur edgeMode="duplicate" stdDeviation="2"/></filter></svg>"##,
            "edgeMode",
        ),
        (
            r##"<svg><filter id="f"><feGaussianBlur stdDeviation="-2"/></filter></svg>"##,
            "negative",
        ),
        (
            r##"<svg><filter id="f"><feComposite operator="lighter"/></filter></svg>"##,
            "lighter",
        ),
        (
            r##"<svg><filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="10"><feOffset/></filter></svg>"##,
            "height",
        ),
        (
            r##"<svg><filter id="f" href="#g"><feOffset/></filter></svg>"##,
            "href",
        ),
        (
            r##"<svg><rect width="4" height="4" filter="blur(4px)"/></svg>"##,
            "blur(4px)",
        ),
        (
            r##"<svg><rect width="4" height="4" filter="url(#missing)"/></svg>"##,
            "missing",
        ),
        (
            r##"<svg><filter id="f"><feOffset/></filter><g filter="url(#f)"><text>hi</text></g></svg>"##,
            "objectBoundingBox filter on text",
        ),
    ] {
        let error = parse(source).expect_err("an unsupported filter feature was accepted");
        assert!(error.to_string().contains(named), "{source}: {error}");
    }
    parse(r##"<svg><filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="40"><feOffset dx="2"/></filter><text filter="url(#f)">hi</text></svg>"##)
        .expect("a user-space filter on text has a region without the text's box");
}
