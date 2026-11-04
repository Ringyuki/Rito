//! A lowered list moved by whole device pixels: positions move,
//! displacements and sizes stay, text runs move in CSS pixels.

use std::f64::consts::FRAC_PI_2;

use super::super::{shift, IconPiece, ImageFallbackState, PrimitiveList};
use super::*;

#[test]
fn every_position_moves_and_every_displacement_stays() {
    let path = || DevicePath {
        ops: vec![
            PathOp::MoveTo(DevicePoint::new(1.0, 2.0)),
            PathOp::LineTo(DevicePoint::new(3.0, 4.0)),
            PathOp::Arc {
                center: DevicePoint::new(5.0, 6.0),
                rx: 7.0,
                ry: 8.0,
                start: 0.0,
                sweep: FRAC_PI_2,
            },
            PathOp::Ellipse {
                center: DevicePoint::new(9.0, 10.0),
                rx: 11.0,
                ry: 12.0,
            },
            PathOp::Rect(DeviceRect::new(13.0, 14.0, 15.0, 16.0)),
            PathOp::Close,
        ],
    };
    let moved_path = || DevicePath {
        ops: vec![
            PathOp::MoveTo(DevicePoint::new(-1.0, -38.0)),
            PathOp::LineTo(DevicePoint::new(1.0, -36.0)),
            PathOp::Arc {
                center: DevicePoint::new(3.0, -34.0),
                rx: 7.0,
                ry: 8.0,
                start: 0.0,
                sweep: FRAC_PI_2,
            },
            PathOp::Ellipse {
                center: DevicePoint::new(7.0, -30.0),
                rx: 11.0,
                ry: 12.0,
            },
            PathOp::Rect(DeviceRect::new(11.0, -26.0, 15.0, 16.0)),
            PathOp::Close,
        ],
    };
    let piece = |path| IconPiece {
        offset: DevicePoint::new(-1.1, 0.8),
        clip: Some(path),
        path: DevicePath { ops: vec![] },
    };
    let run = text_run();
    let mut list = PrimitiveList {
        ratio: 2.0,
        commands: vec![
            Primitive::Translate { dx: 3.0, dy: 4.0 },
            Primitive::Transform {
                origin: DevicePoint::new(10.0, 20.0),
                transforms: vec![DeviceTransform::Translate { dx: 1.0, dy: 2.0 }],
            },
            Primitive::ClipPath { path: path() },
            Primitive::FillRect {
                rect: DeviceRect::new(1.0, 2.0, 3.0, 4.0),
                color: INK,
                ground: Ground::Block(DeviceRect::new(5.0, 6.0, 7.0, 8.0)),
            },
            Primitive::StrokePath {
                path: path(),
                width: 2.0,
                color: INK,
                cap: StrokeCap::Butt,
                dash: Some(DashPattern { on: 3.0, off: 1.0 }),
            },
            Primitive::Shadow {
                shape: path(),
                sigma: 2.0,
                offset: DevicePoint::new(4.0, 5.0),
                color: INK,
                clip_out: Some(path()),
            },
            Primitive::DrawImage {
                src: "paper.png".to_owned(),
                dest: DeviceRect::new(1.0, 2.0, 3.0, 4.0),
                source_rect: Some(rect(0.0, 1.0, 2.0, 3.0)),
                tiles: Some(TilePlan {
                    origin: DevicePoint::new(5.0, 6.0),
                    step_x: 7.0,
                    step_y: 8.0,
                    columns: 2,
                    rows: 3,
                }),
            },
            Primitive::ImageFallback {
                src: "paper.png".to_owned(),
                state: ImageFallbackState::Loading,
                block: DeviceRect::new(1.0, 2.0, 3.0, 4.0),
                block_ink: 0.1,
                icon_ink: 0.2,
                pieces: vec![piece(path())],
            },
            Primitive::Text(run.clone()),
        ],
    };
    shift(&mut list, -2.0, -40.0);

    let mut moved_run = run.clone();
    moved_run.rect.x -= 1.0;
    moved_run.rect.y -= 20.0;
    moved_run.clusters = run
        .clusters
        .iter()
        .map(|cluster| ReaderCluster {
            x: cluster.x - 1.0,
            y: cluster.y - 20.0,
            ..*cluster
        })
        .collect();
    assert_eq!(
        list.commands,
        vec![
            Primitive::Translate { dx: 3.0, dy: 4.0 },
            Primitive::Transform {
                origin: DevicePoint::new(8.0, -20.0),
                transforms: vec![DeviceTransform::Translate { dx: 1.0, dy: 2.0 }],
            },
            Primitive::ClipPath { path: moved_path() },
            Primitive::FillRect {
                rect: DeviceRect::new(-1.0, -38.0, 3.0, 4.0),
                color: INK,
                ground: Ground::Block(DeviceRect::new(3.0, -34.0, 7.0, 8.0)),
            },
            Primitive::StrokePath {
                path: moved_path(),
                width: 2.0,
                color: INK,
                cap: StrokeCap::Butt,
                dash: Some(DashPattern { on: 3.0, off: 1.0 }),
            },
            Primitive::Shadow {
                shape: moved_path(),
                sigma: 2.0,
                offset: DevicePoint::new(4.0, 5.0),
                color: INK,
                clip_out: Some(moved_path()),
            },
            Primitive::DrawImage {
                src: "paper.png".to_owned(),
                dest: DeviceRect::new(-1.0, -38.0, 3.0, 4.0),
                source_rect: Some(rect(0.0, 1.0, 2.0, 3.0)),
                tiles: Some(TilePlan {
                    origin: DevicePoint::new(3.0, -34.0),
                    step_x: 7.0,
                    step_y: 8.0,
                    columns: 2,
                    rows: 3,
                }),
            },
            Primitive::ImageFallback {
                src: "paper.png".to_owned(),
                state: ImageFallbackState::Loading,
                block: DeviceRect::new(-1.0, -38.0, 3.0, 4.0),
                block_ink: 0.1,
                icon_ink: 0.2,
                pieces: vec![piece(moved_path())],
            },
            Primitive::Text(moved_run),
        ]
    );
}

