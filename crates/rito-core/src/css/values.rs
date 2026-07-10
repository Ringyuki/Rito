use std::collections::BTreeSet;

use serde_json::{Map, Number, Value};

use super::{
    tokens::{
        extract_function_argument, split_component_values, split_declarations,
        split_top_level_commas, split_top_level_slashes,
    },
    CssViewport,
};

#[cfg(test)]
const BASE_FONT_SIZE: f64 = 16.0;

#[derive(Debug, Clone, Copy)]
struct ParseContext {
    parent_font_size: f64,
    root_font_size: f64,
    viewport: Option<CssViewport>,
}

#[derive(Debug)]
pub(crate) struct ParsedDeclarations {
    pub keys: BTreeSet<String>,
    pub values: Map<String, Value>,
}

#[cfg(test)]
pub(crate) fn parse_declarations(body: &str) -> ParsedDeclarations {
    parse_declarations_with_font_size(body, BASE_FONT_SIZE, BASE_FONT_SIZE)
}

pub(crate) fn parse_declarations_with_font_size(
    body: &str,
    parent_font_size: f64,
    root_font_size: f64,
) -> ParsedDeclarations {
    parse_declarations_with_viewport(body, parent_font_size, root_font_size, None)
}

pub(crate) fn parse_declarations_with_viewport(
    body: &str,
    parent_font_size: f64,
    root_font_size: f64,
    viewport: Option<CssViewport>,
) -> ParsedDeclarations {
    let mut output = ParsedDeclarations {
        keys: BTreeSet::new(),
        values: Map::new(),
    };
    let context = ParseContext {
        parent_font_size,
        root_font_size,
        viewport,
    };
    for declaration in split_declarations(body) {
        let property = declaration.property.to_ascii_lowercase();
        let value = strip_important(declaration.value);
        apply_declaration(&property, value, context, &mut output);
    }

    output
}

fn apply_declaration(
    property: &str,
    value: &str,
    context: ParseContext,
    output: &mut ParsedDeclarations,
) {
    let normalized_keyword = value.trim().to_ascii_lowercase();
    let keyword = normalized_keyword.as_str();

    match property {
        "background" => apply_background(value, output),
        "background-color" => insert_string(output, "backgroundColor", value),
        "background-image" => {
            add_key(output, "backgroundImage");
            if value.trim() == "none" {
                output.values.remove("backgroundImage");
            } else if let Some(url) = extract_url(value) {
                insert_string(output, "backgroundImage", &url);
            }
        }
        "background-position" => {
            if let Some(position) = parse_background_position(value) {
                insert(output, "backgroundPosition", position);
            }
        }
        "background-repeat" => {
            if matches!(keyword, "repeat" | "no-repeat") {
                insert_string(output, "backgroundRepeat", keyword);
            }
        }
        "background-size" => {
            if matches!(keyword, "cover" | "contain" | "auto") {
                insert_string(output, "backgroundSize", keyword);
            }
        }
        "box-sizing" if matches!(keyword, "border-box" | "content-box") => {
            insert_string(output, "boxSizing", keyword)
        }
        "box-shadow" => apply_box_shadow(value, context, output),
        "border" => {
            if let Some(border) = parse_border(value, context) {
                for key in ["borderTop", "borderRight", "borderBottom", "borderLeft"] {
                    insert(output, key, border.clone());
                }
            }
        }
        "border-top" => insert_border(output, "borderTop", value, context),
        "border-right" => insert_border(output, "borderRight", value, context),
        "border-bottom" => insert_border(output, "borderBottom", value, context),
        "border-left" => insert_border(output, "borderLeft", value, context),
        "border-radius" => apply_border_radius(value, context, output),
        "clear" if matches!(keyword, "left" | "right" | "both" | "none") => {
            insert_string(output, "clear", keyword)
        }
        "color" => insert_string(output, "color", value),
        "display" if matches!(keyword, "block" | "inline" | "inline-block" | "none") => {
            insert_string(output, "display", keyword)
        }
        "float" if matches!(keyword, "left" | "right" | "none") => {
            insert_string(output, "float", keyword)
        }
        "font-family" => insert_string(output, "fontFamily", value),
        "font-size" => apply_font_size(value, context, output),
        "font-style" if matches!(keyword, "normal" | "italic" | "oblique") => insert_string(
            output,
            "fontStyle",
            if keyword == "oblique" {
                "italic"
            } else {
                keyword
            },
        ),
        "font-weight" => apply_font_weight(value, output),
        "height" => apply_dimension(output, "height", value, false, context),
        "letter-spacing" => insert_length(output, "letterSpacing", value, context),
        "line-height" => apply_line_height(value, context, output),
        "list-style" => apply_list_style(value, output),
        "list-style-type" => {
            apply_list_style_type(value, output);
        }
        "margin" => apply_box_shorthand(output, "margin", value, context),
        "margin-top" => {
            apply_length_or_percent(output, "marginTop", "marginTopPct", value, context)
        }
        "margin-right" => apply_horizontal_margin(
            output,
            "marginRight",
            "marginRightAuto",
            value,
            context,
            false,
        ),
        "margin-bottom" => {
            apply_length_or_percent(output, "marginBottom", "marginBottomPct", value, context)
        }
        "margin-left" => apply_horizontal_margin(
            output,
            "marginLeft",
            "marginLeftAuto",
            value,
            context,
            false,
        ),
        "max-height" => apply_dimension(output, "maxHeight", value, false, context),
        "max-width" => apply_dimension(output, "maxWidth", value, true, context),
        "min-height" => apply_dimension(output, "minHeight", value, false, context),
        "object-fit" if matches!(keyword, "fill" | "contain" | "cover" | "scale-down") => {
            insert_string(output, "objectFit", keyword)
        }
        "opacity" => apply_opacity(value, output),
        "overflow" if matches!(keyword, "visible" | "hidden") => {
            insert_string(output, "overflow", keyword)
        }
        "page-break-after" => apply_page_break(output, "pageBreakAfter", keyword),
        "page-break-before" => apply_page_break(output, "pageBreakBefore", keyword),
        "padding" => apply_box_shorthand(output, "padding", value, context),
        "padding-top" => {
            apply_length_or_percent(output, "paddingTop", "paddingTopPct", value, context)
        }
        "padding-right" => {
            apply_length_or_percent(output, "paddingRight", "paddingRightPct", value, context)
        }
        "padding-bottom" => {
            apply_length_or_percent(output, "paddingBottom", "paddingBottomPct", value, context)
        }
        "padding-left" => {
            apply_length_or_percent(output, "paddingLeft", "paddingLeftPct", value, context)
        }
        "position" if matches!(keyword, "static" | "relative" | "absolute") => {
            insert_string(output, "position", keyword)
        }
        "top" => insert_length(output, "top", value, context),
        "right" => insert_length(output, "right", value, context),
        "bottom" => insert_length(output, "bottom", value, context),
        "left" => insert_length(output, "left", value, context),
        "orphans" => insert_positive_integer(output, "orphans", value),
        "widows" => insert_positive_integer(output, "widows", value),
        "break-after" => apply_page_break(output, "pageBreakAfter", keyword),
        "break-before" => apply_page_break(output, "pageBreakBefore", keyword),
        "text-align" if matches!(keyword, "left" | "right" | "center" | "justify") => {
            insert_string(output, "textAlign", keyword)
        }
        "text-decoration" if matches!(keyword, "none" | "underline" | "line-through") => {
            insert_string(output, "textDecoration", keyword)
        }
        "text-indent" => insert_length(output, "textIndent", value, context),
        "text-justify" => apply_text_justify(value, output),
        "text-shadow" => apply_text_shadow(value, context, output),
        "text-transform"
            if matches!(keyword, "none" | "uppercase" | "lowercase" | "capitalize") =>
        {
            insert_string(output, "textTransform", keyword)
        }
        "transform" => apply_transform(value, output),
        "vertical-align" => apply_vertical_align(value, output),
        "white-space" if matches!(keyword, "normal" | "pre" | "pre-wrap" | "nowrap") => {
            insert_string(output, "whiteSpace", keyword)
        }
        "width" => apply_dimension(output, "width", value, true, context),
        "line-break" if matches!(keyword, "auto" | "normal" | "strict") => {
            insert_string(output, "lineBreak", keyword)
        }
        "word-break" if matches!(keyword, "normal" | "break-all" | "break-word" | "keep-all") => {
            insert_string(output, "wordBreak", keyword)
        }
        "word-spacing" => insert_length(output, "wordSpacing", value, context),
        _ => {}
    }
}

