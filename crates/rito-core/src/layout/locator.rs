use std::collections::BTreeMap;

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun},
    page::RuntimePage,
    visual_geometry::{VisualGeometry, VisualRect},
};

type LocatorPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LayoutSourceRunStart {
    pub(crate) page_index: usize,
    pub(crate) node_path: Vec<usize>,
    pub(crate) text_offset: usize,
    pub(crate) text_length: usize,
}

pub(crate) fn collect_anchor_pages(pages: &[LocatorPage]) -> BTreeMap<String, usize> {
    let mut anchors = BTreeMap::new();
    for page in pages {
        for block in &page.content {
            collect_block_anchor_pages(block, page.index, &mut anchors);
        }
    }
    anchors
}

pub(crate) fn collect_source_run_starts(pages: &[LocatorPage]) -> Vec<LayoutSourceRunStart> {
    let mut starts = Vec::new();
    for page in pages {
        for block in &page.content {
            collect_block_source_run_starts(
                block,
                page.index,
                0.0,
                0.0,
                VisualGeometry::page(),
                &mut starts,
            );
        }
    }
    starts
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

fn collect_block_source_run_starts(
    block: &RuntimeBlock<LineBox>,
    page_index: usize,
    offset_x: f64,
    offset_y: f64,
    parent_visual: VisualGeometry,
    starts: &mut Vec<LayoutSourceRunStart>,
) {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Block(child) => {
                collect_block_source_run_starts(
                    child, page_index, block_x, block_y, visual, starts,
                );
            }
            RuntimeChild::Line(line) => {
                let line_x = block_x + line.x;
                let line_y = block_y + line.y;
                for run in &line.runs {
                    let LineRun::Text(run) = run else {
                        continue;
                    };
                    if visual
                        .resolve_rect(VisualRect::new(
                            line_x + run.x,
                            line_y + run.y,
                            run.width,
                            run.height,
                        ))
                        .is_none()
                    {
                        continue;
                    }
                    let Some(source) = run.text_mapping.exact_source_slice() else {
                        continue;
                    };
                    starts.push(LayoutSourceRunStart {
                        page_index,
                        node_path: source.node_path,
                        text_offset: source.source_start,
                        text_length: source.source_length,
                    });
                }
            }
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
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
