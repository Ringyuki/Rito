use super::*;

#[test]
fn a_super_shifted_span_sizes_the_line_by_its_shifted_line_shape() {
    // A real book's 0.8em bold ① marker line in a 20.796875px paragraph
    // measures 26.125 in Chromium. The span's box is its primary font's
    // whole-pixel ascent and descent with the floored half-leading of the
    // inherited line-height, raised floor64(16/3) + 1 = 6.328125: Tinos
    // at 12.8px is 11/3, so the span reaches 14 + 6.328125 above the
    // baseline, and the strut text keeps 5.796875 below it.
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
    let outcome = context
        .layout(
            &tree,
            FormattingNodeId(0),
            &constraint,
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Line(line) = &root.children[0] else {
        panic!("first child is a line");
    };
    assert_eq!(
        line.rect.height, 26.125,
        "the shifted-span line shape sizes the line"
    );
}

#[test]
fn a_super_shifted_marker_image_grows_the_line_with_a_consistent_baseline() {
    // The duokan footnote-marker construct (book 4, Section001 p11):
    // fixed 19.2px strut over Source Han (grid 18/5 at 16px), one
    // image 14.390625px tall raised 6.328125px (the sup rule at a
    // 16px parent). The expectations are the CSS 2.1 §10.8
    // contributions model over these font metrics; the
    // pixel oracle validates the same model end-to-end against Blink
    // with the production metric set (the page diffs to zero).
    use rito_style_contract::{
        AlignItems, Clear, Float, JustifyContent, LayoutDisplay, LayoutDisplayInside,
        LayoutDisplayOutside, LayoutFormattingStyle, LayoutStyleTable, LengthPercentageOrAuto,
        ListMarkerStyle, MaximumSize, MinimumSize, Overflow, PageBreak, PhysicalSides, Position,
        PreferredSize,
    };
    let context = ParleyInlineContext::new(vec![source_han_bytes()]).expect("context builds");
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
                border_widths: rito_style_contract::PhysicalSides::uniform(
                    rito_style_contract::NonNegativeCssPx::ZERO,
                ),
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
                min_height: MinimumSize::Auto,
                min_width: MinimumSize::Auto,
                writing_mode: rito_style_contract::WritingMode::HorizontalTopToBottom,
                direction: rito_style_contract::Direction::LeftToRight,
                max_height: MaximumSize::None,
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
    // Contributions: the sup strut (fixed 19.203125 at 12px over Source
    // Han's 14/3 grid, baseline 15) raised 6.328125 wins over the
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
        ListMarkerStyle, MaximumSize, MinimumSize, Overflow, PageBreak, PhysicalSides, Position,
        PreferredSize,
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
                border_widths: rito_style_contract::PhysicalSides::uniform(
                    rito_style_contract::NonNegativeCssPx::ZERO,
                ),
                box_sizing: rito_style_contract::BoxSizing::ContentBox,
                justify_content: JustifyContent::Normal,
                align_items: AlignItems::Normal,
                break_before: PageBreak::Auto,
                break_after: PageBreak::Auto,
                width: PreferredSize::Auto,
                height: PreferredSize::Auto,
                max_width: MaximumSize::None,
                min_height: MinimumSize::Auto,
                min_width: MinimumSize::Auto,
                writing_mode: rito_style_contract::WritingMode::HorizontalTopToBottom,
                direction: rito_style_contract::Direction::LeftToRight,
                max_height: MaximumSize::None,
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

/// A ruby base longer than four glyphs splits across lines like plain CJK
/// text (measured: 黄金妖精/Leprechaun wraps as 黄金妖|精 — every base
/// character boundary is an ordinary break point; the annotation itself
/// rides only the first segment, which the paint layer enforces), while a
/// base of at most four glyphs under an annotation of at most eight is one
/// unit that moves down whole (Blink's `IsMonolithicRuby`), glyphs counted
/// as shaped: か with a combining voiced mark is one. Chromium's DOM at
/// 32px in a 165px line: 中中中中中|文中文中, 中中中中|中文,
/// 中中中中|かが(combining)かか and 中中中中か|かかかか.
#[test]
fn a_ruby_base_breaks_across_lines_like_plain_text() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let lines = |base: &str| {
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
                        text: base.to_owned(),
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
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(165.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        line_texts(&outcome, &format!("中中中中{base}"))
    };
    assert_eq!(
        lines("中文中文中"),
        vec!["中中中中中".to_owned(), "文中文中".to_owned()],
        "a long annotated base breaks at an ordinary character boundary"
    );
    assert_eq!(
        lines("中文"),
        vec!["中中中中".to_owned(), "中文".to_owned()],
        "a short ruby moves down whole"
    );
    assert_eq!(
        lines("かか\u{3099}かか"),
        vec!["中中中中".to_owned(), "かか\u{3099}かか".to_owned()],
        "five characters shaped into four glyphs are a short ruby"
    );
    assert_eq!(
        lines("かかかかか"),
        vec!["中中中中か".to_owned(), "かかかか".to_owned()],
        "a base of five glyphs breaks"
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
    let runs = placed(line.children.iter().filter_map(|child| match child {
        Fragment::Text(run) => Some(run),
        _ => None,
    }));
    let before = runs
        .iter()
        .find(|piece| piece.text_start == 0)
        .expect("the run before the ruby");
    let column = runs
        .iter()
        .find(|piece| piece.text_start == 24)
        .expect("the ruby base")
        .run;
    let after = runs
        .iter()
        .find(|piece| piece.text_start == 27)
        .expect("the run after the ruby");
    let share = before.run.justify_px;
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
        (after.x - (column_end + share)).abs() < 1e-9,
        "after the column: {} vs {column_end} + {share}",
        after.x
    );
    // The boundary that ideograph leaves behind opens two shares (its
    // own before-share lands one boundary late) — the ink shift moved
    // no neighbour — and the line steps one share each from there.
    let next = runs
        .iter()
        .find(|piece| piece.text_start == 30)
        .expect("the run after that");
    assert!(
        (next.x - (column_end + 16.0 + 2.0 * share)).abs() < 1e-6,
        "two shares after the first ideograph: {} vs {column_end} + 16 + 2 × {share}",
        next.x
    );
    let steps: Vec<f64> = next.clusters.windows(2).map(|w| w[1].x - w[0].x).collect();
    assert!(
        steps
            .iter()
            .all(|step| (step - (16.0 + share)).abs() < 1e-4),
        "one share per boundary after it: {steps:?}"
    );
}

/// An inline image's layout style: auto-sized, in flow, unpadded.
fn plain_image_layout(layout: &mut LayoutStyleTable) -> rito_style_contract::LayoutStyleId {
    use rito_style_contract::{
        AlignItems, Clear, Float, JustifyContent, LayoutDisplay, LayoutDisplayInside,
        LayoutDisplayOutside, LayoutFormattingStyle, ListMarkerStyle, MaximumSize, MinimumSize,
        Overflow, PageBreak, Position, PreferredSize,
    };
    let auto = LengthPercentageOrAuto::Auto;
    let zero =
        NonNegativeLengthPercentage::new(LengthPercentage::Length(CssPx::new(0.0).expect("zero")));
    let zero_px = rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero");
    layout
        .intern_for_node(
            0,
            LayoutFormattingStyle {
                display: LayoutDisplay {
                    outside: LayoutDisplayOutside::Inline,
                    inside: LayoutDisplayInside::Flow,
                    is_list_item: false,
                },
                margin: sides(auto),
                padding: sides(zero),
                border_widths: rito_style_contract::PhysicalSides::uniform(
                    rito_style_contract::NonNegativeCssPx::ZERO,
                ),
                box_sizing: rito_style_contract::BoxSizing::ContentBox,
                justify_content: JustifyContent::Normal,
                align_items: AlignItems::Normal,
                break_before: PageBreak::Auto,
                break_after: PageBreak::Auto,
                width: PreferredSize::Auto,
                height: PreferredSize::Auto,
                max_width: MaximumSize::None,
                min_height: MinimumSize::Auto,
                min_width: MinimumSize::Auto,
                writing_mode: rito_style_contract::WritingMode::HorizontalTopToBottom,
                direction: rito_style_contract::Direction::LeftToRight,
                max_height: MaximumSize::None,
                clear: Clear::None,
                float: Float::None,
                overflow: Overflow::Visible,
                list_style_type: ListMarkerStyle::None,
                position: Position::Static,
                inset: sides(auto),
                vertical_align: rito_style_contract::CellVerticalAlign::Baseline,
                border_spacing: (zero_px, zero_px),
                border_collapse: false,
                object_fit: rito_style_contract::ObjectFit::Fill,
            },
        )
        .expect("layout style interns")
}

/// A line rewound to the start of a ruby item holds everything before
/// that item, an inline image included: the rewind held a count of the
/// text characters before the item, and the breaker counts an image as
/// one, so the line ended one character early and the image went down
/// with the ruby.
#[test]
fn a_ruby_split_rewind_keeps_an_image_before_the_ruby_on_the_line() {
    let context = ParleyInlineContext::new(vec![source_han_bytes()]).expect("context builds");
    let style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        32.0,
        0.0,
    );
    let mut inline = InlineStyleTable::new(1);
    let interned = inline.intern_for_node(0, style).expect("style interns");
    let mut layout = LayoutStyleTable::new(1);
    let image_layout = plain_image_layout(&mut layout);
    let items = vec![
        InlineItem::Text {
            text: "中中".to_owned(),
            style: interned,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        },
        InlineItem::Image {
            source: 0,
            src: "images/note.png".to_owned(),
            intrinsic_width: 32.0,
            intrinsic_height: 32.0,
            style: interned,
            layout_style: image_layout,
            fit_contain: false,
            viewport: None,
            baseline_shift_px: 0.0,
            align_top: false,
            object_fit: rito_style_contract::ObjectFit::Fill,
        },
        InlineItem::Text {
            text: "中文中".to_owned(),
            style: interned,
            baseline_shift_px: 0.0,
            ruby_annotation: Some(rito_fragment::RubyAnnotation {
                text: "wwwwww".to_owned(),
                size_ratio: 0.5,
                align: rito_style_contract::RubyAlign::SpaceAround,
            }),
        },
    ];
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles { layout, inline },
    )
    .expect("inline tree builds");
    // The geometry of the rewind above with an image for one lead glyph.
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(165.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let text = "中中中文中";
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    // Each line as its text, an image as `▣`.
    let lines: Vec<String> = root
        .children
        .iter()
        .map(|line| {
            let Fragment::Line(line) = line else {
                panic!("a line");
            };
            line.children
                .iter()
                .map(|child| match child {
                    Fragment::Text(run) => {
                        text[run.text_start as usize..run.text_end as usize].to_owned()
                    }
                    Fragment::Image(_) => "▣".to_owned(),
                    _ => String::new(),
                })
                .collect()
        })
        .collect();
    assert_eq!(lines, vec!["中中▣".to_owned(), "中文中".to_owned()]);
}

/// A justified paragraph aligns a wide-annotation ruby's base to the
/// line's start edge and a justified line's base to its end edge, where
/// elsewhere it sits centered under the annotation (Blink's
/// `ApplyRubyAlign`; measured in pinned Chromium on a 150px line of 16px
/// ideographs with 瞬 under しゅん: the base inks at the line start in a
/// justified paragraph, its first and last lines alike, 4px in under
/// start alignment, and 8px past its column's start at a justified
/// line's end).
#[test]
fn a_justified_line_aligns_a_wide_ruby_base_to_its_edges() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    // The painted start of the ruby base on each line holding it.
    let base_starts = |before: &str, after: &str, align: TextAlign| -> Vec<f64> {
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            16.0,
            0.0,
        );
        style.text_flow.text_align = align;
        let mut inline = InlineStyleTable::new(1);
        let style = inline.intern_for_node(0, style).expect("style interns");
        let text = |t: &str| InlineItem::Text {
            text: t.to_owned(),
            style,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        };
        let mut items = Vec::new();
        if !before.is_empty() {
            items.push(text(before));
        }
        items.push(InlineItem::Text {
            text: "瞬".to_owned(),
            style,
            baseline_shift_px: 0.0,
            ruby_annotation: Some(rito_fragment::RubyAnnotation {
                text: "しゅん".to_owned(),
                size_ratio: 0.5,
                align: RubyAlign::SpaceAround,
            }),
        });
        items.push(text(after));
        let base_start = before.len() as u32;
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
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(150.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("inline outcome root is a box fragment");
        };
        root.children
            .iter()
            .filter_map(|child| match child {
                Fragment::Line(line) => Some(line),
                _ => None,
            })
            .flat_map(|line| {
                line.children.iter().filter_map(move |child| match child {
                    Fragment::Text(run) if run.text_start == base_start => {
                        Some(line.rect.x + run.rect.x + run.ruby_center_shift_px)
                    }
                    _ => None,
                })
            })
            .collect()
    };
    let rest = "一二三四五六七八九十一二三四五六七八九十";
    let at = |starts: Vec<f64>, expected: f64, case: &str| {
        assert_eq!(starts.len(), 1, "{case}: one base run: {starts:?}");
        assert!(
            (starts[0] - expected).abs() < 1e-6,
            "{case}: base at {} vs {expected}",
            starts[0]
        );
    };
    at(
        base_starts("", rest, TextAlign::Justify),
        0.0,
        "first line start, justified",
    );
    at(
        base_starts("", rest, TextAlign::Left),
        4.0,
        "line start, start-aligned",
    );
    at(
        base_starts(
            "一二三四五六七八",
            "九十一二三四五六七八九十",
            TextAlign::Justify,
        ),
        132.0,
        "justified line end",
    );
    at(
        base_starts(
            "一二三四五六七八",
            "九十一二三四五六七八九十",
            TextAlign::Left,
        ),
        128.0,
        "start-aligned line end",
    );
    at(
        base_starts("一二三四五六七八九", "十", TextAlign::Justify),
        0.0,
        "last line start, justified",
    );
}
