use super::*;

/// #71 advance-sum autopsy: the b20 badge line replica. Truth
/// (b20-line.json, Range per-char): 14 chars 居然能一人給一套這麼合適的振袖 plus
/// note badge (w 13.671875) plus ，有錢人果然猛。… on a justified
/// 15.2px line of width 590.78125; the ， inks at 247.640625 from
/// the line start (= floor64 of the float cumulative). If the
/// engine's float basis (advances + share + atom accounting)
/// matches Blink's, its un-floored ， x must sit in [truth,
/// truth + 1/64).
#[test]
fn the_badge_line_replica_matches_the_truth_comma_position() {
    use rito_style_contract::{
        AlignItems, Clear, Float, JustifyContent, LayoutDisplay, LayoutDisplayInside,
        LayoutDisplayOutside, LayoutFormattingStyle, LayoutStyleTable, LengthPercentageOrAuto,
        ListMarkerStyle, MaximumHeight, MaximumSize, MinimumHeight, Overflow, PageBreak,
        PhysicalSides, Position, PreferredSize,
    };
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(1);
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("family list"),
        15.2,
        0.0,
    );
    style.text_flow.text_align = TextAlign::Justify;
    let style_id = inline.intern_for_node(0, style).expect("style interns");
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
    let items = vec![
        InlineItem::Text {
            text: "居然能一人給一套這麼合適的振袖".to_owned(),
            style: style_id,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        },
        InlineItem::Image {
            source: 0,
            src: "images/note.png".to_owned(),
            intrinsic_width: 13.671875,
            intrinsic_height: 13.671875,
            style: style_id,
            layout_style: image_layout,
            viewport: None,
            baseline_shift_px: 0.0,
            align_top: false,
            fit_contain: false,
            object_fit: rito_style_contract::ObjectFit::Fill,
        },
        InlineItem::Text {
            text: "，有錢人果然猛。不過鶴屋學姊不管做出什麼事好中中中中中".to_owned(),
            style: style_id,
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
        rito_fragment::FormattingTreeStyles { layout, inline },
    )
    .expect("inline tree builds");
    let outcome = context
        .layout(
            &tree,
            FormattingNodeId(0),
            &ConstraintSpace::continuous(590.78125),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root box");
    };
    let Fragment::Line(line) = &root.children[0] else {
        panic!("first line");
    };
    let mut comma_x = None;
    for child in &line.children {
        match child {
            Fragment::Text(run) => {
                eprintln!(
                    "[badge] run x={:.6} w={:.6} justify={:.6} bytes {}..{}",
                    run.rect.x, run.rect.width, run.justify_px, run.text_start, run.text_end
                );
                if run.text_start == 42 + 3 * 5 {
                    // byte offset of ，: 14 CJK chars × 3 bytes = 42?
                    // (computed below instead)
                }
            }
            Fragment::Image(image) => {
                eprintln!(
                    "[badge] atom x={:.6} w={:.6}",
                    image.rect.x, image.rect.width
                );
            }
            _ => {}
        }
    }
    // The ， is the first char of the third item: flow-text byte 45
    // (15 chars × 3 bytes; the atom adds no text bytes). Its fragment
    // x is the PAINT position — the justify pen shifts a deferred char's
    // ink one share right of its advance box — while the truth
    // (Range) measured the LAYOUT box, so the comparison subtracts
    // one share.
    let mut share = None;
    for child in &line.children {
        if let Fragment::Text(run) = child {
            if run.text_start == 0 {
                share = Some(run.justify_px);
            }
            if run.text_start == 45 {
                comma_x = Some(line.rect.x + run.rect.x);
            }
        }
    }
    let comma_x = comma_x.expect("， starts a run at byte 45");
    let share = share.expect("the first run carries the uniform share");
    let layout_x = comma_x - share;
    eprintln!("[badge] comma ink x = {comma_x:.6}, layout x = {layout_x:.6} (truth 247.640625)");
    assert!(
        (layout_x - 247.640625).abs() < 0.02,
        "the ，'s advance-box position must match the truth Range x, got {layout_x}"
    );
}

