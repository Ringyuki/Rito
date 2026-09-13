use super::*;

#[test]
fn a_super_shifted_span_uses_the_host_measured_line_envelope() {
    // Blink quantizes a raised span's above-baseline line
    // contribution onto whole pixels through interplay no font table
    // exposes (a 64-configuration oracle matrix refused every closed
    // form — a real book's 0.8em bold ① marker line measures 26.125 with the
    // baseline at 21.328125 where the computed fallback gives
    // 28.125). The engine records a U+E00C probe keyed by the span's
    // size ratio and the strut's used line-height; once the host
    // answers, the measured envelope replaces the computed one.
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let mut inline = InlineStyleTable::new(2);
    let mut main_style = tinos_style(0.0);
    main_style.font.line_height = LineHeight::Length(
        rito_style_contract::NonNegativeCssPx::new(20.796875).expect("finite line height"),
    );
    main_style.font.line_height_is_declared = true;
    let main = inline
        .intern_for_node(0, main_style.clone())
        .expect("style interns");
    let mut span_style = main_style.clone();
    span_style.font.size = px(12.8);
    // The span INHERITS the paragraph's line-height (value carried,
    // declared flag off) — the probe models exactly this idiom; a
    // span declaring its own line-height keeps the fixed-box path.
    span_style.font.line_height_is_declared = false;
    let span = inline
        .intern_for_node(1, span_style)
        .expect("style interns");
    context.set_host_line_metric(
        &host_family_key(&main_style),
        16.0,
        "",
        HostNormalLineMetric {
            height: 23.0,
            baseline: 18.0,
            grid: Some((18.0, 5.0)),
            advance: None,
        },
    );
    let items = vec![
        InlineItem::Text {
            text: "ab ".to_owned(),
            style: main,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        },
        InlineItem::Text {
            text: "1".to_owned(),
            style: span,
            baseline_shift_px: 6.328125,
            ruby_annotation: None,
        },
        InlineItem::Text {
            text: " ab".to_owned(),
            style: main,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        },
    ];
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds");
    let constraint = ConstraintSpace::continuous(10_000.0);
    let sup_key = "\u{E00C}0.8000:20.796875";
    let _ = context
        .layout(
            &tree,
            FormattingNodeId(0),
            &constraint,
            None,
            &CancelFlag::new(),
        )
        .expect("first layout succeeds");
    let requests = context.take_host_metric_requests();
    assert!(
        requests
            .iter()
            .any(|(_, size, sample)| *size == 16.0 && sample == sup_key),
        "the sup probe is requested at the strut size: {requests:?}"
    );
    context.set_host_line_metric(
        &host_family_key(&main_style),
        16.0,
        sup_key,
        HostNormalLineMetric {
            height: 26.125,
            baseline: 21.328125,
            grid: None,
            advance: None,
        },
    );
    let outcome = context
        .layout(
            &tree,
            FormattingNodeId(0),
            &constraint,
            None,
            &CancelFlag::new(),
        )
        .expect("measured layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Line(line) = &root.children[0] else {
        panic!("first child is a line");
    };
    assert_eq!(
        line.rect.height, 26.125,
        "the host-measured sup envelope sizes the line"
    );
}

