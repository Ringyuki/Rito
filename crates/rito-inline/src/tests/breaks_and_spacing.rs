use super::*;

#[test]
fn narrow_advance_breaks_into_multiple_reassemblable_lines() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let (tree, text) = paragraph_tree(SAMPLE, 0.0);
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(160.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let lines = line_texts(&outcome, &text);
    assert!(lines.len() > 2, "expected multiple lines, got {lines:?}");
    assert_eq!(lines.concat(), text);
    assert!(outcome.continuation.is_none());
}

/// `word-break: break-all` splits the CJK novel dash pair ──
/// (U+2500) across the line boundary like Blink (b93 truth: the
/// first ─ closes the line, the second opens the next). The latin
/// and prolonged-sound cases pin Parley's own break-all relaxation
/// so a parley upgrade that regresses them is caught here.
#[test]
fn break_all_splits_the_dash_pair_and_keeps_parley_relaxations() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    for text in ["中中──中中", "中中ab中中", "中中ずー中中"] {
        let mut style = plain_paragraph_style(
            rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
                "NoSuchFace",
            ))])
            .expect("family list"),
            16.0,
            0.0,
        );
        style.text_flow.word_break = rito_style_contract::WordBreak::BreakAll;
        let mut inline = InlineStyleTable::new(1);
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style: style_id,
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
        let natural = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(10_000.0),
                None,
                &CancelFlag::new(),
            )
            .expect("natural layout succeeds");
        let Fragment::Box(root) = &natural.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first child is a line");
        };
        let full_width: f64 = line.children.iter().map(|child| child.rect().width).sum();
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(full_width * 3.0 / 6.0 + 0.5),
                None,
                &CancelFlag::new(),
            )
            .expect("narrow layout succeeds");
        let lines = line_texts(&outcome, text);
        match text {
            "中中──中中" => assert_eq!(
                lines,
                vec!["中中─".to_owned(), "─中中".to_owned()],
                "break-all must split the dash pair"
            ),
            "中中ab中中" => assert_eq!(lines.first().map(String::as_str), Some("中中a")),
            _ => assert_eq!(lines.first().map(String::as_str), Some("中中ず")),
        }
    }
}

/// The reader page clamp scales the authored box UNIFORMLY: a
/// 705x1000 cover under `img { width: 100% }` resolves 640x907.8 and
/// shrinks to 599.25x850 — never the axis-independent squash to
/// 640x850 that stretched b52's cover in the reader.
/// A trailing U+3000 run HANGS at the line end: excluded from
/// centered/right alignment (while shrink-to-fit boxes keep it —
/// u3000-hang oracle, b52 Next-2-w: the table box spans 的+3 U+3000
/// wide, yet Blink inks 的 dead-centre; parley only excludes its own
/// ASCII whitespace class, which the control rows pin).
#[test]
fn a_trailing_ideographic_space_run_hangs_out_of_alignment() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let line_x = |text: &str, align: TextAlign| -> f64 {
        let mut style = plain_paragraph_style(
            rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
                "NoSuchFace",
            ))])
            .expect("family list"),
            40.0,
            0.0,
        );
        style.text_flow.text_align = align;
        let mut inline = InlineStyleTable::new(1);
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style: style_id,
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
                &ConstraintSpace::continuous(640.0),
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
        let Some(Fragment::Text(run)) = line.children.first() else {
            panic!("line has a text run");
        };
        // The NET paint position (line + child) is the observable —
        // the first landing shifted the line box while the children
        // compensated against it, cancelling to a pixel-null.
        line.rect.x + run.rect.x
    };
    let bare = line_x("\u{7684}", TextAlign::Center);
    // Three trailing U+3000 leave the centering: the glyph inks where
    // the bare control does. Before the law the line centered at
    // (640-160)/2 = 240, sixty pixels left of the truth.
    let hung = line_x("\u{7684}\u{3000}\u{3000}\u{3000}", TextAlign::Center);
    assert!(
        (hung - bare).abs() < 1e-3,
        "centered line must ignore the hung tail: bare {bare}, hung {hung}"
    );
    // Parley already drops trailing ASCII spaces — the shift must not
    // double-count them.
    let ascii = line_x("\u{7684}   ", TextAlign::Center);
    assert!(
        (ascii - bare).abs() < 1e-3,
        "ascii trailing spaces stay parley's own: bare {bare}, ascii {ascii}"
    );
    // Right alignment hangs the tail past the edge: 的 stays flush.
    let right_bare = line_x("\u{7684}", TextAlign::Right);
    let right_hung = line_x("\u{7684}\u{3000}", TextAlign::Right);
    assert!(
        (right_hung - right_bare).abs() < 1e-3,
        "right-aligned line must hang the tail: bare {right_bare}, hung {right_hung}"
    );
}

