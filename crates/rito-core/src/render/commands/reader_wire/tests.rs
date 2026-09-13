use sha2::{Digest, Sha256};

use crate::render::{
    lower::{
        lower, DashPattern, DevicePath, DevicePoint, DeviceRect, DeviceTransform, FillRule, Ground,
        ImageSize, PathOp, Primitive, PrimitiveList, StrokeCap, TilePlan,
    },
    test_support::css_color,
    DisplayCommand, DisplayTextCommand, RunPaint,
};

use super::{
    contract::{
        ReaderBackgroundPaint, ReaderBackgroundPosition, ReaderBackgroundRepeat,
        ReaderBackgroundSize, ReaderBlockBorder, ReaderBlockPaint, ReaderBlockRadius,
        ReaderBorderBox, ReaderBorderEdgePaint, ReaderBorderStyle, ReaderBoxShadow, ReaderColor,
        ReaderColorNoneFlags, ReaderColorSpace, ReaderCornerRadius, ReaderFontPaint,
        ReaderFontStyle, ReaderHorizontalRulePaint, ReaderLength, ReaderPagePaint, ReaderPoint,
        ReaderRect, ReaderRunBorder, ReaderRunBorderEdge, ReaderRunDecoration,
        ReaderRunDecorationKind, ReaderRunPaint, ReaderSize, ReaderSpacing, ReaderTextShadow,
        ReaderTransform,
    },
    decode::{validate, DecodeError},
    encode::checked_length,
    encode_reader_primitive_list, ReaderDisplayListWireError, READER_PRIMITIVE_LIST_FORMAT_VERSION,
};

/// The bytes the JavaScript and Dart decoder tests read: one of every
/// primitive, the text run carrying every optional field. A decoder that
/// drifts from the encoder fails on these, not on a hand-built fixture that
/// agrees with its own stale reading.
const PRIMITIVE_LIST_FIXTURE: &str = include_str!(
    "../../../../../../packages/rito-core-wasm/tests/fixtures/reader-session-primitive-list.hex"
);
const FIXTURE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/rito-core-wasm/tests/fixtures"
);

