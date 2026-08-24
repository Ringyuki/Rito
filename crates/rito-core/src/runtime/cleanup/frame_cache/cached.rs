use std::{num::NonZeroUsize, vec};

use crate::{layout::CleanupProgress, runtime::frame::RuntimeCachedFrame};

use parts::{
    CommandBufferParts, JsonCommandSource, LegacyFrameParts, RuntimeFrameCommandBufferShell,
    RuntimeFrameShell, StringSource,
};

mod parts;

/// Incrementally releases one generated cached frame.
///
/// Let the packed resource, font, string and payload tables contain `R`, `F`,
/// `S` and `P` entries. A packed-only frame costs exactly
/// `7 + R + F + S + P` units. If a compatibility JSON frame is present, with
/// `C` commands, `I` image refs and `J` font families, it adds
/// `C + I + J + 4` units. The packed byte allocation is one explicit unit;
/// scalar metadata and bounded command-kind maps remain in the final shell.
/// Each JSON command is still an indivisible nested-value residual.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeCachedFrameCleanup {
    owner: Option<RuntimeCachedFrame>,
    legacy_commands: Option<JsonCommandSource>,
    legacy_resource_images: Option<StringSource>,
    legacy_font_families: Option<StringSource>,
    legacy_shell: Option<RuntimeFrameShell>,
    resource_table: Option<StringSource>,
    font_families: Option<StringSource>,
    string_table: Option<StringSource>,
    payload_table: Option<StringSource>,
    bytes: Option<Vec<u8>>,
    command_buffer_shell: Option<RuntimeFrameCommandBufferShell>,
    stage: RuntimeCachedFrameCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeCachedFrameCleanupStage {
    Source,
    LegacyCommands,
    LegacyResourceImages,
    LegacyFontFamilies,
    LegacyOwner,
    ResourceTable,
    FontFamilies,
    StringTable,
    PayloadTable,
    Bytes,
    CommandBufferOwner,
    Complete,
}

impl PendingRuntimeCachedFrameCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeCachedFrame) -> Self {
        Self {
            owner: Some(owner),
            legacy_commands: None,
            legacy_resource_images: None,
            legacy_font_families: None,
            legacy_shell: None,
            resource_table: None,
            font_families: None,
            string_table: None,
            payload_table: None,
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
            RuntimeCachedFrameCleanupStage::LegacyCommands => self.advance_legacy_commands(),
            RuntimeCachedFrameCleanupStage::LegacyResourceImages => {
                self.advance_legacy_resource_images()
            }
            RuntimeCachedFrameCleanupStage::LegacyFontFamilies => {
                self.advance_legacy_font_families()
            }
            RuntimeCachedFrameCleanupStage::LegacyOwner => self.release_legacy_owner(),
            RuntimeCachedFrameCleanupStage::ResourceTable => self.advance_resource_table(),
            RuntimeCachedFrameCleanupStage::FontFamilies => self.advance_font_families(),
            RuntimeCachedFrameCleanupStage::StringTable => self.advance_string_table(),
            RuntimeCachedFrameCleanupStage::PayloadTable => self.advance_payload_table(),
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
        let RuntimeCachedFrame {
            frame,
            command_buffer,
        } = owner;
        let CommandBufferParts {
            resource_table,
            font_families,
            string_table,
            payload_table,
            bytes,
            shell,
        } = CommandBufferParts::new(command_buffer);
        self.resource_table = Some(resource_table);
        self.font_families = Some(font_families);
        self.string_table = Some(string_table);
        self.payload_table = Some(payload_table);
        self.bytes = Some(bytes);
        self.command_buffer_shell = Some(shell);
        if let Some(frame) = frame {
            let LegacyFrameParts {
                commands,
                resource_images,
                font_families,
                shell,
            } = LegacyFrameParts::new(frame);
            self.legacy_commands = Some(commands);
            self.legacy_resource_images = Some(resource_images);
            self.legacy_font_families = Some(font_families);
            self.legacy_shell = Some(shell);
            self.stage = RuntimeCachedFrameCleanupStage::LegacyCommands;
        } else {
            self.stage = RuntimeCachedFrameCleanupStage::ResourceTable;
        }
        true
    }

    fn advance_legacy_commands(&mut self) -> bool {
        if release_one_or_finish_source(&mut self.legacy_commands) {
            self.stage = RuntimeCachedFrameCleanupStage::LegacyResourceImages;
        }
        true
    }

    fn advance_legacy_resource_images(&mut self) -> bool {
        if release_one_or_finish_source(&mut self.legacy_resource_images) {
            self.stage = RuntimeCachedFrameCleanupStage::LegacyFontFamilies;
        }
        true
    }

    fn advance_legacy_font_families(&mut self) -> bool {
        if release_one_or_finish_source(&mut self.legacy_font_families) {
            self.stage = RuntimeCachedFrameCleanupStage::LegacyOwner;
        }
        true
    }

    fn release_legacy_owner(&mut self) -> bool {
        let shell = self.legacy_shell.take().expect("legacy frame shell exists");
        shell.release();
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
            self.stage = RuntimeCachedFrameCleanupStage::StringTable;
        }
        true
    }

    fn advance_string_table(&mut self) -> bool {
        if release_one_or_finish_source(&mut self.string_table) {
            self.stage = RuntimeCachedFrameCleanupStage::PayloadTable;
        }
        true
    }

    fn advance_payload_table(&mut self) -> bool {
        if release_one_or_finish_source(&mut self.payload_table) {
            self.stage = RuntimeCachedFrameCleanupStage::Bytes;
        }
        true
    }

    fn release_bytes(&mut self) -> bool {
        drop(self.bytes.take().expect("packed command bytes exist"));
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
