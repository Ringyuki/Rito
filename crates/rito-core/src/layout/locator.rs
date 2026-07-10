use std::collections::BTreeMap;

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::LineBox,
    page::RuntimePage,
};

type LocatorPage = RuntimePage<RuntimeBlock<LineBox>>;

pub(crate) fn collect_anchor_pages(pages: &[LocatorPage]) -> BTreeMap<String, usize> {
    let mut anchors = BTreeMap::new();
    for page in pages {
        for block in &page.content {
            collect_block_anchor_pages(block, page.index, &mut anchors);
        }
    }
    anchors
}

fn collect_block_anchor_pages(
    block: &RuntimeBlock<LineBox>,
    page_index: usize,
    anchors: &mut BTreeMap<String, usize>,
) {
    if let Some(anchor_id) = &block.anchor_id {
        anchors.entry(anchor_id.clone()).or_insert(page_index);
    }
    for child in &block.children {
        if let RuntimeChild::Block(child) = child {
            collect_block_anchor_pages(child, page_index, anchors);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::collect_anchor_pages;
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild},
        line::LineBox,
        page::RuntimePage,
    };

    #[test]
    fn collects_first_page_for_nested_anchors() {
        let pages = vec![
            page(0, Some("intro"), vec![]),
            page(1, Some("intro"), vec![block(Some("nested"), vec![])]),
        ];

        let anchors = collect_anchor_pages(&pages);

        assert_eq!(anchors.get("intro"), Some(&0));
        assert_eq!(anchors.get("nested"), Some(&1));
    }

    fn page(
        index: usize,
        anchor_id: Option<&str>,
        children: Vec<RuntimeBlock<LineBox>>,
    ) -> RuntimePage<RuntimeBlock<LineBox>> {
        RuntimePage {
            index,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![block(anchor_id, children)],
        }
    }

    fn block(
        anchor_id: Option<&str>,
        children: Vec<RuntimeBlock<LineBox>>,
    ) -> RuntimeBlock<LineBox> {
        RuntimeBlock {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 20.0,
            semantic_tag: None,
            anchor_id: anchor_id.map(str::to_owned),
            paint: None,
            border_box: None,
            page_break_before: false,
            page_break_after: false,
            orphans: None,
            widows: None,
            children: children
                .into_iter()
                .map(|child| RuntimeChild::Block(Box::new(child)))
                .collect(),
        }
    }
}
