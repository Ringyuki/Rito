//! Keyboard selection movement over fragment page artifacts.
//!
//! The focus caret moves through the scope's pages as one logical text
//! stream: page texts concatenated in page order, each page's lines
//! separated by the newline the artifact already records. Character
//! positions are UTF-16 page-text offsets; geometry (line up/down, page
//! jumps) resolves through the runs' rectangles with linear character
//! interpolation, exactly like the pointer resolvers.

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use crate::interaction::{plain_word_boundaries, TextSelectionBoundary, TextSelectionMovement};

use super::super::super::page_artifact::{FragmentPageArtifact, FragmentRunRecord};

/// One position in the scope's logical stream: a page slot (index into
/// the scope's page list) and a UTF-16 offset into that page's text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct StreamPosition {
    pub(super) slot: usize,
    pub(super) offset: usize,
}

/// One page of the movement scope.
pub(super) struct ScopePage {
    pub(super) page_index: usize,
    /// Absent when the page's chapter could not be rebuilt. Such a page
    /// reads as an empty one here and `ScopePages` records the failure,
    /// so the caller reports the movement instead of answering from a
    /// page whose text is missing.
    artifact: Option<Rc<FragmentPageArtifact>>,
    lines: Vec<ScopeLine>,
}

impl ScopePage {
    pub(super) fn artifact(&self) -> Option<&FragmentPageArtifact> {
        self.artifact.as_deref()
    }

    fn text(&self) -> &str {
        self.artifact().map_or("", FragmentPageArtifact::page_text)
    }

    fn runs(&self) -> &[FragmentRunRecord] {
        self.artifact()
            .map_or(&[], FragmentPageArtifact::interaction_runs)
    }
}

/// The scope's pages, built the first time a movement reads one.
///
/// A movement reads the focus page and, at most, the pages it steps
/// onto; the scope itself spans the whole book, and a page table that
/// keeps only a bounded set of chapters materialized would re-bridge and
/// re-paginate every chapter of the book if the scope were built up
/// front.
pub(super) struct ScopePages<'a> {
    first_page: usize,
    len: usize,
    load: &'a dyn Fn(usize) -> Option<Rc<FragmentPageArtifact>>,
    built: RefCell<Vec<Option<Rc<ScopePage>>>>,
    load_failed: Cell<bool>,
}

impl<'a> ScopePages<'a> {
    pub(super) fn new(
        first_page: usize,
        len: usize,
        load: &'a dyn Fn(usize) -> Option<Rc<FragmentPageArtifact>>,
    ) -> Self {
        Self {
            first_page,
            len,
            load,
            built: RefCell::new(vec![None; len]),
            load_failed: Cell::new(false),
        }
    }

    pub(super) fn len(&self) -> usize {
        self.len
    }

    /// Whether any page this movement read failed to build.
    pub(super) fn load_failed(&self) -> bool {
        self.load_failed.get()
    }

    pub(super) fn page(&self, slot: usize) -> Rc<ScopePage> {
        if let Some(page) = self.built.borrow()[slot].clone() {
            return page;
        }
        let page_index = self.first_page + slot;
        let artifact = (self.load)(page_index);
        if artifact.is_none() {
            self.load_failed.set(true);
        }
        let page = Rc::new(build_scope_page(page_index, artifact));
        self.built.borrow_mut()[slot] = Some(Rc::clone(&page));
        page
    }
}

/// One line's offset span and geometry, in page coordinates. The span
/// includes the line-final caret (the newline separator's offset).
#[derive(Debug, Clone, Copy)]
struct ScopeLine {
    block_index: usize,
    start: usize,
    end: usize,
    y: f64,
    height: f64,
}

pub(super) struct MovementOutcome {
    pub(super) focus: StreamPosition,
    pub(super) preferred_inline_position: Option<f64>,
    pub(super) preferred_block_position: Option<f64>,
}

pub(super) enum Moved {
    To(MovementOutcome),
    Boundary(TextSelectionBoundary),
}

