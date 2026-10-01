use super::*;

#[test]
fn the_active_entry_is_the_last_one_at_or_before_the_page() {
    use TocTargetPosition::{After, Before, Page, Unplaced};
    let positions = [Before, Page(0), Page(4), Unplaced, Page(2), After];

    assert_eq!(active_toc_entry(&positions, 0), Some(1));
    assert_eq!(active_toc_entry(&positions, 2), Some(4));
    assert_eq!(active_toc_entry(&positions, 3), Some(4));
    assert_eq!(active_toc_entry(&positions, 9), Some(4));
    assert_eq!(active_toc_entry(&[Unplaced, After], 3), None);
}

#[test]
fn the_page_sweep_agrees_with_the_per_page_rule() {
    use TocTargetPosition::{After, Before, Page, Unplaced};
    let positions = [Page(3), Before, Page(1), Unplaced, Page(3), After, Page(7)];
    let by_page = active_toc_entries_by_page(&positions, 6);

    for (page, active) in by_page.iter().enumerate() {
        assert_eq!(*active, active_toc_entry(&positions, page), "page {page}");
    }
}

#[test]
fn source_points_order_by_tree_position_then_offset() {
    let point = |node_path: Vec<usize>, text_offset| RuntimeSourcePoint {
        node_path,
        text_offset,
    };
    assert_eq!(
        source_point_order(&point(vec![0, 1], 5), &point(vec![0, 2], 0)),
        Ordering::Less
    );
    assert_eq!(
        source_point_order(&point(vec![1, 0], 0), &point(vec![0, 9], 9)),
        Ordering::Greater
    );
    assert_eq!(
        source_point_order(&point(vec![2], 3), &point(vec![2], 3)),
        Ordering::Equal
    );
    assert_eq!(
        source_point_order(&point(vec![2], 3), &point(vec![2], 4)),
        Ordering::Less
    );
}

#[test]
fn a_browser_revision_answers_position_questions_in_the_engine_json_shape() {
    use crate::runtime::{
        tests::fixture::{layout, toc_anchor_fixture_epub},
        RuntimeDocument, RuntimePositionAnswer, RuntimePositionQuery, RuntimeRevisionHandle,
    };
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&toc_anchor_fixture_epub()).expect("opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle {
        revision_id: revision.revision_id.clone(),
        revision_version: revision.revision_version,
    };
    let point = |node: usize| RuntimeSourcePoint {
        node_path: vec![node, 0],
        text_offset: 0,
    };

    let entry = document
        .resolve_position_query_at(
            &handle,
            serde_json::from_str(
                r#"{"kind":"tocEntryAtPosition","href":"chapter-2.xhtml","point":{"nodePath":[1,0],"textOffset":0}}"#,
            )
            .expect("query parses"),
        )
        .expect("answers")
        .value;
    assert_eq!(
        entry,
        RuntimePositionAnswer::TocEntry { toc_index: Some(3) }
    );
    assert_eq!(
        serde_json::to_string(&entry).expect("serializes"),
        r#"{"kind":"tocEntry","tocIndex":3}"#
    );

    let order = document
        .resolve_position_query_at(
            &handle,
            RuntimePositionQuery::Compare {
                first: crate::runtime::RuntimeSourcePosition {
                    href: "chapter-2.xhtml".to_owned(),
                    point: point(0),
                },
                second: crate::runtime::RuntimeSourcePosition {
                    href: "chapter-1.xhtml".to_owned(),
                    point: point(30),
                },
            },
        )
        .expect("answers")
        .value;
    assert_eq!(
        serde_json::to_string(&order).expect("serializes"),
        r#"{"kind":"order","order":1}"#
    );
}