fn apply_background(value: &str, output: &mut ParsedDeclarations) {
    add_keys(
        output,
        &[
            "backgroundColor",
            "backgroundImage",
            "backgroundPosition",
            "backgroundRepeat",
            "backgroundSize",
        ],
    );
    insert_string(output, "backgroundColor", "");
    output.values.remove("backgroundImage");
    insert_string(output, "backgroundSize", "auto");
    insert_string(output, "backgroundRepeat", "repeat");
    insert_background_position(output, 0.0, 0.0);
    if value.contains("gradient") {
        return;
    }

    let mut position_tokens = Vec::new();
    for token in tokenize_background(value) {
        let lower = token.to_ascii_lowercase();
        if let Some(url) = extract_url(token) {
            insert_string(output, "backgroundImage", &url);
        } else if matches!(lower.as_str(), "repeat" | "no-repeat") {
            insert_string(output, "backgroundRepeat", lower.as_str());
        } else if matches!(lower.as_str(), "cover" | "contain" | "auto") {
            insert_string(output, "backgroundSize", lower.as_str());
        } else if is_background_position_keyword(&lower) {
            position_tokens.push(lower);
        } else if !is_ignored_background_keyword(&lower) {
            insert_string(output, "backgroundColor", token);
        }
    }
    if !position_tokens.is_empty() {
        let joined = position_tokens.join(" ");
        if let Some(position) = parse_background_position(&joined) {
            insert(output, "backgroundPosition", position);
        }
    }
}

fn tokenize_background(value: &str) -> Vec<&str> {
    split_component_values(value)
        .into_iter()
        .flat_map(split_top_level_slashes)
        .filter(|token| !token.is_empty())
        .collect()
}

fn apply_border_radius(value: &str, context: ParseContext, output: &mut ParsedDeclarations) {
    if is_calc_with_percent(value) {
        return;
    }
    let Some(first) = split_component_values(value).into_iter().next() else {
        return;
    };
    if first.starts_with('-') {
        return;
    }
    if let Some(percent) = parse_percent(first) {
        insert_number(output, "borderRadiusPct", percent);
        insert_number(output, "borderRadius", 0.0);
    } else {
        insert_non_negative_length_with_viewport(output, "borderRadius", first, context);
    }
}

fn apply_font_weight(value: &str, output: &mut ParsedDeclarations) {
    let normalized = value.trim().to_ascii_lowercase();
    let weight = match normalized.as_str() {
        "bold" => Some(700.0),
        "bolder" => Some(700.0),
        "lighter" => Some(100.0),
        "normal" => Some(400.0),
        _ => parse_int_prefix(&normalized)
            .map(|weight| weight as f64)
            .filter(|weight| (1.0..=1000.0).contains(weight)),
    };
    if let Some(weight) = weight {
        insert_number(output, "fontWeight", weight);
    }
}

fn apply_font_size(value: &str, context: ParseContext, output: &mut ParsedDeclarations) {
    let normalized = value.trim().to_ascii_lowercase();
    let value = normalized.as_str();
    match value {
        "xx-small" => insert_number(output, "fontSize", 9.0),
        "x-small" => insert_number(output, "fontSize", 10.0),
        "small" => insert_number(output, "fontSize", 13.0),
        "medium" => insert_number(output, "fontSize", 16.0),
        "large" => insert_number(output, "fontSize", 18.0),
        "x-large" => insert_number(output, "fontSize", 24.0),
        "xx-large" => insert_number(output, "fontSize", 32.0),
        "xxx-large" => insert_number(output, "fontSize", 48.0),
        "smaller" => insert_number(output, "fontSize", context.parent_font_size * 0.833),
        "larger" => insert_number(output, "fontSize", context.parent_font_size * 1.2),
        _ => {
            if let Some(length) =
                parse_length(value, context.parent_font_size, context.root_font_size)
            {
                insert_number(output, "fontSize", length);
            } else if let Some(percent) = parse_percent(value) {
                insert_number(
                    output,
                    "fontSize",
                    context.parent_font_size * percent / 100.0,
                );
            } else {
                insert_length(output, "fontSize", value, context);
            }
        }
    }
}

fn apply_line_height(value: &str, context: ParseContext, output: &mut ParsedDeclarations) {
    add_key(output, "lineHeight");
    add_key(output, "lineHeightPx");

    if let Some(line_height) =
        parse_line_height(value, context.parent_font_size, context.root_font_size)
    {
        insert_number(output, "lineHeight", line_height);
        if !is_unitless_line_height(value) {
            insert_number(
                output,
                "lineHeightPx",
                context.parent_font_size * line_height,
            );
        } else {
            output.values.remove("lineHeightPx");
        }
    }
}

fn parse_line_height(value: &str, font_size: f64, root_font_size: f64) -> Option<f64> {
    let normalized = value.trim().to_ascii_lowercase();
    let value = normalized.as_str();
    if value.starts_with("calc(") {
        return parse_length(value, font_size, root_font_size).map(|px| px / font_size);
    }
    if let Some(number) = value.strip_suffix("px").and_then(parse_float_prefix) {
        return Some(number / font_size);
    }
    if let Some(number) = value.strip_suffix("rem").and_then(parse_float_prefix) {
        return Some(number * root_font_size / font_size);
    }
    if let Some(number) = value.strip_suffix("em").and_then(parse_float_prefix) {
        return Some(number);
    }
    if let Some(percent) = parse_percent(value) {
        return Some(percent / 100.0);
    }
    parse_css_number_prefix(value)
}

fn is_unitless_line_height(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.')
        && value.parse::<f64>().is_ok()
}

fn apply_list_style(value: &str, output: &mut ParsedDeclarations) {
    for token in split_component_values(value) {
        if apply_list_style_type(token, output) {
            return;
        }
    }
}

fn apply_list_style_type(value: &str, output: &mut ParsedDeclarations) -> bool {
    let value = value.trim().to_ascii_lowercase();
    let normalized = match value.as_str() {
        "none" | "disc" | "circle" | "square" | "decimal" | "lower-roman" | "upper-roman"
        | "lower-alpha" | "upper-alpha" => value.as_str(),
        "decimal-leading-zero" => "decimal",
        "lower-latin" => "lower-alpha",
        "upper-latin" => "upper-alpha",
        _ => return false,
    };
    insert_string(output, "listStyleType", normalized);
    true
}

