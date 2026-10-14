use crate::render::{
    contract::{
        ReaderBackgroundPaint, ReaderBlockPaint, ReaderFontPaint, ReaderPagePaint, ReaderRect,
        ReaderRunPaint,
    },
    RunPaint,
};

use super::{
    display_number, display_rect, summarize_display_list_resource_refs,
    test_support::{css_color, display_command_values, parse_display_command, FixtureError},
    DisplayCommand, DisplayTextCommand,
};

fn rect() -> ReaderRect {
    ReaderRect {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    }
}

fn text(text: &str, family: &str) -> DisplayTextCommand {
    DisplayTextCommand {
        text: text.to_owned(),
        rect: rect(),
        paint: RunPaint::new(ReaderRunPaint {
            font: ReaderFontPaint {
                family: family.to_owned(),
                ..ReaderRunPaint::default().font
            },
            ..ReaderRunPaint::default()
        }),
        line_height_px: None,
        href: None,
        source_text: None,
        source_text_offset: None,
        clusters: Vec::new(),
    }
}

#[test]
fn summarizes_image_refs_from_images_and_block_backgrounds() {
    let commands = vec![
        DisplayCommand::paint_image("images/cover.jpg".to_owned(), rect(), None, None),
        DisplayCommand::PaintBlock {
            rect: rect(),
            paint: ReaderBlockPaint {
                background: Some(ReaderBackgroundPaint {
                    image: Some("images/bg.png".to_owned()),
                    ..ReaderBackgroundPaint::default()
                }),
                ..ReaderBlockPaint::default()
            },
            border_box: None,
        },
        DisplayCommand::paint_image("images/cover.jpg".to_owned(), rect(), None, None),
        DisplayCommand::PaintText(text("ignored", "serif")),
    ];

    let refs = summarize_display_list_resource_refs(&commands);

    assert_eq!(refs.image_refs, 3);
    assert_eq!(refs.images, vec!["images/bg.png", "images/cover.jpg"]);
}

#[test]
fn display_precision_keeps_every_layout_unit_position_exactly() {
    assert_eq!(display_number(840.65625), 840.65625);
    assert_eq!(display_number(1.0 / 64.0), 0.015625);
    assert_eq!(display_number(12.000000049), 12.0);
    assert_eq!(
        display_rect(0.1234567, 1.0, 2.0, 3.0),
        ReaderRect {
            x: 0.123457,
            y: 1.0,
            width: 2.0,
            height: 3.0,
        }
    );
}

#[test]
fn fixture_json_round_trips_every_command_shape() {
    let commands = vec![
        DisplayCommand::PushState,
        DisplayCommand::Translate { dx: 1.0, dy: 2.5 },
        DisplayCommand::opacity(0.5),
        DisplayCommand::ClipRect {
            rect: rect(),
            radius: None,
        },
        DisplayCommand::PaintPage {
            rect: rect(),
            paint: ReaderPagePaint {
                background_color: Some(css_color("#ffffff")),
            },
        },
        DisplayCommand::PaintBlock {
            rect: rect(),
            paint: ReaderBlockPaint {
                background: Some(ReaderBackgroundPaint {
                    color: Some(css_color("rgba(1, 2, 3, 0.5)")),
                    image: Some("images/bg.png".to_owned()),
                    ..ReaderBackgroundPaint::default()
                }),
                ..ReaderBlockPaint::default()
            },
            border_box: None,
        },
        DisplayCommand::PaintText(text("Hello", "Rito Serif")),
        DisplayCommand::PaintRuby(text("ruby", "Rito Sans")),
        DisplayCommand::paint_image(
            "images/cover.jpg".to_owned(),
            rect(),
            Some("cover".to_owned()),
            None,
        ),
        DisplayCommand::PopState,
    ];

    let values = display_command_values(&commands);
    let parsed: Vec<DisplayCommand> = values
        .iter()
        .map(|value| parse_display_command(value).expect("fixture parses"))
        .collect();

    assert_eq!(parsed, commands);
    assert_eq!(values[0]["kind"], "pushState");
    assert_eq!(values[1]["dx"], 1);
    assert_eq!(values[1]["dy"], 2.5);
    assert_eq!(values[4]["paint"]["backgroundColor"], "#ffffff");
    assert_eq!(
        values[5]["paint"]["background"]["color"],
        "rgba(1, 2, 3, 0.5)"
    );
    assert_eq!(values[6]["paint"]["font"]["family"], "Rito Serif");
    assert_eq!(
        parse_display_command(
            &serde_json::json!({ "kind": "paintBlock", "rect": {}, "paint": { "futurePaint": {} } })
        ),
        Err(FixtureError::InvalidField("paintBlock.rect"))
    );
}
