use crate::layout::{
    ExactRunShape, LayoutRuntimePage, LogicalTextFlow, RunTextMapping, TextFlowSlice,
};
use std::sync::Arc;

use super::paragraph_selection::{paragraph_bounds, paragraph_trailing_separator};
use super::word_segmentation::word_bounds;
use super::{
    caret::{exact_run_parts, nearest_text_run, resolved_run_caret, stop_at},
    collect::{collect_page_text_runs, collect_text_runs_in_page_range, CollectedTextRun},
    resolve_text_range, LayoutExactTextRangeResolution, LayoutTextCaret, LayoutTextPageRange,
    LayoutTextPoint, LayoutTextRangeFromPoints, LayoutTextRangeFromPointsResolution,
    LayoutTextSelectionGranularity, TextCaretGeometry, TextInteractionUnavailableReason,
};

struct ResolvedPointUnit {
    flow: Arc<LogicalTextFlow>,
    hit_key: (usize, usize, usize, usize),
    hit_start: u32,
    start: LayoutTextCaret,
    end: LayoutTextCaret,
    trailing_separator: Option<&'static str>,
}

enum PointUnitResolution {
    Resolved(Box<ResolvedPointUnit>),
    Unavailable(TextInteractionUnavailableReason),
    Miss,
}

#[derive(Clone, Copy)]
enum BoundarySide {
    Start,
    End,
}

pub(crate) fn resolve_text_range_from_points(
    pages: &[LayoutRuntimePage],
    anchor: LayoutTextPoint,
    focus: LayoutTextPoint,
    granularity: LayoutTextSelectionGranularity,
    language: Option<&str>,
    page_range: LayoutTextPageRange,
) -> LayoutTextRangeFromPointsResolution {
    let runs = collect_text_runs_in_page_range(pages, page_range.first_page, page_range.last_page);
    let anchor = match resolve_point_unit(pages, &runs, anchor, granularity, language) {
        PointUnitResolution::Resolved(unit) => unit,
        PointUnitResolution::Unavailable(reason) => {
            return LayoutTextRangeFromPointsResolution::Unavailable(reason);
        }
        PointUnitResolution::Miss => return LayoutTextRangeFromPointsResolution::Miss,
    };
    let focus = match resolve_point_unit(pages, &runs, focus, granularity, language) {
        PointUnitResolution::Resolved(unit) => unit,
        PointUnitResolution::Unavailable(reason) => {
            return LayoutTextRangeFromPointsResolution::Unavailable(reason);
        }
        PointUnitResolution::Miss => return LayoutTextRangeFromPointsResolution::Miss,
    };
    let same_unit = Arc::ptr_eq(&anchor.flow, &focus.flow)
        && anchor.start.address == focus.start.address
        && anchor.end.address == focus.end.address;
    let forward = same_unit || point_unit_precedes(&anchor, &focus);
    let (anchor_caret, focus_caret) = if forward {
        (anchor.start.clone(), focus.end.clone())
    } else {
        (anchor.end.clone(), focus.start.clone())
    };
    let mut range = match resolve_text_range(pages, anchor_caret.address, focus_caret.address) {
        LayoutExactTextRangeResolution::Resolved(range) => range,
        LayoutExactTextRangeResolution::Unavailable(reason) => {
            return LayoutTextRangeFromPointsResolution::Unavailable(reason);
        }
    };
    if granularity == LayoutTextSelectionGranularity::Paragraph {
        let terminal = if forward { &focus } else { &anchor };
        if let Some(separator) = terminal.trailing_separator {
            range.selected_text.push_str(separator);
        }
    }
    LayoutTextRangeFromPointsResolution::Resolved(Box::new(LayoutTextRangeFromPoints {
        anchor_caret,
        focus_caret,
        range,
    }))
}