fn apply_box_shorthand(
    output: &mut ParsedDeclarations,
    prefix: &str,
    value: &str,
    context: ParseContext,
) {
    let values = expand_box_values(value);
    match prefix {
        "margin" => {
            add_key(output, "marginRightAuto");
            add_key(output, "marginLeftAuto");
            apply_vertical_margin(output, "marginTop", "marginTopPct", values[0], context);
            apply_horizontal_margin(
                output,
                "marginRight",
                "marginRightAuto",
                values[1],
                context,
                true,
            );
            apply_vertical_margin(
                output,
                "marginBottom",
                "marginBottomPct",
                values[2],
                context,
            );
            apply_horizontal_margin(
                output,
                "marginLeft",
                "marginLeftAuto",
                values[3],
                context,
                true,
            );
        }
        "padding" => {
            apply_length_or_percent(output, "paddingTop", "paddingTopPct", values[0], context);
            apply_length_or_percent(
                output,
                "paddingRight",
                "paddingRightPct",
                values[1],
                context,
            );
            apply_length_or_percent(
                output,
                "paddingBottom",
                "paddingBottomPct",
                values[2],
                context,
            );
            apply_length_or_percent(output, "paddingLeft", "paddingLeftPct", values[3], context);
        }
        _ => {}
    }
}

fn apply_vertical_margin(
    output: &mut ParsedDeclarations,
    px_key: &str,
    pct_key: &str,
    value: &str,
    context: ParseContext,
) {
    if value == "auto" {
        insert_number(output, px_key, 0.0);
        return;
    }
    apply_length_or_percent(output, px_key, pct_key, value, context);
}

fn apply_horizontal_margin(
    output: &mut ParsedDeclarations,
    key: &str,
    auto_key: &str,
    value: &str,
    context: ParseContext,
    clear_auto_for_percent: bool,
) {
    if is_calc_with_percent(value) {
        return;
    }
    if let Some(percent) = parse_nonzero_percent(value) {
        if clear_auto_for_percent {
            insert_bool(output, auto_key, false);
        }
        insert_number(output, &format!("{key}Pct"), percent);
        return;
    }

    add_key(output, auto_key);
    if value == "auto" {
        insert_bool(output, auto_key, true);
        insert_number(output, key, 0.0);
        return;
    }

    insert_bool(output, auto_key, false);
    apply_length_or_percent(output, key, &format!("{key}Pct"), value, context);
}

fn apply_length_or_percent(
    output: &mut ParsedDeclarations,
    px_key: &str,
    pct_key: &str,
    value: &str,
    context: ParseContext,
) {
    if is_calc_with_percent(value) {
        return;
    }
    if let Some(percent) = parse_nonzero_percent(value) {
        insert_number(output, pct_key, percent);
    } else {
        insert_length_with_viewport(output, px_key, value, context);
    }
}

fn apply_dimension(
    output: &mut ParsedDeclarations,
    key: &str,
    value: &str,
    allow_percent: bool,
    context: ParseContext,
) {
    if value == "auto" {
        return;
    }
    if is_calc_with_percent(value) {
        return;
    }
    if allow_percent && value.ends_with('%') {
        if let Some(percent) = parse_positive_percent(value) {
            insert_number(output, &format!("{key}Pct"), percent);
        }
        return;
    }
    if !value.ends_with('%') {
        insert_positive_length_with_viewport(output, key, value, context);
    }
}

fn apply_page_break(output: &mut ParsedDeclarations, key: &str, value: &str) {
    match value {
        "always" | "page" => insert_string(output, key, "always"),
        "auto" => insert_string(output, key, "auto"),
        _ => {}
    }
}

fn insert_positive_integer(output: &mut ParsedDeclarations, key: &str, value: &str) {
    let Some(number) = parse_int_prefix(value.trim()) else {
        return;
    };
    if number >= 1 {
        insert_number(output, key, number as f64);
    }
}

fn apply_box_shadow(value: &str, context: ParseContext, output: &mut ParsedDeclarations) {
    if value == "none" {
        insert(output, "boxShadow", Value::Array(Vec::new()));
        return;
    }

    let shadows = split_top_level_commas(value)
        .into_iter()
        .filter_map(|shadow| parse_box_shadow(shadow, context))
        .collect::<Vec<_>>();
    if !shadows.is_empty() {
        insert(output, "boxShadow", Value::Array(shadows));
    }
}

fn parse_box_shadow(raw: &str, context: ParseContext) -> Option<Value> {
    let mut inset = false;
    let mut lengths = Vec::new();
    let mut color: Option<&str> = None;

    for token in split_component_values(raw) {
        if token == "inset" {
            inset = true;
        } else if let Some(length) =
            parse_length(token, context.parent_font_size, context.root_font_size)
        {
            lengths.push(length);
        } else {
            color = Some(token);
        }
    }

    if lengths.len() < 2 {
        return None;
    }

    Some(Value::Object(Map::from_iter([
        (
            "blur".to_owned(),
            number_value(*lengths.get(2).unwrap_or(&0.0)),
        ),
        (
            "color".to_owned(),
            Value::String(color.unwrap_or("#000000").to_owned()),
        ),
        ("inset".to_owned(), Value::Bool(inset)),
        ("offsetX".to_owned(), number_value(lengths[0])),
        ("offsetY".to_owned(), number_value(lengths[1])),
        (
            "spread".to_owned(),
            number_value(*lengths.get(3).unwrap_or(&0.0)),
        ),
    ])))
}

fn apply_opacity(value: &str, output: &mut ParsedDeclarations) {
    if let Some(opacity) = parse_float_prefix(value) {
        insert_number(output, "opacity", opacity.clamp(0.0, 1.0));
    }
}

fn apply_text_justify(value: &str, output: &mut ParsedDeclarations) {
    let value = value.trim().to_ascii_lowercase();
    let value = match value.as_str() {
        "auto" | "none" | "inter-word" | "inter-character" => value.as_str(),
        "distribute" => "inter-character",
        _ => return,
    };
    insert_string(output, "textJustify", value);
}

fn apply_text_shadow(value: &str, context: ParseContext, output: &mut ParsedDeclarations) {
    if value == "none" {
        insert(output, "textShadow", Value::Array(Vec::new()));
        return;
    }
    let shadows = split_top_level_commas(value)
        .into_iter()
        .filter_map(|shadow| parse_text_shadow(shadow, context))
        .collect::<Vec<_>>();
    if shadows.is_empty() {
        return;
    }

    add_key(output, "textShadow");
    insert(output, "textShadow", Value::Array(shadows));
}

fn parse_text_shadow(raw: &str, context: ParseContext) -> Option<Value> {
    let mut lengths = Vec::new();
    let mut color = None;
    for token in split_component_values(raw) {
        if let Some(length) = parse_length(token, context.parent_font_size, context.root_font_size)
        {
            lengths.push(length);
        } else {
            color = Some(token);
        }
    }
    if lengths.len() < 2 {
        return None;
    }
    Some(Value::Object(Map::from_iter([
        (
            "blur".to_owned(),
            number_value(*lengths.get(2).unwrap_or(&0.0)),
        ),
        (
            "color".to_owned(),
            Value::String(color.unwrap_or("#000000").to_owned()),
        ),
        ("offsetX".to_owned(), number_value(lengths[0])),
        ("offsetY".to_owned(), number_value(lengths[1])),
    ])))
}

fn apply_transform(value: &str, output: &mut ParsedDeclarations) {
    let transforms = parse_transform(value);
    if transforms.is_empty() {
        return;
    }
    add_key(output, "transform");
    insert(output, "transform", Value::Array(transforms));
}

fn parse_transform(value: &str) -> Vec<Value> {
    let mut output = Vec::new();
    let mut rest = value.trim();
    if rest.is_empty() || rest == "none" {
        return output;
    }
    while let Some(open) = rest.find('(') {
        let name = rest[..open].trim();
        let Some(relative_close) = rest[open + 1..].find(')') else {
            break;
        };
        let close = open + 1 + relative_close;
        let args = &rest[open + 1..close];
        if let Some(transform) = parse_transform_function(name, args) {
            output.push(transform);
        }
        rest = rest[close + 1..].trim_start();
    }
    output
}

