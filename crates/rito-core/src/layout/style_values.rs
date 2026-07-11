use serde_json::{json, Map, Number, Value};

use super::{
    inline_segment::{InlineBorders, InlinePadding},
    summary_json::number_value as summary_number_value,
};

pub(crate) fn summarize_segment_style(style: &Map<String, Value>) -> Map<String, Value> {
    let mut output = Map::new();
    for key in SEGMENT_STYLE_KEYS {
        if let Some(value) = style.get(*key) {
            output.insert((*key).to_owned(), round_json_value(value));
        }
    }
    output
}

pub(crate) fn round_json_value(value: &Value) -> Value {
    match value {
        Value::Number(number) => number
            .as_f64()
            .map(summary_number_value)
            .unwrap_or_else(|| value.clone()),
        Value::Array(values) => Value::Array(values.iter().map(round_json_value).collect()),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), round_json_value(value)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

pub(crate) fn paint_number_value(value: f64) -> Value {
    if value.is_finite()
        && value.fract() == 0.0
        && value >= i64::MIN as f64
        && value < i64::MAX as f64
    {
        return Value::Number(Number::from(value as i64));
    }
    Value::Number(Number::from_f64(value).unwrap_or_else(|| Number::from(0)))
}

pub(crate) fn border_box_from_style(style: &Map<String, Value>) -> Option<Value> {
    let top = border_width(style, "borderTop");
    let right = border_width(style, "borderRight");
    let bottom = border_width(style, "borderBottom");
    let left = border_width(style, "borderLeft");
    if top == 0.0 && right == 0.0 && bottom == 0.0 && left == 0.0 {
        return None;
    }
    Some(json!({
        "topWidth": paint_number_value(top),
        "rightWidth": paint_number_value(right),
        "bottomWidth": paint_number_value(bottom),
        "leftWidth": paint_number_value(left),
    }))
}

pub(crate) fn block_paint_from_style(style: &Map<String, Value>) -> Option<Value> {
    let mut paint = Map::new();
    if let Some(background) = block_background_paint(style) {
        paint.insert("background".to_owned(), background);
    }
    if let Some(border) = block_border_paint(style) {
        paint.insert("border".to_owned(), border);
    }
    if let Some(radius) = block_radius_paint(style) {
        paint.insert("radius".to_owned(), radius);
    }
    if let Some(opacity) = style
        .get("opacity")
        .filter(|value| value.as_f64().is_some_and(|opacity| opacity < 1.0))
    {
        paint.insert("opacity".to_owned(), opacity.clone());
    }
    if let Some(box_shadow) = non_empty_style_array(style, "boxShadow") {
        paint.insert("boxShadow".to_owned(), box_shadow);
    }
    if let Some(transform) = non_empty_style_array_raw(style, "transform") {
        paint.insert("transform".to_owned(), transform);
    }
    if string_style(style, "overflow").as_deref() == Some("hidden") {
        paint.insert("clipToBounds".to_owned(), Value::Bool(true));
    }
    if paint.is_empty() {
        None
    } else {
        Some(Value::Object(paint))
    }
}

pub(crate) fn block_background_paint(style: &Map<String, Value>) -> Option<Value> {
    let color = non_empty_string_style(style, "backgroundColor");
    let image = non_empty_string_style(style, "backgroundImage");
    if color.is_none() && image.is_none() {
        return None;
    }
    let mut background = Map::new();
    insert_optional_string(&mut background, "color", color.as_deref());
    insert_optional_string(&mut background, "image", image.as_deref());
    insert_optional_string(
        &mut background,
        "size",
        string_style(style, "backgroundSize").as_deref(),
    );
    insert_optional_string(
        &mut background,
        "repeat",
        string_style(style, "backgroundRepeat").as_deref(),
    );
    if let Some(position) = style.get("backgroundPosition") {
        background.insert("position".to_owned(), round_json_value(position));
    }
    Some(Value::Object(background))
}

pub(crate) fn block_border_paint(style: &Map<String, Value>) -> Option<Value> {
    let mut border = Map::new();
    insert_optional_value(&mut border, "top", border_edge_paint(style, "borderTop"));
    insert_optional_value(
        &mut border,
        "right",
        border_edge_paint(style, "borderRight"),
    );
    insert_optional_value(
        &mut border,
        "bottom",
        border_edge_paint(style, "borderBottom"),
    );
    insert_optional_value(&mut border, "left", border_edge_paint(style, "borderLeft"));
    if border.is_empty() {
        None
    } else {
        Some(Value::Object(border))
    }
}

pub(crate) fn block_radius_paint(style: &Map<String, Value>) -> Option<Value> {
    if let Some(pct) = number_style(style, "borderRadiusPct") {
        return Some(json!({ "pct": paint_number_value(pct) }));
    }
    let px = number_style(style, "borderRadius").unwrap_or(0.0);
    if px > 0.0 {
        Some(json!({ "px": paint_number_value(px) }))
    } else {
        None
    }
}

pub(crate) fn run_paint_value(style: &Map<String, Value>, is_start: bool, is_end: bool) -> Value {
    let mut paint = Map::new();
    paint.insert(
        "color".to_owned(),
        Value::String(string_or_default(style, "color", "#000000")),
    );
    paint.insert("font".to_owned(), font_shorthand_value(style));
    insert_non_zero_number(
        &mut paint,
        "wordSpacingPx",
        number_style(style, "wordSpacing"),
    );
    insert_non_zero_number(
        &mut paint,
        "letterSpacingPx",
        number_style(style, "letterSpacing"),
    );
    insert_optional_string(
        &mut paint,
        "backgroundColor",
        non_empty_string_style(style, "backgroundColor").as_deref(),
    );
    if let Some(radius) = positive_style(style, "borderRadius") {
        paint.insert("backgroundRadius".to_owned(), paint_number_value(radius));
    }
    if let Some(text_shadow) = non_empty_style_array(style, "textShadow") {
        paint.insert("textShadow".to_owned(), text_shadow);
    }
    if let Some(decoration) = run_decoration_value(style) {
        paint.insert("decoration".to_owned(), decoration);
    }
    if let Some(padding) = run_padding_value(style) {
        paint.insert("padding".to_owned(), padding);
    }
    if let Some(border) = run_border_value(style, is_start, is_end) {
        paint.insert("border".to_owned(), border);
    }
    Value::Object(paint)
}

pub(crate) fn font_shorthand_value(style: &Map<String, Value>) -> Value {
    json!({
        "style": string_or_default(style, "fontStyle", "normal"),
        "weight": paint_number_value(number_style(style, "fontWeight").unwrap_or(400.0)),
        "sizePx": paint_number_value(number_style(style, "fontSize").unwrap_or(16.0)),
        "family": string_or_default(style, "fontFamily", "serif"),
    })
}

pub(crate) fn run_decoration_value(style: &Map<String, Value>) -> Option<Value> {
    let color = string_or_default(style, "color", "#000000");
    let font_size = number_style(style, "fontSize").unwrap_or(16.0);
    match string_style(style, "textDecoration").as_deref() {
        Some("underline") => Some(json!({
            "kind": "underline",
            "y": paint_number_value(font_size),
            "thickness": paint_number_value(1.0),
            "color": color,
        })),
        Some("line-through") => Some(json!({
            "kind": "line-through",
            "y": paint_number_value(font_size * 0.5),
            "thickness": paint_number_value(1.0),
            "color": color,
        })),
        _ => None,
    }
}

pub(crate) fn run_padding_value(style: &Map<String, Value>) -> Option<Value> {
    let top = number_style(style, "paddingTop").unwrap_or(0.0);
    let right = number_style(style, "paddingRight").unwrap_or(0.0);
    let bottom = number_style(style, "paddingBottom").unwrap_or(0.0);
    let left = number_style(style, "paddingLeft").unwrap_or(0.0);
    if top == 0.0 && right == 0.0 && bottom == 0.0 && left == 0.0 {
        return None;
    }
    Some(json!({
        "top": paint_number_value(top),
        "right": paint_number_value(right),
        "bottom": paint_number_value(bottom),
        "left": paint_number_value(left),
    }))
}

pub(crate) fn run_border_value(
    style: &Map<String, Value>,
    is_start: bool,
    is_end: bool,
) -> Option<Value> {
    let mut border = Map::new();
    insert_optional_value(
        &mut border,
        "top",
        run_border_edge_value(style, "borderTop"),
    );
    insert_optional_value(
        &mut border,
        "bottom",
        run_border_edge_value(style, "borderBottom"),
    );
    if is_start {
        insert_optional_value(
            &mut border,
            "start",
            run_border_edge_value(style, "borderLeft"),
        );
    }
    if is_end {
        insert_optional_value(
            &mut border,
            "end",
            run_border_edge_value(style, "borderRight"),
        );
    }
    if border.is_empty() {
        None
    } else {
        Some(Value::Object(border))
    }
}

pub(crate) fn run_border_edge_value(style: &Map<String, Value>, key: &str) -> Option<Value> {
    let edge = style.get(key)?;
    if border_value_width(edge) <= 0.0 {
        return None;
    }
    if border_value_string(edge, "style").as_deref() == Some("none") {
        return None;
    }
    Some(json!({
        "widthPx": paint_number_value(border_value_width(edge)),
        "paint": border_edge_value(edge)?,
    }))
}

pub(crate) fn border_edge_paint(style: &Map<String, Value>, key: &str) -> Option<Value> {
    border_edge_value(style.get(key)?)
}

pub(crate) fn border_edge_value(edge: &Value) -> Option<Value> {
    if border_value_width(edge) <= 0.0 {
        return None;
    }
    let style = border_value_string(edge, "style").unwrap_or_else(|| "none".to_owned());
    if style == "none" {
        return None;
    }
    Some(json!({
        "color": border_value_string(edge, "color").unwrap_or_else(|| "#000000".to_owned()),
        "style": style,
    }))
}

pub(crate) fn non_empty_style_array(style: &Map<String, Value>, key: &str) -> Option<Value> {
    let value = style.get(key)?;
    if value.as_array().is_some_and(Vec::is_empty) {
        None
    } else {
        Some(round_json_value(value))
    }
}

fn non_empty_style_array_raw(style: &Map<String, Value>, key: &str) -> Option<Value> {
    let value = style.get(key)?;
    if value.as_array().is_some_and(Vec::is_empty) {
        None
    } else {
        Some(value.clone())
    }
}

pub(crate) fn apply_text_transform(text: &str, style: &Map<String, Value>) -> String {
    let transformed = match string_style(style, "textTransform").as_deref() {
        Some("uppercase") => text.to_uppercase(),
        Some("lowercase") => text.to_lowercase(),
        Some("capitalize") => capitalize_ascii_words(text),
        _ => return text.to_owned(),
    };
    if transformed.encode_utf16().count() == text.encode_utf16().count() {
        transformed
    } else {
        text.to_owned()
    }
}

pub(crate) fn capitalize_ascii_words(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut at_word_boundary = true;
    for character in text.chars() {
        if at_word_boundary && character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_uppercase());
        } else {
            output.push(character);
        }
        at_word_boundary = !character.is_ascii_alphanumeric() && character != '_';
    }
    output
}

