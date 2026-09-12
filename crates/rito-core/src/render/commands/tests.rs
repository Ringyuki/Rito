use serde_json::json;

use crate::render::RunPaint;

use super::{
    count_display_commands, display_command_values, summarize_display_list_font_families,
    summarize_display_list_resource_refs, DisplayCommand,
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
            clusters: Vec::new(),
        }),
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!({ "hash": "b", "length": 1 }),
            rect: json!({ "x": 0, "y": 0, "width": 1, "height": 1 }),
            paint: RunPaint::default(),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
            clusters: Vec::new(),
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
            clusters: Vec::new(),
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
            clusters: Vec::new(),
        }),
        DisplayCommand::paint_ruby(super::DisplayTextCommandInput {
            text: json!("Ruby"),
            rect: json!({}),
            paint: RunPaint::from_test_wire_value(json!({ "font": { "family": "Rito Sans" } })),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
            clusters: Vec::new(),
        }),
        DisplayCommand::paint_text(super::DisplayTextCommandInput {
            text: json!("Duplicate"),
            rect: json!({}),
            paint: RunPaint::from_test_wire_value(json!({ "font": { "family": "Rito Serif" } })),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
            clusters: Vec::new(),
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
