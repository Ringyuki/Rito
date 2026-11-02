//! Pagination test: a real chapter paginates losslessly through the engine.

use super::*;

#[test]
fn real_chapter_paginates_losslessly_through_the_new_engine() {
    let chapter = resolved_chapter();
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let space = ConstraintSpace::fragmented(200.0, 60.0);
    let mut token = None;
    let mut pages = Vec::new();
    loop {
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &space,
                token.as_ref(),
                &cancel,
            )
            .expect("page lays out");
        token = outcome.continuation.clone();
        pages.push(outcome);
        if token.is_none() {
            break;
        }
        assert!(pages.len() < 64, "pagination terminates");
    }
    assert!(pages.len() > 1, "narrow pages force pagination");

    // Reassemble every text fragment across all pages per paragraph
    // node; the result must equal the collapsed source text exactly.
    let mut per_node: std::collections::BTreeMap<u32, String> = std::collections::BTreeMap::new();
    fn walk(
        fragment: &Fragment,
        tree: &FormattingTree,
        per_node: &mut std::collections::BTreeMap<u32, String>,
    ) {
        match fragment {
            Fragment::Box(inner) => {
                for child in &inner.children {
                    walk(child, tree, per_node);
                }
            }
            Fragment::Line(line) => {
                let source = line.source;
                let FormattingNodeContent::InlineFlow { items } = &tree.node(source).content else {
                    panic!("line sources are inline flows");
                };
                let full_text: String = items
                    .iter()
                    .filter_map(|item| match item {
                        InlineItem::Text { text, .. } => Some(text.as_str()),
                        InlineItem::Image { .. }
                        | InlineItem::InlineBlock { .. }
                        | InlineItem::EmptyBox { .. }
                        | InlineItem::OpenTag { .. }
                        | InlineItem::CloseTag { .. } => None,
                    })
                    .collect();
                let mut start = u32::MAX;
                let mut end = 0_u32;
                for run in &line.children {
                    let Fragment::Text(run) = run else {
                        panic!("line children are text runs");
                    };
                    start = start.min(run.text_start);
                    end = end.max(run.text_end);
                }
                per_node
                    .entry(source.0)
                    .or_default()
                    .push_str(&full_text[start as usize..end as usize]);
            }
            Fragment::Text(_) | Fragment::Image(_) => {}
        }
    }
    for page in &pages {
        walk(&page.fragments.root, &built.tree, &mut per_node);
    }
    let reassembled: Vec<&str> = per_node.values().map(String::as_str).collect();
    assert_eq!(
        reassembled,
        vec![
            "First paragraph with collapsed spaces and styled inline text.",
            "Nested paragraph inside a wrapper block.",
        ],
    );
}

/// A block whose start lands past the page's end — here an empty one after
/// a line taller than the page — breaks before and opens the next page,
/// however small, as Blink must when the space left is below zero
/// (measured: calibre's empty page-break `<div>` after an over-wide plate
/// takes a column of its own).
#[test]
fn an_empty_block_past_an_overflowing_line_opens_the_next_page() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div><span class="tall"></span></div><div class="pb"></div>
</body></html>"#,
        "body { margin: 0; font-size: 10px; line-height: 10px; } .tall { display: inline-block; height: 100px; }\n",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let space = ConstraintSpace::fragmented(200.0, 60.0);
    let first = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &space,
            None,
            &CancelFlag::new(),
        )
        .expect("first page lays out");
    let token = first
        .continuation
        .expect("the empty block opens a second page");
    assert_eq!(token.stage, rito_fragment::BreakTokenStage::Before);
    let second = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &space,
            Some(&token),
            &CancelFlag::new(),
        )
        .expect("second page lays out");
    assert!(second.continuation.is_none());
}
