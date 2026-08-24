use serde_json::{json, Map, Number, Value};

use super::{
    inline_segment::{AtomSegment, InlineSegment, TextSegment},
    line_break::utf16_len,
    style_values::summarize_segment_style,
    summary_json::{hash_text, number_value},
};

#[derive(Debug)]
pub(crate) struct BuiltLineBreakInput {
    pub(crate) full_text: String,
    pub(crate) ranges: Vec<Value>,
    pub(crate) atoms: Vec<Value>,
}

pub(crate) fn build_line_break_input(segments: &[InlineSegment]) -> BuiltLineBreakInput {
    let mut text_parts = Vec::new();
    let mut ranges = Vec::new();
    let mut atoms = Vec::new();
    let mut offset = 0usize;

    for segment in segments {
        match segment {
            InlineSegment::Atom(atom) => {
                text_parts.push("\u{fffc}".to_owned());
                atoms.push(normalize_line_break_atom(offset, atom));
                ranges.push(json!({
                    "end": offset + 1,
                    "start": offset,
                    "style": summarize_segment_style(&atom.style),
                }));
                offset += 1;
            }
            InlineSegment::Text(text) => {
                text_parts.push(text.text.clone());
                if text.text.is_empty() {
                    continue;
                }
                ranges.push(normalize_line_break_range(offset, text));
                offset += utf16_len(&text.text);
            }
        }
    }

    BuiltLineBreakInput {
        full_text: text_parts.join(""),
        ranges,
        atoms,
    }
}

fn normalize_line_break_range(offset: usize, segment: &TextSegment) -> Value {
    let mut value = Map::new();
    value.insert("start".to_owned(), Value::Number(Number::from(offset)));
    value.insert(
        "end".to_owned(),
        Value::Number(Number::from(offset + utf16_len(&segment.text))),
    );
    insert_optional_string(&mut value, "href", segment.href.as_deref());
    insert_optional_path(&mut value, "sourcePath", segment.source_path.as_ref());
    if let Some(source_text) = &segment.source_text {
        value.insert(
            "sourceText".to_owned(),
            json!({
                "hash": hash_text(source_text),
                "length": utf16_len(source_text),
            }),
        );
    }
    insert_optional_string(
        &mut value,
        "rubyAnnotation",
        segment.ruby_annotation.as_deref(),
    );
    if segment.border_start {
        value.insert("borderStart".to_owned(), Value::Bool(true));
    }
    if segment.border_end {
        value.insert("borderEnd".to_owned(), Value::Bool(true));
    }
    insert_optional_number(&mut value, "inlineMarginLeft", segment.inline_margin_left);
    insert_optional_number(&mut value, "inlineMarginRight", segment.inline_margin_right);
    value.insert(
        "style".to_owned(),
        Value::Object(summarize_segment_style(&segment.style)),
    );
    Value::Object(value)
}

fn normalize_line_break_atom(offset: usize, segment: &AtomSegment) -> Value {
    let mut value = Map::new();
    value.insert("offset".to_owned(), Value::Number(Number::from(offset)));
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
