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
use crate::fragment_bridge::NodePaint;
use crate::layout::{
    FontPaint, FontPaintStyle, MeasurePaint, RunDecoration, RunDecorationKind, RunPaint,
    RunPaintData, TextShadowPaint,
};
use crate::render::{DisplayCommand, DisplayTextCommandInput, RubyAlignPaint};
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
#[derive(Clone, Copy, Default)]
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
                // The browser snaps a transformed subtree's LAYER to the
                // device grid: a rotated card at a fractional block
                // offset renders bit-identically to the same card at the
                // rounded offset (probed — DOM output at y .0 and y .48
                // matched column for column). The rigid device-space
                // shift to that rounded position is a translate composed
                // BEFORE the author transforms, in the un-rotated frame.
                let box_x = origin_x + fragment.rect.x;
                let box_y = origin_y + fragment.rect.y;
                let (snap_dx, snap_dy) = (box_x.round() - box_x, box_y.round() - box_y);
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
                        // stroke, whatever the border color (measured).
                        let thickness = thickness.min(fragment.rect.height);
                        if style == &"inset" {
                            commands.push(DisplayCommand::paint_horizontal_rule(
                                rect_value(
                                    origin_x + fragment.rect.x,
                                    origin_y + fragment.rect.y,
                                    fragment.rect.width,
                                    thickness,
                                ),
                                serde_json::json!({ "color": "#9a9a9a", "style": "solid" }),
                            ));
                            commands.push(DisplayCommand::paint_horizontal_rule(
                                rect_value(
                                    origin_x + fragment.rect.x,
                                    origin_y + fragment.rect.y + fragment.rect.height
                                        - thickness,
                                    fragment.rect.width,
                                    thickness,
                                ),
                                serde_json::json!({ "color": "#eeeeee", "style": "solid" }),
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
                        ..
                    } => {
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
                                // The strips ride the same device-pixel
                                // edges the border strokes snap to.
                                let left_edge = (origin_x + fragment.rect.x).round();
                                let top_edge = (origin_y + fragment.rect.y).round();
                                let right_edge =
                                    (origin_x + fragment.rect.x + fragment.rect.width).round();
                                let bottom_edge =
                                    (origin_y + fragment.rect.y + fragment.rect.height).round();
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
                                    _ => (x + left / 2.0, y + top, left / 2.0, height - top - bottom),
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
            for child in &fragment.children {
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
            snap_origin_y,
        ),
        Fragment::Text(_) | Fragment::Image(_) => Err(EpubError::new(
            "text and image fragments paint through their line box, not standalone",
        )),
    }
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
    snap_origin_y: f64,
) -> EpubResult<()> {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(line.source).content else {
        return Err(EpubError::new("line fragment source is not an inline flow"));
    };
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
    for child in &line.children {
        match child {
            Fragment::Text(run) => {
                append_text_run_command(
                    commands,
                    items,
                    styles,
                    &full_text,
                    &text_ranges,
                    line,
                    run,
                    line_x,
                    line_y,
                    family_policy,
                    snap_origin_y,
                )?;
            }
            Fragment::Image(image) => {
                append_image_command(commands, items, image, line_x, line_y, image_border_paints)?;
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
                        snap_origin_y,
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
    line: &LineFragment,
    run: &TextFragment,
    line_x: f64,
    line_y: f64,
    family_policy: Option<&PaintFamilyPolicy>,
    snap_origin_y: f64,
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
        .map(|(range, index)| (range, index))
        .unwrap_or((start..end, 0));
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
    // matrix): the line box top rounds to a device row, and the run's
    // within-line baseline rounds on top of it. Canvas 'alphabetic'
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
    // to a device row, the top border+padding edge rounds within it, and
    // the baseline hangs the primary font's integer ascent below. The
    // box's snapped extent rides the paint so the painter strokes the
    // decoration on those exact rows. For an undecorated run the formula
    // would collapse to the line-box snap (integer ascent and integer
    // within-line baseline commute with the round), so bare text keeps
    // the two-stage path verbatim.
    let baseline = match &run.box_snap {
        Some(snap) => {
            let layout_baseline = line_y + line.baseline - baseline_shift_px;
            let box_top = layout_baseline - snap.int_ascent - snap.edge_top;
            let box_bottom = layout_baseline + snap.int_descent + snap.edge_bottom;
            let painted_top = snap_origin_y + (box_top - snap_origin_y).round();
            let painted_bottom = snap_origin_y + (box_bottom - snap_origin_y).round();
            let baseline = painted_top + snap.edge_top.round() + snap.int_ascent;
            let em_top = baseline - CANVAS_TOP_ASCENT_RATIO * font_size;
            paint.set_box_offsets(painted_top - em_top, painted_bottom - em_top);
            baseline
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
            snap_origin_y
                + (line_y + line.ruby_growth - snap_origin_y).round()
                + (line.baseline - baseline_shift_px - line.ruby_growth).round()
        }
    };
    let em_top = baseline - CANVAS_TOP_ASCENT_RATIO * font_size;
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
        let allocated = rito_fragment::allocate_ruby_annotation(
            &annotation.text,
            seg_start / total_chars,
            if end >= item_range.end {
                // The final segment closes the interval so a midpoint
                // exactly at its end still lands inside.
                f64::INFINITY
            } else {
                seg_end / total_chars
            },
        );
        (!allocated.is_empty()).then_some((allocated, annotation.size_ratio, annotation.align))
    });
    if let Some((annotation_text, size_ratio, ruby_align)) = segment_annotation {
        let annotation_ratio = f64::from(size_ratio);
        let annotation = &annotation_text;
        // The reader's ruby convention (shared with the retained engine):
        // the annotation paints at half the base font size, centered over
        // the base run's laid-out extent, its bottom edge one pixel above
        // the base's paint anchor.
        let annotation_size = font_size * annotation_ratio;
        // A space-around spread base advance holds (n−1) interior gaps,
        // and the annotation spans one more share — half a gap of
        // overhang past each base edge — so widening the centered rect
        // by one gap reconstructs the annotation's exact extent. Justify
        // spacing (justify_px) deliberately does NOT widen the rect: a
        // justified narrow-annotation base grows through its own extent
        // and the annotation only re-centers over it.
        // The annotation is its own LINE BOX: its physical top rounds to
        // a device row and the glyphs hang at the half-leading below —
        // independent of the base line's snap (measured on the
        // dual-pipeline ruby probe: the base-anchored convention sat one
        // row high on half the phases). The legacy anchor stays as the
        // fallback for runs laid before the snap traveled.
        let annotation_y = match &run.ruby_annotation_snap {
            Some(snap) => (line_y + snap.line_top).round() + snap.leading,
            None => em_top - annotation_size - 1.0,
        };
        commands.push(DisplayCommand::paint_ruby(DisplayTextCommandInput {
            text: Value::String(annotation.clone()),
            rect: rect_value(
                line_x + run.rect.x - run.ruby_overhang_px,
                annotation_y,
                run.rect.width + 2.0 * run.ruby_overhang_px,
                annotation_size,
            ),
            paint: paint.for_ruby(annotation_size),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
            ruby_align: match ruby_align {
                rito_style_contract::RubyAlign::SpaceAround => None,
                rito_style_contract::RubyAlign::Start => Some(RubyAlignPaint::START),
                rito_style_contract::RubyAlign::Center => Some(RubyAlignPaint::CENTER),
                rito_style_contract::RubyAlign::SpaceBetween => {
                    Some(RubyAlignPaint::SPACE_BETWEEN)
                }
            },
        }));
    }
    commands.push(DisplayCommand::paint_text(DisplayTextCommandInput {
        text: Value::String(full_text[start..end].to_owned()),
        // A halt-trimmed opener was laid at half width, but the painter
        // draws the untrimmed glyph whose outline sits one blank half
        // further right — shift the draw origin left by the removed half
        // so the ink lands where Blink's halt variant puts it (measured
        // at 64px: full-width 「 inks at box+41, the halt variant at
        // box+9 — the outline itself moves left by the trimmed half).
        rect: rect_value(
            line_x + run.rect.x - run.opener_trim_px,
            em_top,
            run.rect.width + run.opener_trim_px,
            font_size,
        ),
        paint,
        line_height_px: Some(number_value(line.rect.height)),
        href: None,
        source_text: None,
        source_text_offset: None,
        ruby_align: None,
    }));
    Ok(())
}

fn append_image_command(
    commands: &mut Vec<DisplayCommand>,
    items: &[InlineItem],
    image: &ImageFragment,
    line_x: f64,
    line_y: f64,
    image_border_paints: Option<&BTreeMap<u32, (NodePaint, [f64; 4])>>,
) -> EpubResult<()> {
    let Some(InlineItem::Image {
        src,
        source,
        intrinsic_width,
        intrinsic_height,
        fit_contain,
        viewport,
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
        // Blink pixel-snaps a plain replaced image's paint rect (probed:
        // an <img> at x=22.25 rasters at 22, at 22.5 at 23, bit-identical
        // to a canvas draw at the same integers). SVG-folded content is
        // NOT snapped: it paints through the svg's own transform, and the
        // reference renders it at the fractional position.
        let left = (line_x + draw.x).round();
        let top = (line_y + draw.y).round();
        let right = (line_x + draw.x + draw.width).round();
        let bottom = (line_y + draw.y + draw.height).round();
        draw = rito_fragment::FragmentRect {
            x: left - line_x,
            y: top - line_y,
            width: right - left,
            height: bottom - top,
        };
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
    // Alt text and link targets travel with the interaction layer, which
    // the fragment contract does not carry yet.
    commands.push(DisplayCommand::paint_image(
        src.clone(),
        rect_value(line_x + draw.x, line_y + draw.y, draw.width, draw.height),
        None,
        None,
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
    let quoted = |name: &str| {
        format!(
            "\"{}\"",
            name.replace('\\', "\\\\").replace('"', "\\\"")
        )
    };
    let mut parts: Vec<String> = Vec::new();
    let mut aliases_added = false;
    for raw in family_key.split(',').map(str::trim).filter(|n| !n.is_empty()) {
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
            ruby_annotation_snap: None,
            justify_px: 0.0,
            ruby_gap_px: 0.0,
            opener_trim_px: 0.0,
            ruby_overhang_px: 0.0,
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
                    align: rito_style_contract::RubyAlign::SpaceAround
                }),
            }]
        });
        let root = boxed_line(vec![text_run(0.0, 32.0, 0, 6)]);
        let commands = paint(&fixture.tree, &root);
        assert_eq!(commands.len(), 2);
        let DisplayCommand::PaintRuby(annotation) = &commands[0] else {
            panic!("annotation paints before its base, got {:?}", commands[0]);
        };
        assert_eq!(annotation.text, Value::String("かんじ".to_owned()));
        // The base anchors at 26.2 (line top 26 + baseline 13 − 0.8 × 16);
        // the 8px annotation sits one pixel above that anchor, spanning
        // the base run's extent for centered rendering.
        assert_eq!(annotation.rect, rect_value(14.0, 17.2, 32.0, 8.0));
        assert_eq!(annotation.paint.measure().font.size_px, 8.0);
        assert_eq!(annotation.paint.color(), "#ff0000");
        let DisplayCommand::PaintText(base) = &commands[1] else {
            panic!("expected the base text command, got {:?}", commands[1]);
        };
        assert_eq!(base.text, Value::String("漢字".to_owned()));
        assert_eq!(base.rect, rect_value(14.0, 26.2, 32.0, 16.0));
    }

    #[test]
    fn images_paint_with_their_source_reference() {
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
                },
            )
            .expect("layout style interns");
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Image {
                    source: 0,
                    src: "images/portrait.png".to_owned(),
                    intrinsic_width: 40.0,
                    intrinsic_height: 30.0,
                    style: text_style,
                    layout_style: image_layout,
                    fit_contain: false,
                    viewport: None,
                    baseline_shift_px: 0.0,
                    align_top: false,
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
        assert_eq!(*rect, rect_value(19.0, 28.0, 40.0, 30.0));
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