#[test]
fn cross_language_wire_fixture_matches_the_encoder() {
    let primitives = hex(&encode_reader_primitive_list(&all_primitive_shapes())
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
    let primitives = encode_reader_primitive_list(&all_primitive_shapes())
        .expect("encode")
        .bytes;
    std::fs::write(
        format!("{FIXTURE_DIR}/reader-session-primitive-list.hex"),
        format!("{}\n", hex(&primitives)),
    )
    .expect("write wire fixture");
}

#[test]
fn every_primitive_shape_roundtrips_through_the_strict_validator() {
    let encoded = encode_reader_primitive_list(&all_primitive_shapes()).expect("encode");

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
    let encoded = encode_reader_primitive_list(&PrimitiveList {
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
    let encoded = encode_reader_primitive_list(&all_primitive_shapes()).expect("encode");
    for end in 0..encoded.bytes.len() {
        assert_eq!(validate(&encoded.bytes[..end]), Err(DecodeError::Truncated));
    }

    let mut opcode = encode_reader_primitive_list(&PrimitiveList {
        ratio: 1.0,
        commands: vec![Primitive::PushState],
    })
    .expect("encode")
    .bytes;
    opcode[23..25].copy_from_slice(&u16::MAX.to_le_bytes());
    assert_eq!(validate(&opcode), Err(DecodeError::UnknownOpcode(u16::MAX)));

    let mut tag = encode_reader_primitive_list(&PrimitiveList {
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
    let mut format_one = encode_reader_primitive_list(&PrimitiveList {
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

    let mut trailing = encode_reader_primitive_list(&all_primitive_shapes())
        .expect("encode")
        .bytes;
    trailing.push(0);
    assert_eq!(validate(&trailing), Err(DecodeError::TrailingBytes));
}

#[test]
fn every_color_space_tag_is_valid_and_tag_16_is_rejected() {
    let spaces = [
        ReaderColorSpace::Srgb,
        ReaderColorSpace::Hsl,
        ReaderColorSpace::Hwb,
        ReaderColorSpace::Lab,
        ReaderColorSpace::Lch,
        ReaderColorSpace::Oklab,
        ReaderColorSpace::Oklch,
        ReaderColorSpace::SrgbLinear,
        ReaderColorSpace::DisplayP3,
        ReaderColorSpace::DisplayP3Linear,
        ReaderColorSpace::A98Rgb,
        ReaderColorSpace::ProphotoRgb,
        ReaderColorSpace::Rec2020,
        ReaderColorSpace::XyzD50,
        ReaderColorSpace::XyzD65,
    ];
    // Header (23) + opcode (2) + rect (32) puts the colour space tag at 57.
    for (index, space) in spaces.into_iter().enumerate() {
        let encoded = encode_reader_primitive_list(&page_fill(space)).expect("encode");
        assert_eq!(encoded.bytes[57], u8::try_from(index + 1).unwrap());
        assert_eq!(validate(&encoded.bytes), Ok(1));
    }

    let mut unknown = encode_reader_primitive_list(&page_fill(ReaderColorSpace::Srgb))
        .expect("encode")
        .bytes;
    unknown[57] = 16;
    assert_eq!(validate(&unknown), Err(DecodeError::UnknownEnum(16)));
}

#[test]
fn lowered_display_commands_encode_as_format_2() {
    let lowered = lower(&representative_commands(), 2.0, &fixture_image_size).expect("lower");
    let encoded = encode_reader_primitive_list(&lowered).expect("encode");
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
    let lowered = lower(&all_command_shapes(), 1.0, &fixture_image_size).expect("lower");
    let encoded = encode_reader_primitive_list(&lowered).expect("encode");
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
    let lowered = lower(
        &[DisplayCommand::PaintPage {
            rect: rect(),
            paint: ReaderPagePaint {
                background_color: Some(css_color("#112233")),
            },
        }],
        1.0,
        &fixture_image_size,
    )
    .expect("lower");
    let encoded = encode_reader_primitive_list(&lowered).expect("encode");
    assert!(!contains_bytes(&encoded.bytes, b"#112233"));

    let typed_sources = concat!(
        include_str!("../reader_wire.rs"),
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
fn rejects_non_finite_command_numbers() {
    // The encoder refuses a primitive carrying a non-finite number, so a
    // NaN in a command never reaches the wire.
    let lowered = lower(
        &[DisplayCommand::opacity(f64::NAN)],
        1.0,
        &fixture_image_size,
    )
    .expect("lowering carries the value to the encoder");
    assert_eq!(
        encode_reader_primitive_list(&lowered),
        Err(ReaderDisplayListWireError::NonFiniteNumber)
    );
    assert_eq!(
        encode_reader_primitive_list(&PrimitiveList {
            ratio: 1.0,
            commands: vec![Primitive::Opacity { value: f64::NAN }],
        }),
        Err(ReaderDisplayListWireError::NonFiniteNumber)
    );
}

/// A block with every background, border, radius and shadow law engaged,
/// a text run with every optional field present (spacings, shadow, line
/// height, link target, source text and offset, cluster origins), and an
/// image.
fn representative_commands() -> Vec<DisplayCommand> {
    vec![
        DisplayCommand::PushState,
        DisplayCommand::PaintBlock {
            rect: rect(),
            paint: ReaderBlockPaint {
                background: Some(ReaderBackgroundPaint {
                    color: Some(css_color("#112233")),
                    image: Some("images/background.png".to_owned()),
                    size: Some(ReaderBackgroundSize::Cover),
                    repeat: Some(ReaderBackgroundRepeat::NoRepeat),
                    position: Some(ReaderBackgroundPosition {
                        x: ReaderLength::Percent(50.0),
                        y: ReaderLength::Px(0.0),
                    }),
                }),
                border: Some(ReaderBlockBorder {
                    top: Some(ReaderBorderEdgePaint {
                        color: css_color("#445566"),
                        style: ReaderBorderStyle::Solid,
                    }),
                    ..ReaderBlockBorder::default()
                }),
                radius: Some(ReaderBlockRadius::Px(3.0)),
                box_shadows: vec![ReaderBoxShadow {
                    offset_x: 1.0,
                    offset_y: 2.0,
                    blur: 3.0,
                    spread: 0.0,
                    color: css_color("rgba(0, 0, 0, .5)"),
                    inset: false,
                }],
            },
            border_box: Some(ReaderBorderBox {
                top_width: 1.0,
                right_width: 0.0,
                bottom_width: 0.0,
                left_width: 0.0,
            }),
        },
        DisplayCommand::PaintText(DisplayTextCommand {
            text: "text".to_owned(),
            rect: rect(),
            paint: RunPaint::new(ReaderRunPaint {
                font: ReaderFontPaint {
                    family: "Rito Serif".to_owned(),
                    size_px: 16.0,
                    weight: 700.0,
                    style: ReaderFontStyle::Italic,
                },
                color: css_color("#000000"),
                word_spacing_px: Some(1.0),
                letter_spacing_px: Some(0.5),
                background_color: Some(css_color("color(display-p3 0.4 0.5 0.6 / 0.5)")),
                background_radius: Some(2.0),
                text_shadows: vec![ReaderTextShadow {
                    offset_x: 1.0,
                    offset_y: 2.0,
                    blur: 3.0,
                    color: css_color("#445566"),
                }],
                decoration: Some(ReaderRunDecoration {
                    kind: ReaderRunDecorationKind::LineThrough,
                    y: 18.0,
                    thickness: 1.0,
                    color: css_color("#000000"),
                }),
                padding: Some(ReaderSpacing {
                    top: 1.0,
                    right: 2.0,
                    bottom: 3.0,
                    left: 4.0,
                }),
                border: Some(ReaderRunBorder {
                    top: Some(ReaderRunBorderEdge {
                        width_px: 1.0,
                        paint: ReaderBorderEdgePaint {
                            color: css_color("#000000"),
                            style: ReaderBorderStyle::Solid,
                        },
                    }),
                    start: Some(ReaderRunBorderEdge {
                        width_px: 2.0,
                        paint: ReaderBorderEdgePaint {
                            color: css_color("#000000"),
                            style: ReaderBorderStyle::Dotted,
                        },
                    }),
                    ..ReaderRunBorder::default()
                }),
                box_offsets: Some((-2.0, 22.0)),
                box_start: false,
                box_end: true,
            }),
            line_height_px: Some(18.5),
            href: Some("#note".to_owned()),
            source_text: Some("source".to_owned()),
            source_text_offset: Some(9),
            clusters: vec![
                (0, 0.0, 12.5),
                (1, 8.5, 12.5),
                (2, 12.25, 12.5),
                (3, 16.0, 12.5),
            ],
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
    let text = || DisplayTextCommand {
        text: "text".to_owned(),
        rect: rect(),
        paint: RunPaint::default(),
        line_height_px: None,
        href: None,
        source_text: None,
        source_text_offset: None,
        clusters: Vec::new(),
    };
    vec![
        DisplayCommand::PushState,
        DisplayCommand::PopState,
        DisplayCommand::Translate { dx: 1.0, dy: 2.0 },
        DisplayCommand::opacity(0.5),
        DisplayCommand::Transform {
            origin: ReaderPoint { x: 10.0, y: 20.0 },
            box_size: ReaderSize {
                width: 30.0,
                height: 40.0,
            },
            transforms: vec![
                ReaderTransform::Rotate { radians: 0.5 },
                ReaderTransform::Scale { sx: 2.0, sy: 3.0 },
                ReaderTransform::Translate {
                    x: ReaderLength::Px(4.0),
                    y: ReaderLength::Percent(5.0),
                },
            ],
        },
        DisplayCommand::ClipRect {
            rect: rect(),
            radius: Some(ReaderCornerRadius { rx: 2.0, ry: 2.0 }),
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
                    color: Some(css_color("#ffffff")),
                    ..ReaderBackgroundPaint::default()
                }),
                ..ReaderBlockPaint::default()
            },
            border_box: None,
        },
        DisplayCommand::PaintText(text()),
        DisplayCommand::PaintRuby(text()),
        DisplayCommand::paint_image("image.png".to_owned(), rect(), None, None),
        DisplayCommand::PaintHorizontalRule {
            rect: rect(),
            paint: ReaderHorizontalRulePaint {
                color: css_color("#000000"),
                style: ReaderBorderStyle::Solid,
            },
        },
    ]
}

fn rect() -> ReaderRect {
    ReaderRect {
        x: 0.0,
        y: 0.0,
        width: 20.0,
        height: 30.0,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// One of every primitive. The lowered representative commands supply the
/// text, ruby and cover image; the resolved shapes are built here.
fn all_primitive_shapes() -> PrimitiveList {
    let lowered = lower(&representative_commands(), 2.0, &fixture_image_size).expect("lower");
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
    let color = ReaderColor {
        space: ReaderColorSpace::Srgb,
        components: [0.25, 0.5, 0.75],
        alpha: 1.0,
        none: ReaderColorNoneFlags::default(),
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
fn page_fill(space: ReaderColorSpace) -> PrimitiveList {
    PrimitiveList {
        ratio: 1.0,
        commands: vec![Primitive::FillRect {
            rect: DeviceRect::new(0.0, 0.0, 20.0, 30.0),
            color: ReaderColor {
                space,
                components: [0.25, 0.5, 0.75],
                alpha: 1.0,
                none: ReaderColorNoneFlags::default(),
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
