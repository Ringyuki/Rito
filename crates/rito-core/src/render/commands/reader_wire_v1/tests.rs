use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    layout::RunPaint,
    render::{
        lower::{
            lower_display_commands, DashPattern, DevicePath, DevicePoint, DeviceRect,
            DeviceTransform, FillRule, Ground, PathOp, Primitive, PrimitiveList, StrokeCap,
            TilePlan,
        },
        DisplayTextCommandInput,
    },
};

use super::{
    contract::{
        ReaderBackgroundPaintV1, ReaderBackgroundPositionV1, ReaderBackgroundRepeatV1,
        ReaderBackgroundSizeV1, ReaderBlockBorderV1, ReaderBlockPaintV1, ReaderBlockRadiusV1,
        ReaderBorderBoxV1, ReaderBorderEdgePaintV1, ReaderBorderStyleV1, ReaderBoxShadowV1,
        ReaderColorNoneFlagsV1, ReaderColorSpaceV1, ReaderColorV1, ReaderDisplayCommandV1,
        ReaderDisplayListV1, ReaderFontPaintV1, ReaderFontStyleV1, ReaderLengthV1,
        ReaderPagePaintV1, ReaderRectV1, ReaderRunBorderEdgeV1, ReaderRunBorderV1,
        ReaderRunDecorationKindV1, ReaderRunDecorationV1, ReaderRunPaintV1, ReaderSpacingV1,
        ReaderTextCommandV1, ReaderTextShadowV1,
    },
    decode::{validate, DecodeError},
    encode::checked_length,
    encode_reader_display_list_v1, encode_reader_primitive_list_v1,
    encode_typed_reader_display_list_v1, legacy_adapter, DisplayCommand,
    ReaderDisplayListWireError, READER_DISPLAY_LIST_FORMAT_VERSION,
    READER_PRIMITIVE_LIST_FORMAT_VERSION,
};

/// The bytes the JavaScript and Dart decoder tests read: one of every
/// command shape with every optional field present, and one of every
/// primitive. A decoder that drifts from the encoder fails on these, not
/// on a hand-built fixture that agrees with its own stale reading.
const DISPLAY_LIST_FIXTURE: &str = include_str!(
    "../../../../../../packages/rito-core-wasm/tests/fixtures/reader-v1-display-list.hex"
);
const PRIMITIVE_LIST_FIXTURE: &str = include_str!(
    "../../../../../../packages/rito-core-wasm/tests/fixtures/reader-v1-primitive-list.hex"
);
const FIXTURE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/rito-core-wasm/tests/fixtures"
);

#[test]
fn cross_language_wire_fixtures_match_the_encoders() {
    let display = hex(
        &encode_typed_reader_display_list_v1(&wire_fixture_display_list())
            .expect("encode")
            .bytes,
    );
    let primitives = hex(&encode_reader_primitive_list_v1(&all_primitive_shapes())
        .expect("encode")
        .bytes);
    let regenerate =
        "regenerate with `cargo test -p rito-core --lib write_reader_wire_fixtures -- --ignored`";
    assert_eq!(DISPLAY_LIST_FIXTURE.trim(), display, "{regenerate}");
    assert_eq!(PRIMITIVE_LIST_FIXTURE.trim(), primitives, "{regenerate}");
}

#[test]
#[ignore = "writes the cross-language wire fixtures the JavaScript and Dart decoder tests read"]
fn write_reader_wire_fixtures() {
    let display = encode_typed_reader_display_list_v1(&wire_fixture_display_list())
        .expect("encode")
        .bytes;
    let primitives = encode_reader_primitive_list_v1(&all_primitive_shapes())
        .expect("encode")
        .bytes;
    for (name, bytes) in [
        ("reader-v1-display-list.hex", display),
        ("reader-v1-primitive-list.hex", primitives),
    ] {
        std::fs::write(
            format!("{FIXTURE_DIR}/{name}"),
            format!("{}\n", hex(&bytes)),
        )
        .expect("write wire fixture");
    }
}

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
fn every_primitive_shape_roundtrips_through_the_strict_validator() {
    let encoded = encode_reader_primitive_list_v1(&all_primitive_shapes()).expect("encode");

    assert_eq!(encoded.format_version, READER_PRIMITIVE_LIST_FORMAT_VERSION);
    assert_eq!(encoded.command_count, 14);
    assert_eq!(&encoded.bytes[..7], b"RITODL1");
    assert_eq!(validate(&encoded.bytes), Ok(14));
    let expected_digest: [u8; 32] = Sha256::digest(&encoded.bytes).into();
    assert_eq!(encoded.semantic_digest, expected_digest);
    assert_eq!(
        encoded.image_hrefs,
        vec!["images/background.png", "images/cover.jpg"]
    );
    assert_eq!(encoded.font_families, vec!["Rito Serif"]);
}

