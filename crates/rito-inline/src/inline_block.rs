//! Inline blocks on a line: an atomic inline sized from its own style (CSS
//! 2.1 §10.3.9 and §10.6.6, as Blink computes an atomic inline's fragment
//! size), its content laid out at that size — a mini paragraph by this
//! context, a block container by the block context that owns it — and the
//! baseline it rides the line by.

use rito_style_contract::{
    BoxSizing, LayoutStyleId, LengthPercentageOrAuto, MinimumSize, NonNegativeLengthPercentage,
    Overflow,
};

use crate::atoms::SizedAtom;
use crate::*;

impl ParleyInlineContext {
    /// The inline block `node`, styled `layout_style`, sized and laid out
    /// for a line of the paragraph at `host` in `space`.
    pub(crate) fn size_inline_block(
        &self,
        tree: &FormattingTree,
        host: FormattingNodeId,
        node: FormattingNodeId,
        layout_style: LayoutStyleId,
        space: &BuildSpace,
        cancel: &CancelFlag,
    ) -> Result<SizedAtom, LayoutError> {
        let styles = tree.styles().ok_or_else(|| {
            LayoutError::Invalid("inline flow tree carries no style tables".to_owned())
        })?;
        let style = styles
            .layout
            .style(layout_style)
            .map_err(|error| LayoutError::Invalid(error.to_string()))?;
        // One in a writing mode not the host's is an orthogonal flow: its
        // lines run across the host's, in the space the host has across
        // them (CSS Writing Modes 3 §7.3).
        let horizontal = |mode: WritingMode| mode == WritingMode::HorizontalTopToBottom;
        let orthogonal = tree
            .strut_style(host)
            .and_then(|id| styles.inline.style(id).ok())
            .is_some_and(|strut| {
                horizontal(strut.bidi.writing_mode) != horizontal(style.writing_mode)
            });
        let block_content = matches!(
            tree.node(node).content,
            FormattingNodeContent::BlockContainer
        );
        // Its margins, borders and padding surround the content on the
        // line (Blink sizes an atomic inline by its margin box); an
        // orthogonal flow keeps its bare box.
        let (margin, frame) = if orthogonal {
            (BoxEdges::default(), BoxEdges::default())
        } else {
            box_edges(tree, host, layout_style, space.inline_size())?
        };
        // Percentages along its own inline axis resolve against the host's
        // lines, or, orthogonal, against the host's block size: the
        // initial containing block's when that is indefinite (Blink's
        // orthogonal fallback inline size), and the page is the reader's.
        let (inline_basis, block_basis) = if orthogonal {
            (
                space.containing_block_size().or(space.block_size()),
                space.inline_size(),
            )
        } else {
            (space.inline_size(), space.containing_block_size())
        };
        let frame_inline = frame.inline_start + frame.inline_end;
        let frame_block = frame.block_start + frame.block_end;
        let inline_bounds = SizeBounds::new(
            style.inline_size(),
            style.min_inline_size(),
            style.max_inline_size(),
            style.box_sizing,
            inline_basis,
            frame_inline,
        );
        let content_inline = match inline_bounds.preferred {
            Some(size) => size,
            None => {
                // Shrink-to-fit (CSS 2.1 §10.3.5).
                let sizes = self.inline_block_content_sizes(tree, node, block_content)?;
                let available = if orthogonal {
                    inline_basis
                } else {
                    space.inline_size().map(|size| {
                        (size - margin.inline_start - margin.inline_end - frame_inline).max(0.0)
                    })
                }
                .unwrap_or(sizes.max_content);
                sizes.max_content.min(sizes.min_content.max(available))
            }
        };
        let content_inline = inline_bounds.clamp(content_inline);
        let mut root_box = if block_content {
            let delegate = self.block_layout.ok_or_else(|| {
                LayoutError::Invalid(
                    "an inline-block holding blocks needs the block layout of its block context"
                        .to_owned(),
                )
            })?;
            // The block container lays its content inside its own padding
            // (its borders folded in) at its border-box size.
            let outcome = (delegate.layout)(
                self,
                tree,
                node,
                &ConstraintSpace::continuous(content_inline + frame_inline),
                cancel,
            )?;
            let Fragment::Box(root_box) = outcome.fragments.root else {
                return Err(LayoutError::Invalid(
                    "inline-block layout must produce a box fragment".to_owned(),
                ));
            };
            root_box
        } else {
            let outcome = FormattingContext::layout(
                self,
                tree,
                node,
                &ConstraintSpace::continuous(content_inline),
                None,
                cancel,
            )?;
            let Fragment::Box(mut root_box) = outcome.fragments.root else {
                return Err(LayoutError::Invalid(
                    "inline-block layout must produce a box fragment".to_owned(),
                ));
            };
            shift_children(&mut root_box, frame.inline_start, frame.block_start);
            root_box.rect.width += frame_inline;
            root_box.rect.height += frame_block;
            root_box
        };
        let block_bounds = SizeBounds::new(
            style.block_size(),
            style.min_block_size(),
            style.max_block_size(),
            style.box_sizing,
            block_basis,
            frame_block,
        );
        let content_block = block_bounds.clamp(
            block_bounds
                .preferred
                .unwrap_or(root_box.rect.height - frame_block),
        );
        root_box.rect.height = content_block + frame_block;
        // The atom is its margin box.
        shift_children(&mut root_box, margin.inline_start, margin.block_start);
        root_box.rect.width += margin.inline_start + margin.inline_end;
        root_box.rect.height += margin.block_start + margin.block_end;
        if orthogonal {
            // Across the host's lines it advances by its block size and
            // stands as wide as its lines run; it has no baseline in the
            // host's direction, so it hangs from one synthesized off its
            // margin box (`LogicalBoxFragment::BaselineMetrics`).
            let (above, _) = crate::layout::atom_baseline_extent(root_box.rect.width, true);
            return Ok(SizedAtom {
                width: root_box.rect.height as f32,
                height: root_box.rect.width as f32,
                edge_insets: None,
                block: Some((node.0, above, root_box)),
            });
        }
        // Its baseline is its last line box's (CSS 2.1 §10.8.1), however
        // deep in its block content; one with no line box, or a scroll
        // container (Blink counts `overflow: hidden` as one), rides on its
        // bottom margin edge.
        let baseline = (style.overflow == Overflow::Visible)
            .then(|| last_line_baseline(tree, &root_box))
            .flatten()
            .unwrap_or(root_box.rect.height);
        Ok(SizedAtom {
            width: root_box.rect.width as f32,
            height: root_box.rect.height as f32,
            edge_insets: None,
            block: Some((node.0, baseline, root_box)),
        })
    }

