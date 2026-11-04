//! An inline box's start and end sizes as Blink's open and close tag
//! items, pinned against Chromium 156 (Source Han Serif at 16px): a break
//! at a box's start sends its start size down with its content, and a box
//! nested in another takes both start sizes.

use super::*;

fn source_han_context() -> ParleyInlineContext {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    ParleyInlineContext::new(vec![source_han]).expect("context builds")
}

/// One piece of a test paragraph.
enum Piece {
    /// Text in the style of the box it sits in (0: the paragraph's own).
    Text(&'static str, usize),
    Open(usize),
    Close(usize),
}

/// The paragraph `pieces` lays out, its boxes `edges` (padding-left,
/// margin-left, border-left, padding-right per box, box 0 the paragraph's
/// plain style), at `width`: each line's text and where its first glyph
/// run starts.
fn lay_boxes(pieces: &[Piece], edges: &[[f32; 4]], width: f64) -> Vec<(String, f64)> {
    use rito_style_contract::{BorderEdge, BorderStyle, CssPx, NonNegativeCssPx};
    let context = source_han_context();
    let mut inline = InlineStyleTable::new(edges.len() + 1);
    let length = |px: f32| LengthPercentage::Length(CssPx::new(px).expect("finite"));
    let mut styles = vec![inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns")];
    for (index, [padding_left, margin_left, border_left, padding_right]) in edges.iter().enumerate()
    {
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            16.0,
            0.0,
        );
        style.fragment.padding.left =
            rito_style_contract::NonNegativeLengthPercentage::new(length(*padding_left));
        style.fragment.padding.right =
            rito_style_contract::NonNegativeLengthPercentage::new(length(*padding_right));
        style.fragment.margin.left =
            rito_style_contract::LengthPercentageOrAuto::Value(length(*margin_left));
        if *border_left > 0.0 {
            style.fragment.border.left = BorderEdge {
                resolved_width: NonNegativeCssPx::new(*border_left).expect("finite"),
                style: BorderStyle::Solid,
                color: style.paint.foreground.into(),
            };
        }
        styles.push(
            inline
                .intern_for_node(index + 1, style)
                .expect("style interns"),
        );
    }
    let items = pieces
        .iter()
        .map(|piece| match piece {
            Piece::Text(text, style) => InlineItem::Text {
                text: (*text).to_owned(),
                style: styles[*style],
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            },
            Piece::Open(style) => InlineItem::OpenTag {
                style: styles[*style],
            },
            Piece::Close(style) => InlineItem::CloseTag {
                style: styles[*style],
            },
        })
        .collect();
    let text: String = pieces
        .iter()
        .filter_map(|piece| match piece {
            Piece::Text(text, _) => Some(*text),
            _ => None,
        })
        .collect();
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
            &ConstraintSpace::continuous(width),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let texts = line_texts(&outcome, &text);
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("inline outcome root is a box fragment");
    };
    root.children
        .iter()
        .zip(texts)
        .map(|(line, text)| {
            let Fragment::Line(line) = line else {
                panic!("inline children are line fragments");
            };
            let x = line
                .children
                .iter()
                .find_map(|child| match child {
                    Fragment::Text(run) => Some(line.rect.x + run.rect.x),
                    _ => None,
                })
                .expect("a line holds text");
            (text, x)
        })
        .collect()
}

fn lines(expected: &[(&str, f64)]) -> Vec<(String, f64)> {
    expected
        .iter()
        .map(|(text, x)| ((*text).to_owned(), *x))
        .collect()
}

const TEN: &str = "永永永永永永永永永永";

/// Chromium at 162 and 165px: the ten ideographs before the box fit and
/// end the line, the box's 4px start opens the next one.
#[test]
fn a_break_at_a_box_start_takes_its_start_size_down() {
    for width in [162.0, 165.0] {
        let laid = lay_boxes(
            &[Piece::Text(TEN, 0), Piece::Open(1), Piece::Text("永永", 1)],
            &[[4.0, 0.0, 0.0, 0.0]],
            width,
        );
        assert_eq!(laid, lines(&[(TEN, 0.0), ("永永", 4.0)]), "at {width}px");
    }
}

/// Chromium at 170px trims the closer before the box to keep it on the
/// line (its start size goes down); at 172px nine ideographs and the
/// closer fit whole.
#[test]
fn a_closer_before_a_box_extends_its_line_without_the_box_start() {
    let laid = lay_boxes(
        &[
            Piece::Text("永永永永永永永永永永」", 0),
            Piece::Open(1),
            Piece::Text("永永", 1),
        ],
        &[[4.0, 0.0, 0.0, 0.0]],
        170.0,
    );
    assert_eq!(
        laid,
        lines(&[("永永永永永永永永永永」", 0.0), ("永永", 4.0)])
    );
    let laid = lay_boxes(
        &[
            Piece::Text("永永永永永永永永永」", 0),
            Piece::Open(1),
            Piece::Text("永永", 1),
        ],
        &[[4.0, 0.0, 0.0, 0.0]],
        172.0,
    );
    assert_eq!(laid, lines(&[("永永永永永永永永永」", 0.0), ("永永", 4.0)]));
}