#[test]
fn the_b52_title_cell_centers_its_ink_with_the_tail_hung() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(4);
    let families = || {
        rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
            "NoSuchFace",
        ))])
        .expect("family list")
    };
    let mut items = Vec::new();
    for (index, (text, size)) in [
        ("为", 40.0),
        ("美", 48.0),
        ("好", 48.0),
        ("的\u{3000}\u{3000}\u{3000}", 40.0),
    ]
    .into_iter()
    .enumerate()
    {
        let mut style = plain_paragraph_style(families(), size, 0.0);
        style.text_flow.text_align = TextAlign::Center;
        let style_id = inline.intern_for_node(index, style).expect("style interns");
        items.push(InlineItem::Text {
            text: text.to_owned(),
            style: style_id,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        });
    }
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow { items },
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
            &ConstraintSpace::continuous(319.055),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!()
    };
    let Fragment::Line(line) = &root.children[0] else {
        panic!()
    };
    let Some(Fragment::Text(first)) = line.children.first() else {
        panic!("line has runs");
    };
    // Cell width 319.055 (parley fit epsilon rides the container),
    // content 296 with a 120px hung tail: the visible ink centers at
    // (319.055 - (296 - 120)) / 2 = 71.5 — the b52 truth puts 为 at
    // page 282 = table 210.47 + 71.5.
    let net = line.rect.x + first.rect.x;
    assert!(
        (net - 71.535).abs() < 0.02,
        "为 must ink at the hang-centered offset, got {net}"
    );
}

/// Observation (b74 title writer cards): four adjacent bordered spans
/// (`border: 1px; margin-right: 3px`, one 25px CJK glyph each) raster
/// in Blink as 27px boxes at a 30px pitch. The pixel walk measured the
/// engine's NON-FINAL cards 4px narrow (dark 21 vs 25) at a 26px
/// pitch, the final card exact — this prints the run rects to locate
/// where the 4px goes missing.
#[test]
fn observe_adjacent_bordered_span_run_boxes() {
    use rito_style_contract::{BorderEdge, BorderStyle, NonNegativeCssPx};
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(4);
    let families = || {
        rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
            "NoSuchFace",
        ))])
        .expect("family list")
    };
    let mut items = Vec::new();
    for (index, text) in ["瑞", "智", "士", "记"].into_iter().enumerate() {
        let mut style = plain_paragraph_style(families(), 25.0, 0.0);
        style.text_flow.text_align = TextAlign::Right;
        let edge = BorderEdge {
            resolved_width: NonNegativeCssPx::new(1.0).expect("one px"),
            style: BorderStyle::Solid,
            color: style.paint.foreground.into(),
        };
        style.fragment.border = rito_style_contract::BorderEdges {
            top: edge,
            right: edge,
            bottom: edge,
            left: edge,
        };
        style.fragment.margin.right = rito_style_contract::LengthPercentageOrAuto::Value(
            LengthPercentage::Length(rito_style_contract::CssPx::new(3.0).expect("finite")),
        );
        let style_id = inline.intern_for_node(index, style).expect("style interns");
        items.push(InlineItem::Text {
            text: text.to_owned(),
            style: style_id,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        });
    }
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow { items },
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
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!()
    };
    let Fragment::Line(line) = &root.children[0] else {
        panic!()
    };
    let mut runs: Vec<(f64, f64)> = Vec::new();
    for child in &line.children {
        if let Fragment::Text(run) = child {
            eprintln!(
                "[cards] run x={:.3} w={:.3} net_x={:.3}",
                run.rect.x,
                run.rect.width,
                line.rect.x + run.rect.x
            );
            runs.push((line.rect.x + run.rect.x, run.rect.width));
        }
    }
    assert_eq!(runs.len(), 4, "four card runs");
    // Blink: each card's painted box is glyph 25 + 2×1 border = 27,
    // pitch 30 (27 + 3 margin). The run rect is the CONTENT box (25
    // wide); the pen grows it by the border for paint. Every card —
    // not just the last — keeps its full 25px content width.
    for (index, (_, width)) in runs.iter().enumerate() {
        assert!(
            (width - 25.0).abs() < 0.05,
            "card {index} content box must be 25 wide, got {width}"
        );
    }
    let pitch0 = runs[1].0 - runs[0].0;
    assert!(
        (pitch0 - 30.0).abs() < 0.05,
        "card pitch must be 30 (27 box + 3 margin), got {pitch0}"
    );
}

