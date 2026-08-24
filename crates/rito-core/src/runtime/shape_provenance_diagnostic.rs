use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    epub::{EpubError, EpubResult},
    layout::{summarize_shape_provenance, ShapeAffectedCodepointStats, ShapeProvenanceStats},
};

use super::{RuntimeDocument, RuntimeRevisionStatus};

pub const RUNTIME_SHAPE_PROVENANCE_DIAGNOSTIC_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeShapeAffectedCodepointFrequency {
    pub codepoint: String,
    pub count: usize,
    pub reason_counts: BTreeMap<String, usize>,
}

/// Diagnostic coverage for source/base text represented by `LineRun::Text` in
/// the pages currently published by one exact revision version. Ruby annotation
/// text is excluded and reported separately. Synthetic layout text can still be
/// represented by `LineRun::Text` and is identified by its unavailable reason.
///
/// `is_complete == false` always means that these counts describe only the
/// revision's published prefix, regardless of whether its status is warming,
/// ready, cancelled, or failed. This read traverses all currently published
/// pages without caching, so whole-book coverage callers should prefer one
/// final-only read after the revision becomes complete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeShapeProvenanceDiagnostic {
    pub schema_version: u32,
    pub is_complete: bool,
    pub known_page_count: usize,
    pub total_text_runs: usize,
    pub exact_text_runs: usize,
    pub unavailable_text_runs: usize,
    pub total_text_utf16_code_unit_count: usize,
    pub exact_text_utf16_code_unit_count: usize,
    pub unavailable_text_utf16_code_unit_count: usize,
    pub excluded_ruby_text_run_count: usize,
    pub excluded_ruby_text_utf16_code_unit_count: usize,
    pub single_font_text_runs: usize,
    pub mixed_font_text_runs: usize,
    /// Run counts grouped by the reason exact shape data was unavailable.
    pub unavailable_reason_counts: BTreeMap<String, usize>,
    /// UTF-16 code-unit counts grouped by unavailable reason.
    pub unavailable_reason_utf16_code_unit_counts: BTreeMap<String, usize>,
    /// Exact single-font run counts keyed by a 64-bit diagnostic font ID.
    pub single_font_fingerprints: BTreeMap<String, usize>,
    /// Exact mixed-font run counts containing each 64-bit diagnostic font ID.
    /// A run contributes at most once to each ID.
    pub mixed_font_fingerprints: BTreeMap<String, usize>,
    /// Global top 256 affected Unicode scalars across all unavailable reasons,
    /// ordered by count descending then scalar ascending. These are all scalars
    /// in unavailable runs; they are not a claim that the corresponding glyph
    /// is missing. This is not a separate top-N list for each reason.
    pub unavailable_affected_codepoints: Vec<RuntimeShapeAffectedCodepointFrequency>,
    pub unavailable_affected_codepoint_occurrence_count: usize,
    pub unavailable_affected_codepoint_distinct_count: usize,
    pub unavailable_affected_codepoint_omitted_count: usize,
}

impl RuntimeDocument {
    pub(super) fn shape_provenance_diagnostic(
        &self,
        revision_id: &str,
    ) -> EpubResult<RuntimeShapeProvenanceDiagnostic> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        Ok(runtime_diagnostic(
            revision.status == RuntimeRevisionStatus::Complete,
            revision.known_extent.page_count,
            summarize_shape_provenance(&revision.layout.pages),
        ))
    }
}

fn runtime_diagnostic(
    is_complete: bool,
    known_page_count: usize,
    stats: ShapeProvenanceStats,
) -> RuntimeShapeProvenanceDiagnostic {
    RuntimeShapeProvenanceDiagnostic {
        schema_version: RUNTIME_SHAPE_PROVENANCE_DIAGNOSTIC_SCHEMA_VERSION,
        is_complete,
        known_page_count,
        total_text_runs: stats.total_text_runs,
        exact_text_runs: stats.exact_text_runs,
        unavailable_text_runs: stats.unavailable_text_runs,
        total_text_utf16_code_unit_count: stats.total_text_utf16_code_unit_count,
        exact_text_utf16_code_unit_count: stats.exact_text_utf16_code_unit_count,
        unavailable_text_utf16_code_unit_count: stats.unavailable_text_utf16_code_unit_count,
        excluded_ruby_text_run_count: stats.excluded_ruby_text_run_count,
        excluded_ruby_text_utf16_code_unit_count: stats.excluded_ruby_text_utf16_code_unit_count,
        single_font_text_runs: stats.single_font_text_runs,
        mixed_font_text_runs: stats.mixed_font_text_runs,
        unavailable_reason_counts: stats.unavailable_reason_counts,
        unavailable_reason_utf16_code_unit_counts: stats.unavailable_reason_utf16_code_unit_counts,
        single_font_fingerprints: stats.single_font_fingerprints,
        mixed_font_fingerprints: stats.mixed_font_fingerprints,
        unavailable_affected_codepoints: stats
            .unavailable_affected_codepoints
            .into_iter()
            .map(
                |entry: ShapeAffectedCodepointStats| RuntimeShapeAffectedCodepointFrequency {
                    codepoint: format!("U+{:04X}", entry.codepoint),
                    count: entry.count,
                    reason_counts: entry.reason_counts,
                },
            )
            .collect(),
        unavailable_affected_codepoint_occurrence_count: stats
            .unavailable_affected_codepoint_occurrences,
        unavailable_affected_codepoint_distinct_count: stats
            .unavailable_affected_codepoint_distinct,
        unavailable_affected_codepoint_omitted_count: stats.unavailable_affected_codepoint_omitted,
    }
}
