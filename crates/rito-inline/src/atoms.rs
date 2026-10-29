//! Images and inline blocks on a line: the boxes a paragraph reserves for
//! them, sized for the space it is laid out in.
//!
//! Shaping sees an atom only as a position in the text; the line breaker
//! reads its size. So a paragraph shaped in one space is laid out in
//! another by sizing its atoms again and writing the sizes into the boxes
//! it already holds, which is what a fresh build would hold.

use crate::*;

/// An image or inline block sized for one space.
pub(crate) struct SizedAtom {
    /// The advance the line reserves for it.
    pub(crate) width: f32,
    pub(crate) height: f32,
    /// An image's (left, right) edge insets.
    pub(crate) edge_insets: Option<(f64, f64)>,
    /// An inline block's node id, baseline and fragment.
    pub(crate) block: Option<(u32, f64, BoxFragment)>,
}

impl ParleyInlineContext {
    /// The image or inline block `item` of the paragraph at `host` sized
    /// in `space`; nothing for any other item.
    pub(crate) fn size_atom(
        &self,
        tree: &FormattingTree,
        host: FormattingNodeId,
        item: &InlineItem,
        space: &BuildSpace,
        percentage_images: PercentageImageSizing,
        cancel: &CancelFlag,
    ) -> Result<Option<SizedAtom>, LayoutError> {
        match item {
            InlineItem::Image {
                intrinsic_width,
                intrinsic_height,
                layout_style,
                viewport,
                ..
            } => {
                let styles = tree.styles().ok_or_else(|| {
                    LayoutError::Invalid("inline flow tree carries no style tables".to_owned())
                })?;
                let layout_style = styles
                    .layout
                    .style(*layout_style)
                    .map_err(|error| LayoutError::Invalid(error.to_string()))?;
                let vertical = tree
                    .strut_style(host)
                    .and_then(|id| styles.inline.style(id).ok())
                    .is_some_and(|strut| {
                        strut.bidi.writing_mode
                            == rito_style_contract::WritingMode::VerticalRightToLeft
                    });
                // The image sizes in physical terms: down a column its
                // width runs across the lines (the page's block size) and
                // its height along them, so the page clamp holds it to
                // the column's length (measured on a 318x2048 chapter
                // plate: Chromium lays it 132x850 on an 850px column).
                let (width_basis, height_clamp, height_basis) = if vertical {
                    (space.block_size(), space.inline_size(), space.inline_size())
                } else {
                    (
                        space.inline_size(),
                        space.block_size(),
                        space.containing_block_size(),
                    )
                };
                let (width, height) = image_display_size(
                    *intrinsic_width,
                    *intrinsic_height,
                    layout_style,
                    width_basis,
                    height_clamp,
                    height_basis,
                    percentage_images,
                    *viewport,
                )?;
                // A vertical-rl flow's replaced atom advances by its
                // physical height along the (vertical) inline axis and
                // takes a column as wide as its physical width; the
                // swapped box maps back to the physical raster in the
                // vertical paint walk.
                let (width, height) = if vertical {
                    (height, width)
                } else {
                    (width, height)
                };
                // The image element's own flank borders (absorbed as
                // padding by the bridge) widen the atom's advance; the
                // raster paints inside them (measured on the b60
                // cover's `border: none solid` — dropping the 1px
                // flanks shifted the whole plate against Blink).
                let edge =
                    |side: rito_style_contract::NonNegativeLengthPercentage| match side.value() {
                        LengthPercentage::Length(px) => f64::from(px.get()).max(0.0),
                        _ => 0.0,
                    };
                // The flanks along the line: left and right in a
                // horizontal flow, top and bottom down a column.
                let (inset_left, inset_right) = if vertical {
                    (
                        edge(layout_style.padding.top),
                        edge(layout_style.padding.bottom),
                    )
                } else {
                    (
                        edge(layout_style.padding.left),
                        edge(layout_style.padding.right),
                    )
                };
                Ok(Some(SizedAtom {
                    width: width + (inset_left + inset_right) as f32,
                    height,
                    edge_insets: (inset_left > 0.0 || inset_right > 0.0)
                        .then_some((inset_left, inset_right)),
                    block: None,
                }))
            }
            InlineItem::InlineBlock {
                node, layout_style, ..
            } => {
                // The atomic inline is its own mini paragraph, laid
                // out recursively through the full pipeline at CSS
                // 2.1 §10.3.5 shrink-to-fit width against the host. One
                // in a writing mode not the host's is an orthogonal flow:
                // its lines run across the host's, in the space the host
                // has across them (CSS Writing Modes 3 §7.3).
                let writing_mode = |id: FormattingNodeId| {
                    let styles = tree.styles()?;
                    let style = styles.inline.style(tree.strut_style(id)?).ok()?;
                    Some(style.bidi.writing_mode)
                };
                let orthogonal = matches!(
                    (writing_mode(host), writing_mode(*node)),
                    (Some(host_mode), Some(own_mode))
                        if (host_mode == rito_style_contract::WritingMode::HorizontalTopToBottom)
                            != (own_mode == rito_style_contract::WritingMode::HorizontalTopToBottom)
                );
                let sizes = self.intrinsic_inline_sizes(tree, *node)?;
                // Its margins, borders and padding surround the content on
                // the line (Blink sizes an atomic inline by its margin
                // box); an orthogonal flow keeps its bare box.
                let edges = if orthogonal {
                    BoxEdges::default()
                } else {
                    box_edges(tree, host, *layout_style, space.inline_size())?
                };
                let available = if orthogonal {
                    space.block_size()
                } else {
                    space
                        .inline_size()
                        .map(|size| (size - edges.inline_start - edges.inline_end).max(0.0))
                }
                .unwrap_or(sizes.max_content);
                let width = sizes.max_content.min(sizes.min_content.max(available));
                let outcome = FormattingContext::layout(
                    self,
                    tree,
                    *node,
                    &ConstraintSpace::continuous(width),
                    None,
                    cancel,
                )?;
                let Fragment::Box(mut root_box) = outcome.fragments.root else {
                    return Err(LayoutError::Invalid(
                        "inline-block layout must produce a box fragment".to_owned(),
                    ));
                };
                // The content sits inside the edges; the atom is its
                // margin box.
                for child in &mut root_box.children {
                    let rect = child.rect_mut();
                    rect.x += edges.inline_start;
                    rect.y += edges.block_start;
                }
                root_box.rect.width += edges.inline_start + edges.inline_end;
                root_box.rect.height += edges.block_start + edges.block_end;
                // The atom's baseline is its LAST line's baseline
                // (CSS §10.8.1); a line-less box uses its bottom margin
                // edge.
                let baseline = root_box
                    .children
                    .iter()
                    .rev()
                    .find_map(|child| match child {
                        Fragment::Line(line) => Some(line.rect.y + line.baseline),
                        _ => None,
                    })
                    .unwrap_or(root_box.rect.height);
                if orthogonal {
                    // Across the host's lines it advances by its block
                    // size and stands as wide as its lines run; it has no
                    // baseline in the host's direction, so it hangs from
                    // one synthesized off its margin box
                    // (`LogicalBoxFragment::BaselineMetrics`).
                    let (above, _) = crate::layout::atom_baseline_extent(root_box.rect.width, true);
                    return Ok(Some(SizedAtom {
                        width: root_box.rect.height as f32,
                        height: root_box.rect.width as f32,
                        edge_insets: None,
                        block: Some((node.0, above, root_box)),
                    }));
                }
                Ok(Some(SizedAtom {
                    width: root_box.rect.width as f32,
                    height: root_box.rect.height as f32,
                    edge_insets: None,
                    block: Some((node.0, baseline, root_box)),
                }))
            }
            InlineItem::Text { .. }
            | InlineItem::EmptyBox { .. }
            | InlineItem::OpenTag { .. }
            | InlineItem::CloseTag { .. } => Ok(None),
        }
    }

