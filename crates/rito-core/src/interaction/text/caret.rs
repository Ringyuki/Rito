use std::sync::Arc;

use crate::layout::{
    ExactRunShape, LayoutRuntimePage, LogicalTextFlow, LogicalTextSource, RunShape,
    RunShapeCaretAffinity, RunShapeCaretStop, RunTextMapping, TextFlowSlice, TextRunBox,
};

use super::{
    collect::{axis_distance, collect_page_text_runs, CollectedTextRun},
    LayoutSourcePoint, LayoutTextCaret, LayoutTextCaretResolution, TextCaretAddress,
    TextCaretAffinity, TextCaretGeometry, TextInteractionUnavailableReason,
};

pub(super) struct ResolvedRunCaret<'a> {
    pub(super) address: TextCaretAddress,
    pub(super) flow: &'a Arc<LogicalTextFlow>,
    pub(super) logical_offset: u32,
    pub(super) source_point: LayoutSourcePoint,
    pub(super) stop: RunShapeCaretStop,
}

pub(crate) fn resolve_text_caret(
    page_index: usize,
    page: &LayoutRuntimePage,
    x: f64,
    y: f64,
) -> LayoutTextCaretResolution {
    if !x.is_finite() || !y.is_finite() {
        return LayoutTextCaretResolution::Miss;
    }
    let Some(candidate) = nearest_text_run(collect_page_text_runs(page_index, page), x, y) else {
        return LayoutTextCaretResolution::Miss;
    };
    resolve_point_in_run(candidate, x, y)
}

pub(super) fn resolve_address<'a>(
    runs: &'a [CollectedTextRun<'a>],
    address: TextCaretAddress,
) -> Result<ResolvedRunCaret<'a>, TextInteractionUnavailableReason> {
    let run = runs
        .iter()
        .copied()
        .find(|run| run.matches_address(address))
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
    let (slice, shape) = exact_run_parts(run.run)?;
    if !run.visual.supports_axis_aligned_interaction() {
        return Err(TextInteractionUnavailableReason::UnsupportedTransform);
    }
    let stop = shape
        .caret_stops()
        .into_iter()
        .find(|stop| {
            stop.logical_offset as usize == address.char_index
                && caret_affinity(stop.affinity) == address.affinity
        })
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
    if run
        .visual
        .resolve_vertical_segment(run.x + f64::from(stop.visual_offset), run.y, run.run.height)
        .is_none()
    {
        return Err(TextInteractionUnavailableReason::VisualGeometryUnavailable);
    }
    resolved_run_caret(run, slice, stop)
}

pub(super) fn exact_run_parts(
    run: &TextRunBox,
) -> Result<(&TextFlowSlice, &ExactRunShape), TextInteractionUnavailableReason> {
    let RunTextMapping::Exact(slice) = &run.text_mapping else {
        return Err(TextInteractionUnavailableReason::SourceUnavailable);
    };
    if slice.validate().is_err() {
        return Err(TextInteractionUnavailableReason::SourceUnavailable);
    }
    let RunShape::Exact(shape) = &run.shape else {
        return Err(TextInteractionUnavailableReason::ShapeUnavailable);
    };
    let run_len = u32::try_from(run.text.encode_utf16().count())
        .map_err(|_| TextInteractionUnavailableReason::InvalidCaret)?;
    if slice.logical_end - slice.logical_start != run_len
        || !shape_matches_run(shape, run_len, run.width)
    {
        return Err(TextInteractionUnavailableReason::InvalidCaret);
    }
    Ok((slice, shape))
}

pub(super) fn stop_at(
    shape: &ExactRunShape,
    logical_offset: u32,
) -> Result<RunShapeCaretStop, TextInteractionUnavailableReason> {
    shape
        .caret_stops()
        .into_iter()
        .find(|stop| stop.logical_offset == logical_offset)
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)
}

pub(super) fn nearest_text_run(
    runs: Vec<CollectedTextRun<'_>>,
    x: f64,
    y: f64,
) -> Option<CollectedTextRun<'_>> {
    runs.into_iter()
        .enumerate()
        .filter_map(|(paint_order, run)| {
            let bounds = run.visible_rect()?;
            let vertical_distance = axis_distance(bounds.y, bounds.height, y);
            if vertical_distance > bounds.height.max(1.0) {
                return None;
            }
            Some((
                vertical_distance,
                axis_distance(bounds.x, bounds.width, x),
                paint_order,
                run,
            ))
        })
        .min_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
                .then_with(|| right.2.cmp(&left.2))
        })
        .map(|(_, _, _, run)| run)
}

