use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

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
        return command.clone();
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
    Value::Object(normalized)
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
