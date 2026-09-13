use super::*;

/// Justify shares around an inline atom: the boundary INTO the atom
/// carries one share which moves the atom itself (to ceil64 of the
/// shifted sum), the boundary out of it carries none — the following
/// glyph hugs the atom's right edge and its own deferred share lands
/// one boundary later as a double (Range-measured micro line, slack
/// 10 over 19 opportunities). Feeding the atom's share into the text
/// counts too let the next run consume it twice, opening a full
/// share of daylight after every inline image on a justified line.
#[test]
#[ignore = "two truth probes disagree on the atom-following share: the \
b20 badge comma rides one share right of its natural position while the \
micro line's ideograph hugs the image edge — the unified rule (likely by \
the follower's punctuation class) is still unmeasured"]
fn an_atom_boundary_share_moves_the_atom_not_the_next_run() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context =
        ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(2);
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("family list"),
        16.0,
        0.0,
    );
    style.text_flow.text_align = TextAlign::Justify;
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let image_style = inline
        .intern_for_node(
            1,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(
                    rito_style_contract::GenericFontFamily::Serif,
                )])
                .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("image style interns");
    let mut layout = LayoutStyleTable::new(1);
    let image_layout = layout
        .intern_for_node(0, jgap_image_layout_style())
        .expect("layout style interns");
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: image_layout,
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "甲乙丙".to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Image {
                        src: "sq.png".to_owned(),
                        source: 0,
                        intrinsic_width: 16.0,
                        intrinsic_height: 16.0,
                        style: image_style,
                        layout_style: image_layout,
                        fit_contain: false,
                        object_fit: rito_style_contract::ObjectFit::Fill,
                        viewport: None,
                        align_top: false,
                        baseline_shift_px: 0.0,
                    },
                    InlineItem::Text {
                        text: "丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥甲乙丙丁戊己庚辛".to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
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
            &ConstraintSpace::continuous(330.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("box");
    };
    let Fragment::Line(line) = &root.children[0] else {
        panic!("line");
    };
    let mut image_x = None;
    let mut after_atom_x = None;
    let mut saw_image = false;
    for c in &line.children {
        match c {
            Fragment::Image(img) => {
                image_x = Some(img.rect.x);
                saw_image = true;
            }
            Fragment::Text(run) if saw_image && after_atom_x.is_none() => {
                after_atom_x = Some(run.rect.x);
            }
            _ => {}
        }
    }
    let image_x = image_x.expect("the atom lays out");
    let after_atom_x = after_atom_x.expect("a run follows the atom");
    assert!(
        (image_x - 49.59375).abs() < 1e-6,
        "the atom lands on ceil64 of its shifted sum: {image_x}"
    );
    assert!(
        (after_atom_x - (image_x + 16.0)).abs() < 0.02,
        "the following glyph hugs the atom's right edge: {after_atom_x} vs {}",
        image_x + 16.0
    );
}

fn jgap_image_layout_style() -> rito_style_contract::LayoutFormattingStyle {
    use rito_style_contract::{
        AlignItems, BoxSizing, CellVerticalAlign, Clear, Float, JustifyContent, LayoutDisplay,
        LayoutDisplayInside, LayoutDisplayOutside, LayoutFormattingStyle, ListMarkerStyle,
        MaximumHeight, MaximumSize, MinimumHeight, NonNegativeCssPx, Overflow, PageBreak, Position,
        PreferredSize,
    };
    let auto = LengthPercentageOrAuto::Auto;
    let zero_padding =
        NonNegativeLengthPercentage::new(LengthPercentage::Length(CssPx::new(0.0).expect("zero")));
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
        box_sizing: BoxSizing::ContentBox,
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
        vertical_align: CellVerticalAlign::Baseline,
        border_spacing: (
            NonNegativeCssPx::new(0.0).expect("zero"),
            NonNegativeCssPx::new(0.0).expect("zero"),
        ),
        border_collapse: false,
        object_fit: rito_style_contract::ObjectFit::Fill,
    }
}

