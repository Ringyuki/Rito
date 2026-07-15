use std::{collections::BTreeMap, vec};

use serde_json::Value;

use crate::{
    render::{DisplayListResourceRefs, PackedDisplayCommandRecordStats},
    runtime::{RuntimeFrame, RuntimeFrameCommandBuffer, RuntimeFrameCommandBufferMetadata},
};

pub(super) type JsonCommandSource = vec::IntoIter<Value>;
pub(super) type StringSource = vec::IntoIter<String>;

pub(super) struct LegacyFrameParts {
    pub(super) commands: JsonCommandSource,
    pub(super) resource_images: StringSource,
    pub(super) font_families: StringSource,
    pub(super) shell: RuntimeFrameShell,
}

impl LegacyFrameParts {
    pub(super) fn new(frame: RuntimeFrame) -> Self {
        let RuntimeFrame {
            revision_id,
            spread_index,
            page_indexes,
            width,
            height,
            commands,
            command_count,
            command_counts,
            command_hash,
            resource_refs,
            font_families,
            image_dominated,
        } = frame;
        let DisplayListResourceRefs {
            image_refs: resource_image_refs,
            unique_images: resource_unique_images,
            image_hash: resource_image_hash,
            images,
        } = resource_refs;
        Self {
            commands: commands.into_iter(),
            resource_images: images.into_iter(),
            font_families: font_families.into_iter(),
            shell: RuntimeFrameShell {
                revision_id,
                spread_index,
                page_indexes,
                width,
                height,
                command_count,
                command_counts,
                command_hash,
                resource_image_refs,
                resource_unique_images,
                resource_image_hash,
                image_dominated,
            },
        }
    }
}

pub(super) struct CommandBufferParts {
    pub(super) resource_table: StringSource,
    pub(super) font_families: StringSource,
    pub(super) string_table: StringSource,
    pub(super) payload_table: StringSource,
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
            command_count,
            command_counts,
            record_stats,
            byte_length,
            command_hash,
            resource_ref_count,
            resource_table,
            font_families,
            image_dominated,
            string_table,
            payload_table,
        } = metadata;
        Self {
            resource_table: resource_table.into_iter(),
            font_families: font_families.into_iter(),
            string_table: string_table.into_iter(),
            payload_table: payload_table.into_iter(),
            bytes,
            shell: RuntimeFrameCommandBufferShell {
                revision_id,
                spread_index,
                width,
                height,
                protocol_version,
                command_count,
                command_counts,
                record_stats,
                byte_length,
                command_hash,
                resource_ref_count,
                image_dominated,
            },
        }
    }
}

/// Remainder of a decomposed compatibility JSON frame.
#[derive(Debug)]
pub(super) struct RuntimeFrameShell {
    revision_id: String,
    spread_index: usize,
    page_indexes: Vec<usize>,
    width: Value,
    height: Value,
    command_count: usize,
    command_counts: BTreeMap<String, usize>,
    command_hash: String,
    resource_image_refs: usize,
    resource_unique_images: usize,
    resource_image_hash: String,
    image_dominated: bool,
}

impl RuntimeFrameShell {
    pub(super) fn release(self) {
        let Self {
            revision_id,
            spread_index,
            page_indexes,
            width,
            height,
            command_count,
            command_counts,
            command_hash,
            resource_image_refs,
            resource_unique_images,
            resource_image_hash,
            image_dominated,
        } = self;
        let _ = (
            revision_id,
            spread_index,
            page_indexes,
            width,
            height,
            command_count,
            command_counts,
            command_hash,
            resource_image_refs,
            resource_unique_images,
            resource_image_hash,
            image_dominated,
        );
    }
}

/// Remainder of a decomposed packed command buffer.
#[derive(Debug)]
pub(super) struct RuntimeFrameCommandBufferShell {
    revision_id: String,
    spread_index: usize,
    width: Value,
    height: Value,
    protocol_version: u32,
    command_count: usize,
    command_counts: BTreeMap<String, usize>,
    record_stats: PackedDisplayCommandRecordStats,
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
            command_count,
            command_counts,
            record_stats,
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
            command_count,
            command_counts,
            record_stats,
            byte_length,
            command_hash,
            resource_ref_count,
            image_dominated,
        );
    }
}