fn parse_transform_function(name: &str, args: &str) -> Option<Value> {
    match name {
        "rotate" => parse_rotate_transform(args),
        "scale" => parse_scale_transform(args),
        "scaleX" => {
            let sx = parse_css_number_prefix(args)?;
            Some(scale_transform(sx, 1.0))
        }
        "scaleY" => {
            let sy = parse_css_number_prefix(args)?;
            Some(scale_transform(1.0, sy))
        }
        "translate" => parse_translate_transform(args),
        "translateX" => {
            let x = parse_length_pct(args)?;
            Some(translate_transform(x, px_value(0.0)))
        }
        "translateY" => {
            let y = parse_length_pct(args)?;
            Some(translate_transform(px_value(0.0), y))
        }
        _ => None,
    }
}

fn parse_rotate_transform(args: &str) -> Option<Value> {
    Some(Value::Object(Map::from_iter([
        ("kind".to_owned(), Value::String("rotate".to_owned())),
        ("rad".to_owned(), number_value(parse_angle(args)?)),
    ])))
}

fn parse_angle(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    let number = parse_css_number_prefix(trimmed)?;
    if trimmed.ends_with("rad") {
        Some(number)
    } else if trimmed.ends_with("turn") {
        Some(number * std::f64::consts::TAU)
    } else {
        Some(number.to_radians())
    }
}

fn parse_scale_transform(args: &str) -> Option<Value> {
    let parts = split_transform_args(args);
    let sx = parse_css_number_prefix(parts.first().copied().unwrap_or(""))?;
    let sy = parts
        .get(1)
        .and_then(|value| parse_css_number_prefix(value))
        .unwrap_or(sx);
    Some(scale_transform(sx, sy))
}

fn scale_transform(sx: f64, sy: f64) -> Value {
    Value::Object(Map::from_iter([
        ("kind".to_owned(), Value::String("scale".to_owned())),
        ("sx".to_owned(), number_value(sx)),
        ("sy".to_owned(), number_value(sy)),
    ]))
}

fn parse_translate_transform(args: &str) -> Option<Value> {
    let parts = split_transform_args(args);
    let x = parse_length_pct(parts.first().copied().unwrap_or("0"))?;
    let y = parts
        .get(1)
        .and_then(|value| parse_length_pct(value))
        .unwrap_or_else(|| px_value(0.0));
    Some(translate_transform(x, y))
}

fn translate_transform(x: Value, y: Value) -> Value {
    Value::Object(Map::from_iter([
        ("kind".to_owned(), Value::String("translate".to_owned())),
        ("x".to_owned(), x),
        ("y".to_owned(), y),
    ]))
}

fn split_transform_args(args: &str) -> Vec<&str> {
    args.split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

fn apply_vertical_align(value: &str, output: &mut ParsedDeclarations) {
    let value = value.trim().to_ascii_lowercase();
    let value = match value.as_str() {
        "baseline" | "top" | "middle" | "bottom" | "super" | "sub" | "text-top" | "text-bottom" => {
            value.as_str()
        }
        _ => return,
    };
    insert_string(output, "verticalAlign", value);
}

fn insert_border(output: &mut ParsedDeclarations, key: &str, value: &str, context: ParseContext) {
    if let Some(border) = parse_border(value, context) {
        insert(output, key, border);
    }
}

fn parse_border(value: &str, context: ParseContext) -> Option<Value> {
    let mut width = 1.0;
    let mut color = "#000000";
    let mut style = "solid";

    for token in split_component_values(value) {
        if matches!(token, "none" | "hidden") {
            style = "none";
        } else if matches!(token, "solid" | "dotted" | "dashed") {
            style = token;
        } else if matches!(token, "double" | "groove" | "ridge") {
            style = "solid";
        } else if let Some(length) =
            parse_length(token, context.parent_font_size, context.root_font_size)
        {
            width = length;
        } else {
            color = token;
        }
    }

    if style == "none" {
        width = 0.0;
    }

    Some(Value::Object(Map::from_iter([
        ("color".to_owned(), Value::String(color.to_owned())),
        ("style".to_owned(), Value::String(style.to_owned())),
        ("width".to_owned(), number_value(width)),
    ])))
}

fn expand_box_values(value: &str) -> [&str; 4] {
    let parts = split_component_values(value);
    match parts.as_slice() {
        [] => ["0", "0", "0", "0"],
        [one] => [one, one, one, one],
        [vertical, horizontal] => [vertical, horizontal, vertical, horizontal],
        [top, horizontal, bottom] => [top, horizontal, bottom, horizontal],
        [top, right, bottom, left, ..] => [top, right, bottom, left],
    }
}

fn insert_length(output: &mut ParsedDeclarations, key: &str, value: &str, context: ParseContext) {
    if let Some(length) = parse_length(value, context.parent_font_size, context.root_font_size) {
        insert_number(output, key, length);
    }
}

fn insert_length_with_viewport(
    output: &mut ParsedDeclarations,
    key: &str,
    value: &str,
    context: ParseContext,
) {
    if let Some(length) = parse_length_with_viewport(
        value,
        context.parent_font_size,
        context.root_font_size,
        context.viewport,
    ) {
        insert_number(output, key, length);
    }
}

fn insert_non_negative_length_with_viewport(
    output: &mut ParsedDeclarations,
    key: &str,
    value: &str,
    context: ParseContext,
) {
    if let Some(length) = parse_length_with_viewport(
        value,
        context.parent_font_size,
        context.root_font_size,
        context.viewport,
    ) {
        if length >= 0.0 {
            insert_number(output, key, length);
        }
    }
}

fn insert_positive_length_with_viewport(
    output: &mut ParsedDeclarations,
    key: &str,
    value: &str,
    context: ParseContext,
) {
    if let Some(length) = parse_length_with_viewport(
        value,
        context.parent_font_size,
        context.root_font_size,
        context.viewport,
    ) {
        if length > 0.0 {
            insert_number(output, key, length);
        }
    }
}

fn insert_background_position(output: &mut ParsedDeclarations, x: f64, y: f64) {
    insert(
        output,
        "backgroundPosition",
        Value::Object(Map::from_iter([
            ("x".to_owned(), length_pct_value(x)),
            ("y".to_owned(), length_pct_value(y)),
        ])),
    );
}

fn parse_background_position(value: &str) -> Option<Value> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    let tokens = split_component_values(&normalized);
    match tokens.as_slice() {
        [one] => single_background_position(one),
        [first, second, ..] if is_vertical_only(first) && is_horizontal_only(second) => Some(
            background_position_value(to_length_pct(second, true)?, to_length_pct(first, false)?),
        ),
        [first, second, ..] => Some(background_position_value(
            to_length_pct(first, true)?,
            to_length_pct(second, false)?,
        )),
        [] => None,
    }
}

fn single_background_position(token: &str) -> Option<Value> {
    if token == "center" {
        return Some(background_position_value(
            length_pct_value(50.0),
            length_pct_value(50.0),
        ));
    }
    if is_horizontal_only(token) {
        return Some(background_position_value(
            to_length_pct(token, true)?,
            length_pct_value(50.0),
        ));
    }
    if is_vertical_only(token) {
        return Some(background_position_value(
            length_pct_value(50.0),
            to_length_pct(token, false)?,
        ));
    }
    Some(background_position_value(
        parse_length_pct(token)?,
        length_pct_value(50.0),
    ))
}

fn background_position_value(x: Value, y: Value) -> Value {
    Value::Object(Map::from_iter([("x".to_owned(), x), ("y".to_owned(), y)]))
}

