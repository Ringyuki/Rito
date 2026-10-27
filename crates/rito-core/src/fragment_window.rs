//! A chapter laid out as one continuous strip, read through windows the
//! size of the viewport: the scrolled reading mode's pages.
//!
//! A window is a slice of the chapter's block extent — its block-start
//! margin, the strip and its block-end margin: down the screen for
//! horizontal text, leftwards for vertical right-to-left text. Its records
//! hold what starts inside it, in CSS pixels from the window's block start,
//! the same at every device ratio. Its paint covers whole device rows (or
//! columns): window `k` starts `D_k = floor(k × length × ratio + 0.5)`
//! device pixels into the chapter along its axis and ends where the next
//! starts, so the windows tile the chapter with no seam. A window paints
//! and lowers in its chapter's coordinates and moves onto its own origin by
//! whole device pixels last (`render::shift`), so every edge and baseline
//! rounds where it does when the whole chapter paints at once.
//!
//! Painting or recording a window walks only the fragments that reach it:
//! [`window_paint_tree`] and [`window_record_tree`] cut a copy of the
//! strip down to them.

use std::ops::Range;

use rito_fragment::{BoxFragment, FormattingNodeContent, FormattingTree, Fragment};

use crate::epub::PageProgression;
use crate::fragment_bridge::NodePaint;

/// The way a scrolled book's chapters follow one another, and a chapter's
/// windows with them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ScrollAxis {
    /// Down the screen, as horizontal text's blocks stack.
    Down,
    /// Leftwards, as vertical right-to-left text's columns follow.
    Left,
}

impl ScrollAxis {
    /// A book's axis: scrolling on through a book is moving on through its
    /// pages, which a book whose pages progress right to left does
    /// leftwards.
    pub(crate) fn of_book(progression: PageProgression) -> Self {
        match progression {
            PageProgression::RightToLeft => Self::Left,
            PageProgression::LeftToRight | PageProgression::Default => Self::Down,
        }
    }

    /// The axis a chapter's own blocks run along.
    pub(crate) fn of_chapter(vertical: bool) -> Self {
        if vertical {
            Self::Left
        } else {
            Self::Down
        }
    }
}

/// How a chapter's block extent slices into windows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ScrollWindows {
    /// A full window's block length in CSS pixels: the viewport's height,
    /// or its width for a chapter that runs leftwards.
    length: f64,
    /// The chapter's block extent in CSS pixels: its block-start margin,
    /// its strip and its block-end margin.
    extent: f64,
    axis: ScrollAxis,
}

impl ScrollWindows {
    pub(crate) fn new(length: f64, extent: f64, axis: ScrollAxis) -> Self {
        Self {
            length,
            extent,
            axis,
        }
    }

    pub(crate) fn axis(&self) -> ScrollAxis {
        self.axis
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

    /// The device pixels of the chapter along its axis that window
    /// `window` paints at `ratio`, from the chapter's block start.
    pub(crate) fn device_rows(&self, window: usize, ratio: f64) -> Range<f64> {
        let row = |index: usize| (index as f64 * self.length * ratio + 0.5).floor();
        let end = if window + 1 >= self.count() {
            (self.extent * ratio + 0.5).floor()
        } else {
            row(window + 1)
        };
        row(window)..end
    }

    /// Where window `window`'s top-left corner sits in the chapter painted
    /// at `ratio`, in device pixels: the shift that moves the chapter onto
    /// the window's own origin, reversed. A chapter running leftwards
    /// starts at the right edge of a window `length` wide whose left edge
    /// is the chapter's origin, `floor(length × ratio + 0.5)` device
    /// pixels left of that edge, so its first window is where a page is.
    pub(crate) fn device_origin(&self, window: usize, ratio: f64) -> (f64, f64) {
        let rows = self.device_rows(window, ratio);
        match self.axis {
            ScrollAxis::Down => (0.0, rows.start),
            ScrollAxis::Left => ((self.length * ratio + 0.5).floor() - rows.end, 0.0),
        }
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