/// Adjacent fullwidth punctuation loses the blank half at the
/// boundary, exactly as pinned Chromium's default
/// `text-spacing-trim: normal` measures: each trimming pair shortens
/// the line by half an em, and non-trimming neighbours stay full.
#[test]
fn cjk_punctuation_pairs_trim_half_an_em() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let shape_width = |text: &str| {
        let mut inline = InlineStyleTable::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Generic(
                        rito_style_contract::GenericFontFamily::Serif,
                    )])
                    .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
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
                FormattingNodeId(0),
                &ConstraintSpace::continuous(10_000.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("inline outcome root is a box fragment");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first child is a line");
        };
        line.children
            .iter()
            .map(|child| child.rect().width)
            .sum::<f64>()
    };
    let plain = shape_width("春日春日春日");
    assert!(
        (plain - 96.0).abs() < 0.1,
        "six ideographs at 16px: {plain}"
    );
    // close + open: the open's blank left half collapses.
    let close_open = shape_width("春日。「春日");
    assert!(
        (close_open - (plain - 8.0)).abs() < 0.1,
        "close+open trims half an em: {close_open}"
    );
    // close + close: the first close's blank right half collapses.
    let close_close = shape_width("春日」。春日");
    assert!(
        (close_close - (plain - 8.0)).abs() < 0.1,
        "close+close trims half an em: {close_close}"
    );
    // A close against an ideograph keeps its full advance.
    let close_ideo = shape_width("春日。春日日");
    assert!(
        (close_ideo - plain).abs() < 0.1,
        "close+ideograph must not trim: {close_ideo}"
    );
    // A middle dot never trims itself.
    let middle = shape_width("春日・」春日");
    assert!(
        (middle - plain).abs() < 0.1,
        "middle dot before a close must not trim: {middle}"
    );
}

/// Consecutive forced breaks keep their empty line: Blink lays
/// `甲<br/><br/>乙` — and `甲<br/> <br/>乙`, whose interior space the
/// line-start collapse removes — as THREE lines, the middle one an
/// empty strut-height line (measured 2026-08-05: paragraph height 60
/// at line-height 20 for both shapes; the b39 calibre idiom).
#[test]
fn consecutive_forced_breaks_keep_an_empty_strut_line() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let lay = |text: &str| {
        let mut inline = InlineStyleTable::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Generic(
                        rito_style_contract::GenericFontFamily::Serif,
                    )])
                    .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
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
        context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds")
    };
    // The bridge canonicalizes `<br/> <br/>` to "\n\n" (the pending
    // space drops before the second break lands), so adjacent
    // newlines are the reachable stream.
    let outcome = lay("甲\n\n乙");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let heights: Vec<f64> = root
        .children
        .iter()
        .map(|line| line.rect().height)
        .collect();
    assert_eq!(
        heights.len(),
        3,
        "consecutive forced breaks lay three lines (middle empty), got {heights:?}"
    );
    assert!(
        (heights[1] - heights[0]).abs() < 0.5,
        "the empty middle line keeps the strut height: {heights:?}"
    );
}

