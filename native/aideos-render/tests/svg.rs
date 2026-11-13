//! File Description: Behavioral coverage of SVG parsing through its public API, including definition inheritance, hidden clip geometry and explicit refusal of unsupported rendering declarations.
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
