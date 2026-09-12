use std::collections::BTreeMap;

use serde_json::Value;

use crate::runtime::{
    frame::{RuntimeCachedFrame, RuntimeFrameCacheOwner},
    RuntimeFrameCommandBuffer, RuntimeFrameCommandBufferMetadata,
};

/// A synthetic cached frame whose metadata counts `command_count`
/// commands and whose primitive bytes are `command_count` long.
pub(super) fn cached_frame(spread_index: usize, command_count: usize) -> RuntimeCachedFrame {
    RuntimeCachedFrame {
        command_buffer: RuntimeFrameCommandBuffer {
            metadata: RuntimeFrameCommandBufferMetadata {
                revision_id: "revision".to_owned(),
                spread_index,
                width: Value::from(320),
                height: Value::from(120),
                protocol_version: 2,
                ratio: 1.0,
                command_count,
                command_counts: BTreeMap::from([("paintText".to_owned(), command_count)]),
                primitive_count: command_count,
                byte_length: command_count,
                command_hash: "hash".to_owned(),
                resource_ref_count: 0,
                resource_table: Vec::new(),
                font_families: vec!["serif".to_owned()],
                image_dominated: false,
            },
            bytes: vec![0; command_count],
        },
    }
}

/// A cached frame whose resource table lists `resource_count` images, the
/// one payload whose cleanup cost scales with its size.
pub(super) fn wide_resource_cached_frame(
    spread_index: usize,
    resource_count: usize,
) -> RuntimeCachedFrame {
    let mut frame = cached_frame(spread_index, 0);
    frame.command_buffer.metadata.resource_ref_count = resource_count;
    frame.command_buffer.metadata.resource_table = (0..resource_count)
        .map(|index| format!("resource-{index}"))
        .collect();
    frame
}

pub(super) fn frame_cache_owner(
    frames: BTreeMap<usize, RuntimeCachedFrame>,
) -> RuntimeFrameCacheOwner {
    let order = frames.keys().copied().collect();
    RuntimeFrameCacheOwner { frames, order }
}
