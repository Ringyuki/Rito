use std::collections::BTreeSet;

use super::{LayoutConfig, SpreadMode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SpreadSlot {
    pub(crate) index: usize,
    pub(crate) left_page_index: usize,
    pub(crate) right_page_index: Option<usize>,
}

pub(crate) fn build_spread_slots(
    page_count: usize,
    chapter_start_pages: &BTreeSet<usize>,
    layout_config: &LayoutConfig,
) -> Vec<SpreadSlot> {
    if page_count == 0 {
        return Vec::new();
    }
    if layout_config.spread_mode == SpreadMode::Single {
        return (0..page_count)
            .map(|index| SpreadSlot {
                index,
                left_page_index: index,
                right_page_index: None,
            })
            .collect();
    }

    build_double_spread_slots(page_count, chapter_start_pages, layout_config)
}

fn build_double_spread_slots(
    page_count: usize,
    chapter_start_pages: &BTreeSet<usize>,
    layout_config: &LayoutConfig,
) -> Vec<SpreadSlot> {
    let mut spreads = Vec::new();
    let mut page_index = 0usize;
    if layout_config.first_page_alone {
        spreads.push(SpreadSlot {
            index: spreads.len(),
            left_page_index: 0,
            right_page_index: None,
        });
        page_index = 1;
    }

    while page_index < page_count {
        let right = if page_index + 1 < page_count {
            Some(page_index + 1)
        } else {
            None
        };
        let include_right = right.is_some_and(|index| !chapter_start_pages.contains(&index));
        spreads.push(SpreadSlot {
            index: spreads.len(),
            left_page_index: page_index,
            right_page_index: if include_right { right } else { None },
        });
        page_index += if include_right { 2 } else { 1 };
    }
    spreads
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::build_spread_slots;
    use crate::layout::{
        create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
    };

    #[test]
    fn single_spread_mode_maps_each_page_to_one_slot() {
        let slots = build_spread_slots(3, &BTreeSet::new(), &layout(SpreadMode::Single, true));

        assert_eq!(slots.len(), 3);
        assert_eq!(slots[0].left_page_index, 0);
        assert_eq!(slots[0].right_page_index, None);
        assert_eq!(slots[2].left_page_index, 2);
    }

    #[test]
    fn double_spread_mode_keeps_first_page_alone() {
        let slots = build_spread_slots(4, &BTreeSet::new(), &layout(SpreadMode::Double, true));

        assert_eq!(slots[0].left_page_index, 0);
        assert_eq!(slots[0].right_page_index, None);
        assert_eq!(slots[1].left_page_index, 1);
        assert_eq!(slots[1].right_page_index, Some(2));
        assert_eq!(slots[2].left_page_index, 3);
        assert_eq!(slots[2].right_page_index, None);
    }

    #[test]
    fn double_spread_mode_does_not_place_chapter_start_on_right_page() {
        let chapter_start_pages = BTreeSet::from([2]);

        let slots = build_spread_slots(4, &chapter_start_pages, &layout(SpreadMode::Double, false));

        assert_eq!(slots[0].left_page_index, 0);
        assert_eq!(slots[0].right_page_index, Some(1));
        assert_eq!(slots[1].left_page_index, 2);
        assert_eq!(slots[1].right_page_index, Some(3));
    }

    fn layout(spread_mode: SpreadMode, first_page_alone: bool) -> LayoutConfig {
        create_layout_config(LayoutConfigInput {
            width: 800.0,
            height: 600.0,
            margin: MarginInput::All(20.0),
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
}
