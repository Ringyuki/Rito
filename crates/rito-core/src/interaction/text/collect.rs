use crate::layout::{
    LayoutRuntimePage, LineBox, LineRun, RuntimeBlock, RuntimeChild, TextRunBox, VisualGeometry,
    VisualRect,
};

#[derive(Debug, Clone, Copy)]
pub(super) struct CollectedTextRun<'a> {
    pub(super) page_index: usize,
    pub(super) block_index: usize,
    pub(super) line_index: usize,
    pub(super) run_index: usize,
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) run: &'a TextRunBox,
    pub(super) visual: VisualGeometry,
}

impl CollectedTextRun<'_> {
    pub(super) fn source_rect(self) -> VisualRect {
        VisualRect::new(self.x, self.y, self.run.width, self.run.height)
    }

    pub(super) fn visible_rect(self) -> Option<VisualRect> {
        self.visual.resolve_rect(self.source_rect())
    }

    pub(super) fn matches_address(self, address: super::TextCaretAddress) -> bool {
        self.page_index == address.page_index
            && self.block_index == address.block_index
            && self.line_index == address.line_index
            && self.run_index == address.run_index
    }
}

pub(super) fn collect_page_text_runs(
    page_index: usize,
    page: &LayoutRuntimePage,
) -> Vec<CollectedTextRun<'_>> {
    let mut runs = Vec::new();
    let page_visual = VisualGeometry::page();
    for (block_index, block) in page.content.iter().enumerate() {
        let mut line_index = 0;
        collect_block_runs(
            page_index,
            block_index,
            block,
            0.0,
            0.0,
            page_visual,
            &mut line_index,
            &mut runs,
        );
    }
    runs
}

pub(super) fn collect_text_runs_in_page_range(
    pages: &[LayoutRuntimePage],
    first_page: usize,
    last_page: usize,
) -> Vec<CollectedTextRun<'_>> {
    let Some(selected) = pages.get(first_page..=last_page) else {
        return Vec::new();
    };
    selected
        .iter()
        .enumerate()
        .flat_map(|(offset, page)| collect_page_text_runs(first_page + offset, page))
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn collect_block_runs<'a>(
    page_index: usize,
    block_index: usize,
    block: &'a RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    parent_visual: VisualGeometry,
    line_index: &mut usize,
    runs: &mut Vec<CollectedTextRun<'a>>,
) {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Line(line) => {
                collect_line_runs(
                    page_index,
                    block_index,
                    *line_index,
                    line,
                    block_x,
                    block_y,
                    visual,
                    runs,
                );
                *line_index += 1;
            }
            RuntimeChild::Block(child) => collect_block_runs(
                page_index,
                block_index,
                child,
                block_x,
                block_y,
                visual,
                line_index,
                runs,
            ),
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_line_runs<'a>(
    page_index: usize,
    block_index: usize,
    line_index: usize,
    line: &'a LineBox,
    offset_x: f64,
    offset_y: f64,
    visual: VisualGeometry,
    runs: &mut Vec<CollectedTextRun<'a>>,
) {
    let line_x = offset_x + line.x;
    let line_y = offset_y + line.y;
    for (run_index, run) in line.runs.iter().enumerate() {
        if let LineRun::Text(run) = run {
            runs.push(CollectedTextRun {
                page_index,
                block_index,
                line_index,
                run_index,
                x: line_x + run.x,
                y: line_y + run.y,
                run,
                visual,
            });
        }
    }
}
