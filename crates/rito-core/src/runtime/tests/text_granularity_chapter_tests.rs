use super::{
    fixture::multi_chapter_fixture_epub,
    pinned_font_policy_fixtures::{face, font_aware_layout, policy, serif_text_font},
    text_granularity_tests::cluster_center_with_page,
};
use crate::runtime::{
    RuntimeDocument, RuntimePinnedFontGenericRole, RuntimeRevisionHandle, RuntimeTextCaret,
    RuntimeTextCaretResolution, RuntimeTextPointRequest, RuntimeTextRange,
    RuntimeTextRangeFromPointsRequest, RuntimeTextRangeFromPointsResolution,
    RuntimeTextRangeRequest, RuntimeTextRangeResolution, RuntimeTextRangeToPointRequest,
    RuntimeTextSelectionGranularity,
};

const FIRST_CHAPTER_TEXT: &str = "chapter one";
const SECOND_CHAPTER_TEXT: &str = "chapter two active window";
const PAGE_EDGE_X: f64 = 10_000.0;

#[test]
fn runtime_paragraph_stops_at_retained_chapter_boundary() {
    let (document, handle) = exact_multi_chapter_document();
    let (page_index, x, y) =
        cluster_center_with_page(&document, &handle.revision_id, FIRST_CHAPTER_TEXT, 2);
    let (next_page, _, _) =
        cluster_center_with_page(&document, &handle.revision_id, SECOND_CHAPTER_TEXT, 2);
    assert_ne!(
        page_index, next_page,
        "the next chapter is retained separately"
    );
    let point = RuntimeTextPointRequest { page_index, x, y };
    let response = document
        .resolve_text_range_from_points_at(
            &handle,
            RuntimeTextRangeFromPointsRequest {
                anchor: point,
                focus: point,
                granularity: RuntimeTextSelectionGranularity::Paragraph,
            },
        )
        .expect("chapter-end paragraph request is valid");
    let RuntimeTextRangeFromPointsResolution::Resolved {
        anchor_caret,
        focus_caret,
        range,
    } = response.value.resolution
    else {
        panic!("a retained next chapter does not poison the chapter-end paragraph");
    };

    assert_eq!(range.selected_text, FIRST_CHAPTER_TEXT);
    assert_eq!(range.rects.len(), 1);
    assert_eq!(anchor_caret.address.page_index, page_index);
    assert_eq!(focus_caret.address.page_index, page_index);
}

#[test]
fn runtime_text_range_returns_a_cross_chapter_source_span() {
    let (mut document, handle) = exact_multi_chapter_document();
    let (start_point, end_point) = chapter_edge_points(&document, &handle);
    let start = exact_caret(&mut document, &handle, start_point);
    let end = exact_caret(&mut document, &handle, end_point);
    let response = document
        .resolve_text_range_at(
            &handle,
            RuntimeTextRangeRequest {
                anchor: end.address,
                focus: start.address,
            },
        )
        .expect("cross-chapter address range resolves");
    let RuntimeTextRangeResolution::Resolved { range } = response.value.resolution else {
        panic!("cross-chapter address range is exact");
    };

    assert_eq!(range.anchor, end.address);
    assert_eq!(range.focus, start.address);
    assert_eq!(range.start, start.address);
    assert_eq!(range.end, end.address);
    assert_cross_chapter_range(&range, start_point.page_index, end_point.page_index);
    assert_eq!(
        range.source_span.start.source_point,
        start
            .source_locator
            .source_point
            .expect("start caret owns a source point")
    );
    assert_eq!(
        range.source_span.end.source_point,
        end.source_locator
            .source_point
            .expect("end caret owns a source point")
    );
}

#[test]
fn runtime_text_range_to_point_returns_a_cross_chapter_source_span() {
    let (mut document, handle) = exact_multi_chapter_document();
    let (start_point, end_point) = chapter_edge_points(&document, &handle);
    let anchor = exact_caret(&mut document, &handle, start_point);
    let response = document
        .resolve_text_range_to_point_at(
            &handle,
            RuntimeTextRangeToPointRequest {
                anchor: anchor.address,
                focus: end_point,
            },
        )
        .expect("cross-chapter point extension resolves");
    let RuntimeTextRangeFromPointsResolution::Resolved {
        anchor_caret,
        focus_caret,
        range,
    } = response.value.resolution
    else {
        panic!("cross-chapter point extension is exact");
    };

    assert_eq!(anchor_caret.address, anchor.address);
    assert_eq!(focus_caret.address.page_index, end_point.page_index);
    assert_cross_chapter_range(&range, start_point.page_index, end_point.page_index);
}

