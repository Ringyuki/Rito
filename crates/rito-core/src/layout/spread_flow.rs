use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Number, Value};

use super::{
    spread::{build_spread_slots, SpreadSlot},
    summary_json::hash_json,
};
use crate::layout::LayoutConfig;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadFlowSummary {
    pub page_count: usize,
    pub spread_count: usize,
    pub spreads: Vec<Value>,
    pub samples: Vec<Value>,
    pub full_detail_hash: String,
}

pub(crate) fn summarize_spread_flow(
    page_count: usize,
    chapter_start_pages: &BTreeSet<usize>,
    layout_config: &LayoutConfig,
) -> SpreadFlowSummary {
    let spreads = build_spread_slots(page_count, chapter_start_pages, layout_config)
        .iter()
        .map(spread_flow_value)
        .collect::<Vec<_>>();
    let samples = choose_spread_sample_indices(spreads.len())
        .into_iter()
        .map(|index| spreads[index].clone())
        .collect::<Vec<_>>();
    SpreadFlowSummary {
        page_count,
        spread_count: spreads.len(),
        samples,
        full_detail_hash: hash_json(&Value::Array(spreads.clone())),
        spreads,
    }
}

fn spread_flow_value(spread: &SpreadSlot) -> Value {
    let mut page_indexes = vec![Value::Number(Number::from(spread.left_page_index))];
    if let Some(right) = spread.right_page_index {
        page_indexes.push(Value::Number(Number::from(right)));
    }
    json!({
        "index": spread.index,
        "leftPageIndex": spread.left_page_index,
        "pageIndexes": page_indexes,
        "rightPageIndex": spread.right_page_index,
    })
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

    use crate::layout::{
        create_layout_config, spread_flow::summarize_spread_flow, LayoutConfigInput, MarginInput,
        SpreadMode,
    };

    #[test]
    fn summarizes_spreads_from_typed_spread_slots() {
        let layout = create_layout_config(LayoutConfigInput {
            width: 800.0,
            height: 600.0,
            margin: MarginInput::All(20.0),
            spread: SpreadMode::Double,
            first_page_alone: true,
            spread_gap: 20.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: None,
        });
        let mut chapter_starts = BTreeSet::new();
        chapter_starts.insert(2);

        let summary = summarize_spread_flow(4, &chapter_starts, &layout);

        assert_eq!(summary.page_count, 4);
        assert_eq!(summary.spread_count, 3);
        assert_eq!(summary.samples.len(), 3);
    }
}
