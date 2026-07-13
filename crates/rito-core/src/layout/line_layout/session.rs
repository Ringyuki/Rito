use std::num::NonZeroUsize;

use super::{build_line_context, consume_newline, number_style, LineContext};
use crate::layout::{
    line::LineBox,
    line_finalize::{LineWidthMetric, PendingLineFinalizer},
    text_measure::TextMeasurementFonts,
    text_work::{
        AtomicTextOperationKind, TextWorkBudget, TextWorkMeter, TextWorkPermitResult, TextWorkYield,
    },
};

mod pending_line;
mod run_builder;

use pending_line::{PendingLineLayout, PendingLineResult};

#[derive(Debug)]
pub(crate) struct GreedyLineLayoutSession {
    pub(super) context: Option<LineContext>,
    pos: usize,
    y: f64,
    is_first_line: bool,
    indent: f64,
    complete: bool,
    font_profile_id: u64,
    pending_line: Option<PendingGreedyLine>,
}

impl GreedyLineLayoutSession {
    pub(crate) fn new(
        segments: &[crate::layout::inline_segment::InlineSegment],
        max_width: f64,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Self {
        let Some(base_style) = segments.first().map(|segment| segment.style()).cloned() else {
            return Self::empty(fonts.layout_profile_id());
        };
        let indent = number_style(&base_style, "textIndent").unwrap_or(0.0);
        let context = build_line_context(segments, base_style, max_width, fonts);
        let complete = context.text.as_str().trim().is_empty()
            && !context.text.as_str().contains('\n')
            && context.atoms.is_empty();
        Self {
            context: Some(context),
            pos: 0,
            y: 0.0,
            is_first_line: true,
            indent,
            complete,
            font_profile_id: fonts.layout_profile_id(),
            pending_line: None,
        }
    }

    pub(crate) fn advance(
        &mut self,
        max_lines: usize,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Vec<LineBox> {
        let budget = TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MAX);
        let mut work = TextWorkMeter::new(budget);
        self.advance_with_text_work(max_lines, &mut work, fonts)
    }

    pub(crate) fn advance_with_text_work(
        &mut self,
        max_lines: usize,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Vec<LineBox> {
        if max_lines == 0 || self.complete {
            return Vec::new();
        }
        assert_eq!(
            fonts.layout_profile_id(),
            self.font_profile_id,
            "a greedy line-layout session must resume with the same font profile"
        );
        let mut lines = Vec::new();
        while lines.len() < max_lines {
            match self.advance_next_line(work, fonts) {
                PendingLineAdvance::Line(line) => lines.push(line),
                PendingLineAdvance::Yield | PendingLineAdvance::Complete => break,
            }
        }
        lines
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.complete
    }

    #[cfg(test)]
    pub(super) fn is_analyzing_justify(&self) -> bool {
        matches!(
            &self.pending_line,
            Some(PendingGreedyLine::Finalizing(finalizing))
                if finalizing.finalizer.is_analyzing_justify()
        )
    }

    fn advance_next_line(
        &mut self,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> PendingLineAdvance {
        if self.complete {
            return PendingLineAdvance::Complete;
        }
        let Some(context) = self.context.as_ref() else {
            self.complete = true;
            return PendingLineAdvance::Complete;
        };
        let mut pending = self.pending_line.take().unwrap_or_else(|| {
            PendingGreedyLine::Building(Box::new(PendingLineLayout::new(
                self.pos,
                self.is_first_line,
                self.indent,
                context,
            )))
        });
        loop {
            pending = match pending {
                PendingGreedyLine::Building(mut building) => {
                    match building.advance(context, work, fonts) {
                        Err(TextWorkYield) => {
                            self.pending_line = Some(PendingGreedyLine::Building(building));
                            return PendingLineAdvance::Yield;
                        }
                        Ok(PendingLineResult::Exhausted { pos }) => {
                            self.pos = pos;
                            self.complete = true;
                            return PendingLineAdvance::Complete;
                        }
                        Ok(PendingLineResult::Line(line)) => PendingGreedyLine::Finalizing(
                            Box::new(PendingGreedyLineFinalization::new(line, self.y, context)),
                        ),
                    }
                }
                PendingGreedyLine::Finalizing(mut finalizing) => {
                    let output = match finalizing.finalizer.advance(work, &context.base_style) {
                        Ok(output) => output,
                        Err(TextWorkYield) => {
                            self.pending_line = Some(PendingGreedyLine::Finalizing(finalizing));
                            return PendingLineAdvance::Yield;
                        }
                    };
                    self.pos = finalizing.next_pos;
                    self.complete = finalizing.complete;
                    self.y += output.height;
                    self.is_first_line = false;
                    return PendingLineAdvance::Line(output);
                }
            };
        }
    }

    fn empty(font_profile_id: u64) -> Self {
        Self {
            context: None,
            pos: 0,
            y: 0.0,
            is_first_line: true,
            indent: 0.0,
            complete: true,
            font_profile_id,
            pending_line: None,
        }
    }
}

enum PendingLineAdvance {
    Line(LineBox),
    Yield,
    Complete,
}

#[derive(Debug)]
enum PendingGreedyLine {
    Building(Box<PendingLineLayout>),
    Finalizing(Box<PendingGreedyLineFinalization>),
}

#[derive(Debug)]
struct PendingGreedyLineFinalization {
    finalizer: PendingLineFinalizer,
    next_pos: usize,
    complete: bool,
}

impl PendingGreedyLineFinalization {
    fn new(line: super::SingleLineLayout, y: f64, context: &LineContext) -> Self {
        let next_pos = consume_newline(&context.text, line.next_pos);
        let complete = next_pos >= context.text.len;
        let is_last_line = complete || line.ends_with_forced_break;
        Self {
            finalizer: PendingLineFinalizer::new(
                line.runs,
                LineWidthMetric::AdvanceRight,
                y,
                context.line_height,
                context.max_width,
                is_last_line,
            ),
            next_pos,
            complete,
        }
    }
}

pub(super) fn require_character_work(
    work: &mut TextWorkMeter,
    utf16_units: usize,
) -> Result<(), TextWorkYield> {
    if work.take_utf16_units(utf16_units) == utf16_units {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}

pub(super) fn require_atomic(
    work: &mut TextWorkMeter,
    kind: AtomicTextOperationKind,
    utf16_units: usize,
) -> Result<(), TextWorkYield> {
    match work.try_permit_atomic(kind, utf16_units) {
        TextWorkPermitResult::Permit { .. } => Ok(()),
        TextWorkPermitResult::Yield => Err(TextWorkYield),
    }
}