#[test]
fn observe_symbol_fallback_advances() {
    let tinos = tinos_bytes();
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![tinos, source_han]).expect("context builds");
    let text = "解决○∠五世代";
    let style = plain_paragraph_style(
        rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
            "NoSuchFace",
        ))])
        .expect("family list"),
        16.0,
        0.0,
    );
    let mut inline = InlineStyleTable::new(1);
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: text.to_owned(),
                style: style_id,
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
            &ConstraintSpace::continuous(640.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!()
    };
    let Fragment::Line(line) = &root.children[0] else {
        panic!()
    };
    for child in &line.children {
        if let Fragment::Text(run) = child {
            eprintln!(
                "[sym] '{}' x={:.4} w={:.4}",
                &text[run.text_start as usize..run.text_end as usize],
                run.rect.x,
                run.rect.width
            );
        }
    }
}

/// An inline horizontal margin displaces the inline box —
/// and a span opening a forced-break line indents its OWN line by
/// the lead (inline-margin oracle: margin-left 30% in a 100px block
/// puts the box at x=30 on the span's line, the previous line
/// untouched; the engine previously either rejected the style outright
/// or would have widened the line above).
#[test]
fn an_inline_margin_indents_its_forced_break_line() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(2);
    let families = || {
        rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
            "NoSuchFace",
        ))])
        .expect("family list")
    };
    let plain = inline
        .intern_for_node(0, plain_paragraph_style(families(), 32.0, 0.0))
        .expect("style interns");
    let mut badge_style = plain_paragraph_style(families(), 22.4, 0.0);
    badge_style.fragment.margin.left =
        rito_style_contract::LengthPercentageOrAuto::Value(LengthPercentage::Percentage(
            rito_style_contract::Percentage::from_ratio(0.3).expect("finite ratio"),
        ));
    let badge = inline
        .intern_for_node(1, badge_style)
        .expect("style interns");
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![
                InlineItem::Text {
                    text: "王\n".to_owned(),
                    style: plain,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
                InlineItem::Text {
                    text: "的".to_owned(),
                    style: badge,
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
            &ConstraintSpace::continuous(100.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let line_net = |line: &Fragment| -> f64 {
        let Fragment::Line(line) = line else {
            panic!("line fragment");
        };
        let Some(Fragment::Text(run)) = line.children.first() else {
            panic!("line has a run");
        };
        line.rect.x + run.rect.x
    };
    assert!(
        line_net(&root.children[0]).abs() < 1e-3,
        "the line above stays flush, got {}",
        line_net(&root.children[0])
    );
    assert!(
        (line_net(&root.children[1]) - 30.0).abs() < 1e-3,
        "the badge line indents by 30% of the container, got {}",
        line_net(&root.children[1])
    );
}

#[test]
fn the_page_clamp_scales_the_authored_image_box_uniformly() {
    use rito_style_contract::{
        AlignItems, Clear, Float, JustifyContent, LayoutDisplay, LayoutDisplayInside,
        LayoutDisplayOutside, LayoutFormattingStyle, LengthPercentageOrAuto, ListMarkerStyle,
        MaximumHeight, MaximumSize, MinimumHeight, Overflow, PageBreak, PhysicalSides, Position,
        PreferredSize,
    };
    let auto = LengthPercentageOrAuto::Auto;
    let zero_padding =
        NonNegativeLengthPercentage::new(LengthPercentage::Length(CssPx::new(0.0).expect("zero")));
    let style = LayoutFormattingStyle {
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
        width: PreferredSize::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(
                rito_style_contract::Percentage::from_ratio(1.0).expect("finite"),
            ),
        )),
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
    };
    let (width, height) = image_display_size(
        705.0,
        1000.0,
        &style,
        Some(640.0),
        Some(850.0),
        None,
        PercentageImageSizing::Intrinsic,
        None,
    )
    .expect("cover sizes");
    assert_eq!(height, 850.0, "the clamp pins the tall axis to the page");
    assert!(
        (f64::from(width) - 599.25).abs() < 0.02,
        "the width shrinks by the same factor (authored ratio kept), got {width}"
    );
}

/// Blink's default line-break lets the UAX-14 CJ class (small kana,
/// prolonged sound mark) START a line — measured across zh-CN/ja/en
/// × auto/normal/loose; only `line-break: strict` keeps the NS
/// prohibition and retreats the pair (b39 truth: あず|ーる splits).
#[test]
fn a_cj_starter_may_open_a_line_unless_strict() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let layout_lines = |line_break: rito_style_contract::LineBreak| {
        let text = "中中中ずー中";
        let mut style = plain_paragraph_style(
            rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
                "NoSuchFace",
            ))])
            .expect("family list"),
            16.0,
            0.0,
        );
        style.text_flow.line_break = line_break;
        let mut inline = InlineStyleTable::new(1);
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style: style_id,
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
        let natural = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(10_000.0),
                None,
                &CancelFlag::new(),
            )
            .expect("natural layout succeeds");
        let Fragment::Box(root) = &natural.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first child is a line");
        };
        let full_width: f64 = line.children.iter().map(|child| child.rect().width).sum();
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(full_width * 4.0 / 6.0 + 0.5),
                None,
                &CancelFlag::new(),
            )
            .expect("narrow layout succeeds");
        line_texts(&outcome, text)
    };
    assert_eq!(
        layout_lines(rito_style_contract::LineBreak::Auto),
        vec!["中中中ず".to_owned(), "ー中".to_owned()],
        "default strictness lets the prolonged sound mark open a line"
    );
    assert_eq!(
        layout_lines(rito_style_contract::LineBreak::Strict),
        vec!["中中中".to_owned(), "ずー中".to_owned()],
        "strict keeps the NS prohibition and retreats the pair"
    );
}

