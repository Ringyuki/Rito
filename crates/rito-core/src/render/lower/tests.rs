use std::f64::consts::{FRAC_PI_2, PI};

use serde_json::json;

use super::super::commands::{
    contract::{
        ReaderBackgroundPaintV1, ReaderBackgroundPositionV1, ReaderBackgroundSizeV1,
        ReaderBlockBorderV1, ReaderBlockPaintV1, ReaderBlockRadiusV1, ReaderBorderBoxV1,
        ReaderBorderEdgePaintV1, ReaderBorderStyleV1, ReaderBoxShadowV1, ReaderColorNoneFlagsV1,
        ReaderColorSpaceV1, ReaderColorV1, ReaderCornerRadiusV1, ReaderDisplayCommandV1,
        ReaderDisplayListV1, ReaderFontPaintV1, ReaderFontStyleV1, ReaderHorizontalRulePaintV1,
        ReaderLengthV1, ReaderPagePaintV1, ReaderPointV1, ReaderRectV1, ReaderRunBorderEdgeV1,
        ReaderRunBorderV1, ReaderRunDecorationKindV1, ReaderRunDecorationV1, ReaderRunPaintV1,
        ReaderSizeV1, ReaderSpacingV1, ReaderTextCommandV1, ReaderTextShadowV1, ReaderTransformV1,
    },
    DisplayCommand, ReaderDisplayListWireError,
};
use super::{
    lower, lower_display_commands, DevicePath, DevicePoint, DeviceRect, DeviceTransform, FillRule,
    Ground, LowerError, PathOp, Primitive,
};

const INK: ReaderColorV1 = ReaderColorV1 {
    space: ReaderColorSpaceV1::Srgb,
    components: [0.1, 0.2, 0.3],
    alpha: 1.0,
    none: ReaderColorNoneFlagsV1 {
        component_0: false,
        component_1: false,
        component_2: false,
        alpha: false,
    },
};

const TRANSLUCENT: ReaderColorV1 = ReaderColorV1 { alpha: 0.5, ..INK };

#[test]
fn rejects_a_ratio_that_is_not_finite_and_positive() {
    let empty = ReaderDisplayListV1 { commands: vec![] };
    for ratio in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            lower(&empty, ratio),
            Err(LowerError::InvalidRatio),
            "{ratio}"
        );
    }
    assert_eq!(lower(&empty, 1.5).expect("lower").ratio, 1.5);
}

#[test]
fn state_commands_scale_their_offsets_to_device_pixels() {
    let primitives = lowered(
        vec![
            ReaderDisplayCommandV1::PushState,
            ReaderDisplayCommandV1::Translate { dx: 1.5, dy: 2.0 },
            ReaderDisplayCommandV1::Opacity { value: 0.5 },
            ReaderDisplayCommandV1::PopState,
        ],
        2.0,
    );
    assert_eq!(
        primitives,
        vec![
            Primitive::PushState,
            Primitive::Translate { dx: 3.0, dy: 4.0 },
            Primitive::Opacity { value: 0.5 },
            Primitive::PopState,
        ]
    );
}

#[test]
fn transform_resolves_translate_percentages_against_the_device_box() {
    let primitives = lowered(
        vec![ReaderDisplayCommandV1::Transform {
            origin: ReaderPointV1 { x: 10.0, y: 20.0 },
            box_size: ReaderSizeV1 {
                width: 30.0,
                height: 40.0,
            },
            transforms: vec![
                ReaderTransformV1::Rotate { radians: 0.5 },
                ReaderTransformV1::Scale { sx: 2.0, sy: 3.0 },
                ReaderTransformV1::Translate {
                    x: ReaderLengthV1::Px(4.0),
                    y: ReaderLengthV1::Percent(50.0),
                },
            ],
        }],
        2.0,
    );
    assert_eq!(
        primitives,
        vec![Primitive::Transform {
            origin: DevicePoint::new(20.0, 40.0),
            transforms: vec![
                DeviceTransform::Rotate { radians: 0.5 },
                DeviceTransform::Scale { sx: 2.0, sy: 3.0 },
                DeviceTransform::Translate { dx: 8.0, dy: 40.0 },
            ],
        }]
    );
}