fn resolve_point_in_run(run: CollectedTextRun<'_>, x: f64, y: f64) -> LayoutTextCaretResolution {
    if !run.visual.supports_axis_aligned_interaction() {
        return LayoutTextCaretResolution::Unavailable(
            TextInteractionUnavailableReason::UnsupportedTransform,
        );
    }
    let (slice, shape) = match exact_run_parts(run.run) {
        Ok(parts) => parts,
        Err(reason) => return LayoutTextCaretResolution::Unavailable(reason),
    };
    let Some(bounds) = run.visible_rect() else {
        return LayoutTextCaretResolution::Miss;
    };
    let target_x = x.clamp(bounds.x, bounds.x + bounds.width);
    let target_y = y.clamp(bounds.y, bounds.y + bounds.height);
    let Some((source_x, _)) = run.visual.inverse_point(target_x, target_y) else {
        return LayoutTextCaretResolution::Unavailable(
            TextInteractionUnavailableReason::UnsupportedTransform,
        );
    };
    let local_x = source_x - run.x;
    let Some(stop) = nearest_stop(shape, local_x) else {
        return LayoutTextCaretResolution::Unavailable(
            TextInteractionUnavailableReason::InvalidCaret,
        );
    };
    let Some(bounds) = run.visual.resolve_vertical_segment(
        run.x + f64::from(stop.visual_offset),
        run.y,
        run.run.height,
    ) else {
        return LayoutTextCaretResolution::Unavailable(
            TextInteractionUnavailableReason::VisualGeometryUnavailable,
        );
    };
    let geometry = TextCaretGeometry {
        x: bounds.x,
        y: bounds.y,
        height: bounds.height,
    };
    let resolved = match resolved_run_caret(run, slice, stop) {
        Ok(resolved) => resolved,
        Err(reason) => return LayoutTextCaretResolution::Unavailable(reason),
    };
    LayoutTextCaretResolution::Resolved(LayoutTextCaret {
        address: resolved.address,
        geometry,
        source_point: resolved.source_point,
    })
}

fn nearest_stop(shape: &ExactRunShape, local_x: f64) -> Option<RunShapeCaretStop> {
    shape
        .caret_stops()
        .into_iter()
        .map(|stop| {
            (
                (f64::from(stop.visual_offset) - local_x).abs(),
                stop.visual_offset,
                stop,
            )
        })
        .min_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| right.1.total_cmp(&left.1))
        })
        .map(|(_, _, stop)| stop)
}

pub(super) fn resolved_run_caret<'a>(
    run: CollectedTextRun<'a>,
    slice: &'a TextFlowSlice,
    stop: RunShapeCaretStop,
) -> Result<ResolvedRunCaret<'a>, TextInteractionUnavailableReason> {
    let logical_offset = slice
        .logical_start
        .checked_add(stop.logical_offset)
        .filter(|offset| *offset <= slice.logical_end)
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
    let source_point = source_point(slice, logical_offset)?;
    let address = TextCaretAddress {
        page_index: run.page_index,
        block_index: run.block_index,
        line_index: run.line_index,
        run_index: run.run_index,
        char_index: stop.logical_offset as usize,
        affinity: caret_affinity(stop.affinity),
    };
    Ok(ResolvedRunCaret {
        address,
        flow: &slice.flow,
        logical_offset,
        source_point,
        stop,
    })
}

fn source_point(
    slice: &TextFlowSlice,
    logical_offset: u32,
) -> Result<LayoutSourcePoint, TextInteractionUnavailableReason> {
    let span = slice
        .flow
        .spans()
        .get(slice.span_index as usize)
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)?;
    let LogicalTextSource::ExactLinear {
        node_path,
        source_start,
    } = &span.source
    else {
        return Err(TextInteractionUnavailableReason::SourceUnavailable);
    };
    let relative = logical_offset
        .checked_sub(span.logical_start)
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)? as usize;
    let text_offset = source_start
        .checked_add(relative)
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
    Ok(LayoutSourcePoint {
        node_path: node_path.to_vec(),
        text_offset,
    })
}

fn shape_matches_run(shape: &ExactRunShape, run_len: u32, width: f64) -> bool {
    if !approximately_equal(shape.advance, width) || shape.clusters.is_empty() {
        return false;
    }
    let mut clusters = shape.clusters.iter().collect::<Vec<_>>();
    clusters.sort_by_key(|cluster| cluster.logical_start);
    let mut cursor = 0;
    for cluster in clusters {
        if cluster.logical_start != cursor || cluster.logical_end <= cluster.logical_start {
            return false;
        }
        cursor = cluster.logical_end;
    }
    cursor == run_len
}

fn caret_affinity(affinity: RunShapeCaretAffinity) -> TextCaretAffinity {
    match affinity {
        RunShapeCaretAffinity::Upstream => TextCaretAffinity::Upstream,
        RunShapeCaretAffinity::Downstream => TextCaretAffinity::Downstream,
    }
}

fn approximately_equal(left: f64, right: f64) -> bool {
    (left - right).abs() <= 0.000_001_f64.max(right.abs() * 1e-9)
}
