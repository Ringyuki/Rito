//! The vendored Parley line breaker on layouts built straight through its
//! builder: what it measures a line at and where it must break.

use super::*;

/// A Source Han Serif paragraph (its `liga` joins `fi`) whose byte ranges
/// take the given font sizes.
fn sized_layout(
    context: &ParleyInlineContext,
    text: &str,
    sizes: &[(std::ops::Range<usize>, f32)],
) -> parley::Layout<[u8; 4]> {
    let mut fonts = context.fonts.borrow_mut();
    let mut layouts = context.layouts.borrow_mut();
    let mut builder = SpacingBuilder::new(layouts.ranged_builder(&mut fonts, text, 1.0, true));
    for (range, size) in sizes {
        let style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            *size,
            0.0,
        );
        push_item_styles(&mut builder, &context.catalog, &style, range.clone());
    }
    builder.build(text).0
}

fn source_han_context() -> ParleyInlineContext {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    ParleyInlineContext::new(vec![source_han]).expect("context builds")
}

/// The advances of every cluster starting in `range`, summed.
fn cluster_advance_sum(layout: &parley::Layout<[u8; 4]>, range: std::ops::Range<usize>) -> f32 {
    let mut sum = 0.0;
    let mut cluster = parley::layout::Cluster::from_byte_index(layout, range.start);
    while let Some(current) = cluster {
        if current.text_range().start >= range.end {
            break;
        }
        sum += current.advance();
        cluster = current.next_logical();
    }
    sum
}

/// A ligature's components are measured with the clusters of their own
/// run: a run that does not start the paragraph read its look-ahead
/// through an absolute cluster index, so the `fi` of the second run took
/// the advance of the `fi` at the paragraph's end instead of its own.
#[test]
fn a_ligature_is_measured_by_its_own_clusters_in_any_run() {
    let context = source_han_context();
    let text = "xxxxxxxxxxfixxxxxxxxfi";
    let mut layout = sized_layout(
        &context,
        text,
        &[(0..10, 10.0), (10..12, 12.0), (12..22, 40.0)],
    );
    layout.break_all_lines(None);
    let ligature = parley::layout::Cluster::from_byte_index(&layout, 10).expect("cluster at 10");
    assert!(
        ligature.is_ligature_start(),
        "the second run's fi is a ligature"
    );
    let line = layout.get(0).expect("one line");
    let measured = line.metrics().advance;
    let advances = cluster_advance_sum(&layout, 0..text.len());
    assert!(
        (measured - advances).abs() < 1e-3,
        "the line measured {measured}, its clusters advance {advances}"
    );
}

/// A forced break is taken before any soft wrap opportunity: an override
/// that marks the newline itself breakable (`line-break: anywhere` marks
/// every character; Chromium's tailoring marks the character after a
/// space) took the soft branch and lost the forced break.
#[test]
fn a_newline_breaks_the_line_whatever_marks_it_breakable() {
    let context = source_han_context();
    for (text, overrides) in [
        (
            "ab\ncd",
            &crate::breaking::break_anywhere_override as &parley::LineBreakOverrideFn,
        ),
        ("a \nb", parley::CHROMIUM_LINE_BREAK_OVERRIDE),
    ] {
        let mut fonts = context.fonts.borrow_mut();
        let mut layouts = context.layouts.borrow_mut();
        let mut builder = SpacingBuilder::new(layouts.ranged_builder(&mut fonts, text, 1.0, true));
        let style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            16.0,
            0.0,
        );
        push_item_styles(&mut builder, &context.catalog, &style, 0..text.len());
        builder.set_line_break_override(overrides);
        let mut layout = builder.build(text).0;
        layout.break_all_lines(Some(1000.0));
        assert_eq!(layout.len(), 2, "{text:?} breaks at its newline");
        assert_eq!(
            layout.get(0).expect("first line").break_reason(),
            parley::layout::BreakReason::Explicit,
            "{text:?}"
        );
    }
}

/// The same through the inline layout: `line-break: anywhere` and a
/// preserved space before a `<br>` keep the forced break.
#[test]
fn a_forced_break_survives_line_break_anywhere_and_a_preserved_space() {
    let context = source_han_context();
    let anywhere = |style: &mut InlineFormattingStyle| {
        style.text_flow.line_break = LineBreak::Anywhere;
    };
    let preserved = |style: &mut InlineFormattingStyle| {
        style.text_flow.white_space_collapse = WhiteSpaceCollapse::Preserve;
    };
    for (text, adjust) in [
        (
            "永永\n永永",
            &anywhere as &dyn Fn(&mut InlineFormattingStyle),
        ),
        ("a \nb", &preserved),
    ] {
        let mut inline = InlineStyleTable::new(1);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            16.0,
            0.0,
        );
        adjust(&mut style);
        let style = inline.intern_for_node(0, style).expect("style interns");
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
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
                &ConstraintSpace::continuous(1000.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let lines = line_texts(&outcome, text);
        assert_eq!(lines.len(), 2, "{text:?}: {lines:?}");
    }
}

/// A cluster finds its text in a shaping run of any length: its offset
/// into the run was kept in 16 bits, so past 64 KiB of one run (a whole
/// volume written as one block of `<br>`-separated lines in one style)
/// clusters pointed at the wrong text and the lines could not be laid
/// out (book 048 at a 500px column).
#[test]
fn a_shaping_run_longer_than_64_kib_keeps_its_clusters_text() {
    let context = source_han_context();
    let text = "永".repeat(30_000);
    let mut layout = sized_layout(&context, &text, &[(0..text.len(), 16.0)]);
    layout.break_all_lines(Some(500.0));
    for byte in [0, 65_535, 70_002, text.len() - 3] {
        let cluster = parley::layout::Cluster::from_byte_index(&layout, byte).expect("cluster");
        assert_eq!(cluster.text_range(), byte..byte + 3, "cluster at {byte}");
    }
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
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
                    text: text.clone(),
                    style,
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
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("a paragraph longer than 64 KiB lays out");
    let lines = line_texts(&outcome, &text);
    assert_eq!(lines.concat(), text);
}

