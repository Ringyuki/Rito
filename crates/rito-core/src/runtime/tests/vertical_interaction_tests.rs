//! Compare interaction geometry against the real vertical paint commands.
use super::pinned_font_policy_fixtures::{content_epub, face, layout, policy};
use super::revisions::{exact_source_range, revision_by_id};
use crate::render::DisplayCommand;
use crate::runtime::{
    RuntimeDocument, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
    RuntimeSourcePoint, RuntimeSourceRange, RuntimeTextCaretResolution, RuntimeTextPointRequest,
    RuntimeTextRangeFromPointsResolution, RuntimeTextRangeToPointRequest,
};

fn open(mode: &str, body: &str) -> RuntimeDocument {
    let css = format!("body {{ {mode}: vertical-rl; }} p {{ margin: 0; }}");
    RuntimeDocument::open_with_pinned_font_policy(
        &content_epub("ja", body, &css, None),
        policy(vec![face(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
            ))
            .expect("font"),
            crate::runtime::RuntimePinnedFontGenericRole::Serif,
            Some("ja"),
        )]),
    )
    .expect("vertical document")
}

/// Page-content coordinates, the space interaction entry points consume.
fn painted(document: &RuntimeDocument, revision: &str, text: &str) -> (f64, f64, f64, f64) {
    let session = revision_by_id(document, revision).chapter_engine_session();
    let frame = session.frame(0, 1.0).expect("paint").expect("first frame");
    let rect = frame
        .commands
        .iter()
        .find_map(|command| match command {
            DisplayCommand::PaintText(run) if &*run.text == text => Some((
                run.rect.x - 24.0,
                run.rect.y - 24.0,
                run.rect.width,
                run.rect.height,
            )),
            _ => None,
        })
        .expect("the requested base text paints");
    rect
}

fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6, "{a} != {b}");
}

#[test]
fn vertical_interaction_hits_share_the_painted_glyph_column() {
    for mode in ["writing-mode", "-epub-writing-mode"] {
        let mut document = open(mode, "<p>甲乙丙</p>");
        let rev = document.create_revision(&layout()).expect("revision");
        let expected = painted(&document, &rev.revision_id, "甲乙丙");
        let page = revision_by_id(&document, &rev.revision_id)
            .chapter_engine_session()
            .page(0)
            .expect("page");
        let hit = page
            .targets()
            .into_iter()
            .find(|hit| hit.text == "甲乙丙")
            .expect("text hit");
        near(hit.bounds.x, expected.0);
        near(hit.bounds.y, expected.1);
        near(hit.bounds.width, expected.2);
        near(hit.bounds.height, expected.3);
    }
}

#[test]
fn vertical_interaction_pointer_range_selects_the_painted_character() {
    let mut document = open("writing-mode", "<p>甲乙丙</p><p>丁戊己</p>");
    let rev = document.create_revision(&layout()).expect("revision");
    let (x, y, w, h) = painted(&document, &rev.revision_id, "甲乙丙");
    let at = |fraction| RuntimeTextPointRequest {
        page_index: 0,
        x: x + w / 2.0,
        y: y + h * fraction / 3.0,
    };
    let caret = document
        .resolve_text_caret_in(
            &rev.revision_id,
            revision_by_id(&document, &rev.revision_id),
            at(1.1),
        )
        .expect("caret");
    let RuntimeTextCaretResolution::Resolved { caret } = caret.resolution else {
        panic!("resolved caret")
    };
    assert_eq!(
        caret.source_locator.source_point,
        Some(RuntimeSourcePoint {
            node_path: vec![0, 0],
            text_offset: 1
        })
    );
    let range = document
        .resolve_text_range_to_point_in(
            &rev.revision_id,
            revision_by_id(&document, &rev.revision_id),
            RuntimeTextRangeToPointRequest {
                anchor: caret.address,
                focus: at(2.1),
            },
        )
        .expect("range");
    let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = range.resolution else {
        panic!("resolved range")
    };
    assert_eq!(range.selected_text, "乙");
    near(range.rects[0].x, x);
    near(range.rects[0].y, y + h / 3.0);
    near(range.rects[0].width, w);
    near(range.rects[0].height, h / 3.0);
}

