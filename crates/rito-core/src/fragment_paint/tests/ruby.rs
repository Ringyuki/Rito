//! Ruby annotations painted over their base run.

use super::*;

#[test]
fn ruby_bases_paint_their_annotation_above_the_run() {
    let fixture = two_color_flow(|red, _| {
        vec![InlineItem::Text {
            text: "漢字".to_owned(),
            style: red,
            baseline_shift_px: 0.0,
            ruby_annotation: Some(rito_fragment::RubyAnnotation {
                text: "かんじ".to_owned(),
                size_ratio: 0.5,
                align: rito_style_contract::RubyAlign::SpaceAround,
            }),
        }]
    });
    let root = boxed_line(vec![text_run(0.0, 32.0, 0, 6)]);
    // Shaped when the chapter was built: three 8px kana, packed, the
    // annotation line measured 16px over the base's baseline.
    let mut ruby_runs = BTreeMap::new();
    ruby_runs.insert(
        (0, 0),
        rito_inline::MeasuredRuby {
            run: rito_inline::MeasuredRun {
                advance: 24.0,
                clusters: vec![
                    rito_fragment::ClusterPosition { byte: 0, x: 0.0 },
                    rito_fragment::ClusterPosition { byte: 3, x: 8.0 },
                    rito_fragment::ClusterPosition { byte: 6, x: 16.0 },
                ],
                grid: false,
            },
            over_offset: 16.0,
            em_ascent: 7.046875,
        },
    );
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &fixture.tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            ruby_annotation_runs: Some(&ruby_runs),
            ..FragmentPaintContext::default()
        },
    )
    .expect("fragments paint");
    assert_eq!(commands.len(), 2);
    let DisplayCommand::PaintRuby(annotation) = &commands[0] else {
        panic!("annotation paints before its base, got {:?}", commands[0]);
    };
    assert_eq!(annotation.text, "かんじ");
    // space-around over the 32px base: 8px of slack, two
    // opportunities — an inset of slack/3 on the layout grid, half at
    // each edge, the rest in the two gaps.
    let origins: Vec<f64> = annotation.clusters.iter().map(|(_, x, _)| *x).collect();
    assert!(
        annotation.clusters.iter().all(|(_, _, y)| *y == 23.0),
        "every origin sits on the annotation's baseline, 16px over the base's (39)"
    );
    assert_eq!(
        annotation
            .clusters
            .iter()
            .map(|(byte, _, _)| *byte)
            .collect::<Vec<_>>(),
        vec![0, 3, 6]
    );
    let inset = (8.0_f64 / 3.0 * 64.0).trunc() / 64.0;
    let edge = (inset / 2.0 * 64.0).trunc() / 64.0;
    let gap = (8.0 - inset) / 2.0;
    for (origin, expected) in origins.iter().zip([
        14.0 + edge,
        14.0 + edge + 8.0 + gap,
        14.0 + edge + 16.0 + 2.0 * gap,
    ]) {
        assert!((origin - expected).abs() < 1e-9, "{origins:?}");
    }
    // The base anchors at 26.2 (line top 26 + baseline 13 − 0.8 × 16);
    // the 8px annotation's rect starts 0.8 em above its baseline and
    // spans the base run's extent.
    assert_eq!(annotation.rect, display_rect(14.0, 16.6, 32.0, 8.0));
    assert_eq!(annotation.paint.font.size_px, 8.0);
    assert_eq!(annotation.paint.color, css_color("#ff0000"));
    let DisplayCommand::PaintText(base) = &commands[1] else {
        panic!("expected the base text command, got {:?}", commands[1]);
    };
    assert_eq!(base.text, "漢字");
    assert_eq!(base.rect, display_rect(14.0, 26.2, 32.0, 16.0));
}

#[test]
fn a_ruby_annotation_distributes_over_the_column_extent_on_the_layout_grid() {
    let fixture = two_color_flow(|red, _| {
        vec![InlineItem::Text {
            text: "漢字".to_owned(),
            style: red,
            baseline_shift_px: 0.0,
            ruby_annotation: Some(rito_fragment::RubyAnnotation {
                text: "かん".to_owned(),
                size_ratio: 0.5,
                align: rito_style_contract::RubyAlign::SpaceAround,
            }),
        }]
    });
    // The base's laid-out width carries float dust below the grid
    // point (justified shares summed in single precision); the
    // browser's column is the width ceiled onto 1/64.
    let root = boxed_line(vec![text_run(0.0, 31.99, 0, 6)]);
    let mut ruby_runs = BTreeMap::new();
    ruby_runs.insert(
        (0, 0),
        rito_inline::MeasuredRuby {
            run: rito_inline::MeasuredRun {
                advance: 16.0,
                clusters: vec![
                    rito_fragment::ClusterPosition { byte: 0, x: 0.0 },
                    rito_fragment::ClusterPosition { byte: 3, x: 8.0 },
                ],
                grid: false,
            },
            over_offset: 16.0,
            em_ascent: 7.046875,
        },
    );
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &fixture.tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            ruby_annotation_runs: Some(&ruby_runs),
            ..FragmentPaintContext::default()
        },
    )
    .expect("fragments paint");
    let DisplayCommand::PaintRuby(annotation) = &commands[0] else {
        panic!("annotation paints before its base, got {:?}", commands[0]);
    };
    // Over the 32px column: 16px of slack, one opportunity — an inset
    // of half the slack, a quarter at each edge, the other half in
    // the gap. The raw 31.99 would have truncated the inset to
    // 7.984375 and the edge to 3.984375.
    let origins: Vec<f64> = annotation.clusters.iter().map(|(_, x, _)| *x).collect();
    assert_eq!(origins, vec![18.0, 34.0]);
    assert_eq!(annotation.rect, display_rect(14.0, 16.6, 32.0, 8.0));
}
