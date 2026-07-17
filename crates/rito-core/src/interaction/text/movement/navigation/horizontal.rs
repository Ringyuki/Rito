use std::{collections::HashMap, sync::Arc};

use crate::interaction::text::{
    word_segmentation::{word_like_segments, WordLikeSegment},
    TextInteractionUnavailableReason, TextSelectionMovement,
};
use crate::layout::LogicalTextFlow;

use super::{adjacent_index, boundary, focus_line, line_direction, line_ranges, FocusMovement};
use crate::interaction::text::movement::context::{MovementCaret, MovementDirection};

#[derive(Clone, Copy, PartialEq, Eq)]
enum HorizontalGranularity {
    Character,
    WordEdge,
    WordStart,
}

struct WordTargetCache<'a> {
    language: Option<&'a str>,
    segments: HashMap<*const LogicalTextFlow, Vec<WordLikeSegment>>,
}

impl<'a> WordTargetCache<'a> {
    fn new(language: Option<&'a str>) -> Self {
        Self {
            language,
            segments: HashMap::new(),
        }
    }

    fn is_target(
        &mut self,
        candidate: &MovementCaret,
        direction: MovementDirection,
        right: bool,
        granularity: HorizontalGranularity,
    ) -> bool {
        if granularity == HorizontalGranularity::Character {
            return true;
        }
        let logical_forward = right == (direction == MovementDirection::LeftToRight);
        let language = self.language;
        self.segments
            .entry(Arc::as_ptr(&candidate.flow))
            .or_insert_with(|| word_like_segments(&candidate.flow, language))
            .iter()
            .any(|segment| {
                let target = if granularity == HorizontalGranularity::WordStart || !logical_forward
                {
                    segment.start
                } else {
                    segment.end
                };
                candidate.logical_offset == target
            })
    }
}

pub(super) fn move_horizontal_focus(
    positions: &[MovementCaret],
    focus: &MovementCaret,
    movement: TextSelectionMovement,
    language: Option<&str>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    let (right, granularity) = match movement {
        TextSelectionMovement::CharacterLeft => (false, HorizontalGranularity::Character),
        TextSelectionMovement::CharacterRight => (true, HorizontalGranularity::Character),
        TextSelectionMovement::WordLeft => (false, HorizontalGranularity::WordEdge),
        TextSelectionMovement::WordRight => (true, HorizontalGranularity::WordEdge),
        TextSelectionMovement::WordStartRight => (true, HorizontalGranularity::WordStart),
        _ => unreachable!("horizontal movement dispatch is exhaustive"),
    };
    move_horizontal(positions, focus, right, granularity, language)
}

fn move_horizontal(
    positions: &[MovementCaret],
    focus: &MovementCaret,
    right: bool,
    granularity: HorizontalGranularity,
    language: Option<&str>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    let lines = line_ranges(positions);
    let current = focus_line(&lines, focus)?;
    let direction = line_direction(positions, &lines[current])?;
    let mut words = WordTargetCache::new(language);
    if let Some(target) = nearest_horizontal_caret(
        positions,
        &lines[current],
        focus.caret.geometry.x,
        right,
        direction,
        granularity,
        &mut words,
    ) {
        return Ok(FocusMovement::Resolved(target, None));
    }
    cross_line(
        positions,
        &lines,
        current,
        right,
        direction,
        granularity,
        &mut words,
    )
}

fn cross_line(
    positions: &[MovementCaret],
    lines: &[super::LineRange],
    current: usize,
    right: bool,
    direction: MovementDirection,
    granularity: HorizontalGranularity,
    words: &mut WordTargetCache<'_>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    let document_forward = right == (direction == MovementDirection::LeftToRight);
    let mut line_index = current;
    loop {
        let Some(next) = adjacent_index(line_index, lines.len(), document_forward) else {
            return Ok(FocusMovement::Boundary(boundary(document_forward)));
        };
        let line = &lines[next];
        let target_direction = line_direction(positions, line)?;
        if let Some(target) = line_entry_caret(
            positions,
            line,
            document_forward,
            right,
            target_direction,
            granularity,
            words,
        ) {
            return Ok(FocusMovement::Resolved(target, None));
        }
        line_index = next;
    }
}

fn nearest_horizontal_caret(
    positions: &[MovementCaret],
    line: &super::LineRange,
    focus_x: f64,
    right: bool,
    direction: MovementDirection,
    granularity: HorizontalGranularity,
    words: &mut WordTargetCache<'_>,
) -> Option<MovementCaret> {
    positions[line.start..line.end]
        .iter()
        .filter(|candidate| {
            if right {
                candidate.caret.geometry.x > focus_x
            } else {
                candidate.caret.geometry.x < focus_x
            }
        })
        .filter(|candidate| words.is_target(candidate, direction, right, granularity))
        .min_by(|left, right_candidate| {
            (left.caret.geometry.x - focus_x)
                .abs()
                .total_cmp(&(right_candidate.caret.geometry.x - focus_x).abs())
        })
        .cloned()
}

fn line_entry_caret(
    positions: &[MovementCaret],
    line: &super::LineRange,
    document_forward: bool,
    right: bool,
    direction: MovementDirection,
    granularity: HorizontalGranularity,
    words: &mut WordTargetCache<'_>,
) -> Option<MovementCaret> {
    if document_forward {
        positions[line.start..line.end]
            .iter()
            .find(|candidate| words.is_target(candidate, direction, right, granularity))
    } else {
        positions[line.start..line.end]
            .iter()
            .rev()
            .find(|candidate| words.is_target(candidate, direction, right, granularity))
    }
    .cloned()
}
