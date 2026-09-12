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

use std::sync::Arc;

use rito_fragment::{
    FormattingNodeContent, FormattingTree, Fragment, ImageFragment, InlineItem, LineFragment,
    TextFragment,
};
use rito_style_contract::{AbsoluteColor, FontSlant, InlineFormattingStyleV1, LengthPercentage};
use serde_json::Value;

use std::collections::BTreeMap;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::{FlowItemSource, NodePaint};
use crate::layout::{
    FontPaint, FontPaintStyle, MeasurePaint, RunDecoration, RunDecorationKind, RunPaint,
    RunPaintData, TextShadowPaint,
};
use crate::render::{DisplayCommand, DisplayTextCommandInput};
use crate::style::{absolute_color, serialize_font_families};

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

/// Wire-precision JSON number: six decimal places, integral values as
/// integers — the rounding every display-command producer shares.
///
/// Three decimals proved too coarse for text positions: a run x of
/// 840.65625 shipped as 840.656, pulling every glyph 0.00025px below its
/// LayoutUnit position — invisible everywhere except characters whose
/// position lands exactly on a quarter-pixel raster tie (fraction 1/8,
/// 3/8, 5/8, 7/8), where the browser rounds the exact value UP and the
/// depressed value rounded DOWN, flipping the glyph one raster bucket
/// left on a ~125px page lattice (measured: restoring the lost 0.00025
/// made the engine's canvas replay bit-identical to the browser's page).
/// Six decimals encode every 1/64 LayoutUnit position exactly.
pub(crate) fn number_value(value: f64) -> Value {
    let rounded = (value * 1e6).round() / 1e6;
    if rounded.fract().abs() < f64::EPSILON {
        Value::Number(serde_json::Number::from(rounded as i64))
    } else {
        Value::Number(
            serde_json::Number::from_f64(rounded).unwrap_or_else(|| serde_json::Number::from(0)),
        )
    }
}

/// Wire rectangle in the shared `{x, y, width, height}` shape.
pub(crate) fn rect_value(x: f64, y: f64, width: f64, height: f64) -> Value {
    serde_json::json!({
        "x": number_value(x),
        "y": number_value(y),
        "width": number_value(width),
        "height": number_value(height),
    })
}

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

#[allow(clippy::too_many_arguments)]
fn append_fragment_display_commands_inner(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    fragment: &Fragment,
    origin_x: f64,
    origin_y: f64,
    context: FragmentPaintContext<'_>,
    snap_origin_y: f64,
) -> EpubResult<()> {
    match fragment {
        Fragment::Box(fragment) => {
            let node_paint = context
                .node_paints
                .and_then(|paints| paints.get(&fragment.source.0));
            // A transformed box is a stacking wrapper: the transform maps
            // the box AND its whole subtree about the border-box center
            // (the CSS transform-origin default), exactly as the browser
            // rotates a card together with its text.
            let transformed = matches!(
                node_paint,
                Some(NodePaint::Box {
                    transform: Some(_),
                    ..
                })
            );
            if let Some(NodePaint::Box {
                transform: Some(transforms),
                ..
            }) = node_paint
            {
                commands.push(DisplayCommand::push_state());
                // The browser snaps a transformed subtree's LAYER to whole
                // CSS pixels: a rotated card at a fractional block offset
                // renders bit-identically to the same card at the rounded
                // offset (probed — DOM output at y .0 and y .48 matched
                // column for column). The rigid shift to that rounded
                // position is a translate composed BEFORE the author
                // transforms, in the un-rotated frame.
                let box_x = origin_x + fragment.rect.x;
                let box_y = origin_y + fragment.rect.y;
                let (snap_dx, snap_dy) = (snap_css(box_x) - box_x, snap_css(box_y) - box_y);
                let ops = if snap_dx == 0.0 && snap_dy == 0.0 {
                    transforms.clone()
                } else {
                    let mut ops = vec![serde_json::json!({
                        "kind": "translate",
                        "x": { "unit": "px", "value": number_value(snap_dx) },
                        "y": { "unit": "px", "value": number_value(snap_dy) },
                    })];
                    if let serde_json::Value::Array(entries) = transforms {
                        ops.extend(entries.iter().cloned());
                    }
                    serde_json::Value::Array(ops)
                };
                commands.push(DisplayCommand::transform(
                    serde_json::json!({
                        "x": number_value(box_x + fragment.rect.width / 2.0),
                        "y": number_value(box_y + fragment.rect.height / 2.0),
                    }),
                    serde_json::json!({
                        "width": number_value(fragment.rect.width),
                        "height": number_value(fragment.rect.height),
                    }),
                    ops,
                ));
            }
            if let Some(paint) = node_paint {
                match paint {
                    NodePaint::Rule {
                        color,
                        style,
                        thickness,
                    } => {
                        // The renderer strokes the rule as thick as the
                        // rect it receives; the box can be taller (author
                        // height plus borders flow as box size), so the
                        // painted rect keeps the stroke thickness and
                        // rides at the box top where the border lives. A
                        // thin inset rule is Chromium's fixed 3D bevel:
                        // a #9A9A9A top stroke and an #EEEEEE bottom
                        // stroke, whatever the border color (measured),
                        // closed at the sides by a dark left and a light
                        // right edge — a border box of two colours, whose
                        // corners the border lowering miters where the
                        // colours meet.
                        let thickness = thickness.min(fragment.rect.height);
                        if style == &"inset" {
                            let edge = |color: &str| serde_json::json!({ "color": color, "style": "solid" });
                            commands.push(DisplayCommand::paint_block(
                                rect_value(
                                    origin_x + fragment.rect.x,
                                    origin_y + fragment.rect.y,
                                    fragment.rect.width,
                                    fragment.rect.height,
                                ),
                                serde_json::json!({
                                    "border": {
                                        "top": edge("#9a9a9a"),
                                        "right": edge("#eeeeee"),
                                        "bottom": edge("#eeeeee"),
                                        "left": edge("#9a9a9a"),
                                    },
                                }),
                                Some(serde_json::json!({
                                    "topWidth": number_value(thickness),
                                    "rightWidth": number_value(thickness),
                                    "bottomWidth": number_value(thickness),
                                    "leftWidth": number_value(thickness),
                                })),
                            ));
                        } else {
                            commands.push(DisplayCommand::paint_horizontal_rule(
                                rect_value(
                                    origin_x + fragment.rect.x,
                                    origin_y + fragment.rect.y,
                                    fragment.rect.width,
                                    thickness,
                                ),
                                serde_json::json!({ "color": color, "style": style }),
                            ));
                        }
                    }
                    NodePaint::Box {
                        paint,
                        border_box,
                        bevels,
                        segment_horizontal_edges,
                        ..
                    } => {
                        // A collapsed table's dashed/dotted horizontal
                        // edge belongs to its cells: the dash phase
                        // restarts at every cell edge (measured: the
                        // truth's dot pattern doubles up where two cell
                        // segments meet, while a single full-width
                        // stroke runs one continuous cadence). Strip
                        // such an edge from the block paint and emit one
                        // rule per cell segment instead.
                        let mut paint = paint.clone();
                        let mut border_box = border_box.clone();
                        if *segment_horizontal_edges {
                            let segmented = split_collapsed_horizontal_edges(
                                &mut paint,
                                &mut border_box,
                                fragment,
                                origin_x,
                                origin_y,
                            );
                            commands.extend(segmented);
                        }
                        let paint = &paint;
                        let border_box = &border_box;
                        // A transform-only box carries an empty paint
                        // object; there is nothing to stroke or fill.
                        let has_decoration =
                            paint.as_object().is_none_or(|object| !object.is_empty());
                        if has_decoration {
                            commands.push(DisplayCommand::paint_block(
                                rect_value(
                                    origin_x + fragment.rect.x,
                                    origin_y + fragment.rect.y,
                                    fragment.rect.width,
                                    fragment.rect.height,
                                ),
                                paint.clone(),
                                border_box.clone(),
                            ));
                            // Ridge/groove inner halves: the border entry
                            // stroked the edge's outer tone full-width, so
                            // each bevel lays the opposite tone over the
                            // strip adjacent to the content. Corner joins
                            // stop at the neighbouring edge's width — the
                            // square stop approximates Blink's diagonal
                            // miter to within the corner's own pixels.
                            for (edge_index, inner_color) in bevels {
                                let side = |key: &str| {
                                    border_box
                                        .as_ref()
                                        .and_then(|widths| widths[key].as_f64())
                                        .unwrap_or(0.0)
                                };
                                let (top, right, bottom, left) = (
                                    side("topWidth"),
                                    side("rightWidth"),
                                    side("bottomWidth"),
                                    side("leftWidth"),
                                );
                                // The strips ride the same whole-pixel
                                // edges the border strokes snap to.
                                let left_edge = snap_css(origin_x + fragment.rect.x);
                                let top_edge = snap_css(origin_y + fragment.rect.y);
                                let right_edge =
                                    snap_css(origin_x + fragment.rect.x + fragment.rect.width);
                                let bottom_edge =
                                    snap_css(origin_y + fragment.rect.y + fragment.rect.height);
                                let (x, y) = (left_edge, top_edge);
                                let (width, height) =
                                    (right_edge - left_edge, bottom_edge - top_edge);
                                let strip = match edge_index {
                                    0 => (x + left, y + top / 2.0, width - left - right, top / 2.0),
                                    1 => (
                                        x + width - right,
                                        y + top,
                                        right / 2.0,
                                        height - top - bottom,
                                    ),
                                    2 => (
                                        x + left,
                                        y + height - bottom,
                                        width - left - right,
                                        bottom / 2.0,
                                    ),
                                    _ => {
                                        (x + left / 2.0, y + top, left / 2.0, height - top - bottom)
                                    }
                                };
                                if strip.2 > 0.0 && strip.3 > 0.0 {
                                    commands.push(DisplayCommand::paint_block(
                                        rect_value(strip.0, strip.1, strip.2, strip.3),
                                        serde_json::json!({
                                            "background": { "color": inner_color }
                                        }),
                                        None,
                                    ));
                                }
                            }
                        }
                    }
                }
            }
            // Text inside a transformed subtree snaps its rows in the
            // LAYER's coordinate space: the layer-origin translate above
            // shifts the whole subtree to the device grid, so a line
            // snapped relative to the box lands exactly where the
            // browser's quantized layer rasterizes it. Page-space
            // snapping would be shifted by the same translate and double
            // count the fraction.
            let child_snap_origin_y = if transformed {
                origin_y + fragment.rect.y
            } else {
                snap_origin_y
            };
            // An outside list marker: a text box whose right edge sits AT
            // the item's content edge, on the first line's painted
            // baseline (the browser's `list-style-position: outside` box
            // takes `margin-inline-start: -inline_size` for a text
            // marker, no fixed gap; measured on a decimal-list nav page,
            // the digit ink ends one 16px space plus the period's right
            // bearing before the text).
            if let Some(marker) = context
                .list_markers
                .and_then(|markers| markers.get(&fragment.source.0))
            {
                if let Some(rito_fragment::Fragment::Line(first_line)) = fragment
                    .children
                    .iter()
                    .find(|child| matches!(child, rito_fragment::Fragment::Line(_)))
                {
                    let styles = tree
                        .styles()
                        .ok_or_else(|| EpubError::new("marker paint needs style tables"))?;
                    let style = styles
                        .inline
                        .style(marker.style)
                        .map_err(|error| EpubError::new(format!("marker style: {error}")))?;
                    let run = marker.run.as_ref().ok_or_else(|| {
                        EpubError::new("outside marker painted before its string was measured")
                    })?;
                    let paint =
                        run_paint(style, context.family_policy, 0.0, false, false)?.glyphs_only();
                    let font_size = f64::from(style.font.size.get());
                    let line_y = origin_y + fragment.rect.y + first_line.rect.y;
                    let baseline = painted_baseline(
                        child_snap_origin_y,
                        line_y + first_line.ruby_growth,
                        first_line.baseline - first_line.ruby_growth,
                        context.ratio,
                    );
                    // The box's inline size is the shaped string's
                    // advance (trailing space included) on the 1/64
                    // layout grid, and every cluster paints where the
                    // engine measured it from the box's start.
                    let left = origin_x + fragment.rect.x - run.advance;
                    let clusters = run
                        .clusters
                        .iter()
                        .map(|cluster| {
                            (
                                cluster.byte,
                                cluster_x(left + cluster.x, run.grid),
                                baseline,
                            )
                        })
                        .collect();
                    commands.push(DisplayCommand::paint_text(DisplayTextCommandInput {
                        text: Value::String(marker.painted_text()),
                        rect: rect_value(
                            left,
                            baseline - CANVAS_TOP_ASCENT_RATIO * font_size,
                            run.advance,
                            font_size,
                        ),
                        paint,
                        line_height_px: None,
                        href: None,
                        source_text: None,
                        source_text_offset: None,
                        clusters,
                    }));
                }
            }
            for child in &fragment.children {
                // A vertical-rl flow's lines are COLUMNS: the block axis
                // ran left from the right edge during layout, so the
                // painter rotates each line's frame instead of stacking
                // it downward. First slice: text runs paint as upright
                // downward columns; ruby, markers and inline atoms keep
                // their horizontal path for now.
                if let (Fragment::Line(line), Some((frame_right, frame_top))) =
                    (child, context.vertical_frame)
                {
                    append_vertical_line_commands(
                        commands,
                        tree,
                        line,
                        origin_x + fragment.rect.x,
                        origin_y + fragment.rect.y,
                        frame_right,
                        frame_top,
                        context.family_policy,
                        context.flow_item_sources,
                        context.ruby_annotation_runs,
                    )?;
                    continue;
                }
                append_fragment_display_commands_inner(
                    commands,
                    tree,
                    child,
                    origin_x + fragment.rect.x,
                    origin_y + fragment.rect.y,
                    context,
                    child_snap_origin_y,
                )?;
            }
            if transformed {
                commands.push(DisplayCommand::pop_state());
            }
            Ok(())
        }
        Fragment::Line(line) => append_line_commands(
            commands,
            tree,
            line,
            origin_x,
            origin_y,
            context.family_policy,
            context.image_border_paints,
            context.flow_item_sources,
            context.ruby_annotation_runs,
            snap_origin_y,
            context.ratio,
        ),
        Fragment::Text(_) | Fragment::Image(_) => Err(EpubError::new(
            "text and image fragments paint through their line box, not standalone",
        )),
    }
}