fn length_pct_value(value: f64) -> Value {
    Value::Object(Map::from_iter([
        ("unit".to_owned(), Value::String("percent".to_owned())),
        ("value".to_owned(), number_value(value)),
    ]))
}

fn px_value(value: f64) -> Value {
    Value::Object(Map::from_iter([
        ("unit".to_owned(), Value::String("px".to_owned())),
        ("value".to_owned(), number_value(value)),
    ]))
}

fn to_length_pct(token: &str, horizontal: bool) -> Option<Value> {
    match (horizontal, token) {
        (true, "left") | (false, "top") => Some(length_pct_value(0.0)),
        (_, "center") => Some(length_pct_value(50.0)),
        (true, "right") | (false, "bottom") => Some(length_pct_value(100.0)),
        _ => parse_length_pct(token),
    }
}

fn parse_length_pct(token: &str) -> Option<Value> {
    if let Some(percent) = parse_percent(token) {
        return Some(length_pct_value(percent));
    }
    parse_css_number_prefix(token).map(px_value)
}

fn parse_css_number_prefix(token: &str) -> Option<f64> {
    let trimmed = token.trim();
    let end = trimmed
        .char_indices()
        .take_while(|(index, character)| {
            character.is_ascii_digit()
                || matches!(character, '.' | '+' | '-')
                || ((*character == 'e' || *character == 'E') && *index > 0)
        })
        .map(|(index, character)| index + character.len_utf8())
        .last()?;
    trimmed[..end].parse::<f64>().ok()
}

fn is_background_position_keyword(token: &str) -> bool {
    matches!(token, "left" | "right" | "top" | "bottom" | "center")
}

fn is_horizontal_only(token: &str) -> bool {
    matches!(token, "left" | "right")
}

fn is_vertical_only(token: &str) -> bool {
    matches!(token, "top" | "bottom")
}

fn is_ignored_background_keyword(token: &str) -> bool {
    matches!(token, "fixed" | "scroll" | "repeat-x" | "repeat-y")
}

fn parse_length(value: &str, font_size: f64, root_font_size: f64) -> Option<f64> {
    let normalized = value.trim().to_ascii_lowercase();
    let value = normalized.as_str();
    if value == "0" {
        return Some(0.0);
    }
    if value.starts_with("calc(") {
        return evaluate_calc(value, font_size, root_font_size);
    }
    if let Some(number) = value.strip_suffix("px").and_then(parse_float_prefix) {
        return Some(number);
    }
    if let Some(number) = value.strip_suffix("pt").and_then(parse_float_prefix) {
        return Some(number * (4.0 / 3.0));
    }
    if let Some(number) = value.strip_suffix("rem").and_then(parse_float_prefix) {
        return Some(number * root_font_size);
    }
    if let Some(number) = value.strip_suffix("em").and_then(parse_float_prefix) {
        return Some(number * font_size);
    }
    if let Some(percent) = parse_percent(value) {
        return Some(percent * font_size / 100.0);
    }
    parse_bare_length(value)
}

fn parse_bare_length(value: &str) -> Option<f64> {
    let first = value.chars().next()?;
    if first.is_ascii_digit() {
        parse_float_prefix(value)
    } else {
        None
    }
}

fn parse_length_with_viewport(
    value: &str,
    font_size: f64,
    root_font_size: f64,
    viewport: Option<CssViewport>,
) -> Option<f64> {
    let normalized = value.trim().to_ascii_lowercase();
    let value = normalized.as_str();
    if let (Some(number), Some(viewport)) = (
        value.strip_suffix("vh").and_then(parse_float_prefix),
        viewport,
    ) {
        return Some(number * viewport.height / 100.0);
    }
    if let (Some(number), Some(viewport)) = (
        value.strip_suffix("vw").and_then(parse_float_prefix),
        viewport,
    ) {
        return Some(number * viewport.width / 100.0);
    }
    parse_length(value, font_size, root_font_size)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum CalcToken {
    Number(f64),
    Op(char),
    OpenParen,
    CloseParen,
}

#[derive(Debug)]
struct CalcCursor {
    tokens: Vec<CalcToken>,
    pos: usize,
}

fn evaluate_calc(value: &str, font_size: f64, root_font_size: f64) -> Option<f64> {
    let inner = value.strip_prefix("calc(")?.strip_suffix(')')?.trim();
    if inner.is_empty() {
        return None;
    }
    let tokens = tokenize_calc(inner, font_size, root_font_size)?;
    if tokens.is_empty() {
        return None;
    }
    let mut cursor = CalcCursor { tokens, pos: 0 };
    let result = parse_calc_expr(&mut cursor)?;
    (cursor.pos == cursor.tokens.len()).then_some(result)
}

fn tokenize_calc(expr: &str, font_size: f64, root_font_size: f64) -> Option<Vec<CalcToken>> {
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < expr.len() {
        let ch = expr[index..].chars().next()?;
        if ch.is_whitespace() {
            index += ch.len_utf8();
            continue;
        }
        match ch {
            '(' => {
                tokens.push(CalcToken::OpenParen);
                index += ch.len_utf8();
            }
            ')' => {
                tokens.push(CalcToken::CloseParen);
                index += ch.len_utf8();
            }
            '+' | '*' | '/' => {
                tokens.push(CalcToken::Op(ch));
                index += ch.len_utf8();
            }
            '-' if is_calc_operator_minus(&tokens) => {
                tokens.push(CalcToken::Op('-'));
                index += ch.len_utf8();
            }
            _ => {
                let (number, end) = parse_calc_number(expr, index, font_size, root_font_size)?;
                tokens.push(CalcToken::Number(number));
                index = end;
            }
        }
    }
    Some(tokens)
}

fn is_calc_operator_minus(tokens: &[CalcToken]) -> bool {
    matches!(
        tokens.last(),
        Some(CalcToken::Number(_)) | Some(CalcToken::CloseParen)
    )
}

fn parse_calc_number(
    expr: &str,
    start: usize,
    font_size: f64,
    root_font_size: f64,
) -> Option<(f64, usize)> {
    let mut index = start;
    let first = expr[index..].chars().next()?;
    if !matches!(first, '-' | '+' | '.') && !first.is_ascii_digit() {
        return None;
    }
    if matches!(first, '-' | '+') {
        index += first.len_utf8();
    }
    while index < expr.len() {
        let ch = expr[index..].chars().next()?;
        if ch.is_ascii_digit() || ch == '.' {
            index += ch.len_utf8();
        } else {
            break;
        }
    }
    let number = expr[start..index].parse::<f64>().ok()?;
    let (unit, end) = read_calc_unit(expr, index);
    let resolved = resolve_calc_unit(number, unit, font_size, root_font_size)?;
    Some((resolved, end))
}

fn read_calc_unit(expr: &str, start: usize) -> (&str, usize) {
    let mut index = start;
    while index < expr.len() {
        let ch = expr[index..].chars().next().expect("valid calc unit char");
        if ch.is_ascii_lowercase() {
            index += ch.len_utf8();
        } else {
            break;
        }
    }
    if expr[index..].starts_with('%') {
        return ("%", index + 1);
    }
    (&expr[start..index], index)
}

fn resolve_calc_unit(value: f64, unit: &str, font_size: f64, root_font_size: f64) -> Option<f64> {
    match unit {
        "" | "px" => Some(value),
        "pt" => Some(value * (4.0 / 3.0)),
        "em" => Some(value * font_size),
        "rem" => Some(value * root_font_size),
        "%" => Some(value * font_size / 100.0),
        _ => None,
    }
}

fn parse_calc_expr(cursor: &mut CalcCursor) -> Option<f64> {
    let mut left = parse_calc_term(cursor)?;
    while cursor.pos < cursor.tokens.len() {
        let op = match cursor.tokens[cursor.pos] {
            CalcToken::Op(op @ ('+' | '-')) => op,
            _ => break,
        };
        cursor.pos += 1;
        let right = parse_calc_term(cursor)?;
        left = if op == '+' {
            left + right
        } else {
            left - right
        };
    }
    Some(left)
}

fn parse_calc_term(cursor: &mut CalcCursor) -> Option<f64> {
    let mut left = parse_calc_primary(cursor)?;
    while cursor.pos < cursor.tokens.len() {
        let op = match cursor.tokens[cursor.pos] {
            CalcToken::Op(op @ ('*' | '/')) => op,
            _ => break,
        };
        cursor.pos += 1;
        let right = parse_calc_primary(cursor)?;
        left = if op == '*' {
            left * right
        } else if right == 0.0 {
            return None;
        } else {
            left / right
        };
    }
    Some(left)
}

fn parse_calc_primary(cursor: &mut CalcCursor) -> Option<f64> {
    let token = *cursor.tokens.get(cursor.pos)?;
    match token {
        CalcToken::Number(value) => {
            cursor.pos += 1;
            Some(value)
        }
        CalcToken::OpenParen => {
            cursor.pos += 1;
            let value = parse_calc_expr(cursor)?;
            if !matches!(cursor.tokens.get(cursor.pos), Some(CalcToken::CloseParen)) {
                return None;
            }
            cursor.pos += 1;
            Some(value)
        }
        _ => None,
    }
}

fn is_calc_with_percent(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.contains("calc") && normalized.contains('%')
}

fn parse_percent(value: &str) -> Option<f64> {
    value.strip_suffix('%').and_then(parse_float_prefix)
}

fn parse_nonzero_percent(value: &str) -> Option<f64> {
    parse_percent(value).filter(|percent| percent.abs() > f64::EPSILON)
}

fn parse_positive_percent(value: &str) -> Option<f64> {
    parse_percent(value).filter(|percent| *percent > 0.0)
}

fn parse_float_prefix(value: &str) -> Option<f64> {
    let trimmed = value.trim_start();
    let mut end = 0;
    for (index, character) in trimmed.char_indices() {
        if character.is_ascii_digit() || matches!(character, '.' | '+' | '-' | 'e' | 'E') {
            end = index + character.len_utf8();
        } else {
            break;
        }
    }
    while end > 0 {
        if let Ok(number) = trimmed[..end].parse::<f64>() {
            return Some(number);
        }
        let previous = trimmed[..end].char_indices().last()?.0;
        end = previous;
    }
    None
}

fn parse_int_prefix(value: &str) -> Option<i64> {
    let trimmed = value.trim_start();
    let mut chars = trimmed.char_indices();
    let mut end = 0;
    let mut saw_digit = false;

    if let Some((_, character @ ('+' | '-'))) = chars.next() {
        end = character.len_utf8();
    } else {
        chars = trimmed.char_indices();
    }

    for (index, character) in chars {
        if character.is_ascii_digit() {
            saw_digit = true;
            end = index + character.len_utf8();
        } else {
            break;
        }
    }

    saw_digit
        .then(|| trimmed[..end].parse::<i64>().ok())
        .flatten()
}

fn extract_url(value: &str) -> Option<String> {
    extract_function_argument(value, "url").map(unquote)
}

fn unquote(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        value[1..value.len() - 1].to_owned()
    } else {
        value.to_owned()
    }
}