pub(crate) fn has_inline_padding(style: &Map<String, Value>) -> bool {
    number_style(style, "paddingTop").unwrap_or(0.0) > 0.0
        || number_style(style, "paddingRight").unwrap_or(0.0) > 0.0
        || number_style(style, "paddingBottom").unwrap_or(0.0) > 0.0
        || number_style(style, "paddingLeft").unwrap_or(0.0) > 0.0
}

pub(crate) fn padding_from_style(style: &Map<String, Value>) -> InlinePadding {
    InlinePadding {
        top: number_style(style, "paddingTop").unwrap_or(0.0),
        right: number_style(style, "paddingRight").unwrap_or(0.0),
        bottom: number_style(style, "paddingBottom").unwrap_or(0.0),
        left: number_style(style, "paddingLeft").unwrap_or(0.0),
    }
}

pub(crate) fn has_inline_borders(style: &Map<String, Value>) -> bool {
    border_width(style, "borderTop") > 0.0
        || border_width(style, "borderRight") > 0.0
        || border_width(style, "borderBottom") > 0.0
        || border_width(style, "borderLeft") > 0.0
}

pub(crate) fn borders_from_style(style: &Map<String, Value>) -> InlineBorders {
    InlineBorders {
        top: style
            .get("borderTop")
            .cloned()
            .unwrap_or_else(default_border),
        right: style
            .get("borderRight")
            .cloned()
            .unwrap_or_else(default_border),
        bottom: style
            .get("borderBottom")
            .cloned()
            .unwrap_or_else(default_border),
        left: style
            .get("borderLeft")
            .cloned()
            .unwrap_or_else(default_border),
    }
}

