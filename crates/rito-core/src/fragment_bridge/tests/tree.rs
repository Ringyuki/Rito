//! Tree shape tests: box generation and `display: none`, outside list
//! markers, deterministic construction, and block-level link scoping.

use super::*;

#[test]
fn list_items_carry_outside_markers_without_degrading() {
    let chapter = resolved_chapter_from(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <ol><li>first entry</li><li>second entry</li><li><span>third</span><ol><li>nested</li></ol></li></ol>
  <ul><li>bullet</li></ul>
</body></html>"#,
    );
    let mut built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("list items lay out");
    assert!(
        !built
            .degradations
            .iter()
            .any(|reason| reason.contains("plain block flow")),
        "list items no longer degrade: {:?}",
        built.degradations
    );
    let mut texts: Vec<&str> = built
        .list_markers
        .values()
        .map(|marker| marker.text.as_str())
        .collect();
    texts.sort();
    // Three ordinals in the outer <ol>, a restarted ordinal in the
    // nested <ol>, and one disc bullet in the <ul>. The nested list
    // restarts at 1, so "1." appears twice.
    assert_eq!(texts, vec!["1.", "1.", "2.", "3.", "\u{2022}"]);
    // Measured after bridging: every marker's painted string shapes
    // to a box with one origin per cluster, the trailing space
    // included, from the box's start.
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register");
    built
        .measure_painted_runs(&context)
        .expect("painted runs measure");
    for marker in built.list_markers.values() {
        let painted = marker.painted_text();
        let run = marker.run.as_ref().expect("marker measured");
        assert!(run.advance > 0.0, "{painted:?} takes a box");
        assert_eq!(
            run.clusters.len(),
            painted.chars().count(),
            "one origin per cluster of {painted:?}"
        );
        assert_eq!(run.clusters[0].x, 0.0);
        assert!(
            run.clusters.last().expect("a cluster").x < run.advance,
            "the last origin lies inside the box"
        );
    }
}

#[test]
fn chapter_tree_reflects_box_generation_and_display_none() {
    let chapter = resolved_chapter();
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let root = built.tree.node(built.tree.root());
    // p1 (inline flow), div (block container), empty p — hidden p gone.
    assert_eq!(root.children.len(), 3);
    let first = built.tree.node(root.children[0]);
    let FormattingNodeContent::InlineFlow { items } = &first.content else {
        panic!("first paragraph is an inline flow, got {:?}", first.content);
    };
    // Style boundaries split the items: plain, bold span, plain tail.
    assert_eq!(items.len(), 3, "{items:?}");
    let texts: Vec<&str> = items
        .iter()
        .map(|item| match item {
            InlineItem::Text { text, .. } => text.as_str(),
            InlineItem::Image { .. }
            | InlineItem::InlineBlock { .. }
            | InlineItem::EmptyBox { .. } => {
                panic!("no atomic items in this paragraph")
            }
        })
        .collect();
    assert_eq!(
        texts,
        vec![
            "First paragraph with collapsed spaces and ",
            "styled inline",
            " text.",
        ],
    );
    let (
        InlineItem::Text { style: plain, .. },
        InlineItem::Text { style: bold, .. },
        InlineItem::Text { style: tail, .. },
    ) = (&items[0], &items[1], &items[2])
    else {
        panic!("all three items are text runs");
    };
    assert_ne!(plain, bold, "the bold span interns a distinct style");
    assert_eq!(plain, tail, "text after the span returns to parent style");

    let wrapper = built.tree.node(root.children[1]);
    assert!(matches!(
        wrapper.content,
        FormattingNodeContent::BlockContainer
    ));
    assert_eq!(wrapper.children.len(), 1);
    let nested = built.tree.node(wrapper.children[0]);
    assert!(matches!(
        nested.content,
        FormattingNodeContent::InlineFlow { .. }
    ));

    let empty = built.tree.node(root.children[2]);
    assert!(matches!(
        empty.content,
        FormattingNodeContent::BlockContainer
    ));
    assert!(empty.children.is_empty());

    // Source mapping: real elements map back, the root maps to body.
    assert!(built.source_nodes[root.children[0].0 as usize].is_some());
    assert_eq!(
        built.source_nodes[built.tree.root().0 as usize],
        Some(chapter.body_index)
    );
}

#[test]
fn chapter_tree_construction_is_deterministic() {
    let chapter = resolved_chapter();
    let first = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("first build");
    let second = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("second build");
    assert_eq!(first.tree.fingerprint(), second.tree.fingerprint());
    assert_eq!(first.source_nodes, second.source_nodes);
}

#[test]
fn a_block_level_link_scopes_its_href_over_the_card_subtree() {
    // The TOC-card idiom: <a href><div>card text</div></a> — the <a>
    // is block-level (it contains a block), and its destination must
    // reach every inline item inside the card, exactly as an inline
    // <a> scopes its runs.
    let chapter = resolved_chapter_from(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <a href="Section001.xhtml"><div>card one</div></a>
  <p>plain</p>
</body></html>"#,
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let linked = built
        .flow_item_sources
        .values()
        .flatten()
        .filter(|source| source.href.as_deref() == Some("Section001.xhtml"))
        .count();
    assert!(
        linked > 0,
        "card text inside a block-level <a> carries its href"
    );
    let unlinked = built
        .flow_item_sources
        .values()
        .flatten()
        .any(|source| source.href.is_none());
    assert!(unlinked, "the plain paragraph stays link-free");
}
