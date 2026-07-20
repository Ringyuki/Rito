use serde_json::json;

use crate::layout::RunPaint;

use super::{
    count_display_commands, display_command_values, pack_display_commands,
    summarize_display_list_font_families, summarize_display_list_resource_refs, DisplayCommand,
    PACKED_DISPLAY_COMMAND_BUFFER_VERSION,
};

#[test]
fn counts_display_commands_by_kind() {
    let commands = vec![
        DisplayCommand::push_state(),
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!({ "hash": "a", "length": 1 }),
            rect: json!({ "x": 0, "y": 0, "width": 1, "height": 1 }),
            paint: RunPaint::default(),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!({ "hash": "b", "length": 1 }),
            rect: json!({ "x": 0, "y": 0, "width": 1, "height": 1 }),
            paint: RunPaint::default(),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
        DisplayCommand::paint_image("images/cover.jpg".to_owned(), json!({}), None, None),
    ];

    let counts = count_display_commands(&commands);

    assert_eq!(counts.get("paintText"), Some(&2));
    assert_eq!(counts.get("paintImage"), Some(&1));
    assert_eq!(counts.get("pushState"), Some(&1));
    assert!(!counts.contains_key("ignored"));
}

#[test]
fn summarizes_image_refs_from_images_and_block_backgrounds() {
    let commands = vec![
        DisplayCommand::paint_image("images/cover.jpg".to_owned(), json!({}), None, None),
        DisplayCommand::paint_block(
            json!({}),
            json!({ "background": { "image": "images/bg.png" } }),
            None,
        ),
        DisplayCommand::paint_image("images/cover.jpg".to_owned(), json!({}), None, None),
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!("ignored"),
            rect: json!({}),
            paint: RunPaint::default(),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
    ];

    let refs = summarize_display_list_resource_refs(&commands);

    assert_eq!(refs.image_refs, 3);
    assert_eq!(refs.unique_images, 2);
    assert_eq!(refs.images, vec!["images/bg.png", "images/cover.jpg"]);
    assert!(!refs.image_hash.is_empty());
}

