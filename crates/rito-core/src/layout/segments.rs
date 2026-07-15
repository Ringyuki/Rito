use serde_json::Value;

use super::{
    continuous_layout::{
        summarize_continuous_blocks_for_chapter, summarize_pagination_flow_for_chapter,
    },
    image_size::ImageSizeIndex,
    pagination_flow::{
        build_pagination_flow, build_runtime_pagination_flow, update_runtime_pagination_extent,
        PaginationFlowChapter, PaginationFlowChapterRange,
    },
    segment_details::{
        collect_block_details, continuous_blocks_full_detail_hash,
        inline_segments_full_detail_hash, line_boxes_full_detail_hash,
        line_break_inputs_full_detail_hash, InlineSegmentBlockDetail,
    },
    spread::chapter_spread_count,
    summary_json::{hash_json, hash_text},
    summary_types::{
        ContinuousBlockChapterSummary, ContinuousBlockSummary, InlineSegmentChapterSummary,
        InlineSegmentSummary, LayoutSummary, LineBoxChapterSummary, LineBoxSummary,
        LineBreakInputChapterSummary, LineBreakInputSummary,
    },
    text_measure::TextMeasurementFonts,
};
use crate::{
    layout::{BuiltLayout, LayoutConfig, LineBreaking},
    resources::PublicationResources,
    style::StyledNode,
};

pub(crate) struct InlineSegmentChapterInput<'a> {
    pub idref: &'a str,
    pub href: &'a str,
    pub styled_nodes: Vec<StyledNode>,
    pub pagination_styled_nodes: Option<Vec<StyledNode>>,
    pub page_paint: Option<Value>,
}

pub(crate) fn build_inline_segments<'a>(
    chapters: impl IntoIterator<Item = InlineSegmentChapterInput<'a>>,
    resources: &PublicationResources,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> BuiltLayout {
    let image_sizes = ImageSizeIndex::new(&resources.images);
    let chapters = chapters
        .into_iter()
        .map(|chapter| {
            summarize_chapter(chapter, &image_sizes, layout_config, line_breaking, fonts)
        })
        .collect::<Vec<_>>();
    let inline_chapters = chapters
        .iter()
        .map(|chapter| chapter.inline_segments.clone())
        .collect::<Vec<_>>();
    let line_break_chapters = chapters
        .iter()
        .map(|chapter| chapter.line_break_inputs.clone())
        .collect::<Vec<_>>();
    let line_box_chapters = chapters
        .iter()
        .map(|chapter| chapter.line_boxes.clone())
        .collect::<Vec<_>>();
    let continuous_block_chapters = chapters
        .iter()
        .map(|chapter| chapter.continuous_blocks.clone())
        .collect::<Vec<_>>();
    let pagination_flow_chapters = chapters
        .iter()
        .map(|chapter| chapter.pagination_flow.clone())
        .collect::<Vec<_>>();
    let pagination_flow = build_pagination_flow(&pagination_flow_chapters, layout_config);

    let summary = LayoutSummary {
        inline_segments: InlineSegmentSummary {
            chapter_count: inline_chapters.len(),
            total_block_count: inline_chapters
                .iter()
                .map(|chapter| chapter.block_count)
                .sum(),
            total_segment_count: inline_chapters
                .iter()
                .map(|chapter| chapter.segment_count)
                .sum(),
            total_atom_count: inline_chapters
                .iter()
                .map(|chapter| chapter.atom_count)
                .sum(),
            full_detail_hash: inline_segments_full_detail_hash(&inline_chapters),
            chapters: inline_chapters,
        },
        line_break_inputs: LineBreakInputSummary {
            chapter_count: line_break_chapters.len(),
            total_block_count: line_break_chapters
                .iter()
                .map(|chapter| chapter.block_count)
                .sum(),
            total_range_count: line_break_chapters
                .iter()
                .map(|chapter| chapter.range_count)
                .sum(),
            total_atom_count: line_break_chapters
                .iter()
                .map(|chapter| chapter.atom_count)
                .sum(),
            full_detail_hash: line_break_inputs_full_detail_hash(&line_break_chapters),
            chapters: line_break_chapters,
        },
        line_boxes: LineBoxSummary {
            chapter_count: line_box_chapters.len(),
            total_block_count: line_box_chapters
                .iter()
                .map(|chapter| chapter.block_count)
                .sum(),
            total_line_count: line_box_chapters
                .iter()
                .map(|chapter| chapter.line_count)
                .sum(),
            total_run_count: line_box_chapters
                .iter()
                .map(|chapter| chapter.run_count)
                .sum(),
            total_atom_count: line_box_chapters
                .iter()
                .map(|chapter| chapter.atom_count)
                .sum(),
            total_ruby_count: line_box_chapters
                .iter()
                .map(|chapter| chapter.ruby_count)
                .sum(),
            full_detail_hash: line_boxes_full_detail_hash(&line_box_chapters),
            chapters: line_box_chapters,
        },
        continuous_blocks: ContinuousBlockSummary {
            chapter_count: continuous_block_chapters.len(),
            total_top_level_block_count: continuous_block_chapters
                .iter()
                .map(|chapter| chapter.top_level_block_count)
                .sum(),
            total_line_count: continuous_block_chapters
                .iter()
                .map(|chapter| chapter.line_count)
                .sum(),
            total_text_run_count: continuous_block_chapters
                .iter()
                .map(|chapter| chapter.text_run_count)
                .sum(),
            total_image_count: continuous_block_chapters
                .iter()
                .map(|chapter| chapter.image_count)
                .sum(),
            total_hr_count: continuous_block_chapters
                .iter()
                .map(|chapter| chapter.hr_count)
                .sum(),
            full_detail_hash: continuous_blocks_full_detail_hash(&continuous_block_chapters),
            chapters: continuous_block_chapters,
        },
        pagination_flow: pagination_flow.summary,
    };

    BuiltLayout {
        summary,
        pages: pagination_flow.pages,
        chapter_start_pages: pagination_flow.chapter_start_pages,
    }
}

