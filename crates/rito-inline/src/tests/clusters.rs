use super::*;

/// Every text fragment carries the origin of each of its clusters: the
/// first at the fragment's start, the rest stepping by the browser's
/// fixed-point advances, one origin per cluster of the fragment's text.
#[test]
fn text_fragments_carry_one_origin_per_cluster_stepping_forward() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (tree, text) = paragraph_tree("Hello quiet world", 0.0);
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(600.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let mut seen = 0;
    for run in text_runs(&outcome) {
        let piece = &text[run.text_start as usize..run.text_end as usize];
        assert_eq!(
            run.clusters.len(),
            piece.chars().count(),
            "one origin per character of {piece:?}"
        );
        assert_eq!(run.clusters[0].byte, run.text_start);
        assert_eq!(
            run.clusters[0].x, 0.0,
            "the first cluster sits at the run start"
        );
        for pair in run.clusters.windows(2) {
            assert!(
                pair[1].x > pair[0].x && pair[1].byte > pair[0].byte,
                "origins step forward in {piece:?}: {:?}",
                run.clusters
            );
        }
        let last = run.clusters.last().expect("a cluster");
        assert!(
            last.x < run.rect.width,
            "the last origin lies inside the run's advance"
        );
        assert!(!run.cluster_grid, "a Latin run accumulates in float");
        seen += run.clusters.len();
    }
    assert_eq!(seen, text.chars().count());
}

/// An all-CJK run at a fractional font size takes the grid law: the
/// painter floors every origin onto the 1/64 grid, the way the browser
/// paints such a line.
#[test]
fn an_all_cjk_run_at_a_fractional_size_takes_the_grid_law() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    for (size, grid) in [(16.0, false), (15.2, true)] {
        let style = plain_paragraph_style(
            rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
                "NoSuchFace",
            ))])
            .expect("family list"),
            size,
            0.0,
        );
        let mut inline = InlineStyleTable::new(1);
        let style = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "春日的剧场".to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTable::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(600.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        // A fractional size lands every ideograph off the 1/64 grid, so
        // layout anchors each as its own piece; the origins still read
        // as one line of clusters stepping one em each.
        let runs = text_runs(&outcome);
        assert!(!runs.is_empty());
        let mut origins: Vec<f64> = Vec::new();
        for run in runs {
            assert_eq!(run.cluster_grid, grid, "size {size}");
            origins.extend(run.clusters.iter().map(|cluster| run.rect.x + cluster.x));
        }
        assert_eq!(origins.len(), 5, "size {size}: {origins:?}");
        for pair in origins.windows(2) {
            assert!(
                (pair[1] - pair[0] - f64::from(size)).abs() < 1.0 / 64.0 + 1e-3,
                "size {size}: {origins:?}"
            );
        }
    }
}

fn text_runs(outcome: &LayoutOutcome) -> Vec<&TextFragment> {
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("inline outcome root is a box fragment");
    };
    let mut runs = Vec::new();
    for line in &root.children {
        let Fragment::Line(line) = line else {
            panic!("inline children are line fragments");
        };
        for child in &line.children {
            if let Fragment::Text(run) = child {
                runs.push(run);
            }
        }
    }
    runs
}

/// A string shaped on its own — an outside list marker — measures as the
/// box the browser gives it: the advance sum ceiled onto the 1/64 grid,
/// and one origin per cluster stepping by the fixed-point advances.
#[test]
fn a_marker_string_measures_its_box_and_cluster_origins() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    let run = context.measure_run(&style, "12. ");
    assert_eq!(
        run.clusters
            .iter()
            .map(|cluster| cluster.byte)
            .collect::<Vec<_>>(),
        vec![0, 1, 2, 3],
        "one origin per cluster, the trailing space included"
    );
    // Tinos at 16px: digits advance 8, the period and the space 4.
    assert_eq!(
        run.clusters
            .iter()
            .map(|cluster| cluster.x)
            .collect::<Vec<_>>(),
        vec![0.0, 8.0, 16.0, 20.0]
    );
    assert_eq!(run.advance, 24.0, "the pen ends after the trailing space");
    assert_eq!(
        run.box_inline_size(),
        24.0,
        "the box takes the whole string's advance"
    );
    assert!(!run.grid, "a Latin string accumulates in float");
    assert_eq!(context.measure_run(&style, "").advance, 0.0);
}

/// A ruby annotation shapes at its own size with the base's spacing off:
/// the origins step by the annotation-size advances alone, where the
/// base's own run would fold its letter spacing into every step.
#[test]
fn a_ruby_annotation_measures_at_its_size_with_the_base_spacing_off() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    style.text_flow.letter_spacing =
        LengthPercentage::Length(CssPx::new(2.0).expect("finite spacing"));
    // "12" carries no kern pair, so the digits step by their bare 8px.
    let base = context.measure_run(&style, "12");
    assert_eq!(
        base.clusters[1].x, 10.0,
        "the base run folds 2px spacing after each 8px digit"
    );
    let annotation = context.measure_ruby_annotation(&style, 8.0, "11", "12").run;
    assert_eq!(
        annotation
            .clusters
            .iter()
            .map(|cluster| cluster.x)
            .collect::<Vec<_>>(),
        vec![0.0, 4.0],
        "4px digits at 8px, no spacing"
    );
    assert_eq!(annotation.advance, 8.0);
}

