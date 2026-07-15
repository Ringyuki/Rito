use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::{
    render::{DisplayListResourceRefs, PackedDisplayCommandRecordStats},
    runtime::{
        frame::{RuntimeCachedFrame, RuntimeFrameCacheOwner},
        RuntimeFrame, RuntimeFrameCommandBuffer, RuntimeFrameCommandBufferMetadata,
    },
};

pub(super) fn cached_frame(spread_index: usize, command_count: usize) -> RuntimeCachedFrame {
    let commands = (0..command_count)
        .map(|index| json!({ "kind": "paintText", "text": index.to_string() }))
        .collect();
    RuntimeCachedFrame {
        frame: RuntimeFrame {
            revision_id: "revision".to_owned(),
            spread_index,
            page_indexes: vec![spread_index],
            width: Value::from(320),
            height: Value::from(120),
            commands,
            command_count,
            command_counts: BTreeMap::from([("paintText".to_owned(), command_count)]),
            command_hash: "hash".to_owned(),
            resource_refs: DisplayListResourceRefs {
                image_refs: 0,
                unique_images: 0,
                image_hash: "images".to_owned(),
                images: Vec::new(),
            },
            font_families: vec!["serif".to_owned()],
            image_dominated: false,
        },
        command_buffer: RuntimeFrameCommandBuffer {
            metadata: RuntimeFrameCommandBufferMetadata {
                revision_id: "revision".to_owned(),
                spread_index,
                width: Value::from(320),
                height: Value::from(120),
                protocol_version: 2,
                command_count,
                command_counts: BTreeMap::from([("paintText".to_owned(), command_count)]),
                record_stats: PackedDisplayCommandRecordStats::default(),
                byte_length: command_count,
                command_hash: "hash".to_owned(),
                resource_ref_count: 0,
                resource_table: Vec::new(),
                font_families: vec!["serif".to_owned()],
                image_dominated: false,
                string_table: Vec::new(),
                payload_table: Vec::new(),
            },
            bytes: vec![0; command_count],
        },
    }
}

pub(super) fn frame_cache_owner(
    frames: BTreeMap<usize, RuntimeCachedFrame>,
) -> RuntimeFrameCacheOwner {
    let order = frames.keys().copied().collect();
    RuntimeFrameCacheOwner { frames, order }
}