/// A registered named font must win over the pinned fallback when the
/// style names it: the two faces have different advances for the same
/// glyphs, so the line width tells which one shaped.
#[test]
fn named_publication_fonts_shape_instead_of_the_pinned_fallback() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let mut context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    // Tinos under a publication name: its Latin advances differ from
    // Source Han's, so a hit is measurable.
    context
        .register_named_font("PubFace", tinos_bytes())
        .expect("named font registers");

    let shape_width = |families: Vec<FontFamily>| {
        let mut inline = InlineStyleTable::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(FontFamilies::new(families).expect("family list"), 32.0, 0.0),
            )
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "Wilhelm".to_owned(),
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

    let named = shape_width(vec![FontFamily::Named(FontFamilyName::new("PubFace"))]);
    let fallback = shape_width(vec![FontFamily::Named(FontFamilyName::new("NoSuchFace"))]);
    assert!(
        (named - fallback).abs() > 1.0,
        "the named face must shape differently from the fallback: named {named}, fallback {fallback}"
    );
}

/// An opener's pair trim rides the OPENER (`halt` on 『), never the
/// left character's spacing — a left-side credit leaks into the
/// previous line's fit at a break boundary (measured on b20: the
/// compressed ，squeezed onto the prior line, straddled the pair,
/// and the one-way suppression killed the trim; Blink's full-width
/// ，breaks 製|作 and 作，『 stays together with 『 at half width).
/// Twenty 永 at 16px = 320; with 336 available the comma must NOT
/// borrow the opener's half to squeeze in — the line breaks before
/// 作 and the next line keeps 作，『 with the trimmed opener.
#[test]
fn an_opener_pair_trim_never_lends_width_to_the_previous_line() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let lay = |text: &str, width: f64| {
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
                &ConstraintSpace::continuous(width),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds")
    };
    // 20 永 + 作 + full-width ，= 352; at 344 the OLD left-side
    // credit made the comma 8px and squeezed 作，onto the line
    // (splitting the pair from its opener and killing the trim);
    // the opener-side halt keeps the comma full so 作，『 travels
    // together, Blink's exact break shape.
    let text = format!("{}作，『給讀者的挑戰』", "永".repeat(20));
    let outcome = lay(&text, 344.0);
    let lines = line_texts(&outcome, &text);
    assert_eq!(
        lines[0],
        "永".repeat(20),
        "the full-width comma cannot borrow the opener's half"
    );
    assert!(
        lines[1].starts_with("作，『"),
        "the pair opens the continuation line with its opener: {:?}",
        lines[1]
    );
}

