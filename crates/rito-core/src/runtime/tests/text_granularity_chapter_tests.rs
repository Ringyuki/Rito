use super::{
    fixture::multi_chapter_fixture_epub,
    pinned_font_policy_fixtures::{face, font_aware_layout, policy, serif_text_font},
    text_granularity_tests::cluster_center_with_page,
};
use crate::interaction::TextInteractionUnavailableReason;
use crate::runtime::{
    RuntimeDocument, RuntimePinnedFontGenericRole, RuntimeRevisionHandle, RuntimeTextPointRequest,
    RuntimeTextRangeFromPointsRequest, RuntimeTextRangeFromPointsResolution,
    RuntimeTextRangeToPointRequest, RuntimeTextSelectionGranularity,
};

#[test]
fn runtime_paragraph_stops_at_retained_chapter_boundary() {
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
    let (page_index, x, y) =
        cluster_center_with_page(&document, &revision.revision_id, "chapter one", 2);
    let (next_page, _, _) = cluster_center_with_page(
        &document,
        &revision.revision_id,
        "chapter two active window",
        2,
    );
    assert_ne!(
        page_index, next_page,
        "the next chapter is retained separately"
    );
    let point = RuntimeTextPointRequest { page_index, x, y };
    let response = document
        .resolve_text_range_from_points_at(
            &RuntimeRevisionHandle::from(&revision),
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

    assert_eq!(range.selected_text, "chapter one");
    assert_eq!(range.rects.len(), 1);
    assert_eq!(anchor_caret.address.page_index, page_index);
    assert_eq!(focus_caret.address.page_index, page_index);
}

#[test]
fn runtime_text_range_to_point_rejects_a_cross_chapter_focus() {
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
    let handle = RuntimeRevisionHandle::from(&revision);
    let (anchor_page, anchor_x, anchor_y) =
        cluster_center_with_page(&document, &revision.revision_id, "chapter one", 2);
    let (focus_page, focus_x, focus_y) = cluster_center_with_page(
        &document,
        &revision.revision_id,
        "chapter two active window",
        2,
    );
    let anchor = document
        .resolve_text_caret_at(
            &handle,
            RuntimeTextPointRequest {
                page_index: anchor_page,
                x: anchor_x,
                y: anchor_y,
            },
        )
        .expect("first chapter caret resolves");
    let crate::runtime::RuntimeTextCaretResolution::Resolved { caret: anchor } =
        anchor.value.resolution
    else {
        panic!("first chapter caret is exact");
    };

    let response = document
        .resolve_text_range_to_point_at(
            &handle,
            RuntimeTextRangeToPointRequest {
                anchor: anchor.address,
                focus: RuntimeTextPointRequest {
                    page_index: focus_page,
                    x: focus_x,
                    y: focus_y,
                },
            },
        )
        .expect("cross-chapter request returns a typed result");

    assert_eq!(
        response.value.resolution,
        RuntimeTextRangeFromPointsResolution::Unavailable {
            reason: TextInteractionUnavailableReason::DifferentChapter,
        }
    );
}
