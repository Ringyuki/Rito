use crate::layout::{
    line::LineRun,
    text_mapping::RunTextMapping,
    text_measure::TextMeasurementFonts,
    text_shape::{RunShape, RunShapeUnavailableReason},
    text_work::{AtomicTextOperationKind, TextWorkMeter},
};

use super::super::resumable_break::PendingBreakSession;
use super::super::{
    find_range, number_style, runs_width, utf16_len, LineContext, SingleLineLayout,
};
use super::run_builder::PendingRunBuilder;
use super::{require_atomic, require_character_work, TextWorkYield};

#[derive(Debug)]
pub(super) struct PendingLineLayout {
    cursor: usize,
    skip_spaces: bool,
    is_first_line: bool,
    active: Option<PendingActiveLine>,
}

impl PendingLineLayout {
    pub(super) fn new(pos: usize, is_first_line: bool, indent: f64, context: &LineContext) -> Self {
        Self {
            cursor: pos,
            skip_spaces: !context.preserve_ws && (!is_first_line || indent <= 0.0),
            is_first_line,
            active: None,
        }
    }

    pub(super) fn advance(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<PendingLineResult, TextWorkYield> {
        if self.skip_spaces {
            while self.cursor < context.text.len && context.text.char_at(self.cursor) == Some(' ') {
                require_character_work(work, 1)?;
                self.cursor += 1;
            }
            self.skip_spaces = false;
        }
        if self.cursor >= context.text.len {
            return Ok(PendingLineResult::Exhausted { pos: self.cursor });
        }
        let active = self.active.get_or_insert_with(|| {
            PendingActiveLine::new(context, self.cursor, self.is_first_line)
        });
        active
            .advance(context, work, fonts)
            .map(PendingLineResult::Line)
    }
}

pub(super) enum PendingLineResult {
    Exhausted { pos: usize },
    Line(SingleLineLayout),
}

#[derive(Debug)]
struct PendingActiveLine {
    start: usize,
    line_end: usize,
    newline_index: Option<usize>,
    effective_max: f64,
    line_start_x: f64,
    break_session: PendingBreakSession,
    break_result: Option<super::super::LineBreakPosition>,
    line_text_end: Option<usize>,
    ends_with_forced_break: bool,
    trim_cursor: Option<usize>,
    render_end: Option<usize>,
    runs: Option<Vec<LineRun>>,
    run_builder: Option<PendingRunBuilder>,
    hyphen_complete: bool,
}

impl PendingActiveLine {
    fn new(context: &LineContext, start: usize, is_first_line: bool) -> Self {
        let indent = number_style(&context.base_style, "textIndent").unwrap_or(0.0);
        let effective_max = if is_first_line && indent != 0.0 {
            context.max_width - indent
        } else {
            context.max_width
        };
        let line_start_x = if is_first_line && indent != 0.0 {
            indent
        } else {
            0.0
        };
        let newline_index = context.text.find_char(start, '\n');
        Self {
            start,
            line_end: newline_index.unwrap_or(context.text.len),
            newline_index,
            effective_max,
            line_start_x,
            break_session: PendingBreakSession::new(),
            break_result: None,
            line_text_end: None,
            ends_with_forced_break: false,
            trim_cursor: None,
            render_end: None,
            runs: None,
            run_builder: None,
            hyphen_complete: false,
        }
    }

    fn advance(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<SingleLineLayout, TextWorkYield> {
        self.resolve_break(context, work, fonts)?;
        self.resolve_render_end(context, work)?;
        self.build_runs(context, work, fonts)?;
        self.append_hyphen(context, work, fonts)?;
        let runs = self.runs.take().expect("completed line runs exist");
        Ok(SingleLineLayout {
            width: runs_width(&runs),
            runs,
            next_pos: self.line_text_end.expect("line end is resolved"),
            ends_with_forced_break: self.ends_with_forced_break,
        })
    }

    fn resolve_break(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<(), TextWorkYield> {
        if self.break_result.is_some() {
            return Ok(());
        }
        let result = if context.allow_wrap {
            self.break_session.advance(
                context,
                self.start,
                self.line_end,
                self.effective_max,
                fonts,
                work,
            )?
        } else {
            super::super::LineBreakPosition {
                position: self.line_end,
                hyphenated: false,
            }
        };
        let line_text_end = if result.position <= self.start {
            context.text.next_offset(self.start)
        } else {
            result.position
        };
        self.ends_with_forced_break = self
            .newline_index
            .is_some_and(|index| line_text_end >= index);
        self.line_text_end = Some(line_text_end);
        self.break_result = Some(result);
        Ok(())
    }

    fn resolve_render_end(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if self.render_end.is_some() {
            return Ok(());
        }
        let mut end = self
            .trim_cursor
            .unwrap_or_else(|| self.line_text_end.expect("line end is resolved"));
        if !context.preserve_ws {
            while end > self.start
                && context
                    .text
                    .char_before(end)
                    .is_some_and(char::is_whitespace)
            {
                require_character_work(work, 1)?;
                end -= 1;
                self.trim_cursor = Some(end);
            }
        }
        self.render_end = Some(end);
        self.trim_cursor = None;
        Ok(())
    }

    fn build_runs(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<(), TextWorkYield> {
        if self.runs.is_some() {
            return Ok(());
        }
        let builder = self.run_builder.get_or_insert_with(|| {
            PendingRunBuilder::new(
                self.start,
                self.render_end.expect("render end is resolved"),
                self.line_start_x,
            )
        });
        builder.advance(context, work, fonts)?;
        if builder.is_complete() {
            self.runs = Some(
                self.run_builder
                    .take()
                    .expect("run builder exists")
                    .finish(),
            );
        }
        Ok(())
    }

    fn append_hyphen(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<(), TextWorkYield> {
        if self.hyphen_complete {
            return Ok(());
        }
        let break_result = self.break_result.expect("break result is resolved");
        if !break_result.hyphenated {
            self.hyphen_complete = true;
            return Ok(());
        }
        let Some(range) = break_result
            .position
            .checked_sub(1)
            .and_then(|position| find_range(&context.ranges, position))
        else {
            self.hyphen_complete = true;
            return Ok(());
        };
        let Some(LineRun::Text(run)) = self.runs.as_mut().expect("line runs are built").last_mut()
        else {
            self.hyphen_complete = true;
            return Ok(());
        };
        require_atomic(
            work,
            AtomicTextOperationKind::Measure,
            utf16_len(&run.text).saturating_add(1),
        )?;
        run.text.push('-');
        run.width = super::super::measure_text_slice_with_fonts(&run.text, &range.style, fonts);
        run.text_mapping = RunTextMapping::synthetic();
        run.shape =
            RunShape::unavailable(RunShapeUnavailableReason::SyntheticLayoutText, run.width);
        self.hyphen_complete = true;
        Ok(())
    }
}
