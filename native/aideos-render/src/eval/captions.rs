//! File Description: Kinetic caption evaluation, ported from src/dl/captionPhrases.ts and src/dl/KineticSubtitles.tsx: splits the spoken words into phrases of at most seven words (breaking on punctuation, pauses and, for a fixed-width card, the two-row limit), fixes each phrase's placement at its first word, and at a frame resolves the visible phrase, its fade, and each word's role and spring scale. Text width comes from a caller-supplied measure function, so this module stays free of Skia.
//! Inputs and outputs: caption words, placement spans, fps, frame width and a word measure -> phrases; phrases and a frame -> `CaptionFrame`.
//! Used by: crate::raster::captions (layout and drawing) and tests/evaluator.rs.

use aideos_render_ir::types::{CaptionSpan, CaptionWord};

use super::spring::spring;

/// Width of a caption card with no owner-chosen width, as a fraction of the frame (captionPlacement.ts).
pub const DEFAULT_CARD_WIDTH: f64 = 0.86;
/// Horizontal margin of one word span (6 px each side), added to its measured width for row fitting.
pub const WORD_MARGIN_X: f64 = 12.0;
/// The card's horizontal padding and border, subtracted from its width to get the text width.
pub const CARD_INNER_INSET: f64 = 58.0;

/// The card a placement span asks for: its width in pixels, whether that width is fixed, and the width text may use.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CardWidth {
    pub width: f64,
    pub fixed: bool,
    pub inner_width: f64,
}

/// Resolves a span's card width in a frame of the given width (`resolveCaptionCardWidth`).
pub fn card_width(span: &CaptionSpan, frame_width: f64) -> CardWidth {
    let width = span.w.unwrap_or(DEFAULT_CARD_WIDTH) * frame_width;
    let fixed = span.w.is_some();
    CardWidth {
        width,
        fixed,
        inner_width: (if fixed { width } else { width * 0.92 }) - CARD_INNER_INSET,
    }
}

/// The placement span in force at a frame: the last one starting at or before it, else the first.
pub fn span_at(spans: &[CaptionSpan], frame: u32) -> usize {
    spans
        .iter()
        .rposition(|s| s.from_frame.0 <= frame)
        .unwrap_or(0)
}

/// How one word fits a row: its row width, and a maximum width when it has to wrap inside the row.
fn fit_word(text: &str, inner: f64, measure: &dyn Fn(&str) -> f64) -> (f64, Option<f64>) {
    let measured = measure(text) + WORD_MARGIN_X;
    if measured <= inner {
        (measured, None)
    } else {
        (inner, Some((inner - WORD_MARGIN_X).max(0.0)))
    }
}

/// Word indices (within `words`) that start a new row when the words are laid greedily into `inner` pixels.
pub fn word_rows(words: &[CaptionWord], inner: f64, measure: &dyn Fn(&str) -> f64) -> Vec<usize> {
    let mut breaks = Vec::new();
    let mut used = 0.0;
    for (i, word) in words.iter().enumerate() {
        let (size, _) = fit_word(&word.text, inner, measure);
        if used > 0.0 && used + size > inner {
            breaks.push(i);
            used = 0.0;
        }
        used += size;
    }
    breaks
}

/// One displayed phrase of the captions.
#[derive(Debug, Clone, PartialEq)]
pub struct Phrase {
    /// Index of the phrase's first and last word in the caption node's words.
    pub start_index: usize,
    pub end_index: usize,
    /// First and last frame the phrase is shown (inclusive).
    pub start_frame: u32,
    pub end_frame: u32,
    /// The placement span fixed at the phrase's first word.
    pub span_index: usize,
    /// Word indices relative to the phrase that start a second row; only for a fixed-width card.
    pub line_breaks: Vec<usize>,
}

