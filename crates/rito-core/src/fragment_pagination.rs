//! Paginates one chapter's formatting tree into page-sized fragment trees
//! and their display-command frames.
//!
//! Drives the fragment engine's break-token protocol: each iteration lays
//! the chapter into one fragmentainer (a page's content box), paints the
//! sealed fragments into display commands at the page's content origin,
//! and resumes from the returned continuation until the chapter is
//! exhausted. The engine arrives as a trait object so pagination is
//! independent of which inline provider backs it.

use rito_fragment::{CancelFlag, ConstraintSpace, FormattingContext, FormattingTree, Fragment};

use crate::epub::{EpubError, EpubResult};
use crate::fragment_paint::{append_fragment_display_commands, FragmentPaintContext};
use crate::render::DisplayCommand;

/// One paginated page: the sealed fragment tree that fit the page's
/// content box. Paint is not part of pagination — a page paints on
/// demand through [`paint_chapter_page`] for whatever device ratio the
/// reader draws at, so a ratio change never re-paginates.
pub(crate) struct FragmentChapterPage {
    /// Root fragment of this page's content, in content-box coordinates.
    pub(crate) root: Fragment,
}

/// Whether the chapter lays out vertical-rl: its first inline flow's
/// strut declares the writing mode (chapters mix modes only via nested
/// flows, which the capability gate still rejects).
pub(crate) fn chapter_is_vertical(tree: &FormattingTree) -> bool {
    tree.styles()
        .and_then(|tables| {
            let strut = first_inline_strut(tree, tree.root())?;
            tables.inline.style(strut).ok()
        })
        .is_some_and(|style| {
            style.bidi.writing_mode == rito_style_contract::WritingMode::VerticalRightToLeft
        })
}

/// Paints one paginated page into display commands at the page's content
/// origin. A vertical-rl page laid out in the swapped frame maps back
/// onto the device page through the vertical frame.
pub(crate) fn paint_chapter_page(
    tree: &FormattingTree,
    root: &Fragment,
    content_width: f64,
    origin_x: f64,
    origin_y: f64,
    paint_context: FragmentPaintContext<'_>,
    vertical: bool,
) -> EpubResult<Vec<DisplayCommand>> {
    let paint_context = FragmentPaintContext {
        vertical_frame: vertical.then_some((origin_x + content_width, origin_y)),
        ..paint_context
    };
    let (origin_x, origin_y) = if vertical {
        (0.0, 0.0)
    } else {
        (origin_x, origin_y)
    };
    let mut commands = Vec::new();
    append_fragment_display_commands(&mut commands, tree, root, origin_x, origin_y, paint_context)?;
    Ok(commands)
}

/// Pages a chapter can paginate into before the paginator treats the run
/// as diverging. A page holds at least one line in practice, so real
/// chapters stay far below this; the guard exists because a provider that
/// returned a non-advancing continuation would otherwise loop forever.
const FRAGMENT_PAGINATION_PAGE_LIMIT: usize = 100_000;

/// The strut style of the first inline flow under `node`. Struts are
/// recorded per inline-flow node, so a chapter's writing mode reads off
/// its first flow (chapters mix modes only via nested flows, which the
/// capability gate still rejects).
fn first_inline_strut(
    tree: &FormattingTree,
    node: rito_fragment::FormattingNodeId,
) -> Option<rito_style_contract::StyleId> {
    if let Some(strut) = tree.strut_style(node) {
        return Some(strut);
    }
    let children = tree.node(node).children.clone();
    children
        .into_iter()
        .find_map(|child| first_inline_strut(tree, child))
}

