//! Fragment-backend adapter: serves session queries from the revision's
//! `FragmentBuiltLayout`.
//!
//! Structure queries (pages, frames, spreads, chapter ranges, anchors)
//! and pointer-driven text interaction (caret from point, range
//! selection, word/paragraph expansion) are served from the fragment
//! page artifacts. Character positions inside a run interpolate linearly
//! until per-cluster metrics ride along. Source locators and keyboard
//! selection movement still resolve `Unavailable`: the former needs the
//! collapse-aware source-offset mapping, the latter the shaped-caret
//! movement engine, and both are their own cutover steps.

use std::{collections::BTreeMap, ops::Range};

use crate::interaction::{
    plain_word_bounds, TextCaretAddress, TextCaretAffinity, TextCaretGeometry,
    TextInteractionUnavailableReason,
};
use crate::layout::{build_spread_slots, SpreadMode};
use crate::render::DisplayCommand;

use super::super::{
    fragment_backend::FragmentBuiltLayout,
    fragment_frame::{number_value, paint_rect_command, rect_value},
    page_artifact::{
        FragmentPageArtifact, FragmentRunRecord, PageArtifact, PageArtifactChapterRange,
        PageArtifactExactSourceRangeQuery, PageArtifactExactTextRange,
        PageArtifactExactTextRangeRect, PageArtifactExactTextRangeResolution, PageArtifactFrame,
        PageArtifactRevisionMetadata, PageArtifactSourcePoint, PageArtifactSourceRunStart,
        PageArtifactSpread, PageArtifactTextCaret, PageArtifactTextCaretQuery,
        PageArtifactTextCaretResolution, PageArtifactTextPoint, PageArtifactTextRangeFromPoints,
        PageArtifactTextRangeFromPointsQuery, PageArtifactTextRangeFromPointsResolution,
        PageArtifactTextRangeQuery, PageArtifactTextRangeToPointQuery,
        PageArtifactTextSelectionGranularity, PageArtifactTextSelectionMovementQuery,
        PageArtifactTextSelectionMovementResolution,
    },
    RuntimeRevision,
};

pub(super) struct FragmentChapterEngineSession<'a> {
    revision: &'a RuntimeRevision,
    layout: &'a FragmentBuiltLayout,
}

impl<'a> FragmentChapterEngineSession<'a> {
    pub(super) fn new(revision: &'a RuntimeRevision, layout: &'a FragmentBuiltLayout) -> Self {
        Self { revision, layout }
    }

    pub(super) fn metadata(&self) -> PageArtifactRevisionMetadata {
        PageArtifactRevisionMetadata {
            page_count: self.layout.page_count(),
            spread_count: self.spread_slot_count(),
        }
    }

