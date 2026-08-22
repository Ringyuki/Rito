use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{layout::RunPaint, render::DisplayTextCommandInput};

use super::{
    contract::{
        ReaderColorNoneFlagsV1, ReaderColorSpaceV1, ReaderColorV1, ReaderDisplayCommandV1,
        ReaderDisplayListV1, ReaderPagePaintV1, ReaderRectV1,
    },
    decode::{validate, DecodeError},
    encode::checked_length,
    encode_reader_display_list_v1, encode_typed_reader_display_list_v1, DisplayCommand,
    ReaderDisplayListWireError, READER_DISPLAY_LIST_FORMAT_VERSION,
};

#[test]
fn encodes_owned_metadata_and_strictly_valid_binary() {
    let commands = representative_commands();
    let encoded = encode_reader_display_list_v1(&commands).expect("encode display list");

    assert_eq!(encoded.format_version, READER_DISPLAY_LIST_FORMAT_VERSION);
    assert_eq!(encoded.command_count, 4);
    assert_eq!(&encoded.bytes[..7], b"RITODL1");
    assert_eq!(validate(&encoded.bytes), Ok(4));
    let expected_digest: [u8; 32] = Sha256::digest(&encoded.bytes).into();
    assert_eq!(encoded.semantic_digest, expected_digest);
    assert_eq!(
        encoded.image_hrefs,
        vec!["images/background.png", "images/cover.jpg"]
    );
    assert_eq!(encoded.font_families, vec!["Rito Serif"]);
}

#[test]
fn every_command_shape_roundtrips_through_the_strict_validator() {
    let commands = all_command_shapes();
    let encoded = encode_reader_display_list_v1(&commands).expect("encode all commands");

    assert_eq!(encoded.command_count, 12);
    assert_eq!(validate(&encoded.bytes), Ok(12));
}

#[test]
fn fixed_push_state_wire_and_digest_do_not_drift() {
    let encoded = encode_reader_display_list_v1(&[DisplayCommand::push_state()])
        .expect("encode fixed command");

    assert_eq!(
        encoded.bytes,
        [b'R', b'I', b'T', b'O', b'D', b'L', b'1', 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,]
    );
    assert_eq!(
        encoded.semantic_digest,
        [
            0xa6, 0x27, 0x82, 0xd7, 0x1e, 0x74, 0xe0, 0xd0, 0x1c, 0x9f, 0x9b, 0x46, 0x5a, 0x7c,
            0x46, 0x5c, 0x36, 0xfc, 0x0c, 0xbf, 0xba, 0x49, 0x47, 0x7f, 0x75, 0xdd, 0x6e, 0xf2,
            0x4b, 0xb9, 0xd4, 0xc1,
        ]
    );
}

#[test]
fn validator_rejects_every_truncated_prefix() {
    let encoded = encode_reader_display_list_v1(&representative_commands()).expect("encode");
    for end in 0..encoded.bytes.len() {
        assert_eq!(validate(&encoded.bytes[..end]), Err(DecodeError::Truncated));
    }
}

#[test]
fn validator_rejects_unknown_opcode_and_typed_enum() {
    let mut opcode = encode_reader_display_list_v1(&[DisplayCommand::push_state()])
        .expect("encode")
        .bytes;
    opcode[15..17].copy_from_slice(&u16::MAX.to_le_bytes());
    assert_eq!(validate(&opcode), Err(DecodeError::UnknownOpcode(u16::MAX)));

    let mut color = encode_reader_display_list_v1(&[DisplayCommand::paint_page(
        rect(),
        json!({ "backgroundColor": "#123456" }),
    )])
    .expect("encode")
    .bytes;
    color[50] = u8::MAX;
    assert_eq!(validate(&color), Err(DecodeError::UnknownEnum(u8::MAX)));
}