#[test]
fn clip_without_a_radius_is_a_rect_path() {
    let primitives = lowered(
        vec![ReaderDisplayCommandV1::ClipRect {
            rect: rect(1.0, 2.0, 20.0, 30.0),
            radius: Some(ReaderCornerRadiusV1 { rx: 0.0, ry: 0.0 }),
        }],
        2.0,
    );
    assert_eq!(
        primitives,
        vec![Primitive::ClipPath {
            path: DevicePath {
                ops: vec![PathOp::Rect(DeviceRect::new(2.0, 4.0, 40.0, 60.0))],
            },
        }]
    );
}

#[test]
fn clip_with_a_radius_traces_the_rounded_outline_overlap_scaled() {
    // Radius 20 on a 20 by 30 box: both axes shrink by the same 20/40
    // factor to 10, a stadium, not a per-axis clamp of 10 by 15.
    let primitives = lowered(
        vec![ReaderDisplayCommandV1::ClipRect {
            rect: rect(0.0, 0.0, 20.0, 30.0),
            radius: Some(ReaderCornerRadiusV1 { rx: 20.0, ry: 20.0 }),
        }],
        1.0,
    );
    let corner = |x: f64, y: f64, start: f64| PathOp::Arc {
        center: DevicePoint::new(x, y),
        rx: 10.0,
        ry: 10.0,
        start,
        sweep: FRAC_PI_2,
    };
    assert_eq!(
        primitives,
        vec![Primitive::ClipPath {
            path: DevicePath {
                ops: vec![
                    PathOp::MoveTo(DevicePoint::new(10.0, 0.0)),
                    PathOp::LineTo(DevicePoint::new(10.0, 0.0)),
                    corner(10.0, 10.0, -FRAC_PI_2),
                    PathOp::LineTo(DevicePoint::new(20.0, 20.0)),
                    corner(10.0, 20.0, 0.0),
                    PathOp::LineTo(DevicePoint::new(10.0, 30.0)),
                    corner(10.0, 20.0, FRAC_PI_2),
                    PathOp::LineTo(DevicePoint::new(0.0, 10.0)),
                    corner(10.0, 10.0, PI),
                    PathOp::Close,
                ],
            },
        }]
    );
}

#[test]
fn page_fill_declares_the_page_ground_and_stays_unsnapped() {
    let page = |background_color| ReaderDisplayCommandV1::PaintPage {
        rect: rect(0.5, 0.0, 20.0, 30.0),
        paint: ReaderPagePaintV1 { background_color },
    };
    assert_eq!(
        lowered(vec![page(Some(INK))], 2.0),
        vec![Primitive::FillRect {
            rect: DeviceRect::new(1.0, 0.0, 40.0, 60.0),
            color: INK,
            ground: Ground::Page,
        }]
    );
    assert_eq!(lowered(vec![page(None)], 2.0), vec![]);
}

#[test]
fn block_background_snaps_each_edge_independently() {
    let at = |color| {
        block(
            rect(57.65625, 10.4, 100.2, 20.2),
            block_paint(Some(color), None),
            None,
        )
    };
    assert_eq!(
        lowered(vec![at(INK)], 1.0),
        vec![Primitive::FillRect {
            rect: DeviceRect::new(58.0, 10.0, 100.0, 21.0),
            color: INK,
            ground: Ground::Block,
        }]
    );
    // A translucent background is no ground for the ink over it.
    assert_eq!(
        lowered(vec![at(TRANSLUCENT)], 1.0),
        vec![Primitive::FillRect {
            rect: DeviceRect::new(58.0, 10.0, 100.0, 21.0),
            color: TRANSLUCENT,
            ground: Ground::None,
        }]
    );
    // On a 2× grid the same box rounds to different device edges.
    assert_eq!(
        fill_rects(&lowered(vec![at(INK)], 2.0)),
        vec![DeviceRect::new(115.0, 21.0, 201.0, 40.0)]
    );
}

