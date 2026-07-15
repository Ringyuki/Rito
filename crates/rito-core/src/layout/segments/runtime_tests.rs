use super::{append_runtime_chapter_pages, create_empty_runtime_layout};
use crate::layout::{
    build_spread_slots, create_layout_config,
    pagination_flow::{
        build_pagination_flow, build_runtime_pagination_flow, PaginationFlowChapter,
    },
    BuiltLayout, LayoutConfig, LayoutConfigInput, LayoutRuntimePage, MarginInput, SpreadMode,
};

#[test]
fn runtime_pagination_keeps_diagnostics_lean_without_changing_pages() {
    let config = runtime_layout_config(SpreadMode::Double, true);
    let chapters = [PaginationFlowChapter {
        idref: "chapter".to_owned(),
        block_count: 0,
        pages: runtime_pages(3),
    }];

    let detailed = build_pagination_flow(&chapters, &config);
    let runtime = build_runtime_pagination_flow(&chapters, &config);

    assert_eq!(runtime.pages, detailed.pages);
    assert!(!detailed.summary.spread_flow.spreads.is_empty());
    assert!(!detailed.summary.spread_flow.full_detail_hash.is_empty());
    assert!(runtime.summary.spread_flow.spreads.is_empty());
    assert!(runtime.summary.spread_flow.full_detail_hash.is_empty());
}

#[test]
fn runtime_summary_extents_update_incrementally_across_chapters() {
    let appends = [
        ("chapter-a", 1, 1),
        ("chapter-a", 2, 3),
        ("chapter-a", 0, 4),
        ("chapter-b", 0, 0),
        ("chapter-b", 1, 1),
        ("chapter-b", 4, 5),
        ("chapter-c", 2, 2),
    ];
    for spread_mode in [SpreadMode::Single, SpreadMode::Double] {
        for first_page_alone in [false, true] {
            let layout_config = runtime_layout_config(spread_mode, first_page_alone);
            let mut layout = create_empty_runtime_layout(3, &layout_config);
            assert_runtime_summary_is_lean(&layout, &layout_config);

            for (idref, page_count, block_count) in appends {
                append_runtime_chapter_pages(
                    &mut layout,
                    idref,
                    block_count,
                    runtime_pages(page_count),
                    &layout_config,
                );
                assert_runtime_summary_is_lean(&layout, &layout_config);
            }

            assert_eq!(layout.summary.pagination_flow.chapter_map.len(), 3);
            assert_eq!(
                layout.summary.pagination_flow.chapter_map["chapter-a"].page_count,
                3
            );
            assert_eq!(
                layout.summary.pagination_flow.chapter_map["chapter-a"].block_count,
                4
            );
            assert_eq!(
                layout.summary.pagination_flow.chapter_map["chapter-b"].page_count,
                5
            );
            assert_eq!(
                layout.summary.pagination_flow.chapter_map["chapter-c"].page_count,
                2
            );
        }
    }
}

fn runtime_layout_config(spread_mode: SpreadMode, first_page_alone: bool) -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 320.0,
        height: 240.0,
        margin: MarginInput::All(10.0),
        spread: spread_mode,
        first_page_alone,
        spread_gap: 20.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}

fn runtime_pages(count: usize) -> Vec<LayoutRuntimePage> {
    (0..count)
        .map(|_| LayoutRuntimePage::new(0, 320.0, 240.0, None, Vec::new()))
        .collect()
}

fn assert_runtime_summary_is_lean(layout: &BuiltLayout, config: &LayoutConfig) {
    let pagination = &layout.summary.pagination_flow;
    let expected_spread_count =
        build_spread_slots(layout.pages.len(), &layout.chapter_start_pages, config).len();
    assert_eq!(pagination.page_count, layout.pages.len());
    assert_eq!(pagination.spread_flow.page_count, layout.pages.len());
    assert_eq!(pagination.spread_flow.spread_count, expected_spread_count);
    assert_eq!(
        pagination.display_list_flow.spread_count,
        expected_spread_count
    );
    assert_eq!(pagination.hit_map_flow.page_count, layout.pages.len());
    assert_eq!(pagination.text_position_flow.page_count, layout.pages.len());
    assert_eq!(pagination.link_map_flow.page_count, layout.pages.len());
    assert!(pagination.page_digests.is_empty() && pagination.samples.is_empty());
    assert!(pagination.spread_flow.spreads.is_empty());
    assert!(pagination.spread_flow.samples.is_empty());
    assert!(pagination.spread_flow.full_detail_hash.is_empty());
    assert!(pagination.display_list_flow.spread_digests.is_empty());
    assert!(pagination.display_list_flow.samples.is_empty());
    assert!(pagination.display_list_flow.full_detail_hash.is_empty());
    assert!(pagination.full_detail_hash.is_empty());
}
