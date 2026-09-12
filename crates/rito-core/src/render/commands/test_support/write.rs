//! Typed display commands to fixture JSON, the shape the browser pen
//! reads: what the engine's painter produces becomes the reference the
//! parity lane holds its pens to.

use serde_json::{json, Map, Number, Value};

use super::super::{
    contract::{
        ReaderBackgroundPaintV1, ReaderBackgroundSizeV1, ReaderBlockBorderV1, ReaderBlockPaintV1,
        ReaderBlockRadiusV1, ReaderBorderBoxV1, ReaderBorderEdgePaintV1, ReaderBorderStyleV1,
        ReaderBoxShadowV1, ReaderFontStyleV1, ReaderLengthV1, ReaderRectV1, ReaderRunBorderV1,
        ReaderRunDecorationKindV1, ReaderRunPaintV1, ReaderTransformV1,
    },
    DisplayCommand, DisplayTextCommand,
};
use super::color::color_css;

pub(crate) fn display_command_values(commands: &[DisplayCommand]) -> Vec<Value> {
    commands.iter().map(command_value).collect()
}

fn command_value(command: &DisplayCommand) -> Value {
    let mut fields = Map::new();
    fields.insert(
        "kind".to_owned(),
        Value::String(command.kind_name().to_owned()),
    );
    match command {
        DisplayCommand::PushState | DisplayCommand::PopState => {}
        DisplayCommand::Translate { dx, dy } => {
            fields.insert("dx".to_owned(), number(*dx));
            fields.insert("dy".to_owned(), number(*dy));
        }
        DisplayCommand::Opacity { value } => {
            fields.insert("value".to_owned(), number(*value));
        }
        DisplayCommand::Transform {
            origin,
            box_size,
            transforms,
        } => {
            fields.insert(
                "origin".to_owned(),
                json!({ "x": number(origin.x), "y": number(origin.y) }),
            );
            fields.insert(
                "box".to_owned(),
                json!({ "width": number(box_size.width), "height": number(box_size.height) }),
            );
            fields.insert(
                "transforms".to_owned(),
                Value::Array(transforms.iter().map(transform_value).collect()),
            );
        }
        DisplayCommand::ClipRect { rect, radius } => {
            fields.insert("rect".to_owned(), rect_value(rect));
            if let Some(radius) = radius {
                fields.insert(
                    "radius".to_owned(),
                    json!({ "rx": number(radius.rx), "ry": number(radius.ry) }),
                );
            }
        }
        DisplayCommand::PaintPage { rect, paint } => {
            fields.insert("rect".to_owned(), rect_value(rect));
            let mut page = Map::new();
            if let Some(color) = paint.background_color {
                page.insert(
                    "backgroundColor".to_owned(),
                    Value::String(color_css(color)),
                );
            }
            fields.insert("paint".to_owned(), Value::Object(page));
        }
        DisplayCommand::PaintBlock {
            rect,
            paint,
            border_box,
        } => {
            fields.insert("rect".to_owned(), rect_value(rect));
            fields.insert("paint".to_owned(), block_paint_value(paint));
            if let Some(border_box) = border_box {
                fields.insert("borderBox".to_owned(), border_box_value(border_box));
            }
        }
        DisplayCommand::PaintText(text) | DisplayCommand::PaintRuby(text) => {
            insert_text_fields(&mut fields, text);
        }
        DisplayCommand::PaintImage {
            src,
            rect,
            alt,
            href,
            source_rect,
        } => {
            fields.insert("src".to_owned(), Value::String(src.clone()));
            fields.insert("rect".to_owned(), rect_value(rect));
            insert_optional_string(&mut fields, "alt", alt.as_deref());
            insert_optional_string(&mut fields, "href", href.as_deref());
            if let Some(source_rect) = source_rect {
                fields.insert("sourceRect".to_owned(), rect_value(source_rect));
            }
        }
        DisplayCommand::PaintHorizontalRule { rect, paint } => {
            fields.insert("rect".to_owned(), rect_value(rect));
            fields.insert(
                "paint".to_owned(),
                json!({ "color": color_css(paint.color), "style": border_style_name(paint.style) }),
            );
        }
    }
    Value::Object(fields)
}

fn insert_text_fields(fields: &mut Map<String, Value>, text: &DisplayTextCommand) {
    fields.insert("text".to_owned(), Value::String(text.text.clone()));
    fields.insert("rect".to_owned(), rect_value(&text.rect));
    fields.insert("paint".to_owned(), run_paint_value(&text.paint));
    if let Some(line_height) = text.line_height_px {
        fields.insert("lineHeightPx".to_owned(), number(line_height));
    }
    insert_optional_string(fields, "href", text.href.as_deref());
    insert_optional_string(fields, "sourceText", text.source_text.as_deref());
    if let Some(offset) = text.source_text_offset {
        fields.insert("sourceTextOffset".to_owned(), Value::from(offset));
    }
    if !text.clusters.is_empty() {
        fields.insert(
            "clusters".to_owned(),
            Value::Array(
                text.clusters
                    .iter()
                    .map(|(byte, x, y)| {
                        Value::Array(vec![Value::from(*byte), number(*x), number(*y)])
                    })
                    .collect(),
            ),
        );
    }
}

