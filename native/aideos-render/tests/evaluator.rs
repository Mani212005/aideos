//! File Description: Behavioural tests of the frame evaluator through its public API. Reference values marked "from TypeScript" were produced by running the project's own implementations (applySvgEasing, compileCameraTrack, buildCaptionPhrases, Remotion's spring) on the same inputs, so these tests hold the native evaluator to the curves the Remotion render uses today.
//! Inputs and outputs: keyframes, element tracks, caption words and the fixture IR -> asserted evaluated values.
//! Used by: `cargo test --manifest-path native/Cargo.toml`.

mod common;

use aideos_render::eval::captions::{build_phrases, caption_frame, WordRole};
use aideos_render::eval::spring::spring;
use aideos_render::eval::track::{apply_ease, sample};
use aideos_render::eval::{self, Format};
use aideos_render_ir::types::{CaptionSpan, CaptionWord, Chapter, Ease, Keyframe, Whole};

/// Builds a keyframe.
fn kf(frame: u32, value: f64, ease: Option<Ease>) -> Keyframe {
    Keyframe {
        frame: Whole(frame),
        value,
        ease,
    }
}

/// Asserts two floats agree to `tol`.
fn assert_near(actual: f64, expected: f64, tol: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= tol,
        "{what}: got {actual}, expected {expected}"
    );
}

/// Checks that easing curves match the typescript scene engine.
#[test]
fn easing_curves_match_the_typescript_scene_engine() {
    // From TypeScript: applySvgEasing(ease, t) at t = 0.1, 0.25, 0.5, 0.75, 0.9.
    let cases: [(Ease, [f64; 5]); 4] = [
        (
            Ease::ExpoOut,
            [
                0.4943906171359601,
                0.8256223011584942,
                0.9717791052647867,
                0.997677068084037,
                0.9998783478325355,
            ],
        ),
        (
            Ease::ExpoIn,
            [
                0.0001216521674644575,
                0.0023229319159630427,
                0.02822089473521321,
                0.17437769884150603,
                0.5056093828640399,
            ],
        ),
        (
            Ease::ExpoInOut,
            [
                0.004999522821689588,
                0.04005886880279535,
                0.5,
                0.9599411311972047,
                0.9950004771783103,
            ],
        ),
        (Ease::Hold, [0.0, 0.0, 0.0, 0.0, 0.0]),
    ];
    for (ease, expected) in cases {
        for (t, e) in [0.1, 0.25, 0.5, 0.75, 0.9].iter().zip(expected) {
            assert_near(apply_ease(ease, *t), e, 1e-12, &format!("{ease:?} at {t}"));
        }
    }
}

/// Checks that a track holds its ends and eases each segment by its first keyframe.
#[test]
fn a_track_holds_its_ends_and_eases_each_segment_by_its_first_keyframe() {
    let track = [
        kf(10, 2.0, Some(Ease::Linear)),
        kf(20, 4.0, Some(Ease::Hold)),
        kf(30, 10.0, None),
    ];
    assert_eq!(
        sample(&track, 0, 100),
        2.0,
        "before the first keyframe the first value holds"
    );
    assert_eq!(sample(&track, 15, 100), 3.0, "linear midpoint");
    assert_eq!(
        sample(&track, 29, 100),
        4.0,
        "a hold segment keeps its start value until the next keyframe"
    );
    assert_eq!(sample(&track, 30, 100), 10.0);
    assert_eq!(
        sample(&track, 99, 100),
        10.0,
        "after the last keyframe the last value holds"
    );
    assert_eq!(
        sample(&[kf(40, 7.5, None)], 3, 100),
        7.5,
        "one keyframe is a constant"
    );
}

/// Checks that the camera spline matches compile camera track.
#[test]
fn the_camera_spline_matches_compile_camera_track() {
    // From TypeScript: compileCameraTrack over 100 frames with keyframes
    // 0 (960,960,z1), 45 (700,960,z1.6), 60 (600,900,z1.6), 80 (600,900,z1.2, expoOut), 90 (500,900,z1.2).
    let s = Some(Ease::Spline);
    let cx = [
        kf(0, 960.0, s),
        kf(45, 700.0, s),
        kf(60, 600.0, s),
        kf(80, 600.0, Some(Ease::ExpoOut)),
        kf(90, 500.0, None),
    ];
    let cy = [
        kf(0, 960.0, s),
        kf(45, 960.0, s),
        kf(60, 900.0, s),
        kf(80, 900.0, Some(Ease::ExpoOut)),
        kf(90, 900.0, None),
    ];
    let zoom = [
        kf(0, 1.0, s),
        kf(45, 1.6, s),
        kf(60, 1.6, s),
        kf(80, 1.2, Some(Ease::ExpoOut)),
        kf(90, 1.2, None),
    ];
    let expected: [(u32, f64, f64, f64); 11] = [
        (0, 960.0, 960.0, 1.0),
        (10, 938.016427851323, 960.0, 1.0757201646090535),
        (30, 809.1744756804998, 960.0, 1.4444444444444444),
        (44, 706.3691857140496, 960.0, 1.599124279835391),
        (50, 660.1517179830432, 944.4444444444445, 1.6),
        (59, 600.8842481035252, 900.7644444444445, 1.6),
        (62, 600.0, 900.0, 1.5888000000000002),
        (70, 600.0, 900.0, 1.4),
        (85, 502.8220894735213, 900.0, 1.2),
        (95, 500.0, 900.0, 1.2),
        (99, 500.0, 900.0, 1.2),
    ];
    for (f, ex, ey, ez) in expected {
        assert_near(sample(&cx, f, 100), ex, 1e-9, &format!("centerX at {f}"));
        assert_near(sample(&cy, f, 100), ey, 1e-9, &format!("centerY at {f}"));
        assert_near(sample(&zoom, f, 100), ez, 1e-9, &format!("zoom at {f}"));
    }
}

