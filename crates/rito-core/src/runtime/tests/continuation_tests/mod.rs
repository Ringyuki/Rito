mod footnotes;
mod lifecycle;
mod pagination;
mod resources;

use crate::{
    layout::{LayoutConfig, LineBreaking},
    runtime::{
        RuntimeBoundedRevisionRequest, RuntimeContinueRevisionRequest, RuntimeDocument,
        RuntimeRevisionAdvance, RuntimeRevisionCursor, RuntimeRevisionWorkBudget,
    },
};

fn complete_revision(
    document: &mut RuntimeDocument,
    mut advance: RuntimeRevisionAdvance,
) -> RuntimeRevisionAdvance {
    while let Some(cursor) = advance.continuation {
        advance = document
            .continue_revision(continue_request(&cursor, 1))
            .expect("continuation completes");
    }
    advance
}

fn assert_bounded_is_eager_prefix(
    bounded: &RuntimeDocument,
    bounded_revision_id: &str,
    eager: &RuntimeDocument,
    eager_revision_id: &str,
) {
    let bounded_layout = &bounded.revisions[bounded_revision_id].layout;
    let eager_layout = &eager.revisions[eager_revision_id].layout;
    assert_eq!(
        bounded_layout.pages,
        eager_layout.pages[..bounded_layout.pages.len()],
        "every published page must be an immutable eager prefix"
    );
    let eager_starts = eager_layout
        .chapter_start_pages
        .iter()
        .copied()
        .filter(|index| *index < bounded_layout.pages.len())
        .collect();
    assert_eq!(bounded_layout.chapter_start_pages, eager_starts);
}

fn bounded_request(
    layout_config: LayoutConfig,
    max_top_level_nodes: usize,
) -> RuntimeBoundedRevisionRequest {
    RuntimeBoundedRevisionRequest {
        layout_config,
        line_breaking: LineBreaking::Greedy,
        budget: budget(max_top_level_nodes),
    }
}

fn continue_request(
    cursor: &RuntimeRevisionCursor,
    max_top_level_nodes: usize,
) -> RuntimeContinueRevisionRequest {
    RuntimeContinueRevisionRequest {
        revision_id: cursor.revision_id.clone(),
        revision_version: cursor.revision_version,
        cursor: cursor.cursor.clone(),
        budget: budget(max_top_level_nodes),
    }
}

fn budget(max_top_level_nodes: usize) -> RuntimeRevisionWorkBudget {
    RuntimeRevisionWorkBudget {
        max_top_level_nodes,
    }
}
