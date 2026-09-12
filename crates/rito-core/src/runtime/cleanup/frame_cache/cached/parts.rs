use std::{collections::BTreeMap, vec};

use serde_json::Value;

use crate::runtime::{RuntimeFrameCommandBuffer, RuntimeFrameCommandBufferMetadata};

pub(super) type StringSource = vec::IntoIter<String>;

pub(super) struct CommandBufferParts {
    pub(super) resource_table: StringSource,
    pub(super) font_families: StringSource,
    pub(super) bytes: Vec<u8>,
    pub(super) shell: RuntimeFrameCommandBufferShell,
}

impl CommandBufferParts {
    pub(super) fn new(command_buffer: RuntimeFrameCommandBuffer) -> Self {
        let RuntimeFrameCommandBuffer { metadata, bytes } = command_buffer;
        let RuntimeFrameCommandBufferMetadata {
            revision_id,
            spread_index,
            width,
            height,
            protocol_version,
            ratio,
            command_count,
            command_counts,
            primitive_count,
            byte_length,
            command_hash,
            resource_ref_count,
            resource_table,
            font_families,
            image_dominated,
        } = metadata;
        Self {
            resource_table: resource_table.into_iter(),
            font_families: font_families.into_iter(),
            bytes,
            shell: RuntimeFrameCommandBufferShell {
                revision_id,
                spread_index,
                width,
                height,
                protocol_version,
                ratio,
                command_count,
                command_counts,
                primitive_count,
                byte_length,
                command_hash,
                resource_ref_count,
                image_dominated,
            },
        }
    }
}

/// Remainder of a decomposed primitive command buffer.
#[derive(Debug)]
pub(super) struct RuntimeFrameCommandBufferShell {
    revision_id: String,
    spread_index: usize,
    width: Value,
    height: Value,
    protocol_version: u32,
    ratio: f64,
    command_count: usize,
    command_counts: BTreeMap<String, usize>,
    primitive_count: usize,
    byte_length: usize,
    command_hash: String,
    resource_ref_count: usize,
    image_dominated: bool,
}

impl RuntimeFrameCommandBufferShell {
    pub(super) fn release(self) {
        let Self {
            revision_id,
            spread_index,
            width,
            height,
            protocol_version,
            ratio,
            command_count,
            command_counts,
            primitive_count,
            byte_length,
            command_hash,
            resource_ref_count,
            image_dominated,
        } = self;
        let _ = (
            revision_id,
            spread_index,
            width,
            height,
            protocol_version,
            ratio,
            command_count,
            command_counts,
            primitive_count,
            byte_length,
            command_hash,
            resource_ref_count,
            image_dominated,
        );
    }
}