#[test]
fn summarizes_font_families_from_text_commands() {
    let commands = vec![
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!("Hello"),
            rect: json!({}),
            paint: RunPaint::from_test_wire_value(json!({ "font": { "family": "Rito Serif" } })),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
        DisplayCommand::paint_ruby(super::DisplayTextCommandInput {
            text: json!("Ruby"),
            rect: json!({}),
            paint: RunPaint::from_test_wire_value(json!({ "font": { "family": "Rito Sans" } })),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!("Duplicate"),
            rect: json!({}),
            paint: RunPaint::from_test_wire_value(json!({ "font": { "family": "Rito Serif" } })),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
    ];

    assert_eq!(
        summarize_display_list_font_families(&commands),
        vec!["Rito Sans", "Rito Serif"]
    );
}

#[test]
fn serializes_display_commands_with_stable_wire_kinds() {
    let commands = vec![
        DisplayCommand::translate(json!(12), json!(0)),
        DisplayCommand::opacity(0.2525),
    ];

    assert_eq!(
        display_command_values(&commands),
        vec![
            json!({ "kind": "translate", "dx": 12, "dy": 0 }),
            json!({ "kind": "opacity", "value": 0.2525 }),
        ]
    );
}

#[test]
fn packs_opacity_without_summary_precision_rounding() {
    let packed = pack_display_commands(&[DisplayCommand::opacity(0.2525)]);
    let value = f32::from_le_bytes(packed.bytes[20..24].try_into().expect("opacity lane"));

    assert_eq!(value, 0.2525_f32);
}

#[test]
fn packs_command_opcodes_geometry_and_string_table() {
    let commands = vec![
        DisplayCommand::translate(json!(12), json!(4)),
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!("Hello"),
            rect: json!({ "x": 0, "y": 0, "width": 10, "height": 12 }),
            paint: RunPaint::default(),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
        DisplayCommand::paint_image(
            "images/cover.jpg".to_owned(),
            json!({ "x": 1, "y": 2, "width": 30, "height": 40 }),
            None,
            Some("#cover".to_owned()),
        ),
    ];

    let packed = pack_display_commands(&commands);

    assert_eq!(
        packed.metadata.protocol_version,
        PACKED_DISPLAY_COMMAND_BUFFER_VERSION
    );
    assert_eq!(packed.metadata.command_count, 3);
    assert_eq!(packed.metadata.command_counts.get("translate"), Some(&1));
    assert_eq!(packed.metadata.command_counts.get("paintText"), Some(&1));
    assert_eq!(packed.metadata.command_counts.get("paintImage"), Some(&1));
    assert_eq!(packed.metadata.record_stats.geometry_records, 3);
    assert_eq!(packed.metadata.record_stats.paint_records, 1);
    assert_eq!(packed.metadata.record_stats.payload_records, 1);
    assert_eq!(packed.metadata.record_stats.primary_string_records, 2);
    assert_eq!(packed.metadata.record_stats.secondary_string_records, 1);
    assert_eq!(packed.metadata.byte_length, packed.bytes.len());
    assert_eq!(
        packed.bytes.len(),
        16 + packed.metadata.command_count * super::PACKED_DISPLAY_COMMAND_RECORD_BYTES
    );
    assert_eq!(&packed.bytes[0..8], b"RITOFCB2");
    assert_eq!(u16::from_le_bytes([packed.bytes[16], packed.bytes[17]]), 3);
    assert_eq!(u16::from_le_bytes([packed.bytes[48], packed.bytes[49]]), 9);
    assert_eq!(u16::from_le_bytes([packed.bytes[80], packed.bytes[81]]), 11);
    assert_eq!(
        packed.metadata.string_table,
        vec!["Hello", "images/cover.jpg", "#cover"]
    );
    assert_eq!(packed.metadata.resource_ref_count, 1);
    assert_eq!(packed.metadata.resource_table, vec!["images/cover.jpg"]);
    assert_eq!(packed.metadata.payload_table.len(), 1);
    assert!(packed.metadata.payload_table[0].contains("\"kind\": \"paintText\""));
}

#[test]
fn packs_payload_table_for_complex_commands() {
    let commands = vec![
        DisplayCommand::transform(
            json!({ "x": 10, "y": 20 }),
            json!({ "width": 30, "height": 40 }),
            json!([{ "kind": "rotate", "angle": 12 }]),
        ),
        DisplayCommand::clip_rect(
            json!({ "x": 0, "y": 0, "width": 10, "height": 10 }),
            Some(json!({ "rx": 2, "ry": 2 })),
        ),
        DisplayCommand::paint_block(
            json!({ "x": 1, "y": 2, "width": 3, "height": 4 }),
            json!({ "background": { "color": "#fff" } }),
            None,
        ),
        DisplayCommand::paint_image(
            "images/cover.jpg".to_owned(),
            json!({ "x": 1, "y": 2, "width": 30, "height": 40 }),
            Some("cover".to_owned()),
            None,
        ),
        DisplayCommand::paint_horizontal_rule(
            json!({ "x": 0, "y": 8, "width": 20, "height": 1 }),
            json!({ "color": "#000", "style": "dashed" }),
        ),
    ];

    let packed = pack_display_commands(&commands);

    assert_eq!(packed.metadata.payload_table.len(), commands.len());
    assert_eq!(packed.metadata.record_stats.geometry_records, 4);
    assert_eq!(packed.metadata.record_stats.paint_records, 2);
    assert_eq!(packed.metadata.record_stats.payload_records, 5);
    assert_eq!(packed.metadata.record_stats.primary_string_records, 1);
    assert_eq!(packed.metadata.record_stats.secondary_string_records, 0);
    for (index, kind) in [
        "transform",
        "clipRect",
        "paintBlock",
        "paintImage",
        "paintHorizontalRule",
    ]
    .into_iter()
    .enumerate()
    {
        assert!(packed.metadata.payload_table[index].contains(&format!("\"kind\": \"{kind}\"")));
        let record_offset = 16 + index * super::PACKED_DISPLAY_COMMAND_RECORD_BYTES;
        let flags = u16::from_le_bytes([
            packed.bytes[record_offset + 2],
            packed.bytes[record_offset + 3],
        ]);
        let payload_index = u32::from_le_bytes([
            packed.bytes[record_offset + 28],
            packed.bytes[record_offset + 29],
            packed.bytes[record_offset + 30],
            packed.bytes[record_offset + 31],
        ]);
        assert_eq!(flags & (1 << 4), 1 << 4);
        assert_eq!(payload_index, index as u32);
    }
}

#[test]
fn typed_run_paint_min_and_full_match_the_shared_v2_decoder_golden() {
    let commands = typed_run_paint_golden_commands();
    let packed = pack_display_commands(&commands);
    assert_eq!(packed.metadata.command_count, 3);
    assert_eq!(packed.metadata.command_counts.get("paintText"), Some(&2));
    assert_eq!(packed.metadata.command_counts.get("paintRuby"), Some(&1));
    assert_eq!(packed.metadata.record_stats.geometry_records, 3);
    assert_eq!(packed.metadata.record_stats.paint_records, 3);
    assert_eq!(packed.metadata.record_stats.payload_records, 3);
    assert_eq!(packed.metadata.record_stats.primary_string_records, 3);
    assert_eq!(packed.metadata.record_stats.secondary_string_records, 1);
    assert_eq!(packed_record_opcode(&packed.bytes, 0), 9);
    assert_eq!(packed_record_opcode(&packed.bytes, 1), 9);
    assert_eq!(packed_record_opcode(&packed.bytes, 2), 10);
    assert_eq!(packed_record_flags(&packed.bytes, 0), 31);
    assert_eq!(packed_record_flags(&packed.bytes, 1), 27);
    assert_eq!(packed_record_flags(&packed.bytes, 2), 27);
    let actual = json!({
        "metadata": packed.metadata,
        "bytes": packed.bytes,
        "expectedCommands": display_command_values(&commands),
    });
    if std::env::var_os("RITO_PRINT_TYPED_RUN_PAINT_GOLDEN").is_some() {
        println!(
            "RITO_TYPED_RUN_PAINT_GOLDEN_BEGIN\n{}\nRITO_TYPED_RUN_PAINT_GOLDEN_END",
            serde_json::to_string_pretty(&actual).expect("serialize golden")
        );
        return;
    }
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/typed-run-paint-v2.json"))
            .expect("shared typed run paint golden is valid JSON");

    assert_eq!(actual, expected);
}

fn typed_run_paint_golden_commands() -> Vec<DisplayCommand> {
    vec![
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!("Typed paint"),
            rect: json!({ "x": 1.25, "y": 2.5, "width": 120.75, "height": 24.125 }),
            paint: RunPaint::from_test_wire_value(json!({
                "color": "color(display-p3 1 0.2 0.1)",
                "font": {
                    "family": "Rito Serif",
                    "sizePx": 14.123456,
                    "style": "italic",
                    "weight": 650,
                },
                "wordSpacingPx": 1.25,
                "letterSpacingPx": -0.5,
                "backgroundColor": "#112233",
                "backgroundRadius": 3.5,
                "textShadow": [
                    { "offsetX": 1.23456, "offsetY": 2, "blur": 3, "color": "#445566" },
                    { "offsetX": -1, "offsetY": 0.5, "blur": 0, "color": "#556677" },
                ],
                "decoration": {
                    "kind": "underline",
                    "y": 14.125,
                    "thickness": 1,
                    "color": "#778899",
                },
                "padding": { "top": 1, "right": 2, "bottom": 3, "left": 4 },
                "border": {
                    "top": { "widthPx": 1, "paint": { "color": "#111111", "style": "solid" } },
                    "bottom": { "widthPx": 2, "paint": { "color": "#222222", "style": "dotted" } },
                    "start": { "widthPx": 3, "paint": { "color": "#333333", "style": "dashed" } },
                    "end": { "widthPx": 4, "paint": { "color": "#444444", "style": "solid" } },
                },
            })),
            line_height_px: Some(json!(20)),
            href: Some("#typed".to_owned()),
            source_text: Some(json!("Typed paint source")),
            source_text_offset: Some(3),
        }),
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!("Minimal paint"),
            rect: json!({ "x": -3.5, "y": 40.25, "width": 80.5, "height": 16.75 }),
            paint: RunPaint::default(),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
        DisplayCommand::paint_ruby(super::DisplayTextCommandInput {
            text: json!("ruby"),
            rect: json!({ "x": 1, "y": -6, "width": 30, "height": 8 }),
            paint: RunPaint::default().for_ruby(8.0),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }),
    ]
}

fn packed_record_opcode(bytes: &[u8], index: usize) -> u16 {
    let offset = 16 + index * super::PACKED_DISPLAY_COMMAND_RECORD_BYTES;
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn packed_record_flags(bytes: &[u8], index: usize) -> u16 {
    let offset = 16 + index * super::PACKED_DISPLAY_COMMAND_RECORD_BYTES + 2;
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}
