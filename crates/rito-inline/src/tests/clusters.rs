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
        let mut inline = InlineStyleTableV1::new(1);
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
                layout: LayoutStyleTableV1::new(0),
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
    let annotation = context.measure_ruby_annotation(&style, 8.0, "12");
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