/// TEMP probe.
#[test]
fn line_natural_probe() {
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
                    15.2,
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
    let full = "「要注意的是『尚』字的唸法。尚子的尚是唸作ショウ，可是名片哥的名字就不一定";
    eprintln!("PROBE full = {}", shape_width(full));
    eprintln!("PROBE open = {}", shape_width("「要注意"));
    eprintln!("PROBE dot  = {}", shape_width("法。尚"));
    eprintln!("PROBE cma  = {}", shape_width("ウ，可"));
    eprintln!("PROBE q    = {}", shape_width("是『尚』字"));
}

/// The used line-box height quantizes by the DECLARATION TYPE, not
/// uniformly: a number floors its product onto the 1/64 grid while a
/// length (px/em/%) rounds — measured on pinned Chromium with both
/// pin faces agreeing (metrics never enter). The discriminating pair
/// is the b20 note strut: `line-height: 1.35` at 12.16px lays lines
/// 16.40625 apart, while the SAME 16.416px declared as a length lays
/// 16.421875 — the old uniform round drifted every paragraph below
/// the note by 1/32 and flipped .5-tie lines a whole raster row.
#[test]
fn a_number_line_height_floors_and_a_length_rounds() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let line_step = |line_height: LineHeight| {
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            12.16,
            0.0,
        );
        style.font.line_height = line_height;
        style.font.line_height_is_declared = true;
        let mut inline = InlineStyleTable::new(1);
        let interned = inline.intern_for_node(0, style).expect("style interns");
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "永".repeat(24),
                        style: interned,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
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
                FormattingNodeId(0),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("inline outcome root is a box fragment");
        };
        let lines: Vec<f64> = root
            .children
            .iter()
            .filter_map(|child| match child {
                Fragment::Line(line) => Some(line.rect.y),
                _ => None,
            })
            .collect();
        assert!(lines.len() >= 2, "fixture wraps to at least two lines");
        lines[1] - lines[0]
    };
    let number = line_step(LineHeight::Number(
        rito_style_contract::NonNegativeNumber::new(1.35).expect("finite"),
    ));
    assert!(
        (number - 16.40625).abs() < 1e-9,
        "number 1.35 × 12.16 floors to 16.40625: {number}"
    );
    let length = line_step(LineHeight::Length(
        rito_style_contract::NonNegativeCssPx::new(16.416).expect("finite"),
    ));
    assert!(
        (length - 16.421875).abs() < 1e-9,
        "length 16.416px rounds to 16.421875: {length}"
    );
}

/// The browser's justify classes admit geometric shapes and the
/// star pair as CJK symbols (measured on a 20-symbol matrix: each of
/// the shapes opens one share after itself; math operators, the em
/// dash, the ellipsis, and Greek letters open none — a dialogue line
/// with a circled-symbol grade drifted 0.022px per glyph because the
/// missing share inflated every other share on the line).
#[test]
fn geometric_shapes_open_a_justify_share_and_math_operators_do_not() {
    assert!(justify_expands_after('\u{25CB}'), "circle expands after");
    assert!(justify_expands_after('\u{25A0}'), "square expands after");
    assert!(justify_expands_after('\u{2605}'), "star expands after");
    assert!(
        !justify_expands_after('\u{2220}'),
        "angle stays non-expansive"
    );
    assert!(
        !justify_expands_after('\u{2014}'),
        "em dash stays non-expansive"
    );
    assert!(
        !justify_expands_after('\u{03B1}'),
        "Greek alpha stays non-expansive"
    );
}

/// A kern pair straddling a line break does not apply: the browser
/// re-measures the broken line, so the line-final cluster keeps its
/// base advance in the justified natural width (measured: SourceHan
/// ン+ス kern -29/1000; with the paragraph-shaped kerned ン the
/// slack inflated 0.416px and the kana run painted 0.36px right of
/// the truth mid-line — share 0.0967 vs the oracle's 0.0766).
#[test]
fn a_line_break_severs_the_trailing_kern_pair() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context =
        ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(1);
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("family list"),
        14.4,
        0.0,
    );
    style.text_flow.text_align = TextAlign::Justify;
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let text = "担任原画师的作品有《晓之护卫》、《レミニセンス》等。近期热衷于芳香疗法。";
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style: style_id,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
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
            FormattingNodeId(0),
            &ConstraintSpace::continuous(304.0),
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
    let kana = line
        .children
        .iter()
        .find_map(|child| match child {
            Fragment::Text(run) if text[run.text_start as usize..].starts_with('レ') => Some(run),
            _ => None,
        })
        .expect("the kana run lays out on the first line");
    // Oracle (pinned Chromium, the b126 Author paragraph at 14.4px
    // in a 304px measure): レ starts 231.6875 from the line start
    // and the share is 1.6/21 = 0.0762. The kerned-ン slack put it
    // at 232.044.
    assert!(
        (kana.rect.x - 231.6875).abs() < 0.05,
        "the kana run anchors at the truth position: {}",
        kana.rect.x
    );
    assert!(
        (kana.justify_px - 0.0766).abs() < 0.002,
        "the share follows the unkerned slack: {}",
        kana.justify_px
    );
}

