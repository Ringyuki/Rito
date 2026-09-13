//! Paints the fragment engine's layout output through the reader's
//! display-command protocol.
//!
//! The reader renders `DisplayCommand` streams and nothing else, so the
//! fragment engine reaches the screen by walking its fragment tree and
//! emitting the same commands the legacy pipeline produces. The walk is
//! paint-only: it takes geometry exactly as laid out and reads every visual
//! property from the typed style tables the formatting tree carries. A
//! style the command protocol cannot express fails closed naming the
//! property — the same doctrine as the tree builder's whitelist — so a
//! chapter never reaches the screen with silently dropped ink.
//!
//! This file holds the walk's entry point, its context and the pixel-snap
//! helpers every module shares; the walk itself lives in `walk` (box
//! fragments), `line` (a horizontal line box), `text_run` (one run's
//! baseline, ruby annotation and clusters), `image` (one inline image),
//! `vertical` (vertical-rl lines painted as columns), `run_style` (the
//! typed run paint from a computed style) and `family` (font family
//! stacks under the pinned-font policy).

use rito_fragment::{FormattingTree, Fragment};

use std::collections::BTreeMap;

use crate::epub::EpubResult;
use crate::fragment_bridge::{FlowItemSource, NodePaint};
use crate::render::DisplayCommand;

mod family;
mod image;
mod line;
mod run_style;
#[cfg(test)]
mod tests;
mod text_run;
mod vertical;
mod walk;

pub(crate) use family::measure_family_stack;

use walk::append_fragment_display_commands_inner;

/// How painted family stacks reach the canvas when the reader pins fonts.
///
/// The renderer resolves the painted `font-family` string against the
/// host's font set, while layout resolved it against exactly the faces
/// registered in the engine. Left as computed, a family the host happens
/// to own (but the engine does not) would render in a font layout never
/// measured. This policy reproduces the retained pipeline's rewrite:
/// families the engine cannot resolve are dropped, and the reader's
/// pinned faces are appended under their stable alias names ahead of the
/// generic fallback, which the host has registered via `FontFace`.
#[derive(Clone, Debug, Default)]
pub(crate) struct PaintFamilyPolicy {
    /// Lowercased family names layout can actually resolve.
    pub(crate) available: std::collections::BTreeSet<String>,
    /// Pinned-face alias names, in policy order.
    pub(crate) aliases: Vec<String>,
}

/// Fraction of the font size between a run's alphabetic baseline and the
/// edge the reader's canvas painter anchors text at (`textBaseline: 'top'`
/// places the em-square top at the paint rect's y). The canvas em-square
/// top is font-dependent; this shared engine-wide proxy is what the legacy
/// pipeline positions baselines with, and the browser pixel oracle owns
/// calibrating it.
const CANVAS_TOP_ASCENT_RATIO: f64 = 0.8;

