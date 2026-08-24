use std::sync::Arc;

use crate::layout::{ExactRunShape, LogicalTextFlow};

use super::super::{
    caret::{caret_geometry, exact_run_parts, resolve_address, resolved_run_caret},
    collect::CollectedTextRun,
    LayoutTextCaret, TextCaretAddress, TextInteractionUnavailableReason,
};

pub(super) type MovementLineKey = (usize, usize, usize);

#[derive(Clone)]
pub(super) struct MovementCaret {
    pub(super) caret: LayoutTextCaret,
    pub(super) flow: Arc<LogicalTextFlow>,
    pub(super) logical_offset: u32,
    pub(super) direction: MovementDirection,
    pub(super) run_order: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum MovementDirection {
    LeftToRight,
    RightToLeft,
}

pub(super) struct PositionGroup {
    pub(super) flow: Arc<LogicalTextFlow>,
    pub(super) logical_offset: u32,
    pub(super) carets: Vec<MovementCaret>,
}

pub(super) struct MovementBarrier {
    pub(super) run_order: usize,
    pub(super) line_key: MovementLineKey,
    pub(super) reason: TextInteractionUnavailableReason,
}

pub(super) struct MovementCandidates {
    pub(super) positions: Vec<MovementCaret>,
    pub(super) barriers: Vec<MovementBarrier>,
}

pub(super) fn rebind_caret(
    runs: &[CollectedTextRun<'_>],
    address: TextCaretAddress,
) -> Result<MovementCaret, TextInteractionUnavailableReason> {
    let resolved = resolve_address(runs, address)?;
    let (run_order, run) = runs
        .iter()
        .copied()
        .enumerate()
        .find(|(_, run)| run.matches_address(address))
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
    let (_, shape) = exact_run_parts(run.run)?;
    Ok(MovementCaret {
        caret: LayoutTextCaret {
            address: resolved.address,
            geometry: caret_geometry(run, resolved.stop)?,
            source_point: resolved.source_point,
        },
        flow: Arc::clone(resolved.flow),
        logical_offset: resolved.logical_offset,
        direction: movement_direction(shape)
            .ok_or(TextInteractionUnavailableReason::VisualGeometryUnavailable)?,
        run_order,
    })
}

pub(super) fn collect_movement_candidates(runs: &[CollectedTextRun<'_>]) -> MovementCandidates {
    let mut positions = Vec::new();
    let mut barriers = Vec::new();
    for (run_order, run) in runs.iter().copied().enumerate() {
        match collect_run_carets(run, run_order) {
            Ok(mut carets) => positions.append(&mut carets),
            Err(reason) => barriers.push(MovementBarrier {
                run_order,
                line_key: line_key(run),
                reason,
            }),
        }
    }
    MovementCandidates {
        positions,
        barriers,
    }
}

fn collect_run_carets(
    run: CollectedTextRun<'_>,
    run_order: usize,
) -> Result<Vec<MovementCaret>, TextInteractionUnavailableReason> {
    let (slice, shape) = exact_run_parts(run.run)?;
    if !run.visual.supports_axis_aligned_interaction() {
        return Err(TextInteractionUnavailableReason::UnsupportedTransform);
    }
    let direction = movement_direction(shape)
        .ok_or(TextInteractionUnavailableReason::VisualGeometryUnavailable)?;
    let mut stops = shape.caret_stops();
    stops.sort_by_key(|stop| stop.logical_offset);
    stops
        .into_iter()
        .map(|stop| {
            let resolved = resolved_run_caret(run, slice, stop)?;
            Ok(MovementCaret {
                caret: LayoutTextCaret {
                    address: resolved.address,
                    geometry: caret_geometry(run, stop)?,
                    source_point: resolved.source_point,
                },
                flow: Arc::clone(resolved.flow),
                logical_offset: resolved.logical_offset,
                direction,
                run_order,
            })
        })
        .collect()
}

pub(super) fn position_groups(positions: &[MovementCaret]) -> Vec<PositionGroup> {
    let mut groups: Vec<PositionGroup> = Vec::new();
    for position in positions {
        if let Some(group) = groups.last_mut().filter(|group| {
            same_flow(&group.flow, &position.flow)
                && group.logical_offset == position.logical_offset
        }) {
            group.carets.push(position.clone());
        } else {
            groups.push(PositionGroup {
                flow: Arc::clone(&position.flow),
                logical_offset: position.logical_offset,
                carets: vec![position.clone()],
            });
        }
    }
    groups
}

pub(super) fn same_flow(left: &Arc<LogicalTextFlow>, right: &Arc<LogicalTextFlow>) -> bool {
    Arc::ptr_eq(left, right)
}

pub(super) fn caret_line_key(caret: &MovementCaret) -> MovementLineKey {
    let address = caret.caret.address;
    (address.page_index, address.block_index, address.line_index)
}

fn line_key(run: CollectedTextRun<'_>) -> MovementLineKey {
    (run.page_index, run.block_index, run.line_index)
}

fn movement_direction(shape: &ExactRunShape) -> Option<MovementDirection> {
    let stops = shape.caret_stops();
    let logical_start = stops.iter().min_by_key(|stop| stop.logical_offset)?;
    let logical_end = stops.iter().max_by_key(|stop| stop.logical_offset)?;
    if logical_start.visual_offset < logical_end.visual_offset {
        Some(MovementDirection::LeftToRight)
    } else if logical_start.visual_offset > logical_end.visual_offset {
        Some(MovementDirection::RightToLeft)
    } else {
        None
    }
}