/// Word spacing rides a space cluster outside the fixed-point round trip,
/// like letter spacing: the browser adds it to the shaped advance in
/// float, so quantizing the spaced space onto the font's unit grid would
/// drift every later cluster a few thousandths per space.
#[test]
fn word_spacing_folds_outside_the_fixed_point_round_trip() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    style.text_flow.word_spacing =
        LengthPercentage::Length(CssPx::new(2.13).expect("finite spacing"));
    let run = context.measure_run(&style, "a b");
    // Tinos at 16px: 'a' advances 7.1015625 and the space 4; the word
    // spacing adds its 2.13 on top of the space unquantized.
    let origins: Vec<f64> = run.clusters.iter().map(|cluster| cluster.x).collect();
    assert!((origins[1] - 7.1015625).abs() < 1e-9, "{origins:?}");
    assert!(
        (origins[2] - (7.1015625 + 4.0 + 2.13)).abs() < 1e-5,
        "{origins:?}"
    );
}

/// A ruby base spread under a wide annotation splits into pieces at the
/// spread's spacing edit and is re-fused into one fragment: that fragment
/// carries one origin per base cluster, the later ones stepping by the
/// spread gap, so the pen draws the gap layout opened (a base drawn as
/// one origin packed its glyphs and left the gap after them).
#[test]
fn a_spread_ruby_base_keeps_one_origin_per_cluster_after_merging() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    let annotation_advance = context.measure_styled_advance(&style, Some(8.0), "Emnetwiht");
    let mut inline = InlineStyleTable::new(1);
    let style = inline.intern_for_node(0, style).expect("style interns");
    let text_item = |text: &str| InlineItem::Text {
        text: text.to_owned(),
        style,
        baseline_shift_px: 0.0,
        ruby_annotation: None,
    };
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                text_item("「"),
                InlineItem::Text {
                    text: "人族".to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: Some(rito_fragment::RubyAnnotation {
                        text: "Emnetwiht".to_owned(),
                        size_ratio: 0.5,
                        align: rito_style_contract::RubyAlign::SpaceAround,
                    }),
                },
                text_item("」"),
            ],
        },
        children: Vec::new(),
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(600.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let runs = text_runs(&outcome);
    let base = runs
        .iter()
        .find(|run| run.text_start == 3 && run.text_end == 9)
        .expect("the base 人族 lays out as one fragment");
    // Chromium's grid arithmetic (the 042 witness: a raw half share put
    // the annotation 1/64 px left of the browser's and flipped its first
    // glyph's raster phase): widths on the 1/64 grid, inset S/2 for the
    // one opportunity, half of it per edge, the rest between the glyphs.
    let space = layout_unit_ceil(annotation_advance) - 32.0;
    assert!(
        space > 0.0,
        "the annotation is wider than the base: {annotation_advance}"
    );
    let inset_full = layout_unit_trunc(space / 2.0);
    let inset = layout_unit_trunc(inset_full / 2.0);
    let share = space - inset_full;
    // Both brackets are 16px text, so each side overhangs by the half
    // inset (under half the 8px annotation font and half a bracket).
    assert_eq!(base.ruby_overhang_px, inset);
    assert_eq!(base.ruby_overhang_right_px, inset);
    assert_eq!(base.ruby_center_shift_px, 0.0);
    let expected_width = 32.0 + share + (inset_full - 2.0 * inset);
    assert!(
        (base.rect.width - expected_width).abs() < 1e-4,
        "the column is the annotation minus both overhangs: {} vs {expected_width}",
        base.rect.width
    );
    let origins: Vec<f64> = base.clusters.iter().map(|cluster| cluster.x).collect();
    assert_eq!(origins.len(), 2, "{origins:?}");
    assert_eq!(origins[0], 0.0);
    assert!(
        (origins[1] - (16.0 + share)).abs() < 1e-4,
        "the second glyph steps by the em plus the interior share: {origins:?} vs {}",
        16.0 + share
    );
}

/// Where an annotation's line sits over its base, Chromium's way: the
/// base's em-height ascent plus the annotation's em-height descent, each
/// the normalized OS/2 typo metric united over the fonts the text used,
/// ceiled to whole pixels and capped by the primary font's rounded
/// platform metric. Measured on the 042 witness: a CJK base under the
/// Latin pin's primary metrics (Tinos 16px: ascent 14) with a Latin
/// annotation (Tinos 8px: descent 2) sit 16px apart; the annotation's
/// em-box top is its typo ascent (6.09375 = 1420/1862 × 8 on the grid).
#[test]
fn a_ruby_annotation_measures_its_line_offset_over_the_base() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context =
        ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
    let style = plain_paragraph_style(
        FontFamilies::new(vec![
            FontFamily::Named(FontFamilyName::new("Tinos")),
            FontFamily::Generic(GenericFontFamily::Serif),
        ])
        .expect("family list"),
        16.0,
        0.0,
    );
    let measured = context.measure_ruby_annotation(&style, 8.0, "人族", "Emnetwiht");
    assert_eq!(measured.over_offset, 16.0);
    assert_eq!(measured.em_ascent, 6.09375);
    // A CJK annotation over the same base: Source Han's 8px typo
    // descent rounds to 0.953125 and ceils to 1, under Tinos's rounded
    // platform descent of 2.
    let cjk = context.measure_ruby_annotation(&style, 8.0, "人族", "かんじ");
    assert_eq!(cjk.over_offset, 15.0);
    assert_eq!(cjk.em_ascent, 6.09375);
    // With Source Han primary, its own rounded platform ascent (18) no
    // longer caps the ceiled typo ascent (15).
    let serif = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    let source_han_context = ParleyInlineContext::new(vec![std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads")])
    .expect("context builds");
    let own = source_han_context.measure_ruby_annotation(&serif, 8.0, "人族", "かんじ");
    assert_eq!(own.over_offset, 16.0);
    assert_eq!(own.em_ascent, 7.046875);
}