fn run_paint_value(paint: &ReaderRunPaintV1) -> Value {
    let mut output = Map::new();
    output.insert("color".to_owned(), Value::String(color_css(paint.color)));
    output.insert(
        "font".to_owned(),
        json!({
            "family": paint.font.family,
            "sizePx": number(paint.font.size_px),
            "style": match paint.font.style {
                ReaderFontStyleV1::Normal => "normal",
                ReaderFontStyleV1::Italic => "italic",
            },
            "weight": number(paint.font.weight),
        }),
    );
    insert_optional_number(&mut output, "wordSpacingPx", paint.word_spacing_px);
    insert_optional_number(&mut output, "letterSpacingPx", paint.letter_spacing_px);
    if let Some(color) = paint.background_color {
        output.insert(
            "backgroundColor".to_owned(),
            Value::String(color_css(color)),
        );
    }
    insert_optional_number(&mut output, "backgroundRadius", paint.background_radius);
    if !paint.text_shadows.is_empty() {
        output.insert(
            "textShadow".to_owned(),
            Value::Array(
                paint
                    .text_shadows
                    .iter()
                    .map(|shadow| {
                        json!({
                            "offsetX": number(shadow.offset_x),
                            "offsetY": number(shadow.offset_y),
                            "blur": number(shadow.blur),
                            "color": color_css(shadow.color),
                        })
                    })
                    .collect(),
            ),
        );
    }
    if let Some(decoration) = paint.decoration {
        output.insert(
            "decoration".to_owned(),
            json!({
                "kind": match decoration.kind {
                    ReaderRunDecorationKindV1::Underline => "underline",
                    ReaderRunDecorationKindV1::LineThrough => "line-through",
                },
                "y": number(decoration.y),
                "thickness": number(decoration.thickness),
                "color": color_css(decoration.color),
            }),
        );
    }
    if let Some(padding) = paint.padding {
        output.insert(
            "padding".to_owned(),
            json!({
                "top": number(padding.top),
                "right": number(padding.right),
                "bottom": number(padding.bottom),
                "left": number(padding.left),
            }),
        );
    }
    if let Some(border) = &paint.border {
        output.insert("border".to_owned(), run_border_value(border));
    }
    // Emitted only when false: a run that does not open/close its inline
    // box; absent flags read as an unsplit box.
    if !paint.box_start {
        output.insert("boxStart".to_owned(), Value::Bool(false));
    }
    if !paint.box_end {
        output.insert("boxEnd".to_owned(), Value::Bool(false));
    }
    if let Some((top, bottom)) = paint.box_offsets {
        output.insert(
            "box".to_owned(),
            json!({ "topPx": number(top), "bottomPx": number(bottom) }),
        );
    }
    Value::Object(output)
}

fn run_border_value(border: &ReaderRunBorderV1) -> Value {
    let mut output = Map::new();
    for (key, edge) in [
        ("top", border.top),
        ("bottom", border.bottom),
        ("start", border.start),
        ("end", border.end),
    ] {
        if let Some(edge) = edge {
            output.insert(
                key.to_owned(),
                json!({
                    "widthPx": number(edge.width_px),
                    "paint": border_edge_paint_value(&edge.paint),
                }),
            );
        }
    }
    Value::Object(output)
}

fn block_paint_value(paint: &ReaderBlockPaintV1) -> Value {
    let mut output = Map::new();
    if let Some(background) = &paint.background {
        output.insert("background".to_owned(), background_value(background));
    }
    if let Some(border) = &paint.border {
        output.insert("border".to_owned(), block_border_value(border));
    }
    if let Some(radius) = paint.radius {
        output.insert(
            "radius".to_owned(),
            match radius {
                ReaderBlockRadiusV1::Px(value) => json!({ "px": number(value) }),
                ReaderBlockRadiusV1::Percent(value) => json!({ "pct": number(value) }),
                ReaderBlockRadiusV1::Corners(corners) => {
                    json!({ "corners": corners.map(number).to_vec() })
                }
            },
        );
    }
    if !paint.box_shadows.is_empty() {
        output.insert(
            "boxShadow".to_owned(),
            Value::Array(paint.box_shadows.iter().map(box_shadow_value).collect()),
        );
    }
    Value::Object(output)
}

