use serde_json::{json, Map, Number, Value};

use super::{
    line_break::utf16_len,
    style_values::paint_number_value,
    summary_json::{hash_text, number_value, rect_value},
};

#[derive(Debug, Clone)]
pub(crate) struct LineBox {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) runs: Vec<LineRun>,
}

impl LineBox {
    pub(crate) fn normalized(&self) -> Value {
        json!({
            "bounds": rect_value(self.x, self.y, self.width, self.height),
            "runs": self.runs.iter().map(LineRun::normalized).collect::<Vec<_>>(),
        })
    }

    pub(crate) fn text(&self) -> String {
        self.runs
            .iter()
            .filter_map(LineRun::text)
            .collect::<String>()
    }

    pub(crate) fn text_run_count(&self) -> usize {
        self.runs
            .iter()
            .filter(|run| matches!(run, LineRun::Text(_)))
            .count()
    }

    pub(crate) fn atom_count(&self) -> usize {
        self.runs
            .iter()
            .filter(|run| matches!(run, LineRun::Atom(_)))
            .count()
    }

    pub(crate) fn ruby_count(&self) -> usize {
        self.runs
            .iter()
            .filter(|run| matches!(run, LineRun::Ruby(_)))
            .count()
    }

    pub(crate) fn used_width(&self) -> f64 {
        self.runs.iter().map(LineRun::right).fold(0.0_f64, f64::max)
    }

    pub(crate) fn offset_position(mut self, dx: f64, dy: f64) -> Self {
        if dx != 0.0 {
            self.x += dx;
        }
        if dy != 0.0 {
            self.y += dy;
        }
        self
    }

    pub(crate) fn offset_with_runs(mut self, dx: f64, dy: f64) -> Self {
        self = self.offset_position(dx, dy);
        self.runs = self
            .runs
            .into_iter()
            .map(|run| run.offset(dx, dy))
            .collect();
        self
    }
}

#[derive(Debug, Clone)]
pub(crate) enum LineRun {
    Text(TextRunBox),
    Atom(AtomRunBox),
    Ruby(RubyRunBox),
}

impl LineRun {
    pub(crate) fn normalized(&self) -> Value {
        match self {
            Self::Text(run) => run.normalized(),
            Self::Atom(run) => run.normalized(),
            Self::Ruby(run) => run.normalized(),
        }
    }

    pub(crate) fn text(&self) -> Option<&str> {
        match self {
            Self::Text(run) => Some(&run.text),
            Self::Atom(_) | Self::Ruby(_) => None,
        }
    }

    pub(crate) fn right(&self) -> f64 {
        match self {
            Self::Text(run) => run.x + run.width,
            Self::Atom(run) => run.x + run.width,
            Self::Ruby(run) => run.x + run.width,
        }
    }

    pub(crate) fn advance_right(&self) -> f64 {
        match self {
            Self::Text(run) => {
                run.x
                    + run.width
                    + run.trailing_inline_extension()
                    + run.inline_margin_right.unwrap_or(0.0)
            }
            Self::Atom(run) => run.x + run.width,
            Self::Ruby(run) => run.x + run.width,
        }
    }

    pub(crate) fn y(&self) -> f64 {
        match self {
            Self::Text(run) => run.y,
            Self::Atom(run) => run.y,
            Self::Ruby(run) => run.y,
        }
    }

    pub(crate) fn geometry(&self) -> (f64, f64) {
        match self {
            Self::Text(run) => (run.x, run.width),
            Self::Atom(run) => (run.x, run.width),
            Self::Ruby(run) => (run.x, run.width),
        }
    }

    pub(crate) fn shift_x(&mut self, dx: f64) {
        match self {
            Self::Text(run) => run.x += dx,
            Self::Atom(run) => run.x += dx,
            Self::Ruby(run) => run.x += dx,
        }
    }

    pub(crate) fn shift_y(&mut self, dy: f64) {
        match self {
            Self::Text(run) => run.y += dy,
            Self::Atom(run) => run.y += dy,
            Self::Ruby(run) => run.y += dy,
        }
    }

