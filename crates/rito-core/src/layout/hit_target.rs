use super::{
    content::{RuntimeBlock, RuntimeChild, RuntimeImage},
    line::{AtomRunBox, LineBox, LineRun, TextRunBox},
    page::RuntimePage,
    summary_json::{hash_text, number_value},
    visual_geometry::{VisualGeometry, VisualRect},
};

type HitTargetPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LayoutHitTarget {
    pub(crate) block_index: usize,
    pub(crate) line_index: usize,
    pub(crate) run_index: usize,
    pub(crate) bounds: VisualRect,
    pub(crate) text: String,
    pub(crate) href: Option<String>,
    pub(crate) source_path: Option<Vec<usize>>,
    pub(crate) source_text_offset: Option<usize>,
    pub(crate) image_src: Option<String>,
    pub(crate) image_alt: Option<String>,
}

impl LayoutHitTarget {
    pub(crate) fn text_hash(&self) -> String {
        hash_text(&self.text)
    }

    pub(crate) fn text_length(&self) -> usize {
        self.text.encode_utf16().count()
    }

    pub(crate) fn rounded_bounds(&self) -> VisualRect {
        VisualRect::new(
            rounded_number(self.bounds.x),
            rounded_number(self.bounds.y),
            rounded_number(self.bounds.width),
            rounded_number(self.bounds.height),
        )
    }
}

pub(crate) fn build_hit_targets(page: &HitTargetPage) -> (Vec<LayoutHitTarget>, String) {
    let mut text = String::new();
    let mut entries = Vec::new();
    let page_visual = VisualGeometry::page();
    for (block_index, block) in page.content.iter().enumerate() {
        let mut line_index = 0usize;
        collect_line_entries(
            block,
            block_index,
            (0.0, 0.0),
            &mut line_index,
            &mut entries,
            &mut text,
            page_visual,
        );
    }
    for (block_index, block) in page.content.iter().enumerate() {
        collect_block_image_entries(block, 0.0, 0.0, block_index, &mut entries, page_visual);
    }
    (entries, hash_text(&text))
}

fn collect_line_entries(
    block: &RuntimeBlock<LineBox>,
    block_index: usize,
    offset: (f64, f64),
    line_index: &mut usize,
    entries: &mut Vec<LayoutHitTarget>,
    text: &mut String,
    parent_visual: VisualGeometry,
) {
    let block_x = offset.0 + block.x;
    let block_y = offset.1 + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Line(line) => {
                collect_line(
                    line,
                    (block_x, block_y),
                    block_index,
                    *line_index,
                    entries,
                    text,
                    visual,
                );
                *line_index += 1;
            }
            RuntimeChild::Block(block) => collect_line_entries(
                block,
                block_index,
                (block_x, block_y),
                line_index,
                entries,
                text,
                visual,
            ),
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_line(
    line: &LineBox,
    offset: (f64, f64),
    block_index: usize,
    line_index: usize,
    entries: &mut Vec<LayoutHitTarget>,
    text: &mut String,
    visual: VisualGeometry,
) {
    let line_x = offset.0 + line.x;
    let line_y = offset.1 + line.y;
    for (run_index, run) in line.runs.iter().enumerate() {
        let entry = match run {
            LineRun::Text(run) => text_target(
                run,
                line_x,
                line_y,
                block_index,
                line_index,
                run_index,
                visual,
            ),
            LineRun::Atom(run) => atom_target(
                run,
                line_x,
                line_y,
                block_index,
                line_index,
                run_index,
                visual,
            ),
            LineRun::Ruby(_) => None,
        };
        if let Some(entry) = entry {
            text.push_str(&entry.text);
            entries.push(entry);
        }
    }
}

fn collect_block_image_entries(
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    block_index: usize,
    entries: &mut Vec<LayoutHitTarget>,
    parent_visual: VisualGeometry,
) {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Image(image) => {
                if let Some(entry) = image_target(image, block_x, block_y, block_index, visual) {
                    entries.push(entry);
                }
            }
            RuntimeChild::Block(block) => {
                collect_block_image_entries(block, block_x, block_y, block_index, entries, visual)
            }
            RuntimeChild::Line(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn text_target(
    run: &TextRunBox,
    offset_x: f64,
    offset_y: f64,
    block_index: usize,
    line_index: usize,
    run_index: usize,
    visual: VisualGeometry,
) -> Option<LayoutHitTarget> {
    let bounds = resolve_bounds(
        run.x, run.y, run.width, run.height, offset_x, offset_y, visual,
    )?;
    Some(LayoutHitTarget {
        block_index,
        line_index,
        run_index,
        bounds,
        text: run.text.clone(),
        href: run.href.clone(),
        source_path: run.source_path.clone(),
        source_text_offset: run.source_text_offset,
        image_src: None,
        image_alt: None,
    })
}

fn atom_target(
    run: &AtomRunBox,
    offset_x: f64,
    offset_y: f64,
    block_index: usize,
    line_index: usize,
    run_index: usize,
    visual: VisualGeometry,
) -> Option<LayoutHitTarget> {
    let bounds = resolve_bounds(
        run.x, run.y, run.width, run.height, offset_x, offset_y, visual,
    )?;
    Some(LayoutHitTarget {
        block_index,
        line_index,
        run_index,
        bounds,
        text: String::new(),
        href: run.href.clone(),
        source_path: None,
        source_text_offset: None,
        image_src: run.image_src.clone(),
        image_alt: run.alt.clone(),
    })
}

fn image_target(
    image: &RuntimeImage,
    offset_x: f64,
    offset_y: f64,
    block_index: usize,
    visual: VisualGeometry,
) -> Option<LayoutHitTarget> {
    let bounds = resolve_bounds(
        image.x,
        image.y,
        image.width,
        image.height,
        offset_x,
        offset_y,
        visual,
    )?;
    Some(LayoutHitTarget {
        block_index,
        line_index: 0,
        run_index: 0,
        bounds,
        text: String::new(),
        href: image.href.clone(),
        source_path: None,
        source_text_offset: None,
        image_src: Some(image.src.clone()),
        image_alt: image.alt.clone(),
    })
}

fn resolve_bounds(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    offset_x: f64,
    offset_y: f64,
    visual: VisualGeometry,
) -> Option<VisualRect> {
    visual.resolve_rect(VisualRect::new(offset_x + x, offset_y + y, width, height))
}

fn rounded_number(value: f64) -> f64 {
    number_value(value).as_f64().unwrap_or(0.0)
}
