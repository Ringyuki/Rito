//! A line read without its glyphs splits as a line read with them.

use super::*;
use crate::shaped::ParagraphEdits;
use parley::{Cluster, LineStyleRun, PositionedLayoutItem};

/// Ligatures across two items (`of|fice`); forced breaks, whose newline
/// holds no glyph, as items of their own (two in a row leave a blank line)
/// and inside an item; a CJK run served by the fallback face inside a
/// Latin item; an image; and right-to-left Hebrew.
fn mixed_tree() -> FormattingTree {
    let serif = || {
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)]).expect("family list")
    };
    let mut inline = InlineStyleTable::new(2);
    let text_style = inline
        .intern_for_node(0, plain_paragraph_style(serif(), 16.0, 0.0))
        .expect("style interns");
    let image_style = inline
        .intern_for_node(1, plain_paragraph_style(serif(), 16.0, 0.0))
        .expect("image style interns");
    let mut layout = LayoutStyleTable::new(1);
    let image_layout = layout
        .intern_for_node(0, atoms_and_grid::jgap_image_layout_style())
        .expect("layout style interns");
    let text = |text: &str| InlineItem::Text {
        text: text.to_owned(),
        style: text_style,
        baseline_shift_px: 0.0,
        ruby_annotation: None,
    };
    let items = vec![
        text("An of"),
        text("fice of fine fluff, efficient and final;"),
        text("\n"),
        text("\n"),
        text("a blank line above and\none break inside this item, "),
        text("甲乙丙丁 mixed 戊己庚辛 within one item, "),
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
        text(" then שלום עולם and בוקר טוב read right to left, "),
        text("and a last stretch of plain words to wrap across a few more lines."),
    ];
    FormattingTree::with_styles(
        vec![FormattingNode {
            style: image_layout,
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles { layout, inline },
    )
    .expect("inline tree builds")
}

#[derive(Debug, PartialEq)]
enum Piece {
    Glyphs {
        run: usize,
        text: std::ops::Range<usize>,
        brush: [u8; 4],
    },
    Atom(u64),
}

#[test]
fn a_line_splits_alike_with_and_without_its_glyphs() {
    let context =
        ParleyInlineContext::new(vec![tinos_bytes(), source_han_bytes()]).expect("context builds");
    let tree = mixed_tree();
    let edits = ParagraphEdits {
        end_trims: &[],
        suppressed_pair_trims: &[],
        split_spreads: &[],
    };
    let mut lines_checked = 0;
    let mut bytes_checked = 0;
    for width in (40..=420).step_by(7) {
        let space = ConstraintSpace::continuous(f64::from(width));
        let mut paragraph = context
            .shaped_paragraph(
                &tree,
                FormattingNodeId(0),
                &space,
                edits,
                &CancelFlag::new(),
            )
            .expect("paragraph builds");
        paragraph.layout.break_all_lines(Some(width as f32));
        let layout = &paragraph.layout;
        for line in layout.lines() {
            let placed: Vec<Piece> = line
                .items()
                .map(|item| match item {
                    PositionedLayoutItem::GlyphRun(glyph_run) => Piece::Glyphs {
                        run: glyph_run.run().index(),
                        text: glyph_run.run().text_range(),
                        brush: glyph_run.style().brush,
                    },
                    PositionedLayoutItem::InlineBox(inline_box) => Piece::Atom(inline_box.id),
                })
                .collect();
            let split: Vec<Piece> = line
                .style_runs()
                .map(|item| match item {
                    LineStyleRun::Glyphs { run, style } => Piece::Glyphs {
                        run: run.index(),
                        text: run.text_range(),
                        brush: style.brush,
                    },
                    LineStyleRun::InlineBox(inline_box) => Piece::Atom(inline_box.id),
                })
                .collect();
            assert_eq!(split, placed, "line {:?} at {width}", line.text_range());
            assert_eq!(
                line.has_inline_box(),
                placed.iter().any(|piece| matches!(piece, Piece::Atom(_)))
            );
            lines_checked += 1;
        }
        // Every character finds the cluster a walk over its line's runs
        // finds.
        for (byte, _) in paragraph.text.char_indices() {
            let walked = layout.lines().find_map(|line| {
                line.runs().find_map(|run| {
                    let index = run.index();
                    run.clusters()
                        .find(|cluster| cluster.text_range().contains(&byte))
                        .map(|cluster| (index, cluster.text_range(), cluster.advance()))
                })
            });
            let found = Cluster::from_byte_index(layout, byte).map(|cluster| {
                (
                    cluster.run().index(),
                    cluster.text_range(),
                    cluster.advance(),
                )
            });
            assert_eq!(found, walked, "byte {byte} at {width}");
            bytes_checked += 1;
        }
    }
    assert!(lines_checked > 300, "{lines_checked} lines");
    assert!(bytes_checked > 5000, "{bytes_checked} bytes");
}
