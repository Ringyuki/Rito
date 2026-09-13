//! Vertical-rl lines painted as columns, and the paint-parity fixture written from them.

use super::*;

/// A vertical-rl page fragment for the paint-parity instrument: one
/// column of ideographs with rotated brackets and corner-shifted
/// marks, a rubied base, and a second column of leaders, a dash and
/// Latin at a letter-spaced style.
fn vertical_column_commands() -> Vec<DisplayCommand> {
    let mut inline = InlineStyleTable::new(3);
    let black = inline
        .intern_for_node(0, body_style(srgb(0.0, 0.0, 0.0, 1.0)))
        .expect("black style interns");
    let red = inline
        .intern_for_node(1, body_style(srgb(0.8, 0.0, 0.0, 1.0)))
        .expect("red style interns");
    let mut spaced = body_style(srgb(0.0, 0.0, 0.5, 1.0));
    spaced.text_flow.letter_spacing = rito_style_contract::LengthPercentage::Length(
        rito_style_contract::CssPx::new(2.0).expect("finite spacing"),
    );
    let spaced = inline
        .intern_for_node(2, spaced)
        .expect("spaced style interns");
    let items = vec![
        text_item("「春日」、剧场。", black, 0.0),
        InlineItem::Text {
            text: "漢字".to_owned(),
            style: red,
            baseline_shift_px: 0.0,
            ruby_annotation: Some(rito_fragment::RubyAnnotation {
                text: "かんじ".to_owned(),
                size_ratio: 0.5,
                align: rito_style_contract::RubyAlign::SpaceAround,
            }),
        },
        text_item("…—ab", spaced, 0.0),
    ];
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("tree builds");
    let line = |block: f64, thickness: f64, growth: f64, length: f64, runs: Vec<Fragment>| {
        Fragment::Line(LineFragment {
            source: FormattingNodeId(0),
            marker: None,
            rect: FragmentRect {
                x: 0.0,
                y: block,
                width: length,
                height: thickness,
            },
            baseline: 13.0,
            trailing_whitespace: 0.0,
            ruby_growth: growth,
            children: runs,
        })
    };
    let root = Fragment::Box(BoxFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 60.0,
        },
        children: vec![
            line(
                0.0,
                24.0,
                8.0,
                160.0,
                vec![text_run(0.0, 128.0, 0, 24), text_run(128.0, 32.0, 24, 30)],
            ),
            line(32.0, 20.0, 0.0, 72.0, vec![text_run(0.0, 72.0, 30, 38)]),
        ],
    });
    // The annotation measured when the chapter was built: the
    // style's primary face is Tinos, whose 8px typo ascent puts the
    // em-box top 6.09375px over the baseline (1420/1862 × 8 on the
    // grid) — the browser's canvas resolves a top anchor from the
    // font string's first face even where the kana fall back.
    let mut ruby_runs = BTreeMap::new();
    ruby_runs.insert(
        (0, 1),
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
            em_ascent: 6.09375,
        },
    );
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            vertical_frame: Some((220.0, 20.0)),
            ruby_annotation_runs: Some(&ruby_runs),
            ..FragmentPaintContext::default()
        },
    )
    .expect("the column paints");
    commands
}

/// Writes the paint-parity fixture for a vertical column from this
/// painter's own output, so the instrument's browser lane holds the
/// reference every change to the column laws is verified against.
/// Run by hand when the column laws change:
/// `cargo test -p rito-core --lib write_vertical_paint_parity_fixture -- --ignored`.
#[test]
#[ignore = "regenerates tools/paint-parity/fixtures/text-vertical.json"]
fn write_vertical_paint_parity_fixture() {
    let commands = vertical_column_commands();
    let fixture = serde_json::json!({
        "name": "text-vertical",
        "width": 240,
        "height": 320,
        "background": "#ffffff",
        "commands": crate::render::test_support::display_command_values(&commands),
    });
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tools/paint-parity/fixtures/text-vertical.json"
    );
    std::fs::write(
        path,
        serde_json::to_string_pretty(&fixture).expect("fixture is JSON") + "\n",
    )
    .expect("fixture writes");
}

