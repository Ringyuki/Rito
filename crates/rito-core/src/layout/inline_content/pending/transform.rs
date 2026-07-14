use serde_json::{Map, Value};

use crate::layout::style_values::string_style;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TransformMode {
    None,
    Uppercase,
    Lowercase,
    Capitalize,
}

pub(super) fn transform_mode(style: &Map<String, Value>) -> TransformMode {
    match string_style(style, "textTransform").as_deref() {
        Some("uppercase") => TransformMode::Uppercase,
        Some("lowercase") => TransformMode::Lowercase,
        Some("capitalize") => TransformMode::Capitalize,
        _ => TransformMode::None,
    }
}

pub(super) fn scalar_equals(character: char, candidate: &str) -> bool {
    let mut buffer = [0_u8; 4];
    character.encode_utf8(&mut buffer) == candidate
}