pub(super) struct MovementRequest<'a> {
    pub(super) movement: TextSelectionMovement,
    pub(super) language: Option<&'a str>,
    pub(super) preferred_inline_position: Option<f64>,
    pub(super) preferred_block_position: Option<f64>,
    /// For PageUp/PageDown: the scope slot of the target page.
    pub(super) target_slot: Option<usize>,
}

fn build_scope_page(page_index: usize, artifact: Option<Rc<FragmentPageArtifact>>) -> ScopePage {
    let mut lines: Vec<ScopeLine> = Vec::new();
    for run in artifact
        .as_deref()
        .map_or(&[][..], FragmentPageArtifact::interaction_runs)
    {
        match lines.last_mut() {
            // Runs arrive in flow order; a run continues the current line
            // exactly when it starts where the line ends.
            Some(line) if run.start == line.end && run.block_index == line.block_index => {
                line.end = run.end;
                line.y = line.y.min(run.y);
                line.height = line.height.max(run.height);
            }
            _ => {
                lines.push(ScopeLine {
                    block_index: run.block_index,
                    start: run.start,
                    end: run.end,
                    y: run.y,
                    height: run.height,
                });
            }
        }
    }
    ScopePage {
        page_index,
        artifact,
        lines,
    }
}

pub(super) fn move_focus(
    pages: &ScopePages<'_>,
    focus: StreamPosition,
    request: MovementRequest<'_>,
) -> Moved {
    use TextSelectionMovement as M;
    match request.movement {
        M::CharacterLeft => step_character(pages, focus, -1),
        M::CharacterRight => step_character(pages, focus, 1),
        M::WordLeft => step_word(pages, focus, request.language, WordStep::Left),
        M::WordRight => step_word(pages, focus, request.language, WordStep::Right),
        M::WordStartRight => step_word(pages, focus, request.language, WordStep::NextStart),
        M::LineUp => step_line(pages, focus, -1, request.preferred_inline_position),
        M::LineDown => step_line(pages, focus, 1, request.preferred_inline_position),
        M::LineStart => snap_line_edge(pages, focus, TextSelectionBoundary::Start),
        M::LineEnd => snap_line_edge(pages, focus, TextSelectionBoundary::End),
        M::PageUp | M::PageDown => jump_page(pages, focus, request),
        M::ParagraphBackward => step_paragraph(pages, focus, ParagraphStep::Backward),
        M::ParagraphForward => step_paragraph(pages, focus, ParagraphStep::Forward),
        M::ParagraphPreviousStart => step_paragraph(pages, focus, ParagraphStep::PreviousStart),
        M::ParagraphNextStart => step_paragraph(pages, focus, ParagraphStep::NextStart),
        M::ChapterStart | M::DocumentStart => snap_scope_edge(pages, TextSelectionBoundary::Start),
        M::ChapterEnd | M::DocumentEnd => snap_scope_edge(pages, TextSelectionBoundary::End),
    }
}

fn resolved(focus: StreamPosition) -> Moved {
    Moved::To(MovementOutcome {
        focus,
        preferred_inline_position: None,
        preferred_block_position: None,
    })
}

fn page_text_len(page: &ScopePage) -> usize {
    page.text().encode_utf16().count()
}

fn step_character(pages: &ScopePages<'_>, focus: StreamPosition, direction: isize) -> Moved {
    if direction < 0 {
        if focus.offset > 0 {
            return resolved(StreamPosition {
                slot: focus.slot,
                offset: focus.offset - 1,
            });
        }
        let Some(previous_slot) = focus.slot.checked_sub(1) else {
            return Moved::Boundary(TextSelectionBoundary::Start);
        };
        return resolved(StreamPosition {
            slot: previous_slot,
            offset: page_text_len(&pages.page(previous_slot)),
        });
    }
    let len = page_text_len(&pages.page(focus.slot));
    if focus.offset < len {
        return resolved(StreamPosition {
            slot: focus.slot,
            offset: focus.offset + 1,
        });
    }
    if focus.slot + 1 < pages.len() {
        return resolved(StreamPosition {
            slot: focus.slot + 1,
            offset: 0,
        });
    }
    Moved::Boundary(TextSelectionBoundary::End)
}

enum WordStep {
    Left,
    Right,
    NextStart,
}

