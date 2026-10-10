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
