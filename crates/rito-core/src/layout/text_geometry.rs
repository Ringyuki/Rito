use serde::{Deserialize, Serialize};

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox},
    page::RuntimePage,
    search_flow::SearchTextPosition,
    visual_geometry::{VisualGeometry, VisualRect},
};

type TextGeometryPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRangeGeometry {
    pub page_index: usize,
    pub rect_count: usize,
    pub rects: Vec<TextRangeRect>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRangeRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub block_index: usize,
    pub line_index: usize,
    pub run_index: usize,
    pub start_char_index: usize,
    pub end_char_index: usize,
}

#[derive(Debug, Clone, Copy)]
struct TextGeometryRun {
    block_index: usize,
    line_index: usize,
    run_index: usize,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    text_len: usize,
    visual: VisualGeometry,
}

pub(crate) fn build_text_range_geometry(
    page: &TextGeometryPage,
    start: SearchTextPosition,
    end: SearchTextPosition,
) -> TextRangeGeometry {
    let (start, end) = normalize_range(start, end);
    let mut runs = Vec::new();
    let page_visual = VisualGeometry::page();
    for (block_index, block) in page.content.iter().enumerate() {
        let mut line_index = 0usize;
        collect_text_geometry_runs(
            block,
            block_index,
            0.0,
            0.0,
            page_visual,
            &mut line_index,
            &mut runs,
        );
    }
    let rects = runs
        .iter()
        .filter_map(|run| text_range_rect_for_run(run, start, end))
        .collect::<Vec<_>>();
    TextRangeGeometry {
        page_index: page.index,
        rect_count: rects.len(),
        rects,
    }
}

