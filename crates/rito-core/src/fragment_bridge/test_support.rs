//! Fixtures other in-crate tests build on: the plain block style they
//! intern for containers, and a one-paragraph chapter tree pinned to Tinos
//! for tests that need a real bridged tree without an EPUB.

use std::collections::BTreeMap;

use rito_style_contract::LayoutFormattingStyle;

use super::styles::anonymous_block_style;
use super::ChapterFormattingTree;

/// The style of a CSS anonymous block box: block-level flow with every
/// box property initial. Inherited properties live on the inline items
/// inside, so the layout slice is fully initial here.
/// The plain block style in-crate test fixtures intern for containers.
#[cfg(test)]
pub(crate) fn tests_block_style() -> LayoutFormattingStyle {
    anonymous_block_style()
}

/// A one-paragraph chapter tree pinned to Tinos: what in-crate tests use
/// when they need a real bridged tree without an EPUB.
#[cfg(test)]
pub(crate) fn tests_chapter_tree(text: &str) -> ChapterFormattingTree {
    use rito_fragment::{
        FormattingNode, FormattingNodeContent, FormattingNodeId, FormattingTree,
        FormattingTreeStyles, InlineItem,
    };
    use rito_style_contract::{
        FontFamilies, FontFamily, FontFamilyName, InlineStyleTable, LayoutStyleTable,
    };
    let mut inline = InlineStyleTable::new(1);
    let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
        .expect("family list");
    let style = inline
        .intern_for_node(0, rito_inline::plain_paragraph_style(families, 16.0, 0.0))
        .expect("style interns");
    let mut layout = LayoutStyleTable::new(1);
    let block = layout
        .intern_for_node(0, tests_block_style())
        .expect("layout style interns");
    let nodes = vec![
        FormattingNode {
            style: block,
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(1)],
        },
        FormattingNode {
            style: block,
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    ChapterFormattingTree {
        tree,
        image_border_paints: BTreeMap::new(),
        source_nodes: vec![None, None],
        node_paints: BTreeMap::new(),
        page_background: None,
        page_background_image: None,
        flow_item_sources: BTreeMap::new(),
        node_anchors: BTreeMap::new(),
        node_links: BTreeMap::new(),
        source_anchors: BTreeMap::new(),
        node_tags: BTreeMap::new(),
        list_markers: BTreeMap::new(),
        ruby_annotation_runs: BTreeMap::new(),
        degradations: Vec::new(),
    }
}
