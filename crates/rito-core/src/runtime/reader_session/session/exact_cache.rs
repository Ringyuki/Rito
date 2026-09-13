use crate::{
    layout::LayoutConfig,
    runtime::{RuntimeChapterLocalSourceLocatorResolution, RuntimeSourceLocator},
};

use super::{
    errors::engine_error, runtime_locator, ReaderError, ReaderRevisionBacking, ReaderSession,
    ResolvedArtifactOwner, ResolvedArtifactTarget, READER_LIVE_ARTIFACT_CAP,
};

// Live artifacts can own at most as many distinct chapter-local revisions as
// there are artifact slots. Keep the lookup explicitly bounded even if an
// ownership bug ever leaves extra map entries.
const READER_EXACT_CACHE_SCAN_CAP: usize = READER_LIVE_ARTIFACT_CAP as usize;

impl ReaderSession {
    /// Finds an exact locator only in already-published chapter-local pages.
    ///
    /// Selection is deterministic: the visible revision first, then other
    /// live-artifact revisions by newest reader revision id.
    pub(super) fn find_cached_exact_target(
        &mut self,
        chapter_index: usize,
        layout: &LayoutConfig,
        locator: &RuntimeSourceLocator,
    ) -> Result<Option<(u64, ResolvedArtifactTarget)>, ReaderError> {
        for revision_id in self.exact_cache_revision_ids() {
            let Some(owner) = self.cached_exact_owner(revision_id, chapter_index, layout, locator)
            else {
                continue;
            };
            if let Some(target) = self.resolve_cached_exact_target(revision_id, owner, locator)? {
                return Ok(Some(target));
            }
        }
        Ok(None)
    }

    fn resolve_cached_exact_target(
        &mut self,
        revision_id: u64,
        owner: crate::runtime::RuntimeChapterLocalRevisionHandle,
        locator: &RuntimeSourceLocator,
    ) -> Result<Option<(u64, ResolvedArtifactTarget)>, ReaderError> {
        let resolved = self
            .document
            .resolve_chapter_local_source_locator(&owner, locator.clone())
            .map_err(engine_error)?;
        let RuntimeChapterLocalSourceLocatorResolution::Resolved {
            owner,
            locator: resolved_locator,
            local_page_index,
            local_spread_index,
            matched_by,
            ..
        } = resolved
        else {
            return Ok(None);
        };
        if resolved_locator != *locator {
            return Ok(None);
        }
        Ok(Some((
            revision_id,
            ResolvedArtifactTarget {
                owner: ResolvedArtifactOwner::ChapterLocal(owner),
                locator: resolved_locator,
                matched_by,
                local_page_index,
                local_spread_index,
            },
        )))
    }

    fn exact_cache_revision_ids(&self) -> Vec<u64> {
        let mut revision_ids = Vec::with_capacity(READER_EXACT_CACHE_SCAN_CAP);
        if let Some(revision_id) = self.visible_chapter_local_revision_id() {
            push_unique_bounded(&mut revision_ids, revision_id);
        }
        let mut live_revision_ids = self
            .artifacts
            .values()
            .filter(|artifact| artifact.backing == ReaderRevisionBacking::ChapterLocal)
            .map(|artifact| artifact.revision_id)
            .collect::<Vec<_>>();
        live_revision_ids.sort_unstable_by(|left, right| right.cmp(left));
        live_revision_ids.dedup();
        for revision_id in live_revision_ids {
            push_unique_bounded(&mut revision_ids, revision_id);
        }
        revision_ids
    }

    fn visible_chapter_local_revision_id(&self) -> Option<u64> {
        let artifact_id = self.visible_intent.as_ref()?.visible_artifact_id;
        let artifact = self.artifacts.get(&artifact_id)?;
        (artifact.backing == ReaderRevisionBacking::ChapterLocal).then_some(artifact.revision_id)
    }

    fn cached_exact_owner(
        &self,
        revision_id: u64,
        chapter_index: usize,
        layout: &LayoutConfig,
        locator: &RuntimeSourceLocator,
    ) -> Option<crate::runtime::RuntimeChapterLocalRevisionHandle> {
        let revision = self.revisions.get(&revision_id)?;
        (revision.artifact_ref_count > 0
            && revision.owner.coordinate.chapter_index == chapter_index
            && revision.layout == *layout
            && self.projection_is_proven(revision_id, locator))
        .then(|| revision.owner.clone())
    }

    fn projection_is_proven(&self, revision_id: u64, locator: &RuntimeSourceLocator) -> bool {
        // Anchor/source coordinates are exact and take precedence over a
        // fallback progression, so their presence proves the projection
        // by itself. Href-only and href/progression-only projection need a
        // live artifact that already published that exact locator.
        let has_exact_component = locator.anchor_id.is_some()
            || locator.source_point.is_some()
            || locator.source_range.is_some();
        if has_exact_component {
            return true;
        }
        self.artifacts.values().any(|artifact| {
            artifact.backing == ReaderRevisionBacking::ChapterLocal
                && artifact.revision_id == revision_id
                && matches!(
                    runtime_locator(artifact.locator.clone()),
                    Ok(artifact_locator) if artifact_locator == *locator
                )
        })
    }
}

fn push_unique_bounded(revision_ids: &mut Vec<u64>, revision_id: u64) {
    if revision_ids.len() < READER_EXACT_CACHE_SCAN_CAP && !revision_ids.contains(&revision_id) {
        revision_ids.push(revision_id);
    }
}
