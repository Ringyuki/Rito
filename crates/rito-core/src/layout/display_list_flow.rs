use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    content::RuntimeBlock,
    display_list::{build_display_list_commands, DisplayListTextMode},
    line::LineBox,
    page::RuntimePage,
    spread::{build_spread_slots, SpreadSlot},
    style_values::round_json_value,
    summary_json::{hash_json, number_value},
};
use crate::{
    layout::LayoutConfig,
    render::{
        count_display_commands, display_command_values, summarize_display_list_resource_refs,
        DisplayListResourceRefs,
    },
};

type DisplayListPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayListFlowSummary {
    pub spread_count: usize,
    pub spread_digests: Vec<DisplayListFlowSpreadDigest>,
    pub samples: Vec<DisplayListFlowSpreadDigest>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayListFlowSpreadDigest {
    pub spread_index: usize,
    pub page_indexes: Vec<usize>,
    pub width: Value,
    pub height: Value,
    pub command_count: usize,
    pub command_counts: BTreeMap<String, usize>,
    pub command_hash: String,
    pub render_command_hash: String,
    pub resource_refs: DisplayListResourceRefs,
}

pub(crate) fn summarize_display_list_flow(
    pages: &[DisplayListPage],
    chapter_start_pages: &BTreeSet<usize>,
    layout_config: &LayoutConfig,
) -> DisplayListFlowSummary {
    let spreads = build_spread_slots(pages.len(), chapter_start_pages, layout_config);
    let spread_digests = spreads
        .iter()
        .map(|spread| display_list_flow_spread_digest(spread, pages, layout_config))
        .collect::<Vec<_>>();
    let samples = choose_spread_sample_indices(spread_digests.len())
        .into_iter()
        .map(|index| spread_digests[index].clone())
        .collect::<Vec<_>>();
    DisplayListFlowSummary {
        spread_count: spread_digests.len(),
        full_detail_hash: hash_json(
            &serde_json::to_value(&spread_digests).expect("display list flow summaries serialize"),
        ),
        spread_digests,
        samples,
    }
}

fn display_list_flow_spread_digest(
    spread: &SpreadSlot,
    pages: &[DisplayListPage],
    layout_config: &LayoutConfig,
) -> DisplayListFlowSpreadDigest {
    let commands =
        build_display_list_commands(spread, pages, layout_config, DisplayListTextMode::Summary);
    let render_commands = build_display_list_commands(
        spread,
        pages,
        layout_config,
        DisplayListTextMode::RenderCommandHash,
    );
    let resource_refs = summarize_display_list_resource_refs(&commands);
    let command_values = display_command_values(&commands)
        .iter()
        .map(round_json_value)
        .collect::<Vec<_>>();
    let render_command_values = display_command_values(&render_commands)
        .iter()
        .map(round_json_value)
        .collect::<Vec<_>>();
    DisplayListFlowSpreadDigest {
        spread_index: spread.index,
        page_indexes: spread_slot_page_indexes(spread),
        width: number_value(layout_config.viewport_width),
        height: number_value(layout_config.viewport_height),
        command_count: commands.len(),
        command_counts: count_display_commands(&commands),
        command_hash: hash_json(&Value::Array(command_values)),
        render_command_hash: hash_json(&Value::Array(render_command_values)),
        resource_refs,
    }
}

fn spread_slot_page_indexes(spread: &SpreadSlot) -> Vec<usize> {
    let mut indexes = vec![spread.left_page_index];
    if let Some(right) = spread.right_page_index {
        indexes.push(right);
    }
    indexes
}

fn choose_spread_sample_indices(spread_count: usize) -> Vec<usize> {
    let mut indices = BTreeMap::<usize, ()>::new();
    add_sample_range(&mut indices, 0, spread_count.min(2));
    add_sample_range(&mut indices, spread_count.saturating_sub(2), spread_count);
    indices.into_keys().collect()
}

fn add_sample_range(indices: &mut BTreeMap<usize, ()>, start: usize, end: usize) {
    for index in start..end {
        indices.insert(index, ());
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use serde_json::json;

    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild},
        create_layout_config,
        display_list_flow::summarize_display_list_flow,
        line::{LineBox, LineRun, TextRunBox},
        page::RuntimePage,
        LayoutConfigInput, MarginInput, SpreadMode,
    };

    #[test]
    fn summarizes_display_list_digests_from_typed_pages() {
        let layout = create_layout_config(LayoutConfigInput {
            width: 400.0,
            height: 600.0,
            margin: MarginInput::All(0.0),
            spread: SpreadMode::Single,
            first_page_alone: false,
            spread_gap: 20.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: None,
        });

        let summary = summarize_display_list_flow(
            &[page_with_text("Display list")],
            &BTreeSet::new(),
            &layout,
        );

        assert_eq!(summary.spread_count, 1);
        assert_eq!(summary.spread_digests[0].page_indexes, vec![0]);
        assert!(summary.spread_digests[0].command_count > 0);
        assert_eq!(
            summary.spread_digests[0].command_counts.get("paintText"),
            Some(&1)
        );
    }

    fn page_with_text(text: &str) -> RuntimePage<RuntimeBlock<LineBox>> {
        RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 20.0,
                semantic_tag: None,
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                children: vec![RuntimeChild::Line(LineBox {
                    x: 0.0,
                    y: 0.0,
                    width: 300.0,
                    height: 20.0,
                    runs: vec![LineRun::Text(TextRunBox {
                        text: text.to_owned(),
                        x: 0.0,
                        y: 0.0,
                        width: 160.0,
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
                    })],
                })],
            }],
        }
    }
}
