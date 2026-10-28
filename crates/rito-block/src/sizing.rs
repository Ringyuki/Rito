//! Turning a box's style into used sizes: the inline-axis solve that
//! distributes margins, padding and width across the containing block,
//! the offset a shrink-to-fit box takes, a specified height, what a box
//! contributes to its container's intrinsic width, whether a container
//! establishes its own formatting context, and the LayoutUnit grid every
//! block position snaps to.

use crate::*;

/// Raises a box's intrinsic contribution to its own definite width: a
/// fixed-width box is that wide whatever its content asks for, so that is
/// what an ancestor must size itself around. A table cell is the
/// exception — its width belongs to the column algorithm, which reads it
/// separately and would otherwise count it twice.
pub(crate) fn own_width_contribution(
    tree: &FormattingTree,
    node: FormattingNodeId,
    mut sizes: IntrinsicInlineSizes,
) -> Result<IntrinsicInlineSizes, LayoutError> {
    if matches!(
        tree.node(node).content,
        FormattingNodeContent::TableCell { .. }
    ) {
        return Ok(sizes);
    }
    let style = container_layout_style(tree, node)?;
    let padding = style.flow_padding();
    let pad = |side: rito_style_contract::NonNegativeLengthPercentage| match side.value() {
        // Used paddings sit on the LayoutUnit grid (truncation).
        LengthPercentage::Length(px) => (f64::from(px.get()) * 64.0).trunc() / 64.0,
        _ => 0.0,
    };
    if let rito_style_contract::PreferredSize::Value(width) = style.inline_size() {
        if let LengthPercentage::Length(px) = width.value() {
            let outer = match style.box_sizing {
                BoxSizing::ContentBox => {
                    f64::from(px.get()) + pad(padding.inline_start) + pad(padding.inline_end)
                }
                BoxSizing::BorderBox => f64::from(px.get()),
            };
            // A definite width fixes the box: it neither shrinks below nor
            // grows beyond it, so both intrinsic contributions are that
            // width however long its content runs.
            sizes.min_content = outer;
            sizes.max_content = outer;
        }
    }
    // What a box contributes to its container's intrinsic inline size is
    // its margin box (css-sizing-3 §5.2), so its inline margins count — a
    // negative one included, which narrows the contribution. `auto`
    // resolves to zero here: it has no width to give until layout runs.
    // Both inline margins count, so whichever end the container starts
    // its lines from does not matter.
    let margin = |side: rito_style_contract::LengthPercentageOrAuto| match side {
        rito_style_contract::LengthPercentageOrAuto::Value(LengthPercentage::Length(px)) => {
            f64::from(px.get())
        }
        _ => 0.0,
    };
    let margins = style.margin_in(style.writing_direction());
    let margins = margin(margins.inline_start) + margin(margins.inline_end);
    sizes.min_content += margins;
    sizes.max_content += margins;
    Ok(sizes)
}

/// Whether a container establishes a formatting context, which is what
/// makes it contain its own floats. Floats and non-visible overflow do it
/// in CSS, as does `display: flow-root`.
pub(crate) fn is_flow_root(style: &LayoutFormattingStyle) -> bool {
    style.float != Float::None
        || style.position == rito_style_contract::Position::Absolute
        || style.overflow != rito_style_contract::Overflow::Visible
        || matches!(
            style.display.inside,
            rito_style_contract::LayoutDisplayInside::FlowRoot
        )
}

/// The container's resolved layout style from the tree's typed table.
pub(crate) fn container_layout_style(
    tree: &FormattingTree,
    node: FormattingNodeId,
) -> Result<&LayoutFormattingStyle, LayoutError> {
    let styles = tree.styles().ok_or_else(|| {
        LayoutError::Invalid("block layout requires the tree to carry style tables".to_owned())
    })?;
    styles
        .layout
        .style(tree.node(node).style)
        .map_err(|error| LayoutError::Invalid(error.to_string()))
}

