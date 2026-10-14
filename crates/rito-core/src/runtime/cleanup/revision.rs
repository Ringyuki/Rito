use std::{num::NonZeroUsize, vec};

use crate::runtime::cleanup::CleanupProgress;

use super::{
    super::{
        frame::{RuntimeRevision, RuntimeRevisionCoordinateSpace},
        RuntimeRequiredFontFace, RuntimeRevisionExtent,
    },
    PendingRuntimeRevisionInteractionsCleanup,
};

/// Copy-only remainder of a decomposed runtime revision.
#[derive(Debug)]
struct RuntimeRevisionShell {
    coordinate_space: RuntimeRevisionCoordinateSpace,
    revision_version: u32,
    extent: RuntimeRevisionExtent,
}

/// Releases a retired revision a unit at a time.
///
/// If the catalog contains `RF` faces and interaction cleanup costs `RI`,
/// this cursor costs exactly `RF + RI + 4` units. The layout configuration
/// and the fragment page table are dropped in place with the decomposition
/// unit: the configuration is a handful of scalars and one family string,
/// but the page table owns every materialized chapter (its formatting tree,
/// sealed fragment trees and cached paint commands), so that single unit
/// can be the largest release of all. The page table and other allocation
/// releases remain atomic residuals, so this is not an end-to-end
/// wall-clock bound.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeRevisionCleanup {
    owner: Option<RuntimeRevision>,
    required_font_face_catalog: Option<vec::IntoIter<RuntimeRequiredFontFace>>,
    interactions: Option<PendingRuntimeRevisionInteractionsCleanup>,
    shell: Option<RuntimeRevisionShell>,
    stage: RuntimeRevisionCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeRevisionCleanupStage {
    RevisionSource,
    RequiredFontFaceCatalog,
    Interactions,
    Owner,
    Complete,
}

impl PendingRuntimeRevisionCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeRevision) -> Self {
        Self {
            owner: Some(owner),
            required_font_face_catalog: None,
            interactions: None,
            shell: None,
            stage: RuntimeRevisionCleanupStage::RevisionSource,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == RuntimeRevisionCleanupStage::Complete
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            RuntimeRevisionCleanupStage::RevisionSource => self.start_revision(),
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
            extent,
            // The flat configuration, small interned records and the flat
            // page table; dropped in place, no staged cleanup.
            layout_config: _,
            chapter_style_tables: _,
            fragment_layout: _,
            required_font_face_catalog,
            interactions,
        } = owner;
        self.required_font_face_catalog = required_font_face_catalog.map(Vec::into_iter);
        self.interactions = Some(PendingRuntimeRevisionInteractionsCleanup::new(interactions));
        self.shell = Some(RuntimeRevisionShell {
            coordinate_space,
            revision_version,
            extent,
        });
        self.stage = RuntimeRevisionCleanupStage::RequiredFontFaceCatalog;
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
            extent,
        } = shell;
        let _ = (coordinate_space, revision_version, extent);
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