#[test]
fn every_color_space_tag_is_valid_and_tag_16_is_rejected() {
    let spaces = [
        ReaderColorSpaceV1::Srgb,
        ReaderColorSpaceV1::Hsl,
        ReaderColorSpaceV1::Hwb,
        ReaderColorSpaceV1::Lab,
        ReaderColorSpaceV1::Lch,
        ReaderColorSpaceV1::Oklab,
        ReaderColorSpaceV1::Oklch,
        ReaderColorSpaceV1::SrgbLinear,
        ReaderColorSpaceV1::DisplayP3,
        ReaderColorSpaceV1::DisplayP3Linear,
        ReaderColorSpaceV1::A98Rgb,
        ReaderColorSpaceV1::ProphotoRgb,
        ReaderColorSpaceV1::Rec2020,
        ReaderColorSpaceV1::XyzD50,
        ReaderColorSpaceV1::XyzD65,
    ];
    for (index, space) in spaces.into_iter().enumerate() {
        let encoded = encode_typed_reader_display_list_v1(&typed_page(space)).expect("encode");
        assert_eq!(encoded.bytes[50], u8::try_from(index + 1).unwrap());
        assert_eq!(validate(&encoded.bytes), Ok(1));
    }

    let mut unknown = encode_typed_reader_display_list_v1(&typed_page(ReaderColorSpaceV1::Srgb))
        .expect("encode")
        .bytes;
    unknown[50] = 16;
    assert_eq!(validate(&unknown), Err(DecodeError::UnknownEnum(16)));
}

#[test]
fn checked_lengths_reject_values_above_u32() {
    assert_eq!(
        checked_length(u64::from(u32::MAX) + 1, "fixture"),
        Err(ReaderDisplayListWireError::LengthOverflow("fixture"))
    );
}

#[test]
fn primary_encoder_and_contract_have_no_json_value_path() {
    let encoded = encode_reader_display_list_v1(&[DisplayCommand::paint_page(
        rect(),
        json!({ "backgroundColor": "#112233" }),
    )])
    .expect("encode");
    assert!(!contains_bytes(&encoded.bytes, b"#112233"));

    let typed_sources = concat!(
        include_str!("../reader_wire_v1.rs"),
        include_str!("contract.rs"),
        include_str!("contract/geometry.rs"),
        include_str!("contract/paint.rs"),
        include_str!("encode.rs"),
        include_str!("encode/paint.rs"),
        include_str!("encode/primitives.rs"),
    );
    assert!(!typed_sources.contains("serde_json"));
    assert!(!typed_sources.contains("write_value"));
    assert!(!typed_sources.contains("Value::"));
}

#[test]
fn legacy_adapter_fails_closed_for_unknown_or_untyped_payloads() {
    let unknown =
        DisplayCommand::paint_block(rect(), json!({ "futurePaint": { "sentinel": true } }), None);
    assert_eq!(
        encode_reader_display_list_v1(&[unknown]),
        Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
            "paintBlock.paint"
        ))
    );

    let summary_text = DisplayCommand::paint_text(DisplayTextCommandInput {
        text: json!({ "hash": "not-runtime-text", "length": 4 }),
        rect: rect(),
        paint: RunPaint::default(),
        line_height_px: None,
        href: None,
        source_text: None,
        source_text_offset: None,
        ruby_align: None,
        align_right: false,
            vertical: false,
    });
    assert_eq!(
        encode_reader_display_list_v1(&[summary_text]),
        Err(ReaderDisplayListWireError::InvalidLegacyField("text.text"))
    );

    let unresolved_current_color =
        DisplayCommand::paint_page(rect(), json!({ "backgroundColor": "currentColor" }));
    assert_eq!(
        encode_reader_display_list_v1(&[unresolved_current_color]),
        Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
            "color.currentColor"
        ))
    );
}

#[test]
fn rejects_non_finite_command_numbers() {
    assert_eq!(
        encode_reader_display_list_v1(&[DisplayCommand::opacity(f64::NAN)]),
        Err(ReaderDisplayListWireError::NonFiniteNumber)
    );
}