pub(crate) fn merge_borders(
    parent: Option<&InlineBorders>,
    child: &InlineBorders,
) -> InlineBorders {
    let Some(parent) = parent else {
        return child.clone();
    };

    InlineBorders {
        top: if border_value_width(&child.top) > 0.0 {
            child.top.clone()
        } else {
            parent.top.clone()
        },
        right: if border_value_width(&child.right) > 0.0 {
            child.right.clone()
        } else {
            parent.right.clone()
        },
        bottom: if border_value_width(&child.bottom) > 0.0 {
            child.bottom.clone()
        } else {
            parent.bottom.clone()
        },
        left: if border_value_width(&child.left) > 0.0 {
            child.left.clone()
        } else {
            parent.left.clone()
        },
    }
}

pub(crate) fn merge_inherited_borders(
    style: &Map<String, Value>,
    borders: Option<&InlineBorders>,
) -> InlineBorders {
    let current = borders_from_style(style);
    let Some(borders) = borders else {
        return current;
    };

    InlineBorders {
        top: if border_value_width(&current.top) > 0.0 {
            current.top
        } else {
            borders.top.clone()
        },
        right: if border_value_width(&current.right) > 0.0 {
            current.right
        } else {
            borders.right.clone()
        },
        bottom: if border_value_width(&current.bottom) > 0.0 {
            current.bottom
        } else {
            borders.bottom.clone()
        },
        left: if border_value_width(&current.left) > 0.0 {
            current.left
        } else {
            borders.left.clone()
        },
    }
}