fn background_value(background: &ReaderBackgroundPaintV1) -> Value {
    let mut output = Map::new();
    if let Some(color) = background.color {
        output.insert("color".to_owned(), Value::String(color_css(color)));
    }
    if let Some(image) = &background.image {
        output.insert("image".to_owned(), Value::String(image.clone()));
    }
    if let Some(size) = background.size {
        output.insert(
            "size".to_owned(),
            match size {
                ReaderBackgroundSizeV1::Auto => json!("auto"),
                ReaderBackgroundSizeV1::Cover => json!("cover"),
                ReaderBackgroundSizeV1::Contain => json!("contain"),
                ReaderBackgroundSizeV1::Explicit { x, y } => {
                    let axis =
                        |axis: Option<ReaderLengthV1>| axis.map_or(json!("auto"), length_value);
                    json!({ "x": axis(x), "y": axis(y) })
                }
            },
        );
    }
    if let Some(repeat) = background.repeat {
        use super::super::contract::ReaderBackgroundRepeatV1 as Repeat;
        output.insert(
            "repeat".to_owned(),
            json!(match repeat {
                Repeat::Repeat => "repeat",
                Repeat::NoRepeat => "no-repeat",
                Repeat::RepeatX => "repeat-x",
                Repeat::RepeatY => "repeat-y",
                Repeat::Space => "space",
                Repeat::Round => "round",
            }),
        );
    }
    if let Some(position) = background.position {
        output.insert(
            "position".to_owned(),
            json!({ "x": length_value(position.x), "y": length_value(position.y) }),
        );
    }
    Value::Object(output)
}

fn block_border_value(border: &ReaderBlockBorderV1) -> Value {
    let mut output = Map::new();
    for (key, edge) in [
        ("top", border.top),
        ("right", border.right),
        ("bottom", border.bottom),
        ("left", border.left),
    ] {
        if let Some(edge) = edge {
            output.insert(key.to_owned(), border_edge_paint_value(&edge));
        }
    }
    Value::Object(output)
}

fn border_edge_paint_value(paint: &ReaderBorderEdgePaintV1) -> Value {
    json!({ "color": color_css(paint.color), "style": border_style_name(paint.style) })
}

fn box_shadow_value(shadow: &ReaderBoxShadowV1) -> Value {
    json!({
        "offsetX": number(shadow.offset_x),
        "offsetY": number(shadow.offset_y),
        "blur": number(shadow.blur),
        "spread": number(shadow.spread),
        "color": color_css(shadow.color),
        "inset": shadow.inset,
    })
}

fn border_box_value(border_box: &ReaderBorderBoxV1) -> Value {
    json!({
        "topWidth": number(border_box.top_width),
        "rightWidth": number(border_box.right_width),
        "bottomWidth": number(border_box.bottom_width),
        "leftWidth": number(border_box.left_width),
    })
}

fn transform_value(transform: &ReaderTransformV1) -> Value {
    match *transform {
        ReaderTransformV1::Rotate { radians } => {
            json!({ "kind": "rotate", "rad": number(radians) })
        }
        ReaderTransformV1::Scale { sx, sy } => {
            json!({ "kind": "scale", "sx": number(sx), "sy": number(sy) })
        }
        ReaderTransformV1::Translate { x, y } => {
            json!({ "kind": "translate", "x": length_value(x), "y": length_value(y) })
        }
    }
}

fn length_value(length: ReaderLengthV1) -> Value {
    match length {
        ReaderLengthV1::Px(value) => json!({ "unit": "px", "value": number(value) }),
        ReaderLengthV1::Percent(value) => json!({ "unit": "percent", "value": number(value) }),
    }
}

fn border_style_name(style: ReaderBorderStyleV1) -> &'static str {
    match style {
        ReaderBorderStyleV1::None => "none",
        ReaderBorderStyleV1::Hidden => "hidden",
        ReaderBorderStyleV1::Dotted => "dotted",
        ReaderBorderStyleV1::Dashed => "dashed",
        ReaderBorderStyleV1::Solid => "solid",
        ReaderBorderStyleV1::Double => "double",
        ReaderBorderStyleV1::Groove => "groove",
        ReaderBorderStyleV1::Ridge => "ridge",
        ReaderBorderStyleV1::Inset => "inset",
        ReaderBorderStyleV1::Outset => "outset",
    }
}

fn rect_value(rect: &ReaderRectV1) -> Value {
    json!({
        "x": number(rect.x),
        "y": number(rect.y),
        "width": number(rect.width),
        "height": number(rect.height),
    })
}

fn insert_optional_number(output: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), number(value));
    }
}

fn insert_optional_string(output: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), Value::String(value.to_owned()));
    }
}

/// A number as the fixtures spell it: integral values as integers.
fn number(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < i64::MAX as f64 {
        return Value::Number(Number::from(value as i64));
    }
    Value::Number(Number::from_f64(value).unwrap_or_else(|| Number::from(0)))
}