fn resolve_point_unit(
    pages: &[LayoutRuntimePage],
    runs: &[CollectedTextRun<'_>],
    point: LayoutTextPoint,
    granularity: LayoutTextSelectionGranularity,
    language: Option<&str>,
) -> PointUnitResolution {
    let Some(page) = pages.get(point.page_index) else {
        return PointUnitResolution::Miss;
    };
    let Some(run) = nearest_text_run(
        collect_page_text_runs(point.page_index, page),
        point.x,
        point.y,
    ) else {
        return PointUnitResolution::Miss;
    };
    let (slice, shape) = match exact_run_parts(run.run) {
        Ok(parts) => parts,
        Err(reason) => return PointUnitResolution::Unavailable(reason),
    };
    if !run.visual.supports_axis_aligned_interaction() {
        return PointUnitResolution::Unavailable(
            TextInteractionUnavailableReason::UnsupportedTransform,
        );
    }
    let Some(cluster) = hit_cluster(run, shape, point.x, point.y) else {
        return PointUnitResolution::Miss;
    };
    let hit_start = slice.logical_start + cluster.0;
    let hit_end = slice.logical_start + cluster.1;
    let (unit_start, unit_end, trailing_separator) =
        match unit_offsets(runs, &slice.flow, hit_start, hit_end, granularity, language) {
            Ok(bounds) => bounds,
            Err(reason) => return PointUnitResolution::Unavailable(reason),
        };
    let start = match resolve_flow_boundary(runs, &slice.flow, unit_start, BoundarySide::Start) {
        Ok(caret) => caret,
        Err(reason) => return PointUnitResolution::Unavailable(reason),
    };
    let end = match resolve_flow_boundary(runs, &slice.flow, unit_end, BoundarySide::End) {
        Ok(caret) => caret,
        Err(reason) => return PointUnitResolution::Unavailable(reason),
    };
    PointUnitResolution::Resolved(Box::new(ResolvedPointUnit {
        flow: Arc::clone(&slice.flow),
        hit_key: (
            run.page_index,
            run.block_index,
            run.line_index,
            run.run_index,
        ),
        hit_start,
        start,
        end,
        trailing_separator,
    }))
}

fn hit_cluster(
    run: CollectedTextRun<'_>,
    shape: &ExactRunShape,
    x: f64,
    y: f64,
) -> Option<(u32, u32)> {
    let bounds = run.visible_rect()?;
    let target_x = x.clamp(bounds.x, bounds.x + bounds.width);
    let target_y = y.clamp(bounds.y, bounds.y + bounds.height);
    let (source_x, _) = run.visual.inverse_point(target_x, target_y)?;
    let local_x = source_x - run.x;
    let mut cursor = 0.0;
    let last_index = shape.clusters.len().checked_sub(1)?;
    shape
        .clusters
        .iter()
        .enumerate()
        .map(|(index, cluster)| {
            let start = cursor;
            cursor = if index == last_index {
                shape.advance
            } else {
                cursor + f64::from(cluster.advance)
            };
            let distance = super::collect::axis_distance(start, cursor - start, local_x);
            let center_distance = (local_x - (start + cursor) / 2.0).abs();
            (
                distance,
                center_distance,
                cluster.logical_start,
                cluster.logical_end,
            )
        })
        .min_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
        })
        .map(|(_, _, start, end)| (start, end))
}

fn unit_offsets(
    runs: &[CollectedTextRun<'_>],
    flow: &Arc<LogicalTextFlow>,
    hit_start: u32,
    hit_end: u32,
    granularity: LayoutTextSelectionGranularity,
    language: Option<&str>,
) -> Result<(u32, u32, Option<&'static str>), TextInteractionUnavailableReason> {
    match granularity {
        LayoutTextSelectionGranularity::Word => {
            let (start, end) = word_bounds(flow, hit_start, hit_end, language)
                .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
            Ok((start, end, None))
        }
        LayoutTextSelectionGranularity::Paragraph => {
            let (start, end) = paragraph_bounds(runs, flow)?;
            let trailing_separator = paragraph_trailing_separator(runs, flow)?;
            Ok((start, end, trailing_separator))
        }
    }
}

fn resolve_flow_boundary(
    runs: &[CollectedTextRun<'_>],
    flow: &Arc<LogicalTextFlow>,
    offset: u32,
    side: BoundarySide,
) -> Result<LayoutTextCaret, TextInteractionUnavailableReason> {
    for run in runs {
        let RunTextMapping::Exact(slice) = &run.run.text_mapping else {
            continue;
        };
        if !Arc::ptr_eq(&slice.flow, flow) || !slice_owns_boundary(slice, offset, side) {
            continue;
        }
        let (_, shape) = exact_run_parts(run.run)?;
        if !run.visual.supports_axis_aligned_interaction() {
            return Err(TextInteractionUnavailableReason::UnsupportedTransform);
        }
        let stop = stop_at(shape, offset - slice.logical_start)?;
        let resolved = resolved_run_caret(*run, slice, stop)?;
        let (interaction_y, interaction_height) = run.interaction_vertical_bounds();
        let bounds = run
            .visual
            .resolve_vertical_segment(
                run.x + f64::from(stop.visual_offset),
                interaction_y,
                interaction_height,
            )
            .ok_or(TextInteractionUnavailableReason::VisualGeometryUnavailable)?;
        return Ok(LayoutTextCaret {
            address: resolved.address,
            geometry: TextCaretGeometry {
                x: bounds.x,
                y: bounds.y,
                height: bounds.height,
            },
            source_point: resolved.source_point,
        });
    }
    Err(TextInteractionUnavailableReason::SourceUnavailable)
}

fn slice_owns_boundary(slice: &TextFlowSlice, offset: u32, side: BoundarySide) -> bool {
    match side {
        BoundarySide::Start => {
            slice.logical_start <= offset
                && (offset < slice.logical_end
                    || (offset == slice.logical_end && offset == flow_end(&slice.flow)))
        }
        BoundarySide::End => {
            offset <= slice.logical_end
                && (slice.logical_start < offset || (offset == 0 && slice.logical_start == 0))
        }
    }
}

fn flow_end(flow: &LogicalTextFlow) -> u32 {
    flow.spans().last().map_or(0, |span| span.logical_end)
}

fn point_unit_precedes(left: &ResolvedPointUnit, right: &ResolvedPointUnit) -> bool {
    if Arc::ptr_eq(&left.flow, &right.flow) {
        left.hit_start <= right.hit_start
    } else {
        left.hit_key < right.hit_key
    }
}
