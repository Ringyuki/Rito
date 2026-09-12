use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::epub::{EpubError, EpubResult};

use super::{RuntimeDocument, RuntimeRevisionStatus};

pub const RUNTIME_SHAPE_PROVENANCE_DIAGNOSTIC_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeShapeAffectedCodepointFrequency {
    pub codepoint: String,
    pub count: usize,
    pub reason_counts: BTreeMap<String, usize>,
}

/// Host-measured shaping coverage of one revision's published pages.
///
/// The fragment engine shapes every run with the publication's own faces,
/// so there is no host-measured provenance left to summarize: the counts
/// are all zero and the diagnostic only reports the revision's completion
/// state and known page count. The shape stays on the wire for hosts that
/// still read it.
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
    pub unavailable_reason_counts: BTreeMap<String, usize>,
    pub unavailable_reason_utf16_code_unit_counts: BTreeMap<String, usize>,
    pub single_font_fingerprints: BTreeMap<String, usize>,
    pub mixed_font_fingerprints: BTreeMap<String, usize>,
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
        Ok(RuntimeShapeProvenanceDiagnostic {
            schema_version: RUNTIME_SHAPE_PROVENANCE_DIAGNOSTIC_SCHEMA_VERSION,
            is_complete: revision.status == RuntimeRevisionStatus::Complete,
            known_page_count: revision.known_extent.page_count,
            total_text_runs: 0,
            exact_text_runs: 0,
            unavailable_text_runs: 0,
            total_text_utf16_code_unit_count: 0,
            exact_text_utf16_code_unit_count: 0,
            unavailable_text_utf16_code_unit_count: 0,
            excluded_ruby_text_run_count: 0,
            excluded_ruby_text_utf16_code_unit_count: 0,
            single_font_text_runs: 0,
            mixed_font_text_runs: 0,
            unavailable_reason_counts: BTreeMap::new(),
            unavailable_reason_utf16_code_unit_counts: BTreeMap::new(),
            single_font_fingerprints: BTreeMap::new(),
            mixed_font_fingerprints: BTreeMap::new(),
            unavailable_affected_codepoints: Vec::new(),
            unavailable_affected_codepoint_occurrence_count: 0,
            unavailable_affected_codepoint_distinct_count: 0,
            unavailable_affected_codepoint_omitted_count: 0,
        })
    }
}
