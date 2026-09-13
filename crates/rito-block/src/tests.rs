//! Block layout behaviour pinned against the browser oracle, by theme.

use super::*;
use rito_fragment::{FormattingNode, FormattingTreeStyles, InlineItem, LineFragment};
use rito_inline::{plain_paragraph_style, ParleyInlineContext};
use rito_style_contract::{
    AlignItems, Clear, CssPx, Float, FontFamilies, FontFamily, FontFamilyName, InlineStyleTable,
    JustifyContent, LayoutDisplay, LayoutDisplayInside, LayoutDisplayOutside,
    LayoutFormattingStyle, LayoutStyleId, LayoutStyleTable, ListMarkerStyle, MaximumHeight,
    MaximumSize, MinimumHeight, NonNegativeLengthPercentage, Overflow, PageBreak, Percentage,
    PhysicalSides, Position, PreferredSize,
};

mod floats;
mod margins;
mod pagination;
mod tables;

fn margin_px(value: f64) -> LengthPercentageOrAuto {
    LengthPercentageOrAuto::Value(LengthPercentage::Length(
        CssPx::new(value as f32).expect("finite margin"),
    ))
}

fn zero_padding() -> NonNegativeLengthPercentage {
    NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(0.0).expect("zero length"),
    ))
}

fn block_style(
    margin_top: LengthPercentageOrAuto,
    margin_bottom: LengthPercentageOrAuto,
) -> LayoutFormattingStyle {
    LayoutFormattingStyle {
        display: LayoutDisplay {
            outside: LayoutDisplayOutside::Block,
            inside: LayoutDisplayInside::Flow,
            is_list_item: false,
        },
        margin: PhysicalSides {
            top: margin_top,
            right: margin_px(0.0),
            bottom: margin_bottom,
            left: margin_px(0.0),
        },
        padding: PhysicalSides {
            top: zero_padding(),
            right: zero_padding(),
            bottom: zero_padding(),
            left: zero_padding(),
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
            top: LengthPercentageOrAuto::Auto,
            right: LengthPercentageOrAuto::Auto,
            bottom: LengthPercentageOrAuto::Auto,
            left: LengthPercentageOrAuto::Auto,
        },
        vertical_align: rito_style_contract::CellVerticalAlign::Baseline,
        border_spacing: (
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
        ),
        border_collapse: false,
        object_fit: rito_style_contract::ObjectFit::Fill,
    }
}

/// One interned zero-margin style for every node slot.
fn uniform_layout_table(node_count: usize) -> LayoutStyleTable {
    layout_table_with(node_count, |_| block_style(margin_px(0.0), margin_px(0.0)))
}

fn layout_table_with(
    node_count: usize,
    style_for: impl Fn(usize) -> LayoutFormattingStyle,
) -> LayoutStyleTable {
    let mut table = LayoutStyleTable::new(node_count);
    for index in 0..node_count {
        table
            .intern_for_node(index, style_for(index))
            .expect("style interns");
    }
    table
}

fn node_style_id(table: &LayoutStyleTable, index: usize) -> LayoutStyleId {
    table.node_style_id(index).expect("node style assigned")
}

/// Deterministic fake inline provider: every paragraph lays out as one
/// 10px-tall line per item, so block pagination is exactly predictable.
struct FixedLineInline;

impl FormattingContext for FixedLineInline {
    fn layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        _token: Option<&BreakToken>,
        _cancel: &CancelFlag,
    ) -> Result<LayoutOutcome, LayoutError> {
        let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
            return Err(LayoutError::Invalid("not an inline flow".to_owned()));
        };
        let lines = (0..items.len())
            .map(|index| {
                Fragment::Line(LineFragment {
                    source: node,
                    marker: None,
                    rect: FragmentRect {
                        x: 0.0,
                        y: 10.0 * index as f64,
                        width: space.inline_size,
                        height: 10.0,
                    },
                    baseline: 8.0,
                    trailing_whitespace: 0.0,
                    ruby_growth: 0.0,
                    children: Vec::new(),
                })
            })
            .collect();
        Ok(LayoutOutcome {
            fragments: FragmentTree {
                root: Fragment::Box(BoxFragment {
                    source: node,
                    rect: FragmentRect {
                        x: 0.0,
                        y: 0.0,
                        width: space.inline_size,
                        height: 10.0 * items.len() as f64,
                    },
                    children: lines,
                }),
            },
            continuation: None,
            escaped_floats: Vec::new(),
        })
    }

    fn intrinsic_inline_sizes(
        &self,
        _tree: &FormattingTree,
        _node: FormattingNodeId,
    ) -> Result<IntrinsicInlineSizes, LayoutError> {
        Ok(IntrinsicInlineSizes {
            min_content: 10.0,
            max_content: 100.0,
        })
    }
}

fn paginate(
    context: &impl FormattingContext,
    tree: &FormattingTree,
    space: ConstraintSpace,
) -> Vec<LayoutOutcome> {
    let cancel = CancelFlag::new();
    let mut pages = Vec::new();
    let mut token: Option<BreakToken> = None;
    loop {
        let outcome = context
            .layout(tree, tree.root(), &space, token.as_ref(), &cancel)
            .expect("page lays out");
        token = outcome.continuation.clone();
        pages.push(outcome);
        if token.is_none() {
            return pages;
        }
        assert!(pages.len() < 64, "pagination must terminate");
    }
}

fn box_children(outcome: &LayoutOutcome) -> &[Fragment] {
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("container roots are box fragments");
    };
    &root.children
}