    pub(super) fn page(&self, page_index: usize) -> Option<&'a dyn PageArtifact> {
        self.layout
            .page(page_index)
            .map(|page| &page.artifact as &dyn PageArtifact)
    }

    pub(super) fn frame(&self, spread_index: usize) -> Option<PageArtifactFrame> {
        let config = &self.revision.layout_config;
        let spreads = build_spread_slots(
            self.layout.page_count(),
            self.layout.chapter_start_pages(),
            config,
        );
        let spread = spreads.get(spread_index)?;
        let mut page_indexes = vec![spread.left_page_index];
        if config.spread_mode == SpreadMode::Double {
            if let Some(right) = spread.right_page_index {
                page_indexes.push(right);
            }
        }
        // Same frame skeleton as the retained producer: a viewport wash,
        // then each page translated into place, washed, and clipped
        // around its content commands. The page wash is the chapter
        // body's background when it declares one; block-level paint
        // beyond that is excluded by the representability gate.
        let mut commands = Vec::new();
        commands.push(paint_rect_command(
            0.0,
            0.0,
            config.viewport_width,
            config.viewport_height,
            "#ffffff",
        ));
        for (slot, page_index) in page_indexes.iter().enumerate() {
            let (page, chapter) = self.layout.page_with_chapter(*page_index)?;
            let metadata = page.artifact.metadata();
            let offset_x = slot as f64 * (config.page_width + config.spread_gap);
            commands.push(DisplayCommand::push_state());
            commands.push(DisplayCommand::translate(
                number_value(offset_x),
                number_value(0.0),
            ));
            commands.push(paint_rect_command(
                0.0,
                0.0,
                metadata.width,
                metadata.height,
                chapter.page_background.as_deref().unwrap_or("#ffffff"),
            ));
            commands.push(DisplayCommand::push_state());
            commands.push(DisplayCommand::clip_rect(
                rect_value(0.0, 0.0, metadata.width, metadata.height),
                None,
            ));
            commands.extend(page.commands.iter().cloned());
            commands.push(DisplayCommand::pop_state());
            commands.push(DisplayCommand::pop_state());
        }
        Some(PageArtifactFrame {
            spread_index: spread.index,
            page_indexes,
            commands,
        })
    }

    pub(super) fn spreads(&self) -> Vec<PageArtifactSpread> {
        build_spread_slots(
            self.layout.page_count(),
            self.layout.chapter_start_pages(),
            &self.revision.layout_config,
        )
        .into_iter()
        .map(|spread| PageArtifactSpread {
            spread_index: spread.index,
            left_page_index: spread.left_page_index,
            right_page_index: spread.right_page_index,
        })
        .collect()
    }

    pub(super) fn known_chapters(&self) -> BTreeMap<String, PageArtifactChapterRange> {
        self.layout
            .chapters()
            .filter_map(|(chapter, start_page)| {
                chapter_range(chapter.pages.len(), start_page, chapter.block_count)
                    .map(|range| (chapter.idref.clone(), range))
            })
            .collect()
    }

    pub(super) fn known_chapter(&self, idref: &str) -> Option<PageArtifactChapterRange> {
        let (chapter, start_page) = self.layout.chapter(idref)?;
        chapter_range(chapter.pages.len(), start_page, chapter.block_count)
    }

    pub(super) fn anchor_pages(&self, range: Range<usize>) -> Option<BTreeMap<String, usize>> {
        if range.start > range.end || range.end > self.layout.page_count() {
            return None;
        }
        Some(
            self.layout
                .anchors
                .iter()
                .filter(|(_, page)| range.contains(page))
                .map(|(anchor, page)| (anchor.clone(), *page))
                .collect(),
        )
    }

    pub(super) fn source_run_starts(
        &self,
        _range: Range<usize>,
    ) -> Option<Vec<PageArtifactSourceRunStart>> {
        None
    }

    pub(super) fn resolve_exact_source_range(
        &self,
        _query: PageArtifactExactSourceRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        PageArtifactExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        )
    }

    pub(super) fn resolve_text_caret(
        &self,
        query: PageArtifactTextCaretQuery,
    ) -> Option<PageArtifactTextCaretResolution> {
        let Some(artifact) = self.artifact(query.page_index) else {
            return Some(PageArtifactTextCaretResolution::Miss);
        };
        match caret_from_point(artifact, query.page_index, query.x, query.y) {
            Some(caret) => Some(PageArtifactTextCaretResolution::Resolved(caret)),
            None => Some(PageArtifactTextCaretResolution::Miss),
        }
    }

    pub(super) fn resolve_text_range(
        &self,
        query: PageArtifactTextRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        match self.range_between(query.anchor, query.focus) {
            Some(range) => PageArtifactExactTextRangeResolution::Resolved(Box::new(range)),
            None => PageArtifactExactTextRangeResolution::Unavailable(
                TextInteractionUnavailableReason::InvalidCaret,
            ),
        }
    }

    pub(super) fn resolve_text_range_to_point(
        &self,
        query: PageArtifactTextRangeToPointQuery,
    ) -> PageArtifactTextRangeFromPointsResolution {
        let Some(anchor_caret) = self.caret_at(query.anchor) else {
            return PageArtifactTextRangeFromPointsResolution::Unavailable(
                TextInteractionUnavailableReason::InvalidCaret,
            );
        };
        let Some(focus_caret) = self.caret_near_point(query.focus) else {
            return PageArtifactTextRangeFromPointsResolution::Miss;
        };
        let Some(range) = self.range_between(anchor_caret.address, focus_caret.address) else {
            return PageArtifactTextRangeFromPointsResolution::Unavailable(
                TextInteractionUnavailableReason::InvalidCaret,
            );
        };
        PageArtifactTextRangeFromPointsResolution::Resolved(Box::new(
            PageArtifactTextRangeFromPoints {
                anchor_caret,
                focus_caret,
                range: Box::new(range),
            },
        ))
    }

    pub(super) fn resolve_text_range_from_points(
        &self,
        query: PageArtifactTextRangeFromPointsQuery<'_>,
    ) -> PageArtifactTextRangeFromPointsResolution {
        let Some(anchor_hit) = self.caret_near_point(query.anchor) else {
            return PageArtifactTextRangeFromPointsResolution::Miss;
        };
        let Some(focus_hit) = self.caret_near_point(query.focus) else {
            return PageArtifactTextRangeFromPointsResolution::Miss;
        };
        let (anchor, focus) = match query.granularity {
            PageArtifactTextSelectionGranularity::Word => {
                let Some((start, end)) =
                    self.expand_word(anchor_hit.address, focus_hit.address, query.language)
                else {
                    return PageArtifactTextRangeFromPointsResolution::Miss;
                };
                (start, end)
            }
            PageArtifactTextSelectionGranularity::Paragraph => {
                let Some((start, end)) =
                    self.expand_paragraph(anchor_hit.address, focus_hit.address)
                else {
                    return PageArtifactTextRangeFromPointsResolution::Miss;
                };
                (start, end)
            }
        };
        let Some(anchor_caret) = self.caret_at(anchor) else {
            return PageArtifactTextRangeFromPointsResolution::Miss;
        };
        let Some(focus_caret) = self.caret_at(focus) else {
            return PageArtifactTextRangeFromPointsResolution::Miss;
        };
        let Some(range) = self.range_between(anchor, focus) else {
            return PageArtifactTextRangeFromPointsResolution::Unavailable(
                TextInteractionUnavailableReason::InvalidCaret,
            );
        };
        PageArtifactTextRangeFromPointsResolution::Resolved(Box::new(
            PageArtifactTextRangeFromPoints {
                anchor_caret,
                focus_caret,
                range: Box::new(range),
            },
        ))
    }

    pub(super) fn resolve_text_selection_movement(
        &self,
        _query: PageArtifactTextSelectionMovementQuery<'_>,
    ) -> PageArtifactTextSelectionMovementResolution {
        PageArtifactTextSelectionMovementResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        )
    }

    fn artifact(&self, page_index: usize) -> Option<&'a FragmentPageArtifact> {
        self.layout.page(page_index).map(|page| &page.artifact)
    }

    /// The caret for an exact address, with its geometry recomputed from
    /// the owning run.
    fn caret_at(&self, address: TextCaretAddress) -> Option<PageArtifactTextCaret> {
        let artifact = self.artifact(address.page_index)?;
        let run = artifact.interaction_runs().iter().find(|run| {
            run.block_index == address.block_index
                && run.line_index == address.line_index
                && run.run_index == address.run_index
        })?;
        let length = run.end - run.start;
        if address.char_index > length {
            return None;
        }
        Some(caret_record(address.page_index, run, address.char_index))
    }

    fn caret_near_point(&self, point: PageArtifactTextPoint) -> Option<PageArtifactTextCaret> {
        let artifact = self.artifact(point.page_index)?;
        caret_from_point(artifact, point.page_index, point.x, point.y)
    }

    /// Builds the full range payload between two caret addresses,
    /// normalized to document order across pages.
    fn range_between(
        &self,
        anchor: TextCaretAddress,
        focus: TextCaretAddress,
    ) -> Option<PageArtifactExactTextRange> {
        let (start, end) = if address_key(&focus) < address_key(&anchor) {
            (focus, anchor)
        } else {
            (anchor, focus)
        };
        let mut selected_text = String::new();
        let mut rects = Vec::new();
        for page_index in start.page_index..=end.page_index {
            let Some(artifact) = self.artifact(page_index) else {
                continue;
            };
            let page_start = if page_index == start.page_index {
                position_of(artifact, &start)?
            } else {
                0
            };
            let page_end = if page_index == end.page_index {
                position_of(artifact, &end)?
            } else {
                artifact.page_text().encode_utf16().count()
            };
            if page_end <= page_start {
                continue;
            }
            if !selected_text.is_empty() {
                selected_text.push('\n');
            }
            selected_text.extend(
                char::decode_utf16(
                    artifact
                        .page_text()
                        .encode_utf16()
                        .skip(page_start)
                        .take(page_end - page_start),
                )
                .map(|unit| unit.unwrap_or(char::REPLACEMENT_CHARACTER)),
            );
            for run in artifact.interaction_runs() {
                let clip_start = run.start.max(page_start);
                let clip_end = run.end.min(page_end);
                if clip_end <= clip_start {
                    continue;
                }
                let length = (run.end - run.start).max(1) as f64;
                let from = (clip_start - run.start) as f64 / length;
                let to = (clip_end - run.start) as f64 / length;
                rects.push(PageArtifactExactTextRangeRect {
                    page_index,
                    x: run.x + run.width * from,
                    y: run.y,
                    width: run.width * (to - from),
                    height: run.height,
                    block_index: run.block_index,
                    line_index: run.line_index,
                    run_index: run.run_index,
                    start_char_index: clip_start - run.start,
                    end_char_index: clip_end - run.start,
                });
            }
        }
        Some(PageArtifactExactTextRange {
            anchor,
            focus,
            start,
            end,
            selected_text,
            // Source-domain projections wait on the collapse-aware offset
            // mapping; empty is honest (no segments), and the empty node
            // path marks the locator as unresolved rather than pointing
            // at an arbitrary node.
            exact_source_segments: Vec::new(),
            source_start: PageArtifactSourcePoint {
                node_path: Vec::new(),
                text_offset: 0,
            },
            source_end: PageArtifactSourcePoint {
                node_path: Vec::new(),
                text_offset: 0,
            },
            rects,
        })
    }

    /// Word bounds around the tapped range, in caret addresses.
    fn expand_word(
        &self,
        anchor: TextCaretAddress,
        focus: TextCaretAddress,
        language: Option<&str>,
    ) -> Option<(TextCaretAddress, TextCaretAddress)> {
        if anchor.page_index != focus.page_index {
            return None;
        }
        let artifact = self.artifact(anchor.page_index)?;
        let hit_start = position_of(artifact, &anchor)?.min(position_of(artifact, &focus)?);
        let hit_end = position_of(artifact, &anchor)?.max(position_of(artifact, &focus)?);
        let (start, end) = plain_word_bounds(
            artifact.page_text(),
            hit_start as u32,
            hit_end as u32,
            language,
        )?;
        Some((
            address_of(artifact, anchor.page_index, start as usize)?,
            address_of(artifact, anchor.page_index, end as usize)?,
        ))
    }

    /// The whole block under the tap, page-local (a block split across
    /// pages selects its on-page part).
    fn expand_paragraph(
        &self,
        anchor: TextCaretAddress,
        focus: TextCaretAddress,
    ) -> Option<(TextCaretAddress, TextCaretAddress)> {
        if anchor.page_index != focus.page_index {
            return None;
        }
        let artifact = self.artifact(anchor.page_index)?;
        let block = anchor.block_index;
        let mut start: Option<usize> = None;
        let mut end: Option<usize> = None;
        for run in artifact.interaction_runs() {
            if run.block_index != block {
                continue;
            }
            start = Some(start.map_or(run.start, |value| value.min(run.start)));
            end = Some(end.map_or(run.end, |value| value.max(run.end)));
        }
        Some((
            address_of(artifact, anchor.page_index, start?)?,
            address_of(artifact, anchor.page_index, end?)?,
        ))
    }

    fn spread_slot_count(&self) -> usize {
        build_spread_slots(
            self.layout.page_count(),
            self.layout.chapter_start_pages(),
            &self.revision.layout_config,
        )
        .len()
    }
}

