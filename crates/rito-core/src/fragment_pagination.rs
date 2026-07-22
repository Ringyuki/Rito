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
use crate::fragment_paint::{append_fragment_display_commands, PaintFamilyPolicy};
use crate::render::DisplayCommand;

/// One paginated page: the sealed fragment tree that fit the page's
/// content box, and the commands that paint it.
pub(crate) struct FragmentChapterPage {
    /// Root fragment of this page's content, in content-box coordinates.
    /// The frame bridge paints from `commands` alone; the fragment page
    /// artifact (interaction geometry) will consume this tree.
    #[allow(dead_code)]
    pub(crate) root: Fragment,
    /// Paint commands for the page content, translated to the origin the
    /// paginator was given (the page's content origin within its frame).
    pub(crate) commands: Vec<DisplayCommand>,
}

/// Pages a chapter can paginate into before the paginator treats the run
/// as diverging. A page holds at least one line in practice, so real
/// chapters stay far below this; the guard exists because a provider that
/// returned a non-advancing continuation would otherwise loop forever.
const FRAGMENT_PAGINATION_PAGE_LIMIT: usize = 100_000;

/// Lays `tree` out page by page into `content_width` × `content_height`
/// fragmentainers and paints each page at `(origin_x, origin_y)`.
pub(crate) fn paginate_chapter(
    engine: &dyn FormattingContext,
    tree: &FormattingTree,
    content_width: f64,
    content_height: f64,
    origin_x: f64,
    origin_y: f64,
    family_policy: Option<&PaintFamilyPolicy>,
    cancel: &CancelFlag,
) -> EpubResult<Vec<FragmentChapterPage>> {
    let space = ConstraintSpace::fragmented(content_width, content_height);
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
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            tree,
            &outcome.fragments.root,
            origin_x,
            origin_y,
            family_policy,
        )?;
        pages.push(FragmentChapterPage {
            root: outcome.fragments.root,
            commands,
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
        AlignItemsV1, BoxSizingV1, ClearV1, CssPx, FloatV1, FontFamilies, FontFamily,
        FontFamilyName, InlineStyleTableV1, JustifyContentV1, LayoutDisplayInsideV1,
        LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleTableV1,
        LengthPercentage, LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1,
        MaximumSizeV1, MinimumHeightV1, NonNegativeLengthPercentage, OverflowV1, PageBreakV1,
        PhysicalSides, PositionV1, PreferredSizeV1,
    };
    use serde_json::Value;

    fn plain_block_layout_style() -> LayoutFormattingStyleV1 {
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
        LayoutFormattingStyleV1 {
            display: LayoutDisplayV1 {
                outside: LayoutDisplayOutsideV1::Block,
                inside: LayoutDisplayInsideV1::Flow,
                is_list_item: false,
            },
            margin: sides(zero),
            padding: PhysicalSides {
                top: zero_padding,
                right: zero_padding,
                bottom: zero_padding,
                left: zero_padding,
            },
            box_sizing: BoxSizingV1::ContentBox,
            justify_content: JustifyContentV1::Normal,
            align_items: AlignItemsV1::Normal,
            break_before: PageBreakV1::Auto,
            break_after: PageBreakV1::Auto,
            width: PreferredSizeV1::Auto,
            height: PreferredSizeV1::Auto,
            max_width: MaximumSizeV1::None,
            min_height: MinimumHeightV1::Auto,
            max_height: MaximumHeightV1::None,
            clear: ClearV1::None,
            float: FloatV1::None,
            overflow: OverflowV1::Visible,
            list_style_type: ListMarkerStyleV1::None,
            position: PositionV1::Static,
            inset: sides(LengthPercentageOrAuto::Auto),
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
        let mut inline = InlineStyleTableV1::new(1);
        let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
            .expect("family list is non-empty");
        let style = inline
            .intern_for_node(0, plain_paragraph_style(families, 16.0, 0.0))
            .expect("style interns");
        let mut layout = LayoutStyleTableV1::new(1);
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

    fn painted_text(pages: &[FragmentChapterPage]) -> String {
        let mut text = String::new();
        for page in pages {
            for command in &page.commands {
                if let DisplayCommand::PaintText(input) = command {
                    if let Value::String(run) = &input.text {
                        text.push_str(run);
                    }
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
        let pages = paginate_chapter(&engine, &tree, 200.0, 100.0, 24.0, 32.0, None, &cancel)
            .expect("chapter paginates");
        assert!(
            pages.len() > 1,
            "40 sentences at 200×100 must span pages, got {}",
            pages.len()
        );
        for (index, page) in pages.iter().enumerate() {
            assert!(
                !page.commands.is_empty(),
                "page {index} painted no commands"
            );
            let Fragment::Box(root) = &page.root else {
                panic!("page {index} root is not a box");
            };
            assert!(root.rect.height <= 100.0 + 1e-6, "page {index} overflows");
        }
        // Whitespace collapsing happens before the tree is built, so the
        // pages' painted runs must reassemble the exact source text.
        let reassembled = painted_text(&pages)
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
        let pages = paginate_chapter(&engine, &tree, 200.0, 100.0, 24.0, 32.0, None, &cancel)
            .expect("chapter paginates");
        assert_eq!(pages.len(), 1);
        let DisplayCommand::PaintText(input) = &pages[0].commands[0] else {
            panic!("expected a text command, got {:?}", pages[0].commands[0]);
        };
        let Value::Object(rect) = &input.rect else {
            panic!("rect is an object");
        };
        let x = rect["x"].as_f64().expect("x is a number");
        let y = rect["y"].as_f64().expect("y is a number");
        assert!(x >= 24.0, "content starts at the x origin, got {x}");
        assert!(y >= 32.0, "content starts below the y origin, got {y}");
    }
}