/// Lays `tree` out page by page into `content_width` × `content_height`
/// fragmentainers and paints each page at `(origin_x, origin_y)`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn paginate_chapter(
    engine: &dyn FormattingContext,
    tree: &FormattingTree,
    content_width: f64,
    content_height: f64,
    cancel: &CancelFlag,
) -> EpubResult<Vec<FragmentChapterPage>> {
    // A vertical-rl chapter lays out in the swapped page: the column
    // length (page height) is the inline size and the page WIDTH is the
    // fragmentainer, so a page fills with as many columns as fit across
    // it. The paint walk maps the swapped geometry back onto the device
    // page through the vertical frame.
    let vertical = chapter_is_vertical(tree);
    let space = if vertical {
        ConstraintSpace::fragmented(content_height, content_width)
    } else {
        ConstraintSpace::fragmented(content_width, content_height)
    };
    let mut token = None;
    let mut pages = Vec::new();
    loop {
        let outcome = engine
            .layout(tree, tree.root(), &space, token.as_ref(), cancel)
            .map_err(|error| {
                EpubError::new(format!(
                    "fragment pagination failed on page {}: {error:?}",
                    pages.len()
                ))
            })?;
        pages.push(FragmentChapterPage {
            root: outcome.fragments.root,
        });
        match outcome.continuation {
            Some(continuation) => {
                if pages.len() >= FRAGMENT_PAGINATION_PAGE_LIMIT {
                    return Err(EpubError::new(format!(
                        "fragment pagination exceeded {FRAGMENT_PAGINATION_PAGE_LIMIT} pages \
                         without exhausting the chapter"
                    )));
                }
                token = Some(continuation);
            }
            None => return Ok(pages),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use rito_block::BlockFormattingContext;
    use rito_fragment::{
        FormattingNode, FormattingNodeContent, FormattingNodeId, FormattingTreeStyles, InlineItem,
    };
    use rito_inline::{plain_paragraph_style, ParleyInlineContext};
    use rito_style_contract::{
        AlignItems, BoxSizing, Clear, CssPx, Float, FontFamilies, FontFamily, FontFamilyName,
        InlineStyleTable, JustifyContent, LayoutDisplay, LayoutDisplayInside, LayoutDisplayOutside,
        LayoutFormattingStyle, LayoutStyleTable, LengthPercentage, LengthPercentageOrAuto,
        ListMarkerStyle, MaximumHeight, MaximumSize, MinimumHeight, NonNegativeLengthPercentage,
        Overflow, PageBreak, PhysicalSides, Position, PreferredSize,
    };

    fn plain_block_layout_style() -> LayoutFormattingStyle {
        let zero = LengthPercentageOrAuto::Value(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero length"),
        ));
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero length"),
        ));
        let sides = |value| PhysicalSides {
            top: value,
            right: value,
            bottom: value,
            left: value,
        };
        LayoutFormattingStyle {
            display: LayoutDisplay {
                outside: LayoutDisplayOutside::Block,
                inside: LayoutDisplayInside::Flow,
                is_list_item: false,
            },
            margin: sides(zero),
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
            inset: sides(LengthPercentageOrAuto::Auto),
            vertical_align: rito_style_contract::CellVerticalAlign::Baseline,
            border_spacing: (
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            ),
            border_collapse: false,
            object_fit: rito_style_contract::ObjectFit::Fill,
        }
    }

    fn tinos_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
        );
        std::fs::read(path).expect("pinned Tinos test font reads")
    }

    fn paragraph_tree(text: &str) -> FormattingTree {
        let mut inline = InlineStyleTable::new(1);
        let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
            .expect("family list is non-empty");
        let style = inline
            .intern_for_node(0, plain_paragraph_style(families, 16.0, 0.0))
            .expect("style interns");
        let mut layout = LayoutStyleTable::new(1);
        let block = layout
            .intern_for_node(0, plain_block_layout_style())
            .expect("layout style interns");
        let nodes = vec![
            FormattingNode {
                style: block,
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(1)],
            },
            FormattingNode {
                style: block,
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            },
        ];
        FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds")
    }

    fn paint(tree: &FormattingTree, pages: &[FragmentChapterPage]) -> Vec<Vec<DisplayCommand>> {
        pages
            .iter()
            .map(|page| {
                paint_chapter_page(
                    tree,
                    &page.root,
                    200.0,
                    24.0,
                    32.0,
                    FragmentPaintContext::default(),
                    chapter_is_vertical(tree),
                )
                .expect("page paints")
            })
            .collect()
    }

    fn painted_text(painted: &[Vec<DisplayCommand>]) -> String {
        let mut text = String::new();
        for commands in painted {
            for command in commands {
                if let DisplayCommand::PaintText(input) = command {
                    text.push_str(&input.text);
                }
            }
        }
        text
    }

    #[test]
    fn a_long_paragraph_breaks_into_pages_that_repaint_every_word() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let engine = BlockFormattingContext::new(context);
        let sample = "The quick brown fox jumps over the lazy dog. ".repeat(40);
        let tree = paragraph_tree(sample.trim_end());
        let cancel = CancelFlag::new();
        let pages =
            paginate_chapter(&engine, &tree, 200.0, 100.0, &cancel).expect("chapter paginates");
        assert!(
            pages.len() > 1,
            "40 sentences at 200×100 must span pages, got {}",
            pages.len()
        );
        let painted = paint(&tree, &pages);
        for (index, page) in pages.iter().enumerate() {
            assert!(
                !painted[index].is_empty(),
                "page {index} painted no commands"
            );
            let Fragment::Box(root) = &page.root else {
                panic!("page {index} root is not a box");
            };
            assert!(root.rect.height <= 100.0 + 1e-6, "page {index} overflows");
        }
        // Whitespace collapsing happens before the tree is built, so the
        // pages' painted runs must reassemble the exact source text.
        let reassembled = painted_text(&painted)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(reassembled, sample.trim_end());
    }

    #[test]
    fn pagination_paints_at_the_page_content_origin() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let engine = BlockFormattingContext::new(context);
        let tree = paragraph_tree("One line.");
        let cancel = CancelFlag::new();
        let pages =
            paginate_chapter(&engine, &tree, 200.0, 100.0, &cancel).expect("chapter paginates");
        assert_eq!(pages.len(), 1);
        let painted = paint(&tree, &pages);
        let DisplayCommand::PaintText(input) = &painted[0][0] else {
            panic!("expected a text command, got {:?}", painted[0][0]);
        };
        let (x, y) = (input.rect.x, input.rect.y);
        assert!(x >= 24.0, "content starts at the x origin, got {x}");
        assert!(y >= 32.0, "content starts below the y origin, got {y}");
    }
}
