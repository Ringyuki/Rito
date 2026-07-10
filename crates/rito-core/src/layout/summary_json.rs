use serde_json::{json, Number, Value};
use sha2::{Digest, Sha256};

pub(crate) fn rect_value(x: f64, y: f64, width: f64, height: f64) -> Value {
    json!({
        "x": number_value(x),
        "y": number_value(y),
        "width": number_value(width),
        "height": number_value(height),
    })
}

pub(crate) fn number_value(value: f64) -> Value {
    let rounded = (value * 1000.0).round() / 1000.0;
    if rounded.fract().abs() < f64::EPSILON {
        Value::Number(Number::from(rounded as i64))
    } else {
        Value::Number(Number::from_f64(rounded).unwrap_or_else(|| Number::from(0)))
    }
}

pub(crate) fn hash_json(value: &Value) -> String {
    let text = format!("{}\n", stable_json(value, 0));
    hash_text(&text)
}

pub(crate) fn hash_text(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn stable_json(value: &Value, depth: usize) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => value.to_string(),
        Value::Array(values) => stable_json_array(values, depth),
        Value::Object(object) => stable_json_object(object, depth),
    }
}

fn stable_json_array(values: &[Value], depth: usize) -> String {
    if values.is_empty() {
        return "[]".to_owned();
    }

    let next_depth = depth + 1;
    let indent = spaces(next_depth);
    let closing = spaces(depth);
    let entries = values
        .iter()
        .map(|value| format!("{indent}{}", stable_json(value, next_depth)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("[\n{entries}\n{closing}]")
}

fn stable_json_object(object: &serde_json::Map<String, Value>, depth: usize) -> String {
    if object.is_empty() {
        return "{}".to_owned();
    }

    let next_depth = depth + 1;
    let indent = spaces(next_depth);
    let closing = spaces(depth);
    let entries = object
        .iter()
        .map(|(key, value)| format!("{indent}{key:?}: {}", stable_json(value, next_depth)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("{{\n{entries}\n{closing}}}")
}

fn spaces(count: usize) -> String {
    "  ".repeat(count)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{hash_json, number_value, rect_value};

    #[test]
    fn numbers_match_fixture_integer_normalization() {
        assert_eq!(number_value(420.0), json!(420));
        assert_eq!(number_value(1.23456), json!(1.235));
    }

    #[test]
    fn hashes_stable_json_with_sorted_object_order() {
        assert_eq!(
            hash_json(&json!({ "b": 1, "a": 2 })),
            hash_json(&json!({ "a": 2, "b": 1 }))
        );
    }

    #[test]
    fn builds_rounded_rect_values() {
        assert_eq!(
            rect_value(1.0, 2.3456, 3.0, 4.0),
            json!({ "x": 1, "y": 2.346, "width": 3, "height": 4 })
        );
    }
}
