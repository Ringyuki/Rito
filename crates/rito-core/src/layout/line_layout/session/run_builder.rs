use crate::layout::{
    line::{LineRun, RunSourceProvenance, TextRunBox},
    text_measure::TextMeasurementFonts,
    text_shape::RunShape,
    text_work::{AtomicTextOperationKind, TextWorkMeter},
};

use super::super::{
    build_inline_atom, build_text_run, range_spacing, shape_text_with_style, BuildTextRunInput,
    LineContext, LineStyleRange, RangeEdges,
};
use super::{require_atomic, require_character_work, TextWorkYield};

#[derive(Debug)]
pub(super) struct PendingRunBuilder {
    pos: usize,
    render_end: usize,
    x: f64,
    runs: Vec<LineRun>,
    pending_text: Option<PendingTextRun>,
}

impl PendingRunBuilder {
    pub(super) fn new(pos: usize, render_end: usize, x: f64) -> Self {
        Self {
            pos,
            render_end,
            x,
            runs: Vec::new(),
            pending_text: None,
        }
    }

    pub(super) fn advance(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<(), TextWorkYield> {
        while self.pos < self.render_end {
            if let Some(pending) = self.pending_text.as_mut() {
                let result = pending.advance(context, work, fonts)?;
                if let Some((run, next_x)) = result {
                    self.x = next_x;
                    self.runs.push(LineRun::Text(run));
                }
                self.pos = pending.range_end;
                self.pending_text = None;
                continue;
            }
            if let Some(atom) = context.atoms.get(&self.pos) {
                require_character_work(work, 1)?;
                self.runs.push(LineRun::Atom(build_inline_atom(
                    atom,
                    self.x,
                    context.line_height,
                    context,
                )));
                self.x += atom.width;
                self.pos += 1;
                continue;
            }
            let Some(range_index) = find_range_index(&context.ranges, self.pos) else {
                self.pos = self.render_end;
                break;
            };
            let range_end = context.ranges[range_index].end.min(self.render_end);
            self.pending_text = Some(PendingTextRun::new(
                range_index,
                self.pos,
                range_end,
                self.x,
            ));
        }
        Ok(())
    }

    pub(super) fn is_complete(&self) -> bool {
        self.pos >= self.render_end && self.pending_text.is_none()
    }

    pub(super) fn finish(self) -> Vec<LineRun> {
        self.runs
    }
}

#[derive(Debug)]
struct PendingTextRun {
    range_index: usize,
    start: usize,
    range_end: usize,
    start_x: f64,
    text: String,
    text_utf16_len: usize,
    copy_cursor: usize,
    pending_copy_units: usize,
    stage: PendingTextRunStage,
}

#[derive(Debug, Clone, Copy)]
enum PendingTextRunStage {
    Copy,
    Measure,
    Shape { width: f64 },
    Complete,
}

impl PendingTextRun {
    fn new(range_index: usize, start: usize, range_end: usize, start_x: f64) -> Self {
        Self {
            range_index,
            start,
            range_end,
            start_x,
            text: String::new(),
            text_utf16_len: 0,
            copy_cursor: start,
            pending_copy_units: 0,
            stage: PendingTextRunStage::Copy,
        }
    }

    fn advance(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Result<Option<(TextRunBox, f64)>, TextWorkYield> {
        loop {
            match self.stage {
                PendingTextRunStage::Copy => self.copy_text(context, work)?,
                PendingTextRunStage::Measure => {
                    require_atomic(work, AtomicTextOperationKind::Measure, self.text_utf16_len)?;
                    let range = &context.ranges[self.range_index];
                    let width = super::super::measure_text_slice_with_fonts(
                        &self.text,
                        &range.style,
                        fonts,
                    );
                    self.stage = PendingTextRunStage::Shape { width };
                }
                PendingTextRunStage::Shape { width } => {
                    require_atomic(work, AtomicTextOperationKind::Shape, self.text_utf16_len)?;
                    let range = &context.ranges[self.range_index];
                    let shape = shape_text_with_style(&self.text, &range.style, fonts);
                    debug_assert!((shape.advance() - width).abs() < 0.000_001);
                    let (run, next_x) = self.build_run(context, width, shape, fonts);
                    self.stage = PendingTextRunStage::Complete;
                    return Ok(Some((run, next_x)));
                }
                PendingTextRunStage::Complete => unreachable!("completed text run is consumed"),
            }
            if matches!(self.stage, PendingTextRunStage::Measure) && self.text.is_empty() {
                self.stage = PendingTextRunStage::Complete;
                return Ok(None);
            }
        }
    }

    fn copy_text(
        &mut self,
        context: &LineContext,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        while self.copy_cursor < self.range_end {
            let character = context
                .text
                .char_at(self.copy_cursor)
                .expect("run copy stays on a text boundary");
            if self.pending_copy_units == 0 {
                self.pending_copy_units = character.len_utf16();
            }
            let taken = work.take_utf16_units(self.pending_copy_units);
            self.pending_copy_units -= taken;
            if self.pending_copy_units > 0 {
                return Err(TextWorkYield);
            }
            self.text.push(character);
            self.text_utf16_len += character.len_utf16();
            self.copy_cursor += character.len_utf16();
        }
        self.stage = PendingTextRunStage::Measure;
        Ok(())
    }

    fn build_run(
        &mut self,
        context: &LineContext,
        width: f64,
        shape: RunShape,
        fonts: &TextMeasurementFonts<'_>,
    ) -> (TextRunBox, f64) {
        let range = &context.ranges[self.range_index];
        let edges = RangeEdges {
            is_start: range.border_start && self.start == range.start,
            is_end: range.border_end && self.range_end >= range.end,
            line_range_end: self.range_end,
        };
        let spacing = range_spacing(range, &edges, self.start);
        let source_provenance = RunSourceProvenance::checked(
            range.source_path.as_deref(),
            range.source_text.as_ref(),
            range.source_text_offset,
            self.start.checked_sub(range.start),
        );
        let text_mapping = range
            .text_mapping
            .subslice(self.start - range.start, self.range_end - range.start);
        let mut run = build_text_run(BuildTextRunInput {
            text: std::mem::take(&mut self.text),
            text_mapping,
            x: self.start_x + spacing.margin_left + spacing.inset_left,
            line_height: context.line_height,
            width,
            range,
            is_start: edges.is_start,
            is_end: edges.is_end,
            source_provenance,
            context,
            fonts,
            shape,
        });
        if spacing.margin_right > 0.0 {
            run.inline_margin_right = Some(spacing.margin_right);
        }
        let next_x = self.start_x
            + spacing.inset_left
            + spacing.margin_left
            + run.width
            + spacing.inset_right
            + spacing.margin_right;
        (run, next_x)
    }
}

fn find_range_index(ranges: &[LineStyleRange], pos: usize) -> Option<usize> {
    let index = ranges.partition_point(|range| range.start <= pos);
    if index == 0 || pos >= ranges[index - 1].end {
        None
    } else {
        Some(index - 1)
    }
}