    /// The min- and max-content inline sizes of an inline block's content:
    /// its mini paragraph's, or the widest of its block children's
    /// contributions.
    fn inline_block_content_sizes(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        block_content: bool,
    ) -> Result<IntrinsicInlineSizes, LayoutError> {
        if !block_content {
            return self.intrinsic_inline_sizes(tree, node);
        }
        let delegate = self.block_layout.ok_or_else(|| {
            LayoutError::Invalid(
                "an inline-block holding blocks needs the block layout of its block context"
                    .to_owned(),
            )
        })?;
        let mut sizes = IntrinsicInlineSizes {
            min_content: 0.0,
            max_content: 0.0,
        };
        for child in &tree.node(node).children {
            let child_sizes = (delegate.intrinsic_inline_sizes)(self, tree, *child)?;
            sizes.min_content = sizes.min_content.max(child_sizes.min_content);
            sizes.max_content = sizes.max_content.max(child_sizes.max_content);
        }
        Ok(sizes)
    }
}

/// A box's specified size along one of its own axes and the bounds on it,
/// as content-box lengths; a percentage against no basis is `auto`.
struct SizeBounds {
    preferred: Option<f64>,
    min: f64,
    max: f64,
}

impl SizeBounds {
    fn new(
        preferred: PreferredSize,
        min: MinimumSize,
        max: MaximumSize,
        sizing: BoxSizing,
        basis: Option<f64>,
        frame: f64,
    ) -> Self {
        // A used size sits on the LayoutUnit grid by truncation.
        let content = |used: f64| {
            let used = (used * 64.0).trunc() / 64.0;
            match sizing {
                BoxSizing::ContentBox => used,
                BoxSizing::BorderBox => used - frame,
            }
            .max(0.0)
        };
        let resolve = |value: NonNegativeLengthPercentage| match value.value() {
            LengthPercentage::Length(px) => Some(content(f64::from(px.get()))),
            LengthPercentage::Percentage(ratio) => {
                basis.map(|basis| content(f64::from(ratio.ratio()) * basis))
            }
            LengthPercentage::Linear { length, percentage } => basis.map(|basis| {
                content(f64::from(length.get()) + f64::from(percentage.ratio()) * basis)
            }),
        };
        Self {
            preferred: match preferred {
                PreferredSize::Value(value) => resolve(value),
                _ => None,
            },
            min: match min {
                MinimumSize::Length(px) => content(f64::from(px.get())),
                MinimumSize::Percentage(ratio) => basis
                    .map(|basis| content(f64::from(ratio.ratio()) * basis))
                    .unwrap_or(0.0),
                MinimumSize::Auto => 0.0,
            },
            max: match max {
                MaximumSize::Value(value) => resolve(value).unwrap_or(f64::INFINITY),
                _ => f64::INFINITY,
            },
        }
    }