#[allow(clippy::too_many_arguments)]
/// Splits a collapsed table's dashed/dotted horizontal border edges into
/// per-cell rule commands: the collapsed border belongs to the cells, so
/// the dash pattern restarts at every cell edge (measured on a two-cell
/// 3px-dotted bottom border: each segment strokes its own cadence from
/// its cell's edge and the meeting dots merge). The edge is removed from
/// the block paint; solid edges stay, since a continuous band has no
/// phase to restart.
fn split_collapsed_horizontal_edges(
    paint: &mut Value,
    border_box: &mut Option<Value>,
    fragment: &rito_fragment::BoxFragment,
    origin_x: f64,
    origin_y: f64,
) -> Vec<DisplayCommand> {
    let mut segments = Vec::new();
    let rows: Vec<&rito_fragment::BoxFragment> = fragment
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Box(row) => Some(row),
            _ => None,
        })
        .collect();
    for (edge, width_key) in [("top", "topWidth"), ("bottom", "bottomWidth")] {
        let Some(side) = paint
            .get("border")
            .and_then(|border| border.get(edge))
            .cloned()
        else {
            continue;
        };
        let style = side.get("style").and_then(Value::as_str).unwrap_or("solid");
        if style != "dotted" && style != "dashed" {
            continue;
        }
        let width = side.get("width").and_then(Value::as_f64).unwrap_or(0.0);
        // Skips NaN widths too: only a strictly positive width paints.
        if width.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
            continue;
        }
        let row = if edge == "top" {
            rows.first()
        } else {
            rows.last()
        };
        let Some(row) = row else { continue };
        let mut cuts: Vec<f64> = row
            .children
            .iter()
            .filter_map(|child| match child {
                Fragment::Box(cell) => {
                    Some(origin_x + fragment.rect.x + row.rect.x + cell.rect.x + cell.rect.width)
                }
                _ => None,
            })
            .collect();
        if cuts.is_empty() {
            continue;
        }
        // The last cell's edge yields to the table's border-box edge so
        // the final segment reaches the border corner.
        cuts.pop();
        let color = side
            .get("color")
            .and_then(Value::as_str)
            .unwrap_or("#000000")
            .to_owned();
        let y = if edge == "top" {
            origin_y + fragment.rect.y
        } else {
            origin_y + fragment.rect.y + fragment.rect.height - width
        };
        let mut start = origin_x + fragment.rect.x;
        let end = origin_x + fragment.rect.x + fragment.rect.width;
        for cut in cuts.into_iter().chain(std::iter::once(end)) {
            if cut > start {
                segments.push(DisplayCommand::paint_horizontal_rule(
                    rect_value(start, y, cut - start, width),
                    serde_json::json!({ "color": color, "style": style }),
                ));
                start = cut;
            }
        }
        if let Some(border) = paint.get_mut("border").and_then(Value::as_object_mut) {
            border.remove(edge);
        }
        if let Some(widths) = border_box.as_mut().and_then(Value::as_object_mut) {
            widths.insert(width_key.to_owned(), serde_json::json!(0.0));
        }
    }
    let border_empty = paint
        .get("border")
        .and_then(Value::as_object)
        .is_some_and(serde_json::Map::is_empty);
    if border_empty {
        if let Some(object) = paint.as_object_mut() {
            object.remove("border");
        }
        let all_zero = border_box.as_ref().is_some_and(|widths| {
            ["topWidth", "rightWidth", "bottomWidth", "leftWidth"]
                .iter()
                .all(|key| widths.get(*key).and_then(Value::as_f64).unwrap_or(0.0) == 0.0)
        });
        if all_zero {
            *border_box = None;
        }
    }
    segments
}

/// Punctuation that takes its vertical presentation in a column: brackets,
/// dashes and leaders are the horizontal glyph rotated a quarter turn
/// about its em center (how the `vert` feature draws them); comma and
/// period marks sit in the em's top-right corner instead of bottom-left.
const VERTICAL_ROTATED: &str = "「」『』()（）〔〕［］[]{}｛｝〈〉《》【】〖〗…‥ー―—–~〜～＝=";
const VERTICAL_SHIFTED: &str = "、。，．,.";

/// Paints one column run glyph by glyph: every code point sits upright
/// one step (the font size plus letter spacing) below the last, its
/// baseline 0.8 em below the run's top, the way the browser's column pen
/// stepped. Consecutive upright glyphs share one run with a cluster
/// origin each; a rotated mark paints as its own run under a quarter-turn
/// transform about its em center.
fn append_vertical_run_commands(
    commands: &mut Vec<DisplayCommand>,
    text: &str,
    paint: &RunPaint,
    font_size: f64,
    glyph_x: f64,
    top: f64,
    href: Option<String>,
) {
    let step = font_size + paint.measure().letter_spacing_px.unwrap_or(0.0);
    let run = |text: String, rect: Value, clusters: Vec<(u32, f64, f64)>| {
        DisplayCommand::paint_text(DisplayTextCommandInput {
            text: Value::String(text),
            rect,
            paint: paint.clone(),
            line_height_px: None,
            href: href.clone(),
            source_text: None,
            source_text_offset: None,
            clusters,
        })
    };
    let mut segment: Vec<(u32, f64, f64)> = Vec::new();
    let mut segment_start = 0usize;
    let mut segment_end = 0usize;
    let mut segment_top = top;
    let flush = |commands: &mut Vec<DisplayCommand>,
                 segment: &mut Vec<(u32, f64, f64)>,
                 start: usize,
                 end: usize,
                 segment_top: f64| {
        if segment.is_empty() {
            return;
        }
        let length = segment.len() as f64 * step;
        commands.push(run(
            text[start..end].to_owned(),
            rect_value(glyph_x, segment_top, font_size, length),
            std::mem::take(segment),
        ));
    };
    for (index, (byte, glyph)) in text.char_indices().enumerate() {
        let glyph_top = top + index as f64 * step;
        let pen_y = glyph_top + CANVAS_TOP_ASCENT_RATIO * font_size;
        if VERTICAL_ROTATED.contains(glyph) {
            flush(commands, &mut segment, segment_start, byte, segment_top);
            let center_x = glyph_x + font_size / 2.0;
            let center_y = pen_y - 0.3 * font_size;
            commands.push(DisplayCommand::push_state());
            commands.push(DisplayCommand::transform(
                serde_json::json!({ "x": number_value(center_x), "y": number_value(center_y) }),
                serde_json::json!({
                    "width": number_value(font_size),
                    "height": number_value(font_size),
                }),
                serde_json::json!([{ "kind": "rotate", "rad": std::f64::consts::FRAC_PI_2 }]),
            ));
            commands.push(run(
                glyph.to_string(),
                rect_value(glyph_x, glyph_top, font_size, font_size),
                vec![(0, glyph_x, pen_y)],
            ));
            commands.push(DisplayCommand::pop_state());
            segment_start = byte + glyph.len_utf8();
            segment_end = segment_start;
            continue;
        }
        if segment.is_empty() {
            segment_start = byte;
            segment_top = glyph_top;
        }
        let origin = if VERTICAL_SHIFTED.contains(glyph) {
            (glyph_x + 0.5 * font_size, pen_y - 0.6 * font_size)
        } else {
            (glyph_x, pen_y)
        };
        segment.push(((byte - segment_start) as u32, origin.0, origin.1));
        segment_end = byte + glyph.len_utf8();
    }
    flush(
        commands,
        &mut segment,
        segment_start,
        segment_end,
        segment_top,
    );
}