fn step_word(
    pages: &ScopePages<'_>,
    focus: StreamPosition,
    language: Option<&str>,
    step: WordStep,
) -> Moved {
    let page = pages.page(focus.slot);
    let text = page.text();
    let boundaries = plain_word_boundaries(text, language);
    let offset = focus.offset as u32;
    let next = match step {
        WordStep::Left => boundaries
            .iter()
            .rev()
            .find(|edge| **edge < offset)
            .copied(),
        WordStep::Right => boundaries.iter().find(|edge| **edge > offset).copied(),
        WordStep::NextStart => {
            // The start of the word after the current one: skip the edge
            // that closes the current segment, then any whitespace-only
            // segment, landing on the next segment's first offset.
            let mut edges = boundaries.iter().copied().filter(|edge| *edge > offset);
            edges.next().map(|end| {
                let mut start = end;
                let units: Vec<u16> = text.encode_utf16().collect();
                for edge in edges {
                    let segment = String::from_utf16_lossy(&units[start as usize..edge as usize]);
                    if !segment.trim().is_empty() {
                        break;
                    }
                    start = edge;
                }
                start
            })
        }
    };
    match next {
        Some(next) => resolved(StreamPosition {
            slot: focus.slot,
            offset: next as usize,
        }),
        // No boundary left on this page: fall back to a character step
        // across the page edge, which lands at the neighbouring page.
        None => step_character(
            pages,
            focus,
            match step {
                WordStep::Left => -1,
                WordStep::Right | WordStep::NextStart => 1,
            },
        ),
    }
}

/// Global line addressing: (slot, line index within the page).
fn line_of(pages: &ScopePages<'_>, position: StreamPosition) -> Option<(usize, usize)> {
    let page = pages.page(position.slot);
    page.lines
        .iter()
        .position(|line| line.start <= position.offset && position.offset <= line.end)
        .or_else(|| {
            // Offsets between lines (the newline separator) belong to the
            // preceding line; past-the-end snaps to the last line.
            page.lines
                .iter()
                .rposition(|line| line.start <= position.offset)
        })
        .map(|index| (position.slot, index))
}

fn step_line(
    pages: &ScopePages<'_>,
    focus: StreamPosition,
    direction: isize,
    preferred_inline_position: Option<f64>,
) -> Moved {
    let Some((slot, line_index)) = line_of(pages, focus) else {
        return Moved::Boundary(if direction < 0 {
            TextSelectionBoundary::Start
        } else {
            TextSelectionBoundary::End
        });
    };
    let x = preferred_inline_position
        .or_else(|| caret_x(&pages.page(slot), focus.offset))
        .unwrap_or(0.0);
    let Some((target_slot, target_line)) = adjacent_line(pages, slot, line_index, direction) else {
        return Moved::Boundary(if direction < 0 {
            TextSelectionBoundary::Start
        } else {
            TextSelectionBoundary::End
        });
    };
    let offset = offset_at_x(&pages.page(target_slot), target_line, x);
    Moved::To(MovementOutcome {
        focus: StreamPosition {
            slot: target_slot,
            offset,
        },
        preferred_inline_position: Some(x),
        preferred_block_position: None,
    })
}

fn adjacent_line(
    pages: &ScopePages<'_>,
    slot: usize,
    line_index: usize,
    direction: isize,
) -> Option<(usize, usize)> {
    if direction < 0 {
        if line_index > 0 {
            return Some((slot, line_index - 1));
        }
        let mut slot = slot;
        while let Some(previous) = slot.checked_sub(1) {
            let lines = pages.page(previous).lines.len();
            if lines > 0 {
                return Some((previous, lines - 1));
            }
            slot = previous;
        }
        return None;
    }
    if line_index + 1 < pages.page(slot).lines.len() {
        return Some((slot, line_index + 1));
    }
    let mut slot = slot + 1;
    while slot < pages.len() {
        if !pages.page(slot).lines.is_empty() {
            return Some((slot, 0));
        }
        slot += 1;
    }
    None
}