/// The shaping size truncates the F32 product size*100 onto the
/// 1/100 grid: the f32 product's own rounding decides the cell
/// (15.2*100 = exactly 1520.0 passes through; 18.72*100 =
/// 1871.99988 truncates to 18.71). An f64 product would round
/// 18.72's hundredths within any snap tolerance and miss the
/// browser's cell (Range-measured on a pinned face).
#[test]
fn the_shaping_size_truncates_the_f32_hundredths_product() {
    for (size, want) in [
        (18.72_f32, 18.71_f32),
        (9.36, 9.35),
        (37.44, 37.43),
        (18.8, 18.79),
        (15.2, 15.2),
        (12.16, 12.16),
        (14.4, 14.4),
        (16.01, 16.01),
        (15.9999, 15.99),
        (15.9375, 15.93),
        (17.06667, 17.06),
        (9.52, 9.52),
    ] {
        let got = shaping_font_size(size);
        assert!(
            (got - want).abs() < 1e-4,
            "{size} shapes at {got}, browser uses {want}"
        );
    }
}

/// Author letter-spacing rides OUTSIDE the fixed-point glyph advance:
/// a 16px ideograph spaced 1.3333334px steps 16.000000 + 1.3333334,
/// never round-tripped through font units as one folded sum
/// (round(17.333 * 1000 / 16) = 1083 units re-scales to 17.32799 —
/// 0.0053px short per cluster, one device column per ~12 glyphs
/// across a spaced book).
#[test]
fn letter_spacing_stays_outside_the_fixed_point_round_trip() {
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
        16.0,
        0.0,
    );
    style.text_flow.letter_spacing =
        LengthPercentage::Length(CssPx::new(1.333_333_4).expect("finite spacing"));
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "开始自我介绍".to_owned(),
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
    let mut runs = line.children.iter().filter_map(|child| match child {
        Fragment::Text(run) => Some(run),
        _ => None,
    });
    let first = runs.next().expect("the line has text runs");
    let second = runs.next().expect("the spaced advance splits the run");
    let step = second.rect.x - first.rect.x;
    assert!(
        (step - 17.333_333_4).abs() < 1e-5,
        "the spaced step keeps the raw spacing outside the grid: {step}"
    );
}

/// The per-glyph grid-pen splits ride the 16.16 fixed-point scale
/// the browser hands its shaper: a 19.2px 1000-unit ideograph
/// advances trunc(1000 * round(19.2 * 65536) / 1000) / 65536 =
/// 19.199997px, not the raw f32 product 19.200001px. The raw sum
/// crosses 1/64 cells one cluster early, so every glyph after the
/// crossing painted one device column right of the browser's
/// (Range-measured on a pinned-Chromium 19.2px contents line).
#[test]
fn grid_pen_splits_ride_the_fixed_point_shaper_scale() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let mut inline = InlineStyleTable::new(1);
    let style_id = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(
                    rito_style_contract::GenericFontFamily::Serif,
                )])
                .expect("family list"),
                19.2,
                0.0,
            ),
        )
        .expect("style interns");
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "掷骰子问题掷骰子问题".to_owned(),
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
    let advance = 1_258_291.0_f64 / 65_536.0;
    let mut runs = line.children.iter().filter_map(|child| match child {
        Fragment::Text(run) => Some(run),
        _ => None,
    });
    let first = runs.next().expect("the line has text runs");
    assert!(
        first.rect.x.abs() < 1e-6,
        "the run anchors at the line start: {}",
        first.rect.x
    );
    let second = runs.next().expect("the off-grid advance splits the run");
    assert!(
        (second.rect.x - advance).abs() < 1e-5 && second.rect.x < 19.2,
        "the second glyph starts one fixed-point advance in: {} vs {advance}",
        second.rect.x
    );
}

