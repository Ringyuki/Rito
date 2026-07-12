use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox},
    style_values::{number_style, run_paint_value, string_or_default},
    text_mapping::RunTextMapping,
    text_shape::{RunShape, RunShapeUnavailableReason},
};
use crate::style::StyledNode;

type ContinuousBlock = RuntimeBlock<LineBox>;
type ContinuousChild = RuntimeChild<LineBox>;

#[derive(Debug, Clone)]
pub(crate) struct ContinuousListContext {
    list_style_type: String,
    counter: usize,
}

pub(crate) fn create_continuous_list_context(node: &StyledNode) -> Option<ContinuousListContext> {
    match node.tag.as_deref() {
        Some("ol") | Some("ul") => Some(ContinuousListContext {
            list_style_type: string_or_default(&node.style, "listStyleType", "none"),
            counter: 0,
        }),
        _ => None,
    }
}

pub(crate) fn add_continuous_list_marker(
    block: &mut ContinuousBlock,
    node: &StyledNode,
    list_ctx: &mut Option<ContinuousListContext>,
) {
    if node.tag.as_deref() != Some("li") {
        return;
    }
    let Some(list_ctx) = list_ctx.as_mut() else {
        return;
    };
    if list_ctx.list_style_type == "none"
        || string_or_default(&node.style, "listStyleType", "none") == "none"
    {
        return;
    }

    list_ctx.counter += 1;
    let Some(ContinuousChild::Line(first_line)) = block.children.first_mut() else {
        return;
    };
    let marker_text = format_continuous_list_marker(list_ctx.counter, &list_ctx.list_style_type);
    if marker_text.is_empty() {
        return;
    }
    let marker_y = first_line.runs.first().map(LineRun::y).unwrap_or(0.0);
    let font_size = number_style(&node.style, "fontSize").unwrap_or(16.0);
    first_line.runs.insert(
        0,
        LineRun::Text(TextRunBox {
            text: marker_text,
            text_mapping: RunTextMapping::synthetic(),
            x: -LIST_MARKER_AREA_WIDTH,
            y: marker_y,
            width: LIST_MARKER_AREA_WIDTH,
            height: first_line.height,
            font_size,
            paint: run_paint_value(&node.style, false, false),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
            shape: RunShape::unavailable(
                RunShapeUnavailableReason::SyntheticLayoutText,
                LIST_MARKER_AREA_WIDTH,
            ),
        }),
    );
}

fn format_continuous_list_marker(counter: usize, list_style_type: &str) -> String {
    match list_style_type {
        "decimal" => format!("{counter}."),
        "disc" => "\u{2022}".to_owned(),
        "lower-alpha" => format!("{}.", to_continuous_lower_alpha(counter)),
        "upper-alpha" => format!("{}.", to_continuous_lower_alpha(counter).to_uppercase()),
        "lower-roman" => format!("{}.", to_continuous_lower_roman(counter)),
        "upper-roman" => format!("{}.", to_continuous_lower_roman(counter).to_uppercase()),
        "square" => "\u{25aa}".to_owned(),
        "circle" => "\u{25cb}".to_owned(),
        _ => String::new(),
    }
}

fn to_continuous_lower_alpha(mut number: usize) -> String {
    let mut result = String::new();
    while number > 0 {
        number -= 1;
        let ch = char::from_u32('a' as u32 + (number % 26) as u32).unwrap_or('a');
        result.insert(0, ch);
        number /= 26;
    }
    result
}

fn to_continuous_lower_roman(mut number: usize) -> String {
    let mut result = String::new();
    for (value, symbol) in LIST_ROMAN_PAIRS {
        while number >= *value {
            result.push_str(symbol);
            number -= *value;
        }
    }
    result
}

const LIST_MARKER_AREA_WIDTH: f64 = 24.0;
const LIST_ROMAN_PAIRS: &[(usize, &str)] = &[
    (1000, "m"),
    (900, "cm"),
    (500, "d"),
    (400, "cd"),
    (100, "c"),
    (90, "xc"),
    (50, "l"),
    (40, "xl"),
    (10, "x"),
    (9, "ix"),
    (5, "v"),
    (4, "iv"),
    (1, "i"),
];
