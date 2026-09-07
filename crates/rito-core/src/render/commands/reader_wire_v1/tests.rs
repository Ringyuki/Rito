use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    layout::RunPaint,
    render::{
        lower::{
            lower_display_commands, DashPattern, DevicePath, DevicePoint, DeviceRect,
            DeviceTransform, FillRule, Ground, ImageSize, LowerError, PathOp, Primitive,
            PrimitiveList, StrokeCap, TilePlan,
        },
        DisplayTextCommandInput, RubyAlignPaint,
    },
};

use super::{
    adapt_reader_display_list_v1,
    contract::{ReaderColorNoneFlagsV1, ReaderColorSpaceV1, ReaderColorV1},
    decode::{validate, DecodeError},
    encode::checked_length,
    encode_reader_primitive_list_v1, DisplayCommand, ReaderDisplayListWireError,
    READER_PRIMITIVE_LIST_FORMAT_VERSION,
};

/// The bytes the JavaScript and Dart decoder tests read: one of every
/// primitive, the text run carrying every optional field. A decoder that
/// drifts from the encoder fails on these, not on a hand-built fixture that
/// agrees with its own stale reading.
const PRIMITIVE_LIST_FIXTURE: &str = include_str!(
    "../../../../../../packages/rito-core-wasm/tests/fixtures/reader-v1-primitive-list.hex"
);
const FIXTURE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/rito-core-wasm/tests/fixtures"
);

#[test]
fn cross_language_wire_fixture_matches_the_encoder() {
    let primitives = hex(&encode_reader_primitive_list_v1(&all_primitive_shapes())
        .expect("encode")
        .bytes);
    assert_eq!(
        PRIMITIVE_LIST_FIXTURE.trim(),
        primitives,
        "regenerate with `cargo test -p rito-core --lib write_reader_wire_fixtures -- --ignored`"
    );
}

#[test]
#[ignore = "writes the cross-language wire fixture the JavaScript and Dart decoder tests read"]
fn write_reader_wire_fixtures() {
    let primitives = encode_reader_primitive_list_v1(&all_primitive_shapes())
        .expect("encode")
        .bytes;
    std::fs::write(
        format!("{FIXTURE_DIR}/reader-v1-primitive-list.hex"),
        format!("{}\n", hex(&primitives)),
    )
    .expect("write wire fixture");
}