#[test]
fn fixed_primitive_wire_does_not_drift() {
    let encoded = encode_reader_primitive_list_v1(&PrimitiveList {
        ratio: 2.0,
        commands: vec![Primitive::PushState],
    })
    .expect("encode fixed primitive");

    // Magic, format 2, ratio 2.0 as a little-endian f64, one primitive,
    // the push-state opcode.
    assert_eq!(
        encoded.bytes,
        [
            b'R', b'I', b'T', b'O', b'D', b'L', b'1', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 1, 0,
            0, 0, 1, 0,
        ]
    );
}

#[test]
fn primitive_validator_rejects_truncation_unknown_opcodes_and_unknown_tags() {
    let encoded = encode_reader_primitive_list_v1(&all_primitive_shapes()).expect("encode");
    for end in 0..encoded.bytes.len() {
        assert_eq!(validate(&encoded.bytes[..end]), Err(DecodeError::Truncated));
    }

    let mut opcode = encode_reader_primitive_list_v1(&PrimitiveList {
        ratio: 1.0,
        commands: vec![Primitive::PushState],
    })
    .expect("encode")
    .bytes;
    opcode[23..25].copy_from_slice(&u16::MAX.to_le_bytes());
    assert_eq!(validate(&opcode), Err(DecodeError::UnknownOpcode(u16::MAX)));

    let mut tag = encode_reader_primitive_list_v1(&PrimitiveList {
        ratio: 1.0,
        commands: vec![Primitive::ClipPath {
            path: DevicePath {
                ops: vec![PathOp::Close],
            },
        }],
    })
    .expect("encode")
    .bytes;
    // Header (23) + opcode (2) + op count (4) puts the op tag at 29.
    tag[29] = 7;
    assert_eq!(validate(&tag), Err(DecodeError::UnknownEnum(7)));
}

