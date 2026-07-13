use std::num::NonZeroUsize;

use serde_json::{Map, Value};

use super::{
    line::{LineBox, LineRun},
    line_align::apply_line_align,
    line_ruby::extract_ruby_annotations,
    text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield},
};

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
    stage: LineFinalizeStage,
}

#[derive(Debug, Default)]
struct PendingLineGeometry {
    index: usize,
    line_width: f64,
    min_top: f64,
    max_bottom: f64,
    ruby_overhang: f64,
    height: f64,
    y_shift: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineFinalizeStage {
    Geometry,
    ShiftY,
    ResolveAlign,
    ShiftX,
    LegacyRuby,
    LegacyAlign,
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
                LineFinalizeStage::ShiftX => self.advance_shift_x(work)?,
                LineFinalizeStage::LegacyRuby => return Ok(self.finish_ruby()),
                LineFinalizeStage::LegacyAlign => return Ok(self.legacy_align(base_style)),
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
            self.stage = LineFinalizeStage::LegacyAlign;
            return;
        }
        self.x_offset = match align {
            "center" if !self.runs.is_empty() => (self.max_width - self.geometry.line_width) / 2.0,
            "right" if !self.runs.is_empty() => self.max_width - self.geometry.line_width,
            _ => 0.0,
        };
        self.stage = LineFinalizeStage::ShiftX;
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

    fn legacy_align(&mut self, base_style: &Map<String, Value>) -> LineBox {
        self.stage = LineFinalizeStage::Complete;
        apply_line_align(
            std::mem::take(&mut self.runs),
            self.geometry.line_width,
            self.y,
            self.geometry.height,
            self.max_width,
            base_style,
            self.is_last_line,
        )
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

impl PendingLineGeometry {
    fn accumulate_metrics(&mut self, run: &LineRun) {
        let Some((top, bottom, ruby)) = run_metrics(run) else {
            return;
        };
        if top < self.min_top {
            self.min_top = top;
        }
        if bottom > self.max_bottom {
            self.max_bottom = bottom;
        }
        if ruby > self.ruby_overhang {
            self.ruby_overhang = ruby;
        }
    }

    fn finish(&mut self, base_line_height: f64) {
        let content_height = base_line_height.max(self.max_bottom - self.min_top);
        self.height = content_height + self.ruby_overhang;
        self.y_shift = if self.min_top < 0.0 {
            -self.min_top
        } else {
            0.0
        } + self.ruby_overhang;
    }
}

fn run_metrics(run: &LineRun) -> Option<(f64, f64, f64)> {
    match run {
        LineRun::Text(run) => {
            let (top, bottom) = if let Some(line_height_px) = run.line_height_px {
                let half_leading = (run.font_size - line_height_px) / 2.0;
                let top = run.y + half_leading;
                (top, top + line_height_px)
            } else {
                (run.y, run.y + run.height)
            };
            let ruby = run
                .ruby_annotation
                .as_ref()
                .map(|_| run.font_size * 0.5 + 1.0)
                .unwrap_or(0.0);
            Some((top, bottom, ruby))
        }
        LineRun::Atom(run) => Some((run.y, run.y + run.height, 0.0)),
        LineRun::Ruby(_) => None,
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