pub(crate) fn build_inline_segments_runtime<'a>(
    chapters: impl IntoIterator<Item = InlineSegmentChapterInput<'a>>,
    resources: &PublicationResources,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> BuiltLayout {
    let image_sizes = ImageSizeIndex::new(&resources.images);
    let chapters = chapters
        .into_iter()
        .map(|chapter| {
            runtime_pagination_chapter(chapter, &image_sizes, layout_config, line_breaking, fonts)
        })
        .collect::<Vec<_>>();
    let pagination_flow = build_runtime_pagination_flow(&chapters, layout_config);
    let summary = runtime_layout_summary(chapters.len(), pagination_flow.summary);

    BuiltLayout {
        summary,
        pages: pagination_flow.pages,
        chapter_start_pages: pagination_flow.chapter_start_pages,
    }
}

pub(crate) fn create_empty_runtime_layout(
    chapter_count: usize,
    layout_config: &LayoutConfig,
) -> BuiltLayout {
    let pagination_flow = build_runtime_pagination_flow(&[], layout_config);
    BuiltLayout {
        summary: runtime_layout_summary(chapter_count, pagination_flow.summary),
        pages: pagination_flow.pages,
        chapter_start_pages: pagination_flow.chapter_start_pages,
    }
}

pub(crate) fn append_runtime_chapter_pages(
    layout: &mut BuiltLayout,
    idref: &str,
    block_count: usize,
    pages: Vec<super::LayoutRuntimePage>,
    layout_config: &LayoutConfig,
) {
    let previous = runtime_chapter_append_state(layout, idref);
    for mut page in pages {
        page.set_index(layout.pages.len());
        layout.pages.push(page);
    }
    let page_count = layout.pages.len();
    let next_chapter_page_count = page_count
        .checked_sub(previous.start_page)
        .expect("runtime chapter start must not exceed the page count");
    update_runtime_chapter_range(
        layout,
        idref,
        previous.start_page,
        previous.chapter_page_count,
        next_chapter_page_count,
        block_count,
    );
    let spread_count =
        updated_runtime_spread_count(previous, next_chapter_page_count, layout_config);
    update_runtime_pagination_extent(
        &mut layout.summary.pagination_flow,
        page_count,
        spread_count,
    );
}