/// Line-end conditional trim, the Blink `ShapeLine` extension: a
/// fullwidth closing bracket that is the first glyph past a soft break
/// to overflow stays on the line with its blank right half trimmed —
/// but only when the trimmed advance fits, only for the closing-bracket
/// and closing-quote classes, and only when a break is allowed after
/// it. css-text-4 `text-spacing-trim: normal`: closing punctuation is
/// set half-width at the end of the line "if it does not otherwise fit
/// prior to justification".
#[test]
fn line_end_closing_punctuation_trims_only_when_the_half_width_fits() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let lay_indent = |text: &str, width: f64, indent: f32| {
        let mut inline = InlineStyleTable::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Generic(
                        rito_style_contract::GenericFontFamily::Serif,
                    )])
                    .expect("family list"),
                    16.0,
                    indent,
                ),
            )
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
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
        context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(width),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds")
    };
    let lay = |text: &str, width: f64| lay_indent(text, width, 0.0);
    let ten = "永".repeat(10);

    // Ten ideographs fill 160px; the closer needs 176 full, 168
    // trimmed. At 170 the trimmed closer fits: the line keeps it.
    let text = format!("{ten}」永永永永永永");
    let outcome = lay(&text, 170.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(lines[0], format!("{ten}」"), "trimmed closer stays");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Line(first) = &root.children[0] else {
        panic!("first child is a line");
    };
    let first_width: f64 = first.children.iter().map(|child| child.rect().width).sum();
    assert!(
        (first_width - 168.0).abs() < 0.1,
        "the kept closer advances half an em: {first_width}"
    );

    // At 167 even the trimmed closer overflows: the line must break
    // early, dragging the kinsoku-chained ideograph down with it.
    let outcome = lay(&text, 167.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(
        lines[0],
        "永".repeat(9),
        "no trim when the half does not fit"
    );

    // At 176 the full-width closer fits: nothing is trimmed.
    let outcome = lay(&text, 176.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(lines[0], format!("{ten}」"));
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Line(first) = &root.children[0] else {
        panic!("first child is a line");
    };
    let first_width: f64 = first.children.iter().map(|child| child.rect().width).sum();
    assert!(
        (first_width - 176.0).abs() < 0.1,
        "a closer that fits keeps its full advance: {first_width}"
    );

    // The ideographic full stop is HanKerningCharType kDot, which
    // Blink's line-end gate excludes: no trim, the line breaks early.
    let text = format!("{ten}。永永永永永永");
    let outcome = lay(&text, 170.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(lines[0], "永".repeat(9), "kDot must not line-end trim");

    // A second closer forbids the break after the first: the extension
    // is rejected and the whole chain wraps.
    let text = format!("{ten}」」永永永永");
    let outcome = lay(&text, 170.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(
        lines[0],
        "永".repeat(9),
        "no extension without a break opportunity after the closer"
    );

    // With a text-indent (the long-paragraph shape that motivated
    // this), the first line's available advance shrinks by the indent
    // and the trim still applies within what remains.
    let text = format!("{ten}」永永永永永永");
    let outcome = lay_indent(&text, 202.0, 32.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(
        lines[0],
        format!("{ten}」"),
        "indent narrows the first line before the trim decision"
    );

    // A mixed-script dialogue line (real corpus paragraph): the Latin
    // run splits the shaping, the sentence ends in a pair-trimmed 。
    // followed by the line-end closing quote. Chromium holds this in
    // one line at 490px with a 32px indent; the trimmed ” must too.
    let text = "\u{201C}那是切嗣的本来面目的话．那我似乎惹得Master相当不快呢。\u{201D}";
    let outcome = lay_indent(text, 490.0, 32.0);
    let lines = line_texts(&outcome, text);
    assert_eq!(
        lines.len(),
        1,
        "mixed-script line with a trailing pair holds one line: {lines:?}"
    );

    // A whole unbreakable Latin word dragged down by its trailing
    // closer still extends: the candidate 」 sits TWELVE clusters
    // past the soft break (ten letters, the pair-trimmed 。, then
    // itself), far beyond the old 8-cluster scan cap (measured:
    // b20's 有點melancholy。」 packs onto the line with 。 at half
    // width and 」's blank half overflowing invisibly).
    let text = format!("{}melancholy。」", "永".repeat(20));
    let outcome = lay(&text, 430.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(
        lines.len(),
        1,
        "the trailing-punctuation extension reaches past a whole word: {lines:?}"
    );

    // A NEGATIVE indent (the hanging-indent idiom `text-indent: -1em;
    // padding-left: 1em`) out-dents the first line and widens its
    // advance by the same amount: at 160px with indent -16, the first
    // line holds eleven 16px ideographs starting at x = -16, the
    // continuation lines ten (measured on b19's `.po` footnotes:
    // first line one em left of the continuation lines).
    let text = "永".repeat(25);
    let outcome = lay_indent(&text, 160.0, -16.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(
        lines[0],
        "永".repeat(11),
        "the widened first line holds one extra ideograph"
    );
    assert_eq!(
        lines[1],
        "永".repeat(10),
        "continuation lines are unwidened"
    );
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Line(first_line) = &root.children[0] else {
        panic!("first child is a line");
    };
    assert!(
        (first_line.rect.x - (-16.0)).abs() < 0.1,
        "the first line box out-dents into the padding: x={}",
        first_line.rect.x
    );
}

/// The same must hold for CJK text: a named face whose ideograph
/// advance differs from the pinned fallback's has to win shaping when
/// the style names it. This is the exact 86 body-text shape.
#[test]
fn named_cjk_publication_fonts_shape_instead_of_the_pinned_fallback() {
    let kai = std::env::var("RITO_TEST_CJK_FONT")
        .ok()
        .and_then(|path| std::fs::read(path).ok());
    let Some(kai) = kai else {
        eprintln!("RITO_TEST_CJK_FONT not set; skipping");
        return;
    };
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let mut context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    context
        .register_named_font("FZWBKS", kai)
        .expect("named font registers");
    let shape_width = |families: Vec<FontFamily>| {
        let mut inline = InlineStyleTable::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(FontFamilies::new(families).expect("family list"), 16.0, 0.0),
            )
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "在那座战场上没有任何阵亡者".to_owned(),
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
                &ConstraintSpace::continuous(10_000.0),
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
        line.children
            .iter()
            .map(|child| child.rect().width)
            .sum::<f64>()
    };
    let named = shape_width(vec![FontFamily::Named(FontFamilyName::new("FZWBKS"))]);
    let fallback = shape_width(vec![FontFamily::Named(FontFamilyName::new("NoSuchFace"))]);
    eprintln!("named {named} fallback {fallback}");
    assert!(
        (named - fallback).abs() > 0.5,
        "the named CJK face must shape differently: named {named}, fallback {fallback}"
    );
}

#[test]
fn layout_is_deterministic_and_cache_replayable() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (tree, _) = paragraph_tree(SAMPLE, 0.0);
    let space = ConstraintSpace::continuous(200.0);
    let cancel = CancelFlag::new();
    let first = context
        .layout(&tree, tree.root(), &space, None, &cancel)
        .expect("first layout");
    let second = context
        .layout(&tree, tree.root(), &space, None, &cancel)
        .expect("second layout");
    assert_eq!(first, second);

    let mut cache = FragmentCache::new(1 << 20);
    let computed = cache
        .layout(&context, &tree, tree.root(), &space, None, &cancel)
        .expect("cache fill");
    assert!(!computed.from_cache);
    let replayed = cache
        .layout(&context, &tree, tree.root(), &space, None, &cancel)
        .expect("cache replay");
    assert!(replayed.from_cache);
    assert_eq!(replayed.outcome, first);
}

#[test]
fn line_geometry_is_positive_and_stacked() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (tree, _) = paragraph_tree(SAMPLE, 0.0);
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
    assert!(root.rect.height > 0.0);
    let mut previous_top = f64::NEG_INFINITY;
    for line in &root.children {
        let Fragment::Line(line) = line else {
            panic!("children are lines");
        };
        assert!(line.rect.height > 0.0);
        assert!(line.rect.width > 0.0);
        assert!(line.baseline > 0.0 && line.baseline <= line.rect.height);
        assert!(line.rect.y > previous_top);
        previous_top = line.rect.y;
    }
}

#[test]
fn first_line_indent_narrows_only_the_first_line() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (plain_tree, text) = paragraph_tree(SAMPLE, 0.0);
    let (indented_tree, _) = paragraph_tree(SAMPLE, 32.0);
    let space = ConstraintSpace::continuous(200.0);
    let cancel = CancelFlag::new();
    let plain = context
        .layout(&plain_tree, plain_tree.root(), &space, None, &cancel)
        .expect("plain layout");
    let indented = context
        .layout(&indented_tree, indented_tree.root(), &space, None, &cancel)
        .expect("indented layout");
    let plain_lines = line_texts(&plain, &text);
    let indented_lines = line_texts(&indented, &text);
    assert_eq!(indented_lines.concat(), text);
    assert!(
        indented_lines[0].len() < plain_lines[0].len(),
        "indent must shorten the first line: {:?} vs {:?}",
        indented_lines[0],
        plain_lines[0]
    );
}

#[test]
fn fragmented_space_and_break_tokens_fail_closed() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (tree, _) = paragraph_tree(SAMPLE, 0.0);
    let cancel = CancelFlag::new();
    assert!(matches!(
        context.layout(
            &tree,
            tree.root(),
            &ConstraintSpace::fragmented(200.0, 400.0),
            None,
            &cancel
        ),
        Err(LayoutError::Invalid(_))
    ));
    let token = BreakToken {
        resume_path: vec![FormattingNodeId(0)],
        stage: BreakTokenStage::Before,
        pending_floats: Vec::new(),
    };
    assert!(matches!(
        context.layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(200.0),
            Some(&token),
            &cancel
        ),
        Err(LayoutError::Invalid(_))
    ));
}

#[test]
fn cancellation_and_non_inline_roots_fail_closed() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (tree, _) = paragraph_tree(SAMPLE, 0.0);
    let cancelled = CancelFlag::new();
    cancelled.cancel();
    assert_eq!(
        context.layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(200.0),
            None,
            &cancelled
        ),
        Err(LayoutError::Cancelled)
    );

    let block_tree = FormattingTree::new(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::BlockContainer,
            children: Vec::new(),
        }],
        FormattingNodeId(0),
    )
    .expect("block tree builds");
    assert!(matches!(
        context.layout(
            &block_tree,
            block_tree.root(),
            &ConstraintSpace::continuous(200.0),
            None,
            &CancelFlag::new()
        ),
        Err(LayoutError::Invalid(_))
    ));
}