/// The vertical column paints glyph by glyph: upright glyphs share a
/// run with an origin each one step down the column, corner marks
/// shift into the em's top-right, rotated marks paint as their own
/// run under a quarter-turn transform, and the annotation spreads
/// its glyphs down the base span.
#[test]
fn a_vertical_column_places_every_glyph_and_rotates_its_marks() {
    let commands = vertical_column_commands();
    let texts: Vec<&DisplayTextCommand> = commands
        .iter()
        .filter_map(|command| match command {
            DisplayCommand::PaintText(input) => Some(input),
            _ => None,
        })
        .collect();
    let origins = |actual: &[(u32, f64, f64)], expected: &[(u32, f64, f64)]| {
        assert_eq!(actual.len(), expected.len(), "{actual:?} vs {expected:?}");
        for (a, e) in actual.iter().zip(expected) {
            assert!(
                a.0 == e.0 && (a.1 - e.1).abs() < 1e-9 && (a.2 - e.2).abs() < 1e-9,
                "{actual:?} vs {expected:?}"
            );
        }
    };
    // 「 | 春日 | 」 | 、剧场。 | 漢字 | … | — | ab
    assert_eq!(texts.len(), 8, "{texts:#?}");
    let transforms = commands
        .iter()
        .filter(|command| matches!(command, DisplayCommand::Transform { .. }))
        .count();
    assert_eq!(transforms, 4, "one quarter turn per rotated mark");
    assert!(texts.iter().all(|text| !text.clusters.is_empty()));
    // The first column's glyphs sit at x 196 (frame right 220 minus
    // the 24px line thickness), stepping 16px from the column top 20
    // with baselines 0.8 em below each glyph top.
    assert_eq!(texts[0].text, "「");
    origins(&texts[0].clusters, &[(0, 196.0, 32.8)]);
    let DisplayCommand::Transform {
        origin, transforms, ..
    } = &commands[1]
    else {
        panic!(
            "the rotated mark paints under a transform, got {:?}",
            commands[1]
        );
    };
    assert_eq!((origin.x, origin.y), (204.0, 28.0));
    assert_eq!(
        transforms,
        &vec![ReaderTransform::Rotate {
            radians: std::f64::consts::FRAC_PI_2
        }]
    );
    assert_eq!(texts[1].text, "春日");
    origins(&texts[1].clusters, &[(0, 196.0, 48.8), (3, 196.0, 64.8)]);
    assert_eq!(texts[3].text, "、剧场。");
    // 、 and 。 ride the em's top-right corner; 剧场 stay upright.
    origins(
        &texts[3].clusters,
        &[
            (0, 204.0, 87.2),
            (3, 196.0, 112.8),
            (6, 196.0, 128.8),
            (9, 204.0, 135.2),
        ],
    );
    // The letter-spaced second column steps 18px.
    assert_eq!(texts[7].text, "ab");
    origins(&texts[7].clusters, &[(0, 170.0, 68.8), (1, 170.0, 86.8)]);
    let annotation = commands
        .iter()
        .find_map(|command| match command {
            DisplayCommand::PaintRuby(input) => Some(input),
            _ => None,
        })
        .expect("the rubied base paints its annotation");
    // Three 8px kana down the 32px base span: 8px free, one share
    // (8/3) per glyph, half a share at each edge, every glyph's
    // baseline its em-box ascent below its top.
    let ys: Vec<f64> = annotation.clusters.iter().map(|(_, _, y)| *y).collect();
    for (y, expected) in ys.iter().zip([
        148.0 + 4.0 / 3.0 + 6.09375,
        160.0 + 6.09375,
        172.0 - 4.0 / 3.0 + 6.09375,
    ]) {
        assert!((y - expected).abs() < 1e-9, "{ys:?}");
    }
    assert!(annotation.clusters.iter().all(|(_, x, _)| *x == 212.0));
}
