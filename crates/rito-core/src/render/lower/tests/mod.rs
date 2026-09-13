mod parity;

use std::f64::consts::{FRAC_PI_2, PI};

use serde_json::json;

use super::super::commands::{
    contract::{
        ReaderBackgroundPaint, ReaderBackgroundPosition, ReaderBackgroundRepeat,
        ReaderBackgroundSize, ReaderBlockBorder, ReaderBlockPaint, ReaderBlockRadius,
        ReaderBorderBox, ReaderBorderEdgePaint, ReaderBorderStyle, ReaderBoxShadow, ReaderCluster,
        ReaderColor, ReaderColorNoneFlags, ReaderColorSpace, ReaderCornerRadius, ReaderFontPaint,
        ReaderFontStyle, ReaderHorizontalRulePaint, ReaderLength, ReaderPagePaint, ReaderPoint,
        ReaderRect, ReaderRunBorder, ReaderRunBorderEdge, ReaderRunDecoration,
        ReaderRunDecorationKind, ReaderRunPaint, ReaderSize, ReaderSpacing, ReaderTextRun,
        ReaderTextRunPaint, ReaderTextShadow, ReaderTransform,
    },
    DisplayCommand, DisplayTextCommand,
};
use super::{
    json::primitive_list_value, lower, path::corner_rounded_rect, DashPattern, DevicePath,
    DevicePoint, DeviceRect, DeviceTransform, FillRule, Ground, ImageSize, LowerError, PathOp,
    Primitive, StrokeCap, TilePlan,
};
use crate::render::RunPaint;

const INK: ReaderColor = ReaderColor {
    space: ReaderColorSpace::Srgb,
    components: [0.1, 0.2, 0.3],
    alpha: 1.0,
    none: ReaderColorNoneFlags {
        component_0: false,
        component_1: false,
        component_2: false,
        alpha: false,
    },
};

const TRANSLUCENT: ReaderColor = ReaderColor { alpha: 0.5, ..INK };

#[test]
fn rejects_a_ratio_that_is_not_finite_and_positive() {
    let empty: Vec<DisplayCommand> = vec![];
    for ratio in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            lower(&empty, ratio, &no_images),
            Err(LowerError::InvalidRatio),
            "{ratio}"
        );
    }
    assert_eq!(lower(&empty, 1.5, &no_images).expect("lower").ratio, 1.5);
}

