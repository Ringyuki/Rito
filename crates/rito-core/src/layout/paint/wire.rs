use serde_json::{Map, Value};

use super::{
    paint_number_value, BorderEdgePaint, FontPaint, RunBorder, RunBorderEdge, RunDecoration,
    RunPaint, RunSpacing, TextShadowPaint,
};
use crate::layout::summary_json::number_value as rounded_number_value;

impl RunPaint {
    pub(crate) fn to_wire_value(&self) -> Value {
        let mut output = Map::new();
        output.insert("color".to_owned(), Value::String(self.data.color.clone()));
        output.insert("font".to_owned(), font_value(&self.data.measure.font));
        insert_optional_number(
            &mut output,
            "wordSpacingPx",
            self.data.measure.word_spacing_px,
        );
        insert_optional_number(
            &mut output,
            "letterSpacingPx",
            self.data.measure.letter_spacing_px,
        );
        insert_optional_string(
            &mut output,
            "backgroundColor",
            self.data.background_color.as_deref(),
        );
        insert_optional_number(&mut output, "backgroundRadius", self.data.background_radius);
        insert_text_shadows(&mut output, &self.data.text_shadows);
        insert_optional_value(
            &mut output,
            "decoration",
            self.data.decoration.as_ref().map(decoration_value),
        );
        insert_optional_value(
            &mut output,
            "padding",
            self.data.padding.as_ref().map(spacing_value),
        );
        insert_optional_value(
            &mut output,
            "border",
            self.data.border.as_ref().map(border_value),
        );
        // Emitted only when false: a run that does not open/close its
        // inline box; absent flags read as an unsplit box.
        if !self.data.box_edges.0 {
            output.insert("boxStart".to_owned(), Value::Bool(false));
        }
        if !self.data.box_edges.1 {
            output.insert("boxEnd".to_owned(), Value::Bool(false));
        }
        insert_optional_value(
            &mut output,
            "box",
            self.data.box_offsets.map(|(top, bottom)| {
                Value::Object(Map::from_iter([
                    ("topPx".to_owned(), paint_number_value(top)),
                    ("bottomPx".to_owned(), paint_number_value(bottom)),
                ]))
            }),
        );
        Value::Object(output)
    }
}

fn font_value(font: &FontPaint) -> Value {
    Value::Object(Map::from_iter([
        ("family".to_owned(), Value::String(font.family.clone())),
        ("sizePx".to_owned(), paint_number_value(font.size_px)),
        (
            "style".to_owned(),
            Value::String(font.style.as_str().to_owned()),
        ),
        ("weight".to_owned(), paint_number_value(font.weight)),
    ]))
}

fn insert_text_shadows(output: &mut Map<String, Value>, shadows: &[TextShadowPaint]) {
    if shadows.is_empty() {
        return;
    }
    output.insert(
        "textShadow".to_owned(),
        Value::Array(shadows.iter().map(text_shadow_value).collect()),
    );
}

fn text_shadow_value(shadow: &TextShadowPaint) -> Value {
    Value::Object(Map::from_iter([
        ("blur".to_owned(), rounded_number_value(shadow.blur)),
        ("color".to_owned(), Value::String(shadow.color.clone())),
        ("offsetX".to_owned(), rounded_number_value(shadow.offset_x)),
        ("offsetY".to_owned(), rounded_number_value(shadow.offset_y)),
    ]))
}

fn decoration_value(decoration: &RunDecoration) -> Value {
    Value::Object(Map::from_iter([
        ("color".to_owned(), Value::String(decoration.color.clone())),
        (
            "kind".to_owned(),
            Value::String(decoration.kind.as_str().to_owned()),
        ),
        (
            "thickness".to_owned(),
            paint_number_value(decoration.thickness),
        ),
        ("y".to_owned(), paint_number_value(decoration.y)),
    ]))
}

fn spacing_value(spacing: &RunSpacing) -> Value {
    Value::Object(Map::from_iter([
        ("bottom".to_owned(), paint_number_value(spacing.bottom)),
        ("left".to_owned(), paint_number_value(spacing.left)),
        ("right".to_owned(), paint_number_value(spacing.right)),
        ("top".to_owned(), paint_number_value(spacing.top)),
    ]))
}

fn border_value(border: &RunBorder) -> Value {
    let mut output = Map::new();
    insert_optional_value(
        &mut output,
        "top",
        border.top.as_ref().map(border_edge_value),
    );
    insert_optional_value(
        &mut output,
        "bottom",
        border.bottom.as_ref().map(border_edge_value),
    );
    insert_optional_value(
        &mut output,
        "start",
        border.start.as_ref().map(border_edge_value),
    );
    insert_optional_value(
        &mut output,
        "end",
        border.end.as_ref().map(border_edge_value),
    );
    Value::Object(output)
}

fn border_edge_value(edge: &RunBorderEdge) -> Value {
    Value::Object(Map::from_iter([
        ("paint".to_owned(), border_edge_paint_value(&edge.paint)),
        ("widthPx".to_owned(), paint_number_value(edge.width_px)),
    ]))
}

fn border_edge_paint_value(paint: &BorderEdgePaint) -> Value {
    Value::Object(Map::from_iter([
        ("color".to_owned(), Value::String(paint.color.clone())),
        (
            "style".to_owned(),
            Value::String(paint.style.as_str().to_owned()),
        ),
    ]))
}

fn insert_optional_number(output: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), paint_number_value(value));
    }
}

fn insert_optional_string(output: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), Value::String(value.to_owned()));
    }
}

fn insert_optional_value(output: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), value);
    }
}