#[test]
fn vertical_interaction_ruby_base_annotation_reprojects_after_reflow() {
    let mut document = open(
        "writing-mode",
        "<p>前<ruby><rb>甲乙</rb><rt>こうおつ</rt></ruby>後</p>",
    );
    let source = RuntimeSourceRange {
        start: RuntimeSourcePoint {
            node_path: vec![0, 1, 0, 0],
            text_offset: 0,
        },
        end: RuntimeSourcePoint {
            node_path: vec![0, 1, 0, 0],
            text_offset: 2,
        },
    };
    let initial = document
        .create_revision(&layout())
        .expect("initial revision");
    let (x, y, w, h) = painted(&document, &initial.revision_id, "甲乙");
    let at = |fraction| RuntimeTextPointRequest {
        page_index: 0,
        x: x + w / 2.0,
        y: y + h * fraction,
    };
    let caret = document
        .resolve_text_caret_in(
            &initial.revision_id,
            revision_by_id(&document, &initial.revision_id),
            at(0.05),
        )
        .expect("caret");
    let RuntimeTextCaretResolution::Resolved { caret } = caret.resolution else {
        panic!("caret")
    };
    let selected = document
        .resolve_text_range_to_point_in(
            &initial.revision_id,
            revision_by_id(&document, &initial.revision_id),
            RuntimeTextRangeToPointRequest {
                anchor: caret.address,
                focus: at(0.95),
            },
        )
        .expect("pointer selection");
    let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = selected.resolution else {
        panic!("selection")
    };
    assert_eq!(range.selected_text, "甲乙");
    let selected_source = range
        .source_locator
        .expect("locator")
        .source_range
        .expect("source range");
    assert_eq!(selected_source, source);
    let stored = document
        .create_annotation_target("chapter.xhtml", &selected_source)
        .expect("stored mark");
    let mut previous = None;
    for font_size in [16.0, 22.0] {
        let mut config = layout();
        config.root_font_size = font_size;
        let rev = document.create_revision(&config).expect("revision");
        let expected = painted(&document, &rev.revision_id, "甲乙");
        let resolved = document
            .resolve_annotation_target(&stored)
            .expect("resolve stored mark");
        let crate::runtime::AnnotationTargetResolution::Exact { target } = resolved else {
            panic!("mark resolves")
        };
        let projected = exact_source_range(
            &mut document,
            &rev.revision_id,
            RuntimeExactSourceRangeRequest {
                href: "chapter.xhtml".to_owned(),
                source_range: target.source_range,
            },
        )
        .expect("projection");
        let RuntimeExactSourceRangeResolution::Resolved { range } = projected else {
            panic!("mark projects")
        };
        assert_eq!(range.selected_text, "甲乙");
        let r = &range.rects[0];
        near(r.x, expected.0);
        near(r.y, expected.1);
        near(r.width, expected.2);
        near(r.height, expected.3);
        if let Some(previous) = previous {
            assert_ne!(expected, previous, "font change really reflows");
        }
        previous = Some(expected);
    }
}

#[test]
fn vertical_interaction_latin_and_non_bmp_glyphs_keep_utf16_boundaries() {
    let mut document = open("writing-mode", "<p>Ab😀Z</p>");
    let rev = document.create_revision(&layout()).expect("revision");
    let session = revision_by_id(&document, &rev.revision_id).chapter_engine_session();
    let page = session.page(0).expect("page");
    // The physical character step is one em, even for narrow Latin and
    // a two-unit UTF-16 code point; measuring horizontal glyph widths fails.
    let hit = page
        .targets()
        .into_iter()
        .find(|h| h.text == "Ab😀Z")
        .expect("run");
    for (index, expected) in [(0, 0), (1, 1), (2, 2), (3, 4), (4, 5)] {
        let caret = document
            .resolve_text_caret_in(
                &rev.revision_id,
                revision_by_id(&document, &rev.revision_id),
                RuntimeTextPointRequest {
                    page_index: 0,
                    x: hit.bounds.x + hit.bounds.width / 2.0,
                    y: hit.bounds.y + (index as f64 + 0.05) * hit.bounds.height / 4.0,
                },
            )
            .expect("caret");
        let RuntimeTextCaretResolution::Resolved { caret } = caret.resolution else {
            panic!("caret")
        };
        assert_eq!(
            caret
                .source_locator
                .source_point
                .expect("source")
                .text_offset,
            expected
        );
    }
}

#[test]
fn vertical_interaction_inline_image_and_link_hits_follow_paint() {
    use super::fixture::fixture_epub_with_chapter_and_stylesheet;
    let bytes=fixture_epub_with_chapter_and_stylesheet(
        br##"<html xmlns="http://www.w3.org/1999/xhtml"><body><p><a href="#t"><img src="Images/cover.png" style="width:24px;height:32px" alt="plate"/></a><span id="t">X</span></p></body></html>"##,
        "body { writing-mode:vertical-rl; } p { margin:0; }");
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document");
    let rev = document.create_revision(&layout()).expect("revision");
    let session = revision_by_id(&document, &rev.revision_id).chapter_engine_session();
    let page = session.page(0).expect("page");
    let hit = page
        .targets()
        .into_iter()
        .find(|h| h.image_src.is_some())
        .expect("image hit");
    assert_eq!(hit.href.as_deref(), Some("#t"));
    let frame = session.frame(0, 1.0).expect("paint").expect("frame");
    let rect = frame
        .commands
        .iter()
        .find_map(|c| match c {
            DisplayCommand::PaintImage { rect, .. } => Some(*rect),
            _ => None,
        })
        .expect("painted image");
    near(hit.bounds.x + 24.0, rect.x);
    near(hit.bounds.y + 24.0, rect.y);
    near(hit.bounds.width, rect.width);
    near(hit.bounds.height, rect.height);
}