/// CSS block-level inline-axis resolution: `margin + padding + width =
/// containing width` along the lines of `container`, the containing
/// block's flow. An `auto` inline size fills what the margins leave; a
/// specified one distributes leftover space to `auto` margins (centering
/// with both auto), clamped at zero so over-wide content overflows to the
/// end side like a browser.
pub(crate) fn resolve_inline_box(
    style: &LayoutFormattingStyle,
    container: WritingDirection,
    containing_width: f64,
) -> Result<InlineBox, LayoutError> {
    let resolve = |value: LengthPercentage| resolve_length_percentage(value, containing_width);
    // A used padding edge sits on the LayoutUnit grid by TRUNCATION
    // toward zero (LayoutUnit's float constructor), like
    // `resolve_margin` and the container pad path: a 0.1em padding at
    // 12.16px is 1.216 in CSS arithmetic but 1.203125 in the browser's
    // box (vertical measured on b20's footnote paragraph; horizontal
    // measured on b19's note paragraph, whose content width is
    // 581.15625 − trunc64(12.16) − trunc64(1.216) = 567.796875 exactly —
    // the untruncated subtraction lands 1/64 wide and skews every
    // justify share on the block's lines).
    let edge = |value: LengthPercentage| (resolve(value) * 64.0).trunc() / 64.0;
    let padding = style.flow_padding();
    let padding_left = edge(padding.inline_start.value()).max(0.0);
    let padding_right = edge(padding.inline_end.value()).max(0.0);
    let padding_top = edge(padding.block_start.value()).max(0.0);
    let padding_bottom = edge(padding.block_end.value()).max(0.0);
    let margin = |side: LengthPercentageOrAuto| -> Option<f64> {
        match side {
            LengthPercentageOrAuto::Auto => None,
            // Used margins truncate onto the LayoutUnit grid like the
            // paddings above (measured: margin-left 1.9% of 627.21875
            // is 11.917156 in CSS arithmetic, 11.90625 in the browser's
            // box — round would give 11.921875; the raw value left every
            // line of a 1%-margined paragraph 0.42/64 off the grid and
            // its glyphs a raster phase adrift).
            LengthPercentageOrAuto::Value(value) => Some((resolve(value) * 64.0).trunc() / 64.0),
        }
    };
    let margins = style.margin_in(container);
    let margin_left = margin(margins.inline_start);
    let margin_right = margin(margins.inline_end);
    let width = match style.inline_size() {
        PreferredSize::Auto => None,
        PreferredSize::Value(value) => Some(resolve(value.value()).max(0.0)),
        // Keep books readable until intrinsic/extrinsic sizing is implemented.
        // The chapter bridge records the unsupported value; use auto here,
        // preserving numeric caps, padding and margins instead of aborting
        // the entire chapter. This is exact for `stretch` and
        // `-webkit-fill-available`; the intrinsic keywords fill the line
        // where a browser would fit the block to its content.
        PreferredSize::MaxContent
        | PreferredSize::MinContent
        | PreferredSize::FitContent
        | PreferredSize::WebkitFillAvailable
        | PreferredSize::Stretch
        | PreferredSize::FitContentFunction(_) => None,
    };
    // max-width caps the used width; an auto width capped below the
    // available space behaves like a specified width (so auto margins can
    // center the capped box, the common `max-width + margin:auto` pattern).
    let max_width = match style.max_inline_size() {
        MaximumSize::None => None,
        MaximumSize::Value(value) => Some(resolve(value.value()).max(0.0)),
        MaximumSize::MaxContent
        | MaximumSize::MinContent
        | MaximumSize::FitContent
        | MaximumSize::WebkitFillAvailable
        | MaximumSize::Stretch
        | MaximumSize::FitContentFunction(_) => None,
    };
    let width = match (width, max_width) {
        (Some(width), Some(cap)) => Some(width.min(cap)),
        (Some(width), None) => Some(width),
        (None, Some(cap)) => {
            let margin_used = margin_left.unwrap_or(0.0) + margin_right.unwrap_or(0.0);
            let auto_border = (containing_width - margin_used).max(0.0);
            let cap_border = match style.box_sizing {
                BoxSizing::ContentBox => cap + padding_left + padding_right,
                BoxSizing::BorderBox => cap,
            };
            if auto_border > cap_border {
                Some(cap)
            } else {
                None
            }
        }
        (None, None) => None,
    };
    match width {
        None => {
            let margin_left = margin_left.unwrap_or(0.0);
            let margin_right = margin_right.unwrap_or(0.0);
            let border_width =
                (containing_width - margin_left - margin_right).max(padding_left + padding_right);
            Ok(InlineBox {
                x: margin_left,
                border_width,
                padding_left,
                content_width: (border_width - padding_left - padding_right).max(0.0),
                padding_top,
                padding_bottom,
            })
        }
        Some(width) => {
            let content_width = match style.box_sizing {
                BoxSizing::ContentBox => width,
                BoxSizing::BorderBox => (width - padding_left - padding_right).max(0.0),
            };
            let border_width = padding_left + content_width + padding_right;
            let free = containing_width - border_width;
            let x = match (margin_left, margin_right) {
                (None, None) => (free / 2.0).max(0.0),
                (None, Some(right)) => (free - right).max(0.0),
                (Some(left), _) => left,
            };
            Ok(InlineBox {
                x,
                border_width,
                padding_left,
                content_width,
                padding_top,
                padding_bottom,
            })
        }
    }
}

