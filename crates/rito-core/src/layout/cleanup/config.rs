use std::{
    collections::{btree_map, BTreeMap},
    num::NonZeroUsize,
    vec,
};

use crate::layout::{CleanupProgress, FontVerticalMetricSample, LayoutConfig};

use self::shell::LayoutConfigShell;

mod shell;

type AdvanceMapSource = btree_map::IntoIter<String, f64>;
type FamilyAdvanceMapSource = btree_map::IntoIter<String, BTreeMap<String, f64>>;
type VerticalMetricsSource = vec::IntoIter<FontVerticalMetricSample>;

/// Releases every unbounded font-measurement map entry under an explicit
/// structural budget.
///
/// If the two flat maps contain `F` entries total, the nested maps contain `N`
/// inner entries under `O` outer family keys, and the vertical-metric sample
/// vector contains `V` entries, this cursor costs exactly `F + N + 2O + 6` units
/// when `V == 0`, or `F + N + 2O + V + 7` otherwise. Empty optional maps do
/// not perturb the established cleanup cost. Creating and advancing the
/// standard-library B-tree
/// iterators retains logarithmic internal work, so this removes whole-map
/// destructor stalls without claiming a strict constant-time unit.
#[derive(Debug)]
pub(crate) struct PendingLayoutConfigCleanup {
    owner: Option<LayoutConfig>,
    generic_serif_advances: Option<AdvanceMapSource>,
    font_family_advances: Option<FamilyAdvanceMapSource>,
    active_family_advances: Option<AdvanceMapSource>,
    generic_serif_pair_adjustments: Option<AdvanceMapSource>,
    font_family_pair_adjustments: Option<FamilyAdvanceMapSource>,
    active_family_pair_adjustments: Option<AdvanceMapSource>,
    font_vertical_metrics: Option<VerticalMetricsSource>,
    shell: Option<LayoutConfigShell>,
    stage: LayoutConfigCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LayoutConfigCleanupStage {
    Source,
    GenericSerifAdvances,
    FontFamilyAdvances,
    GenericSerifPairAdjustments,
    FontFamilyPairAdjustments,
    FontVerticalMetrics,
    Owner,
    Complete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceProgress {
    Advanced,
    Complete,
}

impl PendingLayoutConfigCleanup {
    pub(crate) fn new(owner: LayoutConfig) -> Self {
        Self {
            owner: Some(owner),
            generic_serif_advances: None,
            font_family_advances: None,
            active_family_advances: None,
            generic_serif_pair_adjustments: None,
            font_family_pair_adjustments: None,
            active_family_pair_adjustments: None,
            font_vertical_metrics: None,
            shell: None,
            stage: LayoutConfigCleanupStage::Source,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == LayoutConfigCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            LayoutConfigCleanupStage::Source => self.start_sources(),
            LayoutConfigCleanupStage::GenericSerifAdvances => self.advance_generic_serif_advances(),
            LayoutConfigCleanupStage::FontFamilyAdvances => self.advance_font_family_advances(),
            LayoutConfigCleanupStage::GenericSerifPairAdjustments => {
                self.advance_generic_serif_pair_adjustments()
            }
            LayoutConfigCleanupStage::FontFamilyPairAdjustments => {
                self.advance_font_family_pair_adjustments()
            }
            LayoutConfigCleanupStage::FontVerticalMetrics => self.advance_font_vertical_metrics(),
            LayoutConfigCleanupStage::Owner => self.release_owner(),
            LayoutConfigCleanupStage::Complete => false,
        }
    }

    pub(crate) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
        let mut consumed_units = 0;
        while consumed_units < budget.get() && self.advance_one() {
            consumed_units += 1;
        }
        let progress = CleanupProgress {
            consumed_units,
            complete: self.is_complete(),
        };
        debug_assert!(progress.complete || progress.consumed_units == budget.get());
        progress
    }

    pub(crate) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn start_sources(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its layout config");
        let LayoutConfig {
            viewport_width,
            viewport_height,
            page_width,
            page_height,
            margin_top,
            margin_right,
            margin_bottom,
            margin_left,
            spread_mode,
            first_page_alone,
            spread_gap,
            root_font_size,
            line_height_override,
            line_height_force,
            font_family_override,
            font_family_force,
            pagination_policy,
            text_measurement,
            generic_serif_advances,
            font_family_advances,
            generic_serif_pair_adjustments,
            font_family_pair_adjustments,
            font_vertical_metrics,
        } = owner;
        self.generic_serif_advances = Some(generic_serif_advances.into_iter());
        self.font_family_advances = Some(font_family_advances.into_iter());
        self.generic_serif_pair_adjustments = Some(generic_serif_pair_adjustments.into_iter());
        self.font_family_pair_adjustments = Some(font_family_pair_adjustments.into_iter());
        self.font_vertical_metrics =
            (!font_vertical_metrics.is_empty()).then(|| font_vertical_metrics.into_iter());
        self.shell = Some(LayoutConfigShell {
            viewport_width,
            viewport_height,
            page_width,
            page_height,
            margin_top,
            margin_right,
            margin_bottom,
            margin_left,
            spread_mode,
            first_page_alone,
            spread_gap,
            root_font_size,
            line_height_override,
            line_height_force,
            font_family_override,
            font_family_force,
            pagination_policy,
            text_measurement,
        });
        self.stage = LayoutConfigCleanupStage::GenericSerifAdvances;
        true
    }

    fn advance_generic_serif_advances(&mut self) -> bool {
        if advance_flat_source(&mut self.generic_serif_advances) == SourceProgress::Complete {
            self.stage = LayoutConfigCleanupStage::FontFamilyAdvances;
        }
        true
    }

    fn advance_font_family_advances(&mut self) -> bool {
        if advance_nested_source(
            &mut self.font_family_advances,
            &mut self.active_family_advances,
        ) == SourceProgress::Complete
        {
            self.stage = LayoutConfigCleanupStage::GenericSerifPairAdjustments;
        }
        true
    }

    fn advance_generic_serif_pair_adjustments(&mut self) -> bool {
        if advance_flat_source(&mut self.generic_serif_pair_adjustments) == SourceProgress::Complete
        {
            self.stage = LayoutConfigCleanupStage::FontFamilyPairAdjustments;
        }
        true
    }

    fn advance_font_family_pair_adjustments(&mut self) -> bool {
        if advance_nested_source(
            &mut self.font_family_pair_adjustments,
            &mut self.active_family_pair_adjustments,
        ) == SourceProgress::Complete
        {
            self.stage = if self.font_vertical_metrics.is_some() {
                LayoutConfigCleanupStage::FontVerticalMetrics
            } else {
                LayoutConfigCleanupStage::Owner
            };
        }
        true
    }

    fn advance_font_vertical_metrics(&mut self) -> bool {
        if advance_vector_source(&mut self.font_vertical_metrics) == SourceProgress::Complete {
            self.stage = LayoutConfigCleanupStage::Owner;
        }
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("layout-config shell exists");
        shell.release();
        self.stage = LayoutConfigCleanupStage::Complete;
        true
    }
}

fn advance_vector_source<T>(source: &mut Option<vec::IntoIter<T>>) -> SourceProgress {
    let entries = source.as_mut().expect("vector source exists");
    if let Some(entry) = entries.next() {
        drop(entry);
        return SourceProgress::Advanced;
    }
    *source = None;
    SourceProgress::Complete
}

fn advance_flat_source<T>(source: &mut Option<btree_map::IntoIter<String, T>>) -> SourceProgress {
    let entries = source.as_mut().expect("flat advance source exists");
    if let Some(entry) = entries.next() {
        drop(entry);
        return SourceProgress::Advanced;
    }
    *source = None;
    SourceProgress::Complete
}

fn advance_nested_source(
    source: &mut Option<FamilyAdvanceMapSource>,
    active: &mut Option<AdvanceMapSource>,
) -> SourceProgress {
    if let Some(entries) = active.as_mut() {
        if let Some(entry) = entries.next() {
            drop(entry);
            return SourceProgress::Advanced;
        }
        *active = None;
        return SourceProgress::Advanced;
    }
    let families = source.as_mut().expect("family advance source exists");
    if let Some((family, entries)) = families.next() {
        drop(family);
        *active = Some(entries.into_iter());
        return SourceProgress::Advanced;
    }
    *source = None;
    SourceProgress::Complete
}

impl Drop for PendingLayoutConfigCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "config/tests.rs"]
mod tests;