#[test]
fn state_commands_scale_their_offsets_to_device_pixels() {
    let primitives = lowered(
        vec![
            DisplayCommand::PushState,
            DisplayCommand::Translate { dx: 1.5, dy: 2.0 },
            DisplayCommand::Opacity { value: 0.5 },
            DisplayCommand::PopState,
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
        vec![DisplayCommand::Transform {
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
                    y: ReaderLength::Percent(50.0),
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
        vec![DisplayCommand::ClipRect {
            rect: rect(1.0, 2.0, 20.0, 30.0),
            radius: Some(ReaderCornerRadius { rx: 0.0, ry: 0.0 }),
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
        vec![DisplayCommand::ClipRect {
            rect: rect(0.0, 0.0, 20.0, 30.0),
            radius: Some(ReaderCornerRadius { rx: 20.0, ry: 20.0 }),
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
    let page = |background_color| DisplayCommand::PaintPage {
        rect: rect(0.5, 0.0, 20.0, 30.0),
        paint: ReaderPagePaint { background_color },
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
            ground: Ground::Block(DeviceRect::new(57.65625, 10.4, 100.2, 20.2)),
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
    // On a 2× grid the box still rounds on CSS pixels: every edge is the
    // 1× edge doubled, never re-rounded on the finer grid (x 57.65625 is
    // column 116, not the 115 a device round would pick).
    assert_eq!(
        fill_rects(&lowered(vec![at(INK)], 2.0)),
        vec![DeviceRect::new(116.0, 20.0, 200.0, 42.0)]
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
                block_paint(None, Some(top_only(ReaderBorderStyle::Solid))),
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
        ReaderBorderStyle::Groove,
        ReaderBorderStyle::Ridge,
        ReaderBorderStyle::Inset,
        ReaderBorderStyle::Outset,
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
            block_paint(None, Some(top_only(ReaderBorderStyle::Hidden))),
            Some(widths(2.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    );
    assert_eq!(hidden, vec![]);
    let unpainted = lowered(
        vec![block(
            rect(0.0, 0.0, 100.0, 50.0),
            block_paint(None, Some(ReaderBlockBorder::default())),
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
            block_paint(None, Some(top_only(ReaderBorderStyle::Double))),
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
            block_paint(None, Some(top_only(ReaderBorderStyle::Dashed))),
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
            block_paint(None, Some(top_only(ReaderBorderStyle::Dashed))),
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
            block_paint(None, Some(top_only(ReaderBorderStyle::Dotted))),
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
            block_paint(None, Some(top_only(ReaderBorderStyle::Dotted))),
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
            block_paint(None, Some(top_only(ReaderBorderStyle::Dotted))),
            Some(widths(6.0, 0.0, 0.0, 0.0)),
        )],
        1.0,
    );
    let [Primitive::FillPath {
        path, rule, color, ..
    }] = primitives.as_slice()
    else {
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
    let rule = |rect, style| DisplayCommand::PaintHorizontalRule {
        rect,
        paint: ReaderHorizontalRulePaint { color: INK, style },
    };
    // Row = round(top): the band, not the rounded half-shifted centerline
    // that sat one device row below the browser's.
    let horizontal = lowered(
        vec![rule(
            rect(20.3, 100.6, 200.0, 1.0),
            ReaderBorderStyle::Solid,
        )],
        1.0,
    );
    assert_eq!(
        fill_rects(&horizontal),
        vec![DeviceRect::new(20.0, 101.0, 200.0, 1.0)]
    );
    // Taller than wide: the rule box's vertical bevel edge along y.
    let vertical = lowered(
        vec![rule(rect(10.2, 5.0, 2.0, 10.0), ReaderBorderStyle::Solid)],
        1.0,
    );
    assert_eq!(
        fill_rects(&vertical),
        vec![DeviceRect::new(10.0, 5.0, 2.0, 10.0)]
    );
    // The same edge model at 2×: the CSS 0.5px rule is one CSS row at
    // round(100.3), so two device rows from 200 (a device round of the
    // band put it on row 201, one row below the browser's).
    let scaled = lowered(
        vec![rule(
            rect(20.0, 100.3, 200.0, 0.5),
            ReaderBorderStyle::Solid,
        )],
        2.0,
    );
    assert_eq!(
        fill_rects(&scaled),
        vec![DeviceRect::new(40.0, 200.0, 400.0, 2.0)]
    );
}

#[test]
fn rounded_backgrounds_fill_the_snapped_box_and_declare_the_unsnapped_ground() {
    let primitives = lowered(
        vec![block(
            rect(10.4, 20.6, 100.2, 50.3),
            ReaderBlockPaint {
                radius: Some(ReaderBlockRadius::Px(8.0)),
                ..block_paint(Some(INK), None)
            },
            None,
        )],
        1.0,
    );
    let [Primitive::FillPath {
        path,
        rule,
        color,
        ground,
    }] = primitives.as_slice()
    else {
        panic!("one rounded fill, got {primitives:?}");
    };
    assert_eq!(*rule, FillRule::NonZero);
    assert_eq!(*color, INK);
    assert_eq!(
        *ground,
        Ground::Block(DeviceRect::new(10.4, 20.6, 100.2, 50.3))
    );
    // The box snaps to [10, 111) by [21, 71); the outline starts after the
    // top-left corner and turns first about the top-right corner centre.
    assert_eq!(path.ops.len(), 10);
    assert_eq!(path.ops[0], PathOp::MoveTo(DevicePoint::new(18.0, 21.0)));
    assert_eq!(
        path.ops[2],
        PathOp::Arc {
            center: DevicePoint::new(103.0, 29.0),
            rx: 8.0,
            ry: 8.0,
            start: -FRAC_PI_2,
            sweep: FRAC_PI_2,
        }
    );
}

#[test]
fn percent_and_corner_radii_resolve_against_the_box() {
    let percent = lowered(
        vec![block(
            rect(0.0, 0.0, 20.0, 30.0),
            ReaderBlockPaint {
                radius: Some(ReaderBlockRadius::Percent(50.0)),
                ..block_paint(Some(INK), None)
            },
            None,
        )],
        1.0,
    );
    let [Primitive::FillPath { path, .. }] = percent.as_slice() else {
        panic!("{percent:?}");
    };
    assert_eq!(
        path.ops[2],
        PathOp::Arc {
            center: DevicePoint::new(10.0, 15.0),
            rx: 10.0,
            ry: 15.0,
            start: -FRAC_PI_2,
            sweep: FRAC_PI_2,
        }
    );

    // Corners 10/20/30/40 on a 40px box: the bottom edge (30 + 40) is the
    // tightest, so every corner shrinks by 40/70.
    let corners = lowered(
        vec![block(
            rect(0.0, 0.0, 40.0, 40.0),
            ReaderBlockPaint {
                radius: Some(ReaderBlockRadius::Corners([10.0, 20.0, 30.0, 40.0])),
                ..block_paint(Some(INK), None)
            },
            None,
        )],
        1.0,
    );
    let [Primitive::FillPath { path, .. }] = corners.as_slice() else {
        panic!("{corners:?}");
    };
    let PathOp::Arc { rx, ry, .. } = path.ops[2] else {
        panic!("{:?}", path.ops[2]);
    };
    assert!((rx - 20.0 * 40.0 / 70.0).abs() < 1e-9, "{rx}");
    assert_eq!(rx, ry);

    // Corners that are all zero round nothing: a plain snapped fill.
    let square = lowered(
        vec![block(
            rect(0.0, 0.0, 10.0, 20.0),
            ReaderBlockPaint {
                radius: Some(ReaderBlockRadius::Corners([0.0; 4])),
                ..block_paint(Some(INK), None)
            },
            None,
        )],
        1.0,
    );
    assert_eq!(
        fill_rects(&square),
        vec![DeviceRect::new(0.0, 0.0, 10.0, 20.0)]
    );
}

#[test]
fn a_uniform_rounded_border_strokes_one_ring_inset_by_half_its_width() {
    let ring = |style, width: f64| {
        let border = ReaderBlockBorder {
            top: edge(style),
            right: edge(style),
            bottom: edge(style),
            left: edge(style),
        };
        lowered(
            vec![block(
                rect(0.0, 0.0, 100.0, 60.0),
                ReaderBlockPaint {
                    radius: Some(ReaderBlockRadius::Px(10.0)),
                    ..block_paint(None, Some(border))
                },
                Some(widths(width, width, width, width)),
            )],
            1.0,
        )
    };
    let solid = ring(ReaderBorderStyle::Solid, 4.0);
    let [Primitive::StrokePath {
        path,
        width,
        cap,
        dash,
        ..
    }] = solid.as_slice()
    else {
        panic!("{solid:?}");
    };
    assert_eq!((*width, *cap, *dash), (4.0, StrokeCap::Butt, None));
    // Inset 2 with the radius shrunk to 8: the outline starts at (10, 2).
    assert_eq!(path.ops[0], PathOp::MoveTo(DevicePoint::new(10.0, 2.0)));
    assert!(matches!(
        path.ops[2],
        PathOp::Arc {
            rx: 8.0,
            ry: 8.0,
            ..
        }
    ));

    // A double border is two rings of a third each, at insets 1 and 5.
    let double = ring(ReaderBorderStyle::Double, 6.0);
    assert_eq!(double.len(), 2);
    let starts: Vec<_> = double
        .iter()
        .map(|primitive| match primitive {
            Primitive::StrokePath { path, width, .. } => (path.ops[0], *width),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        starts,
        vec![
            (PathOp::MoveTo(DevicePoint::new(10.0, 1.0)), 2.0),
            (PathOp::MoveTo(DevicePoint::new(10.0, 5.0)), 2.0),
        ]
    );

    let dotted = ring(ReaderBorderStyle::Dotted, 4.0);
    let [Primitive::StrokePath {
        width, cap, dash, ..
    }] = dotted.as_slice()
    else {
        panic!("{dotted:?}");
    };
    assert_eq!(
        (*width, *cap, *dash),
        (
            3.0,
            StrokeCap::Round,
            Some(DashPattern {
                on: 0.001,
                off: 6.0
            })
        )
    );
    let dashed = ring(ReaderBorderStyle::Dashed, 4.0);
    let [Primitive::StrokePath { dash, .. }] = dashed.as_slice() else {
        panic!("{dashed:?}");
    };
    assert_eq!(*dash, Some(DashPattern { on: 12.0, off: 8.0 }));
}

#[test]
fn unequal_solid_rounded_edges_of_one_colour_fill_a_crescent() {
    let primitives = lowered(
        vec![block(
            rect(0.0, 0.0, 100.0, 60.0),
            ReaderBlockPaint {
                radius: Some(ReaderBlockRadius::Px(20.0)),
                ..block_paint(None, Some(solid_border()))
            },
            Some(widths(1.0, 4.0, 1.0, 4.0)),
        )],
        1.0,
    );
    let [Primitive::FillPath {
        path, rule, color, ..
    }] = primitives.as_slice()
    else {
        panic!("{primitives:?}");
    };
    assert_eq!((*rule, *color), (FillRule::EvenOdd, INK));
    // Outer outline (10 ops) then the padding outline (10 ops), whose
    // corners inset by the adjacent edges: 20 - 4 across, 20 - 1 down.
    assert_eq!(path.ops.len(), 20);
    assert_eq!(path.ops[10], PathOp::MoveTo(DevicePoint::new(20.0, 1.0)));
    assert!(matches!(
        path.ops[12],
        PathOp::Arc {
            rx: 16.0,
            ry: 19.0,
            ..
        }
    ));
}

/// Straight edges of two colours meet on the miter: an edge painted after
/// a neighbour of another colour is clipped to the quad from its outer
/// corners to the inner corners, while an edge whose neighbour paints
/// later (and fills its band) leaves the corner to that neighbour.
#[test]
fn straight_edges_of_two_colours_meet_on_the_miter() {
    let side = |color| {
        Some(ReaderBorderEdgePaint {
            color,
            style: ReaderBorderStyle::Solid,
        })
    };
    // An inset rule's box: dark top and left, light bottom and right.
    let primitives = lowered(
        vec![block(
            rect(0.0, 0.0, 100.0, 2.0),
            block_paint(
                None,
                Some(ReaderBlockBorder {
                    top: side(INK),
                    right: side(TRANSLUCENT),
                    bottom: side(TRANSLUCENT),
                    left: side(INK),
                }),
            ),
            Some(widths(1.0, 1.0, 1.0, 1.0)),
        )],
        1.0,
    );
    // Top and bottom paint first with square corners (their neighbours
    // paint later); the left edge meets the light bottom on a miter and
    // shares the dark top without one; the right edge meets the dark top
    // on a miter and shares the light bottom. A mitered solid band is
    // its quad, filled.
    assert_eq!(primitives.len(), 4, "{primitives:#?}");
    assert!(matches!(primitives[0], Primitive::FillRect { .. }));
    assert!(matches!(primitives[1], Primitive::FillRect { .. }));
    assert_eq!(
        primitives[2],
        Primitive::FillPath {
            path: DevicePath {
                ops: vec![
                    PathOp::MoveTo(DevicePoint::new(0.0, 0.0)),
                    PathOp::LineTo(DevicePoint::new(1.0, 0.0)),
                    PathOp::LineTo(DevicePoint::new(1.0, 1.0)),
                    PathOp::LineTo(DevicePoint::new(0.0, 2.0)),
                    PathOp::Close,
                ],
            },
            rule: FillRule::NonZero,
            color: INK,
            ground: Ground::None,
        }
    );
    assert_eq!(
        primitives[3],
        Primitive::FillPath {
            path: DevicePath {
                ops: vec![
                    PathOp::MoveTo(DevicePoint::new(100.0, 0.0)),
                    PathOp::LineTo(DevicePoint::new(99.0, 1.0)),
                    PathOp::LineTo(DevicePoint::new(99.0, 2.0)),
                    PathOp::LineTo(DevicePoint::new(100.0, 2.0)),
                    PathOp::Close,
                ],
            },
            rule: FillRule::NonZero,
            color: TRANSLUCENT,
            ground: Ground::None,
        }
    );
}

#[test]
fn disagreeing_rounded_edges_each_paint_inside_their_wedge() {
    let side = |color| {
        Some(ReaderBorderEdgePaint {
            color,
            style: ReaderBorderStyle::Solid,
        })
    };
    let primitives = lowered(
        vec![block(
            rect(0.0, 0.0, 100.0, 60.0),
            ReaderBlockPaint {
                radius: Some(ReaderBlockRadius::Px(10.0)),
                ..block_paint(
                    None,
                    Some(ReaderBlockBorder {
                        top: side(INK),
                        right: side(TRANSLUCENT),
                        bottom: side(TRANSLUCENT),
                        left: side(TRANSLUCENT),
                    }),
                )
            },
            Some(widths(3.0, 1.0, 1.0, 1.0)),
        )],
        1.0,
    );
    assert_eq!(primitives.len(), 16);
    assert_eq!(primitives[0], Primitive::PushState);
    assert_eq!(
        primitives[1],
        Primitive::ClipPath {
            path: DevicePath {
                ops: vec![
                    PathOp::MoveTo(DevicePoint::new(50.0, 30.0)),
                    PathOp::LineTo(DevicePoint::new(0.0, 0.0)),
                    PathOp::LineTo(DevicePoint::new(100.0, 0.0)),
                    PathOp::Close,
                ],
            },
        }
    );
    let Primitive::FillPath {
        path, rule, color, ..
    } = &primitives[2]
    else {
        panic!("{:?}", primitives[2]);
    };
    assert_eq!((*rule, *color), (FillRule::EvenOdd, INK));
    // The padding outline sits inside the widest edge with the radius
    // shrunk by it: (1, 3) with radius 7.
    assert_eq!(path.ops.len(), 20);
    assert_eq!(path.ops[10], PathOp::MoveTo(DevicePoint::new(8.0, 3.0)));
    assert!(matches!(
        path.ops[12],
        PathOp::Arc {
            rx: 7.0,
            ry: 7.0,
            ..
        }
    ));
    assert_eq!(primitives[3], Primitive::PopState);
}

#[test]
fn box_shadows_blur_the_spread_box_outside_the_box_back_to_front() {
    let shadow = |offset_x, spread, inset| ReaderBoxShadow {
        offset_x,
        offset_y: 3.0,
        blur: 4.0,
        spread,
        color: TRANSLUCENT,
        inset,
    };
    let primitives = lowered(
        vec![block(
            rect(10.0, 10.0, 50.0, 40.0),
            ReaderBlockPaint {
                box_shadows: vec![
                    shadow(2.0, 1.0, false),
                    shadow(9.0, 0.0, true),
                    shadow(5.0, 0.0, false),
                ],
                ..block_paint(None, None)
            },
            None,
        )],
        1.0,
    );
    // Back to front, the inset shadow not painted.
    assert_eq!(primitives.len(), 2);
    let Primitive::Shadow {
        shape,
        sigma,
        offset,
        clip_out,
        ..
    } = &primitives[1]
    else {
        panic!("{:?}", primitives[1]);
    };
    assert_eq!((*sigma, *offset), (2.0, DevicePoint::new(2.0, 3.0)));
    // A spread of 1 rounds the expanded box by 1; the box interior is cut out.
    assert_eq!(shape.ops[0], PathOp::MoveTo(DevicePoint::new(10.0, 9.0)));
    assert_eq!(
        clip_out.as_ref().map(|path| path.ops.clone()),
        Some(vec![PathOp::Rect(DeviceRect::new(10.0, 10.0, 50.0, 40.0))])
    );
    let Primitive::Shadow { offset, shape, .. } = &primitives[0] else {
        panic!("{:?}", primitives[0]);
    };
    assert_eq!(*offset, DevicePoint::new(5.0, 3.0));
    assert_eq!(
        shape.ops,
        vec![PathOp::Rect(DeviceRect::new(10.0, 10.0, 50.0, 40.0))]
    );

    // On a 2x grid sigma, offset and spread all scale.
    let scaled = lowered(
        vec![block(
            rect(10.0, 10.0, 50.0, 40.0),
            ReaderBlockPaint {
                box_shadows: vec![shadow(2.0, 1.0, false)],
                ..block_paint(None, None)
            },
            None,
        )],
        2.0,
    );
    let [Primitive::Shadow {
        sigma,
        offset,
        shape,
        ..
    }] = scaled.as_slice()
    else {
        panic!("{scaled:?}");
    };
    assert_eq!((*sigma, *offset), (4.0, DevicePoint::new(4.0, 6.0)));
    assert_eq!(shape.ops[0], PathOp::MoveTo(DevicePoint::new(20.0, 18.0)));
}

#[test]
fn background_images_size_place_clip_and_tile_against_the_unsnapped_box() {
    let paper = |size, repeat, position| ReaderBackgroundPaint {
        color: None,
        image: Some("paper.png".to_owned()),
        size,
        repeat,
        position,
    };
    let imaged = |rect, background, ratio| {
        lowered_with(
            vec![block(
                rect,
                ReaderBlockPaint {
                    background: Some(background),
                    ..block_paint(None, None)
                },
                None,
            )],
            ratio,
            &sixteen_square,
        )
    };

    // cover scales to the larger ratio and centres; no-repeat draws once.
    let cover = imaged(
        rect(100.0, 50.0, 40.0, 20.0),
        paper(
            Some(ReaderBackgroundSize::Cover),
            Some(ReaderBackgroundRepeat::NoRepeat),
            None,
        ),
        1.0,
    );
    assert_eq!(
        cover,
        vec![
            Primitive::PushState,
            Primitive::ClipPath {
                path: DevicePath {
                    ops: vec![PathOp::Rect(DeviceRect::new(100.0, 50.0, 40.0, 20.0))],
                },
            },
            Primitive::DrawImage {
                src: "paper.png".to_owned(),
                dest: DeviceRect::new(100.0, 40.0, 40.0, 40.0),
                source_rect: None,
                tiles: None,
            },
            Primitive::PopState,
        ]
    );

    // The default (auto size, repeat, origin) tiles from the box origin.
    let tiled = imaged(rect(100.0, 50.0, 40.0, 20.0), paper(None, None, None), 1.0);
    assert_eq!(
        tiled[2],
        Primitive::DrawImage {
            src: "paper.png".to_owned(),
            dest: DeviceRect::new(100.0, 50.0, 16.0, 16.0),
            source_rect: None,
            tiles: Some(TilePlan {
                origin: DevicePoint::new(100.0, 50.0),
                step_x: 16.0,
                step_y: 16.0,
                columns: 3,
                rows: 2,
            }),
        }
    );

    // An explicit width derives the height from the intrinsic ratio; a
    // pixel position scales, a percentage resolves against the free space.
    let explicit = imaged(
        rect(0.0, 0.0, 40.0, 20.0),
        paper(
            Some(ReaderBackgroundSize::Explicit {
                x: Some(ReaderLength::Px(10.0)),
                y: None,
            }),
            Some(ReaderBackgroundRepeat::NoRepeat),
            Some(ReaderBackgroundPosition {
                x: ReaderLength::Percent(50.0),
                y: ReaderLength::Px(4.0),
            }),
        ),
        2.0,
    );
    assert_eq!(
        explicit[2],
        Primitive::DrawImage {
            src: "paper.png".to_owned(),
            dest: DeviceRect::new(30.0, 8.0, 20.0, 20.0),
            source_rect: None,
            tiles: None,
        }
    );

    // The clip follows the box outline, unsnapped.
    let rounded = imaged(
        rect(0.5, 0.0, 40.0, 20.0),
        ReaderBackgroundPaint {
            color: Some(INK),
            ..paper(None, Some(ReaderBackgroundRepeat::NoRepeat), None)
        },
        1.0,
    );
    assert!(matches!(rounded[0], Primitive::FillRect { .. }));
    assert_eq!(
        rounded[2],
        Primitive::ClipPath {
            path: DevicePath {
                ops: vec![PathOp::Rect(DeviceRect::new(0.5, 0.0, 40.0, 20.0))],
            },
        }
    );

    // An image the engine cannot size is not painted; the colour still is.
    let unknown = lowered(
        vec![block(
            rect(0.0, 0.0, 40.0, 20.0),
            ReaderBlockPaint {
                background: Some(ReaderBackgroundPaint {
                    color: Some(INK),
                    ..paper(None, None, None)
                }),
                ..block_paint(None, None)
            },
            None,
        )],
        1.0,
    );
    assert_eq!(
        fill_rects(&unknown),
        vec![DeviceRect::new(0.0, 0.0, 40.0, 20.0)]
    );
}

#[test]
fn a_text_run_lowers_to_its_inline_box_the_run_and_its_decoration_line() {
    // The band and the border edges paint before the run, the decoration
    // line after it; the run itself carries only glyph paint.
    let primitives = lowered(vec![DisplayCommand::PaintText(text())], 1.0);
    let kinds: Vec<&str> = primitives
        .iter()
        .map(|primitive| match primitive {
            Primitive::PushState => "push",
            Primitive::PopState => "pop",
            Primitive::ClipPath { .. } => "clip",
            Primitive::FillRect { .. } => "fill-rect",
            Primitive::FillPath { .. } => "fill-path",
            Primitive::Text(_) => "text",
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        kinds,
        vec![
            "fill-path",
            "push",
            "clip",
            "fill-path",
            "pop",
            "text",
            "fill-rect"
        ]
    );
    // The translucent band declares no ground and rounds only its
    // closed start corners: box (5.5 − 4, 2 − 2) to (5.5 + 10 + 2, 2 + 22)
    // snaps to (2, 0, 16, 24).
    let Primitive::FillPath {
        path,
        color,
        ground,
        ..
    } = &primitives[0]
    else {
        unreachable!()
    };
    assert_eq!((*color, *ground), (TRANSLUCENT, Ground::None));
    assert_eq!(
        *path,
        corner_rounded_rect(DeviceRect::new(2.0, 0.0, 16.0, 24.0), [2.0, 0.0, 0.0, 2.0])
    );
    assert_eq!(primitives[5], Primitive::Text(text_run()));
    // The underline: centre 18 below the run top with thickness 1 is the
    // row from 19.5, rounded to 20.
    assert_eq!(
        primitives[6],
        Primitive::FillRect {
            rect: DeviceRect::new(5.5, 20.0, 10.0, 1.0),
            color: INK,
            ground: Ground::None,
        }
    );
}

#[test]
fn a_bare_text_run_passes_through_in_css_pixels_at_any_ratio() {
    // The renderer draws a run under scale(ratio): synthetic bold widens
    // with the CSS size it is asked for, so the device size on the device
    // grid rasters different ink than the browser's.
    let bare = DisplayTextCommand {
        paint: RunPaint::new(ReaderRunPaint {
            background_color: None,
            background_radius: None,
            decoration: None,
            padding: None,
            border: None,
            box_offsets: None,
            ..(*text().paint).clone()
        }),
        ..text()
    };
    for ratio in [1.0, 2.0] {
        let primitives = lowered(
            vec![
                DisplayCommand::PaintText(bare.clone()),
                DisplayCommand::PaintRuby(text()),
            ],
            ratio,
        );
        assert_eq!(
            primitives,
            vec![Primitive::Text(text_run()), Primitive::Ruby(text_run())],
            "{ratio}"
        );
    }
}

#[test]
fn a_background_band_snaps_each_edge_and_declares_the_ground() {
    let band = |box_offsets, padding| {
        DisplayCommand::PaintText(DisplayTextCommand {
            rect: rect(10.4, 20.0, 50.2, 16.0),
            paint: RunPaint::new(ReaderRunPaint {
                background_color: Some(INK),
                background_radius: None,
                decoration: None,
                padding,
                border: None,
                box_offsets,
                ..(*text().paint).clone()
            }),
            ..text()
        })
    };
    // The engine's extent rides the paint: the band spans it, unsnapped
    // as the ground and snapped edge by edge as the fill.
    let primitives = lowered(vec![band(Some((-3.25, 16.5)), None)], 1.0);
    assert_eq!(
        primitives[0],
        Primitive::FillRect {
            rect: DeviceRect::new(10.0, 17.0, 51.0, 20.0),
            color: INK,
            ground: Ground::Block(DeviceRect::new(10.4, 16.75, 50.2, 19.75)),
        }
    );
    assert!(matches!(primitives[1], Primitive::Text(_)));
    // A band shallower than the run's em box still declares a ground the
    // run sits inside: the ground grows to the run rect.
    let primitives = lowered(vec![band(Some((-1.0, 15.5)), None)], 1.0);
    assert_eq!(
        primitives[0],
        Primitive::FillRect {
            rect: DeviceRect::new(10.0, 19.0, 51.0, 17.0),
            color: INK,
            ground: Ground::Block(DeviceRect::new(10.4, 19.0, 50.2, 17.0)),
        }
    );
    // Without an extent the em box stands in, grown by the padding.
    let primitives = lowered(
        vec![band(
            None,
            Some(ReaderSpacing {
                top: 2.0,
                right: 0.0,
                bottom: 3.0,
                left: 0.0,
            }),
        )],
        1.0,
    );
    assert_eq!(
        primitives[0],
        Primitive::FillRect {
            rect: DeviceRect::new(10.0, 18.0, 51.0, 21.0),
            color: INK,
            ground: Ground::Block(DeviceRect::new(10.4, 18.0, 50.2, 21.0)),
        }
    );
}

#[test]
fn a_split_inline_box_squares_its_open_end() {
    let primitives = lowered(
        vec![DisplayCommand::PaintText(DisplayTextCommand {
            rect: rect(10.0, 20.0, 40.0, 16.0),
            paint: RunPaint::new(ReaderRunPaint {
                background_color: Some(INK),
                background_radius: Some(3.0),
                decoration: None,
                padding: None,
                border: None,
                box_offsets: Some((0.0, 16.0)),
                box_start: false,
                box_end: true,
                ..(*text().paint).clone()
            }),
            ..text()
        })],
        1.0,
    );
    assert_eq!(
        primitives[0],
        Primitive::FillPath {
            path: corner_rounded_rect(
                DeviceRect::new(10.0, 20.0, 40.0, 16.0),
                [0.0, 3.0, 3.0, 0.0]
            ),
            rule: FillRule::NonZero,
            color: INK,
            ground: Ground::Block(DeviceRect::new(10.0, 20.0, 40.0, 16.0)),
        }
    );
}

#[test]
fn the_decoration_line_rounds_its_top_and_floors_its_thickness() {
    let primitives = lowered(
        vec![DisplayCommand::PaintText(DisplayTextCommand {
            rect: rect(10.0, 20.3, 40.0, 16.0),
            paint: RunPaint::new(ReaderRunPaint {
                background_color: None,
                background_radius: None,
                decoration: Some(ReaderRunDecoration {
                    kind: ReaderRunDecorationKind::Underline,
                    y: 17.125,
                    thickness: 1.4,
                    color: INK,
                }),
                padding: None,
                border: None,
                box_offsets: None,
                ..(*text().paint).clone()
            }),
            ..text()
        })],
        1.0,
    );
    assert_eq!(
        primitives[1],
        Primitive::FillRect {
            rect: DeviceRect::new(10.0, 37.0, 40.0, 1.0),
            color: INK,
            ground: Ground::None,
        }
    );
}

#[test]
fn one_inline_box_draws_one_decoration_line_across_its_runs() {
    // A link's text shaped into three runs (Latin, an ideographic space,
    // CJK) underlines as one rect: the browser draws no seam where the
    // fonts change, and two fills abutting at a fractional x would.
    let run = |x: f64, width: f64, start: bool, end: bool| {
        DisplayCommand::PaintText(DisplayTextCommand {
            rect: rect(x, 20.3, width, 16.0),
            paint: RunPaint::new(ReaderRunPaint {
                background_color: None,
                background_radius: None,
                decoration: Some(ReaderRunDecoration {
                    kind: ReaderRunDecorationKind::Underline,
                    y: 14.3,
                    thickness: 1.0,
                    color: INK,
                }),
                padding: None,
                border: None,
                box_offsets: None,
                box_start: start,
                box_end: end,
                ..(*text().paint).clone()
            }),
            ..text()
        })
    };
    let primitives = lowered(
        vec![
            run(10.25, 30.5, true, false),
            run(40.75, 16.0, false, false),
            run(56.75, 48.0, false, true),
        ],
        1.0,
    );
    let lines = |primitives: &[Primitive]| -> Vec<DeviceRect> {
        primitives
            .iter()
            .filter_map(|primitive| match primitive {
                Primitive::FillRect { rect, .. } => Some(*rect),
                _ => None,
            })
            .collect()
    };
    assert_eq!(
        lines(&primitives),
        vec![DeviceRect::new(10.25, 34.0, 94.5, 1.0)]
    );
    assert_eq!(
        primitives
            .iter()
            .filter(|primitive| matches!(primitive, Primitive::Text(_)))
            .count(),
        3
    );
    // A run opening a new box, or one whose line does not abut, draws
    // its own line.
    let separate = lowered(
        vec![run(10.25, 30.5, true, true), run(40.75, 16.0, true, true)],
        1.0,
    );
    assert_eq!(lines(&separate).len(), 2);
    let gapped = lowered(
        vec![run(10.25, 30.5, true, false), run(41.0, 16.0, false, true)],
        1.0,
    );
    assert_eq!(lines(&gapped).len(), 2);
}

#[test]
fn images_draw_at_the_scaled_destination_with_the_source_rect_untouched() {
    let primitives = lowered(
        vec![DisplayCommand::PaintImage {
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
fn page_fills_scale_to_the_device_grid() {
    let commands = [DisplayCommand::PaintPage {
        rect: rect(0.0, 0.0, 20.0, 30.0),
        paint: ReaderPagePaint {
            background_color: Some(INK),
        },
    }];
    let list = lower(&commands, 2.0, &no_images).expect("lower");
    assert_eq!(list.ratio, 2.0);
    let [Primitive::FillRect { rect, ground, .. }] = list.commands.as_slice() else {
        panic!("page fill, got {:?}", list.commands);
    };
    assert_eq!(*rect, DeviceRect::new(0.0, 0.0, 40.0, 60.0));
    assert_eq!(*ground, Ground::Page);
}

#[test]
fn json_form_mirrors_the_decoded_wire_shape() {
    let list = lower(
        &[
            DisplayCommand::ClipRect {
                rect: rect(0.0, 0.0, 20.0, 30.0),
                radius: None,
            },
            block(
                rect(0.0, 0.0, 10.0, 20.0),
                block_paint(Some(INK), None),
                None,
            ),
            // A bare run: the inline box and decoration lower to
            // their own primitives, covered by their own tests.
            DisplayCommand::PaintText(DisplayTextCommand {
                paint: RunPaint::new(ReaderRunPaint {
                    background_color: None,
                    background_radius: None,
                    decoration: None,
                    padding: None,
                    border: None,
                    box_offsets: None,
                    ..(*text().paint).clone()
                }),
                ..text()
            }),
        ],
        1.0,
        &no_images,
    )
    .expect("lower");
    let ink = json!({
        "space": "srgb",
        "component0": f64::from(0.1_f32),
        "component1": f64::from(0.2_f32),
        "component2": f64::from(0.3_f32),
        "alpha": 1.0,
        "none": { "component0": false, "component1": false, "component2": false, "alpha": false },
    });
    assert_eq!(
        primitive_list_value(&list),
        json!({
            "formatVersion": 2,
            "ratio": 1.0,
            "commandCount": 3,
            "commands": [
                {
                    "kind": "clip-path",
                    "path": [{ "op": "rect", "x": 0.0, "y": 0.0, "width": 20.0, "height": 30.0 }],
                },
                {
                    "kind": "fill-rect",
                    "rect": { "x": 0.0, "y": 0.0, "width": 10.0, "height": 20.0 },
                    "color": ink,
                    "ground": "block",
                    "groundRect": { "x": 0.0, "y": 0.0, "width": 10.0, "height": 20.0 },
                },
                {
                    "kind": "text",
                    "text": "run",
                    "rect": { "x": 5.5, "y": 2.0, "width": 10.0, "height": 20.0 },
                    "paint": {
                        "font": { "family": "Rito Serif", "sizePx": 16.0, "weight": 400.0, "style": "italic" },
                        "color": ink,
                        "textShadows": [{ "offsetX": 1.0, "offsetY": 2.0, "blur": 3.0, "color": ink }],
                    },
                    "lineHeightPx": 24.0,
                    "href": "#note",
                    "sourceText": "source",
                    "sourceTextOffset": 9,
                },
            ],
        })
    );
}

#[test]
fn lowering_sources_are_typed_only() {
    let sources = concat!(
        include_str!("../../lower.rs"),
        include_str!("../primitive.rs"),
        include_str!("../path.rs"),
        include_str!("../border.rs"),
        include_str!("../block.rs"),
        include_str!("../scale.rs"),
        include_str!("../text.rs"),
    );
    assert!(!sources.contains("serde_json"));
    assert!(!sources.contains("Value::"));
}

fn lowered(commands: Vec<DisplayCommand>, ratio: f64) -> Vec<Primitive> {
    lowered_with(commands, ratio, &no_images)
}

fn lowered_with(
    commands: Vec<DisplayCommand>,
    ratio: f64,
    images: &dyn Fn(&str) -> Option<ImageSize>,
) -> Vec<Primitive> {
    lower(&commands, ratio, images).expect("lower").commands
}

fn no_images(_: &str) -> Option<ImageSize> {
    None
}

fn sixteen_square(href: &str) -> Option<ImageSize> {
    (href == "paper.png").then_some(ImageSize {
        width: 16,
        height: 16,
    })
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

fn rect(x: f64, y: f64, width: f64, height: f64) -> ReaderRect {
    ReaderRect {
        x,
        y,
        width,
        height,
    }
}

fn widths(top: f64, right: f64, bottom: f64, left: f64) -> ReaderBorderBox {
    ReaderBorderBox {
        top_width: top,
        right_width: right,
        bottom_width: bottom,
        left_width: left,
    }
}

fn edge(style: ReaderBorderStyle) -> Option<ReaderBorderEdgePaint> {
    Some(ReaderBorderEdgePaint { color: INK, style })
}

fn solid_border() -> ReaderBlockBorder {
    ReaderBlockBorder {
        top: edge(ReaderBorderStyle::Solid),
        right: edge(ReaderBorderStyle::Solid),
        bottom: edge(ReaderBorderStyle::Solid),
        left: edge(ReaderBorderStyle::Solid),
    }
}

fn top_only(style: ReaderBorderStyle) -> ReaderBlockBorder {
    ReaderBlockBorder {
        top: edge(style),
        ..ReaderBlockBorder::default()
    }
}

fn block_paint(
    background: Option<ReaderColor>,
    border: Option<ReaderBlockBorder>,
) -> ReaderBlockPaint {
    ReaderBlockPaint {
        background: background.map(|color| ReaderBackgroundPaint {
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
    rect: ReaderRect,
    paint: ReaderBlockPaint,
    border_box: Option<ReaderBorderBox>,
) -> DisplayCommand {
    DisplayCommand::PaintBlock {
        rect,
        paint,
        border_box,
    }
}

/// `text()` as the wire carries it: glyph paint only.
fn text_run() -> ReaderTextRun {
    let text = text();
    ReaderTextRun {
        text: text.text,
        rect: text.rect,
        paint: ReaderTextRunPaint {
            font: text.paint.font.clone(),
            color: text.paint.color,
            text_shadows: text.paint.text_shadows.clone(),
        },
        line_height_px: text.line_height_px,
        href: text.href,
        source_text: text.source_text,
        source_text_offset: text.source_text_offset,
        clusters: text
            .clusters
            .iter()
            .map(|&(byte, x, y)| ReaderCluster { byte, x, y })
            .collect(),
    }
}

fn text() -> DisplayTextCommand {
    DisplayTextCommand {
        text: "run".to_owned(),
        rect: rect(5.5, 2.0, 10.0, 20.0),
        paint: RunPaint::new(ReaderRunPaint {
            font: ReaderFontPaint {
                family: "Rito Serif".to_owned(),
                size_px: 16.0,
                weight: 400.0,
                style: ReaderFontStyle::Italic,
            },
            color: INK,
            word_spacing_px: Some(1.0),
            letter_spacing_px: Some(0.5),
            background_color: Some(TRANSLUCENT),
            background_radius: Some(2.0),
            text_shadows: vec![ReaderTextShadow {
                offset_x: 1.0,
                offset_y: 2.0,
                blur: 3.0,
                color: INK,
            }],
            decoration: Some(ReaderRunDecoration {
                kind: ReaderRunDecorationKind::Underline,
                y: 18.0,
                thickness: 1.0,
                color: INK,
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
                        color: INK,
                        style: ReaderBorderStyle::Solid,
                    },
                }),
                bottom: None,
                start: None,
                end: None,
            }),
            box_offsets: Some((-2.0, 22.0)),
            box_start: true,
            box_end: false,
        }),
        line_height_px: Some(24.0),
        href: Some("#note".to_owned()),
        source_text: Some("source".to_owned()),
        source_text_offset: Some(9),
        clusters: vec![],
    }
}
