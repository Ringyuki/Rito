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

pub(crate) fn chapter_spread_count(
    start_page: usize,
    page_count: usize,
    layout_config: &LayoutConfig,
) -> usize {
    if layout_config.spread_mode == SpreadMode::Single {
        return page_count;
    }
    let isolated_first =
        usize::from(page_count > 0 && layout_config.first_page_alone && start_page == 0);
    let paired_pages = page_count - isolated_first;
    isolated_first + paired_pages / 2 + paired_pages % 2
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

    use super::{build_spread_slots, chapter_spread_count};
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

    #[test]
    fn chapter_contributions_match_slot_builder_for_small_partitions() {
        for page_count in 0usize..=9 {
            let internal_boundary_count = page_count.saturating_sub(1);
            for boundary_mask in 0..(1usize << internal_boundary_count) {
                let mut starts = BTreeSet::new();
                if page_count > 0 {
                    starts.insert(0);
                }
                for boundary in 1..page_count {
                    if boundary_mask & (1 << (boundary - 1)) != 0 {
                        starts.insert(boundary);
                    }
                }
                for spread_mode in [SpreadMode::Single, SpreadMode::Double] {
                    for first_page_alone in [false, true] {
                        let layout = layout(spread_mode, first_page_alone);
                        let expected = build_spread_slots(page_count, &starts, &layout).len();
                        let mut range_starts = starts.iter().copied().collect::<Vec<_>>();
                        range_starts.push(page_count);
                        let actual = range_starts
                            .windows(2)
                            .map(|range| {
                                chapter_spread_count(range[0], range[1] - range[0], &layout)
                            })
                            .sum::<usize>();

                        assert_eq!(
                            actual, expected,
                            "page_count={page_count}, starts={starts:?}, mode={spread_mode:?}, first_page_alone={first_page_alone}"
                        );
                    }
                }
            }
        }
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
