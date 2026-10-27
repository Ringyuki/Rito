//! A chapter laid out as one continuous strip, read through windows the
//! size of the viewport: the scrolled reading mode's pages.
//!
//! A window is a slice of the chapter's block extent — its top margin, the
//! strip and its bottom margin. Its records hold what starts inside it, in
//! CSS pixels from the window's top, the same at every device ratio. Its
//! paint covers whole device rows: window `k` starts on device row
//! `D_k = floor(k × length × ratio + 0.5)` of the chapter and ends where
//! the next starts, so the windows tile the chapter row for row with no
//! seam. A window paints and lowers in its chapter's coordinates and moves
//! up by `D_k` rows last (`render::shift`), so every edge and baseline
//! rounds where it does when the whole chapter paints at once.
//!
//! Painting or recording a window walks only the fragments that reach it:
//! [`window_paint_tree`] and [`window_record_tree`] cut a copy of the
//! strip down to them.

use std::ops::Range;

use rito_fragment::{BoxFragment, FormattingNodeContent, FormattingTree, Fragment};

use crate::fragment_bridge::NodePaint;

/// How a chapter's block extent slices into windows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ScrollWindows {
    /// A full window's block length in CSS pixels: the viewport's.
    length: f64,
    /// The chapter's block extent in CSS pixels: its top margin, its strip
    /// and its bottom margin.
    extent: f64,
}

impl ScrollWindows {
    pub(crate) fn new(length: f64, extent: f64) -> Self {
        Self { length, extent }
    }

    /// A full window's block length in CSS pixels.
    pub(crate) fn length(&self) -> f64 {
        self.length
    }

    /// The chapter's block extent in CSS pixels.
    pub(crate) fn extent(&self) -> f64 {
        self.extent
    }

    /// How many windows the chapter takes: always one at least, the last
    /// shorter than the rest when the extent is not a whole number of them.
    pub(crate) fn count(&self) -> usize {
        ((self.extent / self.length).ceil() as usize).max(1)
    }

    /// The block range window `window` records, in the chapter's CSS
    /// pixels.
    pub(crate) fn range(&self, window: usize) -> Range<f64> {
        let start = window as f64 * self.length;
        start..(start + self.length).min(self.extent)
    }

    /// The device rows of the chapter window `window` paints at `ratio`.
    pub(crate) fn device_rows(&self, window: usize, ratio: f64) -> Range<f64> {
        let row = |index: usize| (index as f64 * self.length * ratio + 0.5).floor();
        let end = if window + 1 >= self.count() {
            (self.extent * ratio + 0.5).floor()
        } else {
            row(window + 1)
        };
        row(window)..end
    }
}

/// The strip cut down to what can ink the block range `range` (chapter
/// CSS pixels, the strip's root at `origin_y`): every line and box whose
/// rect comes within `margin` of it. A box is also kept for a kept child
/// when its own rect lies outside, since overflow is not clipped to it. A
/// table and a transformed box keep their whole subtree: a collapsed
/// table's edges are painted from its neighbouring cells, and a transform
/// carries ink anywhere.
pub(crate) fn window_paint_tree(
    tree: &FormattingTree,
    node_paints: Option<&std::collections::BTreeMap<u32, NodePaint>>,
    root: &Fragment,
    origin_y: f64,
    range: Range<f64>,
    margin: f64,
) -> Fragment {
    let reach = (range.start - margin)..(range.end + margin);
    let whole = |fragment: &BoxFragment| {
        matches!(
            tree.node(fragment.source).content,
            FormattingNodeContent::Table
        ) || matches!(
            node_paints.and_then(|paints| paints.get(&fragment.source.0)),
            Some(NodePaint::Box {
                transform: Some(_),
                ..
            })
        )
    };
    prune(root, origin_y, &|fragment, top| {
        let bottom = top + fragment.rect().height;
        let inside = bottom >= reach.start && top <= reach.end;
        match fragment {
            Fragment::Box(fragment) if whole(fragment) => Keep::Whole(inside),
            Fragment::Box(_) => Keep::Children { alone: inside },
            _ => Keep::Whole(inside),
        }
    })
}

/// The strip cut down to what window range `range` (chapter CSS pixels,
/// the strip's root at `origin_y`) records: every line whose top lies in
/// it, with the boxes that hold them, and every box with no lines whose
/// top lies in it. A line belongs to the window it starts in, so each line
/// is recorded by exactly one window.
pub(crate) fn window_record_tree(root: &Fragment, origin_y: f64, range: Range<f64>) -> Fragment {
    prune(root, origin_y, &|fragment, top| {
        let starts_inside = range.contains(&top);
        match fragment {
            Fragment::Box(_) => Keep::Children {
                alone: starts_inside && !holds_lines(fragment),
            },
            _ => Keep::Whole(starts_inside),
        }
    })
}

/// What a cut keeps of one fragment, given its rect.
enum Keep {
    /// The fragment and everything in it, when the flag holds.
    Whole(bool),
    /// The box with whichever of its children are kept; when none is, the
    /// box alone if `alone` holds.
    Children { alone: bool },
}

/// `fragment` (its parent's origin at `parent_y`) cut by `keep`, which
/// reads a fragment and the absolute top of its rect. The root is kept
/// whatever it holds.
fn prune(fragment: &Fragment, parent_y: f64, keep: &dyn Fn(&Fragment, f64) -> Keep) -> Fragment {
    let Fragment::Box(root) = fragment else {
        return fragment.clone();
    };
    let top = parent_y + root.rect.y;
    Fragment::Box(BoxFragment {
        children: root
            .children
            .iter()
            .filter_map(|child| prune_child(child, top, keep))
            .collect(),
        ..cut_box(root)
    })
}

fn prune_child(
    fragment: &Fragment,
    parent_y: f64,
    keep: &dyn Fn(&Fragment, f64) -> Keep,
) -> Option<Fragment> {
    let top = parent_y + fragment.rect().y;
    match keep(fragment, top) {
        Keep::Whole(kept) => kept.then(|| fragment.clone()),
        Keep::Children { alone } => {
            let Fragment::Box(inner) = fragment else {
                return alone.then(|| fragment.clone());
            };
            let children: Vec<Fragment> = inner
                .children
                .iter()
                .filter_map(|child| prune_child(child, top, keep))
                .collect();
            (!children.is_empty() || alone).then(|| {
                Fragment::Box(BoxFragment {
                    children,
                    ..cut_box(inner)
                })
            })
        }
    }
}

/// A box's own fields, its children left out for the cut to fill.
fn cut_box(fragment: &BoxFragment) -> BoxFragment {
    BoxFragment {
        source: fragment.source,
        rect: fragment.rect,
        children: Vec::new(),
    }
}

/// Whether any line box lies under `fragment`.
fn holds_lines(fragment: &Fragment) -> bool {
    match fragment {
        Fragment::Line(_) => true,
        Fragment::Box(inner) => inner.children.iter().any(holds_lines),
        Fragment::Text(_) | Fragment::Image(_) => false,
    }
}

#[cfg(test)]
mod tests;