#[derive(Debug, Clone, Copy)]
struct RuntimeChapterAppendState {
    start_page: usize,
    chapter_page_count: usize,
    spread_count: usize,
}

fn runtime_chapter_append_state(layout: &BuiltLayout, idref: &str) -> RuntimeChapterAppendState {
    let pagination = &layout.summary.pagination_flow;
    let spread_count = pagination.display_list_flow.spread_count;
    debug_assert_eq!(pagination.spread_flow.spread_count, spread_count);
    let Some(range) = pagination.chapter_map.get(idref) else {
        return RuntimeChapterAppendState {
            start_page: layout.pages.len(),
            chapter_page_count: 0,
            spread_count,
        };
    };
    debug_assert_eq!(
        range.start_page.checked_add(range.page_count),
        Some(layout.pages.len()),
        "runtime chapter pages must append in spine order"
    );
    debug_assert_eq!(
        range.end_page.checked_add(1),
        Some(layout.pages.len()),
        "runtime chapter range must end at the published tail"
    );
    RuntimeChapterAppendState {
        start_page: range.start_page,
        chapter_page_count: range.page_count,
        spread_count,
    }
}

fn updated_runtime_spread_count(
    previous: RuntimeChapterAppendState,
    next_chapter_page_count: usize,
    layout_config: &LayoutConfig,
) -> usize {
    let previous_chapter_spreads = chapter_spread_count(
        previous.start_page,
        previous.chapter_page_count,
        layout_config,
    );
    let next_chapter_spreads =
        chapter_spread_count(previous.start_page, next_chapter_page_count, layout_config);
    previous
        .spread_count
        .checked_sub(previous_chapter_spreads)
        .and_then(|count| count.checked_add(next_chapter_spreads))
        .expect("runtime spread count must remain representable")
}

fn update_runtime_chapter_range(
    layout: &mut BuiltLayout,
    idref: &str,
    start_page: usize,
    previous_page_count: usize,
    next_page_count: usize,
    block_count: usize,
) {
    if next_page_count == 0 {
        return;
    }
    if previous_page_count == 0 {
        layout.chapter_start_pages.insert(start_page);
        layout.summary.pagination_flow.chapter_map.insert(
            idref.to_owned(),
            PaginationFlowChapterRange {
                start_page,
                end_page: layout.pages.len() - 1,
                page_count: next_page_count,
                block_count,
            },
        );
        return;
    }
    let range = layout
        .summary
        .pagination_flow
        .chapter_map
        .get_mut(idref)
        .expect("published runtime chapter range exists");
    range.end_page = layout.pages.len() - 1;
    range.page_count = next_page_count;
    range.block_count = block_count;
}

#[derive(Debug)]
struct ChapterLayoutSummary {
    inline_segments: InlineSegmentChapterSummary,
    line_break_inputs: LineBreakInputChapterSummary,
    line_boxes: LineBoxChapterSummary,
    continuous_blocks: ContinuousBlockChapterSummary,
    pagination_flow: PaginationFlowChapter,
}

