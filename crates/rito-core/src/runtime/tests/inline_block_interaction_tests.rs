//! Nested atomic flows must keep distinct, reading-ordered text addresses.
use super::pinned_font_policy_fixtures::{content_epub, face, layout, policy};
use super::revisions::{exact_source_range, revision_by_id};
use crate::render::DisplayCommand;
use crate::runtime::{
    AnnotationTargetResolution, RuntimeDocument, RuntimeExactSourceRangeRequest,
    RuntimeExactSourceRangeResolution, RuntimePinnedFontGenericRole, RuntimeTextCaretResolution,
    RuntimeTextPointRequest, RuntimeTextRangeFromPointsResolution, RuntimeTextRangeToPointRequest,
};

fn open(body: &str) -> RuntimeDocument {
    RuntimeDocument::open_with_pinned_font_policy(
        &content_epub("zh", body, "p{margin:0}.box{display:inline-block}", None),
        policy(vec![face(
            std::fs::read(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
            ))
            .expect("font"),
            RuntimePinnedFontGenericRole::Serif,
            None,
        )]),
    )
    .expect("document")
}

fn point(
    document: &RuntimeDocument,
    revision: &str,
    text: &str,
    fraction: f64,
) -> RuntimeTextPointRequest {
    let session = revision_by_id(document, revision).chapter_engine_session();
    let frame = session.frame(0, 1.0).expect("paint").expect("page");
    let rect = frame
        .commands
        .iter()
        .find_map(|command| match command {
            DisplayCommand::PaintText(run) if &*run.text == text => Some(run.rect),
            _ => None,
        })
        .expect("text paints");
    RuntimeTextPointRequest {
        page_index: 0,
        x: rect.x - 24.0 + rect.width * fraction,
        y: rect.y - 24.0 + rect.height / 2.0,
    }
}

fn select(
    document: &RuntimeDocument,
    revision: &str,
    first: &str,
    last: &str,
) -> crate::runtime::RuntimeTextRange {
    let caret = document
        .resolve_text_caret_in(
            revision,
            revision_by_id(document, revision),
            point(document, revision, first, 0.05),
        )
        .expect("caret");
    let RuntimeTextCaretResolution::Resolved { caret } = caret.resolution else {
        panic!("caret resolves")
    };
    let response = document
        .resolve_text_range_to_point_in(
            revision,
            revision_by_id(document, revision),
            RuntimeTextRangeToPointRequest {
                anchor: caret.address,
                focus: point(document, revision, last, 0.95),
            },
        )
        .expect("selection response");
    let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = response.resolution else {
        panic!(
            "a painted inline-block selection must resolve: {:?}",
            response.resolution
        )
    };
    *range
}

#[test]
fn inline_block_run_addresses_are_unique_and_reading_ordered() {
    let mut document = open(
        r#"<p>甲乙<span class="box">盒内文字<span class="box">嵌套文字</span>尾字</span>丙丁</p>"#,
    );
    let revision = document.create_revision(&layout()).expect("revision");
    let session = revision_by_id(&document, &revision.revision_id).chapter_engine_session();
    let positions = session.page(0).expect("page").text_positions();
    let keys: Vec<_> = positions
        .offsets
        .iter()
        .map(|run| (run.block_index, run.line_index, run.run_index))
        .collect();
    assert_eq!(keys.len(), 5);
    assert!(
        keys.windows(2).all(|pair| pair[0] < pair[1]),
        "unique reading-order addresses: {keys:?}"
    );
}

#[test]
fn inline_block_pointer_marks_reproject_after_font_changes() {
    let mut document = open(
        r#"<p>甲乙<span class="box">盒内文字<span class="box">嵌套文字</span>尾字</span>丙丁</p>"#,
    );
    let initial = document.create_revision(&layout()).expect("revision");
    let mut marks = Vec::new();
    for text in ["甲乙", "盒内文字", "嵌套文字", "尾字", "丙丁"] {
        let range = select(&document, &initial.revision_id, text, text);
        assert_eq!(range.selected_text, text);
        let source = range
            .source_locator
            .expect("source")
            .source_range
            .expect("range");
        let mark = document
            .create_annotation_target("chapter.xhtml", &source)
            .expect("mark");
        marks.push((text, mark));
    }
    for size in [22.0, 16.0] {
        let mut config = layout();
        config.root_font_size = size;
        let revision = document.create_revision(&config).expect("reflow");
        for (text, mark) in &marks {
            let AnnotationTargetResolution::Exact { target } = document
                .resolve_annotation_target(mark)
                .expect("stored mark")
            else {
                panic!("exact mark")
            };
            let response = exact_source_range(
                &mut document,
                &revision.revision_id,
                RuntimeExactSourceRangeRequest {
                    href: "chapter.xhtml".into(),
                    source_range: target.source_range,
                },
            )
            .expect("projection");
            let RuntimeExactSourceRangeResolution::Resolved { range } = response else {
                panic!("mark projects: {response:?}")
            };
            assert_eq!(range.selected_text, *text);
            assert_eq!(range.rects.len(), 1);
            let expected = point(&document, &revision.revision_id, text, 0.5);
            assert!((range.rects[0].x + range.rects[0].width / 2.0 - expected.x).abs() < 1e-6);
        }
    }
}

#[test]
fn inline_block_range_includes_nested_and_trailing_text_in_order() {
    let mut document = open(
        r#"<p>甲乙<span class="box">盒内文字<span class="box">嵌套文字</span>尾字</span>丙丁</p>"#,
    );
    let revision = document.create_revision(&layout()).expect("revision");
    let range = select(&document, &revision.revision_id, "甲乙", "丙丁");
    let text: String = range
        .selected_text
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect();
    assert_eq!(text, "甲乙盒内文字嵌套文字尾字丙丁");
    assert!(!range.rects.is_empty());
    let range = select(&document, &revision.revision_id, "盒内文字", "丙丁");
    let text: String = range
        .selected_text
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect();
    assert_eq!(text, "盒内文字嵌套文字尾字丙丁");
}