/// Nearest caret to a point: the run whose vertical band contains (or is
/// closest to) the point, then the closest character edge inside it.
fn caret_from_point(
    artifact: &FragmentPageArtifact,
    page_index: usize,
    x: f64,
    y: f64,
) -> Option<PageArtifactTextCaret> {
    let mut best: Option<(f64, &FragmentRunRecord)> = None;
    for run in artifact.interaction_runs() {
        let dy = if y < run.y {
            run.y - y
        } else if y > run.y + run.height {
            y - (run.y + run.height)
        } else {
            0.0
        };
        let dx = if x < run.x {
            run.x - x
        } else if x > run.x + run.width {
            x - (run.x + run.width)
        } else {
            0.0
        };
        // Vertical proximity dominates so a tap between lines picks the
        // nearer line, not a horizontally closer run elsewhere.
        let distance = dy * 1000.0 + dx;
        if best.map_or(true, |(best_distance, _)| distance < best_distance) {
            best = Some((distance, run));
        }
    }
    let (_, run) = best?;
    let length = run.end - run.start;
    let char_index = if length == 0 || run.width <= 0.0 {
        0
    } else {
        (((x - run.x) / run.width * length as f64).round().max(0.0) as usize).min(length)
    };
    Some(caret_record(page_index, run, char_index))
}

