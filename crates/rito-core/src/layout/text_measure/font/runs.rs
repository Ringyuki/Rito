use unicode_segmentation::UnicodeSegmentation;

use super::shaping::{face_supports_character, TextMeasurementFontFace};

pub(in super::super) enum FontMeasurementRun<'a> {
    Shaped {
        text: &'a str,
        face: &'a TextMeasurementFontFace<'a>,
    },
    Fallback(&'a str),
}

pub(in super::super) fn font_runs<'a>(
    text: &'a str,
    faces: &[&'a TextMeasurementFontFace<'a>],
) -> Vec<FontMeasurementRun<'a>> {
    let mut runs = Vec::new();
    let mut active_face: Option<&TextMeasurementFontFace<'_>> = None;
    let mut active_start: Option<usize> = None;
    for (index, grapheme) in text.grapheme_indices(true) {
        let face = faces
            .iter()
            .copied()
            .find(|face| face_supports_grapheme(face, grapheme));
        if face.is_some_and(|face| {
            active_face.is_some_and(|active_face| std::ptr::eq(face, active_face))
        }) {
            continue;
        }
        if let (Some(start), Some(face)) = (active_start.take(), active_face.take()) {
            runs.push(FontMeasurementRun::Shaped {
                text: &text[start..index],
                face,
            });
        }
        if let Some(face) = face {
            active_start = Some(index);
            active_face = Some(face);
        } else {
            runs.push(FontMeasurementRun::Fallback(grapheme));
        }
    }
    if let (Some(start), Some(face)) = (active_start, active_face) {
        runs.push(FontMeasurementRun::Shaped {
            text: &text[start..],
            face,
        });
    }
    runs
}

fn face_supports_grapheme(face: &TextMeasurementFontFace<'_>, grapheme: &str) -> bool {
    let mut has_required_glyph = false;
    for character in grapheme.chars() {
        if is_grapheme_control(character) {
            continue;
        }
        has_required_glyph = true;
        if !face_supports_character(face, character) {
            return false;
        }
    }
    has_required_glyph
}

fn is_grapheme_control(character: char) -> bool {
    matches!(
        character,
        '\u{200c}' | '\u{200d}' | '\u{fe00}'..='\u{fe0f}' | '\u{e0100}'..='\u{e01ef}'
    )
}