/// Inline offset for a shrink-to-fit box (a table) inside its containing
/// block, whose flow is `container`: auto margins share the free space
/// the used width leaves, the same distribution `resolve_inline_box`
/// applies to a definite width.
pub(crate) fn shrink_to_fit_offset(
    style: &LayoutFormattingStyle,
    container: WritingDirection,
    containing_width: f64,
    used_width: f64,
) -> f64 {
    let margin = |side: LengthPercentageOrAuto| -> Option<f64> {
        match side {
            LengthPercentageOrAuto::Auto => None,
            // Used margins truncate onto the LayoutUnit grid, matching
            // `resolve_inline_box` and `resolve_margin`.
            LengthPercentageOrAuto::Value(value) => {
                Some((resolve_length_percentage(value, containing_width) * 64.0).trunc() / 64.0)
            }
        }
    };
    let free = containing_width - used_width;
    let margins = style.margin_in(container);
    match (margin(margins.inline_start), margin(margins.inline_end)) {
        (None, None) => (free / 2.0).max(0.0),
        (None, Some(right)) => (free - right).max(0.0),
        (Some(left), _) => left,
    }
}

/// The container's fixed border-box block size, when its block size
/// (`height` in horizontal writing) is specified. Percentages need a
/// definite containing-block size that block flow does not provide, so
/// they resolve to `None` (auto), per CSS.
pub(crate) fn resolve_fixed_height(
    style: &LayoutFormattingStyle,
    vertical_padding: f64,
) -> Result<Option<f64>, LayoutError> {
    let height = match style.block_size() {
        PreferredSize::Auto => return Ok(None),
        PreferredSize::Value(value) => match value.value() {
            LengthPercentage::Length(px) => f64::from(px.get()),
            // No definite height basis in block flow: behaves as auto.
            LengthPercentage::Percentage(_) | LengthPercentage::Linear { .. } => return Ok(None),
        },
        // These sizes have no implemented used-height calculation in the
        // paginated block context. Let content determine the height, as for
        // auto, so the same compatibility policy holds for paragraphs and
        // nested containers across page boundaries.
        PreferredSize::MaxContent
        | PreferredSize::MinContent
        | PreferredSize::FitContent
        | PreferredSize::WebkitFillAvailable
        | PreferredSize::Stretch
        | PreferredSize::FitContentFunction(_) => return Ok(None),
    };
    Ok(Some(match style.box_sizing {
        BoxSizing::ContentBox => height.max(0.0) + vertical_padding,
        BoxSizing::BorderBox => height.max(0.0),
    }))
}

