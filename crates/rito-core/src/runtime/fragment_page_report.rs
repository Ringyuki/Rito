//! Measures the fragment engine's paginated output for a revision, without
//! touching production frames.
//!
//! For every chapter whose typed style tables the revision retains, this
//! read-only diagnostic builds the chapter's formatting tree through the
//! production bridge, paginates it into the revision's page content box
//! with a caller-supplied fragment engine, and paints every page into
//! display commands. Chapters the bridge or painter cannot express report
//! the exact fail-closed reason. This is the pagination-and-paint
//! counterpart of the representability report: together they say which
//! chapters the fragment pipeline could take over end to end.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use rito_fragment::{CancelFlag, FormattingContext};

use serde_json::Value;

use crate::epub::EpubResult;
use crate::fragment_pagination::paginate_chapter;
use crate::render::{count_display_commands, display_command_values};

use super::{RuntimeDocument, RuntimeRevisionStatus};

pub const RUNTIME_FRAGMENT_PAGE_REPORT_SCHEMA_VERSION: u32 = 1;

/// One chapter's paginated fragment-engine output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFragmentPageChapter {
    pub idref: String,
    /// Whether the chapter paginated and painted end to end.
    pub paginated: bool,
    /// The fail-closed reason when it did not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Pages the chapter paginated into (0 when not paginated).
    pub page_count: usize,
    /// Painted commands per page, in page order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub page_command_counts: Vec<usize>,
    /// Total painted commands by command kind.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub command_counts: BTreeMap<String, usize>,
}

/// Paginated fragment-engine coverage of a revision's chapters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFragmentPageReport {
    pub schema_version: u32,
    /// `false` when later chapters have no retained style tables yet; only
    /// chapters with tables are measured.
    pub is_complete: bool,
    pub chapter_count: usize,
    pub paginated_chapter_count: usize,
    pub total_page_count: usize,
    pub chapters: Vec<RuntimeFragmentPageChapter>,
}

impl RuntimeDocument {
    /// Paginates one chapter and returns every page's paint commands as
    /// wire-shaped JSON values, for probes and oracles that need the
    /// actual command stream rather than counts.
    pub fn fragment_chapter_page_commands(
        &self,
        revision_id: &str,
        idref: &str,
        engine: &dyn FormattingContext,
    ) -> EpubResult<Vec<Vec<Value>>> {
        let revision = self.revisions.get(revision_id).ok_or_else(|| {
            crate::epub::EpubError::new(format!("unknown revision: {revision_id}"))
        })?;
        let config = &revision.layout_config;
        let content_width = config.page_width - config.margin_left - config.margin_right;
        let content_height = config.page_height - config.margin_top - config.margin_bottom;
        let built = self.chapter_formatting_tree(revision_id, idref)?;
        let pages = paginate_chapter(
            engine,
            &built.tree,
            content_width,
            content_height,
            config.margin_left,
            config.margin_top,
            &CancelFlag::new(),
        )?;
        Ok(pages
            .iter()
            .map(|page| display_command_values(&page.commands))
            .collect())
    }

    /// Paginates and paints every representable chapter of a revision with
    /// `engine`, reporting per-chapter page and command coverage. The
    /// engine arrives from the caller because the runtime does not own an
    /// inline provider yet; production wiring will pin one.
    pub fn fragment_page_report(
        &self,
        revision_id: &str,
        engine: &dyn FormattingContext,
    ) -> EpubResult<RuntimeFragmentPageReport> {
        let revision = self.revisions.get(revision_id).ok_or_else(|| {
            crate::epub::EpubError::new(format!("unknown revision: {revision_id}"))
        })?;
        let config = &revision.layout_config;
        let content_width = config.page_width - config.margin_left - config.margin_right;
        let content_height = config.page_height - config.margin_top - config.margin_bottom;
        let origin_x = config.margin_left;
        let origin_y = config.margin_top;
        let is_complete = revision.status == RuntimeRevisionStatus::Complete;
        let idrefs: Vec<String> = revision.chapter_style_tables.keys().cloned().collect();

        let cancel = CancelFlag::new();
        let mut chapters = Vec::with_capacity(idrefs.len());
        let mut paginated_count = 0usize;
        let mut total_pages = 0usize;
        for idref in &idrefs {
            let outcome = self
                .chapter_formatting_tree(revision_id, idref)
                .and_then(|built| {
                    paginate_chapter(
                        engine,
                        &built.tree,
                        content_width,
                        content_height,
                        origin_x,
                        origin_y,
                        &cancel,
                    )
                });
            match outcome {
                Ok(pages) => {
                    paginated_count += 1;
                    total_pages += pages.len();
                    let mut command_counts = BTreeMap::new();
                    let mut page_command_counts = Vec::with_capacity(pages.len());
                    for page in &pages {
                        page_command_counts.push(page.commands.len());
                        for (kind, count) in count_display_commands(&page.commands) {
                            *command_counts.entry(kind).or_insert(0) += count;
                        }
                    }
                    chapters.push(RuntimeFragmentPageChapter {
                        idref: idref.clone(),
                        paginated: true,
                        reason: None,
                        page_count: pages.len(),
                        page_command_counts,
                        command_counts,
                    });
                }
                Err(error) => chapters.push(RuntimeFragmentPageChapter {
                    idref: idref.clone(),
                    paginated: false,
                    reason: Some(error.to_string()),
                    page_count: 0,
                    page_command_counts: Vec::new(),
                    command_counts: BTreeMap::new(),
                }),
            }
        }
        Ok(RuntimeFragmentPageReport {
            schema_version: RUNTIME_FRAGMENT_PAGE_REPORT_SCHEMA_VERSION,
            is_complete,
            chapter_count: chapters.len(),
            paginated_chapter_count: paginated_count,
            total_page_count: total_pages,
            chapters,
        })
    }
}
