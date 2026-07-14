use serde_json::{Map, Number, Value};

use super::{
    line::{LineRun, RubyRunBox},
    style_values::paint_number_value,
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug)]
pub(crate) struct PendingRubyExtraction {
    runs: Vec<LineRun>,
    scan_index: usize,
    previous_tagged_index: Option<usize>,
    ruby_group_count: usize,
    remaining: Option<std::vec::IntoIter<LineRun>>,
    output: Vec<LineRun>,
    active_group: Option<RubyGroup>,
    line_y: f64,
    complete: bool,
}

impl PendingRubyExtraction {
    pub(crate) fn new(runs: Vec<LineRun>, line_y: f64) -> Self {
        Self {
            runs,
            scan_index: 0,
            previous_tagged_index: None,
            ruby_group_count: 0,
            remaining: None,
            output: Vec::new(),
            active_group: None,
            line_y,
            complete: false,
        }
    }

    pub(crate) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<Vec<LineRun>, TextWorkYield> {
        assert!(
            !self.complete,
            "completed ruby extraction cannot be resumed"
        );
        self.scan_groups(work)?;
        if self.ruby_group_count == 0 {
            self.complete = true;
            return Ok(std::mem::take(&mut self.runs));
        }
        if self.remaining.is_none() {
            require_run_work(work)?;
            self.initialize_output();
            self.consume_next_run();
        }
        while self
            .remaining
            .as_ref()
            .is_some_and(|remaining| !remaining.as_slice().is_empty())
        {
            require_run_work(work)?;
            self.consume_next_run();
        }
        self.flush_group();
        self.complete = true;
        Ok(std::mem::take(&mut self.output))
    }

    fn scan_groups(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        while self.scan_index < self.runs.len() {
            require_run_work(work)?;
            let annotation = ruby_annotation(&self.runs[self.scan_index]);
            let continues_group = self.previous_tagged_index.is_some_and(|index| {
                ruby_annotation(&self.runs[index]) == annotation && annotation.is_some()
            });
            if annotation.is_some() && !continues_group {
                self.ruby_group_count += 1;
            }
            self.previous_tagged_index = annotation.map(|_| self.scan_index);
            self.scan_index += 1;
        }
        Ok(())
    }

    fn initialize_output(&mut self) {
        if self.remaining.is_some() {
            return;
        }
        let output_capacity = self
            .runs
            .len()
            .checked_add(self.ruby_group_count)
            .expect("ruby output length must fit usize");
        self.output = Vec::with_capacity(output_capacity);
        self.remaining = Some(std::mem::take(&mut self.runs).into_iter());
    }

    fn consume_next_run(&mut self) {
        let run = self
            .remaining
            .as_mut()
            .expect("ruby extraction input is initialized")
            .next()
            .expect("ruby extraction input must have a next run");
        self.consume_run(run);
    }

    fn consume_run(&mut self, run: LineRun) {
        let continues_group = self
            .active_group
            .as_ref()
            .is_some_and(|group| group.includes(&run));
        if continues_group {
            self.active_group
                .as_mut()
                .expect("matching ruby group must exist")
                .extend_to(&run);
            self.output.push(run);
            return;
        }

        self.flush_group();
        self.active_group = RubyGroup::start(&run, self.line_y);
        self.output.push(run);
    }

    fn flush_group(&mut self) {
        if let Some(group) = self.active_group.take() {
            self.output.push(LineRun::Ruby(group.finish()));
        }
    }
}

#[cfg(test)]
pub(crate) fn extract_ruby_annotations(runs: Vec<LineRun>, line_y: f64) -> Vec<LineRun> {
    let mut out = Vec::with_capacity(runs.len());
    let mut remaining = runs.into_iter().peekable();
    while let Some(run) = remaining.next() {
        let Some(mut group) = RubyGroup::start(&run, line_y) else {
            out.push(run);
            continue;
        };

        out.push(run);
        while remaining.peek().is_some_and(|run| group.includes(run)) {
            let run = remaining
                .next()
                .expect("peeked ruby group continuation must exist");
            group.extend_to(&run);
            out.push(run);
        }
        out.push(LineRun::Ruby(group.finish()));
    }
    out
}

fn ruby_annotation(run: &LineRun) -> Option<&str> {
    match run {
        LineRun::Text(run) => run.ruby_annotation.as_deref(),
        LineRun::Atom(_) | LineRun::Ruby(_) => None,
    }
}

#[derive(Debug)]
struct RubyGroup {
    tag: String,
    start_x: f64,
    end_right: f64,
    y: f64,
    font_size: f64,
    paint: Value,
}

impl RubyGroup {
    fn start(run: &LineRun, line_y: f64) -> Option<Self> {
        let LineRun::Text(run) = run else {
            return None;
        };
        let tag = run.ruby_annotation.clone()?;
        let font_size = run.font_size * 0.5;
        Some(Self {
            tag,
            start_x: run.x,
            end_right: run.x + run.width,
            y: line_y + run.y - font_size - 1.0,
            font_size,
            paint: ruby_paint_value(&run.paint, font_size),
        })
    }

    fn includes(&self, run: &LineRun) -> bool {
        matches!(
            run,
            LineRun::Text(run) if run.ruby_annotation.as_deref() == Some(self.tag.as_str())
        )
    }

    fn extend_to(&mut self, run: &LineRun) {
        let LineRun::Text(run) = run else {
            unreachable!("ruby group continuation must be a text run");
        };
        self.end_right = run.x + run.width;
    }

    fn finish(self) -> RubyRunBox {
        RubyRunBox {
            text: self.tag,
            x: self.start_x,
            y: self.y,
            width: self.end_right - self.start_x,
            height: self.font_size,
            paint: self.paint,
        }
    }
}

fn ruby_paint_value(base_paint: &Value, ruby_font_size: f64) -> Value {
    let mut paint = Map::new();
    paint.insert(
        "color".to_owned(),
        base_paint
            .get("color")
            .cloned()
            .unwrap_or_else(|| Value::String("#000000".to_owned())),
    );

    let base_font = base_paint.get("font").and_then(Value::as_object);
    let mut font = Map::new();
    font.insert(
        "family".to_owned(),
        base_font
            .and_then(|font| font.get("family"))
            .cloned()
            .unwrap_or_else(|| Value::String("serif".to_owned())),
    );
    font.insert("sizePx".to_owned(), paint_number_value(ruby_font_size));
    font.insert(
        "style".to_owned(),
        base_font
            .and_then(|font| font.get("style"))
            .cloned()
            .unwrap_or_else(|| Value::String("normal".to_owned())),
    );
    font.insert(
        "weight".to_owned(),
        base_font
            .and_then(|font| font.get("weight"))
            .cloned()
            .unwrap_or_else(|| Value::Number(Number::from(400))),
    );
    paint.insert("font".to_owned(), Value::Object(font));
    Value::Object(paint)
}

fn require_run_work(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    // This bounds traversal by input run. Tag comparison and the selected
    // annotation-paint clones remain indivisible work within that run.
    if work.take_utf16_units(1) == 1 {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}

#[cfg(test)]
mod tests;
