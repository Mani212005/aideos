//! File Description: Behavioural tests of the 2D text parity with Chrome: a caption word that springs out past its box is not clipped to the card's content box (the cut-off full stop), a caption phrase that wraps keeps its card at the capped width (the narrow reel card), and text is drawn without hinting so a 45 px Geist capital is 32 px tall as it is in Chrome (hinting snaps it to 33).
//! Inputs and outputs: the fixture IR with its caption words, highlight colour and title text replaced -> rendered frames and the pixels measured in them.
//! Used by: `cargo test --manifest-path native/Cargo.toml`; added at the captain's request for the 2D text parity follow-up (aideos-native-2d-text-parity).

mod common;

use aideos_render::{Format, RenderedFrame, Renderer};
use aideos_render_ir::types::{CaptionWord, Node, RenderIr};
use common::pixel;

/// Replaces the fixture captions' words (text, first frame, last frame) and highlight colour.
fn with_caption_words(words: &[(&str, u32, u32)], highlight: &str) -> RenderIr {
    let mut ir = common::tiny_scene();
    for node in &mut ir.overlay {
        if let Node::Captions(captions) = node {
            let template = captions.words[0].clone();
            captions.words = words
                .iter()
                .map(|(text, from, to)| {
                    let mut w: CaptionWord = template.clone();
                    w.text = (*text).into();
                    w.start_frame.0 = *from;
                    w.end_frame.0 = *to;
                    w
                })
                .collect();
            captions.highlight_color = highlight.into();
        }
    }
    ir
}

/// Renders one frame of an IR in the fixture package.
fn render(ir: RenderIr, format: Format, frame: u32) -> RenderedFrame {
    Renderer::new(ir, &common::package_dir())
        .expect("the IR loads")
        .render_frame(format, frame)
        .expect("the frame renders")
}

/// The first and last x in row `y` whose red channel is at least 20: the card's white 12% border (red 22 to 28) against the dark frame and the card.
fn card_edges(frame: &RenderedFrame, y: u32) -> (u32, u32) {
    let lit = |x: u32| pixel(frame, x, y)[0] >= 20;
    let left = (0..frame.width).find(|x| lit(*x)).expect("a card edge on the left");
    let right = (0..frame.width).rev().find(|x| lit(*x)).expect("a card edge on the right");
    (left, right)
}

/// A caption word that springs out of its box keeps its last glyph: nothing is clipped to the card's content box.
#[test]
fn a_sprung_caption_word_is_not_clipped_to_the_content_box() {
    // The last word is the active one at its first frame, where the spring scale is 1.12 about the word's centre, so its
    // full stop reaches past the 6 px word margin and the 28 px padding stays free for it. Red ink only comes from it.
    let frame = render(with_caption_words(&[("an", 0, 29), ("acknowledgment.", 30, 40)], "#FF0000"), Format::Reel, 30);
    let mid = (0.78 * 1920.0) as u32 + 50;
    let (_, card_right) = card_edges(&frame, mid);
    let content_right = card_right - 28;
    let ink_right = (mid - 40..mid + 40)
        .flat_map(|y| (0..frame.width).map(move |x| (x, y)))
        .filter(|(x, y)| {
            let p = pixel(&frame, *x, *y);
            p[0] >= 200 && p[1] <= 60 && p[2] <= 60
        })
        .map(|(x, _)| x)
        .max()
        .expect("the highlighted word is drawn");
    assert!(
        ink_right >= content_right + 2,
        "the last glyph ends at x={ink_right} but the content box ends at x={content_right}: it was clipped"
    );
}

/// A phrase that wraps onto two rows keeps the card at 92% of its placement width, as the shrink-to-fit box does in Chrome.
#[test]
fn a_wrapped_caption_card_keeps_the_capped_width() {
    let words = [("Authentication", 0, 8), ("acknowledgment", 9, 16), ("internationalization", 17, 24), ("receipts.", 25, 32)];
    let frame = render(with_caption_words(&words, "#FF0000"), Format::Reel, 28);
    let mid = (0.78 * 1920.0) as u32 + 82;
    let (left, right) = card_edges(&frame, mid);
    let width = right - left + 1;
    // 0.92 of the default 0.86 placement width of a 1080 px frame is 854.5 px; balanced rows alone would give about 530 px.
    assert!((853..=858).contains(&width), "the wrapped card is {width} px wide, expected the capped 854.5");
}

/// Text is drawn unhinted: a 45 px Geist capital H is 32 rows tall (cap height 0.71 em), not the 33 that slight hinting snaps it to.
#[test]
fn text_is_drawn_without_hinting() {
    let mut ir = common::tiny_scene();
    for node in &mut ir.overlay {
        let Node::Group(group) = node else { continue };
        for child in &mut group.children {
            if let Node::Text(text) = child {
                text.text = "H".into();
                text.placement.long.as_mut().expect("a long placement").font_size = 45.0;
            }
        }
    }
    let frame = render(ir, Format::Long, 30);
    // The first lit column of the title's left stem.
    let rows = |x: u32| (0..frame.height).filter(|y| pixel(&frame, x, *y)[0] >= 128 && *y > 150 && *y < 330).count();
    let stem_x = (160..260).find(|x| rows(*x) > 20).expect("the H stem is drawn");
    assert_eq!(rows(stem_x + 2), 32, "the capital H stem is {} rows tall", rows(stem_x + 2));
}