/// A justified line's paint cuts land AROUND a repeated-dash pair,
/// never between the dashes: the canvas shapes each call on its own,
/// and fonts join —— through contextual substitution, so a cut inside
/// the pair rasters two isolated dash glyphs whose bar sits off the
/// joined form (measured 2px on an embedded face). The share pattern
/// 了|— (one share) then —|— (zero) used to flip the uniform tracker
/// exactly between the dashes.
#[test]
fn a_justified_dash_pair_stays_in_one_paint_fragment() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("family list"),
        16.0,
        0.0,
    );
    style.text_flow.text_align = TextAlign::Justify;
    let mut inline = InlineStyleTable::new(1);
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let text = "「原本打算自己吃的饼干，现在换成马剃同学吃了——知道这意味着什么吗？来，小鞠回答！」";
    let pair = text.find('\u{2014}').expect("text has the dash pair");
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
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let mut carrier: Option<(usize, usize)> = None;
    for child in &root.children {
        let Fragment::Line(line) = child else {
            continue;
        };
        for run in &line.children {
            let Fragment::Text(run) = run else { continue };
            let (start, end) = (run.text_start as usize, run.text_end as usize);
            if start <= pair && pair < end {
                carrier = Some((start, end));
            }
        }
    }
    let (start, end) = carrier.expect("a paint fragment carries the first dash");
    assert!(
        end - pair >= "\u{2014}\u{2014}".len(),
        "the dash pair must not be severed across paint fragments: \
         fragment {start}..{end} cuts the pair at byte {pair}"
    );
}

/// A number line-height multiplies the GRID-ROUNDED font size, then
/// floors the product (measured in Chromium across 14 sizes,
/// content-independent). Off-grid sizes discriminate in both
/// directions from a plain floored product: 24.32 lands SHORTER
/// (32.8125, not 32.828125) and 30.4 lands TALLER (41.046875, not
/// 41.03125); on-grid sizes are unchanged. A real book's 1.6em
/// divider paragraph in a 0.95em article was one 64th tall, pushing
/// a mid-page line onto the wrong device row.
#[test]
fn a_number_line_height_multiplies_the_grid_rounded_font_size() {
    let number =
        LineHeight::Number(rito_style_contract::NonNegativeNumber::new(1.35).expect("finite"));
    let used =
        |font_size: f32| used_declared_line_height(number, f64::from(font_size)).expect("declared");
    assert_eq!(used(24.32), 32.8125, "24.32 rounds down to 24.3125 first");
    assert_eq!(used(30.4), 41.046875, "30.4 rounds up to 30.40625 first");
    assert_eq!(used(17.1), 23.0625, "17.1 rounds down to 17.09375 first");
    assert_eq!(used(15.2), 20.515625, "15.203125 keeps the historic value");
    assert_eq!(used(16.0), 21.59375, "an on-grid size is a plain product");
}