/// Paints one vertical-rl line box as a downward text column. The line
/// laid out with the horizontal engine in the swapped page (inline axis
/// = column length), so `box_inline`/`box_block` are LOGICAL offsets:
/// the accumulated block offset measures in from the frame's right edge
/// and the inline offset down from its top.
#[allow(clippy::too_many_arguments)]
fn append_vertical_line_commands(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    line: &LineFragment,
    box_inline: f64,
    box_block: f64,
    frame_right: f64,
    frame_top: f64,
    family_policy: Option<&PaintFamilyPolicy>,
    flow_item_sources: Option<&BTreeMap<u32, Vec<FlowItemSource>>>,
    ruby_annotation_runs: Option<&BTreeMap<(u32, usize), rito_inline::MeasuredRuby>>,
) -> EpubResult<()> {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(line.source).content else {
        return Err(EpubError::new("line fragment source is not an inline flow"));
    };
    let item_sources =
        flow_item_sources.and_then(|sources| sources.get(&line.source.0).map(Vec::as_slice));
    let styles = tree
        .styles()
        .ok_or_else(|| EpubError::new("formatting tree carries no style tables"))?;
    let mut full_text = String::new();
    let mut text_ranges: Vec<(std::ops::Range<usize>, usize)> = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        if let InlineItem::Text { text, .. } = item {
            let start = full_text.len();
            full_text.push_str(text);
            text_ranges.push((start..full_text.len(), item_index));
        }
    }
    let column_x = frame_right - (box_block + line.rect.y + line.rect.height);
    let column_top = frame_top + box_inline + line.rect.x;
    for child in &line.children {
        // A replaced atom in a vertical line: the layout box is the
        // swapped one (advance = physical height), so the device rect
        // swaps back — column position from the line, the atom's inline
        // offset down the page, physical width x height — and the
        // raster paints unrotated, clipping at the page edge like the
        // reference.
        if let Fragment::Image(image) = child {
            let Some(InlineItem::Image { src, .. }) = items.get(image.item_index as usize) else {
                continue;
            };
            let item_source =
                item_sources.and_then(|sources| sources.get(image.item_index as usize));
            commands.push(DisplayCommand::paint_image(
                src.clone(),
                rect_value(
                    column_x,
                    column_top + image.rect.x,
                    image.rect.height,
                    image.rect.width,
                ),
                item_source.and_then(|source| source.image_alt.clone()),
                item_source.and_then(|source| source.href.clone()),
            ));
            continue;
        }
        let Fragment::Text(run) = child else { continue };
        let start = run.text_start as usize;
        let end = run.text_end as usize;
        let Some((_, item_index)) = text_ranges
            .iter()
            .find(|(range, _)| range.start <= start && end <= range.end)
        else {
            continue;
        };
        let InlineItem::Text {
            style,
            ruby_annotation,
            ..
        } = &items[*item_index]
        else {
            continue;
        };
        let style = styles
            .inline
            .style(*style)
            .map_err(|error| EpubError::new(format!("text run has no inline style: {error}")))?;
        // A column run paints glyphs only: its inline box and decoration
        // have no column expression yet.
        let base_paint =
            run_paint(style, family_policy, run.justify_px, false, false)?.glyphs_only();
        let font_size = f64::from(style.font.size.get());
        // The glyph column centers on the line's STRUT: an annotation's
        // growth lands entirely on the line's right (matrix-measured:
        // the base keeps its plain-line distance from the left edge and
        // the annotation column pushes the right edge out), so the
        // centering basis excludes the growth.
        let glyph_x = column_x + (line.rect.height - line.ruby_growth - font_size) / 2.0;
        append_vertical_run_commands(
            commands,
            &full_text[start..end],
            &base_paint,
            font_size,
            glyph_x,
            column_top + run.rect.x,
            item_sources
                .and_then(|sources| sources.get(*item_index))
                .and_then(|source| source.href.clone()),
        );
        // The annotation rides the column's LEFT-out side? No: probed on
        // a vertical-rl ruby line, the annotation column sits between
        // the base and the NEXT line — its right edge on the line box's
        // right edge (rt 803.5..812.5 in a 782..812 line box, size 8).
        if let Some(annotation) = ruby_annotation {
            let item_range = {
                let (range, _) = &text_ranges[text_ranges
                    .iter()
                    .position(|(_, index)| index == item_index)
                    .unwrap_or(0)];
                range.clone()
            };
            let total_chars = full_text
                .get(item_range.clone())
                .map_or(0.0, |base| base.chars().count() as f64);
            let seg_start = full_text
                .get(item_range.start..start)
                .map_or(0.0, |prefix| prefix.chars().count() as f64);
            let seg_end_ratio = if end >= item_range.end {
                f64::INFINITY
            } else {
                full_text
                    .get(item_range.start..end)
                    .map_or(0.0, |prefix| prefix.chars().count() as f64)
                    / total_chars
            };
            if total_chars > 0.0 {
                let allocated = rito_fragment::allocate_ruby_annotation(
                    &annotation.text,
                    seg_start / total_chars,
                    seg_end_ratio,
                );
                if !allocated.is_empty() {
                    let annotation_size = font_size * f64::from(annotation.size_ratio);
                    // Down a column every annotation glyph paints at its
                    // alphabetic baseline one em-box ascent below its
                    // glyph top (the annotation's own typo ascent, what
                    // the browser's canvas resolves a top anchor to).
                    let em_ascent = ruby_annotation_runs
                        .and_then(|runs| runs.get(&(line.source.0, *item_index)))
                        .ok_or_else(|| {
                            EpubError::new(
                                "vertical ruby annotation painted before its string was measured",
                            )
                        })?
                        .em_ascent;
                    let ruby_paint = base_paint.for_ruby(annotation_size);
                    let annotation_x = column_x + line.rect.height - annotation_size;
                    let span_top = column_top + run.rect.x - run.ruby_overhang_px;
                    let span = run.rect.width + run.ruby_overhang_px + run.ruby_overhang_right_px;
                    // The column annotation spreads down its base span
                    // the way the initial `ruby-align` spreads: the free
                    // length splits into one share per glyph, half a
                    // share at each edge, every glyph's top one
                    // annotation size plus a share below the last.
                    let glyphs = allocated.chars().count().max(1) as f64;
                    let share = (span - glyphs * annotation_size) / glyphs;
                    let clusters = allocated
                        .char_indices()
                        .enumerate()
                        .map(|(index, (byte, _))| {
                            (
                                byte as u32,
                                annotation_x,
                                span_top
                                    + share / 2.0
                                    + index as f64 * (annotation_size + share)
                                    + em_ascent,
                            )
                        })
                        .collect();
                    commands.push(DisplayCommand::paint_ruby(DisplayTextCommandInput {
                        text: Value::String(allocated),
                        rect: rect_value(annotation_x, span_top, annotation_size, span),
                        paint: ruby_paint,
                        line_height_px: None,
                        href: None,
                        source_text: None,
                        source_text_offset: None,
                        clusters,
                    }));
                }
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_line_commands(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    line: &LineFragment,
    origin_x: f64,
    origin_y: f64,
    family_policy: Option<&PaintFamilyPolicy>,
    image_border_paints: Option<&BTreeMap<u32, (NodePaint, [f64; 4])>>,
    flow_item_sources: Option<&BTreeMap<u32, Vec<FlowItemSource>>>,
    ruby_annotation_runs: Option<&BTreeMap<(u32, usize), rito_inline::MeasuredRuby>>,
    snap_origin_y: f64,
    ratio: f64,
) -> EpubResult<()> {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(line.source).content else {
        return Err(EpubError::new("line fragment source is not an inline flow"));
    };
    let item_sources =
        flow_item_sources.and_then(|sources| sources.get(&line.source.0).map(Vec::as_slice));
    let styles = tree
        .styles()
        .ok_or_else(|| EpubError::new("formatting tree carries no style tables"))?;
    // Text fragments address the flow's concatenated item text by byte
    // range; rebuild that concatenation to slice run text and map each run
    // back to the item whose style paints it.
    let mut full_text = String::new();
    let mut text_ranges: Vec<(std::ops::Range<usize>, usize)> = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        if let InlineItem::Text { text, .. } = item {
            let start = full_text.len();
            full_text.push_str(text);
            text_ranges.push((start..full_text.len(), item_index));
        }
    }
    let line_x = origin_x + line.rect.x;
    let line_y = origin_y + line.rect.y;
    // The list item's outside disc marker, filled with the line's text
    // color (Blink inherits the item's `color`). Geometry comes from the
    // layout side (see rito_fragment::MarkerFragment).
    if let Some(marker) = &line.marker {
        let color = items
            .iter()
            .find_map(|item| match item {
                InlineItem::Text { style, .. } => Some(*style),
                _ => None,
            })
            .and_then(|style| styles.inline.style(style).ok())
            .map(|style| css_color(style.paint.foreground))
            .transpose()?
            .unwrap_or_else(|| "#000000".to_owned());
        commands.push(DisplayCommand::paint_block(
            rect_value(
                line_x + marker.x,
                line_y + marker.y,
                marker.diameter,
                marker.diameter,
            ),
            serde_json::json!({
                "background": { "color": color },
                "radius": { "px": marker.diameter / 2.0 },
            }),
            None,
        ));
    }
    // Each item's extent on this line. The browser lays an item's line
    // fragment out at LayoutUnit precision — its right edge, where the
    // item's inline box band and decoration line end, sits at the
    // item's start plus its shaped width ceiled onto the 1/64 grid —
    // while the runs inside it accumulate in float; the run closing an
    // item takes that edge as its rect's end.
    let mut item_extents: BTreeMap<usize, (f64, f64)> = BTreeMap::new();
    for child in &line.children {
        if let Fragment::Text(run) = child {
            let (start, end) = (run.text_start as usize, run.text_end as usize);
            if let Some((_, item_index)) = text_ranges
                .iter()
                .find(|(range, _)| range.start <= start && end <= range.end)
            {
                let extent = item_extents
                    .entry(*item_index)
                    .or_insert((f64::INFINITY, f64::NEG_INFINITY));
                extent.0 = extent.0.min(run.rect.x);
                extent.1 = extent.1.max(run.rect.x + run.rect.width);
            }
        }
    }
    for child in &line.children {
        match child {
            Fragment::Text(run) => {
                append_text_run_command(
                    commands,
                    items,
                    styles,
                    &full_text,
                    &text_ranges,
                    &item_extents,
                    line,
                    run,
                    line_x,
                    line_y,
                    family_policy,
                    item_sources,
                    ruby_annotation_runs,
                    snap_origin_y,
                    ratio,
                )?;
            }
            Fragment::Image(image) => {
                let item_source =
                    item_sources.and_then(|sources| sources.get(image.item_index as usize));
                append_image_command(
                    commands,
                    items,
                    image,
                    line_x,
                    line_y,
                    image_border_paints,
                    item_source,
                )?;
            }
            Fragment::Box(atom) => {
                // An inline-block atom riding the line: its mini
                // paragraph's lines paint in the atom's frame. Box
                // decorations on the atom itself are not modelled yet.
                for inner in &atom.children {
                    let Fragment::Line(inner_line) = inner else {
                        continue;
                    };
                    append_line_commands(
                        commands,
                        tree,
                        inner_line,
                        line_x + atom.rect.x,
                        line_y + atom.rect.y,
                        family_policy,
                        image_border_paints,
                        flow_item_sources,
                        ruby_annotation_runs,
                        snap_origin_y,
                        ratio,
                    )?;
                }
            }
            Fragment::Line(_) => {
                return Err(EpubError::new(
                    "line boxes contain only text, image, and inline-block fragments",
                ));
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_text_run_command(
    commands: &mut Vec<DisplayCommand>,
    items: &[InlineItem],
    styles: &rito_fragment::FormattingTreeStyles,
    full_text: &str,
    text_ranges: &[(std::ops::Range<usize>, usize)],
    item_extents: &BTreeMap<usize, (f64, f64)>,
    line: &LineFragment,
    run: &TextFragment,
    line_x: f64,
    line_y: f64,
    family_policy: Option<&PaintFamilyPolicy>,
    item_sources: Option<&[FlowItemSource]>,
    ruby_annotation_runs: Option<&BTreeMap<(u32, usize), rito_inline::MeasuredRuby>>,
    snap_origin_y: f64,
    ratio: f64,
) -> EpubResult<()> {
    let start = run.text_start as usize;
    let end = run.text_end as usize;
    // The inline provider brushes every glyph run with its item index, so
    // a run always lies inside exactly one item; a run that straddles two
    // items would paint one item's style over the other's text.
    let (_, item_index) = text_ranges
        .iter()
        .find(|(range, _)| range.start <= start && end <= range.end)
        .ok_or_else(|| {
            EpubError::new(format!(
                "text run bytes {start}..{end} do not lie inside one inline item"
            ))
        })?;
    let InlineItem::Text {
        style,
        baseline_shift_px,
        ruby_annotation,
        ..
    } = &items[*item_index]
    else {
        return Err(EpubError::new("text run maps to a non-text inline item"));
    };
    let style = styles
        .inline
        .style(*style)
        .map_err(|error| EpubError::new(format!("text run has no inline style: {error}")))?;
    // A span shaping into several glyph runs still paints ONE inline box:
    // only the run at the item's start carries the start edge and left
    // padding, only the run at its end carries the end edge and right
    // padding.
    let (item_range, _) = text_ranges
        .iter()
        .find(|(range, _)| range.start <= start && end <= range.end)
        .cloned()
        .unwrap_or((start..end, 0));
    // The run closing its item on this line ends where the browser's
    // item fragment ends: the item's start plus its width on the 1/64
    // grid (its band and decoration line end there too).
    let rect_width = item_extents
        .get(item_index)
        .filter(|(_, right)| (run.rect.x + run.rect.width - right).abs() < 1e-9)
        .map_or(run.rect.width, |(left, right)| {
            left + rito_inline::layout_unit_ceil(right - left) - run.rect.x
        });
    let mut paint = run_paint(
        style,
        family_policy,
        // A ruby spread's interior gap rides the same painted
        // letter-spacing knob as justify shares (they never coexist on
        // one run: a spread base receives no interior justification).
        run.justify_px + run.ruby_gap_px,
        start == item_range.start,
        end == item_range.end,
    )?;
    let font_size = f64::from(style.font.size.get());
    // The run's baseline is the line's, raised by the item's own shift;
    // the paint rect starts one canvas-'top' ascent above it and spans the
    // em box. The line box height travels separately so consumers can
    // reconstruct line geometry.
    //
    // Blink's raster snap is TWO-STAGE (probed, 16/16 discriminating
    // matrix at 1×): the line box top rounds to a whole CSS pixel, and
    // the run's within-line baseline rounds on top of it — on the DEVICE
    // grid, the one place the ratio enters (a 64-phase sweep at 1.5×, 2×
    // and 3× lands every glyph on round(ratio × (round(top) + baseline));
    // rounding the within-line baseline to a device row on its own
    // matched only half the phases at 2× and 3×). Canvas 'alphabetic'
    // fillText rounds the value it is handed once, so the two stages are
    // pre-composed here. For the common integer within-line baseline the
    // integer commutes with the round and this equals rounding the sum —
    // which is why handing the fractional sum through reproduced the
    // browser's 27/27/28 alternating ink pitch. A raised marker image
    // gives the line a FRACTIONAL within-line baseline, and there the
    // stages disagree with the summed round by one row (a footnote
    // marker line at line top .609375 with baseline 20.71875 paints at
    // 132 + 21, not round(152.328125) = 152).
    // The line-top round happens in the snap origin's space: absolute
    // outside transforms (origin 0), border-box-relative inside one —
    // composed with the transform command's layer-origin translate this
    // reproduces round(box) + round(local), the browser's quantized
    // layer raster.
    // A run inside a decorated inline box re-anchors at the BOX instead
    // (measured on 22px/24px bordered spans sharing one 309.5625 layout
    // baseline that raster one row apart): the box's absolute top rounds
    // to a whole CSS pixel, the top border+padding edge rounds within
    // it, and the baseline hangs the primary font's integer ascent
    // below, the whole sum rounded once on the device grid like any
    // other baseline. The box's snapped extent rides the paint so the
    // painter strokes the decoration on those exact rows. For an
    // undecorated run the formula would collapse to the line-box snap
    // (integer ascent and integer within-line baseline commute with the
    // round), so bare text keeps the two-stage path verbatim.
    // Beside the painted (device-grid) baseline, the CSS-grid baseline:
    // the same line-top round without the device round of the sum. The
    // inline band and the decoration line snap on the CSS grid from it —
    // the browser rounds them from the layout baseline to whole CSS
    // pixels — where the glyph baseline at 2× can sit on an odd device
    // row, half a CSS pixel from the line the browser draws.
    let (baseline, css_baseline) = match &run.box_snap {
        Some(snap) => {
            let layout_baseline = line_y + line.baseline - baseline_shift_px;
            let box_top = layout_baseline - snap.int_ascent - snap.edge_top;
            let box_bottom = layout_baseline + snap.int_descent + snap.edge_bottom;
            let painted_top = snap_origin_y + snap_css(box_top - snap_origin_y);
            let painted_bottom = snap_origin_y + snap_css(box_bottom - snap_origin_y);
            let within_box = snap_css(snap.edge_top) + snap.int_ascent;
            let baseline = painted_baseline(snap_origin_y, box_top, within_box, ratio);
            let em_top = baseline - CANVAS_TOP_ASCENT_RATIO * font_size;
            paint.set_box_offsets(painted_top - em_top, painted_bottom - em_top);
            (baseline, painted_top + within_box)
        }
        None => {
            // The ruby-annotation growth belongs to the LINE BOX TOP:
            // the browser shifts the grown line down by the analytic
            // growth and then rasters it exactly like a plain line —
            // round(top + growth) + round(natural baseline). Measured
            // on the dual-pipeline ruby probe (six line-top phases,
            // FZBWKS 16px/rt 0.55, lh 20.8, interior growth 5.2): the
            // painted pitch from the previous plain line is the integer
            // layout pitch 26 at EVERY phase, where folding the growth
            // into the baseline and ceiling it painted 27 on five of
            // the six phases. The historical interior case (top
            // 553.1875, baseline 15, growth 6.484375 rastering at 575)
            // satisfies this law too: round(559.671875) + 15 = 575 —
            // the earlier per-stage-ceil reading fit that one point but
            // not the phase sweep.
            let line_top = line_y + line.ruby_growth;
            let within_line = line.baseline - baseline_shift_px - line.ruby_growth;
            (
                painted_baseline(snap_origin_y, line_top, within_line, ratio),
                snap_origin_y + snap_css(line_top - snap_origin_y) + within_line,
            )
        }
    };
    let em_top = baseline - CANVAS_TOP_ASCENT_RATIO * font_size;
    // The decoration line rides the CSS-grid baseline: its offset was
    // resolved against the run rect, which hangs off the painted one.
    paint.shift_decoration(css_baseline - baseline);
    // A run with a background but no padding or border is no decorated
    // box for layout (it anchors off the line box like bare text), yet
    // the browser still paints its band from the primary font's grid-fit
    // ascent to its descent around the baseline (canvas fontBoundingBox:
    // a highlighted 20px title paints a 24px band, not its em box). The
    // extent rides the paint so the lowering fills the rows the browser
    // does; without a grid metric the lowering falls back to the em box.
    if run.box_snap.is_none() && paint.has_box_paint() {
        if let Some((ascent, descent)) = run.font_grid {
            paint.set_box_offsets(
                css_baseline - ascent - em_top,
                css_baseline + descent - em_top,
            );
        }
    }
    // A base split across lines carries the annotation words whose
    // character midpoints fall over each segment (measured: 正|规勇者
    // under "Legal Brave" paints Legal on 正's line and Brave on the
    // next; single-word Leprechaun rides whichever segment holds its
    // midpoint — the whole annotation for front-heavy splits). The
    // allocation replays the same pure function layout used.
    let segment_annotation = ruby_annotation.as_ref().and_then(|annotation| {
        let total = item_range.end.saturating_sub(item_range.start);
        if total == 0 {
            return None;
        }
        let seg_start = full_text
            .get(item_range.start..start)
            .map_or(0.0, |prefix| prefix.chars().count() as f64);
        let seg_end = full_text
            .get(item_range.start..end)
            .map_or(0.0, |prefix| prefix.chars().count() as f64);
        let total_chars = full_text
            .get(item_range.clone())
            .map_or(0.0, |base| base.chars().count() as f64);
        if total_chars <= 0.0 {
            return None;
        }
        let range = rito_fragment::allocate_ruby_annotation_range(
            &annotation.text,
            seg_start / total_chars,
            if end >= item_range.end {
                // The final segment closes the interval so a midpoint
                // exactly at its end still lands inside.
                f64::INFINITY
            } else {
                seg_end / total_chars
            },
        )?;
        Some((range, annotation))
    });
    if let Some((range, annotation)) = segment_annotation {
        // The annotation paints at the rt cascade size over the base
        // run's laid-out extent.
        let annotation_size = font_size * f64::from(annotation.size_ratio);
        let text = annotation.text.get(range.clone()).unwrap_or_default();
        // A space-around spread base advance holds (n−1) interior gaps,
        // and the annotation spans one more share — half a gap of
        // overhang past each base edge — so widening the rect by one gap
        // reconstructs the annotation's exact extent. Justify spacing
        // (justify_px) deliberately does NOT widen the rect: a justified
        // narrow-annotation base grows through its own extent and the
        // annotation only re-centers over it.
        let rect_x = line_x + run.rect.x - run.ruby_overhang_px;
        // The column's extent is its width on the 1/64 layout grid, the
        // way the browser stores the base line the annotation aligns to
        // (a four-glyph base whose justified shares sum to 64.268 gives
        // the annotation 64.28125: DOM-measured, the difference moved a
        // second Latin word across a quarter-pixel raster bucket).
        let rect_width = rito_inline::layout_unit_ceil(
            run.rect.width + run.ruby_overhang_px + run.ruby_overhang_right_px,
        );
        // The annotation was shaped whole when the chapter was built;
        // this segment's words are one contiguous slice of it, re-based
        // to their first cluster, and the computed `ruby-align` places
        // every cluster over the segment's extent.
        let measured = ruby_annotation_runs
            .and_then(|runs| runs.get(&(line.source.0, *item_index)))
            .ok_or_else(|| {
                EpubError::new("ruby annotation painted before its string was measured")
            })?;
        // The annotation line sits over the base the way Chromium
        // places it: its baseline the measured em-height offset above
        // the base's painted baseline (whole pixels, so it lands on a
        // device row wherever the base did).
        let annotation_baseline = baseline - measured.over_offset;
        let measured = &measured.run;
        let slice: Vec<&rito_fragment::ClusterPosition> = measured
            .clusters
            .iter()
            .filter(|cluster| range.contains(&(cluster.byte as usize)))
            .collect();
        let first_x = slice.first().map_or(0.0, |cluster| cluster.x);
        let natural: Vec<rito_fragment::ClusterPosition> = slice
            .iter()
            .map(|cluster| rito_fragment::ClusterPosition {
                byte: cluster.byte - range.start as u32,
                x: cluster.x - first_x,
            })
            .collect();
        let slice_end = measured
            .clusters
            .iter()
            .find(|cluster| cluster.byte as usize >= range.end)
            .map_or(measured.advance, |cluster| cluster.x);
        let origins = rito_fragment::distribute_ruby_annotation(
            text,
            &natural,
            slice_end - first_x,
            rect_x,
            rect_width,
            annotation.align,
            annotation_size,
        );
        let annotation_top = annotation_baseline - CANVAS_TOP_ASCENT_RATIO * annotation_size;
        let clusters = natural
            .iter()
            .zip(origins)
            .map(|(cluster, x)| (cluster.byte, x, annotation_baseline))
            .collect();
        commands.push(DisplayCommand::paint_ruby(DisplayTextCommandInput {
            text: Value::String(text.to_owned()),
            rect: rect_value(rect_x, annotation_top, rect_width, annotation_size),
            paint: paint.for_ruby(annotation_size),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
            clusters,
        }));
    }
    // The origin every cluster paints at: the run's start (the centred
    // origin of a packed ruby base) plus the offset layout stepped to,
    // which already moves a halt-trimmed opener left by its blank half.
    // An all-CJK run at a fractional size lands each origin on the 1/64
    // grid; every other run keeps the float sum the browser's pen
    // accumulates.
    let cluster_origin_x = line_x + run.rect.x + run.ruby_center_shift_px;
    let run_origin_x = cluster_origin_x - run.opener_trim_px;
    let clusters = run
        .clusters
        .iter()
        .map(|cluster| {
            (
                cluster.byte - run.text_start,
                cluster_x(cluster_origin_x + cluster.x, run.cluster_grid),
                baseline,
            )
        })
        .collect();
    commands.push(DisplayCommand::paint_text(DisplayTextCommandInput {
        text: Value::String(full_text[start..end].to_owned()),
        // A halt-trimmed opener was laid at half width, but the painter
        // draws the untrimmed glyph whose outline sits one blank half
        // further right — shift the draw origin left by the removed half
        // so the ink lands where Blink's halt variant puts it (measured
        // at 64px: full-width 「 inks at box+41, the halt variant at
        // box+9 — the outline itself moves left by the trimmed half).
        rect: rect_value(
            run_origin_x,
            em_top,
            rect_width + run.opener_trim_px,
            font_size,
        ),
        paint,
        line_height_px: Some(number_value(line.rect.height)),
        // The nearest enclosing link rides the painted run so a host
        // resolves taps against the display list alone.
        href: item_sources
            .and_then(|sources| sources.get(*item_index))
            .and_then(|source| source.href.clone()),
        source_text: None,
        source_text_offset: None,
        clusters,
    }));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_image_command(
    commands: &mut Vec<DisplayCommand>,
    items: &[InlineItem],
    image: &ImageFragment,
    line_x: f64,
    line_y: f64,
    image_border_paints: Option<&BTreeMap<u32, (NodePaint, [f64; 4])>>,
    item_source: Option<&FlowItemSource>,
) -> EpubResult<()> {
    let Some(InlineItem::Image {
        src,
        source,
        intrinsic_width,
        intrinsic_height,
        fit_contain,
        viewport,
        object_fit,
        ..
    }) = items.get(image.item_index as usize)
    else {
        return Err(EpubError::new(format!(
            "image fragment item index {} does not name an image item",
            image.item_index
        )));
    };
    // The image's own border: layout absorbed the widths as padding (the
    // atom's advance spans the flanks, the raster sits inside), and the
    // stroke paints here through the same block-decoration channel a
    // bordered <div> uses — the border box is the raster rect expanded
    // back out by the absorbed widths (b60's cover: two 1px `none solid`
    // flank columns, 850px tall each, were the whole page account).
    if let Some((
        NodePaint::Box {
            paint, border_box, ..
        },
        widths,
    )) = image_border_paints.and_then(|paints| paints.get(source))
    {
        commands.push(DisplayCommand::paint_block(
            rect_value(
                line_x + image.rect.x - widths[3],
                line_y + image.rect.y - widths[0],
                image.rect.width + widths[3] + widths[1],
                image.rect.height + widths[0] + widths[2],
            ),
            paint.clone(),
            border_box.clone(),
        ));
    }
    // A folded SVG viewport keeps its resolved box, and the content
    // letterboxes inside it preserving the intrinsic ratio (SVG 2 §8.6,
    // preserveAspectRatio `meet`); only `none` stretches. The layout box
    // is untouched — this is a paint-rect adjustment.
    let mut draw = image.rect;
    if !*fit_contain {
        // Blink pixel-snaps a plain replaced image's paint rect to whole
        // CSS pixels (probed: an <img> at x=22.25 rasters at 22, at 22.5
        // at 23, bit-identical to a canvas draw at the same integers).
        // SVG-folded content is NOT snapped: it paints through the svg's
        // own transform, and the reference renders it at the fractional
        // position.
        let left = snap_css(line_x + draw.x);
        let top = snap_css(line_y + draw.y);
        let right = snap_css(line_x + draw.x + draw.width);
        let bottom = snap_css(line_y + draw.y + draw.height);
        draw = rito_fragment::FragmentRect {
            x: left - line_x,
            y: top - line_y,
            width: right - left,
            height: bottom - top,
        };
        // Computed `object-fit: contain` (the UA stylesheet's reading-
        // system default, see rito-stylo's ua.rs): the raster letterboxes
        // inside the snapped box, exposing the page ground in the gap —
        // no clamp-bleed slivers, those model SVG viewBox clamp
        // addressing. The box itself, its border and its background keep
        // the author's rect. Guard band, judged on the UNSNAPPED layout
        // box (the snap itself shifts a small box's ratio by up to a
        // pixel per axis): an auto-sized box differs from the raster
        // ratio only by LayoutUnit quantization dust, so skipping those
        // keeps every ratio-true image bit-identical to the plain fill
        // it always painted (the pixel-walk zero books stay zero). Only
        // a box the author forced off the raster ratio letterboxes.
        if *object_fit == rito_style_contract::ObjectFitV1::Contain
            && *intrinsic_width > 0.0
            && *intrinsic_height > 0.0
            && image.rect.width > 0.0
            && image.rect.height > 0.0
            && draw.width > 0.0
            && draw.height > 0.0
        {
            let box_ratio = image.rect.width / image.rect.height;
            let raster_ratio = intrinsic_width / intrinsic_height;
            let skew = (box_ratio / raster_ratio).max(raster_ratio / box_ratio);
            if skew > 1.01 {
                let scale = (draw.width / intrinsic_width).min(draw.height / intrinsic_height);
                let width = intrinsic_width * scale;
                let height = intrinsic_height * scale;
                draw = rito_fragment::FragmentRect {
                    x: draw.x + (draw.width - width) / 2.0,
                    y: draw.y + (draw.height - height) / 2.0,
                    width,
                    height,
                };
            }
        }
    }
    if *fit_contain && *intrinsic_width > 0.0 && *intrinsic_height > 0.0 {
        let contain = |outer: rito_fragment::FragmentRect, ratio_w: f64, ratio_h: f64| {
            let scale = (outer.width / ratio_w).min(outer.height / ratio_h).max(0.0);
            let width = ratio_w * scale;
            let height = ratio_h * scale;
            rito_fragment::FragmentRect {
                x: outer.x + (outer.width - width) / 2.0,
                y: outer.y + (outer.height - height) / 2.0,
                width,
                height,
            }
        };
        // Two-stage placement (SVG 2 §8.6, both `meet`): the viewBox
        // letterboxes into the element rect, then the raster letterboxes
        // inside that content box. Without a viewBox the content box IS
        // the element rect and this collapses to the one-step fit.
        let content = match viewport {
            Some((viewport_width, viewport_height))
                if *viewport_width > 0.0 && *viewport_height > 0.0 =>
            {
                contain(draw, *viewport_width, *viewport_height)
            }
            _ => draw,
        };
        let raster = contain(content, *intrinsic_width, *intrinsic_height);
        // The browser samples the raster with CLAMP addressing across the
        // viewBox CONTENT box: the sliver between the content edge and
        // the raster edge shows the edge texels smeared, not background
        // (measured: a cover whose viewBox out-ratios its JPEG by 0.35px
        // paints one blended edge column per side, uniform down the
        // page). An edge strip stretched across each sliver is exactly
        // that clamp bleed; the element-rect margins outside the content
        // box stay untouched.
        let sliver = |span: f64| span > 1.0 / 64.0;
        // The bleed exists only where a device pixel is PARTIALLY
        // covered by the raster edge: the browser samples with clamp
        // addressing inside that one crossing pixel and shows plain
        // background beyond it (measured: the sub-pixel cover sliver
        // smears one edge column, while b10's 1.19px svg letterbox
        // keeps its whole-row interior background-white — the strip
        // stretched across the full letterbox darkened two full rows
        // per plate against the browser).
        if sliver(raster.x - content.x) {
            let abs_left = line_x + raster.x;
            let abs_right = line_x + raster.x + raster.width;
            let left_start = (line_x + content.x).max(abs_left.floor());
            let right_end = (line_x + content.x + content.width).min(abs_right.ceil());
            for (dest_x, dest_w, src_x) in [
                (left_start, abs_left - left_start, 0.0),
                (abs_right, right_end - abs_right, intrinsic_width - 1.0),
            ] {
                if !sliver(dest_w) {
                    continue;
                }
                commands.push(DisplayCommand::paint_image_slice(
                    src.clone(),
                    rect_value(dest_x, line_y + raster.y, dest_w, raster.height),
                    rect_value(src_x, 0.0, 1.0, *intrinsic_height),
                ));
            }
        }
        if sliver(raster.y - content.y) {
            let abs_top = line_y + raster.y;
            let abs_bottom = line_y + raster.y + raster.height;
            let top_start = (line_y + content.y).max(abs_top.floor());
            let bottom_end = (line_y + content.y + content.height).min(abs_bottom.ceil());
            for (dest_y, dest_h, src_y) in [
                (top_start, abs_top - top_start, 0.0),
                (abs_bottom, bottom_end - abs_bottom, intrinsic_height - 1.0),
            ] {
                if !sliver(dest_h) {
                    continue;
                }
                commands.push(DisplayCommand::paint_image_slice(
                    src.clone(),
                    rect_value(line_x + raster.x, dest_y, raster.width, dest_h),
                    rect_value(0.0, src_y, *intrinsic_width, 1.0),
                ));
            }
        }
        draw = raster;
    }
    // Alt text and the enclosing link ride the command so a host resolves
    // taps (and a decode-failure fallback) against the display list alone.
    commands.push(DisplayCommand::paint_image(
        src.clone(),
        rect_value(line_x + draw.x, line_y + draw.y, draw.width, draw.height),
        item_source.and_then(|source| source.image_alt.clone()),
        item_source.and_then(|source| source.href.clone()),
    ));
    Ok(())
}

/// Builds the typed run paint the renderer consumes from one item's inline
/// style. Paint the command protocol cannot express is approximated —
/// unexpressible effects (transforms, box shadows, background images,
/// partial opacity) drop while the ink itself always paints.
fn run_paint(
    style: &InlineFormattingStyleV1,
    family_policy: Option<&PaintFamilyPolicy>,
    justify_px: f64,
    box_start: bool,
    box_end: bool,
) -> EpubResult<RunPaint> {
    let paint = &style.paint;
    let color = css_color(paint.foreground)?;
    let background = paint.background.resolve(paint.foreground);
    let background_color = if background.alpha().get() == 0.0 {
        None
    } else {
        Some(css_color(background)?)
    };
    let font_size = f64::from(style.font.size.get());
    let text_shadows = paint
        .text_shadows
        .iter()
        .map(|shadow| {
            Ok(TextShadowPaint {
                offset_x: f64::from(shadow.offset_x.get()),
                offset_y: f64::from(shadow.offset_y.get()),
                blur: f64::from(shadow.blur_radius.get()),
                color: css_color(shadow.color.resolve(paint.foreground))?,
            })
        })
        .collect::<EpubResult<Vec<_>>>()?;
    Ok(RunPaint::new(RunPaintData {
        measure: MeasurePaint {
            font: FontPaint {
                // The protocol expresses upright and slanted only; oblique
                // paints as italic, exactly as the canvas font string would
                // coerce it.
                style: match style.font.slant {
                    FontSlant::Normal => FontPaintStyle::NORMAL,
                    FontSlant::Italic | FontSlant::Oblique(_) => FontPaintStyle::ITALIC,
                },
                weight: f64::from(style.font.weight.get()),
                size_px: font_size,
                family: paint_family_stack(style, family_policy)?,
            },
            word_spacing_px: spacing_px(style.text_flow.word_spacing)?,
            // Justification spacing rides the same painter knob as author
            // letter-spacing: the canvas spreads clusters exactly like the
            // DOM's justified shaping does (measured bit-identical).
            letter_spacing_px: match (spacing_px(style.text_flow.letter_spacing)?, justify_px) {
                (author, 0.0) => author,
                (author, justify) => Some(author.unwrap_or(0.0) + justify),
            },
        },
        color,
        background_color,
        // One uniform radius slot, first-shorthand-component convention
        // (same contract as the block materializer): the pen's overlap
        // scale clamps an oversized value to the inline box, so b60's
        // border-radius:50px badge rounds to the circle Blink draws
        // instead of the square the hardcoded None left behind.
        background_radius: match style.fragment.border_radii.top_left.horizontal.value() {
            rito_style_contract::LengthPercentage::Length(value) if value.get() > 0.0 => {
                Some(f64::from(value.get()))
            }
            _ => None,
        },
        text_shadows: Arc::from(text_shadows),
        decoration: run_decoration(style, font_size)?,
        padding: run_box_padding(style, box_start, box_end),
        border: run_box_border(style, box_start, box_end)?,
        box_offsets: None,
        box_edges: (box_start, box_end),
    }))
}

/// Inline box padding for a run's paint, when any side is a positive
/// length. The painter grows the inline box outward from the run rect by
/// these values; percentages have no inline expression and drop to zero.
fn run_box_padding(
    style: &InlineFormattingStyleV1,
    box_start: bool,
    box_end: bool,
) -> Option<crate::layout::RunSpacing> {
    let side = |value: &rito_style_contract::NonNegativeLengthPercentage| match value.value() {
        LengthPercentage::Length(px) => f64::from(px.get()),
        _ => 0.0,
    };
    let padding = &style.fragment.padding;
    let spacing = crate::layout::RunSpacing {
        top: side(&padding.top),
        right: if box_end { side(&padding.right) } else { 0.0 },
        bottom: side(&padding.bottom),
        left: if box_start { side(&padding.left) } else { 0.0 },
    };
    (spacing.top > 0.0 || spacing.right > 0.0 || spacing.bottom > 0.0 || spacing.left > 0.0)
        .then_some(spacing)
}

/// Inline box border edges for a run's paint. Exotic stroke patterns
/// paint solid, exactly as block borders degrade.
fn run_box_border(
    style: &InlineFormattingStyleV1,
    box_start: bool,
    box_end: bool,
) -> EpubResult<Option<crate::layout::RunBorder>> {
    use crate::layout::{BorderEdgePaint, BorderLineStyle, RunBorder, RunBorderEdge};
    use rito_style_contract::BorderStyle;
    let edge = |edge: &rito_style_contract::BorderEdge| -> EpubResult<Option<RunBorderEdge>> {
        let width = f64::from(edge.resolved_width.get());
        if width <= 0.0 || matches!(edge.style, BorderStyle::None | BorderStyle::Hidden) {
            return Ok(None);
        }
        let line = match edge.style {
            BorderStyle::Dotted => BorderLineStyle::DOTTED,
            BorderStyle::Dashed => BorderLineStyle::DASHED,
            _ => BorderLineStyle::SOLID,
        };
        Ok(Some(RunBorderEdge {
            width_px: width,
            paint: BorderEdgePaint {
                color: css_color(edge.color.resolve(style.paint.foreground))?,
                style: line,
            },
        }))
    };
    let border = &style.fragment.border;
    let run = RunBorder {
        top: edge(&border.top)?,
        bottom: edge(&border.bottom)?,
        start: if box_start { edge(&border.left)? } else { None },
        end: if box_end { edge(&border.right)? } else { None },
    };
    Ok(
        (run.top.is_some() || run.bottom.is_some() || run.start.is_some() || run.end.is_some())
            .then_some(run),
    )
}

/// Maps computed text-decoration onto the protocol's single solid stroke.
fn run_decoration(
    style: &InlineFormattingStyleV1,
    font_size: f64,
) -> EpubResult<Option<RunDecoration>> {
    let decoration = &style.paint.text_decoration;
    let lines = decoration.lines;
    if lines.is_empty() {
        return Ok(None);
    }
    if !lines.underline && !lines.line_through {
        // Overline/blink alone have no protocol expression; drop them.
        return Ok(None);
    }
    // Combined lines pick the underline; non-solid strokes draw solid.
    // The underline's top row sits round(size/16) below the painted
    // baseline and its thickness grows as max(1, floor(size/10))
    // (measured against pinned Chromium 2026-08-03, seven sizes with a
    // layout-baseline probe: tops at baseline+1 for 12-20px and
    // baseline+2 for 24/32px, thickness 1/1/1/1/2/2/3 — the earlier
    // "hug the baseline" rule read its baseline reference one row high).
    // The renderer strokes centered on `y`, so the center rides the top
    // offset plus half a thickness below the baseline (rect top +
    // 0.8·size).
    let (kind, y, thickness) = if lines.underline {
        let thickness = (font_size / 10.0).floor().max(1.0);
        let top_offset = (font_size / 16.0).round();
        (
            RunDecorationKind::UNDERLINE,
            CANVAS_TOP_ASCENT_RATIO * font_size + top_offset + thickness / 2.0,
            thickness,
        )
    } else {
        (RunDecorationKind::LINE_THROUGH, font_size * 0.5, 1.0)
    };
    Ok(Some(RunDecoration {
        kind,
        y,
        thickness,
        color: css_color(decoration.color.resolve(style.paint.foreground))?,
    }))
}

/// Spacing is painter-visible (`canvas.letterSpacing`), so only the exact
/// pixel form the whitelist admits reaches here.
fn spacing_px(spacing: LengthPercentage) -> EpubResult<Option<f64>> {
    match spacing {
        LengthPercentage::Length(px) if px.get() != 0.0 => Ok(Some(f64::from(px.get()))),
        // Percentage and calc spacing have no canvas expression; they
        // paint unspaced rather than dropping the run.
        _ => Ok(None),
    }
}

/// The `font-family` string painted for a run: the computed stack as-is
/// without a policy, or the policy's rewrite of it (see
/// Applies the paint family rewrite to a host-metric family key (the
/// comma-joined computed list rito-inline requests metrics under): named
/// families the engine cannot resolve are dropped, the pinned aliases
/// ride ahead of the first generic keyword, and the stack keeps a generic
/// tail. The host must measure line metrics through exactly the faces
/// paint resolves to, or the strut is sized by one font while the glyphs
/// come from another (measured: `serif` struts sized by the browser's
/// Times while SourceHan painted — every body baseline one pixel off).
pub(crate) fn measure_family_stack(family_key: &str, policy: &PaintFamilyPolicy) -> String {
    let is_generic = |name: &str| {
        matches!(
            name,
            "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy" | "system-ui"
        )
    };
    let quoted = |name: &str| format!("\"{}\"", name.replace('\\', "\\\\").replace('"', "\\\""));
    let mut parts: Vec<String> = Vec::new();
    let mut aliases_added = false;
    for raw in family_key
        .split(',')
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        let bare = raw.trim_matches('"');
        let lower = bare.to_ascii_lowercase();
        if is_generic(lower.as_str()) {
            if !aliases_added {
                parts.extend(policy.aliases.iter().map(|alias| quoted(alias)));
                aliases_added = true;
            }
            parts.push(lower);
            continue;
        }
        if !policy.available.contains(&lower) {
            continue;
        }
        parts.push(quoted(bare));
    }
    if !aliases_added {
        parts.extend(policy.aliases.iter().map(|alias| quoted(alias)));
    }
    let has_generic_tail = parts.last().is_some_and(|part| is_generic(part.as_str()));
    if !has_generic_tail {
        parts.push("serif".to_owned());
    }
    parts.join(", ")
}

/// [`PaintFamilyPolicy`]).
fn paint_family_stack(
    style: &InlineFormattingStyleV1,
    family_policy: Option<&PaintFamilyPolicy>,
) -> EpubResult<String> {
    use rito_style_contract::{FontFamily, FontFamilyNameSyntax, GenericFontFamily};
    let Some(policy) = family_policy else {
        return serialize_font_families(&style.font)
            .map_err(|error| not_paintable(&format!("font family list: {error:?}")));
    };
    let generic_keyword = |generic: GenericFontFamily| -> &'static str {
        match generic {
            GenericFontFamily::Serif => "serif",
            GenericFontFamily::SansSerif => "sans-serif",
            GenericFontFamily::Monospace => "monospace",
            GenericFontFamily::Cursive => "cursive",
            GenericFontFamily::Fantasy => "fantasy",
            GenericFontFamily::SystemUi => "system-ui",
        }
    };
    let mut parts: Vec<String> = Vec::new();
    let mut aliases_added = false;
    for family in style.font.families.iter() {
        match family {
            FontFamily::Named(name) => {
                let lower = name.as_str().to_ascii_lowercase();
                // CSS generic keywords ride through even in named form:
                // the canvas needs them as its final fallback exactly as
                // the retained stack carried them, or an unavailable
                // stack drops to the renderer's default sans.
                let generic_keyword_name = matches!(
                    lower.as_str(),
                    "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy" | "system-ui"
                );
                if generic_keyword_name {
                    if !aliases_added {
                        parts.extend(policy.aliases.iter().cloned());
                        aliases_added = true;
                    }
                    parts.push(lower);
                    continue;
                }
                if !policy.available.contains(&lower) {
                    continue;
                }
                parts.push(match name.syntax() {
                    FontFamilyNameSyntax::Quoted => format!(
                        "\"{}\"",
                        name.as_str().replace('\\', "\\\\").replace('"', "\\\"")
                    ),
                    FontFamilyNameSyntax::Identifiers => name.as_str().to_owned(),
                });
            }
            FontFamily::Generic(generic) => {
                if !aliases_added {
                    parts.extend(policy.aliases.iter().cloned());
                    aliases_added = true;
                }
                parts.push(generic_keyword(*generic).to_owned());
            }
        }
    }
    if !aliases_added {
        parts.extend(policy.aliases.iter().cloned());
    }
    // The retained pipeline injected a generic keyword at the stack tail;
    // the canvas needs one too, or an unavailable stack silently drops to
    // the renderer's default sans instead of the book's serif shape.
    let has_generic_tail = parts.last().is_some_and(|part| {
        matches!(
            part.as_str(),
            "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy" | "system-ui"
        )
    });
    if !has_generic_tail {
        parts.push("serif".to_owned());
    }
    Ok(parts.join(", "))
}

fn css_color(color: AbsoluteColor) -> EpubResult<String> {
    absolute_color(color).map_err(|error| not_paintable(&format!("color: {error:?}")))
}

fn not_paintable(what: &str) -> EpubError {
    EpubError::new(format!("{what} is not paintable yet"))
}

#[cfg(test)]
mod tests {
    use super::*;

    use rito_fragment::{
        BoxFragment, FormattingNode, FormattingNodeId, FormattingTreeStyles, FragmentRect,
    };
    use rito_inline::plain_paragraph_style;
    use rito_style_contract::{
        AbsoluteColorSpace, ColorNoneFlags, FontFamilies, FontFamily, FontFamilyName,
        InlineStyleTableV1, LayoutStyleId, LayoutStyleTableV1, StyleId, UnitInterval,
    };

    fn srgb(red: f32, green: f32, blue: f32, alpha: f32) -> AbsoluteColor {
        AbsoluteColor::new(
            AbsoluteColorSpace::Srgb,
            [red, green, blue],
            alpha,
            ColorNoneFlags::new(false, false, false, false),
        )
        .expect("test color is finite")
    }

    fn body_style(foreground: AbsoluteColor) -> InlineFormattingStyleV1 {
        let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
            .expect("family list is non-empty");
        let mut style = plain_paragraph_style(families, 16.0, 0.0);
        style.paint.foreground = foreground;
        style.paint.background = srgb(0.0, 0.0, 0.0, 0.0).into();
        style
    }

    struct FlowFixture {
        tree: FormattingTree,
    }

    /// Two-item flow — "Red " in red then "black." in black — so tests can
    /// exercise per-item paint boundaries inside one line.
    fn two_color_flow(build: impl FnOnce(StyleId, StyleId) -> Vec<InlineItem>) -> FlowFixture {
        let mut inline = InlineStyleTableV1::new(2);
        let red = inline
            .intern_for_node(0, body_style(srgb(1.0, 0.0, 0.0, 1.0)))
            .expect("red style interns");
        let black = inline
            .intern_for_node(1, body_style(srgb(0.0, 0.0, 0.0, 1.0)))
            .expect("black style interns");
        let items = build(red, black);
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("tree builds");
        FlowFixture { tree }
    }

    fn text_item(text: &str, style: StyleId, shift: f64) -> InlineItem {
        InlineItem::Text {
            text: text.to_owned(),
            style,
            baseline_shift_px: shift,
            ruby_annotation: None,
        }
    }

    fn text_run(x: f64, width: f64, start: u32, end: u32) -> Fragment {
        Fragment::Text(TextFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x,
                y: 0.0,
                width,
                height: 0.0,
            },
            text_start: start,
            text_end: end,
            box_snap: None,
            font_grid: None,
            ruby_center_shift_px: 0.0,
            justify_px: 0.0,
            ruby_gap_px: 0.0,
            opener_trim_px: 0.0,
            ruby_overhang_px: 0.0,
            ruby_overhang_right_px: 0.0,
            clusters: Vec::new(),
            cluster_grid: false,
        })
    }

    fn boxed_line(children: Vec<Fragment>) -> Fragment {
        Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 20.0,
            },
            children: vec![Fragment::Line(LineFragment {
                source: FormattingNodeId(0),
                marker: None,
                rect: FragmentRect {
                    x: 4.0,
                    y: 6.0,
                    width: 70.0,
                    height: 20.0,
                },
                baseline: 13.0,
                trailing_whitespace: 0.0,
                ruby_growth: 0.0,
                children,
            })],
        })
    }

    fn paint(tree: &FormattingTree, root: &Fragment) -> Vec<DisplayCommand> {
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            tree,
            root,
            0.0,
            0.0,
            FragmentPaintContext::default(),
        )
        .expect("fragments paint");
        commands
    }

    #[test]
    fn a_transformed_box_wraps_its_subtree_in_a_transform_state() {
        // The rotate wraps the whole subtree: pushState + transform about
        // the border-box center, the content, then popState.
        let fixture = two_color_flow(|red, _| vec![text_item("card", red, 0.0)]);
        let root = boxed_line(vec![text_run(0.0, 30.0, 0, 4)]);
        let mut node_paints = BTreeMap::new();
        node_paints.insert(
            0,
            NodePaint::Box {
                paint: Value::Object(serde_json::Map::new()),
                border_box: None,
                transform: Some(serde_json::json!([{ "kind": "rotate", "rad": 0.05 }])),
                bevels: Vec::new(),
                segment_horizontal_edges: false,
            },
        );
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                image_border_paints: None,
                family_policy: None,
                node_paints: Some(&node_paints),
                list_markers: None,
                ruby_annotation_runs: None,
                vertical_frame: None,
                flow_item_sources: None,
                ratio: 1.0,
            },
        )
        .expect("fragments paint");
        assert!(matches!(commands.first(), Some(DisplayCommand::PushState)));
        let Some(DisplayCommand::Transform {
            origin, transforms, ..
        }) = commands.get(1)
        else {
            panic!("expected a transform command, got {:?}", commands.get(1));
        };
        // Box rect is (10, 20, 100, 20): center (60, 30).
        assert_eq!(origin, &serde_json::json!({ "x": 60, "y": 30 }));
        assert_eq!(
            transforms,
            &serde_json::json!([{ "kind": "rotate", "rad": 0.05 }])
        );
        assert!(matches!(commands.last(), Some(DisplayCommand::PopState)));
        // The empty paint object strokes nothing: no paintBlock between.
        assert!(commands
            .iter()
            .all(|command| !matches!(command, DisplayCommand::PaintBlock { .. })));
        assert!(commands
            .iter()
            .any(|command| matches!(command, DisplayCommand::PaintText(_))));
    }

    /// An outside marker paints from the engine's measurement alone: its
    /// box ends at the item's content edge, its clusters sit at the
    /// measured origins, and the item's inline box paint never reaches
    /// it.
    #[test]
    fn an_outside_marker_paints_its_measured_box_ending_at_the_content_edge() {
        let mut inline = InlineStyleTableV1::new(1);
        let mut item_style = body_style(srgb(0.0, 0.0, 0.0, 1.0));
        item_style.paint.background = srgb(1.0, 1.0, 0.0, 1.0).into();
        let style = inline
            .intern_for_node(0, item_style)
            .expect("item style interns");
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![text_item("item", style, 0.0)],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("tree builds");
        let root = boxed_line(vec![text_run(0.0, 30.0, 0, 4)]);
        let mut markers = BTreeMap::new();
        markers.insert(
            0,
            crate::fragment_bridge::ListMarkerPaint {
                text: "3.".to_owned(),
                style,
                run: Some(rito_inline::MeasuredRun {
                    advance: 16.0,
                    clusters: vec![
                        rito_fragment::ClusterPosition { byte: 0, x: 0.0 },
                        rito_fragment::ClusterPosition { byte: 1, x: 8.0 },
                        rito_fragment::ClusterPosition { byte: 2, x: 12.0 },
                    ],
                    grid: false,
                }),
            },
        );
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                list_markers: Some(&markers),
                ruby_annotation_runs: None,
                ..FragmentPaintContext::default()
            },
        )
        .expect("fragments paint");
        let texts: Vec<&DisplayTextCommandInput> = commands
            .iter()
            .filter_map(|command| match command {
                DisplayCommand::PaintText(input) => Some(input),
                _ => None,
            })
            .collect();
        assert_eq!(texts.len(), 2, "the marker and the item's text");
        let marker = texts[0];
        assert_eq!(
            marker.text,
            Value::String("3. ".to_owned()),
            "the marker paints before the item, with its trailing space"
        );
        // The item box starts at x = 10: the 16px marker box ends there.
        assert_eq!(marker.rect["x"].as_f64(), Some(-6.0));
        assert_eq!(marker.rect["width"].as_f64(), Some(16.0));
        // The item's painted baseline: line top 26 plus baseline 13.
        assert_eq!(
            marker.clusters,
            vec![(0, -6.0, 39.0), (1, 2.0, 39.0), (2, 6.0, 39.0)]
        );
        assert!(
            !marker.paint.has_box_paint() && marker.paint.decoration().is_none(),
            "the item's background band stays off the marker"
        );
        assert!(
            texts[1].paint.has_box_paint(),
            "the item's own text keeps its inline box"
        );
    }

    /// A vertical-rl page fragment for the paint-parity instrument: one
    /// column of ideographs with rotated brackets and corner-shifted
    /// marks, a rubied base, and a second column of leaders, a dash and
    /// Latin at a letter-spaced style.
    fn vertical_column_commands() -> Vec<DisplayCommand> {
        let mut inline = InlineStyleTableV1::new(3);
        let black = inline
            .intern_for_node(0, body_style(srgb(0.0, 0.0, 0.0, 1.0)))
            .expect("black style interns");
        let red = inline
            .intern_for_node(1, body_style(srgb(0.8, 0.0, 0.0, 1.0)))
            .expect("red style interns");
        let mut spaced = body_style(srgb(0.0, 0.0, 0.5, 1.0));
        spaced.text_flow.letter_spacing = rito_style_contract::LengthPercentage::Length(
            rito_style_contract::CssPx::new(2.0).expect("finite spacing"),
        );
        let spaced = inline
            .intern_for_node(2, spaced)
            .expect("spaced style interns");
        let items = vec![
            text_item("「春日」、剧场。", black, 0.0),
            InlineItem::Text {
                text: "漢字".to_owned(),
                style: red,
                baseline_shift_px: 0.0,
                ruby_annotation: Some(rito_fragment::RubyAnnotation {
                    text: "かんじ".to_owned(),
                    size_ratio: 0.5,
                    align: rito_style_contract::RubyAlign::SpaceAround,
                }),
            },
            text_item("…—ab", spaced, 0.0),
        ];
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow { items },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("tree builds");
        let line = |block: f64, thickness: f64, growth: f64, length: f64, runs: Vec<Fragment>| {
            Fragment::Line(LineFragment {
                source: FormattingNodeId(0),
                marker: None,
                rect: FragmentRect {
                    x: 0.0,
                    y: block,
                    width: length,
                    height: thickness,
                },
                baseline: 13.0,
                trailing_whitespace: 0.0,
                ruby_growth: growth,
                children: runs,
            })
        };
        let root = Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 60.0,
            },
            children: vec![
                line(
                    0.0,
                    24.0,
                    8.0,
                    160.0,
                    vec![text_run(0.0, 128.0, 0, 24), text_run(128.0, 32.0, 24, 30)],
                ),
                line(32.0, 20.0, 0.0, 72.0, vec![text_run(0.0, 72.0, 30, 38)]),
            ],
        });
        // The annotation measured when the chapter was built: the
        // style's primary face is Tinos, whose 8px typo ascent puts the
        // em-box top 6.09375px over the baseline (1420/1862 × 8 on the
        // grid) — the browser's canvas resolves a top anchor from the
        // font string's first face even where the kana fall back.
        let mut ruby_runs = BTreeMap::new();
        ruby_runs.insert(
            (0, 1),
            rito_inline::MeasuredRuby {
                run: rito_inline::MeasuredRun {
                    advance: 24.0,
                    clusters: vec![
                        rito_fragment::ClusterPosition { byte: 0, x: 0.0 },
                        rito_fragment::ClusterPosition { byte: 3, x: 8.0 },
                        rito_fragment::ClusterPosition { byte: 6, x: 16.0 },
                    ],
                    grid: false,
                },
                over_offset: 16.0,
                em_ascent: 6.09375,
            },
        );
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                vertical_frame: Some((220.0, 20.0)),
                ruby_annotation_runs: Some(&ruby_runs),
                ..FragmentPaintContext::default()
            },
        )
        .expect("the column paints");
        commands
    }

    /// Writes the paint-parity fixture for a vertical column from this
    /// painter's own output, so the instrument's browser lane holds the
    /// reference every change to the column laws is verified against.
    /// Run by hand when the column laws change:
    /// `cargo test -p rito-core --lib write_vertical_paint_parity_fixture -- --ignored`.
    #[test]
    #[ignore = "regenerates tools/paint-parity/fixtures/text-vertical.json"]
    fn write_vertical_paint_parity_fixture() {
        let commands = vertical_column_commands();
        let fixture = serde_json::json!({
            "name": "text-vertical",
            "width": 240,
            "height": 320,
            "background": "#ffffff",
            "commands": crate::render::display_command_values(&commands),
        });
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tools/paint-parity/fixtures/text-vertical.json"
        );
        std::fs::write(
            path,
            serde_json::to_string_pretty(&fixture).expect("fixture is JSON") + "\n",
        )
        .expect("fixture writes");
    }

    /// The vertical column paints glyph by glyph: upright glyphs share a
    /// run with an origin each one step down the column, corner marks
    /// shift into the em's top-right, rotated marks paint as their own
    /// run under a quarter-turn transform, and the annotation spreads
    /// its glyphs down the base span.
    #[test]
    fn a_vertical_column_places_every_glyph_and_rotates_its_marks() {
        let commands = vertical_column_commands();
        let texts: Vec<&DisplayTextCommandInput> = commands
            .iter()
            .filter_map(|command| match command {
                DisplayCommand::PaintText(input) => Some(input),
                _ => None,
            })
            .collect();
        let origins = |actual: &[(u32, f64, f64)], expected: &[(u32, f64, f64)]| {
            assert_eq!(actual.len(), expected.len(), "{actual:?} vs {expected:?}");
            for (a, e) in actual.iter().zip(expected) {
                assert!(
                    a.0 == e.0 && (a.1 - e.1).abs() < 1e-9 && (a.2 - e.2).abs() < 1e-9,
                    "{actual:?} vs {expected:?}"
                );
            }
        };
        // 「 | 春日 | 」 | 、剧场。 | 漢字 | … | — | ab
        assert_eq!(texts.len(), 8, "{texts:#?}");
        let transforms = commands
            .iter()
            .filter(|command| matches!(command, DisplayCommand::Transform { .. }))
            .count();
        assert_eq!(transforms, 4, "one quarter turn per rotated mark");
        assert!(texts.iter().all(|text| !text.clusters.is_empty()));
        // The first column's glyphs sit at x 196 (frame right 220 minus
        // the 24px line thickness), stepping 16px from the column top 20
        // with baselines 0.8 em below each glyph top.
        assert_eq!(texts[0].text, Value::String("「".to_owned()));
        origins(&texts[0].clusters, &[(0, 196.0, 32.8)]);
        let DisplayCommand::Transform {
            origin, transforms, ..
        } = &commands[1]
        else {
            panic!(
                "the rotated mark paints under a transform, got {:?}",
                commands[1]
            );
        };
        assert_eq!(
            (origin["x"].as_f64(), origin["y"].as_f64()),
            (Some(204.0), Some(28.0))
        );
        assert_eq!(
            transforms,
            &serde_json::json!([{ "kind": "rotate", "rad": std::f64::consts::FRAC_PI_2 }])
        );
        assert_eq!(texts[1].text, Value::String("春日".to_owned()));
        origins(&texts[1].clusters, &[(0, 196.0, 48.8), (3, 196.0, 64.8)]);
        assert_eq!(texts[3].text, Value::String("、剧场。".to_owned()));
        // 、 and 。 ride the em's top-right corner; 剧场 stay upright.
        origins(
            &texts[3].clusters,
            &[
                (0, 204.0, 87.2),
                (3, 196.0, 112.8),
                (6, 196.0, 128.8),
                (9, 204.0, 135.2),
            ],
        );
        // The letter-spaced second column steps 18px.
        assert_eq!(texts[7].text, Value::String("ab".to_owned()));
        origins(&texts[7].clusters, &[(0, 170.0, 68.8), (1, 170.0, 86.8)]);
        let annotation = commands
            .iter()
            .find_map(|command| match command {
                DisplayCommand::PaintRuby(input) => Some(input),
                _ => None,
            })
            .expect("the rubied base paints its annotation");
        // Three 8px kana down the 32px base span: 8px free, one share
        // (8/3) per glyph, half a share at each edge, every glyph's
        // baseline its em-box ascent below its top.
        let ys: Vec<f64> = annotation.clusters.iter().map(|(_, _, y)| *y).collect();
        for (y, expected) in ys.iter().zip([
            148.0 + 4.0 / 3.0 + 6.09375,
            160.0 + 6.09375,
            172.0 - 4.0 / 3.0 + 6.09375,
        ]) {
            assert!((y - expected).abs() < 1e-9, "{ys:?}");
        }
        assert!(annotation.clusters.iter().all(|(_, x, _)| *x == 212.0));
    }

    /// A run's rect ends where the browser's item fragment ends: the
    /// item's start plus its shaped width ceiled onto the 1/64 grid, so
    /// the inline box band and the decoration line end on that edge,
    /// while a run inside the item keeps its float advance.
    #[test]
    fn the_run_closing_an_item_ends_on_the_layout_grid() {
        let fixture = two_color_flow(|red, black| {
            vec![
                text_item("Hello world", red, 0.0),
                text_item("black.", black, 0.0),
            ]
        });
        // One item shaped as two runs (0..5, 5..11), then a second item.
        let root = boxed_line(vec![
            text_run(0.0, 30.31, 0, 5),
            text_run(30.31, 20.2, 5, 11),
            text_run(50.51, 20.2, 11, 17),
        ]);
        let commands = paint(&fixture.tree, &root);
        let widths: Vec<f64> = commands
            .iter()
            .filter_map(|command| match command {
                DisplayCommand::PaintText(input) => input.rect["width"].as_f64(),
                _ => None,
            })
            .collect();
        assert_eq!(widths.len(), 3);
        assert!((widths[0] - 30.31).abs() < 1e-9, "{widths:?}");
        // 50.51 ceils to 3233/64 = 50.515625; the closing run takes the rest.
        assert!((widths[1] - (50.515625 - 30.31)).abs() < 1e-9, "{widths:?}");
        assert!((widths[2] - 20.203125).abs() < 1e-9, "{widths:?}");
    }

    #[test]
    fn adjacent_items_paint_with_their_own_styles() {
        let fixture = two_color_flow(|red, black| {
            vec![text_item("Red ", red, 0.0), text_item("black.", black, 0.0)]
        });
        let root = boxed_line(vec![text_run(0.0, 30.0, 0, 4), text_run(30.0, 40.0, 4, 10)]);
        let commands = paint(&fixture.tree, &root);
        assert_eq!(commands.len(), 2);
        let DisplayCommand::PaintText(first) = &commands[0] else {
            panic!("expected a text command, got {:?}", commands[0]);
        };
        assert_eq!(first.text, Value::String("Red ".to_owned()));
        assert_eq!(first.paint.color(), "#ff0000");
        assert_eq!(first.paint.measure().font.family, "Tinos");
        // Line top is 20 + 6 = 26; the paint rect starts one canvas-'top'
        // ascent (0.8 × 16px) above the 13px baseline.
        assert_eq!(first.rect, rect_value(14.0, 26.2, 30.0, 16.0));
        assert_eq!(first.line_height_px, Some(number_value(20.0)));
        let DisplayCommand::PaintText(second) = &commands[1] else {
            panic!("expected a text command, got {:?}", commands[1]);
        };
        assert_eq!(second.text, Value::String("black.".to_owned()));
        assert_eq!(second.paint.color(), "#000000");
        assert_eq!(second.rect, rect_value(44.0, 26.2, 40.0, 16.0));
    }

    #[test]
    fn baseline_shift_raises_the_paint_anchor() {
        let fixture = two_color_flow(|red, _| vec![text_item("2", red, 4.0)]);
        let root = boxed_line(vec![text_run(0.0, 8.0, 0, 1)]);
        let commands = paint(&fixture.tree, &root);
        let DisplayCommand::PaintText(command) = &commands[0] else {
            panic!("expected a text command, got {:?}", commands[0]);
        };
        assert_eq!(command.rect, rect_value(14.0, 22.2, 8.0, 16.0));
    }

    #[test]
    fn a_baseline_rounds_the_line_top_on_css_pixels_and_the_sum_on_the_device_grid() {
        // A 64-phase sweep of the line top with a fractional within-line
        // baseline (a raised marker's line), painted at 2×: the line top
        // rounds to a whole CSS pixel, the baseline adds, and the sum
        // rounds once on the device grid. Rounding the line top on the
        // device grid instead lands half the phases one device row off.
        let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
        let within_line = 13.71875;
        let mut device_two_stage_disagreements = 0;
        for phase in 0..64 {
            let line_top = 26.0 + f64::from(phase) / 64.0;
            let root = Fragment::Box(BoxFragment {
                source: FormattingNodeId(0),
                rect: FragmentRect {
                    x: 10.0,
                    y: 20.0,
                    width: 100.0,
                    height: 40.0,
                },
                children: vec![Fragment::Line(LineFragment {
                    source: FormattingNodeId(0),
                    marker: None,
                    rect: FragmentRect {
                        x: 4.0,
                        y: line_top - 20.0,
                        width: 70.0,
                        height: 20.0,
                    },
                    baseline: within_line,
                    trailing_whitespace: 0.0,
                    ruby_growth: 0.0,
                    children: vec![text_run(0.0, 8.0, 0, 1)],
                })],
            });
            let mut commands = Vec::new();
            append_fragment_display_commands(
                &mut commands,
                &fixture.tree,
                &root,
                0.0,
                0.0,
                FragmentPaintContext {
                    ratio: 2.0,
                    ..FragmentPaintContext::default()
                },
            )
            .expect("fragments paint");
            let DisplayCommand::PaintText(command) = &commands[0] else {
                panic!("expected a text command, got {:?}", commands[0]);
            };
            let painted = command.rect["y"].as_f64().expect("rect y") + 0.8 * 16.0;
            let expected = ((line_top.round() + within_line) * 2.0).round() / 2.0;
            assert!(
                (painted - expected).abs() < 1e-9,
                "phase {phase}/64: painted {painted}, expected {expected}"
            );
            let device_two_stage =
                (line_top * 2.0).round() / 2.0 + (within_line * 2.0).round() / 2.0;
            if (device_two_stage - expected).abs() > 1e-9 {
                device_two_stage_disagreements += 1;
            }
        }
        assert_eq!(device_two_stage_disagreements, 32);
    }

    #[test]
    fn rule_paints_stroke_across_its_sized_box() {
        let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
        let rule = Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 3.0,
                y: 7.0,
                width: 90.0,
                height: 2.0,
            },
            children: Vec::new(),
        });
        let root = Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 30.0,
            },
            children: vec![rule],
        });
        let mut paints = std::collections::BTreeMap::new();
        paints.insert(
            0u32,
            NodePaint::Rule {
                color: "#445566".to_owned(),
                style: "solid",
                thickness: 2.0,
            },
        );
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                image_border_paints: None,
                family_policy: None,
                node_paints: Some(&paints),
                list_markers: None,
                ruby_annotation_runs: None,
                vertical_frame: None,
                flow_item_sources: None,
                ratio: 1.0,
            },
        )
        .expect("rule paints");
        // Both boxes share source node 0 in this fixture, so the outer box
        // also strokes; the inner rule is the second command.
        let DisplayCommand::PaintHorizontalRule { rect, paint } = &commands[1] else {
            panic!("expected a rule command, got {:?}", commands[1]);
        };
        assert_eq!(*rect, rect_value(13.0, 27.0, 90.0, 2.0));
        assert_eq!(paint["color"], "#445566");
        assert_eq!(paint["style"], "solid");
    }

    /// An inset rule is the browser's fixed two-tone bevel closed on all
    /// four sides: it paints as one border box — dark top and left, light
    /// bottom and right — so the border lowering miters the corners where
    /// the tones meet.
    #[test]
    fn an_inset_rule_paints_as_a_two_tone_border_box() {
        let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
        let rule = Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 3.0,
                y: 7.0,
                width: 90.0,
                height: 2.0,
            },
            children: Vec::new(),
        });
        let root = Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 30.0,
            },
            children: vec![rule],
        });
        let mut paints = std::collections::BTreeMap::new();
        paints.insert(
            0u32,
            NodePaint::Rule {
                color: "#808080".to_owned(),
                style: "inset",
                thickness: 1.0,
            },
        );
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                node_paints: Some(&paints),
                ..FragmentPaintContext::default()
            },
        )
        .expect("rule paints");
        // Both boxes share source node 0 in this fixture, so the outer box
        // paints first; the rule is the second command.
        let DisplayCommand::PaintBlock {
            rect,
            paint,
            border_box,
        } = &commands[1]
        else {
            panic!("expected a block command, got {:?}", commands[1]);
        };
        assert_eq!(*rect, rect_value(13.0, 27.0, 90.0, 2.0));
        for (side, color) in [
            ("top", "#9a9a9a"),
            ("left", "#9a9a9a"),
            ("bottom", "#eeeeee"),
            ("right", "#eeeeee"),
        ] {
            assert_eq!(paint["border"][side]["color"], color, "{side}");
            assert_eq!(paint["border"][side]["style"], "solid", "{side}");
        }
        let widths = border_box.as_ref().expect("border widths");
        for key in ["topWidth", "rightWidth", "bottomWidth", "leftWidth"] {
            assert_eq!(widths[key].as_f64(), Some(1.0), "{key}");
        }
    }

    #[test]
    fn the_family_policy_drops_unresolvable_families_and_appends_aliases() {
        let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
        let root = boxed_line(vec![text_run(0.0, 8.0, 0, 1)]);
        let policy = PaintFamilyPolicy {
            available: ["tinos".to_owned()].into_iter().collect(),
            aliases: vec!["__RitoPinned_test".to_owned()],
        };
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                image_border_paints: None,
                family_policy: Some(&policy),
                node_paints: None,
                list_markers: None,
                ruby_annotation_runs: None,
                vertical_frame: None,
                flow_item_sources: None,
                ratio: 1.0,
            },
        )
        .expect("fragments paint");
        let DisplayCommand::PaintText(command) = &commands[0] else {
            panic!("expected a text command, got {:?}", commands[0]);
        };
        // The fixture stack is just "Tinos" with no generic, so the alias
        // lands after it and the injected generic closes the stack; a
        // host-only family would have been dropped.
        assert_eq!(
            command.paint.measure().font.family,
            "Tinos, __RitoPinned_test, serif"
        );
    }

    #[test]
    fn ruby_bases_paint_their_annotation_above_the_run() {
        let fixture = two_color_flow(|red, _| {
            vec![InlineItem::Text {
                text: "漢字".to_owned(),
                style: red,
                baseline_shift_px: 0.0,
                ruby_annotation: Some(rito_fragment::RubyAnnotation {
                    text: "かんじ".to_owned(),
                    size_ratio: 0.5,
                    align: rito_style_contract::RubyAlign::SpaceAround,
                }),
            }]
        });
        let root = boxed_line(vec![text_run(0.0, 32.0, 0, 6)]);
        // Shaped when the chapter was built: three 8px kana, packed, the
        // annotation line measured 16px over the base's baseline.
        let mut ruby_runs = BTreeMap::new();
        ruby_runs.insert(
            (0, 0),
            rito_inline::MeasuredRuby {
                run: rito_inline::MeasuredRun {
                    advance: 24.0,
                    clusters: vec![
                        rito_fragment::ClusterPosition { byte: 0, x: 0.0 },
                        rito_fragment::ClusterPosition { byte: 3, x: 8.0 },
                        rito_fragment::ClusterPosition { byte: 6, x: 16.0 },
                    ],
                    grid: false,
                },
                over_offset: 16.0,
                em_ascent: 7.046875,
            },
        );
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                ruby_annotation_runs: Some(&ruby_runs),
                ..FragmentPaintContext::default()
            },
        )
        .expect("fragments paint");
        assert_eq!(commands.len(), 2);
        let DisplayCommand::PaintRuby(annotation) = &commands[0] else {
            panic!("annotation paints before its base, got {:?}", commands[0]);
        };
        assert_eq!(annotation.text, Value::String("かんじ".to_owned()));
        // space-around over the 32px base: 8px of slack, two
        // opportunities — an inset of slack/3 on the layout grid, half at
        // each edge, the rest in the two gaps.
        let origins: Vec<f64> = annotation.clusters.iter().map(|(_, x, _)| *x).collect();
        assert!(
            annotation.clusters.iter().all(|(_, _, y)| *y == 23.0),
            "every origin sits on the annotation's baseline, 16px over the base's (39)"
        );
        assert_eq!(
            annotation
                .clusters
                .iter()
                .map(|(byte, _, _)| *byte)
                .collect::<Vec<_>>(),
            vec![0, 3, 6]
        );
        let inset = (8.0_f64 / 3.0 * 64.0).trunc() / 64.0;
        let edge = (inset / 2.0 * 64.0).trunc() / 64.0;
        let gap = (8.0 - inset) / 2.0;
        for (origin, expected) in origins.iter().zip([
            14.0 + edge,
            14.0 + edge + 8.0 + gap,
            14.0 + edge + 16.0 + 2.0 * gap,
        ]) {
            assert!((origin - expected).abs() < 1e-9, "{origins:?}");
        }
        // The base anchors at 26.2 (line top 26 + baseline 13 − 0.8 × 16);
        // the 8px annotation's rect starts 0.8 em above its baseline and
        // spans the base run's extent.
        assert_eq!(annotation.rect, rect_value(14.0, 16.6, 32.0, 8.0));
        assert_eq!(annotation.paint.measure().font.size_px, 8.0);
        assert_eq!(annotation.paint.color(), "#ff0000");
        let DisplayCommand::PaintText(base) = &commands[1] else {
            panic!("expected the base text command, got {:?}", commands[1]);
        };
        assert_eq!(base.text, Value::String("漢字".to_owned()));
        assert_eq!(base.rect, rect_value(14.0, 26.2, 32.0, 16.0));
    }

    #[test]
    fn a_ruby_annotation_distributes_over_the_column_extent_on_the_layout_grid() {
        let fixture = two_color_flow(|red, _| {
            vec![InlineItem::Text {
                text: "漢字".to_owned(),
                style: red,
                baseline_shift_px: 0.0,
                ruby_annotation: Some(rito_fragment::RubyAnnotation {
                    text: "かん".to_owned(),
                    size_ratio: 0.5,
                    align: rito_style_contract::RubyAlign::SpaceAround,
                }),
            }]
        });
        // The base's laid-out width carries float dust below the grid
        // point (justified shares summed in single precision); the
        // browser's column is the width ceiled onto 1/64.
        let root = boxed_line(vec![text_run(0.0, 31.99, 0, 6)]);
        let mut ruby_runs = BTreeMap::new();
        ruby_runs.insert(
            (0, 0),
            rito_inline::MeasuredRuby {
                run: rito_inline::MeasuredRun {
                    advance: 16.0,
                    clusters: vec![
                        rito_fragment::ClusterPosition { byte: 0, x: 0.0 },
                        rito_fragment::ClusterPosition { byte: 3, x: 8.0 },
                    ],
                    grid: false,
                },
                over_offset: 16.0,
                em_ascent: 7.046875,
            },
        );
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                ruby_annotation_runs: Some(&ruby_runs),
                ..FragmentPaintContext::default()
            },
        )
        .expect("fragments paint");
        let DisplayCommand::PaintRuby(annotation) = &commands[0] else {
            panic!("annotation paints before its base, got {:?}", commands[0]);
        };
        // Over the 32px column: 16px of slack, one opportunity — an inset
        // of half the slack, a quarter at each edge, the other half in
        // the gap. The raw 31.99 would have truncated the inset to
        // 7.984375 and the edge to 3.984375.
        let origins: Vec<f64> = annotation.clusters.iter().map(|(_, x, _)| *x).collect();
        assert_eq!(origins, vec![18.0, 34.0]);
        assert_eq!(annotation.rect, rect_value(14.0, 16.6, 32.0, 8.0));
    }

    fn painted_image_rect(
        intrinsic_width: f64,
        intrinsic_height: f64,
        object_fit: rito_style_contract::ObjectFitV1,
    ) -> Value {
        use rito_style_contract::{
            AlignItemsV1, BoxSizingV1, ClearV1, CssPx, FloatV1, JustifyContentV1,
            LayoutDisplayInsideV1, LayoutDisplayOutsideV1, LayoutDisplayV1,
            LayoutFormattingStyleV1, LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1,
            MaximumSizeV1, MinimumHeightV1, NonNegativeLengthPercentage, OverflowV1, PageBreakV1,
            PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let mut inline = InlineStyleTableV1::new(1);
        let text_style = inline
            .intern_for_node(0, body_style(srgb(0.0, 0.0, 0.0, 1.0)))
            .expect("style interns");
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero length"),
        ));
        let sides = |value| PhysicalSides {
            top: value,
            right: value,
            bottom: value,
            left: value,
        };
        let mut layout = LayoutStyleTableV1::new(1);
        let image_layout = layout
            .intern_for_node(
                0,
                LayoutFormattingStyleV1 {
                    display: LayoutDisplayV1 {
                        outside: LayoutDisplayOutsideV1::Inline,
                        inside: LayoutDisplayInsideV1::Flow,
                        is_list_item: false,
                    },
                    margin: sides(LengthPercentageOrAuto::Auto),
                    padding: PhysicalSides {
                        top: zero_padding,
                        right: zero_padding,
                        bottom: zero_padding,
                        left: zero_padding,
                    },
                    box_sizing: BoxSizingV1::ContentBox,
                    justify_content: JustifyContentV1::Normal,
                    align_items: AlignItemsV1::Normal,
                    break_before: PageBreakV1::Auto,
                    break_after: PageBreakV1::Auto,
                    width: PreferredSizeV1::Auto,
                    height: PreferredSizeV1::Auto,
                    max_width: MaximumSizeV1::None,
                    min_height: MinimumHeightV1::Auto,
                    max_height: MaximumHeightV1::None,
                    clear: ClearV1::None,
                    float: FloatV1::None,
                    overflow: OverflowV1::Visible,
                    list_style_type: ListMarkerStyleV1::None,
                    position: PositionV1::Static,
                    inset: sides(LengthPercentageOrAuto::Auto),
                    vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
                    border_spacing: (
                        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                    ),
                    border_collapse: false,
                    object_fit: rito_style_contract::ObjectFitV1::Fill,
                },
            )
            .expect("layout style interns");
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Image {
                    source: 0,
                    src: "images/portrait.png".to_owned(),
                    intrinsic_width,
                    intrinsic_height,
                    style: text_style,
                    layout_style: image_layout,
                    fit_contain: false,
                    viewport: None,
                    baseline_shift_px: 0.0,
                    align_top: false,
                    object_fit,
                }],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let root = boxed_line(vec![Fragment::Image(ImageFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 5.0,
                y: 2.0,
                width: 40.0,
                height: 30.0,
            },
            item_index: 0,
        })]);
        let commands = paint(&tree, &root);
        assert_eq!(commands.len(), 1);
        let DisplayCommand::PaintImage { src, rect, .. } = &commands[0] else {
            panic!("expected an image command, got {:?}", commands[0]);
        };
        assert_eq!(src, "images/portrait.png");
        rect.clone()
    }

    #[test]
    fn images_paint_with_their_source_reference() {
        use rito_style_contract::ObjectFitV1;
        assert_eq!(
            painted_image_rect(40.0, 30.0, ObjectFitV1::Fill),
            rect_value(19.0, 28.0, 40.0, 30.0)
        );
    }

    #[test]
    fn a_ratio_true_box_paints_identically_under_object_fit_contain() {
        use rito_style_contract::ObjectFitV1;
        // The guard band: contain equals fill when the box already has
        // the raster ratio, bit for bit.
        assert_eq!(
            painted_image_rect(40.0, 30.0, ObjectFitV1::Contain),
            rect_value(19.0, 28.0, 40.0, 30.0)
        );
    }

    #[test]
    fn an_author_box_off_the_raster_ratio_letterboxes_under_contain() {
        use rito_style_contract::ObjectFitV1;
        // A portrait 30x40 raster inside the landscape 40x30 box scales
        // by 0.75 to 22.5x30, centered on the inline axis; the box (and
        // its border and background) keeps the author's rect.
        assert_eq!(
            painted_image_rect(30.0, 40.0, ObjectFitV1::Contain),
            rect_value(27.75, 28.0, 22.5, 30.0)
        );
    }

    #[test]
    fn a_text_run_crossing_item_boundaries_fails_closed() {
        let fixture = two_color_flow(|red, black| {
            vec![text_item("Red ", red, 0.0), text_item("black.", black, 0.0)]
        });
        let root = boxed_line(vec![text_run(0.0, 60.0, 2, 8)]);
        let mut commands = Vec::new();
        let error = append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext::default(),
        )
        .expect_err("a run straddling two items must not paint");
        assert!(
            error
                .to_string()
                .contains("do not lie inside one inline item"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn unexpressible_pure_paint_approximates_and_still_inks() {
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = body_style(srgb(0.0, 0.0, 0.0, 1.0));
        style.paint.opacity = UnitInterval::new(0.5).expect("opacity is bounded");
        let translucent = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![text_item("dim", translucent, 0.0)],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("tree builds");
        let root = boxed_line(vec![text_run(0.0, 20.0, 0, 3)]);
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext::default(),
        )
        .expect("translucent text approximates to opaque ink");
        assert!(
            commands
                .iter()
                .any(|command| matches!(command, DisplayCommand::PaintText(_))),
            "the run still paints"
        );
    }
}
