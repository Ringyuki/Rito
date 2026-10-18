//! A double tap selects the word the browser selects: the caret nearest
//! the tap, and on a boundary between two words the word after it — except
//! at the end of a line that wraps inside its paragraph, where it is the
//! word before.

use super::{
    fixture::{fixture_epub_with_chapter_and_stylesheet, layout},
    pinned_font_policy_fixtures::{face, policy, serif_text_font},
    revisions::revision_by_id,
};
use crate::runtime::page_artifact::{PageArtifactTextPosition, PageArtifactTextRangeRect};
use crate::runtime::{
    RuntimeDocument, RuntimePinnedFontGenericRole, RuntimeRevisionHandle, RuntimeTextPointRequest,
    RuntimeTextRangeFromPointsRequest, RuntimeTextRangeFromPointsResolution,
    RuntimeTextSelectionGranularity,
};

fn open(body: &str) -> (RuntimeDocument, RuntimeRevisionHandle) {
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>{body}</body></html>"#
    );
    let epub = fixture_epub_with_chapter_and_stylesheet(chapter.as_bytes(), "p { margin: 0; }\n");
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("fixture opens");
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle::from(&summary);
    (document, handle)
}

/// The rect of the `length` UTF-16 units from the first `word` on page 0.
fn word_rect(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
    word: &str,
    length: usize,
) -> PageArtifactTextRangeRect {
    let session = revision_by_id(document, &handle.revision_id).chapter_engine_session();
    let page = session.page(0).expect("page 0 resolves");
    let positions = page.text_positions();
    let start = positions.text.find(word).expect("the word is on page 0");
    let offset = positions.text[..start].encode_utf16().count();
    let run = positions
        .offsets
        .iter()
        .find(|run| run.start <= offset && offset < run.end)
        .expect("the word has a run");
    let at = |char_index| PageArtifactTextPosition {
        block_index: run.block_index,
        line_index: run.line_index,
        run_index: run.run_index,
        char_index,
    };
    page.text_range_geometry(at(offset - run.start), at(offset - run.start + length))
        .rects
        .first()
        .cloned()
        .expect("the word has geometry")
}

fn double_tap(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
    x: f64,
    y: f64,
) -> String {
    let point = RuntimeTextPointRequest {
        page_index: 0,
        x,
        y,
    };
    let response = document
        .resolve_text_range_from_points_in(
            &handle.revision_id,
            revision_by_id(document, &handle.revision_id),
            RuntimeTextRangeFromPointsRequest {
                anchor: point,
                focus: point,
                granularity: RuntimeTextSelectionGranularity::Word,
            },
        )
        .expect("word request is valid");
    match response.resolution {
        RuntimeTextRangeFromPointsResolution::Resolved { range, .. } => range.selected_text,
        other => panic!("a double tap on text resolves, got {other:?}"),
    }
}

/// A tap on the left half of a word's first glyph lands on the caret
/// before the word, and the word after that boundary is selected — after
/// a space and after a forced break alike.
#[test]
fn a_double_tap_before_a_words_middle_selects_that_word() {
    let (document, handle) = open("<p>The quick<br/>brown fox</p>");
    for word in ["quick", "brown"] {
        let glyph = word_rect(&document, &handle, word, 1);
        let selected = double_tap(
            &document,
            &handle,
            glyph.x + glyph.width / 4.0,
            glyph.y + glyph.height / 2.0,
        );
        assert_eq!(selected, word);
    }
}

/// Past the end of a line that wraps inside its paragraph the caret sits
/// after the line's last word, and that word is selected.
#[test]
fn a_double_tap_past_a_wrapped_lines_end_selects_its_last_word() {
    let words = (0..40)
        .map(|index| format!("word{index}"))
        .collect::<Vec<_>>();
    let (document, handle) = open(&format!("<p>{}</p>", words.join(" ")));
    let session = revision_by_id(&document, &handle.revision_id).chapter_engine_session();
    let page = session.page(0).expect("page 0 resolves");
    let positions = page.text_positions();
    let first_line = positions
        .offsets
        .iter()
        .filter(|run| run.line_index == 0 && run.block_index == 0)
        .collect::<Vec<_>>();
    assert!(
        positions.offsets.iter().any(|run| run.line_index == 1),
        "the paragraph wraps"
    );
    let line_text: String = positions
        .text
        .encode_utf16()
        .skip(first_line[0].start)
        .take(first_line.last().expect("a run").end - first_line[0].start)
        .map(|unit| char::from_u32(u32::from(unit)).unwrap_or('?'))
        .collect();
    let last_word = line_text
        .split_whitespace()
        .last()
        .expect("the line has words")
        .to_owned();
    let glyph = word_rect(&document, &handle, &last_word, last_word.len());
    let selected = double_tap(
        &document,
        &handle,
        glyph.x + glyph.width + 40.0,
        glyph.y + glyph.height / 2.0,
    );
    assert_eq!(selected, last_word);
}