/// Splits caption words into phrases exactly as `buildCaptionPhrases` does.
/// A phrase's end is trimmed to the next phrase's start when either card has an owner-chosen width.
pub fn build_phrases(
    words: &[CaptionWord],
    spans: &[CaptionSpan],
    fps: u32,
    frame_width: f64,
    measure: &dyn Fn(&str) -> f64,
) -> Vec<Phrase> {
    let fps_f = f64::from(fps);
    let mut phrases: Vec<Phrase> = Vec::new();
    let mut start = 0;
    while start < words.len() {
        let span_index = span_at(spans, words[start].start_frame.0);
        let card = card_width(&spans[span_index], frame_width);
        let inner = card.inner_width;
        let mut end = start;
        while end + 1 < words.len() && end - start < 6 {
            let word = &words[end];
            let next = &words[end + 1];
            if card.fixed
                && (fit_word(&word.text, inner, measure).1.is_some()
                    || fit_word(&next.text, inner, measure).1.is_some())
            {
                break;
            }
            let ends_clause = word.text.ends_with(['.', ',', '!', '?', ';', ':']);
            let pause = f64::from(next.start_frame.0) - f64::from(word.end_frame.0) > fps_f * 0.4;
            if ends_clause || pause {
                break;
            }
            // More than one row break would need a third row.
            if card.fixed && word_rows(&words[start..end + 2], inner, measure).len() > 1 {
                break;
            }
            end += 1;
        }
        let chunk = &words[start..=end];
        phrases.push(Phrase {
            start_index: start,
            end_index: end,
            start_frame: chunk[0].start_frame.0,
            end_frame: chunk[chunk.len() - 1].end_frame.0 + (fps_f * 0.25).round() as u32,
            span_index,
            line_breaks: if card.fixed {
                word_rows(chunk, inner, measure)
            } else {
                Vec::new()
            },
        });
        start = end + 1;
    }
    for i in 0..phrases.len().saturating_sub(1) {
        let owner_chosen = spans[phrases[i].span_index].w.is_some()
            || spans[phrases[i + 1].span_index].w.is_some();
        if owner_chosen {
            let next_start = phrases[i + 1].start_frame.saturating_sub(1);
            phrases[i].end_frame = phrases[i].end_frame.min(next_start);
        }
    }
    phrases
}

/// How a word is drawn at a frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WordRole {
    /// Being spoken: the highlight colour, a glow, and the spring settle.
    Active,
    /// Already spoken: the primary colour.
    Past,
    /// Not yet spoken: dimmed.
    Future,
}

/// One word of the visible phrase at a frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WordFrame {
    pub index: usize,
    pub role: WordRole,
    /// 1.12 when the word becomes active, springing back to 1.
    pub scale: f64,
}

/// The captions at one frame: which phrase shows, how faded it is and how each of its words is drawn.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptionFrame {
    pub phrase_index: usize,
    pub opacity: f64,
    pub words: Vec<WordFrame>,
}

/// Linear ramp of `frame` from `a` to `b`, clamped to [0, 1].
fn ramp(frame: f64, a: f64, b: f64) -> f64 {
    if b <= a {
        return if frame >= b { 1.0 } else { 0.0 };
    }
    ((frame - a) / (b - a)).clamp(0.0, 1.0)
}

/// Resolves the visible phrase and its words at a frame, or None between phrases.
pub fn caption_frame(
    words: &[CaptionWord],
    phrases: &[Phrase],
    fps: u32,
    frame: u32,
) -> Option<CaptionFrame> {
    let phrase_index = phrases
        .iter()
        .position(|p| frame >= p.start_frame && frame <= p.end_frame)?;
    let phrase = &phrases[phrase_index];
    let mut active = words
        .iter()
        .position(|w| frame >= w.start_frame.0 && frame <= w.end_frame.0);
    if active.is_none() {
        // Between words inside the phrase, the word spoken last stays highlighted.
        active = (phrase.start_index..=phrase.end_index)
            .rev()
            .find(|&i| frame >= words[i].start_frame.0);
    }
    let fps_f = f64::from(fps);
    let fade = 0.133 * fps_f;
    let f = f64::from(frame);
    let (start, end) = (f64::from(phrase.start_frame), f64::from(phrase.end_frame));
    let opacity = ramp(f, start, start + fade) * (1.0 - ramp(f, end - fade, end));
    let words_out = (phrase.start_index..=phrase.end_index)
        .map(|index| {
            let role = match active {
                Some(a) if a == index => WordRole::Active,
                Some(a) if index < a => WordRole::Past,
                _ => WordRole::Future,
            };
            let scale = if role == WordRole::Active {
                let s = spring(
                    f64::from(frame.saturating_sub(words[index].start_frame.0)),
                    fps_f,
                    14.0,
                    260.0,
                );
                1.12 + (1.0 - 1.12) * s
            } else {
                1.0
            };
            WordFrame { index, role, scale }
        })
        .collect();
    Some(CaptionFrame {
        phrase_index,
        opacity,
        words: words_out,
    })
}
