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
                let (width, height) = image_display_size(
                    *intrinsic_width,
                    *intrinsic_height,
                    layout_style,
                    space.inline_size(),
                    space.block_size(),
                    space.containing_block_size(),
                    percentage_images,
                    *viewport,
                )?;
                // A vertical-rl flow's replaced atom advances by its
                // PHYSICAL height along the (vertical) inline axis
                // and takes a column as wide as its physical width
                // (measured on a 318x2048 chapter plate: the column
                // is 318 wide, the image runs the page's length and
                // clips); the swapped box maps back to the physical
                // raster in the vertical paint walk.
                let (width, height) = if tree
                    .strut_style(host)
                    .and_then(|id| styles.inline.style(id).ok())
                    .is_some_and(|strut| {
                        strut.bidi.writing_mode
                            == rito_style_contract::WritingMode::VerticalRightToLeft
                    }) {
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
                let inset_left = edge(layout_style.padding.left);
                let inset_right = edge(layout_style.padding.right);
                Ok(Some(SizedAtom {
                    width: width + (inset_left + inset_right) as f32,
                    height,
                    edge_insets: (inset_left > 0.0 || inset_right > 0.0)
                        .then_some((inset_left, inset_right)),
                    block: None,
                }))
            }
            InlineItem::InlineBlock { node, .. } => {
                // The atomic inline is its own mini paragraph, laid
                // out recursively through the full pipeline at CSS
                // 2.1 §10.3.5 shrink-to-fit width against the host.
                let sizes = self.intrinsic_inline_sizes(tree, *node)?;
                let available = space.inline_size().unwrap_or(sizes.max_content);
                let width = sizes.max_content.min(sizes.min_content.max(available));
                let outcome = FormattingContext::layout(
                    self,
                    tree,
                    *node,
                    &ConstraintSpace::continuous(width),
                    None,
                    cancel,
                )?;
                let Fragment::Box(root_box) = outcome.fragments.root else {
                    return Err(LayoutError::Invalid(
                        "inline-block layout must produce a box fragment".to_owned(),
                    ));
                };
                // The atom's baseline is its LAST line's baseline
                // (CSS §10.8.1); a line-less box uses its bottom.
                let baseline = root_box
                    .children
                    .iter()
                    .rev()
                    .find_map(|child| match child {
                        Fragment::Line(line) => Some(line.rect.y + line.baseline),
                        _ => None,
                    })
                    .unwrap_or(root_box.rect.height);
                Ok(Some(SizedAtom {
                    width: root_box.rect.width as f32,
                    height: root_box.rect.height as f32,
                    edge_insets: None,
                    block: Some((node.0, baseline, root_box)),
                }))
            }
            InlineItem::Text { .. } | InlineItem::EmptyBox { .. } => Ok(None),
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