pub(crate) fn non_baseline_vertical_align(style: &Map<String, Value>) -> Option<String> {
    string_style(style, "verticalAlign").filter(|value| value != "baseline")
}

pub(crate) fn non_empty_string_style(style: &Map<String, Value>, key: &str) -> Option<String> {
    string_style(style, key).filter(|value| !value.is_empty())
}

pub(crate) fn positive_style(style: &Map<String, Value>, key: &str) -> Option<f64> {
    number_style(style, key).filter(|value| *value > 0.0)
}

pub(crate) fn bool_style(style: &Map<String, Value>, key: &str) -> bool {
    style.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub(crate) fn number_style(style: &Map<String, Value>, key: &str) -> Option<f64> {
    style.get(key).and_then(Value::as_f64)
}

pub(crate) fn string_style(style: &Map<String, Value>, key: &str) -> Option<String> {
    style
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

pub(crate) fn string_or_default(style: &Map<String, Value>, key: &str, default: &str) -> String {
    string_style(style, key).unwrap_or_else(|| default.to_owned())
}

pub(crate) fn resolve_margin_top(style: &Map<String, Value>, container_width: f64) -> f64 {
    resolve_style_pct(style, "marginTop", "marginTopPct", container_width)
}

pub(crate) fn resolve_margin_right(style: &Map<String, Value>, container_width: f64) -> f64 {
    resolve_style_pct(style, "marginRight", "marginRightPct", container_width)
}

pub(crate) fn resolve_margin_bottom(style: &Map<String, Value>, container_width: f64) -> f64 {
    resolve_style_pct(style, "marginBottom", "marginBottomPct", container_width)
}

pub(crate) fn resolve_margin_left(style: &Map<String, Value>, container_width: f64) -> f64 {
    resolve_style_pct(style, "marginLeft", "marginLeftPct", container_width)
}

pub(crate) fn resolve_padding_top(style: &Map<String, Value>, container_width: f64) -> f64 {
    resolve_style_pct(style, "paddingTop", "paddingTopPct", container_width)
}

pub(crate) fn resolve_padding_right(style: &Map<String, Value>, container_width: f64) -> f64 {
    resolve_style_pct(style, "paddingRight", "paddingRightPct", container_width)
}

pub(crate) fn resolve_padding_bottom(style: &Map<String, Value>, container_width: f64) -> f64 {
    resolve_style_pct(style, "paddingBottom", "paddingBottomPct", container_width)
}

pub(crate) fn resolve_padding_left(style: &Map<String, Value>, container_width: f64) -> f64 {
    resolve_style_pct(style, "paddingLeft", "paddingLeftPct", container_width)
}

pub(crate) fn resolve_style_pct(
    style: &Map<String, Value>,
    value_key: &str,
    pct_key: &str,
    container_width: f64,
) -> f64 {
    number_style(style, pct_key)
        .map(|pct| container_width * pct / 100.0)
        .unwrap_or_else(|| number_style(style, value_key).unwrap_or(0.0))
}

pub(crate) fn border_width(style: &Map<String, Value>, key: &str) -> f64 {
    style.get(key).map(border_value_width).unwrap_or(0.0)
}

pub(crate) fn border_value_width(value: &Value) -> f64 {
    value
        .as_object()
        .and_then(|object| object.get("width"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

pub(crate) fn border_value_string(value: &Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
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

fn insert_non_zero_number(output: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        if value != 0.0 {
            output.insert(key.to_owned(), paint_number_value(value));
        }
    }
}

fn default_border() -> Value {
    json!({
        "color": "#000000",
        "style": "none",
        "width": 0,
    })
}

const SEGMENT_STYLE_KEYS: &[&str] = &[
    "backgroundColor",
    "borderBottom",
    "borderLeft",
    "borderRadius",
    "borderRight",
    "borderTop",
    "display",
    "fontFamily",
    "fontSize",
    "height",
    "lineHeight",
    "lineHeightPx",
    "marginLeft",
    "marginRight",
    "objectFit",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "textTransform",
    "verticalAlign",
    "width",
];

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{block_paint_from_style, run_paint_value};

    #[test]
    fn preserves_semantic_opacity_precision_in_block_paint() {
        let style = json!({ "opacity": 0.2525 });
        let paint = block_paint_from_style(style.as_object().expect("style object"))
            .expect("opacity creates block paint");

        assert_eq!(paint["opacity"], json!(0.2525));
    }

    #[test]
    fn preserves_runtime_run_paint_precision() {
        let style = json!({ "fontSize": 14.12345, "letterSpacing": 0.27586206896551724 });
        let paint = run_paint_value(style.as_object().expect("style object"), false, false);

        assert_eq!(paint["font"]["sizePx"], json!(14.12345));
        assert_eq!(paint["letterSpacingPx"], json!(0.27586206896551724));
    }
}
