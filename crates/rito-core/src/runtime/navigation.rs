use super::RuntimeRevision;

pub(super) fn spread_index_for_page(revision: &RuntimeRevision, page_index: usize) -> usize {
    revision
        .chapter_engine_session()
        .spreads()
        .into_iter()
        .find(|spread| {
            spread.left_page_index == page_index || spread.right_page_index == Some(page_index)
        })
        .map(|spread| spread.spread_index)
        .unwrap_or(0)
}
