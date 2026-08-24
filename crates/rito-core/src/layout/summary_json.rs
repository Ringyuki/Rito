use serde_json::{json, Number, Value};
use sha2::{Digest, Sha256};

/// CSS named colors as canonical lowercase hex, for summary canonicalization.
fn named_color_hex(value: &str) -> Option<&'static str> {
    match value {
        "aliceblue" => Some("#f0f8ff"),
        "antiquewhite" => Some("#faebd7"),
        "aqua" => Some("#00ffff"),
        "aquamarine" => Some("#7fffd4"),
        "azure" => Some("#f0ffff"),
        "beige" => Some("#f5f5dc"),
        "bisque" => Some("#ffe4c4"),
        "black" => Some("#000000"),
        "blanchedalmond" => Some("#ffebcd"),
        "blue" => Some("#0000ff"),
        "blueviolet" => Some("#8a2be2"),
        "brown" => Some("#a52a2a"),
        "burlywood" => Some("#deb887"),
        "cadetblue" => Some("#5f9ea0"),
        "chartreuse" => Some("#7fff00"),
        "chocolate" => Some("#d2691e"),
        "coral" => Some("#ff7f50"),
        "cornflowerblue" => Some("#6495ed"),
        "cornsilk" => Some("#fff8dc"),
        "crimson" => Some("#dc143c"),
        "cyan" => Some("#00ffff"),
        "darkblue" => Some("#00008b"),
        "darkcyan" => Some("#008b8b"),
        "darkgoldenrod" => Some("#b8860b"),
        "darkgray" => Some("#a9a9a9"),
        "darkgreen" => Some("#006400"),
        "darkgrey" => Some("#a9a9a9"),
        "darkkhaki" => Some("#bdb76b"),
        "darkmagenta" => Some("#8b008b"),
        "darkolivegreen" => Some("#556b2f"),
        "darkorange" => Some("#ff8c00"),
        "darkorchid" => Some("#9932cc"),
        "darkred" => Some("#8b0000"),
        "darksalmon" => Some("#e9967a"),
        "darkseagreen" => Some("#8fbc8f"),
        "darkslateblue" => Some("#483d8b"),
        "darkslategray" => Some("#2f4f4f"),
        "darkslategrey" => Some("#2f4f4f"),
        "darkturquoise" => Some("#00ced1"),
        "darkviolet" => Some("#9400d3"),
        "deeppink" => Some("#ff1493"),
        "deepskyblue" => Some("#00bfff"),
        "dimgray" => Some("#696969"),
        "dimgrey" => Some("#696969"),
        "dodgerblue" => Some("#1e90ff"),
        "firebrick" => Some("#b22222"),
        "floralwhite" => Some("#fffaf0"),
        "forestgreen" => Some("#228b22"),
        "fuchsia" => Some("#ff00ff"),
        "gainsboro" => Some("#dcdcdc"),
        "ghostwhite" => Some("#f8f8ff"),
        "gold" => Some("#ffd700"),
        "goldenrod" => Some("#daa520"),
        "gray" => Some("#808080"),
        "green" => Some("#008000"),
        "greenyellow" => Some("#adff2f"),
        "grey" => Some("#808080"),
        "honeydew" => Some("#f0fff0"),
        "hotpink" => Some("#ff69b4"),
        "indianred" => Some("#cd5c5c"),
        "indigo" => Some("#4b0082"),
        "ivory" => Some("#fffff0"),
        "khaki" => Some("#f0e68c"),
        "lavender" => Some("#e6e6fa"),
        "lavenderblush" => Some("#fff0f5"),
        "lawngreen" => Some("#7cfc00"),
        "lemonchiffon" => Some("#fffacd"),
        "lightblue" => Some("#add8e6"),
        "lightcoral" => Some("#f08080"),
        "lightcyan" => Some("#e0ffff"),
        "lightgoldenrodyellow" => Some("#fafad2"),
        "lightgray" => Some("#d3d3d3"),
        "lightgreen" => Some("#90ee90"),
        "lightgrey" => Some("#d3d3d3"),
        "lightpink" => Some("#ffb6c1"),
        "lightsalmon" => Some("#ffa07a"),
        "lightseagreen" => Some("#20b2aa"),
        "lightskyblue" => Some("#87cefa"),
        "lightslategray" => Some("#778899"),
        "lightslategrey" => Some("#778899"),
        "lightsteelblue" => Some("#b0c4de"),
        "lightyellow" => Some("#ffffe0"),
        "lime" => Some("#00ff00"),
        "limegreen" => Some("#32cd32"),
        "linen" => Some("#faf0e6"),
        "magenta" => Some("#ff00ff"),
        "maroon" => Some("#800000"),
        "mediumaquamarine" => Some("#66cdaa"),
        "mediumblue" => Some("#0000cd"),
        "mediumorchid" => Some("#ba55d3"),
        "mediumpurple" => Some("#9370db"),
        "mediumseagreen" => Some("#3cb371"),
        "mediumslateblue" => Some("#7b68ee"),
        "mediumspringgreen" => Some("#00fa9a"),
        "mediumturquoise" => Some("#48d1cc"),
        "mediumvioletred" => Some("#c71585"),
        "midnightblue" => Some("#191970"),
        "mintcream" => Some("#f5fffa"),
        "mistyrose" => Some("#ffe4e1"),
        "moccasin" => Some("#ffe4b5"),
        "navajowhite" => Some("#ffdead"),
        "navy" => Some("#000080"),
        "oldlace" => Some("#fdf5e6"),
        "olive" => Some("#808000"),
        "olivedrab" => Some("#6b8e23"),
        "orange" => Some("#ffa500"),
        "orangered" => Some("#ff4500"),
        "orchid" => Some("#da70d6"),
        "palegoldenrod" => Some("#eee8aa"),
        "palegreen" => Some("#98fb98"),
        "paleturquoise" => Some("#afeeee"),
        "palevioletred" => Some("#db7093"),
        "papayawhip" => Some("#ffefd5"),
        "peachpuff" => Some("#ffdab9"),
        "peru" => Some("#cd853f"),
        "pink" => Some("#ffc0cb"),
        "plum" => Some("#dda0dd"),
        "powderblue" => Some("#b0e0e6"),
        "purple" => Some("#800080"),
        "rebeccapurple" => Some("#663399"),
        "red" => Some("#ff0000"),
        "rosybrown" => Some("#bc8f8f"),
        "royalblue" => Some("#4169e1"),
        "saddlebrown" => Some("#8b4513"),
        "salmon" => Some("#fa8072"),
        "sandybrown" => Some("#f4a460"),
        "seagreen" => Some("#2e8b57"),
        "seashell" => Some("#fff5ee"),
        "sienna" => Some("#a0522d"),
        "silver" => Some("#c0c0c0"),
        "skyblue" => Some("#87ceeb"),
        "slateblue" => Some("#6a5acd"),
        "slategray" => Some("#708090"),
        "slategrey" => Some("#708090"),
        "snow" => Some("#fffafa"),
        "springgreen" => Some("#00ff7f"),
        "steelblue" => Some("#4682b4"),
        "tan" => Some("#d2b48c"),
        "teal" => Some("#008080"),
        "thistle" => Some("#d8bfd8"),
        "tomato" => Some("#ff6347"),
        "turquoise" => Some("#40e0d0"),
        "violet" => Some("#ee82ee"),
        "wheat" => Some("#f5deb3"),
        "white" => Some("#ffffff"),
        "whitesmoke" => Some("#f5f5f5"),
        "yellow" => Some("#ffff00"),
        "yellowgreen" => Some("#9acd32"),
        _ => None,
    }
}

