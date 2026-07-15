use std::num::NonZeroUsize;

use crate::layout::{CleanupProgress, LayoutConfig, PendingBuiltLayoutCleanup};

use super::{
    super::{
        frame::{RuntimeFrameCacheOwner, RuntimeRevision, RuntimeRevisionInteractions},
        RuntimeRequiredFontFace, RuntimeRevisionExtent, RuntimeRevisionStatus,
    },
    PendingRuntimeFrameCacheCleanup,
};

/// Copy-only remainder of a decomposed runtime revision.
#[derive(Debug)]
struct RuntimeRevisionShell {
    revision_version: u32,
    status: RuntimeRevisionStatus,
    known_extent: RuntimeRevisionExtent,
    final_extent: Option<RuntimeRevisionExtent>,
}

/// Releases derived frames before the recursive built layout and flat fields.
///
/// If frame-cache cleanup costs `FC` and built-layout cleanup costs `BL`, this
/// cursor costs exactly `FC + BL + 7` units. Layout metadata, configuration,
/// font catalogs, interactions and each generated cached frame retain
/// indivisible destructor residuals, so this is a structural stack-safety
/// bound rather than a wall-clock bound.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeRevisionCleanup {
    owner: Option<RuntimeRevision>,
    frame_cache: Option<PendingRuntimeFrameCacheCleanup>,
    layout: Option<PendingBuiltLayoutCleanup>,
    layout_config: Option<LayoutConfig>,
    required_font_face_catalog: Option<Option<Vec<RuntimeRequiredFontFace>>>,
    interactions: Option<RuntimeRevisionInteractions>,
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
            RuntimeRevisionCleanupStage::LayoutConfig => self.release_layout_config(),
            RuntimeRevisionCleanupStage::RequiredFontFaceCatalog => {
                self.release_required_font_face_catalog()
            }
            RuntimeRevisionCleanupStage::Interactions => self.release_interactions(),
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
            revision_version,
            status,
            known_extent,
            final_extent,
            layout,
            layout_config,
            required_font_face_catalog,
            interactions,
            frame_cache,
            frame_cache_order,
        } = owner;
        self.frame_cache = Some(PendingRuntimeFrameCacheCleanup::new(
            RuntimeFrameCacheOwner {
                frames: frame_cache,
                order: frame_cache_order,
            },
        ));
        self.layout = Some(PendingBuiltLayoutCleanup::new(layout));
        self.layout_config = Some(layout_config);
        self.required_font_face_catalog = Some(required_font_face_catalog);
        self.interactions = Some(interactions);
        self.shell = Some(RuntimeRevisionShell {
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

    fn release_layout_config(&mut self) -> bool {
        drop(
            self.layout_config
                .take()
                .expect("revision layout config exists"),
        );
        self.stage = RuntimeRevisionCleanupStage::RequiredFontFaceCatalog;
        true
    }

    fn release_required_font_face_catalog(&mut self) -> bool {
        drop(
            self.required_font_face_catalog
                .take()
                .expect("font-catalog ownership slot exists"),
        );
        self.stage = RuntimeRevisionCleanupStage::Interactions;
        true
    }

    fn release_interactions(&mut self) -> bool {
        drop(
            self.interactions
                .take()
                .expect("revision interactions exist"),
        );
        self.stage = RuntimeRevisionCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("runtime-revision shell exists");
        let RuntimeRevisionShell {
            revision_version,
            status,
            known_extent,
            final_extent,
        } = shell;
        let _ = (revision_version, status, known_extent, final_extent);
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