#[test]
fn intrinsic_sizes_are_ordered_and_positive() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (tree, _) = paragraph_tree(SAMPLE, 0.0);
    let sizes = context
        .intrinsic_inline_sizes(&tree, FormattingNodeId(0))
        .expect("intrinsic sizes");
    assert!(sizes.min_content > 0.0);
    assert!(sizes.max_content >= sizes.min_content);
    let wide = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(sizes.max_content + 1.0),
            None,
            &CancelFlag::new(),
        )
        .expect("unconstrained layout");
    let Fragment::Box(root) = &wide.fragments.root else {
        panic!("root is a box");
    };
    assert_eq!(root.children.len(), 1, "max-content width fits one line");
}

#[test]
fn text_indent_joins_intrinsic_widths() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (plain_tree, _) = paragraph_tree(SAMPLE, 0.0);
    let plain = context
        .intrinsic_inline_sizes(&plain_tree, FormattingNodeId(0))
        .expect("plain sizes");
    let (indented_tree, _) = paragraph_tree(SAMPLE, 32.0);
    let indented = context
        .intrinsic_inline_sizes(&indented_tree, FormattingNodeId(0))
        .expect("indented sizes");
    assert!(
        (indented.max_content - plain.max_content - 32.0).abs() < 0.01,
        "max-content grows by the indent: {} vs {}",
        indented.max_content,
        plain.max_content
    );
    assert!(
        (indented.min_content - plain.min_content - 32.0).abs() < 0.01,
        "min-content grows by the indent: {} vs {}",
        indented.min_content,
        plain.min_content
    );
}