    pub(crate) fn offset(mut self, dx: f64, dy: f64) -> Self {
        self.shift_x(dx);
        self.shift_y(dy);
        self
    }
}

#[derive(Debug, Clone)]
pub(crate) struct TextRunBox {
    pub(crate) text: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) font_size: f64,
    pub(crate) paint: Value,
    pub(crate) line_height_px: Option<f64>,
    pub(crate) href: Option<String>,
    pub(crate) source_path: Option<Vec<usize>>,
    pub(crate) source_text: Option<String>,
    pub(crate) source_text_offset: Option<usize>,
    pub(crate) inline_margin_right: Option<f64>,
    pub(crate) ruby_annotation: Option<String>,
}

impl TextRunBox {
    fn trailing_inline_extension(&self) -> f64 {
        if paint_object(&self.paint, &["border", "end"]).is_none() {
            return 0.0;
        }
        paint_number(&self.paint, &["padding", "right"])
            + paint_number(&self.paint, &["border", "end", "widthPx"])
    }

    fn normalized(&self) -> Value {
        let mut value = Map::new();
        value.insert("type".to_owned(), Value::String("text-run".to_owned()));
        value.insert(
            "text".to_owned(),
            json!({
                "hash": hash_text(&self.text),
                "length": utf16_len(&self.text),
            }),
        );
        value.insert(
            "bounds".to_owned(),
            rect_value(self.x, self.y, self.width, self.height),
        );
        insert_optional_string(&mut value, "href", self.href.as_deref());
        insert_optional_path(&mut value, "sourcePath", self.source_path.as_ref());
        if let Some(offset) = self.source_text_offset {
            value.insert(
                "sourceTextOffset".to_owned(),
                Value::Number(Number::from(offset)),
            );
        }
        insert_optional_number(&mut value, "inlineMarginRight", self.inline_margin_right);
        Value::Object(value)
    }

    pub(crate) fn add_paint_spacing(&mut self, key: &str, delta: f64) {
        if delta == 0.0 {
            return;
        }
        let current = self
            .paint
            .as_object()
            .and_then(|paint| paint.get(key))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if let Some(paint) = self.paint.as_object_mut() {
            paint.insert(key.to_owned(), paint_number_value(current + delta));
        }
    }
}

fn paint_number(value: &Value, path: &[&str]) -> f64 {
    let mut current = value;
    for key in path {
        let Some(next) = current.as_object().and_then(|object| object.get(*key)) else {
            return 0.0;
        };
        current = next;
    }
    current.as_f64().unwrap_or(0.0)
}

fn paint_object<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Map<String, Value>> {
    let mut current = value;
    for key in path {
        current = current.as_object()?.get(*key)?;
    }
    current.as_object()
}

#[derive(Debug, Clone)]
pub(crate) struct AtomRunBox {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) image_src: Option<String>,
    pub(crate) alt: Option<String>,
    pub(crate) href: Option<String>,
}

impl AtomRunBox {
    fn normalized(&self) -> Value {
        let mut value = Map::new();
        value.insert("type".to_owned(), Value::String("inline-atom".to_owned()));
        value.insert(
            "bounds".to_owned(),
            rect_value(self.x, self.y, self.width, self.height),
        );
        insert_optional_string(&mut value, "imageSrc", self.image_src.as_deref());
        insert_optional_string(&mut value, "alt", self.alt.as_deref());
        insert_optional_string(&mut value, "href", self.href.as_deref());
        Value::Object(value)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct RubyRunBox {
    pub(crate) text: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) paint: Value,
}

impl RubyRunBox {
    fn normalized(&self) -> Value {
        json!({
            "type": "ruby-annotation",
            "text": {
                "hash": hash_text(&self.text),
                "length": utf16_len(&self.text),
            },
            "bounds": rect_value(self.x, self.y, self.width, self.height),
        })
    }
}

fn insert_optional_string(output: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), Value::String(value.to_owned()));
    }
}