/// Checks that the caption spring matches remotion.
#[test]
fn the_caption_spring_matches_remotion() {
    // From TypeScript: remotion spring({ frame, fps: 30, config: { damping: 14, stiffness: 260 } }).
    let expected = [
        (0.0, 0.0),
        (1.0, 0.1214995239918969),
        (2.0, 0.3956739477803446),
        (3.0, 0.7037997725369703),
        (5.0, 1.1349669361870496),
        (8.0, 1.1648338971980465),
        (12.0, 0.9592083199314329),
        (20.0, 1.0102507478427571),
    ];
    for (f, e) in expected {
        assert_near(
            spring(f, 30.0, 14.0, 260.0),
            e,
            1e-9,
            &format!("spring at frame {f}"),
        );
    }
}

/// The caption words both phrase tests split.
fn caption_words() -> Vec<CaptionWord> {
    [
        ("Tokens", 0, 10),
        ("go", 10, 16),
        ("in,", 16, 24),
        ("tokens", 30, 40),
        ("come", 40, 48),
        ("out.", 48, 60),
        ("Then", 80, 86),
        ("a", 86, 88),
        ("very", 88, 94),
        ("long", 94, 100),
        ("run", 100, 104),
        ("of", 104, 106),
        ("words", 106, 112),
        ("keeps", 112, 118),
        ("going", 118, 124),
    ]
    .into_iter()
    .map(|(text, s, e)| CaptionWord {
        text: text.into(),
        start_frame: Whole(s),
        end_frame: Whole(e),
    })
    .collect()
}

/// Phrases as (start index, end index, start frame, end frame, line breaks).
fn phrase_tuples(w: Option<f64>) -> Vec<(usize, usize, u32, u32, Vec<usize>)> {
    let spans = [CaptionSpan {
        from_frame: Whole(0),
        x: 0.5,
        y: 0.78,
        w,
    }];
    let measure = |t: &str| t.chars().count() as f64 * 18.0;
    build_phrases(&caption_words(), &spans, 30, 1920.0, &measure)
        .into_iter()
        .map(|p| {
            (
                p.start_index,
                p.end_index,
                p.start_frame,
                p.end_frame,
                p.line_breaks,
            )
        })
        .collect()
}

/// Checks that caption phrases split like build caption phrases.
#[test]
fn caption_phrases_split_like_build_caption_phrases() {
    // From TypeScript: buildCaptionPhrases with measure = 18 px per character, 1920 wide, 30 fps.
    assert_eq!(
        phrase_tuples(None),
        vec![(0, 2, 0, 32, vec![]), (3, 5, 30, 68, vec![]), (6, 12, 80, 120, vec![]), (13, 14, 112, 132, vec![])],
        "the default card breaks on punctuation, pauses and seven words, and does not trim overlaps"
    );
    assert_eq!(
        phrase_tuples(Some(0.12)),
        vec![
            (0, 2, 0, 29, vec![2]),
            (3, 5, 30, 68, vec![1]),
            (6, 9, 80, 99, vec![2]),
            (10, 12, 100, 111, vec![2]),
            (13, 14, 112, 132, vec![1]),
        ],
        "an owner-width card keeps to two rows and ends each phrase before the next starts"
    );
}