#[test]
fn a_super_shifted_marker_image_grows_the_line_with_a_consistent_baseline() {
    // The duokan footnote-marker construct (book 4, Section001 p11):
    // fixed 19.2px strut over a host metric (asc 18, desc 5), one
    // image 14.390625px tall raised 6.328125px (the sup rule at a
    // 16px parent). The expectations are the CSS 2.1 §10.8
    // contributions model over exactly these injected metrics; the
    // pixel oracle validates the same model end-to-end against Blink
    // with the production metric set (the page diffs to zero).
    use rito_style_contract::{
        AlignItems, Clear, Float, JustifyContent, LayoutDisplay, LayoutDisplayInside,
        LayoutDisplayOutside, LayoutFormattingStyle, LayoutStyleTable, LengthPercentageOrAuto,
        ListMarkerStyle, MaximumHeight, MaximumSize, MinimumHeight, Overflow, PageBreak,
        PhysicalSides, Position, PreferredSize,
    };
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let mut inline = InlineStyleTable::new(2);
    let mut style_1922 = tinos_style(0.0);
    style_1922.font.line_height = LineHeight::Length(
        rito_style_contract::NonNegativeCssPx::new(19.2).expect("finite line height"),
    );
    let text_style = inline
        .intern_for_node(0, style_1922.clone())
        .expect("style interns");
    // The marker image inherits the sup's 12px font; its strut is the
    // sup box's strut (CSS 2.1 §10.8) and rides the same raise.
    let mut sup_style = style_1922.clone();
    sup_style.font.size = rito_style_contract::NonNegativeCssPx::new(12.0).expect("finite");
    let image_inline_style = inline
        .intern_for_node(1, sup_style.clone())
        .expect("style interns");
    context.set_host_line_metric(
        &host_family_key(&style_1922),
        16.0,
        "",
        HostNormalLineMetric {
            height: 23.0,
            baseline: 18.0,
            grid: None,
            advance: None,
        },
    );
    context.set_host_line_metric(
        &host_family_key(&sup_style),
        12.0,
        "",
        HostNormalLineMetric {
            height: 18.0,
            baseline: 14.0,
            grid: None,
            advance: None,
        },
    );
    let mut layout = LayoutStyleTable::new(1);
    let auto = LengthPercentageOrAuto::Auto;
    let zero_padding =
        NonNegativeLengthPercentage::new(LengthPercentage::Length(CssPx::new(0.0).expect("zero")));
    let image_layout = layout
        .intern_for_node(
            0,
            LayoutFormattingStyle {
                display: LayoutDisplay {
                    outside: LayoutDisplayOutside::Inline,
                    inside: LayoutDisplayInside::Flow,
                    is_list_item: false,
                },
                margin: PhysicalSides {
                    top: auto,
                    right: auto,
                    bottom: auto,
                    left: auto,
                },
                padding: PhysicalSides {
                    top: zero_padding,
                    right: zero_padding,
                    bottom: zero_padding,
                    left: zero_padding,
                },
                box_sizing: rito_style_contract::BoxSizing::ContentBox,
                justify_content: JustifyContent::Normal,
                align_items: AlignItems::Normal,
                break_before: PageBreak::Auto,
                break_after: PageBreak::Auto,
                width: PreferredSize::Auto,
                height: PreferredSize::Value(NonNegativeLengthPercentage::new(
                    LengthPercentage::Length(CssPx::new(14.390625).expect("finite")),
                )),
                max_width: MaximumSize::None,
                min_height: MinimumHeight::Auto,
                max_height: MaximumHeight::None,
                clear: Clear::None,
                float: Float::None,
                overflow: Overflow::Visible,
                list_style_type: ListMarkerStyle::None,
                position: Position::Static,
                inset: PhysicalSides {
                    top: auto,
                    right: auto,
                    bottom: auto,
                    left: auto,
                },
                vertical_align: rito_style_contract::CellVerticalAlign::Baseline,
                border_spacing: (
                    rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                    rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                ),
                border_collapse: false,
                object_fit: rito_style_contract::ObjectFit::Fill,
            },
        )
        .expect("layout style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                InlineItem::Text {
                    text: "巴沙巴沙".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
                InlineItem::Image {
                    source: 0,
                    src: "images/note.png".to_owned(),
                    intrinsic_width: 500.0,
                    intrinsic_height: 500.0,
                    style: image_inline_style,
                    layout_style: image_layout,
                    fit_contain: false,
                    object_fit: rito_style_contract::ObjectFit::Fill,
                    viewport: None,
                    baseline_shift_px: 6.328125,
                    align_top: false,
                },
                InlineItem::Text {
                    text: "，甘夏老师".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
            ],
        },
        children: Vec::new(),
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(600.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Some(Fragment::Line(line)) = root.children.first() else {
        panic!("first child is a line");
    };
    // Contributions over the injected metrics: the sup strut (fixed
    // 19.203125 at 12px, baseline 15) raised 6.328125 wins over the
    // image box (14.390625 + 6.328125): A = 21.328125, height =
    // A + strut descent 3.203125 = 24.53125.
    assert!(
        (line.rect.height - 24.53125).abs() < 1e-9,
        "line height matches pinned Blink, got {}",
        line.rect.height
    );
    assert!(
        (line.baseline - 21.328125).abs() < 1e-9,
        "baseline == above (pinned Blink 21.328125), got {}",
        line.baseline
    );
}

#[test]
fn images_lay_out_as_atomic_inlines_with_display_geometry() {
    use rito_style_contract::{
        AlignItems, Clear, Float, JustifyContent, LayoutDisplay, LayoutDisplayInside,
        LayoutDisplayOutside, LayoutFormattingStyle, LayoutStyleTable, LengthPercentageOrAuto,
        ListMarkerStyle, MaximumHeight, MaximumSize, MinimumHeight, Overflow, PageBreak,
        PhysicalSides, Position, PreferredSize,
    };
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let mut inline = InlineStyleTable::new(1);
    let text_style = inline
        .intern_for_node(0, tinos_style(0.0))
        .expect("style interns");
    let mut layout = LayoutStyleTable::new(1);
    let auto = LengthPercentageOrAuto::Auto;
    let zero_padding =
        NonNegativeLengthPercentage::new(LengthPercentage::Length(CssPx::new(0.0).expect("zero")));
    let image_layout = layout
        .intern_for_node(
            0,
            LayoutFormattingStyle {
                display: LayoutDisplay {
                    outside: LayoutDisplayOutside::Inline,
                    inside: LayoutDisplayInside::Flow,
                    is_list_item: false,
                },
                margin: PhysicalSides {
                    top: auto,
                    right: auto,
                    bottom: auto,
                    left: auto,
                },
                padding: PhysicalSides {
                    top: zero_padding,
                    right: zero_padding,
                    bottom: zero_padding,
                    left: zero_padding,
                },
                box_sizing: rito_style_contract::BoxSizing::ContentBox,
                justify_content: JustifyContent::Normal,
                align_items: AlignItems::Normal,
                break_before: PageBreak::Auto,
                break_after: PageBreak::Auto,
                width: PreferredSize::Auto,
                height: PreferredSize::Auto,
                max_width: MaximumSize::None,
                min_height: MinimumHeight::Auto,
                max_height: MaximumHeight::None,
                clear: Clear::None,
                float: Float::None,
                overflow: Overflow::Visible,
                list_style_type: ListMarkerStyle::None,
                position: Position::Static,
                inset: PhysicalSides {
                    top: auto,
                    right: auto,
                    bottom: auto,
                    left: auto,
                },
                vertical_align: rito_style_contract::CellVerticalAlign::Baseline,
                border_spacing: (
                    rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                    rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                ),
                border_collapse: false,
                object_fit: rito_style_contract::ObjectFit::Fill,
            },
        )
        .expect("layout style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                InlineItem::Text {
                    text: "Before ".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
                InlineItem::Image {
                    source: 0,
                    src: "images/figure.png".to_owned(),
                    intrinsic_width: 40.0,
                    intrinsic_height: 30.0,
                    style: text_style,
                    layout_style: image_layout,
                    fit_contain: false,
                    object_fit: rito_style_contract::ObjectFit::Fill,
                    viewport: None,
                    baseline_shift_px: 0.0,
                    align_top: false,
                },
                InlineItem::Text {
                    text: " after the picture.".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
            ],
        },
        children: Vec::new(),
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(400.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let mut images = Vec::new();
    for line in &root.children {
        let Fragment::Line(line) = line else {
            panic!("children are lines");
        };
        for child in &line.children {
            if let Fragment::Image(image) = child {
                images.push(image.clone());
            }
        }
        assert!(line.rect.height >= 30.0, "the image sets the line height");
    }
    assert_eq!(images.len(), 1);
    let image = &images[0];
    assert_eq!(image.item_index, 1);
    assert!((image.rect.width - 40.0).abs() < 0.01);
    assert!((image.rect.height - 30.0).abs() < 0.01);
    assert!(image.rect.x > 0.0, "the image sits after the leading text");

    let replay = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(400.0),
            None,
            &CancelFlag::new(),
        )
        .expect("replay succeeds");
    assert_eq!(outcome, replay);
}

#[test]
fn glyph_runs_split_at_item_boundaries_even_with_identical_measure_styles() {
    // Two items sharing one interned style differ in nothing Parley
    // measures — exactly the shape of a pure paint change (a colored
    // span). The per-item brush must still keep their runs apart so a
    // paint consumer can map each run to its item by byte range.
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(0, tinos_style(0.0))
        .expect("style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                InlineItem::Text {
                    text: "ab".to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
                InlineItem::Text {
                    text: "cd".to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
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
            &ConstraintSpace::continuous(400.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let mut ranges = Vec::new();
    for line in &root.children {
        let Fragment::Line(line) = line else {
            panic!("children are lines");
        };
        for child in &line.children {
            if let Fragment::Text(run) = child {
                ranges.push((run.text_start, run.text_end));
            }
        }
    }
    assert_eq!(ranges, vec![(0, 2), (2, 4)]);
}

#[test]
fn glyph_runs_carry_monotonic_geometry_and_indent_offsets_the_first_run() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (tree, _) = paragraph_tree(SAMPLE, 32.0);
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(200.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    for (line_index, line) in root.children.iter().enumerate() {
        let Fragment::Line(line) = line else {
            panic!("children are lines");
        };
        assert!(line.trailing_whitespace >= 0.0);
        assert!(line.trailing_whitespace < line.rect.width);
        let mut previous_end = f64::NEG_INFINITY;
        for run in &line.children {
            let Fragment::Text(run) = run else {
                panic!("line children are text fragments");
            };
            assert!(run.rect.width > 0.0);
            assert!(
                run.rect.x >= previous_end - 0.01,
                "runs must advance monotonically"
            );
            previous_end = run.rect.x + run.rect.width;
        }
        let Some(Fragment::Text(first_run)) = line.children.first() else {
            panic!("lines carry text fragments");
        };
        // The indent is a start-edge margin on the line box, so it
        // lands on the line's own x; run positions stay relative to
        // the line they sit on.
        assert!(
            first_run.rect.x.abs() < 0.01,
            "runs are positioned inside their line, got x = {}",
            first_run.rect.x
        );
        if line_index == 0 {
            assert!(
                (line.rect.x - 32.0).abs() < 0.01,
                "first line starts after the indent, got x = {}",
                line.rect.x
            );
        } else {
            assert!(
                line.rect.x.abs() < 0.01,
                "continuation lines start at zero, got x = {}",
                line.rect.x
            );
        }
    }
}

/// A ruby base splits across lines like plain CJK text (measured:
/// 黄金妖精/Leprechaun wraps as 黄金妖|精 — every base character
/// boundary is an ordinary break point; the annotation itself rides
/// only the first segment, which the paint layer enforces).
#[test]
fn a_ruby_base_breaks_across_lines_like_plain_text() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        32.0,
        0.0,
    );
    let mut inline = InlineStyleTable::new(1);
    let interned = inline.intern_for_node(0, style).expect("style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                InlineItem::Text {
                    text: "中中中中".to_owned(),
                    style: interned,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
                InlineItem::Text {
                    text: "中文".to_owned(),
                    style: interned,
                    baseline_shift_px: 0.0,
                    ruby_annotation: Some(rito_fragment::RubyAnnotation {
                        text: "an".to_owned(),
                        size_ratio: 0.5,
                        align: rito_style_contract::RubyAlign::SpaceAround,
                    }),
                },
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
    // 165px: four 32px lead glyphs plus the first base glyph fit
    // (160), so the base splits after its first character exactly as
    // plain text would.
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(165.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let lines = line_texts(&outcome, "中中中中中文");
    assert_eq!(
        lines,
        vec!["中中中中中".to_owned(), "文".to_owned()],
        "the annotated base breaks at an ordinary character boundary"
    );
}

/// A split whose first segment cannot carry the whole annotation is
/// illegal: the segment widens to at least the annotation's advance,
/// and when that overflows the line the ruby moves down intact
/// (measured: 异/Talent went down where plain-text fit had room;
/// 黄金妖/Leprechaun stayed split because the segment covers it).
#[test]
fn a_ruby_split_whose_annotation_overflows_rewinds_to_the_item_start() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        32.0,
        0.0,
    );
    let mut inline = InlineStyleTable::new(1);
    let interned = inline.intern_for_node(0, style).expect("style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                InlineItem::Text {
                    text: "中中中".to_owned(),
                    style: interned,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
                InlineItem::Text {
                    text: "中文中".to_owned(),
                    style: interned,
                    baseline_shift_px: 0.0,
                    ruby_annotation: Some(rito_fragment::RubyAnnotation {
                        // A single word: its character midpoint (0.5)
                        // sits inside the two-of-three-character
                        // first segment, so the whole annotation
                        // rides it — at ~81px it overflows the 64px
                        // segment (yet stays narrower than the 96px
                        // base, so no space-around spread joins in).
                        text: "wwwwww".to_owned(),
                        size_ratio: 0.5,
                        align: rito_style_contract::RubyAlign::SpaceAround,
                    }),
                },
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
    // 165px: three lead glyphs plus two base glyphs fit as plain
    // text (160), the split point sits two-thirds into the base, and
    // the single word's midpoint (0.5) rides that first segment —
    // which cannot carry the ~81px annotation.
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(165.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let lines = line_texts(&outcome, "中中中中文中");
    assert_eq!(
        lines,
        vec!["中中中".to_owned(), "中文中".to_owned()],
        "the overflowing split rewinds the whole base to the next line"
    );
}

/// `ruby-align: space-around`: an annotation wider than its base
/// opens the excess as interior gaps between the base clusters (all
/// but one share; the rest overhangs), so the base run widens by
/// exactly (n−1) gaps and carries the gap as justify spacing.
#[test]
fn zero_line_height_paragraph_still_emits_its_line() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    style.font.line_height = rito_style_contract::LineHeight::Length(
        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero line height"),
    );
    let mut inline = InlineStyleTable::new(1);
    let interned = inline.intern_for_node(0, style).expect("style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: "零高行文本".to_owned(),
                style: interned,
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
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("inline outcome root is a box fragment");
    };
    let lines: Vec<_> = root
        .children
        .iter()
        .filter(|child| matches!(child, Fragment::Line(_)))
        .collect();
    assert_eq!(
        lines.len(),
        1,
        "the zero-line-height paragraph keeps its line"
    );
    let Fragment::Line(line) = lines[0] else {
        unreachable!()
    };
    assert!(
        line.children
            .iter()
            .any(|child| matches!(child, Fragment::Text(_))),
        "the line keeps its text run"
    );
}

#[test]
fn a_wide_ruby_annotation_spreads_its_base_with_interior_gaps() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        32.0,
        0.0,
    );
    let ratio = 0.5_f32;
    let annotation_advance =
        context.measure_styled_advance(&style, Some(32.0 * ratio), "annotation");
    let base_advance = context.measure_styled_advance(&style, None, "中文");
    assert!(
        annotation_advance > base_advance + 1.0,
        "fixture must need a spread: annotation {annotation_advance} vs base {base_advance}"
    );
    // Chromium's grid arithmetic: both widths on the 1/64 layout grid,
    // the slack split into an inset S/(k+1) (k = the one opportunity
    // between the two ideographs) and one interior share, with half the
    // inset (truncated again) at each edge.
    let space = layout_unit_ceil(annotation_advance) - layout_unit_ceil(base_advance);
    let inset_full = layout_unit_trunc(space / 2.0);
    let inset = layout_unit_trunc(inset_full / 2.0);
    let share = space - inset_full;

    let mut inline = InlineStyleTable::new(1);
    let interned = inline
        .intern_for_node(0, style.clone())
        .expect("style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                InlineItem::Text {
                    text: "中文".to_owned(),
                    style: interned,
                    baseline_shift_px: 0.0,
                    ruby_annotation: Some(rito_fragment::RubyAnnotation {
                        text: "annotation".to_owned(),
                        size_ratio: ratio,
                        align: rito_style_contract::RubyAlign::SpaceAround,
                    }),
                },
                InlineItem::Text {
                    text: "中文".to_owned(),
                    style: interned,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
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
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("inline outcome root is a box fragment");
    };
    let Some(Fragment::Line(line)) = root.children.first() else {
        panic!("outcome has a first line");
    };
    let runs: Vec<&TextFragment> = line
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Text(run) => Some(run),
            _ => None,
        })
        .collect();
    assert_eq!(runs.len(), 2, "one run per item");
    let (ruby_run, plain_run) = (runs[0], runs[1]);
    assert!(
        (ruby_run.ruby_gap_px - share).abs() < 1e-9,
        "ruby run carries the interior share: {} vs {share}",
        ruby_run.ruby_gap_px
    );
    assert_eq!(plain_run.ruby_gap_px, 0.0);
    // The ruby sits at the paragraph start: the start edge cannot
    // overhang the flow edge, so its half inset stays in the column and
    // shifts the base glyphs right; the end edge overhangs the same-size
    // plain neighbour paint-only.
    assert_eq!(ruby_run.ruby_overhang_px, 0.0);
    assert_eq!(ruby_run.ruby_overhang_right_px, inset);
    assert_eq!(ruby_run.ruby_center_shift_px, inset);
    let expected_width = base_advance + share + (inset_full - inset);
    assert!(
        (ruby_run.rect.width - expected_width).abs() < 1e-3,
        "the column keeps the annotation minus the end overhang: width {} vs {expected_width}",
        ruby_run.rect.width
    );
    assert!(
        (plain_run.rect.width - base_advance).abs() < 0.1,
        "the plain neighbour stays at its natural advance"
    );
    assert!(
        (plain_run.rect.x - (ruby_run.rect.x + ruby_run.rect.width)).abs() < 0.1,
        "the neighbour starts right after the spread base"
    );
}