fn caret_record(
    page_index: usize,
    run: &FragmentRunRecord,
    char_index: usize,
) -> PageArtifactTextCaret {
    let length = run.end - run.start;
    let ratio = if length == 0 {
        0.0
    } else {
        char_index as f64 / length as f64
    };
    PageArtifactTextCaret {
        address: TextCaretAddress {
            page_index,
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index,
            affinity: TextCaretAffinity::Downstream,
        },
        geometry: TextCaretGeometry {
            x: run.x + run.width * ratio,
            y: run.y,
            height: run.height,
        },
        source_point: PageArtifactSourcePoint {
            node_path: Vec::new(),
            text_offset: 0,
        },
    }
}

/// Document-order key for caret addresses.
fn address_key(address: &TextCaretAddress) -> (usize, usize, usize, usize, usize) {
    (
        address.page_index,
        address.block_index,
        address.line_index,
        address.run_index,
        address.char_index,
    )
}

/// A caret address to its page-text UTF-16 offset.
fn position_of(artifact: &FragmentPageArtifact, address: &TextCaretAddress) -> Option<usize> {
    let run = artifact.interaction_runs().iter().find(|run| {
        run.block_index == address.block_index
            && run.line_index == address.line_index
            && run.run_index == address.run_index
    })?;
    (address.char_index <= run.end - run.start).then(|| run.start + address.char_index)
}

/// A page-text UTF-16 offset back to a caret address. Offsets between
/// runs (line separators) snap to the following run's start.
fn address_of(
    artifact: &FragmentPageArtifact,
    page_index: usize,
    offset: usize,
) -> Option<TextCaretAddress> {
    let runs = artifact.interaction_runs();
    let run = runs
        .iter()
        .find(|run| run.start <= offset && offset <= run.end)
        .or_else(|| runs.iter().find(|run| run.start >= offset))
        .or_else(|| runs.last())?;
    Some(TextCaretAddress {
        page_index,
        block_index: run.block_index,
        line_index: run.line_index,
        run_index: run.run_index,
        char_index: offset.clamp(run.start, run.end) - run.start,
        affinity: TextCaretAffinity::Downstream,
    })
}

fn chapter_range(
    page_count: usize,
    start_page: usize,
    block_count: usize,
) -> Option<PageArtifactChapterRange> {
    if page_count == 0 {
        return None;
    }
    Some(PageArtifactChapterRange {
        start_page,
        end_page: start_page + page_count - 1,
        page_count,
        block_count,
    })
}