fn runtime_pagination_chapter(
    chapter: InlineSegmentChapterInput<'_>,
    image_sizes: &ImageSizeIndex,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> PaginationFlowChapter {
    summarize_pagination_flow_for_chapter(
        chapter.idref,
        chapter
            .pagination_styled_nodes
            .as_deref()
            .unwrap_or(&chapter.styled_nodes),
        chapter.page_paint,
        image_sizes,
        layout_config,
        line_breaking,
        fonts,
    )
}

fn runtime_layout_summary(
    chapter_count: usize,
    pagination_flow: super::pagination_flow::PaginationFlowSummary,
) -> LayoutSummary {
    LayoutSummary {
        inline_segments: InlineSegmentSummary {
            chapter_count,
            total_block_count: 0,
            total_segment_count: 0,
            total_atom_count: 0,
            chapters: Vec::new(),
            full_detail_hash: String::new(),
        },
        line_break_inputs: LineBreakInputSummary {
            chapter_count,
            total_block_count: 0,
            total_range_count: 0,
            total_atom_count: 0,
            chapters: Vec::new(),
            full_detail_hash: String::new(),
        },
        line_boxes: LineBoxSummary {
            chapter_count,
            total_block_count: 0,
            total_line_count: 0,
            total_run_count: 0,
            total_atom_count: 0,
            total_ruby_count: 0,
            chapters: Vec::new(),
            full_detail_hash: String::new(),
        },
        continuous_blocks: ContinuousBlockSummary {
            chapter_count,
            total_top_level_block_count: 0,
            total_line_count: 0,
            total_text_run_count: 0,
            total_image_count: 0,
            total_hr_count: 0,
            chapters: Vec::new(),
            full_detail_hash: String::new(),
        },
        pagination_flow,
    }
}

fn summarize_chapter(
    chapter: InlineSegmentChapterInput<'_>,
    image_sizes: &ImageSizeIndex,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> ChapterLayoutSummary {
    let details = collect_block_details(
        &chapter.styled_nodes,
        image_sizes,
        layout_config.content_width(),
        line_breaking,
        fonts,
    );
    let inline_blocks = details
        .iter()
        .map(InlineSegmentBlockDetail::summary)
        .collect::<Vec<_>>();
    let inline_samples = details
        .iter()
        .take(8)
        .map(InlineSegmentBlockDetail::sample)
        .collect::<Vec<_>>();
    let chapter_text = details
        .iter()
        .map(|detail| detail.text.as_str())
        .collect::<String>();
    let line_break_blocks = details
        .iter()
        .map(|detail| detail.line_break.summary())
        .collect::<Vec<_>>();
    let line_break_samples = details
        .iter()
        .take(8)
        .map(|detail| detail.line_break.sample())
        .collect::<Vec<_>>();
    let full_text = details
        .iter()
        .map(|detail| detail.line_break.full_text.as_str())
        .collect::<String>();
    let line_box_blocks = details
        .iter()
        .map(|detail| detail.line_boxes.summary())
        .collect::<Vec<_>>();
    let line_box_samples = details
        .iter()
        .take(8)
        .map(|detail| detail.line_boxes.sample())
        .collect::<Vec<_>>();
    let line_box_text = details
        .iter()
        .map(|detail| detail.line_boxes.text.as_str())
        .collect::<String>();
    let continuous_blocks = summarize_continuous_blocks_for_chapter(
        chapter.idref,
        chapter.href,
        &chapter.styled_nodes,
        image_sizes,
        layout_config,
        line_breaking,
        fonts,
    );
    let pagination_flow = summarize_pagination_flow_for_chapter(
        chapter.idref,
        chapter
            .pagination_styled_nodes
            .as_deref()
            .unwrap_or(&chapter.styled_nodes),
        chapter.page_paint.clone(),
        image_sizes,
        layout_config,
        line_breaking,
        fonts,
    );

    ChapterLayoutSummary {
        inline_segments: InlineSegmentChapterSummary {
            idref: chapter.idref.to_owned(),
            href: chapter.href.to_owned(),
            block_count: details.len(),
            segment_count: details.iter().map(|detail| detail.segment_count).sum(),
            atom_count: details.iter().map(|detail| detail.atom_count).sum(),
            text_hash: hash_text(&chapter_text),
            detail_hash: hash_json(
                &serde_json::to_value(&inline_blocks).expect("block summaries serialize"),
            ),
            blocks: inline_blocks,
            samples: inline_samples,
        },
        line_break_inputs: LineBreakInputChapterSummary {
            idref: chapter.idref.to_owned(),
            href: chapter.href.to_owned(),
            block_count: details.len(),
            range_count: details
                .iter()
                .map(|detail| detail.line_break.range_count)
                .sum(),
            atom_count: details
                .iter()
                .map(|detail| detail.line_break.atom_count)
                .sum(),
            full_text_hash: hash_text(&full_text),
            detail_hash: hash_json(
                &serde_json::to_value(&line_break_blocks)
                    .expect("line break block summaries serialize"),
            ),
            blocks: line_break_blocks,
            samples: line_break_samples,
        },
        line_boxes: LineBoxChapterSummary {
            idref: chapter.idref.to_owned(),
            href: chapter.href.to_owned(),
            block_count: details.len(),
            line_count: details
                .iter()
                .map(|detail| detail.line_boxes.line_count)
                .sum(),
            run_count: details
                .iter()
                .map(|detail| detail.line_boxes.run_count)
                .sum(),
            atom_count: details
                .iter()
                .map(|detail| detail.line_boxes.atom_count)
                .sum(),
            ruby_count: details
                .iter()
                .map(|detail| detail.line_boxes.ruby_count)
                .sum(),
            text_hash: hash_text(&line_box_text),
            detail_hash: hash_json(
                &serde_json::to_value(&line_box_blocks).expect("line box summaries serialize"),
            ),
            blocks: line_box_blocks,
            samples: line_box_samples,
        },
        continuous_blocks,
        pagination_flow,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map, Value};

    use super::{build_inline_segments, InlineSegmentChapterInput};
    use crate::{
        layout::TextMeasurementFonts,
        layout::{create_layout_config, LayoutConfigInput, LineBreaking, MarginInput, SpreadMode},
        resources::PublicationResources,
        style::{StyledNode, StyledNodeKind},
    };

    #[test]
    fn internal_layout_orchestration_accepts_optimal_line_breaking() {
        let layout = create_layout_config(LayoutConfigInput {
            width: 75.0,
            height: 200.0,
            margin: MarginInput::All(0.0),
            spread: SpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 10.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: None,
        });
        let resources = PublicationResources {
            stylesheets: Vec::new(),
            fonts: Vec::new(),
            images: Vec::new(),
        };

        let greedy = build_inline_segments(
            [chapter_input(text_block("one two three four"))],
            &resources,
            &layout,
            LineBreaking::Greedy,
            &TextMeasurementFonts::empty(),
        );
        let optimal = build_inline_segments(
            [chapter_input(text_block("one two three four"))],
            &resources,
            &layout,
            LineBreaking::Optimal,
            &TextMeasurementFonts::empty(),
        );

        assert_eq!(optimal.summary.line_boxes.total_line_count, 2);
        assert_eq!(optimal.summary.pagination_flow.page_count, 1);
        assert_ne!(
            optimal.summary.line_boxes.full_detail_hash,
            greedy.summary.line_boxes.full_detail_hash
        );
    }

    fn chapter_input(styled_node: StyledNode) -> InlineSegmentChapterInput<'static> {
        InlineSegmentChapterInput {
            idref: "chapter-1",
            href: "chapter-1.xhtml",
            styled_nodes: vec![styled_node.clone()],
            pagination_styled_nodes: Some(vec![styled_node]),
            page_paint: None,
        }
    }

    fn text_block(text: &str) -> StyledNode {
        StyledNode {
            node_type: StyledNodeKind::Block,
            tag: Some("p".to_owned()),
            content: None,
            source_text: None,
            src: None,
            alt: None,
            id: None,
            href: None,
            colspan: None,
            rowspan: None,
            style: style(),
            children: vec![StyledNode {
                node_type: StyledNodeKind::Text,
                tag: None,
                content: Some(text.to_owned()),
                source_text: None,
                src: None,
                alt: None,
                id: None,
                href: None,
                colspan: None,
                rowspan: None,
                style: style(),
                children: Vec::new(),
                source_ref: None,
            }],
            source_ref: None,
        }
    }

    fn style() -> Map<String, Value> {
        Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("lineHeightPx".to_owned(), json!(12)),
            ("display".to_owned(), Value::String("block".to_owned())),
        ])
    }
}

#[cfg(test)]
#[path = "segments/runtime_tests.rs"]
mod runtime_tests;