#[test]
fn a_block_that_snaps_to_nothing_paints_nothing() {
    let primitives = lowered(
        vec![block(
            rect(10.2, 10.0, 0.2, 5.0),
            block_paint(Some(INK), None),
            None,
        )],
        1.0,
    );
    assert_eq!(primitives, vec![]);
}

#[test]
fn straight_solid_borders_are_binary_bands_at_the_rounded_outer_edge() {
    // Box (10.4, 20.6) 100.2 by 50.3 snaps to [10, 111) by [21, 71). Each
    // band starts at the rounded outer edge and is max(1, floor(width))
    // deep: 1.5 → 1 row at 21, 3.7 → 3 rows ending at 71 (row 67), 0.4 →
    // 1 column at 10, 2 → columns 109 and 110.
    let primitives = lowered(
        vec![block(
            rect(10.4, 20.6, 100.2, 50.3),
            block_paint(Some(INK), Some(solid_border())),
            Some(widths(1.5, 2.0, 3.7, 0.4)),
        )],
        1.0,
    );
    assert_eq!(
        fill_rects(&primitives),
        vec![
            DeviceRect::new(10.0, 21.0, 101.0, 50.0),
            DeviceRect::new(10.0, 21.0, 101.0, 1.0),
            DeviceRect::new(10.0, 67.0, 101.0, 3.0),
            DeviceRect::new(10.0, 21.0, 1.0, 50.0),
            DeviceRect::new(109.0, 21.0, 2.0, 50.0),
        ]
    );
    assert!(primitives.iter().skip(1).all(|primitive| matches!(
        primitive,
        Primitive::FillRect {
            ground: Ground::None,
            ..
        }
    )));
}

#[test]
fn a_fractional_box_top_moves_the_band_by_the_rounding_rule() {
    let top_band = |y: f64| {
        let primitives = lowered(
            vec![block(
                rect(0.0, y, 100.0, 50.0),
                block_paint(None, Some(top_only(ReaderBorderStyleV1::Solid))),
                Some(widths(1.0, 0.0, 0.0, 0.0)),
            )],
            1.0,
        );
        fill_rects(&primitives)[0]
    };
    assert_eq!(top_band(20.4), DeviceRect::new(0.0, 20.0, 100.0, 1.0));
    assert_eq!(top_band(20.6), DeviceRect::new(0.0, 21.0, 100.0, 1.0));
}

#[test]
fn bevel_styles_take_the_solid_band() {
    for style in [
        ReaderBorderStyleV1::Groove,
        ReaderBorderStyleV1::Ridge,
        ReaderBorderStyleV1::Inset,
        ReaderBorderStyleV1::Outset,
    ] {
        let primitives = lowered(
            vec![block(
                rect(0.0, 0.0, 100.0, 50.0),
                block_paint(None, Some(top_only(style))),
                Some(widths(2.0, 0.0, 0.0, 0.0)),
            )],
            1.0,
        );
        assert_eq!(
            fill_rects(&primitives),
            vec![DeviceRect::new(0.0, 0.0, 100.0, 2.0)],
            "{style:?}"
        );
    }
}