fn snap_line_edge(
    pages: &ScopePages<'_>,
    focus: StreamPosition,
    edge: TextSelectionBoundary,
) -> Moved {
    let Some((slot, line_index)) = line_of(pages, focus) else {
        return Moved::Boundary(edge);
    };
    let page = pages.page(slot);
    let line = &page.lines[line_index];
    resolved(StreamPosition {
        slot,
        offset: match edge {
            TextSelectionBoundary::Start => line.start,
            TextSelectionBoundary::End => line.end,
        },
    })
}

enum ParagraphStep {
    Backward,
    Forward,
    PreviousStart,
    NextStart,
}

/// Paragraph spans: consecutive lines of one block on one page. A block
/// split across pages moves as per-page paragraphs, matching how the
/// artifact scopes its blocks.
fn paragraph_spans(page: &ScopePage) -> Vec<(usize, usize)> {
    let mut spans: Vec<(usize, usize, usize)> = Vec::new();
    for line in &page.lines {
        match spans.last_mut() {
            Some((block, _, end)) if *block == line.block_index => *end = line.end,
            _ => spans.push((line.block_index, line.start, line.end)),
        }
    }
    spans
        .into_iter()
        .map(|(_, start, end)| (start, end))
        .collect()
}

fn step_paragraph(pages: &ScopePages<'_>, focus: StreamPosition, step: ParagraphStep) -> Moved {
    let spans = paragraph_spans(&pages.page(focus.slot));
    let current = spans
        .iter()
        .position(|(start, end)| *start <= focus.offset && focus.offset <= *end);
    let Some(current) = current else {
        return Moved::Boundary(match step {
            ParagraphStep::Backward | ParagraphStep::PreviousStart => TextSelectionBoundary::Start,
            ParagraphStep::Forward | ParagraphStep::NextStart => TextSelectionBoundary::End,
        });
    };
    let same_page = |offset: usize| {
        resolved(StreamPosition {
            slot: focus.slot,
            offset,
        })
    };
    match step {
        ParagraphStep::Backward => {
            let (start, _) = spans[current];
            if focus.offset > start {
                return same_page(start);
            }
            if current > 0 {
                return same_page(spans[current - 1].0);
            }
            cross_page_paragraph(pages, focus.slot, TextSelectionBoundary::Start)
        }
        ParagraphStep::Forward => {
            let (_, end) = spans[current];
            if focus.offset < end {
                return same_page(end);
            }
            if current + 1 < spans.len() {
                return same_page(spans[current + 1].1);
            }
            cross_page_paragraph(pages, focus.slot, TextSelectionBoundary::End)
        }
        ParagraphStep::PreviousStart => {
            if current > 0 {
                return same_page(spans[current - 1].0);
            }
            cross_page_paragraph(pages, focus.slot, TextSelectionBoundary::Start)
        }
        ParagraphStep::NextStart => {
            if current + 1 < spans.len() {
                return same_page(spans[current + 1].0);
            }
            cross_page_paragraph(pages, focus.slot, TextSelectionBoundary::End)
        }
    }
}

/// The nearest paragraph edge on a neighbouring page, or the scope
/// boundary when no page remains.
fn cross_page_paragraph(
    pages: &ScopePages<'_>,
    slot: usize,
    direction: TextSelectionBoundary,
) -> Moved {
    match direction {
        TextSelectionBoundary::Start => {
            let mut slot = slot;
            while let Some(previous) = slot.checked_sub(1) {
                let spans = paragraph_spans(&pages.page(previous));
                if let Some((start, _)) = spans.last() {
                    return resolved(StreamPosition {
                        slot: previous,
                        offset: *start,
                    });
                }
                slot = previous;
            }
            Moved::Boundary(TextSelectionBoundary::Start)
        }
        TextSelectionBoundary::End => {
            let mut slot = slot + 1;
            while slot < pages.len() {
                let spans = paragraph_spans(&pages.page(slot));
                if let Some((start, _)) = spans.first() {
                    return resolved(StreamPosition {
                        slot,
                        offset: *start,
                    });
                }
                slot += 1;
            }
            Moved::Boundary(TextSelectionBoundary::End)
        }
    }
}