fn strip_important(value: &str) -> &str {
    value
        .strip_suffix("!important")
        .or_else(|| value.strip_suffix("! important"))
        .map(str::trim_end)
        .unwrap_or(value)
}

fn insert_number(output: &mut ParsedDeclarations, key: &str, value: f64) {
    insert(output, key, number_value(value));
}

fn insert_string(output: &mut ParsedDeclarations, key: &str, value: &str) {
    insert(output, key, Value::String(value.to_owned()));
}

fn insert_bool(output: &mut ParsedDeclarations, key: &str, value: bool) {
    insert(output, key, Value::Bool(value));
}

fn insert(output: &mut ParsedDeclarations, key: &str, value: Value) {
    add_key(output, key);
    output.values.insert(key.to_owned(), value);
}

fn add_key(output: &mut ParsedDeclarations, key: &str) {
    output.keys.insert(key.to_owned());
}

fn add_keys(output: &mut ParsedDeclarations, keys: &[&str]) {
    for key in keys {
        add_key(output, key);
    }
}

fn number_value(value: f64) -> Value {
    if value.is_finite()
        && value.fract() == 0.0
        && value >= i64::MIN as f64
        && value <= i64::MAX as f64
    {
        Value::Number(Number::from(value as i64))
    } else {
        Value::Number(Number::from_f64(value).unwrap_or_else(|| Number::from(0)))
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_declarations, parse_declarations_with_viewport};
    use crate::css::CssViewport;
    use serde_json::json;

    #[test]
    fn parses_margin_auto_and_lengths() {
        let parsed = parse_declarations("margin: 1.2em auto 0 20%");

        assert!(parsed.keys.contains("marginRightAuto"));
        assert_eq!(parsed.values["marginTop"], json!(19.2));
        assert_eq!(parsed.values["marginRightAuto"], json!(true));
        assert_eq!(parsed.values["marginLeftPct"], json!(20));
    }

    #[test]
    fn parses_vertical_auto_margin_shorthand_as_zero() {
        let parsed = parse_declarations("margin: auto");

        assert_eq!(parsed.values["marginTop"], json!(0));
        assert_eq!(parsed.values["marginBottom"], json!(0));
        assert_eq!(parsed.values["marginRightAuto"], json!(true));
        assert_eq!(parsed.values["marginLeftAuto"], json!(true));
    }

    #[test]
    fn parses_box_shadow_values() {
        let parsed =
            parse_declarations("box-shadow: 2px 1px 0.25em #3e4653, inset 0 5px 4px 1px red");

        assert!(parsed.keys.contains("boxShadow"));
        assert_eq!(parsed.values["boxShadow"][0]["offsetX"], json!(2));
        assert_eq!(parsed.values["boxShadow"][0]["offsetY"], json!(1));
        assert_eq!(parsed.values["boxShadow"][0]["blur"], json!(4));
        assert_eq!(parsed.values["boxShadow"][0]["color"], json!("#3e4653"));
        assert_eq!(parsed.values["boxShadow"][1]["inset"], json!(true));
        assert_eq!(parsed.values["boxShadow"][1]["spread"], json!(1));
    }

    #[test]
    fn parses_background_with_quoted_url_and_size_separator() {
        let parsed = parse_declarations(
            r#"background: url("Images/cover art.png") center center / contain no-repeat #fff"#,
        );

        assert_eq!(
            parsed.values["backgroundImage"],
            json!("Images/cover art.png")
        );
        assert_eq!(parsed.values["backgroundRepeat"], json!("no-repeat"));
        assert_eq!(parsed.values["backgroundSize"], json!("contain"));
        assert_eq!(parsed.values["backgroundColor"], json!("#fff"));
        assert_eq!(
            parsed.values["backgroundPosition"],
            json!({
                "x": { "unit": "percent", "value": 50 },
                "y": { "unit": "percent", "value": 50 }
            })
        );
    }

    #[test]
    fn background_none_clears_previous_background_image() {
        let parsed =
            parse_declarations(r#"background-image: url("Images/bg.png"); background-image: none"#);
        assert!(parsed.keys.contains("backgroundImage"));
        assert!(!parsed.values.contains_key("backgroundImage"));

        let parsed =
            parse_declarations(r#"background-image: url("Images/bg.png"); background: none"#);
        assert!(parsed.keys.contains("backgroundImage"));
        assert!(!parsed.values.contains_key("backgroundImage"));
        assert_eq!(parsed.values["backgroundColor"], json!("none"));
    }

    #[test]
    fn background_image_none_is_case_sensitive_like_ts_handler() {
        let parsed =
            parse_declarations(r#"background-image: url("Images/bg.png"); background-image: NONE"#);

        assert_eq!(parsed.values["backgroundImage"], json!("Images/bg.png"));
    }

    #[test]
    fn background_gradient_resets_without_becoming_a_color() {
        let parsed = parse_declarations(
            r#"background-image: url("Images/bg.png"); background: linear-gradient(red, blue)"#,
        );

        assert!(parsed.keys.contains("backgroundImage"));
        assert!(!parsed.values.contains_key("backgroundImage"));
        assert_eq!(parsed.values["backgroundColor"], json!(""));
    }

    #[test]
    fn parses_background_position_keywords_and_lengths() {
        let parsed = parse_declarations("background-position: bottom right");

        assert_eq!(
            parsed.values["backgroundPosition"],
            json!({
                "x": { "unit": "percent", "value": 100 },
                "y": { "unit": "percent", "value": 100 }
            })
        );

        let parsed = parse_declarations("background-position: 20px 75%");
        assert_eq!(
            parsed.values["backgroundPosition"],
            json!({
                "x": { "unit": "px", "value": 20 },
                "y": { "unit": "percent", "value": 75 }
            })
        );
    }

    #[test]
    fn ignores_unsupported_background_keywords_without_turning_them_into_colors() {
        let parsed = parse_declarations("background: repeat-x fixed center / cover #fff");

        assert_eq!(parsed.values["backgroundColor"], json!("#fff"));
        assert_eq!(parsed.values["backgroundSize"], json!("cover"));
        assert_eq!(
            parsed.values["backgroundPosition"],
            json!({
                "x": { "unit": "percent", "value": 50 },
                "y": { "unit": "percent", "value": 50 }
            })
        );
    }

    #[test]
    fn parses_declarations_with_semicolons_inside_urls() {
        let parsed = parse_declarations(r#"background-image: url("Images/a;b.png"); color: red"#);

        assert_eq!(parsed.values["backgroundImage"], json!("Images/a;b.png"));
        assert_eq!(parsed.values["color"], json!("red"));
    }

    #[test]
    fn parses_multiple_text_shadows_with_color_functions() {
        let parsed = parse_declarations("text-shadow: 1px 2px rgba(0, 0, 0, .5), 0 1px 2px #fff");

        assert_eq!(parsed.values["textShadow"].as_array().unwrap().len(), 2);
        assert_eq!(parsed.values["textShadow"][0]["blur"], json!(0));
        assert_eq!(
            parsed.values["textShadow"][0]["color"],
            json!("rgba(0, 0, 0, .5)")
        );
        assert_eq!(parsed.values["textShadow"][1]["blur"], json!(2));
    }

    #[test]
    fn parses_border_color_functions_as_single_tokens() {
        let parsed = parse_declarations("border: 1px solid rgba(1, 2, 3, .5)");

        assert_eq!(
            parsed.values["borderTop"]["color"],
            json!("rgba(1, 2, 3, .5)")
        );
        assert_eq!(parsed.values["borderTop"]["width"], json!(1));
    }

    #[test]
    fn parses_text_shadow_and_transform_values() {
        let parsed = parse_declarations("text-shadow: 1px 1px 0.1em #000; transform: rotate(5deg)");

        assert!(parsed.keys.contains("textShadow"));
        assert!(parsed.keys.contains("transform"));
    }

    #[test]
    fn parses_transform_translate_scale_and_angle_units() {
        let parsed = parse_declarations(
            "transform: translate(10px, 25%) scale(2, .5) rotate(.5turn) translateY(4%) scaleX(3)",
        );
        let pi = std::f64::consts::PI;

        assert_eq!(
            parsed.values["transform"],
            json!([
                {
                    "kind": "translate",
                    "x": { "unit": "px", "value": 10 },
                    "y": { "unit": "percent", "value": 25 }
                },
                { "kind": "scale", "sx": 2, "sy": 0.5 },
                { "kind": "rotate", "rad": pi },
                {
                    "kind": "translate",
                    "x": { "unit": "px", "value": 0 },
                    "y": { "unit": "percent", "value": 4 }
                },
                { "kind": "scale", "sx": 3, "sy": 1 }
            ])
        );
    }

    #[test]
    fn parses_supported_overflow_values() {
        let parsed = parse_declarations("overflow: hidden; overflow-x: hidden");

        assert!(parsed.keys.contains("overflow"));
        assert_eq!(parsed.values["overflow"], json!("hidden"));
    }

    #[test]
    fn parses_layout_position_break_and_height_constraints() {
        let parsed = parse_declarations(
            "position: relative; top: 2px; right: 1em; break-before: page; page-break-after: always; min-height: 4em; max-height: 120px; max-width: 80%; orphans: 2; widows: 3",
        );

        assert_eq!(parsed.values["position"], json!("relative"));
        assert_eq!(parsed.values["top"], json!(2));
        assert_eq!(parsed.values["right"], json!(16));
        assert_eq!(parsed.values["pageBreakBefore"], json!("always"));
        assert_eq!(parsed.values["pageBreakAfter"], json!("always"));
        assert_eq!(parsed.values["minHeight"], json!(64));
        assert_eq!(parsed.values["maxHeight"], json!(120));
        assert_eq!(parsed.values["maxWidthPct"], json!(80));
        assert_eq!(parsed.values["orphans"], json!(2));
        assert_eq!(parsed.values["widows"], json!(3));
    }

    #[test]
    fn ignores_non_positive_dimensions_like_ts_handlers() {
        let parsed = parse_declarations(
            "width: 0; width: -1px; max-width: -25%; height: 0; min-height: -2em; max-height: 0",
        );

        assert!(!parsed.values.contains_key("width"));
        assert!(!parsed.values.contains_key("widthPct"));
        assert!(!parsed.values.contains_key("maxWidthPct"));
        assert!(!parsed.values.contains_key("height"));
        assert!(!parsed.values.contains_key("minHeight"));
        assert!(!parsed.values.contains_key("maxHeight"));
    }

    #[test]
    fn parses_calc_lengths_like_ts_parse_length() {
        let parsed = parse_declarations(
            "font-size: calc(1rem + 10px); line-height: calc(1em + 8px); width: CALC(10PX + 1EM); padding-left: calc((4px + 2px) * 2); border-radius: calc(4px + 4px); text-indent: calc(100% - 2rem)",
        );

        assert_eq!(parsed.values["fontSize"], json!(26));
        assert_eq!(parsed.values["lineHeight"], json!(1.5));
        assert_eq!(parsed.values["lineHeightPx"], json!(24));
        assert_eq!(parsed.values["width"], json!(26));
        assert_eq!(parsed.values["paddingLeft"], json!(12));
        assert_eq!(parsed.values["borderRadius"], json!(8));
        assert_eq!(parsed.values["textIndent"], json!(-16));
    }

    #[test]
    fn parses_line_height_with_ts_specific_fallback_rules() {
        let parsed = parse_declarations(
            "line-height: 12pt; line-height: 10foo; line-height: -1; line-height: 1.5",
        );

        assert_eq!(parsed.values["lineHeight"], json!(1.5));
        assert!(!parsed.values.contains_key("lineHeightPx"));

        let parsed = parse_declarations("line-height: 12pt");
        assert_eq!(parsed.values["lineHeight"], json!(12));
        assert_eq!(parsed.values["lineHeightPx"], json!(192));

        let parsed = parse_declarations("line-height: 10foo");
        assert_eq!(parsed.values["lineHeight"], json!(10));
        assert_eq!(parsed.values["lineHeightPx"], json!(160));

        let parsed = parse_declarations("line-height: -1");
        assert_eq!(parsed.values["lineHeight"], json!(-1));
        assert_eq!(parsed.values["lineHeightPx"], json!(-16));
    }

    #[test]
    fn generic_bare_lengths_follow_ts_parse_length_start_digit_rule() {
        let parsed = parse_declarations(
            "top: -5; right: -5px; letter-spacing: .5; word-spacing: 1; text-indent: -2; bottom: 0",
        );

        assert!(!parsed.values.contains_key("top"));
        assert_eq!(parsed.values["right"], json!(-5));
        assert!(!parsed.values.contains_key("letterSpacing"));
        assert_eq!(parsed.values["wordSpacing"], json!(1));
        assert!(!parsed.values.contains_key("textIndent"));
        assert_eq!(parsed.values["bottom"], json!(0));
    }

    #[test]
    fn css_numeric_values_follow_ts_parse_float_prefix_rules() {
        let parsed = parse_declarations(
            "top: 10foo; right: 12abcpx; bottom: 1e3foo; left: .5px; width: 25abc%; padding-left: 2.5remfoo",
        );

        assert_eq!(parsed.values["top"], json!(10));
        assert_eq!(parsed.values["right"], json!(12));
        assert_eq!(parsed.values["bottom"], json!(1000));
        assert_eq!(parsed.values["left"], json!(0.5));
        assert_eq!(parsed.values["widthPct"], json!(25));
        assert_eq!(parsed.values["paddingLeft"], json!(2.5));
    }

    #[test]
    fn rejects_border_radius_calc_percent_and_negative_lengths_like_ts_handlers() {
        let parsed = parse_declarations(
            "border-radius: calc(50% - 1rem); border-radius: -5px; border-radius: calc(2px - 4px)",
        );

        assert!(!parsed.values.contains_key("borderRadius"));
        assert!(!parsed.values.contains_key("borderRadiusPct"));
    }

    #[test]
    fn rejects_box_model_calc_values_that_need_containing_block_percentages() {
        let parsed = parse_declarations(
            "width: calc(100% - 20px); padding-left: calc(50% - 1rem); margin: calc(10% - 1px) 0 0 20%",
        );

        assert!(!parsed.values.contains_key("width"));
        assert!(!parsed.values.contains_key("paddingLeft"));
        assert!(!parsed.values.contains_key("marginTop"));
        assert_eq!(parsed.values["marginRight"], json!(0));
        assert_eq!(parsed.values["marginBottom"], json!(0));
        assert_eq!(parsed.values["marginLeftPct"], json!(20));
    }

    #[test]
    fn resolves_viewport_units_with_ts_parse_length_fallbacks() {
        let parsed = parse_declarations_with_viewport(
            "width: 50vw; height: 25vh; margin-top: 10vh; padding-left: 5vw; border-radius: 2vw; top: 10vh; font-size: 10vw",
            16.0,
            16.0,
            Some(CssViewport {
                width: 600.0,
                height: 800.0,
            }),
        );

        assert_eq!(parsed.values["width"], json!(300));
        assert_eq!(parsed.values["height"], json!(200));
        assert_eq!(parsed.values["marginTop"], json!(80));
        assert_eq!(parsed.values["paddingLeft"], json!(30));
        assert_eq!(parsed.values["borderRadius"], json!(12));
        assert_eq!(parsed.values["top"], json!(10));
        assert_eq!(parsed.values["fontSize"], json!(10));
    }

    #[test]
    fn parses_supported_line_breaking_values() {
        let parsed =
            parse_declarations("white-space: pre-wrap; line-break: strict; word-break: keep-all");

        assert_eq!(parsed.values["whiteSpace"], json!("pre-wrap"));
        assert_eq!(parsed.values["lineBreak"], json!("strict"));
        assert_eq!(parsed.values["wordBreak"], json!("keep-all"));
    }

    #[test]
    fn strips_important_without_implementing_priority() {
        let parsed = parse_declarations(
            "color: #123 !important; color: #456; background-color: #fff ! important",
        );

        assert_eq!(parsed.values["color"], json!("#456"));
        assert_eq!(parsed.values["backgroundColor"], json!("#fff"));
    }

    #[test]
    fn ignores_unsupported_values_without_overwriting_valid_declarations() {
        let parsed = parse_declarations("display: block; display: flex; overflow: hidden; overflow: auto; word-break: break-word");

        assert_eq!(parsed.values["display"], json!("block"));
        assert_eq!(parsed.values["overflow"], json!("hidden"));
        assert_eq!(parsed.values["wordBreak"], json!("break-word"));
    }

    #[test]
    fn parses_paint_justification_weight_and_baseline_values() {
        let parsed = parse_declarations(
            "opacity: 1.4; text-justify: distribute; vertical-align: text-bottom; font-weight: lighter",
        );

        assert_eq!(parsed.values["opacity"], json!(1));
        assert_eq!(parsed.values["textJustify"], json!("inter-character"));
        assert_eq!(parsed.values["verticalAlign"], json!("text-bottom"));
        assert_eq!(parsed.values["fontWeight"], json!(100));
    }

    #[test]
    fn ignores_font_weight_values_outside_ts_range() {
        let parsed = parse_declarations("font-weight: 0; font-weight: 1200; font-weight: -1");

        assert!(!parsed.values.contains_key("fontWeight"));
    }

    #[test]
    fn parses_font_and_integer_values_with_ts_prefix_rules() {
        let parsed = parse_declarations(
            "font-size: LARGE; font-weight: 500.5; opacity: .25abc; orphans: 2abc; widows: 3.7",
        );

        assert_eq!(parsed.values["fontSize"], json!(18));
        assert_eq!(parsed.values["fontWeight"], json!(500));
        assert_eq!(parsed.values["opacity"], json!(0.25));
        assert_eq!(parsed.values["orphans"], json!(2));
        assert_eq!(parsed.values["widows"], json!(3));
    }

    #[test]
    fn parses_css_keywords_case_insensitively_like_ts() {
        let parsed = parse_declarations(
            "display: Inline-Block; float: LEFT; clear: Both; font-style: OBLIQUE; object-fit: Cover; overflow: HIDDEN; position: Relative; text-align: CENTER; text-decoration: UNDERLINE; text-transform: Uppercase; white-space: Pre-Wrap; line-break: Strict; list-style-type: LOWER-ROMAN",
        );

        assert_eq!(parsed.values["display"], json!("inline-block"));
        assert_eq!(parsed.values["float"], json!("left"));
        assert_eq!(parsed.values["clear"], json!("both"));
        assert_eq!(parsed.values["fontStyle"], json!("italic"));
        assert_eq!(parsed.values["objectFit"], json!("cover"));
        assert_eq!(parsed.values["overflow"], json!("hidden"));
        assert_eq!(parsed.values["position"], json!("relative"));
        assert_eq!(parsed.values["textAlign"], json!("center"));
        assert_eq!(parsed.values["textDecoration"], json!("underline"));
        assert_eq!(parsed.values["textTransform"], json!("uppercase"));
        assert_eq!(parsed.values["whiteSpace"], json!("pre-wrap"));
        assert_eq!(parsed.values["lineBreak"], json!("strict"));
        assert_eq!(parsed.values["listStyleType"], json!("lower-roman"));
    }
}