/// A box opening inside a word is no break: the word stays whole.
#[test]
fn a_box_start_inside_a_word_is_no_break() {
    let laid = lay_boxes(
        &[
            Piece::Text("aaaaaa", 0),
            Piece::Open(1),
            Piece::Text("bbbb", 1),
            Piece::Text(" cc", 0),
        ],
        &[[4.0, 0.0, 0.0, 0.0]],
        60.0,
    );
    assert!(laid[0].0.starts_with("aaaaaabbbb"), "{laid:?}");
}

/// A space before the box hangs at the end of its line; the box's start
/// opens the next.
#[test]
fn a_box_after_a_space_opens_the_next_line() {
    let laid = lay_boxes(
        &[
            Piece::Text("永永永永 ", 0),
            Piece::Open(1),
            Piece::Text("永永", 1),
        ],
        &[[4.0, 0.0, 0.0, 0.0]],
        80.0,
    );
    assert_eq!(laid, lines(&[("永永永永 ", 0.0), ("永永", 4.0)]));
}

/// Boxes opening at one point take both start sizes (Chromium: padding 2
/// and margin 3 put the text at 5px), and a border counts as padding does.
#[test]
fn nested_box_starts_and_borders_add_up() {
    let laid = lay_boxes(
        &[
            Piece::Text(TEN, 0),
            Piece::Open(1),
            Piece::Open(2),
            Piece::Text("永永", 2),
        ],
        &[[2.0, 0.0, 0.0, 0.0], [0.0, 3.0, 0.0, 0.0]],
        162.0,
    );
    assert_eq!(laid, lines(&[(TEN, 0.0), ("永永", 5.0)]));
    let laid = lay_boxes(
        &[Piece::Text(TEN, 0), Piece::Open(1), Piece::Text("永永", 1)],
        &[[1.0, 0.0, 3.0, 0.0]],
        162.0,
    );
    assert_eq!(laid, lines(&[(TEN, 0.0), ("永永", 4.0)]));
}

/// A box opening after a forced break or at the paragraph's start offsets
/// its own line; one whose content does not fit on the first line breaks
/// inside it (Chromium at 162px: nine ideographs after the 4px start).
#[test]
fn a_box_start_offsets_the_line_it_opens() {
    let laid = lay_boxes(
        &[
            Piece::Text("永永\n", 0),
            Piece::Open(1),
            Piece::Text("永永", 1),
        ],
        &[[4.0, 0.0, 0.0, 0.0]],
        162.0,
    );
    assert_eq!(laid, lines(&[("永永\n", 0.0), ("永永", 4.0)]));
    let laid = lay_boxes(
        &[Piece::Open(1), Piece::Text(TEN, 1), Piece::Text("永永", 0)],
        &[[4.0, 0.0, 0.0, 0.0]],
        162.0,
    );
    assert_eq!(laid, lines(&[("永永永永永永永永永", 4.0), ("永永永", 0.0)]));
}

/// A box's end size stays with its content: at 162px the ten ideographs
/// and the 4px end do not fit, and Chromium sends the last ideograph down
/// with the end (its second line ends at 16 + 4 + 32 = 52px).
#[test]
fn a_box_end_that_overflows_takes_its_content_down() {
    let laid = lay_boxes(
        &[Piece::Text(TEN, 1), Piece::Close(1), Piece::Text("永永", 0)],
        &[[0.0, 0.0, 0.0, 4.0]],
        162.0,
    );
    assert_eq!(laid, lines(&[("永永永永永永永永永", 0.0), ("永永永", 0.0)]));
}

/// A box's start and end edges follow its writing mode: left and right in
/// horizontal lines (swapped when they run right to left), top and bottom
/// in vertical ones.
#[test]
fn box_edges_follow_the_writing_mode() {
    use rito_style_contract::{CssPx, Direction, NonNegativeLengthPercentage, WritingMode};
    let mut style = plain_paragraph_style(
        FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
            .expect("family list"),
        16.0,
        0.0,
    );
    let side = |px: f32| {
        NonNegativeLengthPercentage::new(LengthPercentage::Length(CssPx::new(px).expect("finite")))
    };
    style.fragment.padding.top = side(5.0);
    style.fragment.padding.right = side(3.0);
    style.fragment.padding.bottom = side(2.0);
    style.fragment.padding.left = side(4.0);
    let edges = |style: &InlineFormattingStyle| {
        (
            style.inline_edge(false).size(None),
            style.inline_edge(true).size(None),
        )
    };
    assert_eq!(edges(&style), (4.0, 3.0));
    style.bidi.direction = Direction::RightToLeft;
    assert_eq!(edges(&style), (3.0, 4.0));
    style.bidi.direction = Direction::LeftToRight;
    style.bidi.writing_mode = WritingMode::VerticalRightToLeft;
    assert_eq!(edges(&style), (5.0, 2.0));
}
