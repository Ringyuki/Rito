use std::collections::BTreeMap;

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox},
    text_shape::{RunShape, RunShapeProvenance, RunShapeUnavailableReason},
    LayoutRuntimePage,
};

pub(crate) const MAX_AFFECTED_CODEPOINTS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShapeAffectedCodepointStats {
    pub(crate) codepoint: u32,
    pub(crate) count: usize,
    pub(crate) reason_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ShapeProvenanceStats {
    pub(crate) total_text_runs: usize,
    pub(crate) exact_text_runs: usize,
    pub(crate) unavailable_text_runs: usize,
    pub(crate) total_text_utf16_code_unit_count: usize,
    pub(crate) exact_text_utf16_code_unit_count: usize,
    pub(crate) unavailable_text_utf16_code_unit_count: usize,
    pub(crate) excluded_ruby_text_run_count: usize,
    pub(crate) excluded_ruby_text_utf16_code_unit_count: usize,
    pub(crate) single_font_text_runs: usize,
    pub(crate) mixed_font_text_runs: usize,
    pub(crate) unavailable_reason_counts: BTreeMap<String, usize>,
    pub(crate) unavailable_reason_utf16_code_unit_counts: BTreeMap<String, usize>,
    pub(crate) single_font_fingerprints: BTreeMap<String, usize>,
    pub(crate) mixed_font_fingerprints: BTreeMap<String, usize>,
    pub(crate) unavailable_affected_codepoints: Vec<ShapeAffectedCodepointStats>,
    pub(crate) unavailable_affected_codepoint_occurrences: usize,
    pub(crate) unavailable_affected_codepoint_distinct: usize,
    pub(crate) unavailable_affected_codepoint_omitted: usize,
}

pub(crate) fn summarize_shape_provenance(pages: &[LayoutRuntimePage]) -> ShapeProvenanceStats {
    let mut stats = ShapeProvenanceStats::default();
    let mut affected_codepoints = BTreeMap::new();
    for block in pages.iter().flat_map(|page| &page.content) {
        collect_block(block, &mut stats, &mut affected_codepoints);
    }
    finish_codepoints(&mut stats, affected_codepoints);
    stats
}

fn collect_block(
    block: &RuntimeBlock<LineBox>,
    stats: &mut ShapeProvenanceStats,
    affected_codepoints: &mut BTreeMap<u32, BTreeMap<String, usize>>,
) {
    for child in &block.children {
        match child {
            RuntimeChild::Block(block) => collect_block(block, stats, affected_codepoints),
            RuntimeChild::Line(line) => collect_line(line, stats, affected_codepoints),
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_line(
    line: &LineBox,
    stats: &mut ShapeProvenanceStats,
    affected_codepoints: &mut BTreeMap<u32, BTreeMap<String, usize>>,
) {
    for run in &line.runs {
        match run {
            LineRun::Text(run) => collect_text_run(run, stats, affected_codepoints),
            LineRun::Ruby(run) => {
                stats.excluded_ruby_text_run_count += 1;
                stats.excluded_ruby_text_utf16_code_unit_count += utf16_len(&run.text);
            }
            LineRun::Atom(_) => {}
        }
    }
}

fn collect_text_run(
    run: &TextRunBox,
    stats: &mut ShapeProvenanceStats,
    affected_codepoints: &mut BTreeMap<u32, BTreeMap<String, usize>>,
) {
    let utf16_code_unit_count = utf16_len(&run.text);
    stats.total_text_runs += 1;
    stats.total_text_utf16_code_unit_count += utf16_code_unit_count;
    match &run.shape {
        RunShape::Exact(shape) => {
            stats.exact_text_runs += 1;
            stats.exact_text_utf16_code_unit_count += utf16_code_unit_count;
            collect_provenance(&shape.provenance, stats);
        }
        RunShape::Unavailable(unavailable) => {
            stats.unavailable_text_runs += 1;
            stats.unavailable_text_utf16_code_unit_count += utf16_code_unit_count;
            let reason = unavailable_reason_key(unavailable.reason);
            increment(&mut stats.unavailable_reason_counts, reason);
            add_count(
                &mut stats.unavailable_reason_utf16_code_unit_counts,
                reason,
                utf16_code_unit_count,
            );
            for character in run.text.chars() {
                stats.unavailable_affected_codepoint_occurrences += 1;
                increment(
                    affected_codepoints.entry(character as u32).or_default(),
                    reason,
                );
            }
        }
    }
}

fn collect_provenance(provenance: &RunShapeProvenance, stats: &mut ShapeProvenanceStats) {
    match provenance {
        RunShapeProvenance::Single { fingerprint } => {
            stats.single_font_text_runs += 1;
            increment(
                &mut stats.single_font_fingerprints,
                &fingerprint_text(*fingerprint),
            );
        }
        RunShapeProvenance::Mixed(mixed) => {
            stats.mixed_font_text_runs += 1;
            for fingerprint in &mixed.font_fingerprints {
                increment(
                    &mut stats.mixed_font_fingerprints,
                    &fingerprint_text(*fingerprint),
                );
            }
        }
    }
}

fn finish_codepoints(
    stats: &mut ShapeProvenanceStats,
    counts: BTreeMap<u32, BTreeMap<String, usize>>,
) {
    let distinct = counts.len();
    let mut counts = counts
        .into_iter()
        .map(|(codepoint, reason_counts)| ShapeAffectedCodepointStats {
            codepoint,
            count: reason_counts.values().sum(),
            reason_counts,
        })
        .collect::<Vec<_>>();
    counts.sort_unstable_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then(left.codepoint.cmp(&right.codepoint))
    });
    counts.truncate(MAX_AFFECTED_CODEPOINTS);
    stats.unavailable_affected_codepoint_distinct = distinct;
    stats.unavailable_affected_codepoint_omitted = distinct.saturating_sub(counts.len());
    stats.unavailable_affected_codepoints = counts;
}

fn increment(counts: &mut BTreeMap<String, usize>, key: &str) {
    *counts.entry(key.to_owned()).or_default() += 1;
}

fn add_count(counts: &mut BTreeMap<String, usize>, key: &str, count: usize) {
    if count > 0 {
        *counts.entry(key.to_owned()).or_default() += count;
    }
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn fingerprint_text(fingerprint: [u8; 8]) -> String {
    fingerprint
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn unavailable_reason_key(reason: RunShapeUnavailableReason) -> &'static str {
    match reason {
        RunShapeUnavailableReason::FixtureCompatibleMeasurement => "fixtureCompatibleMeasurement",
        RunShapeUnavailableReason::HostMetricsFallback => "hostMetricsFallback",
        RunShapeUnavailableReason::RustybuzzUnavailable => "rustybuzzUnavailable",
        RunShapeUnavailableReason::SyntheticLayoutText => "syntheticLayoutText",
        RunShapeUnavailableReason::MixedDirection => "mixedDirection",
        RunShapeUnavailableReason::NonClusterSafeSpacing => "nonClusterSafeSpacing",
        RunShapeUnavailableReason::NonGraphemeSafeClusters => "nonGraphemeSafeClusters",
    }
}

#[cfg(test)]
mod tests;
