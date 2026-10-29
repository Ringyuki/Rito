//! Vertical-rl lines painted as columns, and the paint-parity fixture written from them.

use super::*;

/// A text fragment of a vertical line as layout leaves it: a cluster per
/// character of `text` (the flow's bytes `start..end`) every `step` down
/// the line, upright with a 16px glyph's half advance and vertical origin
/// centred half a pixel over the run's baseline, unless Latin, which lies
/// sideways on a baseline 5px under it.
fn column_run(x: f64, width: f64, start: u32, text: &str, step: f64) -> Fragment {
    let Fragment::Text(mut run) = text_run(x, width, start, start + text.len() as u32) else {
        unreachable!("a text run is text");
    };
    run.clusters = text
        .char_indices()
        .enumerate()
        .map(|(index, (byte, _))| rito_fragment::ClusterPosition {
            byte: start + byte as u32,
            x: index as f64 * step,
            face: rito_fragment::FontFaceId::default(),
            joins: false,
        })
        .collect();
    run.orientations = Some(
        text.chars()
            .map(|glyph| {
                if glyph.is_ascii_alphabetic() {
                    rito_fragment::ClusterOrientation::Sideways { baseline: 5.0 }
                } else {
                    rito_fragment::ClusterOrientation::Upright {
                        center: -0.5,
                        half_advance: 8.0,
                        vertical_origin: 14.08,
                    }
                }
            })
            .collect(),
    );
    Fragment::Text(run)
}

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
            annotation_growth: growth,
            annotation_overflow: growth,
            annotation_lent: 0.0,
            annotation_space_end: 0.0,
            fonts: rito_fragment::LineFonts::None,
            text_runs: Vec::new(),
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
                vec![
                    column_run(0.0, 128.0, 0, "「春日」、剧场。", 16.0),
                    column_run(128.0, 32.0, 24, "漢字", 16.0),
                ],
            ),
            line(
                32.0,
                20.0,
                0.0,
                72.0,
                vec![column_run(0.0, 72.0, 30, "…—ab", 18.0)],
            ),
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
                    rito_fragment::ClusterPosition {
                        byte: 0,
                        x: 0.0,
                        face: rito_fragment::FontFaceId::default(),
                        joins: false,
                    },
                    rito_fragment::ClusterPosition {
                        byte: 3,
                        x: 8.0,
                        face: rito_fragment::FontFaceId::default(),
                        joins: false,
                    },
                    rito_fragment::ClusterPosition {
                        byte: 6,
                        x: 16.0,
                        face: rito_fragment::FontFaceId::default(),
                        joins: false,
                    },
                ],
                grid: false,
            },
            over_offset: 16.0,
            em_ascent: 6.09375,
            orientations: Some(
                vec![
                    rito_fragment::ClusterOrientation::Upright {
                        center: -0.5,
                        half_advance: 4.0,
                        vertical_origin: 7.04,
                    };
                    3
                ]
                .into(),
            ),
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
            // A content box 220 wide whose top-left corner is (0, 20).
            vertical_frame: Some(crate::fragment_paint::VerticalFrame {
                converter: rito_fragment::WritingModeConverter::from_logical_size(
                    rito_style_contract::WritingDirection {
                        mode: rito_style_contract::WritingMode::VerticalRightToLeft,
                        direction: rito_style_contract::Direction::LeftToRight,
                    },
                    root.rect().width,
                    220.0,
                ),
                left: 0.0,
                top: 20.0,
            }),
            annotations: crate::fragment_paint::LineAnnotations {
                ruby: Some(&ruby_runs),
                emphasis: None,
            },
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

/// The vertical column paints each cluster where layout put it: upright
/// glyphs half their advance left of their centre line (12.5px in from the
/// line-over edge: the 13px baseline less half a pixel) and their vertical
/// origin below their place, corner marks in the em's
/// top-right, rotated marks alone under a quarter turn about their em
/// centre, Latin set sideways under a quarter turn about its start on its
/// alphabetic baseline, and the annotation spread down the base span.
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
    let origins = |actual: &[TextCluster], expected: &[(u32, f64, f64)]| {
        let actual: Vec<_> = actual.iter().map(|cluster| cluster.origin()).collect();
        assert_eq!(actual.len(), expected.len(), "{actual:?} vs {expected:?}");
        for (a, e) in actual.iter().zip(expected) {
            assert!(
                a.0 == e.0 && (a.1 - e.1).abs() < 1e-9 && (a.2 - e.2).abs() < 1e-9,
                "{actual:?} vs {expected:?}"
            );
        }
    };
    let transform_origins: Vec<(f64, f64)> = commands
        .iter()
        .filter_map(|command| match command {
            DisplayCommand::Transform {
                origin, transforms, ..
            } => {
                assert_eq!(
                    transforms,
                    &vec![ReaderTransform::Rotate {
                        radians: std::f64::consts::FRAC_PI_2
                    }]
                );
                Some((origin.x, origin.y))
            }
            _ => None,
        })
        .collect();
    // 「春日」、剧场。 | 漢字 | …— | ab
    assert_eq!(texts.len(), 4, "{texts:#?}");
    assert!(texts.iter().all(|text| !text.clusters.is_empty()));
    // The first column's line-over edge is the frame's right edge, 220:
    // its glyphs centre at 207.5, their origins at 199.5, each 16px down
    // from the column top 20 and its vertical origin below that, the
    // punctuation in its vertical forms like the rest.
    assert_eq!(texts[0].text, "「春日」、剧场。");
    origins(
        &texts[0].clusters,
        &(0..8)
            .map(|index| (3 * index, 199.5, 34.08 + 16.0 * f64::from(index)))
            .collect::<Vec<_>>(),
    );
    assert_eq!(texts[1].text, "漢字");
    origins(
        &texts[1].clusters,
        &[(0, 199.5, 162.08), (3, 199.5, 178.08)],
    );
    // The letter-spaced second column steps 18px; its Latin lies on the
    // baseline 18px in from its line-over edge, 188.
    assert_eq!(texts[2].text, "…—");
    origins(&texts[2].clusters, &[(0, 167.5, 34.08), (3, 167.5, 52.08)]);
    assert_eq!(texts[3].text, "ab");
    origins(&texts[3].clusters, &[(0, 170.0, 56.0), (1, 188.0, 56.0)]);
    assert_eq!(
        transform_origins,
        vec![(170.0, 56.0)],
        "one quarter turn, for the sideways Latin"
    );
    let annotation = commands
        .iter()
        .find_map(|command| match command {
            DisplayCommand::PaintRuby(input) => Some(input),
            _ => None,
        })
        .expect("the rubied base paints its annotation");
    // Three 8px kana down the 32px base span: 8px free, one share
    // (8/3) per glyph, half a share at each edge, every glyph's
    // vertical origin below its place.
    let ys: Vec<f64> = annotation
        .clusters
        .iter()
        .map(|cluster| cluster.y)
        .collect();
    for (y, expected) in ys.iter().zip([
        148.0 + 4.0 / 3.0 + 7.04,
        160.0 + 7.04,
        172.0 - 4.0 / 3.0 + 7.04,
    ]) {
        assert!((y - expected).abs() < 1e-9, "{ys:?}");
    }
    // The annotation's baseline stands 16px past the base's (207, 13px in
    // from the line-over edge 220), at 223: its glyphs centre half a pixel
    // further and hang half their advance back, at 219.5.
    assert!(annotation.clusters.iter().all(|cluster| cluster.x == 219.5));
}