#[test]
fn hidden_edges_missing_paint_or_a_missing_border_box_stroke_nothing() {
    let hidden = lowered(
        vec![block(
            rect(0.0, 0.0, 100.0, 50.0),
            block_paint(None, Some(top_only(ReaderBorderStyleV1::Hidden))),
            Some(widths(2.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    );
    assert_eq!(hidden, vec![]);
    let unpainted = lowered(
        vec![block(
            rect(0.0, 0.0, 100.0, 50.0),
            block_paint(None, Some(ReaderBlockBorderV1::default())),
            Some(widths(2.0, 2.0, 2.0, 2.0)),
        )],
        1.0,
    );
    assert_eq!(unpainted, vec![]);
    let no_box = lowered(
        vec![block(
            rect(0.0, 0.0, 100.0, 50.0),
            block_paint(Some(INK), Some(solid_border())),
            None,
        )],
        1.0,
    );
    assert_eq!(
        fill_rects(&no_box),
        vec![DeviceRect::new(0.0, 0.0, 100.0, 50.0)]
    );
}

#[test]
fn double_edges_paint_two_solid_thirds() {
    let primitives = lowered(
        vec![block(
            rect(10.0, 21.0, 100.0, 30.0),
            block_paint(None, Some(top_only(ReaderBorderStyleV1::Double))),
            Some(widths(6.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    );
    assert_eq!(
        fill_rects(&primitives),
        vec![
            DeviceRect::new(10.0, 21.0, 100.0, 2.0),
            DeviceRect::new(10.0, 25.0, 100.0, 2.0),
        ]
    );
}

#[test]
fn dashed_edges_stretch_the_gap_so_full_dashes_land_flush_at_both_ends() {
    let primitives = lowered(
        vec![block(
            rect(0.0, 0.0, 280.0, 10.0),
            block_paint(None, Some(top_only(ReaderBorderStyleV1::Dashed))),
            Some(widths(1.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    );
    let dashes = fill_rects(&primitives);
    assert_eq!(dashes.len(), 56);
    assert_eq!(dashes[0], DeviceRect::new(0.0, 0.0, 3.0, 1.0));
    let gap = dashes[1].x - dashes[0].right();
    assert!((gap - 112.0 / 55.0).abs() < 1e-12, "{gap}");
    let last = dashes[55];
    assert!((last.right() - 280.0).abs() < 1e-9, "{last:?}");
    assert!(dashes
        .iter()
        .all(|dash| dash.width == 3.0 && dash.y == 0.0 && dash.height == 1.0));
}

#[test]
fn a_dashed_edge_shorter_than_a_dash_paints_the_whole_span() {
    let primitives = lowered(
        vec![block(
            rect(0.0, 0.0, 2.0, 10.0),
            block_paint(None, Some(top_only(ReaderBorderStyleV1::Dashed))),
            Some(widths(1.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    );
    assert_eq!(
        fill_rects(&primitives),
        vec![DeviceRect::new(0.0, 0.0, 2.0, 1.0)]
    );
}

#[test]
fn thin_dotted_edges_follow_the_binary_endpoint_table() {
    // Width 2 on a 640 span (remainder 0 mod 4): start dot, end dot, and
    // the run shifted back one pixel — `##.##..##..`, ending `##.##` at
    // 635 and 638.
    let width_two = fill_rects(&lowered(
        vec![block(
            rect(0.0, 0.0, 640.0, 10.0),
            block_paint(None, Some(top_only(ReaderBorderStyleV1::Dotted))),
            Some(widths(2.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    ));
    assert_eq!(width_two.len(), 161);
    assert_eq!(width_two[0], DeviceRect::new(0.0, 0.0, 2.0, 2.0));
    assert_eq!(width_two[1], DeviceRect::new(638.0, 0.0, 2.0, 2.0));
    assert_eq!(width_two[2], DeviceRect::new(3.0, 0.0, 2.0, 2.0));
    assert_eq!(width_two[3], DeviceRect::new(7.0, 0.0, 2.0, 2.0));
    assert_eq!(width_two[160], DeviceRect::new(635.0, 0.0, 2.0, 2.0));

    // Width 1 on an even span: a double dot at the start, then every
    // other pixel from 3.
    let width_one = fill_rects(&lowered(
        vec![block(
            rect(0.0, 0.0, 10.0, 10.0),
            block_paint(None, Some(top_only(ReaderBorderStyleV1::Dotted))),
            Some(widths(1.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    ));
    assert_eq!(
        width_one,
        vec![
            DeviceRect::new(0.0, 0.0, 2.0, 1.0),
            DeviceRect::new(3.0, 0.0, 1.0, 1.0),
            DeviceRect::new(5.0, 0.0, 1.0, 1.0),
            DeviceRect::new(7.0, 0.0, 1.0, 1.0),
            DeviceRect::new(9.0, 0.0, 1.0, 1.0),
        ]
    );
}

#[test]
fn thick_dotted_edges_are_round_dots_at_the_measured_pitch() {
    // A 6px rule across 628 device pixels: 52 dots would leave gaps of
    // 6.196, 53 dots gaps of 5.9615, the closer to one width wins.
    let primitives = lowered(
        vec![block(
            rect(0.0, 0.0, 628.0, 20.0),
            block_paint(None, Some(top_only(ReaderBorderStyleV1::Dotted))),
            Some(widths(6.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    );
    let [Primitive::FillPath { path, rule, color }] = primitives.as_slice() else {
        panic!("one dot path, got {primitives:?}");
    };
    assert_eq!(*rule, FillRule::NonZero);
    assert_eq!(*color, INK);
    let centers: Vec<DevicePoint> = path
        .ops
        .iter()
        .map(|op| match *op {
            PathOp::Ellipse { center, rx, ry } => {
                assert_eq!((rx, ry), (3.0, 3.0));
                center
            }
            other => panic!("dot path holds {other:?}"),
        })
        .collect();
    assert_eq!(centers.len(), 53);
    assert_eq!(centers[0], DevicePoint::new(3.0, 3.0));
    let pitch = 6.0 + 310.0 / 52.0 - 0.01;
    for pair in centers.windows(2) {
        assert!((pair[1].x - pair[0].x - pitch).abs() < 1e-9, "{pair:?}");
        assert_eq!(pair[1].y, 3.0);
    }
}

#[test]
fn horizontal_rules_raster_as_border_edges() {
    let rule = |rect, style| ReaderDisplayCommandV1::PaintHorizontalRule {
        rect,
        paint: ReaderHorizontalRulePaintV1 { color: INK, style },
    };
    // Row = round(top): the band, not the rounded half-shifted centerline
    // that sat one device row below the browser's.
    let horizontal = lowered(
        vec![rule(
            rect(20.3, 100.6, 200.0, 1.0),
            ReaderBorderStyleV1::Solid,
        )],
        1.0,
    );
    assert_eq!(
        fill_rects(&horizontal),
        vec![DeviceRect::new(20.0, 101.0, 200.0, 1.0)]
    );
    // Taller than wide: the rule box's vertical bevel edge along y.
    let vertical = lowered(
        vec![rule(rect(10.2, 5.0, 2.0, 10.0), ReaderBorderStyleV1::Solid)],
        1.0,
    );
    assert_eq!(
        fill_rects(&vertical),
        vec![DeviceRect::new(10.0, 5.0, 2.0, 10.0)]
    );
    // The same edge model at 2×: the CSS 0.5px rule is one device row.
    let scaled = lowered(
        vec![rule(
            rect(20.0, 100.3, 200.0, 0.5),
            ReaderBorderStyleV1::Solid,
        )],
        2.0,
    );
    assert_eq!(
        fill_rects(&scaled),
        vec![DeviceRect::new(40.0, 201.0, 400.0, 1.0)]
    );
}

#[test]
fn blocks_with_rounded_corners_shadows_or_background_images_pass_through_scaled() {
    let rounded = block(
        rect(1.0, 2.0, 10.0, 20.0),
        ReaderBlockPaintV1 {
            radius: Some(ReaderBlockRadiusV1::Px(3.0)),
            ..block_paint(Some(INK), Some(solid_border()))
        },
        Some(widths(1.0, 2.0, 3.0, 4.0)),
    );
    assert_eq!(
        lowered(vec![rounded], 2.0),
        vec![Primitive::Block {
            rect: DeviceRect::new(2.0, 4.0, 20.0, 40.0),
            paint: ReaderBlockPaintV1 {
                radius: Some(ReaderBlockRadiusV1::Px(6.0)),
                ..block_paint(Some(INK), Some(solid_border()))
            },
            border_box: Some(widths(2.0, 4.0, 6.0, 8.0)),
        }]
    );

    let shadowed = block(
        rect(0.0, 0.0, 10.0, 20.0),
        ReaderBlockPaintV1 {
            box_shadows: vec![ReaderBoxShadowV1 {
                offset_x: 1.0,
                offset_y: 2.0,
                blur: 3.0,
                spread: 0.5,
                color: TRANSLUCENT,
                inset: false,
            }],
            ..block_paint(None, None)
        },
        None,
    );
    let primitives = lowered(vec![shadowed], 2.0);
    let [Primitive::Block { paint, .. }] = primitives.as_slice() else {
        panic!("shadowed block passes through");
    };
    assert_eq!(
        paint.box_shadows,
        vec![ReaderBoxShadowV1 {
            offset_x: 2.0,
            offset_y: 4.0,
            blur: 6.0,
            spread: 1.0,
            color: TRANSLUCENT,
            inset: false,
        }]
    );

    let imaged = block(
        rect(0.0, 0.0, 10.0, 20.0),
        ReaderBlockPaintV1 {
            background: Some(ReaderBackgroundPaintV1 {
                color: None,
                image: Some("images/paper.png".to_owned()),
                size: Some(ReaderBackgroundSizeV1::Explicit {
                    x: Some(ReaderLengthV1::Px(10.0)),
                    y: None,
                }),
                repeat: None,
                position: Some(ReaderBackgroundPositionV1 {
                    x: ReaderLengthV1::Percent(50.0),
                    y: ReaderLengthV1::Px(4.0),
                }),
            }),
            ..block_paint(None, None)
        },
        None,
    );
    let list = lower(
        &ReaderDisplayListV1 {
            commands: vec![imaged],
        },
        2.0,
    )
    .expect("lower");
    assert_eq!(list.passthrough_block_count(), 1);
    let [Primitive::Block { paint, .. }] = list.commands.as_slice() else {
        panic!("imaged block passes through");
    };
    let background = paint.background.as_ref().expect("background");
    assert_eq!(
        background.size,
        Some(ReaderBackgroundSizeV1::Explicit {
            x: Some(ReaderLengthV1::Px(20.0)),
            y: None,
        })
    );
    assert_eq!(
        background.position,
        Some(ReaderBackgroundPositionV1 {
            x: ReaderLengthV1::Percent(50.0),
            y: ReaderLengthV1::Px(8.0),
        })
    );

    // Corners that are all zero round nothing: the block lowers.
    let square = block(
        rect(0.0, 0.0, 10.0, 20.0),
        ReaderBlockPaintV1 {
            radius: Some(ReaderBlockRadiusV1::Corners([0.0; 4])),
            ..block_paint(Some(INK), None)
        },
        None,
    );
    assert_eq!(
        fill_rects(&lowered(vec![square], 1.0)),
        vec![DeviceRect::new(0.0, 0.0, 10.0, 20.0)]
    );
}

#[test]
fn text_runs_pass_through_with_every_length_in_device_pixels() {
    let primitives = lowered(
        vec![
            ReaderDisplayCommandV1::PaintText(text()),
            ReaderDisplayCommandV1::PaintRuby(text()),
        ],
        2.0,
    );
    let expected = ReaderTextCommandV1 {
        text: "run".to_owned(),
        rect: rect(3.0, 4.0, 20.0, 40.0),
        paint: ReaderRunPaintV1 {
            font: ReaderFontPaintV1 {
                family: "Rito Serif".to_owned(),
                size_px: 32.0,
                weight: 400.0,
                style: ReaderFontStyleV1::Italic,
            },
            color: INK,
            word_spacing_px: Some(2.0),
            letter_spacing_px: Some(1.0),
            background_color: Some(TRANSLUCENT),
            background_radius: Some(4.0),
            text_shadows: vec![ReaderTextShadowV1 {
                offset_x: 2.0,
                offset_y: 4.0,
                blur: 6.0,
                color: INK,
            }],
            decoration: Some(ReaderRunDecorationV1 {
                kind: ReaderRunDecorationKindV1::Underline,
                y: 36.0,
                thickness: 2.0,
                color: INK,
            }),
            padding: Some(ReaderSpacingV1 {
                top: 2.0,
                right: 4.0,
                bottom: 6.0,
                left: 8.0,
            }),
            border: Some(ReaderRunBorderV1 {
                top: Some(ReaderRunBorderEdgeV1 {
                    width_px: 2.0,
                    paint: ReaderBorderEdgePaintV1 {
                        color: INK,
                        style: ReaderBorderStyleV1::Solid,
                    },
                }),
                bottom: None,
                start: None,
                end: None,
            }),
            box_offsets: Some((-4.0, 44.0)),
            box_start: true,
            box_end: false,
        },
        line_height_px: Some(48.0),
        href: Some("#note".to_owned()),
        source_text: Some("source".to_owned()),
        source_text_offset: Some(9),
        ruby_align: Some("center".to_owned()),
    };
    assert_eq!(
        primitives,
        vec![Primitive::Text(expected.clone()), Primitive::Ruby(expected)]
    );
}

#[test]
fn images_draw_at_the_scaled_destination_with_the_source_rect_untouched() {
    let primitives = lowered(
        vec![ReaderDisplayCommandV1::PaintImage {
            src: "images/plate.png".to_owned(),
            rect: rect(1.5, 2.0, 10.0, 20.0),
            alt: Some("plate".to_owned()),
            href: Some("#intro".to_owned()),
            source_rect: Some(rect(0.0, 0.0, 5.0, 5.0)),
        }],
        2.0,
    );
    assert_eq!(
        primitives,
        vec![Primitive::DrawImage {
            src: "images/plate.png".to_owned(),
            dest: DeviceRect::new(3.0, 4.0, 20.0, 40.0),
            source_rect: Some(rect(0.0, 0.0, 5.0, 5.0)),
            tiles: None,
        }]
    );
}

#[test]
fn lowering_display_commands_adapts_them_first() {
    let commands = [DisplayCommand::paint_page(
        json!({ "x": 0, "y": 0, "width": 20, "height": 30 }),
        json!({ "backgroundColor": "#123456" }),
    )];
    let list = lower_display_commands(&commands, 2.0).expect("lower");
    assert_eq!(list.ratio, 2.0);
    let [Primitive::FillRect { rect, ground, .. }] = list.commands.as_slice() else {
        panic!("page fill, got {:?}", list.commands);
    };
    assert_eq!(*rect, DeviceRect::new(0.0, 0.0, 40.0, 60.0));
    assert_eq!(*ground, Ground::Page);

    assert_eq!(
        lower_display_commands(&[DisplayCommand::opacity(f64::NAN)], 1.0),
        Err(LowerError::Adapt(
            ReaderDisplayListWireError::NonFiniteNumber
        ))
    );
}

#[test]
fn lowering_sources_are_typed_only() {
    let sources = concat!(
        include_str!("../lower.rs"),
        include_str!("primitive.rs"),
        include_str!("path.rs"),
        include_str!("border.rs"),
        include_str!("block.rs"),
        include_str!("scale.rs"),
    );
    assert!(!sources.contains("serde_json"));
    assert!(!sources.contains("Value::"));
}

fn lowered(commands: Vec<ReaderDisplayCommandV1>, ratio: f64) -> Vec<Primitive> {
    lower(&ReaderDisplayListV1 { commands }, ratio)
        .expect("lower")
        .commands
}

fn fill_rects(primitives: &[Primitive]) -> Vec<DeviceRect> {
    primitives
        .iter()
        .map(|primitive| match primitive {
            Primitive::FillRect { rect, .. } => *rect,
            other => panic!("expected only fills, got {other:?}"),
        })
        .collect()
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> ReaderRectV1 {
    ReaderRectV1 {
        x,
        y,
        width,
        height,
    }
}

fn widths(top: f64, right: f64, bottom: f64, left: f64) -> ReaderBorderBoxV1 {
    ReaderBorderBoxV1 {
        top_width: top,
        right_width: right,
        bottom_width: bottom,
        left_width: left,
    }
}

fn edge(style: ReaderBorderStyleV1) -> Option<ReaderBorderEdgePaintV1> {
    Some(ReaderBorderEdgePaintV1 { color: INK, style })
}

fn solid_border() -> ReaderBlockBorderV1 {
    ReaderBlockBorderV1 {
        top: edge(ReaderBorderStyleV1::Solid),
        right: edge(ReaderBorderStyleV1::Solid),
        bottom: edge(ReaderBorderStyleV1::Solid),
        left: edge(ReaderBorderStyleV1::Solid),
    }
}

fn top_only(style: ReaderBorderStyleV1) -> ReaderBlockBorderV1 {
    ReaderBlockBorderV1 {
        top: edge(style),
        ..ReaderBlockBorderV1::default()
    }
}

fn block_paint(
    background: Option<ReaderColorV1>,
    border: Option<ReaderBlockBorderV1>,
) -> ReaderBlockPaintV1 {
    ReaderBlockPaintV1 {
        background: background.map(|color| ReaderBackgroundPaintV1 {
            color: Some(color),
            image: None,
            size: None,
            repeat: None,
            position: None,
        }),
        border,
        radius: None,
        box_shadows: vec![],
    }
}

fn block(
    rect: ReaderRectV1,
    paint: ReaderBlockPaintV1,
    border_box: Option<ReaderBorderBoxV1>,
) -> ReaderDisplayCommandV1 {
    ReaderDisplayCommandV1::PaintBlock {
        rect,
        paint,
        border_box,
    }
}

fn text() -> ReaderTextCommandV1 {
    ReaderTextCommandV1 {
        text: "run".to_owned(),
        rect: rect(1.5, 2.0, 10.0, 20.0),
        paint: ReaderRunPaintV1 {
            font: ReaderFontPaintV1 {
                family: "Rito Serif".to_owned(),
                size_px: 16.0,
                weight: 400.0,
                style: ReaderFontStyleV1::Italic,
            },
            color: INK,
            word_spacing_px: Some(1.0),
            letter_spacing_px: Some(0.5),
            background_color: Some(TRANSLUCENT),
            background_radius: Some(2.0),
            text_shadows: vec![ReaderTextShadowV1 {
                offset_x: 1.0,
                offset_y: 2.0,
                blur: 3.0,
                color: INK,
            }],
            decoration: Some(ReaderRunDecorationV1 {
                kind: ReaderRunDecorationKindV1::Underline,
                y: 18.0,
                thickness: 1.0,
                color: INK,
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
                    paint: ReaderBorderEdgePaintV1 {
                        color: INK,
                        style: ReaderBorderStyleV1::Solid,
                    },
                }),
                bottom: None,
                start: None,
                end: None,
            }),
            box_offsets: Some((-2.0, 22.0)),
            box_start: true,
            box_end: false,
        },
        line_height_px: Some(24.0),
        href: Some("#note".to_owned()),
        source_text: Some("source".to_owned()),
        source_text_offset: Some(9),
        ruby_align: Some("center".to_owned()),
    }
}
