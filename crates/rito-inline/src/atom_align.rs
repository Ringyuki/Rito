//! `vertical-align: middle` on an atomic inline (an image or an
//! inline-block): where its box sits around the line's baseline.

use crate::marker::resolved_marker_font_metrics;
use crate::*;

impl ParleyInlineContext {
    /// Per item of the flow at `root`: for an atom aligned `middle`, half
    /// its parent box's x-height on the LayoutUnit grid — how far above the
    /// parent's baseline the atom's middle sits; `None` for every other
    /// item. The x-height is the parent's primary font's, read as the list
    /// marker reads it.
    pub(crate) fn middle_half_x_heights(
        &self,
        tree: &FormattingTree,
        root: FormattingNodeId,
    ) -> Vec<Option<f64>> {
        let FormattingNodeContent::InlineFlow { items } = &tree.node(root).content else {
            return Vec::new();
        };
        let tables = tree.styles();
        items
            .iter()
            .map(|item| {
                let (InlineItem::Image {
                    align: AtomAlign::Middle { parent },
                    ..
                }
                | InlineItem::InlineBlock {
                    align: AtomAlign::Middle { parent },
                    ..
                }) = item
                else {
                    return None;
                };
                let style = tables?.inline.style(*parent).ok()?;
                let size = f64::from(style.font.size.get());
                let x_height = resolved_marker_font_metrics(
                    &mut self.fonts.borrow_mut(),
                    &self.catalog,
                    style,
                )
                .map_or(size * 0.5, |(_, x_height)| x_height);
                Some((x_height / 2.0 * 64.0).round() / 64.0)
            })
            .collect()
    }
}

/// The raise, CSS px, that `vertical-align: middle` gives an atom standing
/// `above` and `below` its baseline in a parent whose half x-height is
/// `half_x_height`. Blink moves the box down by half its ascent less its
/// descent, a LayoutUnit halved and truncated, less that half x-height
/// (`InlineLayoutStateStack::ApplyBaselineShift`): the box's middle comes
/// to rest half the parent's x-height above the parent's baseline.
/// Measured: a 30px image in a 10px Tinos line spans 17.296875 above the
/// baseline to 12.703125 below; down a vertical-rl line, where an image's
/// central baseline halves it, it moves the half x-height to the line's
/// over side.
pub(crate) fn middle_raise(above: f64, below: f64, half_x_height: f64) -> f64 {
    let difference = ((above - below) * 64.0).round() as i64;
    half_x_height - (difference / 2) as f64 / 64.0
}