/// A 16px Source Han Serif paragraph carrying inline boxes of the given
/// kinds and widths (zero height) at the given byte indices.
fn tagged_layout(
    context: &ParleyInlineContext,
    text: &str,
    boxes: &[(usize, InlineBoxKind, f32)],
) -> parley::Layout<[u8; 4]> {
    let mut fonts = context.fonts.borrow_mut();
    let mut layouts = context.layouts.borrow_mut();
    let mut builder = SpacingBuilder::new(layouts.ranged_builder(&mut fonts, text, 1.0, true));
    let style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    push_item_styles(&mut builder, &context.catalog, &style, 0..text.len());
    for (id, (index, kind, width)) in boxes.iter().enumerate() {
        builder.push_inline_box(InlineBox {
            id: id as u64,
            kind: *kind,
            index: *index,
            width: *width,
            height: 0.0,
        });
    }
    builder.build(text).0
}

/// Each line's text range and the x its first glyph run starts at.
fn line_starts(layout: &parley::Layout<[u8; 4]>) -> Vec<(std::ops::Range<usize>, f32)> {
    layout
        .lines()
        .map(|line| {
            let x = line
                .items()
                .find_map(|item| match item {
                    PositionedLayoutItem::GlyphRun(run) => Some(run.offset()),
                    PositionedLayoutItem::InlineBox(_) => None,
                })
                .unwrap_or(0.0);
            (line.text_range(), x)
        })
        .collect()
}

/// An open tag offers no break of its own: the break the text allows at
/// its index is taken before it, so it opens the next line with the text
/// it opens, and the character before it is measured without it.
#[test]
fn an_open_tag_opens_the_next_line_with_what_it_opens() {
    let context = source_han_context();
    let text = "永永永永永永永永永永永永";
    for width in [162.0_f32, 165.0] {
        let mut layout = tagged_layout(&context, text, &[(30, InlineBoxKind::OpenTag, 4.0)]);
        layout.break_all_lines(Some(width));
        assert_eq!(
            line_starts(&layout),
            [(0..30, 0.0), (30..36, 4.0)],
            "at {width}px"
        );
    }
}

/// Where the text allows no break, an open tag does not make one: it stays
/// inside the word it splits.
#[test]
fn an_open_tag_inside_a_word_is_no_break() {
    let context = source_han_context();
    let text = "aaaaaabbbb cc";
    let mut layout = tagged_layout(&context, text, &[(6, InlineBoxKind::OpenTag, 4.0)]);
    layout.break_all_lines(Some(60.0));
    let ranges: Vec<_> = line_starts(&layout)
        .into_iter()
        .map(|(range, _)| range)
        .collect();
    assert_eq!(ranges.first(), Some(&(0..11)), "{ranges:?}");
}

/// A close tag stays with the text it closes: when it overflows, the line
/// breaks at the last opportunity before that text.
#[test]
fn a_close_tag_that_overflows_takes_its_text_down() {
    let context = source_han_context();
    let text = "永永永永永永永永永永永永";
    let mut layout = tagged_layout(&context, text, &[(30, InlineBoxKind::CloseTag, 4.0)]);
    layout.break_all_lines(Some(162.0));
    assert_eq!(line_starts(&layout), [(0..27, 0.0), (27..36, 0.0)]);
    let mut layout = tagged_layout(&context, text, &[(30, InlineBoxKind::CloseTag, 4.0)]);
    layout.break_all_lines(Some(165.0));
    assert_eq!(line_starts(&layout), [(0..30, 0.0), (30..36, 0.0)]);
}

/// A line forced to end before an open tag's index sends the tag down with
/// what it opens; a close tag at that index stays on the line.
#[test]
fn a_forced_line_end_keeps_close_tags_and_sends_open_tags_down() {
    let context = source_han_context();
    let text = "永永永永永永";
    let mut layout = tagged_layout(
        &context,
        text,
        &[
            (9, InlineBoxKind::CloseTag, 3.0),
            (9, InlineBoxKind::OpenTag, 4.0),
        ],
    );
    {
        let mut breaker = layout.break_lines();
        breaker.state_mut().set_layout_max_advance(1000.0);
        breaker.state_mut().set_line_max_advance(1000.0);
        breaker.break_next_to(9).expect("a forced line");
        breaker.state_mut().set_line_max_advance(1000.0);
        while breaker.break_next().is_some() {}
        breaker.finish();
    }
    let lines = line_starts(&layout);
    assert_eq!(lines, [(0..9, 0.0), (9..18, 4.0)]);
    assert_eq!(layout.get(0).expect("first line").metrics().advance, 51.0);
}

/// An open tag's width joins the min-content segment of the text after it,
/// a close tag's the segment of the text before it.
#[test]
fn tags_join_the_min_content_segment_of_the_text_they_edge() {
    let context = source_han_context();
    let layout = tagged_layout(
        &context,
        "永永永",
        &[
            (3, InlineBoxKind::OpenTag, 4.0),
            (6, InlineBoxKind::CloseTag, 3.0),
        ],
    );
    let widths = layout.calculate_content_widths();
    assert_eq!(widths.min, 23.0);
    assert_eq!(widths.max, 55.0);
}