/// A space PRECEDED by a latin letter shapes inside the latin run,
/// so the word's trailing GPOS kern pair still applies (Tinos
/// A+space = -113/2048 em; the browser's per-character stack walk
/// puts the space on the head face and kerns it with the word). A
/// CJK-preceded space still breaks out to resolve on the stack head.
#[test]
fn a_latin_preceded_space_keeps_the_words_trailing_kern() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context =
        ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(1);
    let style_id = inline
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
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "上A 班".to_owned(),
                    style: style_id,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
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
            FormattingNodeId(0),
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
    // 上 16 + A (1479 - 113 kern)/2048*16 + space 512/2048*16 + 班 16
    let expected = 16.0 + 10.671875 + 4.0 + 16.0;
    assert!(
        (line.rect.width - expected).abs() < 0.01,
        "the kerned natural width holds: {} vs {expected}",
        line.rect.width
    );
}

/// A fullwidth comma keeps its following opening quote: the browser
/// breaks BEFORE the ideograph that precedes the comma, carrying
/// 说，'Caster' to the next line as one block (pinned-Chromium b112
/// chapter3 line at 640: …这点来 | 说，'C…). Breaking after the
/// comma sheds the quote and re-breaks the rest of the paragraph.
#[test]
fn a_fullwidth_comma_keeps_its_following_opening_quote() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context =
        ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(1);
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("family list"),
        16.0,
        32.0,
    );
    style.text_flow.text_align = TextAlign::Justify;
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let text = "可关键是怎样有效使用这个最强战斗力的问题。说实话如果单从容易操纵这点来说，\u{2018}Caster\u{2019}和\u{2018}Assassin\u{2019}倒是更符合我的性格。\u{201D}";
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style: style_id,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
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
            FormattingNodeId(0),
            &ConstraintSpace::continuous(640.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("box");
    };
    let mut lines = Vec::new();
    for child in &root.children {
        if let Fragment::Line(line) = child {
            let mut first = String::new();
            for c in &line.children {
                if let Fragment::Text(run) = c {
                    first = text[run.text_start as usize..].chars().take(3).collect();
                    break;
                }
            }
            lines.push(first);
        }
    }
    assert_eq!(lines.len(), 2, "the paragraph wraps once at 640");
    assert_eq!(
        lines[1], "\u{8bf4}\u{ff0c}\u{2018}",
        "the comma-quote block opens the second line: {lines:?}"
    );
}

/// A closing curly quote breaks before an em-dash pair: the quote
/// closes its line and the dashes open the next (pinned-Chromium
/// b112 line at 640: 怕” | ——可见). Treating quote-then-dash as
/// unbreakable dragged the quote down with the pair.
#[test]
fn a_closing_quote_breaks_before_a_dash_pair() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context =
        ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(1);
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("family list"),
        16.0,
        32.0,
    );
    style.text_flow.text_align = TextAlign::Justify;
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let text = "这就是Master绮礼的指示。就连战斗能力最为低下的Assassin与其交锋时都\u{201C}不必惧怕\u{201D}\u{2014}\u{2014}可见时臣召唤出来的Archer的英灵，一定是非常令绮礼失望的吧。";
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style: style_id,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
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
            FormattingNodeId(0),
            &ConstraintSpace::continuous(640.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("box");
    };
    let mut lines = Vec::new();
    for child in &root.children {
        if let Fragment::Line(line) = child {
            let mut first = String::new();
            for c in &line.children {
                if let Fragment::Text(run) = c {
                    first = text[run.text_start as usize..].chars().take(4).collect();
                    break;
                }
            }
            lines.push(first);
        }
    }
    assert_eq!(lines.len(), 2, "the paragraph wraps once at 640");
    assert_eq!(
        lines[1], "\u{2014}\u{2014}\u{53ef}\u{89c1}",
        "the dash pair opens the second line, the quote stays up"
    );
}