/// A `<ruby>` edge is a shaping boundary: the base shapes alone, so
/// a kern pair straddling the edge never applies. Measured on the
/// pinned SourceHan at 15.2px: plain (and `<span>`-split) ウ，可
/// closes to 44.39 through the ウ，kern pair, while
/// `<ruby>ウ</ruby>，可 spans the full 45.61 — Blink shapes the ruby
/// base independently. The b20 Shou line's slack grew 1.216px (and
/// its justify share 0.83 vs Blink's 0.80) through exactly this
/// leaked pair.
#[test]
fn a_ruby_edge_is_a_shaping_boundary() {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
    let lay = |items_of: &dyn Fn(rito_style_contract::StyleId) -> Vec<InlineItem>| {
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
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: items_of(style),
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
    let text_item = |text: &str, annotation: Option<&str>, style| InlineItem::Text {
        text: text.to_owned(),
        style,
        baseline_shift_px: 0.0,
        ruby_annotation: annotation.map(|note| rito_fragment::RubyAnnotation {
            text: note.to_owned(),
            size_ratio: 0.5,
            align: rito_style_contract::RubyAlign::SpaceAround,
        }),
    };
    let merged = lay(&|style| vec![text_item("ウ，可", None, style)]);
    assert!(
        (merged - 44.384).abs() < 0.05,
        "one shaped run applies the ウ，kern: {merged}"
    );
    // Same characters, but ウ is a ruby base: the pair must NOT kern.
    let split = lay(&|style| {
        vec![
            text_item("ウ", Some("u"), style),
            text_item("，可", None, style),
        ]
    });
    assert!(
        (split - 45.6).abs() < 0.05,
        "a ruby edge breaks the kern pair: {split}"
    );
    // Two directly adjacent mono-ruby bases stay separate runs too.
    let adjacent = lay(&|style| {
        vec![
            text_item("ウ", Some("u"), style),
            text_item("，", Some("x"), style),
            text_item("可", None, style),
        ]
    });
    assert!(
        (adjacent - 45.6).abs() < 0.05,
        "adjacent ruby bases each shape alone: {adjacent}"
    );
}

/// A top-aligned image inside a super-shifted chain aligns to the
/// line box top from its UNSHIFTED metrics and is then displaced by
/// the ancestor's baseline shift — its ink overflows ABOVE the line
/// box (measured on a 16px paragraph's footnote badge in <sup>:
/// image top = line top − (trunc64(16/3) + 1) = −6.328125,
/// line-height independent; with no shift chain the top-aligned
/// image hugs the line top exactly).
#[test]
fn a_top_aligned_image_in_a_super_chain_overflows_the_line_top() {
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
    let image_y = |shift_px: f64| {
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
        let mut layout = LayoutStyleTable::new(1);
        let auto = LengthPercentageOrAuto::Auto;
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero"),
        ));
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
                text: "彭彭彭".to_owned(),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            },
            InlineItem::Image {
                source: 0,
                src: "images/note.png".to_owned(),
                intrinsic_width: 14.390625,
                intrinsic_height: 14.390625,
                style,
                layout_style: image_layout,
                fit_contain: false,
                viewport: None,
                baseline_shift_px: shift_px,
                align_top: true,
                object_fit: rito_style_contract::ObjectFit::Fill,
            },
            InlineItem::Text {
                text: "的彭彭".to_owned(),
                style,
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
            .find_map(|child| match child {
                Fragment::Image(image) => Some(image.rect.y),
                _ => None,
            })
            .expect("line carries the image")
    };
    let unshifted = image_y(0.0);
    assert!(
        unshifted.abs() < 1e-6,
        "with no shift chain the top-aligned image hugs the line top: {unshifted}"
    );
    let raised = image_y(6.328125);
    assert!(
        (raised - (-6.328125)).abs() < 1e-6,
        "the super chain displaces the top-aligned image above the line: {raised}"
    );
}

/// An inline image between two fullwidth punctuation glyphs keeps
/// them both at full width: the pair 的。<img>』 never trims, while
/// the same characters with no box between them trim the 。 to half
/// (measured on b20 p143's note badge: Blink paints 的。 full, then
/// the badge, then 』 — the engine's flow text carries no
/// placeholder for the image, so a text-only adjacency scan saw
/// 。』 and halved the 。).
#[test]
fn an_inline_image_separates_a_punctuation_pair() {
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
    let lay_text_width = |with_image: bool| {
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
        let mut layout = LayoutStyleTable::new(1);
        let auto = LengthPercentageOrAuto::Auto;
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero"),
        ));
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
        let mut items = vec![InlineItem::Text {
            text: "的。".to_owned(),
            style,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        }];
        if with_image {
            items.push(InlineItem::Image {
                source: 0,
                src: "images/note.png".to_owned(),
                intrinsic_width: 14.0,
                intrinsic_height: 14.0,
                style,
                layout_style: image_layout,
                fit_contain: false,
                viewport: None,
                baseline_shift_px: 0.0,
                align_top: false,
                object_fit: rito_style_contract::ObjectFit::Fill,
            });
        }
        items.push(InlineItem::Text {
            text: "』可".to_owned(),
            style,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        });
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
            .filter_map(|child| match child {
                Fragment::Text(run) => Some(run.rect.width),
                _ => None,
            })
            .sum::<f64>()
    };
    let trimmed = lay_text_width(false);
    assert!(
        (trimmed - 53.2).abs() < 0.05,
        "with no box between them 。』 trims the 。 to half: {trimmed}"
    );
    let separated = lay_text_width(true);
    assert!(
        (separated - 60.8).abs() < 0.05,
        "an image between 。 and 』 keeps both full: {separated}"
    );
}