    /// `size` held within the bounds; the minimum wins over the maximum.
    fn clamp(&self, size: f64) -> f64 {
        size.min(self.max).max(self.min)
    }
}

/// Moves every child of `root` by (`inline`, `block`).
fn shift_children(root: &mut BoxFragment, inline: f64, block: f64) {
    for child in &mut root.children {
        let rect = child.rect_mut();
        rect.x += inline;
        rect.y += block;
    }
}

/// Where the last line box in `root`'s flow sits, its baseline from the
/// box's block-start edge: searched through in-flow block children, past
/// floats and absolutely positioned boxes.
fn last_line_baseline(tree: &FormattingTree, root: &BoxFragment) -> Option<f64> {
    let out_of_flow = |source: FormattingNodeId| {
        tree.styles()
            .and_then(|styles| styles.layout.style(tree.node(source).style).ok())
            .is_some_and(|style| {
                style.float != rito_style_contract::Float::None
                    || style.position == rito_style_contract::Position::Absolute
            })
    };
    root.children.iter().rev().find_map(|child| match child {
        Fragment::Line(line) => Some(line.rect.y + line.baseline),
        Fragment::Box(inner) if !out_of_flow(inner.source) => {
            last_line_baseline(tree, inner).map(|baseline| inner.rect.y + baseline)
        }
        _ => None,
    })
}

/// An inline block's margin, or its border plus padding, on each side of
/// its content, in the host's flow-relative directions.
#[derive(Clone, Copy, Debug, Default)]
struct BoxEdges {
    inline_start: f64,
    inline_end: f64,
    block_start: f64,
    block_end: f64,
}

/// The margins and the borders plus paddings of the inline block styled
/// `layout_style` on a line of the paragraph at `host`, percentages
/// against the host's inline size, each truncated onto the LayoutUnit grid
/// as Blink stores a used margin or padding.
fn box_edges(
    tree: &FormattingTree,
    host: FormattingNodeId,
    layout_style: LayoutStyleId,
    containing_inline_size: Option<f64>,
) -> Result<(BoxEdges, BoxEdges), LayoutError> {
    let styles = tree.styles().ok_or_else(|| {
        LayoutError::Invalid("inline flow tree carries no style tables".to_owned())
    })?;
    let style_of = |id| {
        styles
            .layout
            .style(id)
            .map_err(|error| LayoutError::Invalid(error.to_string()))
    };
    let style = style_of(layout_style)?;
    let container = style_of(tree.node(host).style)?.writing_direction();
    let basis = containing_inline_size.unwrap_or(0.0);
    let used = |value: LengthPercentage| {
        let resolved = match value {
            LengthPercentage::Length(px) => f64::from(px.get()),
            LengthPercentage::Percentage(ratio) => f64::from(ratio.ratio()) * basis,
            LengthPercentage::Linear { length, percentage } => {
                f64::from(length.get()) + f64::from(percentage.ratio()) * basis
            }
        };
        (resolved * 64.0).trunc() / 64.0
    };
    let margins = style.margin_in(container);
    let margin = |side: LengthPercentageOrAuto| match side {
        LengthPercentageOrAuto::Auto => 0.0,
        LengthPercentageOrAuto::Value(value) => used(value),
    };
    let padding = style.flow_padding();
    let border = style.flow_border_widths();
    let frame = |border_side: rito_style_contract::NonNegativeCssPx,
                 padding_side: NonNegativeLengthPercentage| {
        f64::from(border_side.get()) + used(padding_side.value()).max(0.0)
    };
    Ok((
        BoxEdges {
            inline_start: margin(margins.inline_start),
            inline_end: margin(margins.inline_end),
            block_start: margin(margins.block_start),
            block_end: margin(margins.block_end),
        },
        BoxEdges {
            inline_start: frame(border.inline_start, padding.inline_start),
            inline_end: frame(border.inline_end, padding.inline_end),
            block_start: frame(border.block_start, padding.block_start),
            block_end: frame(border.block_end, padding.block_end),
        },
    ))
}