/// A box's border-box block-size bounds: its minimum and maximum block
/// size (`min-height`/`max-height` across horizontal lines, `min-width`/
/// `max-width` across vertical ones). Percentages need a definite
/// containing-block block size that block flow does not provide, so a
/// percentage minimum is zero and a percentage maximum none (CSS 2
/// §10.7).
#[derive(Clone, Copy, Debug)]
pub(crate) struct BlockSizeBounds {
    min: f64,
    max: Option<f64>,
}

impl BlockSizeBounds {
    /// The used block size of a box whose block size would otherwise be
    /// `size`: capped by the maximum, then raised to the minimum, which
    /// wins (`ComputeBlockSizeForFragment`).
    pub(crate) fn clamp(self, size: f64) -> f64 {
        self.max.map_or(size, |max| size.min(max)).max(self.min)
    }

    /// Whether the bounds leave every block size as it is.
    pub(crate) fn is_unbounded(self) -> bool {
        self.min == 0.0 && self.max.is_none()
    }
}

pub(crate) fn resolve_block_size_bounds(
    style: &LayoutFormattingStyle,
    block_padding: f64,
) -> BlockSizeBounds {
    let border_box = |size: f64| match style.box_sizing {
        BoxSizing::ContentBox => size.max(0.0) + block_padding,
        BoxSizing::BorderBox => size.max(0.0),
    };
    let min = match style.min_block_size() {
        MinimumSize::Length(px) => border_box(f64::from(px.get())),
        MinimumSize::Auto | MinimumSize::Percentage(_) => 0.0,
    };
    let max = match style.max_block_size() {
        MaximumSize::Value(value) => match value.value() {
            LengthPercentage::Length(px) => Some(border_box(f64::from(px.get()))),
            LengthPercentage::Percentage(_) | LengthPercentage::Linear { .. } => None,
        },
        MaximumSize::None
        | MaximumSize::MaxContent
        | MaximumSize::MinContent
        | MaximumSize::FitContent
        | MaximumSize::WebkitFillAvailable
        | MaximumSize::Stretch
        | MaximumSize::FitContentFunction(_) => None,
    };
    BlockSizeBounds { min, max }
}

pub(crate) fn resolve_length_percentage(value: LengthPercentage, basis: f64) -> f64 {
    match value {
        LengthPercentage::Length(px) => f64::from(px.get()),
        LengthPercentage::Percentage(ratio) => f64::from(ratio.ratio()) * basis,
        LengthPercentage::Linear { length, percentage } => {
            f64::from(length.get()) + f64::from(percentage.ratio()) * basis
        }
    }
}

/// The end of a flow's inline axis a float sits at, as this crate places
/// floats: `Left` at the inline-start, `Right` at the inline-end. CSS
/// `left` and `right` name the line-left and line-right sides, which are
/// the inline-start and inline-end of a left-to-right flow laid out in
/// `container` (horizontal or vertical) and the other way round in a
/// right-to-left one.
pub(crate) fn flow_float(float: Float, container: WritingDirection) -> Float {
    match float {
        Float::Left if container.is_rtl() => Float::Right,
        Float::Right if container.is_rtl() => Float::Left,
        other => other,
    }
}

/// The floats a `clear` in a flow laid out in `container` clears, on the
/// sides [`flow_float`] places them.
pub(crate) fn flow_clear(clear: Clear, container: WritingDirection) -> Clear {
    match clear {
        Clear::Left if container.is_rtl() => Clear::Right,
        Clear::Right if container.is_rtl() => Clear::Left,
        other => other,
    }
}

/// Snaps a block-axis position to the LayoutUnit grid (1/64 CSS px).
/// Blink performs every block advance in LayoutUnit, so all its line and
/// box positions are exact 1/64 multiples; float debris here (measured:
/// a page whose every line sat 0.003px low) flips baseline row-rounding
/// against the browser exactly when Blink's value lands on x.5.
pub(crate) fn layout_unit(value: f64) -> f64 {
    (value * 64.0).round() / 64.0
}
