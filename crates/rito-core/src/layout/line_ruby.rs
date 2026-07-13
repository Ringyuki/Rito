use serde_json::{Map, Number, Value};

use super::{
    line::{LineRun, RubyRunBox},
    style_values::paint_number_value,
};

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

#[cfg(test)]
mod tests;