/// A trailing U+00A0 stays in max-content while a trailing SPACE
/// leaves it (measured on Chromium float shrink-to-fit boxes: the
/// nbsp-tailed chat bubble keeps its nbsp's width, the space-tailed
/// control drops it).
#[test]
fn a_trailing_nbsp_stays_in_max_content_and_a_space_leaves() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (bare_tree, _) = paragraph_tree("WWWW\nii", 0.0);
    let bare = context
        .intrinsic_inline_sizes(&bare_tree, FormattingNodeId(0))
        .expect("bare sizes");
    let (space_tree, _) = paragraph_tree("WWWW \nii", 0.0);
    let spaced = context
        .intrinsic_inline_sizes(&space_tree, FormattingNodeId(0))
        .expect("space sizes");
    let (nbsp_tree, _) = paragraph_tree("WWWW\u{a0}\nii", 0.0);
    let nbsp = context
        .intrinsic_inline_sizes(&nbsp_tree, FormattingNodeId(0))
        .expect("nbsp sizes");
    // The trimmed space's kern against the preceding letter stays
    // (the shaped W narrowed by the W+space pair), so the spaced
    // control can sit a fraction UNDER the bare one — never above.
    assert!(
        spaced.max_content <= bare.max_content + 0.01,
        "a trailing space leaves max-content: {} vs {}",
        spaced.max_content,
        bare.max_content
    );
    assert!(
        nbsp.max_content > bare.max_content + 3.0,
        "a trailing nbsp stays in max-content: {} vs {}",
        nbsp.max_content,
        bare.max_content
    );
}

#[test]
fn empty_font_registration_fails_closed() {
    assert!(ParleyInlineContext::new(vec![vec![0_u8; 4]]).is_err());
}

#[test]
fn an_atomic_inline_expands_before_but_defers_after() {
    // Measured against a Chromium badge-line justify map (2026-08-13):
    // the [text|atom] boundary expands (the badge sits at the END of
    // the preceding run's EXPANDED advance), but the atom is
    // NON-expansive on its trailing side — [atom|，] carries ZERO and
    // the comma's deferred before-share lands one boundary late
    // (，|next carries TWO). The total stays 4, so the share value is
    // unchanged; only the comma's own x shifts one share left.
    let text = "中中，中";
    let atoms = vec![6usize];
    let plan = line_justify_plan(text, 0..text.len(), 5.0, &[], &atoms).expect("plan builds");
    assert_eq!(
        plan.share, 1.25,
        "4 opportunities: deferral keeps the total"
    );
    assert_eq!(plan.count_at(3), 1);
    assert_eq!(
        plan.count_at(6),
        1,
        "only the [text|atom] boundary at the comma's key; [atom|，] defers"
    );
    assert_eq!(
        plan.count_at(9),
        2,
        "the deferred share lands after the comma"
    );
    assert_eq!(
        plan.atom_shares_at(6, 0),
        Some(2),
        "one share before the atom plus its own left boundary"
    );
    let control =
        line_justify_plan(text, 0..text.len(), 5.0, &[], &[]).expect("control plan builds");
    assert_eq!(
        control.share,
        5.0 / 3.0,
        "without the atom: 3 opportunities"
    );
}
