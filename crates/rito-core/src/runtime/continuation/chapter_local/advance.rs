use crate::runtime::{
    RuntimeChapterLocalPageRange, RuntimeChapterLocalRevisionAdvance,
    RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionExtent, RuntimeDocument,
    RuntimeRevisionStatus, RuntimeSourceLocator,
};

use super::model::{
    chapter_local_owner, chapter_local_summary, local_locator_resolution, local_unknown_revision,
};

impl RuntimeDocument {
    /// Publishes a chapter-local revision paginated by the fragment
    /// engine in one pass: the revision owns its complete single-chapter
    /// page table, so there is no continuation and no page-cap window —
    /// the advertised extent is the whole chapter.
    pub(super) fn publish_chapter_local_fragment(
        &mut self,
        revision_id: &str,
        layout_key: &str,
        layout: crate::runtime::fragment_backend::FragmentBuiltLayout,
        target_locator: RuntimeSourceLocator,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let page_count = layout.page_count();
        let document = &self.document;
        let revision = self
            .chapter_local_revisions
            .get_mut(revision_id)
            .ok_or_else(|| local_unknown_revision(revision_id))?;
        let spread_count = crate::layout::build_spread_slots(
            page_count,
            layout.chapter_start_pages(),
            &revision.layout_config,
        )
        .len();
        revision.fragment_layout = Some(layout);
        let extent = crate::runtime::RuntimeRevisionExtent {
            page_count,
            spread_count,
        };
        revision.revision_version = 0;
        revision.known_extent = extent;
        revision.final_extent = Some(extent);
        revision.status = RuntimeRevisionStatus::Complete;
        let owner = chapter_local_owner(document, revision_id, 0, revision);
        let resolution = self
            .resolve_chapter_local_source_locator_inner(revision_id, target_locator.clone())
            .expect("preflight-validated chapter-local locator remains resolvable");
        let target = local_locator_resolution(owner.clone(), resolution);
        let revision = self
            .chapter_local_revisions
            .get(revision_id)
            .expect("chapter-local revision remains available");
        let summary = chapter_local_summary(&owner, layout_key, revision);
        self.service_cleanup_queue();
        Ok(RuntimeChapterLocalRevisionAdvance {
            newly_known_local_pages: RuntimeChapterLocalPageRange {
                start_local_page: 0,
                end_local_page_exclusive: summary.known_extent.local_page_count,
            },
            revision: summary,
            previous_known_extent: RuntimeChapterLocalRevisionExtent {
                local_page_count: 0,
                local_spread_count: 0,
            },
            processed_top_level_nodes: 0,
            target,
            continuation: None,
        })
    }

    /// Retires a chapter-local revision whose one-pass fragment build
    /// failed, before it ever published.
    pub(super) fn retire_failed_fragment_local_revision(&mut self, revision_id: &str) {
        if let Some(revision) = self.chapter_local_revisions.remove(revision_id) {
            self.cleanup_queue.enqueue_revision(revision);
        }
        self.service_cleanup_queue();
    }
}
