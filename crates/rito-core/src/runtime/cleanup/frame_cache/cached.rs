use std::{num::NonZeroUsize, vec};

use crate::runtime::{cleanup::CleanupProgress, frame::RuntimeCachedFrame};

use parts::{CommandBufferParts, RuntimeFrameCommandBufferShell, StringSource};

mod parts;

/// Incrementally releases one cached frame.
///
/// Let the command buffer's resource and font tables contain `R` and `F`
/// entries. A frame costs exactly `5 + R + F` units: one to decompose it,
/// `R + 1` and `F + 1` to drain the two tables, one for the primitive byte
/// allocation (a single unit whatever its length), and one to retire the
/// shell of scalar metadata and bounded command-kind maps.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeCachedFrameCleanup {
    owner: Option<RuntimeCachedFrame>,
    resource_table: Option<StringSource>,
    font_families: Option<StringSource>,
    bytes: Option<Vec<u8>>,
    command_buffer_shell: Option<RuntimeFrameCommandBufferShell>,
    stage: RuntimeCachedFrameCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeCachedFrameCleanupStage {
    Source,
    ResourceTable,
    FontFamilies,
    Bytes,
    CommandBufferOwner,
    Complete,
}

impl PendingRuntimeCachedFrameCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeCachedFrame) -> Self {
        Self {
            owner: Some(owner),
            resource_table: None,
            font_families: None,
            bytes: None,
            command_buffer_shell: None,
            stage: RuntimeCachedFrameCleanupStage::Source,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == RuntimeCachedFrameCleanupStage::Complete
    }

    pub(in crate::runtime) fn pending_frame_owner_count(&self) -> usize {
        usize::from(!self.is_complete())
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            RuntimeCachedFrameCleanupStage::Source => self.start_source(),
            RuntimeCachedFrameCleanupStage::ResourceTable => self.advance_resource_table(),
            RuntimeCachedFrameCleanupStage::FontFamilies => self.advance_font_families(),
            RuntimeCachedFrameCleanupStage::Bytes => self.release_bytes(),
            RuntimeCachedFrameCleanupStage::CommandBufferOwner => {
                self.release_command_buffer_owner()
            }
            RuntimeCachedFrameCleanupStage::Complete => false,
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

    fn start_source(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its cached frame");
        let RuntimeCachedFrame { command_buffer } = owner;
        let CommandBufferParts {
            resource_table,
            font_families,
            bytes,
            shell,
        } = CommandBufferParts::new(command_buffer);
        self.resource_table = Some(resource_table);
        self.font_families = Some(font_families);
        self.bytes = Some(bytes);
        self.command_buffer_shell = Some(shell);
        self.stage = RuntimeCachedFrameCleanupStage::ResourceTable;
        true
    }

    fn advance_resource_table(&mut self) -> bool {
        if release_one_or_finish_source(&mut self.resource_table) {
            self.stage = RuntimeCachedFrameCleanupStage::FontFamilies;
        }
        true
    }

    fn advance_font_families(&mut self) -> bool {
        if release_one_or_finish_source(&mut self.font_families) {
            self.stage = RuntimeCachedFrameCleanupStage::Bytes;
        }
        true
    }

    fn release_bytes(&mut self) -> bool {
        drop(self.bytes.take().expect("primitive command bytes exist"));
        self.stage = RuntimeCachedFrameCleanupStage::CommandBufferOwner;
        true
    }

    fn release_command_buffer_owner(&mut self) -> bool {
        let shell = self
            .command_buffer_shell
            .take()
            .expect("command-buffer shell exists");
        shell.release();
        self.stage = RuntimeCachedFrameCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimeCachedFrameCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

fn release_one_or_finish_source<T>(source: &mut Option<vec::IntoIter<T>>) -> bool {
    let owners = source.as_mut().expect("frame-payload source exists");
    if let Some(owner) = owners.next() {
        drop(owner);
        return false;
    }
    *source = None;
    true
}