/// Moved by a whole number of CSS pixels within positive coordinates, a
/// list lowers to what the same commands lower to drawn there: every edge,
/// band and baseline rounds the same on either side of the move. (Into
/// negative coordinates a half rounds the other way — `f64::round` takes
/// it away from zero — which is why a window lowers in its chapter's
/// coordinates and moves after.)
#[test]
fn a_list_moved_by_whole_css_pixels_is_the_list_lowered_there() {
    let commands = |dy: f64| {
        let mut run = text();
        run.rect.y += dy;
        run.clusters = run
            .clusters
            .iter()
            .map(|cluster| crate::render::TextCluster {
                y: cluster.y + dy,
                ..*cluster
            })
            .collect();
        vec![
            DisplayCommand::PushState,
            DisplayCommand::ClipRect {
                rect: rect(2.0, 3.3 + dy, 200.0, 300.0),
                radius: None,
            },
            block(
                rect(10.3, 40.6 + dy, 120.4, 30.7),
                ReaderBlockPaint {
                    box_shadows: vec![ReaderBoxShadow {
                        offset_x: 5.0,
                        offset_y: 5.0,
                        blur: 5.0,
                        spread: 3.0,
                        color: TRANSLUCENT,
                        inset: false,
                    }],
                    radius: Some(ReaderBlockRadius::Px(4.0)),
                    ..block_paint(Some(INK), Some(solid_border()))
                },
                Some(widths(1.0, 2.0, 1.5, 0.5)),
            ),
            block(
                rect(10.0, 90.25 + dy, 40.0, 20.0),
                ReaderBlockPaint {
                    background: Some(ReaderBackgroundPaint {
                        color: None,
                        image: Some("paper.png".to_owned()),
                        size: None,
                        repeat: None,
                        position: None,
                    }),
                    ..block_paint(None, None)
                },
                None,
            ),
            DisplayCommand::PaintText(run),
            DisplayCommand::PaintImage {
                src: "images/plate.png".to_owned(),
                rect: rect(1.5, 120.0 + dy, 10.0, 20.0),
                alt: None,
                href: None,
                source_rect: None,
            },
            DisplayCommand::PopState,
        ]
    };
    for ratio in [1.0, 2.0, 3.0] {
        let mut moved = lower(&commands(100.0), ratio, &sixteen_square).expect("lower");
        shift(&mut moved, 0.0, -20.0 * ratio);
        let there = lower(&commands(80.0), ratio, &sixteen_square).expect("lower");
        assert_eq!(moved, there, "ratio {ratio}");
    }
}