/// Everything the paint walk needs besides the fragments themselves.
#[derive(Clone, Copy)]
pub(crate) struct FragmentPaintContext<'a> {
    /// Family-stack rewrite for pinned-font readers; `None` paints
    /// computed stacks as-is.
    pub(crate) family_policy: Option<&'a PaintFamilyPolicy>,
    /// Layout-inert per-node paint the bridge collected (rules today).
    pub(crate) node_paints: Option<&'a BTreeMap<u32, NodePaint>>,
    /// Flank border strokes for inline images, keyed by the `<img>`
    /// element's source index; widths are the absorbed border widths
    /// (top, right, bottom, left) layout reserved as padding.
    pub(crate) image_border_paints: Option<&'a BTreeMap<u32, (NodePaint, [f64; 4])>>,
    /// Outside list markers keyed by list-item node id; drawn
    /// right-aligned against the item's content-left edge on its first
    /// line's baseline.
    pub(crate) list_markers: Option<&'a BTreeMap<u32, crate::fragment_bridge::ListMarkerPaint>>,
    /// Ruby annotations shaped at their own size, keyed by (inline-flow
    /// node id, item index): the natural cluster origins the painter
    /// distributes over each base segment by `ruby-align`.
    pub(crate) ruby_annotation_runs: Option<&'a BTreeMap<(u32, usize), rito_inline::MeasuredRuby>>,
    /// `Some((right, top))` when the tree laid out as a vertical-rl
    /// chapter in the swapped page: recursion origins then accumulate
    /// LOGICAL (inline, block) offsets and every line paints as a column
    /// placed `block` in from `right`, `inline` down from `top`.
    pub(crate) vertical_frame: Option<(f64, f64)>,
    /// Per-flow item provenance keyed by inline-flow node id — the map
    /// the artifact builder reads. Painted text and image commands carry
    /// the nearest enclosing link's target (and an image's alt text) so
    /// a host resolves taps against the display list alone.
    pub(crate) flow_item_sources: Option<&'a BTreeMap<u32, Vec<FlowItemSource>>>,
    /// Device pixels per CSS pixel the commands will be rasterized at.
    /// Only a glyph baseline rounds on the device grid: box edges, layer
    /// origins and image rects snap to whole CSS pixels whatever the
    /// ratio, the way the browser's paint offsets do (a phase sweep of
    /// fractional line tops at 1.5×, 2× and 3× put every glyph on
    /// round(ratio × (round(top) + baseline)) and every box edge on
    /// ratio × round(edge)). Layout never reads it: pagination is
    /// identical at every ratio.
    pub(crate) ratio: f64,
}

impl Default for FragmentPaintContext<'_> {
    fn default() -> Self {
        Self {
            family_policy: None,
            node_paints: None,
            image_border_paints: None,
            list_markers: None,
            ruby_annotation_runs: None,
            vertical_frame: None,
            flow_item_sources: None,
            ratio: 1.0,
        }
    }
}

/// The browser's paint-offset snap: a CSS-px coordinate rounded to the
/// nearest whole CSS pixel, at any device ratio.
pub(crate) fn snap_css(value: f64) -> f64 {
    value.round()
}

/// A cluster's absolute origin as the pen draws it: floored onto the
/// 1/64 CSS-px grid when the run takes the grid law (an all-CJK run at a
/// fractional font size), the float accumulation itself otherwise.
fn cluster_x(x: f64, grid: bool) -> f64 {
    if grid {
        (x * 64.0).floor() / 64.0
    } else {
        x
    }
}

/// Nearest device-pixel position of a CSS-px value at `ratio` device
/// pixels per CSS pixel, in CSS px. Ratio 1 is a plain round. Glyph
/// baselines are the one thing painted on this grid.
pub(crate) fn snap_to_grid(value: f64, ratio: f64) -> f64 {
    (value * ratio).round() / ratio
}

/// The painted baseline of a line whose top sits at `line_top`: the line
/// box top rounds to a whole CSS pixel in the snap origin's space, the
/// within-line baseline adds to it, and the sum rounds once on the device
/// grid. Rounding both stages on the device grid instead put half the
/// lines of a 2× phase sweep one device row off the browser's.
fn painted_baseline(snap_origin_y: f64, line_top: f64, within_line: f64, ratio: f64) -> f64 {
    snap_origin_y + snap_to_grid(snap_css(line_top - snap_origin_y) + within_line, ratio)
}

/// Walks a laid-out fragment tree and appends the display commands that
/// paint it, with every rectangle translated by `(origin_x, origin_y)`
/// into the caller's coordinate space (a page's content origin).
pub(crate) fn append_fragment_display_commands(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    fragment: &Fragment,
    origin_x: f64,
    origin_y: f64,
    context: FragmentPaintContext<'_>,
) -> EpubResult<()> {
    append_fragment_display_commands_inner(
        commands, tree, fragment, origin_x, origin_y, context, 0.0,
    )
}