#[test]
fn every_primitive_shape_roundtrips_through_the_strict_validator() {
    let encoded = encode_reader_primitive_list_v1(&all_primitive_shapes()).expect("encode");

    assert_eq!(encoded.format_version, READER_PRIMITIVE_LIST_FORMAT_VERSION);
    assert_eq!(encoded.command_count, 13);
    assert_eq!(&encoded.bytes[..7], b"RITODL1");
    assert_eq!(validate(&encoded.bytes), Ok(13));
    let expected_digest: [u8; 32] = Sha256::digest(&encoded.bytes).into();
    assert_eq!(encoded.semantic_digest, expected_digest);
    assert_eq!(encoded.image_hrefs, vec!["images/cover.jpg"]);
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
fn validator_rejects_the_semantic_format_and_trailing_bytes() {
    let mut format_one = encode_reader_primitive_list_v1(&PrimitiveList {
        ratio: 1.0,
        commands: Vec::new(),
    })
    .expect("encode")
    .bytes;
    format_one[7..11].copy_from_slice(&1u32.to_le_bytes());
    assert_eq!(
        validate(&format_one),
        Err(DecodeError::UnsupportedVersion(1))
    );

    let mut trailing = encode_reader_primitive_list_v1(&all_primitive_shapes())
        .expect("encode")
        .bytes;
    trailing.push(0);
    assert_eq!(validate(&trailing), Err(DecodeError::TrailingBytes));
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
    // Header (23) + opcode (2) + rect (32) puts the colour space tag at 57.
    for (index, space) in spaces.into_iter().enumerate() {
        let encoded = encode_reader_primitive_list_v1(&page_fill(space)).expect("encode");
        assert_eq!(encoded.bytes[57], u8::try_from(index + 1).unwrap());
        assert_eq!(validate(&encoded.bytes), Ok(1));
    }

    let mut unknown = encode_reader_primitive_list_v1(&page_fill(ReaderColorSpaceV1::Srgb))
        .expect("encode")
        .bytes;
    unknown[57] = 16;
    assert_eq!(validate(&unknown), Err(DecodeError::UnknownEnum(16)));
}

#[test]
fn lowered_display_commands_encode_as_format_2() {
    let lowered = lower_display_commands(&representative_commands(), 2.0, &fixture_image_size)
        .expect("lower");
    let encoded = encode_reader_primitive_list_v1(&lowered).expect("encode");
    assert_eq!(encoded.format_version, 2);
    assert_eq!(validate(&encoded.bytes), Ok(encoded.command_count));
    assert_eq!(
        encoded.image_hrefs,
        vec!["images/background.png", "images/cover.jpg"]
    );
    assert_eq!(encoded.font_families, vec!["Rito Serif"]);
}

#[test]
fn every_command_shape_lowers_and_encodes() {
    let lowered =
        lower_display_commands(&all_command_shapes(), 1.0, &fixture_image_size).expect("lower");
    let encoded = encode_reader_primitive_list_v1(&lowered).expect("encode");
    assert_eq!(validate(&encoded.bytes), Ok(encoded.command_count));
    assert_eq!(encoded.image_hrefs, vec!["image.png"]);
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
    let lowered = lower_display_commands(
        &[DisplayCommand::paint_page(
            rect(),
            json!({ "backgroundColor": "#112233" }),
        )],
        1.0,
        &fixture_image_size,
    )
    .expect("lower");
    let encoded = encode_reader_primitive_list_v1(&lowered).expect("encode");
    assert!(!contains_bytes(&encoded.bytes, b"#112233"));

    let typed_sources = concat!(
        include_str!("../reader_wire_v1.rs"),
        include_str!("contract.rs"),
        include_str!("contract/geometry.rs"),
        include_str!("contract/paint.rs"),
        include_str!("encode.rs"),
        include_str!("encode/lowered.rs"),
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
        adapt_reader_display_list_v1(&[unknown]).expect_err("unknown paint fails"),
        ReaderDisplayListWireError::UnsupportedLegacyValue("paintBlock.paint")
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
        adapt_reader_display_list_v1(&[summary_text]).expect_err("summary text fails"),
        ReaderDisplayListWireError::InvalidLegacyField("text.text")
    );

    let unresolved_current_color =
        DisplayCommand::paint_page(rect(), json!({ "backgroundColor": "currentColor" }));
    assert_eq!(
        adapt_reader_display_list_v1(&[unresolved_current_color])
            .expect_err("unresolved colour fails"),
        ReaderDisplayListWireError::UnsupportedLegacyValue("color.currentColor")
    );
}

#[test]
fn rejects_non_finite_command_numbers() {
    // The adapter refuses the number before the lowering sees it, and the
    // encoder refuses a primitive carrying one.
    assert_eq!(
        lower_display_commands(
            &[DisplayCommand::opacity(f64::NAN)],
            1.0,
            &fixture_image_size,
        )
        .expect_err("NaN never reaches the wire"),
        LowerError::Adapt(ReaderDisplayListWireError::NonFiniteNumber)
    );
    assert_eq!(
        encode_reader_primitive_list_v1(&PrimitiveList {
            ratio: 1.0,
            commands: vec![Primitive::Opacity { value: f64::NAN }],
        }),
        Err(ReaderDisplayListWireError::NonFiniteNumber)
    );
}

/// A block with every background, border, radius and shadow law engaged,
/// a text run with every optional field present (spacings, inline
/// background, shadow, decoration, padding, borders, the inline-box tail,
/// the ruby alignment), and an image.
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
                "font": {
                    "family": "Rito Serif",
                    "sizePx": 16,
                    "style": "italic",
                    "weight": 700
                },
                "wordSpacingPx": 1,
                "letterSpacingPx": 0.5,
                "backgroundColor": "color(display-p3 0.4 0.5 0.6 / 0.5)",
                "backgroundRadius": 2,
                "textShadow": [
                    { "offsetX": 1, "offsetY": 2, "blur": 3, "color": "#445566" }
                ],
                "decoration": {
                    "kind": "line-through",
                    "y": 18,
                    "thickness": 1,
                    "color": "#000000"
                },
                "padding": { "top": 1, "right": 2, "bottom": 3, "left": 4 },
                "border": {
                    "top": { "widthPx": 1, "paint": { "color": "#000000", "style": "solid" } },
                    "start": { "widthPx": 2, "paint": { "color": "#000000", "style": "dotted" } }
                },
                "box": { "topPx": -2, "bottomPx": 22 },
                "boxStart": false,
                "boxEnd": true
            })),
            line_height_px: Some(json!(18.5)),
            href: Some("#note".to_owned()),
            source_text: Some(json!("source")),
            source_text_offset: Some(9),
            ruby_align: Some(RubyAlignPaint::CENTER),
            align_right: true,
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

/// One of every primitive. The lowered representative commands supply the
/// text, ruby and cover image; the resolved shapes are built here.
fn all_primitive_shapes() -> PrimitiveList {
    let lowered = lower_display_commands(&representative_commands(), 2.0, &fixture_image_size)
        .expect("lower");
    let text = lowered
        .commands
        .iter()
        .find_map(|primitive| match primitive {
            Primitive::Text(run) => Some(run.clone()),
            _ => None,
        })
        .expect("representative text lowers to a text run");
    let (src, dest, source_rect) = lowered
        .commands
        .iter()
        .find_map(|primitive| match primitive {
            Primitive::DrawImage {
                src,
                dest,
                source_rect,
                ..
            } if src == "images/cover.jpg" => Some((src.clone(), *dest, *source_rect)),
            _ => None,
        })
        .expect("representative image lowers to a draw");
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
                ground: Ground::Block(DeviceRect::new(0.5, 0.5, 39.0, 59.0)),
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
                src,
                dest,
                source_rect,
                tiles: Some(TilePlan {
                    origin: DevicePoint::new(0.0, 0.0),
                    step_x: 16.0,
                    step_y: 16.0,
                    columns: 2,
                    rows: 3,
                }),
            },
            Primitive::Text(text.clone()),
            Primitive::Ruby(text),
        ],
    }
}

/// The representative block's background image, sized so it tiles.
fn fixture_image_size(href: &str) -> Option<ImageSize> {
    (href == "images/background.png").then_some(ImageSize {
        width: 20,
        height: 10,
    })
}

/// A page ground in one colour space: the first primitive's colour lands
/// at a fixed offset.
fn page_fill(space: ReaderColorSpaceV1) -> PrimitiveList {
    PrimitiveList {
        ratio: 1.0,
        commands: vec![Primitive::FillRect {
            rect: DeviceRect::new(0.0, 0.0, 20.0, 30.0),
            color: ReaderColorV1 {
                space,
                components: [0.25, 0.5, 0.75],
                alpha: 1.0,
                none: ReaderColorNoneFlagsV1::default(),
            },
            ground: Ground::Page,
        }],
    }
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}