    /// Sizes the atoms of `paragraph`, built at `host` for another space,
    /// for `space`: each box takes the size a build in `space` gives it,
    /// and each inline block the layout.
    pub(crate) fn resize_atoms(
        &self,
        tree: &FormattingTree,
        host: FormattingNodeId,
        paragraph: &mut ParagraphLayout,
        space: &BuildSpace,
        cancel: &CancelFlag,
    ) -> Result<(), LayoutError> {
        let FormattingNodeContent::InlineFlow { items } = &tree.node(host).content else {
            return Err(LayoutError::Invalid(format!(
                "parley inline context requires an inline flow, got {:?}",
                tree.node(host).content
            )));
        };
        paragraph.inline_block_boxes.clear();
        paragraph.inline_block_baselines.clear();
        for (item_index, item) in items.iter().enumerate() {
            let Some(atom) = self.size_atom(
                tree,
                host,
                item,
                space,
                PercentageImageSizing::Intrinsic,
                cancel,
            )?
            else {
                continue;
            };
            let id = item_index as u64;
            let inline_box = paragraph
                .layout
                .inline_boxes_mut()
                .iter_mut()
                .find(|inline_box| inline_box.id == id)
                .ok_or_else(|| {
                    LayoutError::Invalid(format!("paragraph holds no box for atom {id}"))
                })?;
            inline_box.width = atom.width;
            inline_box.height = atom.height;
            if let Some((block_node, baseline, root_box)) = atom.block {
                paragraph
                    .inline_block_baselines
                    .insert(block_node, baseline);
                paragraph
                    .inline_block_boxes
                    .insert(id, (baseline, root_box));
            }
        }
        Ok(())
    }
}

/// An inline block's margin, border and padding on each side of its
/// content, in the host's flow-relative directions.
#[derive(Clone, Copy, Debug, Default)]
struct BoxEdges {
    inline_start: f64,
    inline_end: f64,
    block_start: f64,
    block_end: f64,
}

/// The edges of the inline block styled `layout_style` on a line of the
/// paragraph at `host`, percentages against the host's inline size, each
/// truncated onto the LayoutUnit grid as Blink stores a used margin or
/// padding.
fn box_edges(
    tree: &FormattingTree,
    host: FormattingNodeId,
    layout_style: rito_style_contract::LayoutStyleId,
    containing_inline_size: Option<f64>,
) -> Result<BoxEdges, LayoutError> {
    use rito_style_contract::LengthPercentageOrAuto;
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
    let side = |margin_side: f64,
                border_side: rito_style_contract::NonNegativeCssPx,
                padding_side: rito_style_contract::NonNegativeLengthPercentage| {
        margin_side + f64::from(border_side.get()) + used(padding_side.value()).max(0.0)
    };
    Ok(BoxEdges {
        inline_start: side(
            margin(margins.inline_start),
            border.inline_start,
            padding.inline_start,
        ),
        inline_end: side(
            margin(margins.inline_end),
            border.inline_end,
            padding.inline_end,
        ),
        block_start: side(
            margin(margins.block_start),
            border.block_start,
            padding.block_start,
        ),
        block_end: side(
            margin(margins.block_end),
            border.block_end,
            padding.block_end,
        ),
    })
}