/// The b20 ruby-line pitch replica (chapter3 dialog, fs 15.2,
/// rt 0.7em latin, line-height 130% = 19.765625 declared). Truth
/// (Chromium replicas of the exact host probe DOM + a 3-line
/// paragraph, 2026-08-13): E000@0.7 = {29, 24}, E001@0.7 = {48, 43},
/// 中@normal = {21, 16}, and the mid-paragraph ruby line's pitch is
/// 27.0 (line tops 1 / 28 / 47.75). With those host answers injected,
/// the engine's composition must land the same 27 — hand-checked:
/// required 24 − strut baseline 14 − prev_gap (5.765625 − reuse 3)
/// = growth 7.234375; 19.765625 + 7.234375 = 27.
#[test]
fn the_b20_ruby_line_pitch_matches_truth_with_injected_host_metrics() {
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
    style.font.line_height = LineHeight::Length(
        rito_style_contract::NonNegativeCssPx::new(19.765625).expect("finite line height"),
    );
    style.font.line_height_is_declared = true;
    let family = host_family_key(&style);
    // The TRUE host values (pins VERIFIED loaded — a setContent page
    // silently drops file:// faces and an earlier round measured the
    // system fallback: 中 16 vs the real 17, E000 24 vs 25). The
    // composition lands the same pitch either way because the errors
    // cancelled, but the anchors must carry the real numbers.
    for (sample, height, baseline) in [
        ("", 18.0, 14.0),
        ("中", 21.0, 17.0),
        ("\u{E000}0.7000:Shouichi", 29.0, 25.0),
        ("\u{E001}0.7000:Shouichi", 48.0, 44.0),
    ] {
        context.set_host_line_metric(
            &family,
            15.2,
            sample,
            HostNormalLineMetric {
                height,
                baseline,
                grid: Some((14.0, 3.0)),
                advance: None,
            },
        );
    }
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let items = vec![
        InlineItem::Text {
            text: "中文排版測試字符排版".to_owned(),
            style: style_id,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        },
        InlineItem::Text {
            text: "ショウイチ".to_owned(),
            style: style_id,
            baseline_shift_px: 0.0,
            ruby_annotation: Some(rito_fragment::RubyAnnotation {
                text: "Shouichi".to_owned(),
                size_ratio: 0.7,
                align: rito_style_contract::RubyAlign::SpaceAround,
            }),
        },
        InlineItem::Text {
            text: "後續文字排版測試字符文字".to_owned(),
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
            &ConstraintSpace::continuous(180.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!()
    };
    let tops: Vec<f64> = root
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Line(line) => Some(line.rect.y),
            _ => None,
        })
        .collect();
    for (index, child) in root.children.iter().enumerate() {
        if let Fragment::Line(line) = child {
            eprintln!(
                "[rubyline] line {index} top {:.6} h {:.6}",
                line.rect.y, line.rect.height
            );
        }
    }
    assert!(tops.len() >= 3, "three lines lay out");
    // Truth measured CHAR tops (Range), not line-box tops: the
    // engine keeps the ruby line's box top natural and moves the
    // TEXT inside down by the growth, so the comparable quantity is
    // the first text fragment's net y per line.
    let char_tops: Vec<f64> = root
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Line(line) => line.children.iter().find_map(|inner| match inner {
                Fragment::Text(run) => Some(line.rect.y + run.rect.y),
                _ => None,
            }),
            _ => None,
        })
        .collect();
    for (index, top) in char_tops.iter().enumerate() {
        eprintln!("[rubyline] char top {index}: {top:.6}");
    }
    let pitch = char_tops[1] - char_tops[0];
    assert!(
        (pitch - 27.0).abs() < 0.01,
        "the ruby line's char pitch must be 27 like Blink, got {pitch}"
    );
    let after = char_tops[2] - char_tops[1];
    assert!(
        (after - 19.765625).abs() < 0.01,
        "the line after the ruby returns to the strut pitch, got {after}"
    );
    // The opener arm: a first-line ruby pushes down by the
    // whole-pixel ceil of its baseline deficit (Chromium at this config:
    // ceil(25 − 15.3828) = 10; measured 10/9/8/6 across four
    // line-heights). Lay the same flow with the ruby item first.
    let mut inline2 = InlineStyleTable::new(1);
    let mut style2 = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("family list"),
        15.2,
        0.0,
    );
    style2.font.line_height = LineHeight::Length(
        rito_style_contract::NonNegativeCssPx::new(19.765625).expect("finite line height"),
    );
    style2.font.line_height_is_declared = true;
    let family2 = host_family_key(&style2);
    for (sample, height, baseline) in [
        ("", 18.0, 14.0),
        ("中", 21.0, 17.0),
        ("\u{E000}0.7000:Shouko", 29.0, 25.0),
        ("\u{E001}0.7000:Shouko", 48.0, 44.0),
    ] {
        context.set_host_line_metric(
            &family2,
            15.2,
            sample,
            HostNormalLineMetric {
                height,
                baseline,
                grid: Some((14.0, 3.0)),
                advance: None,
            },
        );
    }
    let style2_id = inline2.intern_for_node(0, style2).expect("style interns");
    let tree2 = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "ショウコ".to_owned(),
                        style: style2_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: Some(rito_fragment::RubyAnnotation {
                            text: "Shouko".to_owned(),
                            size_ratio: 0.7,
                            align: rito_style_contract::RubyAlign::SpaceAround,
                        }),
                    },
                    InlineItem::Text {
                        text: "的名字是寫作尚子吧後續文字排版測試".to_owned(),
                        style: style2_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline: inline2,
        },
    )
    .expect("inline tree builds");
    let outcome2 = context
        .layout(
            &tree2,
            tree2.root(),
            &ConstraintSpace::continuous(180.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root2) = &outcome2.fragments.root else {
        panic!()
    };
    let opener_tops: Vec<f64> = root2
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Line(line) => line.children.iter().find_map(|inner| match inner {
                Fragment::Text(run) => Some(line.rect.y + run.rect.y),
                _ => None,
            }),
            _ => None,
        })
        .collect();
    // The control flow (no annotation) puts its first char top at some
    // V; the opener-ruby flow must sit at V + 10 exactly. V itself is
    // model-internal, so assert via the SECOND line instead: it sits
    // one natural pitch below the pushed first line, so
    // opener_line2 − opener_line1 = 19.765625 while the push shows in
    // the first line's absolute top being 10 above-baseline-shifted —
    // captured by comparing against the interior flow's line-0 top
    // plus the ceil'd deficit.
    let interior_line0 = char_tops[0];
    let push = opener_tops[0] - interior_line0;
    eprintln!("[rubyline] opener push = {push:.6}");
    assert!(
        (push - 10.0).abs() < 0.01,
        "the opener ruby line pushes down by ceil(25 − 15.3828) = 10, got {push}"
    );
}

