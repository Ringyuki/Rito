use serde_json::json;

use super::{layout, multi_chapter_fixture_epub};
use crate::{
    layout::{LayoutRuntimePage, LineBox, LineBreaking, RuntimeBlock, RuntimeChild},
    runtime::{RuntimeBoundedRevisionRequest, RuntimeDocument, RuntimeRevisionWorkBudget},
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn document_drop_drains_queued_and_active_runtime_owners_on_a_small_stack() {
    std::thread::Builder::new()
        .name("runtime-document-drop".to_owned())
        .stack_size(512 * 1024)
        .spawn(build_and_drop_document)
        .expect("drop thread starts")
        .join()
        .expect("runtime document drops without overflowing the stack");
}

fn build_and_drop_document() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("runtime document opens");
    let bounded = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("bounded revision starts");
    assert!(bounded.continuation.is_some());

    let queued = document
        .create_revision(&layout())
        .expect("queued revision is created");
    let active = document
        .create_revision(&layout())
        .expect("active revision is created");
    install_deep_page(&mut document, &queued.revision_id);
    install_deep_page(&mut document, &active.revision_id);

    assert!(document.release_revision(&queued.revision_id));
    assert!(!document.cleanup_queue.is_empty());
    assert_eq!(document.continuations.len(), 1);

    drop(document);
}

fn install_deep_page(document: &mut RuntimeDocument, revision_id: &str) {
    let revision = document
        .revisions
        .get_mut(revision_id)
        .expect("revision exists");
    revision.layout.pages = vec![LayoutRuntimePage::new(
        0,
        320.0,
        120.0,
        Some(json!({ "backgroundColor": "#fff" })),
        vec![deep_block(DEEP_BLOCK_COUNT)],
    )];
}

fn deep_block(count: usize) -> RuntimeBlock<LineBox> {
    assert!(count > 0);
    let mut root = block(Vec::new());
    for _ in 1..count {
        root = block(vec![RuntimeChild::Block(Box::new(root))]);
    }
    root
}

fn block(children: Vec<RuntimeChild<LineBox>>) -> RuntimeBlock<LineBox> {
    RuntimeBlock {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        semantic_tag: Some("p".to_owned()),
        anchor_id: None,
        paint: Some(json!({ "color": "#000" })),
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children,
    }
}