/// Canonicalizes a color string (named colors and hex both normalize to
/// lowercase 6-digit hex) so summary hashes tolerate author-spelling
/// differences that cannot survive a computed-value pipeline. Painted output
/// parses these strings identically.
pub(crate) fn canonical_color(value: String) -> String {
    let trimmed = value.trim();
    if let Some(hex) = named_color_hex(trimmed.to_ascii_lowercase().as_str()) {
        return hex.to_owned();
    }
    let Some(digits) = trimmed.strip_prefix('#') else {
        return value;
    };
    if !digits
        .chars()
        .all(|character| character.is_ascii_hexdigit())
    {
        return value;
    }
    match digits.len() {
        3 => {
            let mut expanded = String::with_capacity(7);
            expanded.push('#');
            for character in digits.chars() {
                let lower = character.to_ascii_lowercase();
                expanded.push(lower);
                expanded.push(lower);
            }
            expanded
        }
        6 => format!("#{}", digits.to_ascii_lowercase()),
        _ => value,
    }
}

/// Deeply canonicalizes color-keyed strings inside a summary value. Only the
/// dedicated color keys are touched, so text content is never rewritten.
pub(crate) fn canonicalize_color_keys(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, entry) in map.iter_mut() {
                if key == "color" || key == "backgroundColor" {
                    if let Value::String(color) = entry {
                        *entry = Value::String(canonical_color(std::mem::take(color)));
                        continue;
                    }
                }
                canonicalize_color_keys(entry);
            }
        }
        Value::Array(items) => {
            for item in items {
                canonicalize_color_keys(item);
            }
        }
        _ => {}
    }
}

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