#[test]
fn lowered_display_commands_encode_as_format_2() {
    let lowered = lower_display_commands(&representative_commands(), 2.0).expect("lower");
    let encoded = encode_reader_primitive_list_v1(&lowered).expect("encode");
    assert_eq!(encoded.format_version, 2);
    assert_eq!(validate(&encoded.bytes), Ok(encoded.command_count));
    assert_eq!(
        encoded.image_hrefs,
        vec!["images/background.png", "images/cover.jpg"]
    );
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

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Every command shape, then a text run and a block with every optional
/// field present (the inline-box tail, an explicit background size, corner
/// radii, both shadow kinds).
fn wire_fixture_display_list() -> ReaderDisplayListV1 {
    let ink = ReaderColorV1 {
        space: ReaderColorSpaceV1::Srgb,
        components: [0.1, 0.2, 0.3],
        alpha: 1.0,
        none: ReaderColorNoneFlagsV1::default(),
    };
    let wash = ReaderColorV1 {
        space: ReaderColorSpaceV1::DisplayP3,
        components: [0.4, 0.5, 0.6],
        alpha: 0.5,
        none: ReaderColorNoneFlagsV1::default(),
    };
    let edge = |style| ReaderBorderEdgePaintV1 { color: ink, style };
    let mut typed = legacy_adapter::adapt(&all_command_shapes()).expect("adapt");
    typed
        .commands
        .push(ReaderDisplayCommandV1::PaintText(ReaderTextCommandV1 {
            text: "run".to_owned(),
            rect: ReaderRectV1 {
                x: 1.5,
                y: 2.0,
                width: 10.0,
                height: 20.0,
            },
            paint: ReaderRunPaintV1 {
                font: ReaderFontPaintV1 {
                    family: "Rito Serif".to_owned(),
                    size_px: 16.0,
                    weight: 700.0,
                    style: ReaderFontStyleV1::Italic,
                },
                color: ink,
                word_spacing_px: Some(1.0),
                letter_spacing_px: Some(0.5),
                background_color: Some(wash),
                background_radius: Some(2.0),
                text_shadows: vec![ReaderTextShadowV1 {
                    offset_x: 1.0,
                    offset_y: 2.0,
                    blur: 3.0,
                    color: wash,
                }],
                decoration: Some(ReaderRunDecorationV1 {
                    kind: ReaderRunDecorationKindV1::LineThrough,
                    y: 18.0,
                    thickness: 1.0,
                    color: ink,
                }),
                padding: Some(ReaderSpacingV1 {
                    top: 1.0,
                    right: 2.0,
                    bottom: 3.0,
                    left: 4.0,
                }),
                border: Some(ReaderRunBorderV1 {
                    top: Some(ReaderRunBorderEdgeV1 {
                        width_px: 1.0,
                        paint: edge(ReaderBorderStyleV1::Solid),
                    }),
                    bottom: None,
                    start: Some(ReaderRunBorderEdgeV1 {
                        width_px: 2.0,
                        paint: edge(ReaderBorderStyleV1::Dotted),
                    }),
                    end: None,
                }),
                box_offsets: Some((-2.0, 22.0)),
                box_start: false,
                box_end: true,
            },
            line_height_px: Some(24.0),
            href: Some("#note".to_owned()),
            source_text: Some("source".to_owned()),
            source_text_offset: Some(9),
            ruby_align: Some("center".to_owned()),
        }));
    typed.commands.push(ReaderDisplayCommandV1::PaintBlock {
        rect: ReaderRectV1 {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 50.0,
        },
        paint: ReaderBlockPaintV1 {
            background: Some(ReaderBackgroundPaintV1 {
                color: Some(wash),
                image: Some("images/paper.png".to_owned()),
                size: Some(ReaderBackgroundSizeV1::Explicit {
                    x: Some(ReaderLengthV1::Px(10.0)),
                    y: None,
                }),
                repeat: Some(ReaderBackgroundRepeatV1::RepeatX),
                position: Some(ReaderBackgroundPositionV1 {
                    x: ReaderLengthV1::Percent(50.0),
                    y: ReaderLengthV1::Px(4.0),
                }),
            }),
            border: Some(ReaderBlockBorderV1 {
                top: Some(edge(ReaderBorderStyleV1::Solid)),
                right: Some(edge(ReaderBorderStyleV1::Dashed)),
                bottom: Some(edge(ReaderBorderStyleV1::Dotted)),
                left: Some(edge(ReaderBorderStyleV1::Double)),
            }),
            radius: Some(ReaderBlockRadiusV1::Corners([1.0, 2.0, 3.0, 4.0])),
            box_shadows: vec![
                ReaderBoxShadowV1 {
                    offset_x: 1.0,
                    offset_y: 2.0,
                    blur: 3.0,
                    spread: 0.5,
                    color: wash,
                    inset: true,
                },
                ReaderBoxShadowV1 {
                    offset_x: -1.0,
                    offset_y: -2.0,
                    blur: 0.0,
                    spread: 0.0,
                    color: ink,
                    inset: false,
                },
            ],
        },
        border_box: Some(ReaderBorderBoxV1 {
            top_width: 1.0,
            right_width: 2.0,
            bottom_width: 3.0,
            left_width: 4.0,
        }),
    });
    typed
}

/// One of every primitive: the lowered representative commands supply the
/// pass-through text, block and image; the resolved shapes are built here.
fn all_primitive_shapes() -> PrimitiveList {
    let lowered = lower_display_commands(&representative_commands(), 2.0).expect("lower");
    let [Primitive::PushState, block @ Primitive::Block { .. }, text @ Primitive::Text(run), image @ Primitive::DrawImage { .. }] =
        lowered.commands.as_slice()
    else {
        panic!("representative commands lower to push, block, text, image: {lowered:?}");
    };
    let Primitive::DrawImage {
        src,
        dest,
        source_rect,
        ..
    } = image
    else {
        unreachable!()
    };
    let color = ReaderColorV1 {
        space: ReaderColorSpaceV1::Srgb,
        components: [0.25, 0.5, 0.75],
        alpha: 1.0,
        none: ReaderColorNoneFlagsV1::default(),
    };
    let path = DevicePath {
        ops: vec![
            PathOp::MoveTo(DevicePoint::new(1.0, 2.0)),
            PathOp::LineTo(DevicePoint::new(3.0, 4.0)),
            PathOp::Arc {
                center: DevicePoint::new(5.0, 6.0),
                rx: 7.0,
                ry: 8.0,
                start: 0.0,
                sweep: 1.5,
            },
            PathOp::Ellipse {
                center: DevicePoint::new(9.0, 10.0),
                rx: 2.0,
                ry: 3.0,
            },
            PathOp::Rect(DeviceRect::new(0.0, 0.0, 20.0, 30.0)),
            PathOp::Close,
        ],
    };
    let rect = DeviceRect::new(0.0, 0.0, 40.0, 60.0);
    PrimitiveList {
        ratio: 2.0,
        commands: vec![
            Primitive::PushState,
            Primitive::PopState,
            Primitive::Translate { dx: 1.0, dy: 2.0 },
            Primitive::Opacity { value: 0.5 },
            Primitive::Transform {
                origin: DevicePoint::new(1.0, 2.0),
                transforms: vec![
                    DeviceTransform::Rotate { radians: 0.5 },
                    DeviceTransform::Scale { sx: 2.0, sy: 3.0 },
                    DeviceTransform::Translate { dx: 4.0, dy: 5.0 },
                ],
            },
            Primitive::ClipPath { path: path.clone() },
            Primitive::FillRect {
                rect,
                color,
                ground: Ground::Page,
            },
            Primitive::FillPath {
                path: path.clone(),
                rule: FillRule::EvenOdd,
                color,
            },
            Primitive::StrokePath {
                path: path.clone(),
                width: 1.5,
                color,
                cap: StrokeCap::Round,
                dash: Some(DashPattern { on: 3.0, off: 2.0 }),
            },
            Primitive::Shadow {
                shape: path.clone(),
                sigma: 1.5,
                offset: DevicePoint::new(1.0, 2.0),
                color,
                clip_out: Some(path),
            },
            Primitive::DrawImage {
                src: src.clone(),
                dest: *dest,
                source_rect: *source_rect,
                tiles: Some(TilePlan {
                    origin: DevicePoint::new(0.0, 0.0),
                    step_x: 16.0,
                    step_y: 16.0,
                    columns: 2,
                    rows: 3,
                }),
            },
            text.clone(),
            Primitive::Ruby(run.clone()),
            block.clone(),
        ],
    }
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
