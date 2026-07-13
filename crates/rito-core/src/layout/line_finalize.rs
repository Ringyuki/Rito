use std::num::NonZeroUsize;

use serde_json::{Map, Value};

use super::{
    line::{LineBox, LineRun},
    line_align::apply_justify_plan,
    line_ruby::extract_ruby_annotations,
    text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield},
};

mod geometry;
mod justify;

use geometry::PendingLineGeometry;
use justify::{JustifyMode, PendingJustifyAnalysis};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LineWidthMetric {
    AdvanceRight,
    Right,
}

#[derive(Debug)]
pub(crate) struct PendingLineFinalizer {
    runs: Vec<LineRun>,
    width_metric: LineWidthMetric,
    y: f64,
    base_line_height: f64,
    max_width: f64,
    is_last_line: bool,
    geometry: PendingLineGeometry,
    shift_y_index: usize,
    shift_x_index: usize,
    x_offset: f64,
    justify: Option<PendingJustifyAnalysis>,
    stage: LineFinalizeStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineFinalizeStage {
    Geometry,
    ShiftY,
    ResolveAlign,
    AnalyzeJustify,
    ShiftX,
    LegacyRuby,
    Complete,
}

impl PendingLineFinalizer {
    pub(crate) fn new(
        runs: Vec<LineRun>,
        width_metric: LineWidthMetric,
        y: f64,
        base_line_height: f64,
        max_width: f64,
        is_last_line: bool,
    ) -> Self {
        Self {
            runs,
            width_metric,
            y,
            base_line_height,
            max_width,
            is_last_line,
            geometry: PendingLineGeometry::default(),
            shift_y_index: 0,
            shift_x_index: 0,
            x_offset: 0.0,
            justify: None,
            stage: LineFinalizeStage::Geometry,
        }
    }

    pub(crate) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
        base_style: &Map<String, Value>,
    ) -> Result<LineBox, TextWorkYield> {
        loop {
            match self.stage {
                LineFinalizeStage::Geometry => self.advance_geometry(work)?,
                LineFinalizeStage::ShiftY => self.advance_shift_y(work)?,
                LineFinalizeStage::ResolveAlign => self.resolve_align(base_style),
                LineFinalizeStage::AnalyzeJustify => self.advance_justify(work)?,
                LineFinalizeStage::ShiftX => self.advance_shift_x(work)?,
                LineFinalizeStage::LegacyRuby => return Ok(self.finish_ruby()),
                LineFinalizeStage::Complete => {
                    unreachable!("a completed line finalizer cannot be resumed")
                }
            }
        }
    }

    fn advance_geometry(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        while self.geometry.index < self.runs.len() {
            require_run_work(work)?;
            let run = &self.runs[self.geometry.index];
            self.geometry.line_width = self
                .geometry
                .line_width
                .max(self.width_metric.run_right(run));
            self.geometry.accumulate_metrics(run);
            self.geometry.index += 1;
        }
        self.geometry.finish(self.base_line_height);
        self.stage = LineFinalizeStage::ShiftY;
        Ok(())
    }

    fn advance_shift_y(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        if self.geometry.y_shift != 0.0 {
            while self.shift_y_index < self.runs.len() {
                require_run_work(work)?;
                self.runs[self.shift_y_index].shift_y(self.geometry.y_shift);
                self.shift_y_index += 1;
            }
        }
        self.stage = LineFinalizeStage::ResolveAlign;
        Ok(())
    }

    fn resolve_align(&mut self, base_style: &Map<String, Value>) {
        let align = base_style
            .get("textAlign")
            .and_then(Value::as_str)
            .unwrap_or("left");
        if align == "justify" {
            self.resolve_justify(base_style);
            return;
        }
        self.x_offset = match align {
            "center" if !self.runs.is_empty() => (self.max_width - self.geometry.line_width) / 2.0,
            "right" if !self.runs.is_empty() => self.max_width - self.geometry.line_width,
            _ => 0.0,
        };
        self.stage = LineFinalizeStage::ShiftX;
    }

    fn resolve_justify(&mut self, base_style: &Map<String, Value>) {
        if self.is_last_line || self.runs.is_empty() {
            self.stage = LineFinalizeStage::LegacyRuby;
            return;
        }
        let extra = self.max_width - self.geometry.line_width;
        let text_justify = base_style
            .get("textJustify")
            .and_then(Value::as_str)
            .unwrap_or("auto");
        let mode = JustifyMode::from_css(text_justify);
        if extra <= 0.0 || mode.is_none() {
            self.stage = LineFinalizeStage::LegacyRuby;
            return;
        }
        self.justify = Some(PendingJustifyAnalysis::new(
            mode.expect("none was handled"),
            self.runs.len(),
        ));
        self.stage = LineFinalizeStage::AnalyzeJustify;
    }

    fn advance_justify(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        let plan = self
            .justify
            .as_mut()
            .expect("justify analysis is initialized")
            .advance(&self.runs, work)?;
        self.justify = None;
        let extra = self.max_width - self.geometry.line_width;
        self.runs = apply_justify_plan(std::mem::take(&mut self.runs), extra, plan);
        self.stage = LineFinalizeStage::LegacyRuby;
        Ok(())
    }

    fn advance_shift_x(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        if self.x_offset != 0.0 {
            while self.shift_x_index < self.runs.len() {
                require_run_work(work)?;
                self.runs[self.shift_x_index].shift_x(self.x_offset);
                self.shift_x_index += 1;
            }
        }
        self.stage = LineFinalizeStage::LegacyRuby;
        Ok(())
    }

    fn finish_ruby(&mut self) -> LineBox {
        self.stage = LineFinalizeStage::Complete;
        LineBox {
            x: 0.0,
            y: self.y,
            width: self.max_width,
            height: self.geometry.height,
            runs: extract_ruby_annotations(std::mem::take(&mut self.runs), self.y),
        }
    }

    #[cfg(test)]
    pub(crate) fn is_analyzing_justify(&self) -> bool {
        self.stage == LineFinalizeStage::AnalyzeJustify
    }
}

impl LineWidthMetric {
    fn run_right(self, run: &LineRun) -> f64 {
        match self {
            Self::AdvanceRight => run.advance_right(),
            Self::Right => run.right(),
        }
    }
}

fn require_run_work(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    if work.take_utf16_units(1) == 1 {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}

pub(crate) fn finalize_line_eager(
    runs: Vec<LineRun>,
    width_metric: LineWidthMetric,
    y: f64,
    base_line_height: f64,
    max_width: f64,
    base_style: &Map<String, Value>,
    is_last_line: bool,
) -> LineBox {
    let mut pending = PendingLineFinalizer::new(
        runs,
        width_metric,
        y,
        base_line_height,
        max_width,
        is_last_line,
    );
    loop {
        let budget = TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MAX);
        let mut work = TextWorkMeter::new(budget);
        if let Ok(line) = pending.advance(&mut work, base_style) {
            return line;
        }
    }
}

#[cfg(test)]
mod tests;
