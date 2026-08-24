use crate::{
    layout::LayoutConfig,
    runtime::{RuntimeChapterLocalSourceLocatorResolution, RuntimeSourceLocator},
};

use super::{
    engine_error, runtime_locator, ReaderErrorV1, ReaderRevisionBackingV1, ReaderSessionV1,
    ResolvedArtifactOwnerV1, ResolvedArtifactTarget, READER_LIVE_ARTIFACT_CAP_V1,
    READER_RETAINED_WINDOW_CAP_V1,
};

// Four live artifacts can own at most four distinct chapter-local revisions;
// the retained rollover queue contributes at most two more. Keep the lookup
// explicitly bounded even if an ownership bug ever leaves extra map entries.
const READER_EXACT_CACHE_SCAN_CAP_V1: usize =
    READER_LIVE_ARTIFACT_CAP_V1 as usize + READER_RETAINED_WINDOW_CAP_V1;

impl ReaderSessionV1 {
    /// Finds an exact locator only in already-published chapter-local pages.
    ///
    /// Selection is deterministic: the visible revision first, then other
    /// live-artifact revisions by newest reader revision id, then zero-ref
    /// retained windows from most- to least-recently retained.
    pub(super) fn find_cached_exact_target(
        &mut self,
        chapter_index: usize,
        layout: &LayoutConfig,
        locator: &RuntimeSourceLocator,
        local_page_cap: u32,
    ) -> Result<Option<(u64, ResolvedArtifactTarget)>, ReaderErrorV1> {
        for revision_id in self.exact_cache_revision_ids() {
            let Some(owner) = self.cached_exact_owner(
                revision_id,
                chapter_index,
                layout,
                locator,
                local_page_cap,
            ) else {
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
    ) -> Result<Option<(u64, ResolvedArtifactTarget)>, ReaderErrorV1> {
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
                owner: ResolvedArtifactOwnerV1::ChapterLocal(owner),
                locator: resolved_locator,
                matched_by,
                local_page_index,
                local_spread_index,
            },
        )))
    }

    fn exact_cache_revision_ids(&self) -> Vec<u64> {
        let mut revision_ids = Vec::with_capacity(READER_EXACT_CACHE_SCAN_CAP_V1);
        if let Some(revision_id) = self.visible_chapter_local_revision_id() {
            push_unique_bounded(&mut revision_ids, revision_id);
        }
        let mut live_revision_ids = self
            .artifacts
            .values()
            .filter(|artifact| artifact.backing == ReaderRevisionBackingV1::ChapterLocal)
            .map(|artifact| artifact.revision_id)
            .collect::<Vec<_>>();
        live_revision_ids.sort_unstable_by(|left, right| right.cmp(left));
        live_revision_ids.dedup();
        for revision_id in live_revision_ids {
            push_unique_bounded(&mut revision_ids, revision_id);
        }
        for &revision_id in self.retained_windows.iter().rev() {
            if self
                .revisions
                .get(&revision_id)
                .is_some_and(|revision| revision.artifact_ref_count == 0)
            {
                push_unique_bounded(&mut revision_ids, revision_id);
            }
        }
        revision_ids
    }

    fn visible_chapter_local_revision_id(&self) -> Option<u64> {
        let artifact_id = self.visible_intent.as_ref()?.visible_artifact_id;
        let artifact = self.artifacts.get(&artifact_id)?;
        (artifact.backing == ReaderRevisionBackingV1::ChapterLocal).then_some(artifact.revision_id)
    }

    fn cached_exact_owner(
        &self,
        revision_id: u64,
        chapter_index: usize,
        layout: &LayoutConfig,
        locator: &RuntimeSourceLocator,
        local_page_cap: u32,
    ) -> Option<crate::runtime::RuntimeChapterLocalRevisionHandle> {
        let revision = self.revisions.get(&revision_id)?;
        let is_live_or_retained =
            revision.artifact_ref_count > 0 || self.retained_windows.contains(&revision_id);
        (is_live_or_retained
            && revision.owner.coordinate.chapter_index == chapter_index
            && revision.layout == *layout
            && revision.local_page_cap == local_page_cap
            && self.window_projection_is_safe(revision_id, locator))
        .then(|| revision.owner.clone())
    }

    fn window_projection_is_safe(&self, revision_id: u64, locator: &RuntimeSourceLocator) -> bool {
        // A rolled window's local page zero is not the chapter's page zero.
        // Href and progression projection can otherwise alias that local
        // origin. Anchor/source coordinates are exact and take precedence over
        // a fallback progression, so their presence makes a retained window
        // safe without requiring a still-live artifact. Only href-only and
        // href/progression-only projection need an exact live proof.
        let has_exact_component = locator.anchor_id.is_some()
            || locator.source_point.is_some()
            || locator.source_range.is_some();
        if has_exact_component {
            return true;
        }
        self.artifacts.values().any(|artifact| {
            artifact.backing == ReaderRevisionBackingV1::ChapterLocal
                && artifact.revision_id == revision_id
                && matches!(
                    runtime_locator(artifact.locator.clone()),
                    Ok(artifact_locator) if artifact_locator == *locator
                )
        })
    }
}

fn push_unique_bounded(revision_ids: &mut Vec<u64>, revision_id: u64) {
    if revision_ids.len() < READER_EXACT_CACHE_SCAN_CAP_V1 && !revision_ids.contains(&revision_id) {
        revision_ids.push(revision_id);
    }
}
