use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::layout::round_json_value;

pub fn normalize_runtime_commands_for_render_hash(commands: &[Value]) -> Vec<Value> {
    commands
        .iter()
        .map(normalize_runtime_command_for_render_hash)
        .collect()
}

pub fn hash_json_value(value: &Value) -> String {
    hash_text(&format!("{}\n", stable_json(value, 0)))
}

fn normalize_runtime_command_for_render_hash(command: &Value) -> Value {
    let Some(object) = command.as_object() else {
        return round_json_value(command);
    };
    let mut normalized = object.clone();
    if matches!(
        object.get("kind").and_then(Value::as_str),
        Some("paintText" | "paintRuby")
    ) {
        if let Some(text) = object.get("text").and_then(Value::as_str) {
            normalized.insert("text".to_owned(), text_summary_value(text));
        }
    }
    round_json_value(&Value::Object(normalized))
}

pub fn json_values_match_after_number_round_trip(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => {
            if !left.is_f64() || !right.is_f64() {
                return left == right;
            }
            let Some(left) = left.as_f64() else {
                return left == right;
            };
            let Some(right) = right.as_f64() else {
                return false;
            };
            ordered_f64_bits(left).abs_diff(ordered_f64_bits(right)) <= 1
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| json_values_match_after_number_round_trip(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, left)| {
                    right
                        .get(key)
                        .is_some_and(|right| json_values_match_after_number_round_trip(left, right))
                })
        }
        _ => left == right,
    }
}

fn ordered_f64_bits(value: f64) -> u64 {
    const SIGN_MASK: u64 = 1 << 63;
    let bits = value.to_bits();
    if bits & SIGN_MASK == 0 {
        bits | SIGN_MASK
    } else {
        !bits
    }
}

#[test]
fn number_round_trip_comparison_allows_only_one_f64_ulp() {
    let value = 0.263_f64;
    let adjacent = f64::from_bits(value.to_bits() + 1);
    let two_ulps_away = f64::from_bits(value.to_bits() + 2);
    let json_number = |number| Value::Number(serde_json::Number::from_f64(number).unwrap());

    assert!(json_values_match_after_number_round_trip(
        &json_number(value),
        &json_number(adjacent)
    ));
    assert!(!json_values_match_after_number_round_trip(
        &json_number(value),
        &json_number(two_ulps_away)
    ));
    assert!(!json_values_match_after_number_round_trip(
        &serde_json::json!(1),
        &json_number(1.0)
    ));
}

fn text_summary_value(text: &str) -> Value {
    serde_json::json!({
        "hash": hash_display_list_text(text),
        "length": text.encode_utf16().count(),
    })
}

fn hash_display_list_text(text: &str) -> String {
    let json_string = Value::String(text.to_owned()).to_string();
    hash_text(&format!("{json_string}\n"))
}

fn hash_text(text: &str) -> String {
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
    let indent = "  ".repeat(next_depth);
    let closing = "  ".repeat(depth);
    let entries = values
        .iter()
        .map(|value| format!("{indent}{}", stable_json(value, next_depth)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("[\n{entries}\n{closing}]")
}

fn stable_json_object(object: &Map<String, Value>, depth: usize) -> String {
    if object.is_empty() {
        return "{}".to_owned();
    }
    let next_depth = depth + 1;
    let indent = "  ".repeat(next_depth);
    let closing = "  ".repeat(depth);
    let entries = object
        .iter()
        .map(|(key, value)| format!("{indent}{key:?}: {}", stable_json(value, next_depth)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("{{\n{entries}\n{closing}}}")
}
