use serde_json::{json, Map, Number, Value};

use super::{
    inline_segment::InlineSegment,
    line_break::utf16_len,
    style_values::summarize_segment_style,
    summary_json::{hash_text, number_value},
};

pub(crate) fn normalize_inline_segment(segment: &InlineSegment) -> Value {
    match segment {
        InlineSegment::Text(segment) => {
            let mut value = Map::new();
            value.insert("type".to_owned(), Value::String("text".to_owned()));
            value.insert(
                "text".to_owned(),
                json!({
                    "hash": hash_text(&segment.text),
                    "length": utf16_len(&segment.text),
                }),
            );
            insert_optional_string(&mut value, "href", segment.href.as_deref());
            insert_optional_string(
                &mut value,
                "rubyAnnotation",
                segment.ruby_annotation.as_deref(),
            );
            insert_optional_path(&mut value, "sourcePath", segment.source_path.as_ref());
            insert_optional_number(&mut value, "inlineMarginLeft", segment.inline_margin_left);
            insert_optional_number(&mut value, "inlineMarginRight", segment.inline_margin_right);
            if segment.border_start {
                value.insert("borderStart".to_owned(), Value::Bool(true));
            }
            if segment.border_end {
                value.insert("borderEnd".to_owned(), Value::Bool(true));
            }
            value.insert(
                "style".to_owned(),
                Value::Object(summarize_segment_style(&segment.style)),
            );
            Value::Object(value)
        }
        InlineSegment::Atom(segment) => {
            let mut value = Map::new();
            value.insert("type".to_owned(), Value::String("inline-atom".to_owned()));
            insert_number(&mut value, "width", segment.width);
            insert_number(&mut value, "height", segment.height);
            insert_optional_string(&mut value, "imageSrc", segment.image_src.as_deref());
            insert_optional_string(&mut value, "alt", segment.alt.as_deref());
            insert_optional_string(&mut value, "href", segment.href.as_deref());
            insert_optional_path(&mut value, "sourcePath", segment.source_path.as_ref());
            value.insert(
                "style".to_owned(),
                Value::Object(summarize_segment_style(&segment.style)),
            );
            Value::Object(value)
        }
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
        insert_number(output, key, value);
    }
}

fn insert_number(output: &mut Map<String, Value>, key: &str, value: f64) {
    output.insert(key.to_owned(), number_value(value));
}
