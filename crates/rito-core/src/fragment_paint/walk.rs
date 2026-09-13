//! The recursive walk over box fragments: a box's transform wrapper (push,
//! transform about the border-box centre, pop around its whole subtree,
//! the layer origin snapped to whole CSS pixels), its rule or block
//! decoration with the ridge/groove bevel strips, the per-cell rule
//! segments a collapsed table's dashed or dotted horizontal edges split
//! into, its outside list marker, and the dispatch of every child line to
//! the horizontal or the vertical line painter.

use rito_fragment::{FormattingTree, Fragment};

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::NodePaint;
use crate::render::contract::{
    ReaderBackgroundPaint, ReaderBlockBorder, ReaderBlockPaint, ReaderBorderBox,
    ReaderBorderEdgePaint, ReaderBorderStyle, ReaderColor, ReaderHorizontalRulePaint, ReaderLength,
    ReaderPoint, ReaderSize, ReaderTransform,
};
use crate::render::{display_number, display_rect, DisplayCommand, DisplayTextCommand};

use super::line::append_line_commands;
use super::run_style::run_paint;
use super::vertical::append_vertical_line_commands;
use super::{cluster_x, painted_baseline, snap_css, FragmentPaintContext, CANVAS_TOP_ASCENT_RATIO};

#[allow(clippy::too_many_arguments)]
pub(super) fn append_fragment_display_commands_inner(
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
                commands.push(DisplayCommand::PushState);
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
                    let mut ops = vec![ReaderTransform::Translate {
                        x: ReaderLength::Px(display_number(snap_dx)),
                        y: ReaderLength::Px(display_number(snap_dy)),
                    }];
                    ops.extend(transforms.iter().copied());
                    ops
                };
                commands.push(DisplayCommand::Transform {
                    origin: ReaderPoint {
                        x: display_number(box_x + fragment.rect.width / 2.0),
                        y: display_number(box_y + fragment.rect.height / 2.0),
                    },
                    box_size: ReaderSize {
                        width: display_number(fragment.rect.width),
                        height: display_number(fragment.rect.height),
                    },
                    transforms: ops,
                });
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
                        if *style == ReaderBorderStyle::Inset {
                            let edge = |color: ReaderColor| {
                                Some(ReaderBorderEdgePaint {
                                    color,
                                    style: ReaderBorderStyle::Solid,
                                })
                            };
                            let dark = ReaderColor::srgb8(0x9a, 0x9a, 0x9a, 1.0);
                            let light = ReaderColor::srgb8(0xee, 0xee, 0xee, 1.0);
                            let width = display_number(thickness);
                            commands.push(DisplayCommand::PaintBlock {
                                rect: display_rect(
                                    origin_x + fragment.rect.x,
                                    origin_y + fragment.rect.y,
                                    fragment.rect.width,
                                    fragment.rect.height,
                                ),
                                paint: ReaderBlockPaint {
                                    border: Some(ReaderBlockBorder {
                                        top: edge(dark),
                                        right: edge(light),
                                        bottom: edge(light),
                                        left: edge(dark),
                                    }),
                                    ..ReaderBlockPaint::default()
                                },
                                border_box: Some(ReaderBorderBox {
                                    top_width: width,
                                    right_width: width,
                                    bottom_width: width,
                                    left_width: width,
                                }),
                            });
                        } else {
                            commands.push(DisplayCommand::PaintHorizontalRule {
                                rect: display_rect(
                                    origin_x + fragment.rect.x,
                                    origin_y + fragment.rect.y,
                                    fragment.rect.width,
                                    thickness,
                                ),
                                paint: ReaderHorizontalRulePaint {
                                    color: *color,
                                    style: *style,
                                },
                            });
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
                        let mut border_box = *border_box;
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
                        // A transform-only box carries an empty paint;
                        // there is nothing to stroke or fill.
                        let has_decoration = paint.background.is_some()
                            || paint.border.is_some()
                            || paint.radius.is_some()
                            || !paint.box_shadows.is_empty();
                        if has_decoration {
                            commands.push(DisplayCommand::PaintBlock {
                                rect: display_rect(
                                    origin_x + fragment.rect.x,
                                    origin_y + fragment.rect.y,
                                    fragment.rect.width,
                                    fragment.rect.height,
                                ),
                                paint: paint.clone(),
                                border_box: *border_box,
                            });
                            // Ridge/groove inner halves: the border entry
                            // stroked the edge's outer tone full-width, so
                            // each bevel lays the opposite tone over the
                            // strip adjacent to the content. Corner joins
                            // stop at the neighbouring edge's width — the
                            // square stop approximates Blink's diagonal
                            // miter to within the corner's own pixels.
                            for (edge_index, inner_color) in bevels {
                                let (top, right, bottom, left) =
                                    border_box.map_or((0.0, 0.0, 0.0, 0.0), |widths| {
                                        (
                                            widths.top_width,
                                            widths.right_width,
                                            widths.bottom_width,
                                            widths.left_width,
                                        )
                                    });
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
                                    commands.push(DisplayCommand::PaintBlock {
                                        rect: display_rect(strip.0, strip.1, strip.2, strip.3),
                                        paint: ReaderBlockPaint {
                                            background: Some(ReaderBackgroundPaint {
                                                color: Some(*inner_color),
                                                ..ReaderBackgroundPaint::default()
                                            }),
                                            ..ReaderBlockPaint::default()
                                        },
                                        border_box: None,
                                    });
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
                    commands.push(DisplayCommand::PaintText(DisplayTextCommand {
                        text: marker.painted_text(),
                        rect: display_rect(
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
                commands.push(DisplayCommand::PopState);
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
    paint: &mut ReaderBlockPaint,
    border_box: &mut Option<ReaderBorderBox>,
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
    for top in [true, false] {
        let Some(side) = paint
            .border
            .and_then(|border| if top { border.top } else { border.bottom })
        else {
            continue;
        };
        if side.style != ReaderBorderStyle::Dotted && side.style != ReaderBorderStyle::Dashed {
            continue;
        }
        let width = border_box.map_or(0.0, |widths| {
            if top {
                widths.top_width
            } else {
                widths.bottom_width
            }
        });
        // Skips NaN widths too: only a strictly positive width paints.
        if width.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
            continue;
        }
        let row = if top { rows.first() } else { rows.last() };
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
        let y = if top {
            origin_y + fragment.rect.y
        } else {
            origin_y + fragment.rect.y + fragment.rect.height - width
        };
        let mut start = origin_x + fragment.rect.x;
        let end = origin_x + fragment.rect.x + fragment.rect.width;
        for cut in cuts.into_iter().chain(std::iter::once(end)) {
            if cut > start {
                segments.push(DisplayCommand::PaintHorizontalRule {
                    rect: display_rect(start, y, cut - start, width),
                    paint: ReaderHorizontalRulePaint {
                        color: side.color,
                        style: side.style,
                    },
                });
                start = cut;
            }
        }
        if let Some(border) = paint.border.as_mut() {
            if top {
                border.top = None;
            } else {
                border.bottom = None;
            }
        }
        if let Some(widths) = border_box.as_mut() {
            if top {
                widths.top_width = 0.0;
            } else {
                widths.bottom_width = 0.0;
            }
        }
    }
    let border_empty = paint.border.is_some_and(|border| {
        border.top.is_none()
            && border.right.is_none()
            && border.bottom.is_none()
            && border.left.is_none()
    });
    if border_empty {
        paint.border = None;
        let all_zero = border_box.is_some_and(|widths| {
            widths.top_width == 0.0
                && widths.right_width == 0.0
                && widths.bottom_width == 0.0
                && widths.left_width == 0.0
        });
        if all_zero {
            *border_box = None;
        }
    }
    segments
}
