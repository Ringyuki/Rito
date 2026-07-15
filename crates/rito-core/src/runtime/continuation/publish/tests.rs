use std::collections::BTreeSet;

use super::publishable_page_count;
use crate::layout::{
    build_spread_slots, create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput,
    SpreadMode,
};

#[test]
fn incomplete_double_spread_publication_matches_full_slot_oracle() {
    let prior_chapter_lengths = [
        Vec::new(),
        vec![1],
        vec![2],
        vec![3],
        vec![1, 2],
        vec![2, 1],
        vec![3, 3],
        vec![1, 0, 4],
    ];
    for first_page_alone in [false, true] {
        let layout = layout(SpreadMode::Double, first_page_alone);
        for prior_lengths in &prior_chapter_lengths {
            let (prior_page_count, prior_starts) = chapter_prefix(prior_lengths);
            for current_page_count in 0..=8 {
                let mut starts = prior_starts.clone();
                let chapter_has_published_pages = current_page_count > 0;
                if chapter_has_published_pages {
                    starts.insert(prior_page_count);
                    if stable_page_count(prior_page_count + current_page_count, &starts, &layout)
                        != prior_page_count + current_page_count
                    {
                        continue;
                    }
                }
                let published_page_count = prior_page_count + current_page_count;
                for candidate_count in 1..=8 {
                    let actual = publishable_page_count(
                        published_page_count,
                        chapter_has_published_pages,
                        candidate_count,
                        false,
                        &layout,
                    );
                    let expected = oracle_publishable_page_count(
                        published_page_count,
                        &starts,
                        chapter_has_published_pages,
                        candidate_count,
                        &layout,
                    );
                    assert_eq!(
                        actual, expected,
                        "prior={prior_lengths:?}, current={current_page_count}, candidates={candidate_count}, first_page_alone={first_page_alone}"
                    );
                }
            }
        }
    }
}

#[test]
fn complete_chapters_and_single_spreads_publish_every_candidate() {
    for spread_mode in [SpreadMode::Single, SpreadMode::Double] {
        let layout = layout(spread_mode, true);
        for chapter_complete in [false, true] {
            if spread_mode == SpreadMode::Double && !chapter_complete {
                continue;
            }
            assert_eq!(
                publishable_page_count(0, false, 7, chapter_complete, &layout),
                7
            );
        }
    }
}

fn oracle_publishable_page_count(
    published_page_count: usize,
    chapter_start_pages: &BTreeSet<usize>,
    chapter_has_published_pages: bool,
    candidate_count: usize,
    layout: &LayoutConfig,
) -> usize {
    let mut starts = chapter_start_pages.clone();
    if !chapter_has_published_pages {
        starts.insert(published_page_count);
    }
    stable_page_count(published_page_count + candidate_count, &starts, layout)
        .saturating_sub(published_page_count)
}

fn stable_page_count(
    page_count: usize,
    chapter_start_pages: &BTreeSet<usize>,
    layout: &LayoutConfig,
) -> usize {
    let slots = build_spread_slots(page_count, chapter_start_pages, layout);
    let stable_spread_count = slots
        .len()
        .saturating_sub(usize::from(slots.last().is_some_and(|slot| {
            slot.right_page_index.is_none()
                && !(layout.first_page_alone && slot.left_page_index == 0)
        })));
    slots
        .iter()
        .take(stable_spread_count)
        .flat_map(|slot| [Some(slot.left_page_index), slot.right_page_index])
        .flatten()
        .max()
        .map_or(0, |index| index + 1)
}

fn chapter_prefix(chapter_lengths: &[usize]) -> (usize, BTreeSet<usize>) {
    let mut page_count = 0;
    let mut starts = BTreeSet::new();
    for &chapter_length in chapter_lengths {
        if chapter_length == 0 {
            continue;
        }
        starts.insert(page_count);
        page_count += chapter_length;
    }
    (page_count, starts)
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