/// The b20 DOUBLE-RUBY paragraph replica at the REAL chapter3 config
/// (p { line-height: 1.35 } NUMBER → floors to 20.515625; fs 15.2;
/// live host values). Truth (real-chapter Range, walk pins,
/// 2026-08-13): opener push 10.0, INTERIOR ruby-line pitch 27.0 =
/// 20.515625 + 6.484375 — equal to the engine's own analytic growth
/// (required 25 − baseline 15 − prev_gap 3.515625), yet the engine
/// PAINTED pitch 26.0 on p144 — the −1 lives in the growth→paint
/// translation on consecutive ruby lines.
#[test]
fn the_b20_double_ruby_paragraph_interior_pitch_matches_truth() {
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
    style.font.line_height = LineHeight::Number(
        rito_style_contract::NonNegativeNumber::new(1.35).expect("finite multiplier"),
    );
    style.font.line_height_is_declared = true;
    let family = host_family_key(&style);
    for (sample, height, baseline) in [
        ("", 18.0, 14.0),
        ("中", 21.0, 17.0),
        ("\u{E000}0.7000:Shou", 29.0, 25.0),
        ("\u{E001}0.7000:Shou", 48.0, 44.0),
        ("\u{E000}0.7000:Shouichi", 29.0, 25.0),
        ("\u{E001}0.7000:Shouichi", 48.0, 44.0),
        ("\u{E000}0.7000:Naokazu", 29.0, 25.0),
        ("\u{E001}0.7000:Naokazu", 48.0, 44.0),
    ] {
        context.set_host_line_metric(
            &family,
            15.2,
            sample,
            HostNormalLineMetric {
                height,
                baseline,
                grid: Some((14.0, 3.0)),
                advance: None,
            },
        );
    }
    let style_id = inline.intern_for_node(0, style).expect("style interns");
    let ruby = |base: &str, ann: &str| InlineItem::Text {
        text: base.to_owned(),
        style: style_id,
        baseline_shift_px: 0.0,
        ruby_annotation: Some(rito_fragment::RubyAnnotation {
            text: ann.to_owned(),
            size_ratio: 0.7,
            align: rito_style_contract::RubyAlign::SpaceAround,
        }),
    };
    let text = |t: &str| InlineItem::Text {
        text: t.to_owned(),
        style: style_id,
        baseline_shift_px: 0.0,
        ruby_annotation: None,
    };
    let items = vec![
        text("「要注意的是『尚』字的唸法。尚子的尚是唸作"),
        ruby("ショウ", "Shou"),
        text("，可是名片哥的名字就不一定了。如果是『尚一』，笑話的方向也會隨『"),
        ruby("ショウイチ", "Shouichi"),
        text("』或『"),
        ruby("ナオカズ", "Naokazu"),
        text("』改變呢。」"),
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
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(590.78125),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!()
    };
    let char_tops: Vec<f64> = root
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Line(line) => line.children.iter().find_map(|inner| match inner {
                Fragment::Text(run) => Some(line.rect.y + run.rect.y),
                _ => None,
            }),
            _ => None,
        })
        .collect();
    for (index, top) in char_tops.iter().enumerate() {
        eprintln!("[dblruby] char top {index}: {top:.6}");
    }
    for (index, child) in root.children.iter().enumerate() {
        if let Fragment::Line(line) = child {
            let inner = line.children.iter().find_map(|c| match c {
                Fragment::Text(run) => Some((run.rect.y, run.rect.height)),
                _ => None,
            });
            eprintln!(
                "[dblruby] line {index} box y {:.6} h {:.6} inner {:?}",
                line.rect.y, line.rect.height, inner
            );
        }
    }
    assert!(char_tops.len() >= 2, "two lines lay out");
    let pitch = char_tops[1] - char_tops[0];
    assert!(
        (pitch - 27.0).abs() < 0.01,
        "the interior ruby line's char pitch must be 27 like the real chapter, got {pitch}"
    );
}
