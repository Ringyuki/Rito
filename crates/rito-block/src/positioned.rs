//! Absolutely positioned boxes. Each waits until its containing block, the
//! nearest positioned ancestor (or the tree's root), knows its own size,
//! then resolves its insets, margins and size against that block (CSS 2.1
//! §10.3.7, §10.6.4): an `auto` inset pair keeps the box at its static
//! position, an `auto` width stretches between two definite insets or
//! shrinks to fit the space they leave, an `auto` height is the content's.
//! Its fragment joins the containing block's after all in-flow content,
//! which is where a positioned box paints.
//!
//! The containing block is the positioned box's border box: the bridge
//! folds border widths into padding, so the padding box CSS names is not
//! told apart here (a containing block with borders places its positioned
//! boxes out by those widths).

use crate::*;

impl<I: FormattingContext> BlockFormattingContext<I> {
    /// Lays every box in `pending` out against the root of `outcome`, its
    /// containing block, and appends the fragments to that root.
    pub(crate) fn place_positioned(
        &self,
        tree: &FormattingTree,
        outcome: &mut LayoutOutcome,
        pending: Vec<PendingPositioned>,
        cancel: &CancelFlag,
    ) -> Result<(), LayoutError> {
        if pending.is_empty() {
            return Ok(());
        }
        let Fragment::Box(block) = &mut outcome.fragments.root else {
            return Err(LayoutError::Invalid(
                "a containing block lays out as a box fragment".to_owned(),
            ));
        };
        let (width, height) = (block.rect.width, block.rect.height);
        for pending in pending {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            block
                .children
                .push(self.positioned_fragment(tree, pending, width, height, cancel)?);
        }
        Ok(())
    }

    fn positioned_fragment(
        &self,
        tree: &FormattingTree,
        pending: PendingPositioned,
        block_width: f64,
        block_height: f64,
        cancel: &CancelFlag,
    ) -> Result<Fragment, LayoutError> {
        let style = container_layout_style(tree, pending.node)?;
        let inset = |side: LengthPercentageOrAuto, basis: f64| match side {
            LengthPercentageOrAuto::Auto => None,
            LengthPercentageOrAuto::Value(value) => Some(resolve_length_percentage(value, basis)),
        };
        // Margins and horizontal insets resolve against the block's width,
        // vertical insets against its height; `auto` margins count as 0.
        let margin = |side: LengthPercentageOrAuto| inset(side, block_width).unwrap_or(0.0);
        let (left, right) = (
            inset(style.inset.left, block_width),
            inset(style.inset.right, block_width),
        );
        let (top, bottom) = (
            inset(style.inset.top, block_height),
            inset(style.inset.bottom, block_height),
        );
        let (margin_left, margin_right) = (margin(style.margin.left), margin(style.margin.right));
        let (margin_top, margin_bottom) = (margin(style.margin.top), margin(style.margin.bottom));
        let border_width = match (style.width, left, right) {
            (PreferredSize::Value(_), _, _) => {
                resolve_horizontal_box(style, block_width)?.border_width
            }
            (_, Some(left), Some(right)) => {
                (block_width - left - right - margin_left - margin_right).max(0.0)
            }
            _ => {
                let available = block_width - left.unwrap_or(0.0) - right.unwrap_or(0.0);
                self.resolve_float_box(tree, pending.node, style, available.max(0.0))?
                    .border_width
            }
        };
        let x = match (left, right) {
            (Some(left), _) => left + margin_left,
            (None, Some(right)) => block_width - right - margin_right - border_width,
            (None, None) => pending.static_x + margin_left,
        };
        // The box's own margins are this placement's: its layout must not
        // apply them again inside.
        let space = ConstraintSpace::continuous(border_width);
        let outcome = match tree.node(pending.node).content {
            FormattingNodeContent::BlockContainer => {
                self.layout_container(tree, pending.node, &space, None, cancel, false, false)?
            }
            _ => self.layout(tree, pending.node, &space, None, cancel)?,
        };
        let Fragment::Box(mut positioned) = outcome.fragments.root else {
            return Err(LayoutError::Invalid(
                "a positioned box lays out as a box fragment".to_owned(),
            ));
        };
        if let (PreferredSize::Auto, Some(top), Some(bottom)) = (style.height, top, bottom) {
            positioned.rect.height =
                (block_height - top - bottom - margin_top - margin_bottom).max(0.0);
        }
        let y = match (top, bottom) {
            (Some(top), _) => top + margin_top,
            (None, Some(bottom)) => block_height - bottom - margin_bottom - positioned.rect.height,
            (None, None) => pending.static_y + margin_top,
        };
        positioned.rect.x = x;
        positioned.rect.y = y;
        positioned.rect.width = border_width;
        Ok(Fragment::Box(positioned))
    }
}