fn representative_commands() -> Vec<DisplayCommand> {
    vec![
        DisplayCommand::push_state(),
        DisplayCommand::paint_block(
            rect(),
            json!({
                "background": {
                    "color": "#112233",
                    "image": "images/background.png",
                    "size": "cover",
                    "repeat": "no-repeat",
                    "position": {
                        "x": { "unit": "percent", "value": 50 },
                        "y": { "unit": "px", "value": 0 }
                    }
                },
                "border": {
                    "top": { "color": "#445566", "style": "solid" }
                },
                "radius": { "px": 3 },
                "boxShadow": [{
                    "offsetX": 1,
                    "offsetY": 2,
                    "blur": 3,
                    "spread": 0,
                    "color": "rgba(0, 0, 0, .5)",
                    "inset": false
                }]
            }),
            Some(json!({
                "topWidth": 1,
                "rightWidth": 0,
                "bottomWidth": 0,
                "leftWidth": 0
            })),
        ),
        DisplayCommand::paint_text(DisplayTextCommandInput {
            text: json!("text"),
            rect: rect(),
            paint: RunPaint::from_test_wire_value(json!({
                "color": "#000000",
                "font": { "family": "Rito Serif" }
            })),
            line_height_px: Some(json!(18.5)),
            href: Some("#note".to_owned()),
            source_text: Some(json!("source")),
            source_text_offset: Some(9),
            ruby_align: None,
            align_right: false,
            vertical: false,
        }),
        DisplayCommand::paint_image(
            "images/cover.jpg".to_owned(),
            rect(),
            Some("cover".to_owned()),
            None,
        ),
    ]
}

fn all_command_shapes() -> Vec<DisplayCommand> {
    let text = || DisplayTextCommandInput {
        text: json!("text"),
        rect: rect(),
        paint: RunPaint::default(),
        line_height_px: None,
        href: None,
        source_text: None,
        source_text_offset: None,
        ruby_align: None,
        align_right: false,
            vertical: false,
    };
    vec![
        DisplayCommand::push_state(),
        DisplayCommand::pop_state(),
        DisplayCommand::translate(json!(1), json!(2)),
        DisplayCommand::opacity(0.5),
        DisplayCommand::transform(
            json!({ "x": 10, "y": 20 }),
            json!({ "width": 30, "height": 40 }),
            json!([
                { "kind": "rotate", "rad": 0.5 },
                { "kind": "scale", "sx": 2, "sy": 3 },
                {
                    "kind": "translate",
                    "x": { "unit": "px", "value": 4 },
                    "y": { "unit": "percent", "value": 5 }
                }
            ]),
        ),
        DisplayCommand::clip_rect(rect(), Some(json!({ "rx": 2, "ry": 2 }))),
        DisplayCommand::paint_page(rect(), json!({ "backgroundColor": "#ffffff" })),
        DisplayCommand::paint_block(
            rect(),
            json!({ "background": { "color": "#ffffff" } }),
            None,
        ),
        DisplayCommand::paint_text(text()),
        DisplayCommand::paint_ruby(text()),
        DisplayCommand::paint_image("image.png".to_owned(), rect(), None, None),
        DisplayCommand::paint_horizontal_rule(
            rect(),
            json!({ "color": "#000000", "style": "solid" }),
        ),
    ]
}

fn rect() -> serde_json::Value {
    json!({ "x": 0, "y": 0, "width": 20, "height": 30 })
}

fn typed_page(space: ReaderColorSpaceV1) -> ReaderDisplayListV1 {
    ReaderDisplayListV1 {
        commands: vec![ReaderDisplayCommandV1::PaintPage {
            rect: ReaderRectV1 {
                x: 0.0,
                y: 0.0,
                width: 20.0,
                height: 30.0,
            },
            paint: ReaderPagePaintV1 {
                background_color: Some(ReaderColorV1 {
                    space,
                    components: [0.25, 0.5, 0.75],
                    alpha: 1.0,
                    none: ReaderColorNoneFlagsV1::default(),
                }),
            },
        }],
    }
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}