fn collect_text_geometry_runs(
    block: &RuntimeBlock<LineBox>,
    block_index: usize,
    offset_x: f64,
    offset_y: f64,
    parent_visual: VisualGeometry,
    line_index: &mut usize,
    runs: &mut Vec<TextGeometryRun>,
) {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Line(line) => {
                collect_line_text_geometry_runs(
                    line,
                    block_index,
                    *line_index,
                    block_x,
                    block_y,
                    visual,
                    runs,
                );
                *line_index += 1;
            }
            RuntimeChild::Block(block) => {
                collect_text_geometry_runs(
                    block,
                    block_index,
                    block_x,
                    block_y,
                    visual,
                    line_index,
                    runs,
                );
            }
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_line_text_geometry_runs(
    line: &LineBox,
    block_index: usize,
    line_index: usize,
    offset_x: f64,
    offset_y: f64,
    visual: VisualGeometry,
    runs: &mut Vec<TextGeometryRun>,
) {
    let line_x = offset_x + line.x;
    let line_y = offset_y + line.y;
    for (run_index, run) in line.runs.iter().enumerate() {
        if let LineRun::Text(run) = run {
            runs.push(text_geometry_run(
                run,
                block_index,
                line_index,
                run_index,
                line_x,
                line_y,
                visual,
            ));
        }
    }
}

fn text_geometry_run(
    run: &TextRunBox,
    block_index: usize,
    line_index: usize,
    run_index: usize,
    line_x: f64,
    line_y: f64,
    visual: VisualGeometry,
) -> TextGeometryRun {
    TextGeometryRun {
        block_index,
        line_index,
        run_index,
        x: line_x + run.x,
        y: line_y + run.y,
        width: run.width,
        height: run.height,
        text_len: utf16_len(&run.text),
        visual,
    }
}

fn text_range_rect_for_run(
    run: &TextGeometryRun,
    start: SearchTextPosition,
    end: SearchTextPosition,
) -> Option<TextRangeRect> {
    if run.text_len == 0 || !range_intersects_run(run, start, end) {
        return None;
    }
    let start_char_index = if is_same_run(run, start) {
        start.char_index.min(run.text_len)
    } else {
        0
    };
    let end_char_index = if is_same_run(run, end) {
        end.char_index.min(run.text_len)
    } else {
        run.text_len
    };
    if end_char_index <= start_char_index {
        return None;
    }
    let source_x = run.x + run.width * start_char_index as f64 / run.text_len as f64;
    let source_right = run.x + run.width * end_char_index as f64 / run.text_len as f64;
    let bounds = run.visual.resolve_rect(VisualRect::new(
        source_x,
        run.y,
        source_right - source_x,
        run.height,
    ))?;
    Some(TextRangeRect {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        block_index: run.block_index,
        line_index: run.line_index,
        run_index: run.run_index,
        start_char_index,
        end_char_index,
    })
}

fn normalize_range(
    start: SearchTextPosition,
    end: SearchTextPosition,
) -> (SearchTextPosition, SearchTextPosition) {
    if position_lt(end, start) {
        (end, start)
    } else {
        (start, end)
    }
}

fn range_intersects_run(
    run: &TextGeometryRun,
    start: SearchTextPosition,
    end: SearchTextPosition,
) -> bool {
    position_lt(run_start_position(run), end) && position_lt(start, run_end_position(run))
}

fn run_start_position(run: &TextGeometryRun) -> SearchTextPosition {
    SearchTextPosition {
        block_index: run.block_index,
        line_index: run.line_index,
        run_index: run.run_index,
        char_index: 0,
    }
}

fn run_end_position(run: &TextGeometryRun) -> SearchTextPosition {
    SearchTextPosition {
        block_index: run.block_index,
        line_index: run.line_index,
        run_index: run.run_index,
        char_index: run.text_len,
    }
}

fn is_same_run(run: &TextGeometryRun, position: SearchTextPosition) -> bool {
    run.block_index == position.block_index
        && run.line_index == position.line_index
        && run.run_index == position.run_index
}

fn position_lt(left: SearchTextPosition, right: SearchTextPosition) -> bool {
    (
        left.block_index,
        left.line_index,
        left.run_index,
        left.char_index,
    ) < (
        right.block_index,
        right.line_index,
        right.run_index,
        right.char_index,
    )
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::build_text_range_geometry;
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild},
        line::{LineBox, LineRun, TextRunBox},
        page::RuntimePage,
        SearchTextPosition,
    };

    #[test]
    fn returns_partial_geometry_for_a_single_run_range() {
        let page = page_with_two_text_runs("Hello", "world");

        let geometry = build_text_range_geometry(
            &page,
            SearchTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: 0,
                char_index: 1,
            },
            SearchTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: 0,
                char_index: 4,
            },
        );

        assert_eq!(geometry.page_index, 3);
        assert_eq!(geometry.rect_count, 1);
        assert_eq!(geometry.rects[0].x, 18.0);
        assert_eq!(geometry.rects[0].width, 24.0);
        assert_eq!(geometry.rects[0].start_char_index, 1);
        assert_eq!(geometry.rects[0].end_char_index, 4);
    }

    #[test]
    fn spans_multiple_text_runs_in_page_content_order() {
        let page = page_with_two_text_runs("Hello", "world");

        let geometry = build_text_range_geometry(
            &page,
            SearchTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: 0,
                char_index: 3,
            },
            SearchTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: 1,
                char_index: 2,
            },
        );

        assert_eq!(geometry.rect_count, 2);
        assert_eq!(geometry.rects[0].start_char_index, 3);
        assert_eq!(geometry.rects[0].end_char_index, 5);
        assert_eq!(geometry.rects[1].start_char_index, 0);
        assert_eq!(geometry.rects[1].end_char_index, 2);
    }

    #[test]
    fn normalizes_reverse_ranges_and_applies_visual_offsets() {
        let mut page = page_with_two_text_runs("Hello", "world");
        page.content[0].paint = Some(json!({ "visualOffset": { "dx": 5, "dy": 7 } }));

        let geometry = build_text_range_geometry(
            &page,
            SearchTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: 0,
                char_index: 4,
            },
            SearchTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: 0,
                char_index: 1,
            },
        );

        assert_eq!(geometry.rect_count, 1);
        assert_eq!(geometry.rects[0].x, 23.0);
        assert_eq!(geometry.rects[0].y, 34.0);
        assert_eq!(geometry.rects[0].width, 24.0);
    }

    fn page_with_two_text_runs(first: &str, second: &str) -> RuntimePage<RuntimeBlock<LineBox>> {
        RuntimePage {
            index: 3,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 10.0,
                y: 20.0,
                width: 300.0,
                height: 40.0,
                semantic_tag: None,
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![RuntimeChild::Line(LineBox {
                    x: 0.0,
                    y: 5.0,
                    width: 200.0,
                    height: 20.0,
                    runs: vec![
                        LineRun::Text(text_run(first, 0.0, 40.0)),
                        LineRun::Text(text_run(second, 50.0, 50.0)),
                    ],
                })],
            }],
        }
    }

    fn text_run(text: &str, x: f64, width: f64) -> TextRunBox {
        TextRunBox {
            text: text.to_owned(),
            text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
            x,
            y: 2.0,
            width,
            height: 12.0,
            font_size: 12.0,
            paint: json!({}),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
            shape: crate::layout::text_shape::fixture_run_shape(width),
        }
    }
}