/// Checks that a caption frame highlights the spoken word and fades the phrase.
#[test]
fn a_caption_frame_highlights_the_spoken_word_and_fades_the_phrase() {
    let words = caption_words();
    let spans = [CaptionSpan {
        from_frame: Whole(0),
        x: 0.5,
        y: 0.78,
        w: None,
    }];
    let phrases = build_phrases(&words, &spans, 30, 1920.0, &|t: &str| t.len() as f64 * 18.0);
    let at = |f: u32| caption_frame(&words, &phrases, 30, f).expect("a phrase shows");
    let f12 = at(12);
    assert_eq!(f12.phrase_index, 0);
    assert_eq!(f12.opacity, 1.0);
    let roles: Vec<WordRole> = f12.words.iter().map(|w| w.role).collect();
    assert_eq!(
        roles,
        vec![WordRole::Past, WordRole::Active, WordRole::Future]
    );
    assert_near(
        f12.words[1].scale,
        1.12 - 0.12 * spring(2.0, 30.0, 14.0, 260.0),
        1e-12,
        "active word scale",
    );
    assert_eq!(at(0).opacity, 0.0, "a phrase fades in from its first frame");
    assert!(
        caption_frame(&words, &phrases, 30, 70).is_none(),
        "nothing shows between phrases"
    );
}

/// Checks that element states follow their tracks.
#[test]
fn element_states_follow_their_tracks() {
    let ir = common::tiny_scene();
    let aideos_render_ir::types::Node::Svg(node) = &ir.stage[0] else {
        panic!("the fixture stage starts with an svg node")
    };
    let dur = ir.film.duration_frames.0;
    let s = eval::element_states(node, 30, dur);
    assert_eq!(
        s["node-b"].scale_x, s["node-b"].scale_y,
        "uniform scale drives both axes"
    );
    assert_eq!(
        (s["node-b"].origin_x, s["node-b"].origin_y),
        (80.0, 0.0),
        "the track origin is carried"
    );
    let raw = apply_ease(Ease::ExpoOut, 10.0 / 24.0);
    assert_eq!(
        s["edge-ab"].draw_on,
        (raw * 1e4).round() / 1e4,
        "values are quantized to 4 decimals like the scene compiler"
    );
    assert_ne!(s["edge-ab"].draw_on, raw);
    assert_eq!(
        s["node-a"].opacity, None,
        "an element whose opacity no track drives keeps its authored opacity"
    );
    assert_eq!(
        eval::element_states(node, 0, dur)["orbit-ring"].opacity,
        Some(0.4)
    );
    assert_eq!(
        eval::element_states(node, 0, dur)["node-a"].translate_x,
        0.0,
        "before its clip the start value holds"
    );
}

/// Checks that the camera projection and cover fit follow projection ts.
#[test]
fn the_camera_projection_and_cover_fit_follow_projection_ts() {
    let ir = common::tiny_scene();
    let pose = eval::camera(&ir, 0);
    assert_eq!(
        (pose.center_x, pose.center_y, pose.zoom, pose.rotation),
        (960.0, 960.0, 1.0, 0.0)
    );
    assert_eq!(eval::cover_fit(&ir, 1920, 1080), 1.0);
    assert_eq!(eval::cover_fit(&ir, 1080, 1920), 1.0);
    assert_eq!(
        eval::project(&ir, &pose, 1920, 1080, 960.0, 960.0),
        (960.0, 540.0),
        "the camera centre lands mid-frame"
    );
    let late = eval::camera(&ir, 90 - 1);
    let (x, _) = eval::project(&ir, &late, 1920, 1080, 960.0, 960.0);
    assert_near(x, 960.0 + (960.0 - 700.0) * 1.6, 1e-9, "zoomed and panned");
}

/// Checks that the rail and end card states follow the frame.
#[test]
fn the_rail_and_end_card_states_follow_the_frame() {
    let chapters = vec![
        Chapter {
            title: "Intro".into(),
            start_frame: Whole(0),
            end_frame: Whole(45),
        },
        Chapter {
            title: "Payoff".into(),
            start_frame: Whole(45),
            end_frame: Whole(90),
        },
    ];
    let r = eval::rail_state(&chapters, 30, 60);
    assert_eq!(
        (r.chapter_index, r.label.as_str(), r.stamp.as_str()),
        (1, "CHAPTER 02: PAYOFF", "00:02")
    );
    assert_near(r.progress, 60.0 / 90.0, 1e-12, "progress");

    let before = eval::end_card_state(66, 80, 30, 66);
    assert_eq!(
        (before.dim, before.panel.opacity, before.press),
        (0.0, 0.0, 0.0)
    );
    let pressed = eval::end_card_state(66, 80, 30, 82);
    assert!(
        pressed.press > 0.9,
        "the pill is near the bottom of its press 2 frames in: {}",
        pressed.press
    );
    let settled = eval::end_card_state(66, 80, 30, 120);
    assert_near(settled.dim, 1.0, 1e-3, "dim settled");
    assert_eq!(settled.press, 0.0, "the press has released");
    assert!(settled.handle.opacity > 0.999 && settled.handle.rise < 0.01);
}

/// Checks that formats parse by their wire names.
#[test]
fn formats_parse_by_their_wire_names() {
    assert_eq!(Format::parse("long"), Some(Format::Long));
    assert_eq!(Format::parse("reel"), Some(Format::Reel));
    assert_eq!(Format::parse("wide"), None);
}
