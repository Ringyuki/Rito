use std::collections::BTreeMap;

use crate::runtime::{
    fragment_backend::ChapterLocalFragmentBuild,
    frame::{RuntimeRevision, RuntimeRevisionCoordinateSpace},
    RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionHandle,
    RuntimeCreatedChapterLocalRevision, RuntimeDocument,
};

use super::{
    model::{chapter_local_summary, local_locator_resolution},
    preflight::PreparedChapterLocalRevision,
};

impl RuntimeDocument {
    /// Inserts a chapter-local revision over its paginated chapter and
    /// resolves the requested locator against that page table.
    pub(super) fn publish_chapter_local_revision(
        &mut self,
        prepared: PreparedChapterLocalRevision,
        built: ChapterLocalFragmentBuild,
    ) -> Result<RuntimeCreatedChapterLocalRevision, RuntimeChapterLocalRevisionError> {
        let PreparedChapterLocalRevision {
            revision_id,
            layout_key,
            layout_config,
            coordinate,
            target_locator,
            required_font_face_catalog,
        } = prepared;
        let ChapterLocalFragmentBuild {
            layout,
            idref,
            style_tables,
            interactions,
        } = built;
        let revision = RuntimeRevision::new(
            RuntimeRevisionCoordinateSpace::ChapterLocal {
                chapter_index: coordinate.chapter_index,
            },
            layout_config,
            BTreeMap::from([(idref, style_tables)]),
            required_font_face_catalog,
            interactions,
            layout,
        );
        self.insert_new_chapter_local_revision(revision_id.clone(), revision);
        let owner = RuntimeChapterLocalRevisionHandle {
            revision_id: revision_id.clone(),
            revision_version: 0,
            coordinate,
        };
        let resolution = self
            .resolve_chapter_local_source_locator_inner(&revision_id, target_locator)
            .expect("preflight-validated chapter-local locator remains resolvable");
        let target = local_locator_resolution(owner.clone(), resolution);
        let revision = self
            .chapter_local_revisions
            .get(&revision_id)
            .expect("chapter-local revision was just inserted");
        let summary = chapter_local_summary(&owner, &layout_key, revision);
        self.service_cleanup_queue();
        Ok(RuntimeCreatedChapterLocalRevision {
            revision: summary,
            target,
        })
    }
}