fn insert_optional_path(output: &mut Map<String, Value>, key: &str, value: Option<&Vec<usize>>) {
    if let Some(value) = value {
        output.insert(
            key.to_owned(),
            Value::Array(
                value
                    .iter()
                    .map(|part| Value::Number(Number::from(*part)))
                    .collect(),
            ),
        );
    }
}

fn insert_optional_number(output: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), number_value(value));
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{AtomRunBox, LineBox, LineRun, RubyRunBox, TextRunBox};

    #[test]
    fn line_box_reports_text_counts_and_used_width() {
        let line = LineBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 20.0,
            runs: vec![
                LineRun::Text(TextRunBox {
                    text: "Hello".to_owned(),
                    x: 1.0,
                    y: 2.0,
                    width: 30.0,
                    height: 12.0,
                    font_size: 12.0,
                    paint: json!({ "color": "#000000" }),
                    line_height_px: None,
                    href: None,
                    source_path: Some(vec![0, 1]),
                    source_text: Some("Hello".to_owned()),
                    source_text_offset: Some(0),
                    inline_margin_right: Some(2.0),
                    ruby_annotation: None,
                }),
                LineRun::Atom(AtomRunBox {
                    x: 40.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    image_src: Some("img.png".to_owned()),
                    alt: None,
                    href: Some("#target".to_owned()),
                }),
                LineRun::Ruby(RubyRunBox {
                    text: "ruby".to_owned(),
                    x: 1.0,
                    y: -8.0,
                    width: 30.0,
                    height: 6.0,
                    paint: json!({ "color": "#000000" }),
                }),
            ],
        };

        assert_eq!(line.text(), "Hello");
        assert_eq!(line.text_run_count(), 1);
        assert_eq!(line.atom_count(), 1);
        assert_eq!(line.ruby_count(), 1);
        assert_eq!(line.runs[0].advance_right(), 33.0);
        assert_eq!(line.used_width(), 50.0);
        assert_eq!(line.normalized()["runs"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn advance_right_requires_end_border_before_counting_padding() {
        let padding_without_border = text_run_with_paint(json!({
            "padding": { "right": 10 }
        }));
        let padding_with_border = text_run_with_paint(json!({
            "padding": { "right": 10 },
            "border": { "end": { "widthPx": 2 } }
        }));

        assert_eq!(LineRun::Text(padding_without_border).advance_right(), 31.0);
        assert_eq!(LineRun::Text(padding_with_border).advance_right(), 43.0);
    }

    #[test]
    fn line_and_run_offsets_update_geometry() {
        let line = LineBox {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 20.0,
            runs: vec![LineRun::Text(TextRunBox {
                text: "A".to_owned(),
                x: 2.0,
                y: 3.0,
                width: 8.0,
                height: 12.0,
                font_size: 12.0,
                paint: json!({}),
                line_height_px: None,
                href: None,
                source_path: None,
                source_text: None,
                source_text_offset: None,
                inline_margin_right: None,
                ruby_annotation: None,
            })],
        }
        .offset_with_runs(5.0, -2.0);

        assert_eq!(line.x, 15.0);
        assert_eq!(line.y, 18.0);
        assert_eq!(line.runs[0].geometry(), (7.0, 8.0));
        assert_eq!(line.runs[0].y(), 1.0);
    }

    #[test]
    fn text_run_accumulates_paint_spacing() {
        let mut run = TextRunBox {
            text: "A B".to_owned(),
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 12.0,
            font_size: 12.0,
            paint: json!({ "wordSpacingPx": 1 }),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
        };

        run.add_paint_spacing("wordSpacingPx", 2.5);
        run.add_paint_spacing("letterSpacingPx", 8.0 / 29.0);

        assert_eq!(run.paint["wordSpacingPx"], json!(3.5));
        assert_eq!(run.paint["letterSpacingPx"], json!(8.0 / 29.0));
    }

    fn text_run_with_paint(paint: serde_json::Value) -> TextRunBox {
        TextRunBox {
            text: "Hello".to_owned(),
            x: 1.0,
            y: 0.0,
            width: 30.0,
            height: 12.0,
            font_size: 12.0,
            paint,
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
        }
    }
}