#[test]
fn runtime_text_range_from_points_returns_a_cross_chapter_source_span() {
    let (document, handle) = exact_multi_chapter_document();
    let (anchor, focus) = chapter_center_points(&document, &handle);
    let response = document
        .resolve_text_range_from_points_at(
            &handle,
            RuntimeTextRangeFromPointsRequest {
                anchor,
                focus,
                granularity: RuntimeTextSelectionGranularity::Word,
            },
        )
        .expect("cross-chapter word range resolves");
    let RuntimeTextRangeFromPointsResolution::Resolved {
        anchor_caret,
        focus_caret,
        range,
    } = response.value.resolution
    else {
        panic!("cross-chapter word range is exact");
    };

    assert_eq!(range.selected_text, "chapter one\n\nchapter");
    assert!(range.source_locator.is_none());
    assert!(range.source_span.start.href.ends_with("chapter-1.xhtml"));
    assert!(range.source_span.end.href.ends_with("chapter-2.xhtml"));
    assert_eq!(
        range.source_span.start.source_point,
        anchor_caret
            .source_locator
            .source_point
            .expect("anchor caret owns a source point")
    );
    assert_eq!(
        range.source_span.end.source_point,
        focus_caret
            .source_locator
            .source_point
            .expect("focus caret owns a source point")
    );
}

fn exact_multi_chapter_document() -> (RuntimeDocument, RuntimeRevisionHandle) {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &multi_chapter_fixture_epub(),
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("multi-chapter document opens");
    let mut layout = font_aware_layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let revision = document
        .create_revision(&layout)
        .expect("exact multi-chapter revision is created");
    (document, RuntimeRevisionHandle::from(&revision))
}

fn chapter_center_points(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
) -> (RuntimeTextPointRequest, RuntimeTextPointRequest) {
    let (anchor_page, anchor_x, anchor_y) =
        cluster_center_with_page(document, &handle.revision_id, FIRST_CHAPTER_TEXT, 2);
    let (focus_page, focus_x, focus_y) =
        cluster_center_with_page(document, &handle.revision_id, SECOND_CHAPTER_TEXT, 2);
    (
        RuntimeTextPointRequest {
            page_index: anchor_page,
            x: anchor_x,
            y: anchor_y,
        },
        RuntimeTextPointRequest {
            page_index: focus_page,
            x: focus_x,
            y: focus_y,
        },
    )
}

fn chapter_edge_points(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
) -> (RuntimeTextPointRequest, RuntimeTextPointRequest) {
    let (mut start, mut end) = chapter_center_points(document, handle);
    start.x -= PAGE_EDGE_X;
    end.x += PAGE_EDGE_X;
    (start, end)
}

fn exact_caret(
    document: &mut RuntimeDocument,
    handle: &RuntimeRevisionHandle,
    point: RuntimeTextPointRequest,
) -> Box<RuntimeTextCaret> {
    let response = document
        .resolve_text_caret_at(handle, point)
        .expect("chapter caret resolves");
    let RuntimeTextCaretResolution::Resolved { caret } = response.value.resolution else {
        panic!("chapter caret is exact");
    };
    caret
}

fn assert_cross_chapter_range(range: &RuntimeTextRange, first_page: usize, second_page: usize) {
    assert_eq!(
        range.selected_text,
        "chapter one\n\nchapter two active window"
    );
    assert!(range.source_locator.is_none());
    assert!(range.source_span.start.href.ends_with("chapter-1.xhtml"));
    assert!(range.source_span.end.href.ends_with("chapter-2.xhtml"));
    assert!(range.rects.iter().any(|rect| rect.page_index == first_page));
    assert!(range
        .rects
        .iter()
        .any(|rect| rect.page_index == second_page));
    let serialized = serde_json::to_value(range).expect("cross-chapter range serializes");
    assert!(serialized.get("sourceSpan").is_some());
    assert!(serialized.get("sourceLocator").is_none());
}