fn jump_page(pages: &ScopePages<'_>, focus: StreamPosition, request: MovementRequest<'_>) -> Moved {
    let Some(slot) = request.target_slot else {
        return Moved::Boundary(match request.movement {
            TextSelectionMovement::PageUp => TextSelectionBoundary::Start,
            _ => TextSelectionBoundary::End,
        });
    };
    let focus_page = pages.page(focus.slot);
    let x = request
        .preferred_inline_position
        .or_else(|| caret_x(&focus_page, focus.offset))
        .unwrap_or(0.0);
    let y = request
        .preferred_block_position
        .or_else(|| caret_y(&focus_page, focus.offset))
        .unwrap_or(0.0);
    let page = pages.page(slot);
    let Some(line_index) = nearest_line_at_y(&page, y) else {
        return Moved::Boundary(match request.movement {
            TextSelectionMovement::PageUp => TextSelectionBoundary::Start,
            _ => TextSelectionBoundary::End,
        });
    };
    let offset = offset_at_x(&page, line_index, x);
    Moved::To(MovementOutcome {
        focus: StreamPosition { slot, offset },
        preferred_inline_position: Some(x),
        preferred_block_position: Some(y),
    })
}

fn snap_scope_edge(pages: &ScopePages<'_>, edge: TextSelectionBoundary) -> Moved {
    let slots: Box<dyn Iterator<Item = usize>> = match edge {
        TextSelectionBoundary::Start => Box::new(0..pages.len()),
        TextSelectionBoundary::End => Box::new((0..pages.len()).rev()),
    };
    for slot in slots {
        let page = pages.page(slot);
        let line = match edge {
            TextSelectionBoundary::Start => page.lines.first(),
            TextSelectionBoundary::End => page.lines.last(),
        };
        if let Some(line) = line {
            return resolved(StreamPosition {
                slot,
                offset: match edge {
                    TextSelectionBoundary::Start => line.start,
                    TextSelectionBoundary::End => line.end,
                },
            });
        }
    }
    Moved::Boundary(edge)
}

fn caret_x(page: &ScopePage, offset: usize) -> Option<f64> {
    let run = run_at(page, offset)?;
    let length = (run.end - run.start).max(1) as f64;
    let ratio = (offset.clamp(run.start, run.end) - run.start) as f64 / length;
    Some(run.x + run.width * ratio)
}

fn caret_y(page: &ScopePage, offset: usize) -> Option<f64> {
    run_at(page, offset).map(|run| run.y)
}

fn run_at(page: &ScopePage, offset: usize) -> Option<&FragmentRunRecord> {
    let runs = page.runs();
    runs.iter()
        .find(|run| run.start <= offset && offset <= run.end)
        .or_else(|| runs.iter().find(|run| run.start >= offset))
        .or_else(|| runs.last())
}

fn nearest_line_at_y(page: &ScopePage, y: f64) -> Option<usize> {
    // Line bands are half-open [top, top + height): a caret y exactly on
    // a boundary belongs to the line STARTING there, the way a browser
    // maps a caret at a line edge (a page jump from a line top would
    // otherwise tie with the line above and land one line short).
    let mut best: Option<(f64, usize)> = None;
    for (index, line) in page.lines.iter().enumerate() {
        if y >= line.y && y < line.y + line.height {
            return Some(index);
        }
        let distance = if y < line.y {
            line.y - y
        } else {
            y - (line.y + line.height)
        };
        if best.is_none_or(|(best_distance, _)| distance < best_distance) {
            best = Some((distance, index));
        }
    }
    best.map(|(_, index)| index)
}

/// The closest character edge to `x` within one line.
fn offset_at_x(page: &ScopePage, line_index: usize, x: f64) -> usize {
    let line = &page.lines[line_index];
    let mut best = (f64::MAX, line.start);
    for run in page.runs() {
        if run.end < line.start || run.start > line.end || run.block_index != line.block_index {
            continue;
        }
        let length = run.end - run.start;
        for char_index in 0..=length {
            let ratio = if length == 0 {
                0.0
            } else {
                char_index as f64 / length as f64
            };
            let edge_x = run.x + run.width * ratio;
            let distance = (edge_x - x).abs();
            if distance < best.0 {
                best = (distance, run.start + char_index);
            }
        }
    }
    best.1
}
