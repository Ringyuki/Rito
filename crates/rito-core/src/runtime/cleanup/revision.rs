use std::{num::NonZeroUsize, vec};

use crate::layout::{CleanupProgress, PendingBuiltLayoutCleanup, PendingLayoutConfigCleanup};

use super::{
    super::{
        frame::{RuntimeFrameCacheOwner, RuntimeRevision, RuntimeRevisionCoordinateSpace},
        RuntimeRequiredFontFace, RuntimeRevisionExtent, RuntimeRevisionStatus,
    },
    PendingRuntimeFrameCacheCleanup, PendingRuntimeRevisionInteractionsCleanup,
};

/// Copy-only remainder of a decomposed runtime revision.
#[derive(Debug)]
struct RuntimeRevisionShell {
    coordinate_space: RuntimeRevisionCoordinateSpace,
    revision_version: u32,
    status: RuntimeRevisionStatus,
    known_extent: RuntimeRevisionExtent,
    final_extent: Option<RuntimeRevisionExtent>,
}

/// Releases derived frames before the recursive built layout and flat fields.
///
/// If frame-cache cleanup costs `FC`, built-layout cleanup costs `BL`, layout
/// configuration cleanup costs `LC`, the catalog contains `RF` faces, and
/// interaction cleanup costs `RI`, this cursor costs exactly
/// `FC + BL + LC + RF + RI + 7` units. Cached-frame table entries are
/// scheduled inside `FC`; individual legacy JSON values and flat allocation
/// releases remain atomic residuals, so this is not an end-to-end wall-clock
/// bound.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeRevisionCleanup {
    owner: Option<RuntimeRevision>,
    frame_cache: Option<PendingRuntimeFrameCacheCleanup>,
    layout: Option<PendingBuiltLayoutCleanup>,
    layout_config: Option<PendingLayoutConfigCleanup>,
    required_font_face_catalog: Option<vec::IntoIter<RuntimeRequiredFontFace>>,
    interactions: Option<PendingRuntimeRevisionInteractionsCleanup>,
    shell: Option<RuntimeRevisionShell>,
    stage: RuntimeRevisionCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeRevisionCleanupStage {
    RevisionSource,
    FrameCache,
    Layout,
    LayoutConfig,
    RequiredFontFaceCatalog,
    Interactions,
    Owner,
    Complete,
}

impl PendingRuntimeRevisionCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeRevision) -> Self {
        Self {
            owner: Some(owner),
            frame_cache: None,
            layout: None,
            layout_config: None,
            required_font_face_catalog: None,
            interactions: None,
            shell: None,
            stage: RuntimeRevisionCleanupStage::RevisionSource,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == RuntimeRevisionCleanupStage::Complete
    }

    pub(in crate::runtime) fn pending_frame_owner_count(&self) -> usize {
        self.owner.as_ref().map_or_else(
            || {
                self.frame_cache.as_ref().map_or(
                    0,
                    PendingRuntimeFrameCacheCleanup::pending_frame_owner_count,
                )
            },
            |owner| owner.frame_cache.len(),
        )
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            RuntimeRevisionCleanupStage::RevisionSource => self.start_revision(),
            RuntimeRevisionCleanupStage::FrameCache => self.advance_frame_cache(),
            RuntimeRevisionCleanupStage::Layout => self.advance_layout(),
            RuntimeRevisionCleanupStage::LayoutConfig => self.advance_layout_config(),
            RuntimeRevisionCleanupStage::RequiredFontFaceCatalog => {
                self.release_required_font_face_catalog()
            }
            RuntimeRevisionCleanupStage::Interactions => self.advance_interactions(),
            RuntimeRevisionCleanupStage::Owner => self.release_owner(),
            RuntimeRevisionCleanupStage::Complete => false,
        }
    }

    pub(in crate::runtime) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
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

    pub(in crate::runtime) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn start_revision(&mut self) -> bool {
        let owner = self
            .owner
            .take()
            .expect("cleanup owns its runtime revision");
        let RuntimeRevision {
            coordinate_space,
            revision_version,
            status,
            known_extent,
            final_extent,
            layout,
            layout_config,
            // Small interned records; dropped in place, no staged cleanup.
            chapter_style_tables: _,
            required_font_face_catalog,
            interactions,
            frame_cache,
            frame_cache_order,
            // Shared command vectors; dropped in place, no staged cleanup.
            fragment_chapter_frames: _,
        } = owner;
        self.frame_cache = Some(PendingRuntimeFrameCacheCleanup::new(
            RuntimeFrameCacheOwner {
                frames: frame_cache,
                order: frame_cache_order,
            },
        ));
        self.layout = Some(PendingBuiltLayoutCleanup::new(layout));
        self.layout_config = Some(PendingLayoutConfigCleanup::new(layout_config));
        self.required_font_face_catalog = required_font_face_catalog.map(Vec::into_iter);
        self.interactions = Some(PendingRuntimeRevisionInteractionsCleanup::new(interactions));
        self.shell = Some(RuntimeRevisionShell {
            coordinate_space,
            revision_version,
            status,
            known_extent,
            final_extent,
        });
        self.stage = RuntimeRevisionCleanupStage::FrameCache;
        true
    }

    fn advance_frame_cache(&mut self) -> bool {
        let frame_cache = self
            .frame_cache
            .as_mut()
            .expect("frame-cache cleanup exists");
        if frame_cache.is_complete() {
            self.frame_cache = None;
            self.stage = RuntimeRevisionCleanupStage::Layout;
            return true;
        }
        let advanced = frame_cache.advance_one();
        debug_assert!(advanced, "incomplete frame-cache cleanup has work");
        true
    }

    fn advance_layout(&mut self) -> bool {
        let layout = self.layout.as_mut().expect("built-layout cleanup exists");
        if layout.is_complete() {
            self.layout = None;
            self.stage = RuntimeRevisionCleanupStage::LayoutConfig;
            return true;
        }
        let advanced = layout.advance_one();
        debug_assert!(advanced, "incomplete built-layout cleanup has work");
        true
    }

    fn advance_layout_config(&mut self) -> bool {
        let layout_config = self
            .layout_config
            .as_mut()
            .expect("layout-config cleanup exists");
        if layout_config.is_complete() {
            self.layout_config = None;
            self.stage = RuntimeRevisionCleanupStage::RequiredFontFaceCatalog;
            return true;
        }
        let advanced = layout_config.advance_one();
        debug_assert!(advanced, "incomplete layout-config cleanup has work");
        true
    }

    fn release_required_font_face_catalog(&mut self) -> bool {
        if let Some(face) = self
            .required_font_face_catalog
            .as_mut()
            .and_then(Iterator::next)
        {
            drop(face);
            return true;
        }
        self.required_font_face_catalog = None;
        self.stage = RuntimeRevisionCleanupStage::Interactions;
        true
    }

    fn advance_interactions(&mut self) -> bool {
        let interactions = self
            .interactions
            .as_mut()
            .expect("revision-interactions cleanup exists");
        if interactions.is_complete() {
            self.interactions = None;
            self.stage = RuntimeRevisionCleanupStage::Owner;
            return true;
        }
        let advanced = interactions.advance_one();
        debug_assert!(
            advanced,
            "incomplete revision-interactions cleanup has work"
        );
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("runtime-revision shell exists");
        let RuntimeRevisionShell {
            coordinate_space,
            revision_version,
            status,
            known_extent,
            final_extent,
        } = shell;
        let _ = (
            coordinate_space,
            revision_version,
            status,
            known_extent,
            final_extent,
        );
        self.stage = RuntimeRevisionCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimeRevisionCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "revision/tests.rs"]
mod tests;
