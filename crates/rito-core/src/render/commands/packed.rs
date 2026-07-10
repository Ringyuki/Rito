use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{
    count_display_commands, hash_display_commands, refs::summarize_display_list_resource_refs,
    stable_json::stable_json, DisplayCommand,
};

pub const PACKED_DISPLAY_COMMAND_BUFFER_VERSION: u32 = 2;
const PACKED_DISPLAY_COMMAND_BUFFER_MAGIC: &[u8; 8] = b"RITOFCB2";
pub(crate) const PACKED_DISPLAY_COMMAND_RECORD_BYTES: usize = 32;
const NO_STRING_INDEX: u32 = u32::MAX;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackedDisplayCommandBufferMetadata {
    pub protocol_version: u32,
    pub command_count: usize,
    pub command_counts: BTreeMap<String, usize>,
    pub record_stats: PackedDisplayCommandRecordStats,
    pub byte_length: usize,
    pub command_hash: String,
    pub resource_ref_count: usize,
    pub resource_table: Vec<String>,
    pub string_table: Vec<String>,
    pub payload_table: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackedDisplayCommandRecordStats {
    pub geometry_records: usize,
    pub paint_records: usize,
    pub payload_records: usize,
    pub primary_string_records: usize,
    pub secondary_string_records: usize,
}

impl PackedDisplayCommandRecordStats {
    fn add(&mut self, record: PackedCommandRecord) {
        if has_packed_command_flag(record.flags, 0) {
            self.geometry_records += 1;
        }
        if has_packed_command_flag(record.flags, 1) {
            self.primary_string_records += 1;
        }
        if has_packed_command_flag(record.flags, 2) {
            self.secondary_string_records += 1;
        }
        if has_packed_command_flag(record.flags, 3) {
            self.paint_records += 1;
        }
        if has_packed_command_flag(record.flags, 4) {
            self.payload_records += 1;
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackedDisplayCommandBuffer {
    pub metadata: PackedDisplayCommandBufferMetadata,
    pub bytes: Vec<u8>,
}

pub(crate) fn pack_display_commands(commands: &[DisplayCommand]) -> PackedDisplayCommandBuffer {
    let mut string_table = PackedStringTable::default();
    let mut payload_table = PackedStringTable::default();
    let resource_refs = summarize_display_list_resource_refs(commands);
    let mut records = Vec::with_capacity(commands.len() * PACKED_DISPLAY_COMMAND_RECORD_BYTES);
    let mut record_stats = PackedDisplayCommandRecordStats::default();
    for command in commands {
        let record = packed_command_record(command, &mut string_table, &mut payload_table);
        record_stats.add(record);
        write_packed_command_record(&mut records, record);
    }
    let mut bytes = Vec::with_capacity(16 + records.len());
    bytes.extend_from_slice(PACKED_DISPLAY_COMMAND_BUFFER_MAGIC);
    bytes.extend_from_slice(&PACKED_DISPLAY_COMMAND_BUFFER_VERSION.to_le_bytes());
    bytes.extend_from_slice(&(commands.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&records);

    PackedDisplayCommandBuffer {
        metadata: PackedDisplayCommandBufferMetadata {
            protocol_version: PACKED_DISPLAY_COMMAND_BUFFER_VERSION,
            command_count: commands.len(),
            command_counts: count_display_commands(commands),
            record_stats,
            byte_length: bytes.len(),
            command_hash: hash_display_commands(commands),
            resource_ref_count: resource_refs.image_refs,
            resource_table: resource_refs.images,
            string_table: string_table.values,
            payload_table: payload_table.values,
        },
        bytes,
    }
}

#[derive(Debug, Clone, Copy)]
struct PackedCommandRecord {
    opcode: u16,
    flags: u16,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    primary_string_index: u32,
    secondary_string_index: u32,
    payload_index: u32,
}

#[derive(Debug, Default)]
struct PackedStringTable {
    indexes: BTreeMap<String, u32>,
    values: Vec<String>,
}

impl PackedStringTable {
    fn insert(&mut self, value: &str) -> u32 {
        if let Some(index) = self.indexes.get(value) {
            return *index;
        }
        let index = self.values.len() as u32;
        self.values.push(value.to_owned());
        self.indexes.insert(value.to_owned(), index);
        index
    }
}

fn packed_command_record(
    command: &DisplayCommand,
    string_table: &mut PackedStringTable,
    payload_table: &mut PackedStringTable,
) -> PackedCommandRecord {
    let (x, y, width, height, has_geometry) = packed_command_geometry(command);
    let (primary_string_index, secondary_string_index, has_primary, has_secondary) =
        packed_command_strings(command, string_table);
    let payload_index = packed_command_payload(command)
        .map(|payload| payload_table.insert(&payload))
        .unwrap_or(NO_STRING_INDEX);
    PackedCommandRecord {
        opcode: command.kind_enum().opcode(),
        flags: packed_command_flags(
            command,
            has_geometry,
            has_primary,
            has_secondary,
            payload_index != NO_STRING_INDEX,
        ),
        x,
        y,
        width,
        height,
        primary_string_index,
        secondary_string_index,
        payload_index,
    }
}

fn packed_command_geometry(command: &DisplayCommand) -> (f32, f32, f32, f32, bool) {
    if let Some(rect) = command.rect().and_then(Value::as_object) {
        return (
            number_field(rect, "x"),
            number_field(rect, "y"),
            number_field(rect, "width"),
            number_field(rect, "height"),
            true,
        );
    }
    match command {
        DisplayCommand::Translate { dx, dy } => (
            number_value(Some(dx)),
            number_value(Some(dy)),
            0.0,
            0.0,
            true,
        ),
        DisplayCommand::Opacity { value } => (number_value(Some(value)), 0.0, 0.0, 0.0, true),
        _ => (0.0, 0.0, 0.0, 0.0, false),
    }
}

fn packed_command_strings(
    command: &DisplayCommand,
    string_table: &mut PackedStringTable,
) -> (u32, u32, bool, bool) {
    let primary = primary_string(command).map(|value| string_table.insert(&value));
    let secondary = secondary_string(command).map(|value| string_table.insert(&value));
    (
        primary.unwrap_or(NO_STRING_INDEX),
        secondary.unwrap_or(NO_STRING_INDEX),
        primary.is_some(),
        secondary.is_some(),
    )
}

fn primary_string(command: &DisplayCommand) -> Option<String> {
    match command {
        DisplayCommand::PaintImage { src, .. } => Some(src.clone()),
        DisplayCommand::PaintText(_) | DisplayCommand::PaintRuby(_) => {
            command.text().and_then(packed_text_string)
        }
        _ => None,
    }
}

fn packed_text_string(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    value
        .as_object()
        .and_then(|text| text.get("hash"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn secondary_string(command: &DisplayCommand) -> Option<String> {
    command.primary_href().map(str::to_owned)
}

fn packed_command_payload(command: &DisplayCommand) -> Option<String> {
    if !needs_payload(command) {
        return None;
    }
    Some(stable_json(&command.to_value(), 0))
}

fn needs_payload(command: &DisplayCommand) -> bool {
    match command {
        DisplayCommand::Transform { .. } => true,
        DisplayCommand::ClipRect { radius, .. } => radius.is_some(),
        DisplayCommand::PaintPage { .. }
        | DisplayCommand::PaintBlock { .. }
        | DisplayCommand::PaintText(_)
        | DisplayCommand::PaintRuby(_)
        | DisplayCommand::PaintHorizontalRule { .. } => true,
        DisplayCommand::PaintImage { alt, .. } => alt.is_some(),
        DisplayCommand::PushState
        | DisplayCommand::PopState
        | DisplayCommand::Translate { .. }
        | DisplayCommand::Opacity { .. } => false,
    }
}

fn packed_command_flags(
    command: &DisplayCommand,
    has_geometry: bool,
    has_primary: bool,
    has_secondary: bool,
    has_payload: bool,
) -> u16 {
    let mut flags = 0u16;
    if has_geometry {
        flags |= 1;
    }
    if has_primary {
        flags |= 1 << 1;
    }
    if has_secondary {
        flags |= 1 << 2;
    }
    if command.paint().is_some() {
        flags |= 1 << 3;
    }
    if has_payload {
        flags |= 1 << 4;
    }
    flags
}

fn has_packed_command_flag(flags: u16, bit: u16) -> bool {
    (flags & (1u16 << bit)) != 0
}

fn write_packed_command_record(output: &mut Vec<u8>, record: PackedCommandRecord) {
    output.extend_from_slice(&record.opcode.to_le_bytes());
    output.extend_from_slice(&record.flags.to_le_bytes());
    output.extend_from_slice(&record.x.to_le_bytes());
    output.extend_from_slice(&record.y.to_le_bytes());
    output.extend_from_slice(&record.width.to_le_bytes());
    output.extend_from_slice(&record.height.to_le_bytes());
    output.extend_from_slice(&record.primary_string_index.to_le_bytes());
    output.extend_from_slice(&record.secondary_string_index.to_le_bytes());
    output.extend_from_slice(&record.payload_index.to_le_bytes());
}

fn number_field(object: &Map<String, Value>, key: &str) -> f32 {
    number_value(object.get(key))
}

fn number_value(value: Option<&Value>) -> f32 {
    value.and_then(Value::as_f64).unwrap_or(0.0) as f32
}
