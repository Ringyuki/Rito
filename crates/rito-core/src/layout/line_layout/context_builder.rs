use std::{
    collections::{BTreeMap, BTreeSet},
    mem,
    sync::OnceLock,
    vec::IntoIter,
};

use serde_json::{Map, Value};

use super::{
    line_height_px, monotonic_measure_style, should_probe_bounded, string_style, LineAtom,
    LineContext, LineStyleRange,
};
use crate::layout::{
    inline_segment::{InlineSegment, TextSegment},
    line_break::{LineBreakOptions, OwnedUtf16TextBuilder},
    text_measure::TextMeasurementFonts,
    text_work::{TextWorkMeter, TextWorkYield},
};

mod preflight;
mod segment;

#[cfg(test)]
mod tests;

use preflight::{ContextCounts, PendingContextPreflight};
use segment::PendingContextSegment;

/// Owns all partially assembled state until a complete line context can be
/// published.
///
/// Both passes meter segment dispatch and individual UTF-16 scalar work. JSON
/// metadata clones, font-family/face predicates, B-tree node allocation, and
/// style-string policy parsing remain explicitly indivisible residual work.
#[derive(Debug)]
pub(crate) struct PendingLineContextBuilder {
    segments: Vec<InlineSegment>,
    assembly_segments: Option<IntoIter<InlineSegment>>,
    preflight: PendingContextPreflight,
    counts: Option<ContextCounts>,
    reserve_step: ReserveStep,
    text: Option<OwnedUtf16TextBuilder>,
    ranges: Option<Vec<LineStyleRange>>,
    atoms: BTreeMap<usize, LineAtom>,
    current: Option<PendingContextSegment>,
    base_style: Option<Map<String, Value>>,
    max_width: f64,
    monotonic_prefix_widths: bool,
    font_profile_id: u64,
    phase: ContextBuildPhase,
    seal_paid: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContextBuildPhase {
    Preflight,
    Reserve,
    Assembly,
    Seal,
    Returned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReserveStep {
    BaseStyle,
    Text,
    Ranges,
}

impl PendingLineContextBuilder {
    pub(crate) fn new(
        segments: Vec<InlineSegment>,
        max_width: f64,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Option<Self> {
        // Preserve the eager empty-session contract (`context: None`).
        segments.first()?;
        Some(Self {
            segments,
            assembly_segments: None,
            preflight: PendingContextPreflight::new(),
            counts: None,
            reserve_step: ReserveStep::BaseStyle,
            text: None,
            ranges: None,
            atoms: BTreeMap::new(),
            current: None,
            base_style: None,
            max_width,
            monotonic_prefix_widths: false,
            font_profile_id: fonts.layout_profile_id(),
            phase: ContextBuildPhase::Preflight,
            seal_paid: false,
        })
    }

    pub(crate) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<LineContext, TextWorkYield> {
        self.require_font_profile(fonts);
        loop {
            match self.phase {
                ContextBuildPhase::Preflight => self.advance_preflight(work)?,
                ContextBuildPhase::Reserve => self.advance_reserve(work)?,
                ContextBuildPhase::Assembly => self.advance_assembly(work, fonts)?,
                ContextBuildPhase::Seal => {
                    if !self.seal_paid {
                        require_unit(work)?;
                        self.seal_paid = true;
                    }
                    return Ok(self.seal());
                }
                ContextBuildPhase::Returned => panic!("line context was already returned"),
            }
        }
    }

    fn advance_preflight(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        let Some(counts) = self.preflight.advance(&self.segments, work)? else {
            return Ok(());
        };
        self.counts = Some(counts);
        self.phase = ContextBuildPhase::Reserve;
        Ok(())
    }

    fn advance_reserve(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        let counts = self.counts.as_ref().expect("completed context preflight");
        require_unit(work)?;
        match self.reserve_step {
            ReserveStep::BaseStyle => {
                // JSON cloning remains atomic, but cannot run after the
                // current quantum has already exhausted its text allowance.
                self.base_style = Some(self.segments[0].style().clone());
                self.monotonic_prefix_widths = should_probe_bounded(counts.utf16_len)
                    && counts.all_text_bmp
                    && monotonic_measure_style(
                        self.base_style.as_ref().expect("reserved base style"),
                    );
                self.reserve_step = ReserveStep::Text;
            }
            ReserveStep::Text => {
                self.text = Some(OwnedUtf16TextBuilder::with_capacities(
                    counts.text_bytes,
                    counts.newline_count,
                ));
                self.reserve_step = ReserveStep::Ranges;
            }
            ReserveStep::Ranges => {
                self.ranges = Some(Vec::with_capacity(counts.range_count));
                self.assembly_segments = Some(mem::take(&mut self.segments).into_iter());
                self.phase = ContextBuildPhase::Assembly;
            }
        }
        Ok(())
    }

    fn advance_assembly(
        &mut self,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<(), TextWorkYield> {
        if self.current.is_none() {
            let segments = self
                .assembly_segments
                .as_mut()
                .expect("reserved assembly segments");
            if segments.len() == 0 {
                self.phase = ContextBuildPhase::Seal;
                return Ok(());
            }
            require_unit(work)?;
            let segment = segments.next().expect("remaining assembly segment");
            let start = self.text.as_ref().expect("reserved text").utf16_len();
            self.current = Some(PendingContextSegment::new(
                segment,
                start,
                &mut self.monotonic_prefix_widths,
                fonts,
            ));
        }
        let complete = self.current.as_mut().expect("current segment").advance(
            self.text.as_mut().expect("reserved text"),
            work,
            fonts,
            &mut self.monotonic_prefix_widths,
        )?;
        if complete {
            self.current.take().expect("completed segment").finish(
                self.text.as_ref().expect("reserved text").utf16_len(),
                self.ranges.as_mut().expect("reserved ranges"),
                &mut self.atoms,
            );
        }
        Ok(())
    }

    fn seal(&mut self) -> LineContext {
        self.phase = ContextBuildPhase::Returned;
        let counts = self.counts.take().expect("completed context counts");
        let text = self.text.take().expect("assembled context text");
        let base_style = self.base_style.take().expect("reserved base style");
        debug_assert_eq!(text.utf16_len(), counts.utf16_len);
        debug_assert_eq!(self.atoms.len(), counts.atom_count);
        debug_assert_eq!(
            self.ranges.as_ref().expect("assembled ranges").len(),
            counts.range_count
        );
        LineContext {
            text: text.finish(),
            ranges: self.ranges.take().expect("assembled ranges"),
            atoms: mem::take(&mut self.atoms),
            max_width: self.max_width,
            line_height: line_height_px(&base_style),
            preserve_ws: preserve_whitespace(&base_style),
            allow_wrap: allow_wrap(&base_style),
            line_break_options: line_break_options(&base_style),
            break_offsets: OnceLock::<BTreeSet<usize>>::new(),
            base_style,
            monotonic_prefix_widths: self.monotonic_prefix_widths,
            initially_complete: !counts.has_non_whitespace
                && !counts.has_newline
                && counts.atom_count == 0,
        }
    }

    fn require_font_profile(&self, fonts: &TextMeasurementFonts<'_>) {
        assert_eq!(
            fonts.layout_profile_id(),
            self.font_profile_id,
            "a pending line-context builder must resume with the same font profile"
        );
    }
}

fn preserve_whitespace(style: &Map<String, Value>) -> bool {
    matches!(
        string_style(style, "whiteSpace").as_deref(),
        Some("pre" | "pre-wrap")
    )
}

fn allow_wrap(style: &Map<String, Value>) -> bool {
    !matches!(
        string_style(style, "whiteSpace").as_deref(),
        Some("pre" | "nowrap")
    )
}

fn line_break_options(style: &Map<String, Value>) -> LineBreakOptions {
    // Language normalization and style-string clones are metadata-sized seal
    // work; no completed text is traversed here.
    LineBreakOptions::from_style(
        string_style(style, "lineBreak").as_deref(),
        string_style(style, "wordBreak").as_deref(),
        string_style(style, "language").as_deref(),
    )
}

fn require_unit(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    if work.take_utf16_units(1) == 1 {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}

fn finish_text_range(segment: TextSegment, start: usize, end: usize) -> Option<LineStyleRange> {
    if start == end {
        return None;
    }
    let text_mapping = segment.run_text_mapping(
        0,
        end.checked_sub(start)
            .expect("assembled text range offsets are ordered"),
    );
    Some(LineStyleRange {
        start,
        end,
        style: segment.style,
        href: segment.href,
        source_path: segment.source_path,
        source_text: segment.source_text,
        source_text_offset: segment.source_text_offset,
        ruby_annotation: segment.ruby_annotation,
        inline_margin_left: segment.inline_margin_left,
        inline_margin_right: segment.inline_margin_right,
        border_start: segment.border_start,
        border_end: segment.border_end,
        text_mapping,
    })
}