/// A justified line holding a base-shorter ruby (its annotation wider
/// than the base): the column is one justification item with no
/// opportunity of its own — the run after it starts at the column's end
/// with only its deferred before-share (ink), and its item carries two
/// shares — the way Chromium justifies around kBaseShorterRubyMarker
/// (DOM-measured on a justified novel line: the column box carried no
/// share, the following ideograph's box grew by two).
#[test]
fn a_justified_line_gives_a_wide_ruby_column_no_share_of_its_own() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    style.text_flow.text_align = TextAlign::Justify;
    style.text_flow.ruby_align = RubyAlign::Center;
    let mut inline = InlineStyleTable::new(1);
    let style = inline.intern_for_node(0, style).expect("style interns");
    let text = |t: &str| InlineItem::Text {
        text: t.to_owned(),
        style,
        baseline_shift_px: 0.0,
        ruby_annotation: None,
    };
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                text("从前年开始就待在"),
                InlineItem::Text {
                    text: "辛".to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: Some(rito_fragment::RubyAnnotation {
                        text: "送葬者".to_owned(),
                        size_ratio: 0.55,
                        align: RubyAlign::Center,
                    }),
                },
                text("和莱登的部队了，我记得他们两个认识也有两年了吧。"),
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
    // 8 + column + 12 ideographs on the first line: 20 × 16 + the
    // column's 18.40625 (the 26.4 annotation ceiled to the grid minus
    // an overhang of 4 per side) = 338.40625 natural in 339 available.
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(339.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("inline outcome root is a box fragment");
    };
    let Some(Fragment::Line(line)) = root.children.first() else {
        panic!("outcome has a first line");
    };
    let runs: Vec<&TextFragment> = line
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Text(run) => Some(run),
            _ => None,
        })
        .collect();
    let before = runs
        .iter()
        .find(|run| run.text_start == 0)
        .expect("the run before the ruby");
    let column = runs
        .iter()
        .find(|run| run.text_start == 24)
        .expect("the ruby base");
    let after = runs
        .iter()
        .find(|run| run.text_start == 27)
        .expect("the run after the ruby");
    let share = before.justify_px;
    assert!(share > 0.0, "the line justifies: {share}");
    assert_eq!(
        column.justify_px, 0.0,
        "the spread base takes no interior share"
    );
    assert!(
        (column.rect.width - 18.40625).abs() < 1e-9,
        "the column is the annotation minus both overhangs: {}",
        column.rect.width
    );
    // The column's item ends on the layout grid without a share of its
    // own; the following ideograph's ink sits one deferred share right
    // of that edge.
    let column_end = column.rect.x + column.rect.width;
    assert!(
        (after.rect.x - (column_end + share)).abs() < 1e-9,
        "after the column: {} vs {column_end} + {share}",
        after.rect.x
    );
    // The boundary that ideograph leaves behind opens two shares (its
    // own before-share lands one boundary late) — the ink shift moved
    // no neighbour — and the line steps one share each from there.
    let next = runs
        .iter()
        .find(|run| run.text_start == 30)
        .expect("the run after that");
    assert!(
        (next.rect.x - (column_end + 16.0 + 2.0 * share)).abs() < 1e-6,
        "two shares after the first ideograph: {} vs {column_end} + 16 + 2 × {share}",
        next.rect.x
    );
    let steps: Vec<f64> = next.clusters.windows(2).map(|w| w[1].x - w[0].x).collect();
    assert!(
        steps
            .iter()
            .all(|step| (step - (16.0 + share)).abs() < 1e-4),
        "one share per boundary after it: {steps:?}"
    );
}
