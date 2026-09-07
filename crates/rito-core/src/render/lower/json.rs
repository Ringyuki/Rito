//! The primitive list as JSON: the object shape a `RITODL1` format-2
//! decoder yields, so a JSON transport and the paint-parity instrument hand
//! a renderer the same objects the binary wire does.

use serde_json::{json, Map, Number, Value};

use super::super::commands::contract::{
    ReaderBackgroundPaintV1, ReaderBackgroundSizeV1, ReaderBlockBorderV1, ReaderBlockPaintV1,
    ReaderBlockRadiusV1, ReaderBorderBoxV1, ReaderBorderEdgePaintV1, ReaderColorV1, ReaderLengthV1,
    ReaderRectV1, ReaderRunBorderEdgeV1, ReaderRunPaintV1, ReaderTextCommandV1,
};
use super::{
    DashPattern, DevicePath, DevicePoint, DeviceRect, DeviceTransform, FillRule, Ground, PathOp,
    Primitive, PrimitiveList, StrokeCap, TilePlan,
};

pub(crate) fn primitive_list_value(list: &PrimitiveList) -> Value {
    json!({
        "formatVersion": 2,
        "ratio": number(list.ratio),
        "commandCount": list.commands.len(),
        "commands": list.commands.iter().map(primitive).collect::<Vec<_>>(),
    })
}

fn primitive(primitive: &Primitive) -> Value {
    match primitive {
        Primitive::PushState => json!({ "kind": "push-state" }),
        Primitive::PopState => json!({ "kind": "pop-state" }),
        Primitive::Translate { dx, dy } => {
            json!({ "kind": "translate", "dx": number(*dx), "dy": number(*dy) })
        }
        Primitive::Opacity { value } => json!({ "kind": "opacity", "value": number(*value) }),
        Primitive::Transform { origin, transforms } => json!({
            "kind": "transform",
            "origin": point(*origin),
            "transforms": transforms.iter().map(transform).collect::<Vec<_>>(),
        }),
        Primitive::ClipPath { path: outline } => {
            json!({ "kind": "clip-path", "path": path(outline) })
        }
        Primitive::FillRect {
            rect,
            color: fill,
            ground,
        } => json!({
            "kind": "fill-rect",
            "rect": device_rect(*rect),
            "color": color(fill),
            "ground": ground_name(*ground),
        }),
        Primitive::FillPath {
            path: outline,
            rule,
            color: fill,
        } => json!({
            "kind": "fill-path",
            "path": path(outline),
            "rule": match rule {
                FillRule::NonZero => "nonzero",
                FillRule::EvenOdd => "evenodd",
            },
            "color": color(fill),
        }),
        Primitive::StrokePath {
            path: outline,
            width,
            color: stroke,
            cap,
            dash,
        } => {
            let mut object = object([
                ("kind", json!("stroke-path")),
                ("path", path(outline)),
                ("width", number(*width)),
                ("color", color(stroke)),
                (
                    "cap",
                    json!(match cap {
                        StrokeCap::Butt => "butt",
                        StrokeCap::Round => "round",
                    }),
                ),
            ]);
            if let Some(DashPattern { on, off }) = dash {
                object.insert(
                    "dash".to_owned(),
                    json!({ "on": number(*on), "off": number(*off) }),
                );
            }
            Value::Object(object)
        }
        Primitive::Shadow {
            shape,
            sigma,
            offset,
            color: tint,
            clip_out,
        } => {
            let mut object = object([
                ("kind", json!("shadow")),
                ("shape", path(shape)),
                ("sigma", number(*sigma)),
                ("offset", point(*offset)),
                ("color", color(tint)),
            ]);
            if let Some(clip_out) = clip_out {
                object.insert("clipOut".to_owned(), path(clip_out));
            }
            Value::Object(object)
        }
        Primitive::DrawImage {
            src,
            dest,
            source_rect,
            tiles,
        } => {
            let mut object = object([
                ("kind", json!("draw-image")),
                ("src", json!(src)),
                ("dest", device_rect(*dest)),
            ]);
            if let Some(source_rect) = source_rect {
                object.insert("sourceRect".to_owned(), reader_rect(source_rect));
            }
            if let Some(plan) = tiles {
                object.insert("tiles".to_owned(), tile_plan(plan));
            }
            Value::Object(object)
        }
        Primitive::Text(command) => text("text", command),
        Primitive::Ruby(command) => text("ruby", command),
        Primitive::Block {
            rect,
            paint,
            border_box: widths,
        } => {
            let mut object = object([
                ("kind", json!("block")),
                ("rect", device_rect(*rect)),
                ("paint", block_paint(paint)),
            ]);
            if let Some(widths) = widths {
                object.insert("borderBox".to_owned(), border_box(widths));
            }
            Value::Object(object)
        }
    }
}

fn transform(transform: &DeviceTransform) -> Value {
    match *transform {
        DeviceTransform::Rotate { radians } => {
            json!({ "kind": "rotate", "radians": number(radians) })
        }
        DeviceTransform::Scale { sx, sy } => {
            json!({ "kind": "scale", "sx": number(sx), "sy": number(sy) })
        }
        DeviceTransform::Translate { dx, dy } => {
            json!({ "kind": "translate", "dx": number(dx), "dy": number(dy) })
        }
    }
}

fn path(path: &DevicePath) -> Value {
    Value::Array(
        path.ops
            .iter()
            .map(|op| match *op {
                PathOp::MoveTo(to) => {
                    json!({ "op": "move-to", "x": number(to.x), "y": number(to.y) })
                }
                PathOp::LineTo(to) => {
                    json!({ "op": "line-to", "x": number(to.x), "y": number(to.y) })
                }
                PathOp::Arc {
                    center,
                    rx,
                    ry,
                    start,
                    sweep,
                } => json!({
                    "op": "arc",
                    "cx": number(center.x),
                    "cy": number(center.y),
                    "rx": number(rx),
                    "ry": number(ry),
                    "start": number(start),
                    "sweep": number(sweep),
                }),
                PathOp::Ellipse { center, rx, ry } => json!({
                    "op": "ellipse",
                    "cx": number(center.x),
                    "cy": number(center.y),
                    "rx": number(rx),
                    "ry": number(ry),
                }),
                PathOp::Rect(rect) => {
                    let mut object = object([("op", json!("rect"))]);
                    object.extend(rect_fields(rect.x, rect.y, rect.width, rect.height));
                    Value::Object(object)
                }
                PathOp::Close => json!({ "op": "close" }),
            })
            .collect(),
    )
}

fn tile_plan(plan: &TilePlan) -> Value {
    json!({
        "origin": point(plan.origin),
        "stepX": number(plan.step_x),
        "stepY": number(plan.step_y),
        "columns": plan.columns,
        "rows": plan.rows,
    })
}

fn ground_name(ground: Ground) -> &'static str {
    match ground {
        Ground::None => "none",
        Ground::Page => "page",
        Ground::Block => "block",
    }
}

fn text(kind: &str, command: &ReaderTextCommandV1) -> Value {
    let mut object = object([
        ("kind", json!(kind)),
        ("text", json!(command.text)),
        ("rect", reader_rect(&command.rect)),
        ("paint", run_paint(&command.paint)),
    ]);
    insert_number(&mut object, "lineHeightPx", command.line_height_px);
    insert_string(&mut object, "href", command.href.as_deref());
    insert_string(&mut object, "sourceText", command.source_text.as_deref());
    if let Some(offset) = command.source_text_offset {
        object.insert("sourceTextOffset".to_owned(), json!(offset));
    }
    insert_string(&mut object, "rubyAlign", command.ruby_align.as_deref());
    Value::Object(object)
}

fn run_paint(paint: &ReaderRunPaintV1) -> Value {
    let mut object = object([
        (
            "font",
            json!({
                "family": paint.font.family,
                "sizePx": number(paint.font.size_px),
                "weight": number(paint.font.weight),
                "style": paint.font.style.tag_name(),
            }),
        ),
        ("color", color(&paint.color)),
    ]);
    insert_number(&mut object, "wordSpacingPx", paint.word_spacing_px);
    insert_number(&mut object, "letterSpacingPx", paint.letter_spacing_px);
    if let Some(background) = &paint.background_color {
        object.insert("backgroundColor".to_owned(), color(background));
    }
    insert_number(&mut object, "backgroundRadius", paint.background_radius);
    object.insert(
        "textShadows".to_owned(),
        Value::Array(
            paint
                .text_shadows
                .iter()
                .map(|shadow| {
                    json!({
                        "offsetX": number(shadow.offset_x),
                        "offsetY": number(shadow.offset_y),
                        "blur": number(shadow.blur),
                        "color": color(&shadow.color),
                    })
                })
                .collect(),
        ),
    );
    if let Some(decoration) = &paint.decoration {
        object.insert(
            "decoration".to_owned(),
            json!({
                "kind": decoration.kind.tag_name(),
                "y": number(decoration.y),
                "thickness": number(decoration.thickness),
                "color": color(&decoration.color),
            }),
        );
    }
    if let Some(padding) = &paint.padding {
        object.insert(
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
        let mut edges = Map::new();
        for (name, edge) in [
            ("top", border.top),
            ("bottom", border.bottom),
            ("start", border.start),
            ("end", border.end),
        ] {
            if let Some(edge) = edge {
                edges.insert(name.to_owned(), run_border_edge(&edge));
            }
        }
        object.insert("border".to_owned(), Value::Object(edges));
    }
    if let Some((top, bottom)) = paint.box_offsets {
        object.insert(
            "boxOffsets".to_owned(),
            json!({ "top": number(top), "bottom": number(bottom) }),
        );
    }
    object.insert("boxStart".to_owned(), Value::Bool(paint.box_start));
    object.insert("boxEnd".to_owned(), Value::Bool(paint.box_end));
    Value::Object(object)
}

fn run_border_edge(edge: &ReaderRunBorderEdgeV1) -> Value {
    json!({ "widthPx": number(edge.width_px), "paint": border_edge(&edge.paint) })
}

fn border_edge(edge: &ReaderBorderEdgePaintV1) -> Value {
    json!({ "color": color(&edge.color), "style": edge.style.tag_name() })
}

fn block_paint(paint: &ReaderBlockPaintV1) -> Value {
    let mut object = Map::new();
    if let Some(background) = &paint.background {
        object.insert("background".to_owned(), background_paint(background));
    }
    if let Some(border) = &paint.border {
        object.insert("border".to_owned(), block_border(border));
    }
    if let Some(radius) = paint.radius {
        object.insert(
            "radius".to_owned(),
            match radius {
                ReaderBlockRadiusV1::Px(value) => json!({ "unit": "px", "value": number(value) }),
                ReaderBlockRadiusV1::Percent(value) => {
                    json!({ "unit": "percent", "value": number(value) })
                }
                ReaderBlockRadiusV1::Corners(corners) => json!({
                    "unit": "corners",
                    "corners": corners.iter().map(|value| number(*value)).collect::<Vec<_>>(),
                }),
            },
        );
    }
    object.insert(
        "boxShadows".to_owned(),
        Value::Array(
            paint
                .box_shadows
                .iter()
                .map(|shadow| {
                    json!({
                        "offsetX": number(shadow.offset_x),
                        "offsetY": number(shadow.offset_y),
                        "blur": number(shadow.blur),
                        "spread": number(shadow.spread),
                        "color": color(&shadow.color),
                        "inset": shadow.inset,
                    })
                })
                .collect(),
        ),
    );
    Value::Object(object)
}

fn background_paint(background: &ReaderBackgroundPaintV1) -> Value {
    let mut object = Map::new();
    if let Some(fill) = &background.color {
        object.insert("color".to_owned(), color(fill));
    }
    insert_string(&mut object, "image", background.image.as_deref());
    if let Some(size) = background.size {
        object.insert(
            "size".to_owned(),
            match size {
                ReaderBackgroundSizeV1::Auto => json!("auto"),
                ReaderBackgroundSizeV1::Cover => json!("cover"),
                ReaderBackgroundSizeV1::Contain => json!("contain"),
                ReaderBackgroundSizeV1::Explicit { x, y } => {
                    let mut axes = Map::new();
                    if let Some(x) = x {
                        axes.insert("x".to_owned(), length(x));
                    }
                    if let Some(y) = y {
                        axes.insert("y".to_owned(), length(y));
                    }
                    Value::Object(axes)
                }
            },
        );
    }
    if let Some(repeat) = background.repeat {
        object.insert("repeat".to_owned(), json!(repeat.tag_name()));
    }
    if let Some(position) = background.position {
        object.insert(
            "position".to_owned(),
            json!({ "x": length(position.x), "y": length(position.y) }),
        );
    }
    Value::Object(object)
}

fn block_border(border: &ReaderBlockBorderV1) -> Value {
    let mut edges = Map::new();
    for (name, edge) in [
        ("top", border.top),
        ("right", border.right),
        ("bottom", border.bottom),
        ("left", border.left),
    ] {
        if let Some(edge) = edge {
            edges.insert(name.to_owned(), border_edge(&edge));
        }
    }
    Value::Object(edges)
}

fn border_box(widths: &ReaderBorderBoxV1) -> Value {
    json!({
        "topWidth": number(widths.top_width),
        "rightWidth": number(widths.right_width),
        "bottomWidth": number(widths.bottom_width),
        "leftWidth": number(widths.left_width),
    })
}

fn length(length: ReaderLengthV1) -> Value {
    match length {
        ReaderLengthV1::Px(value) => json!({ "unit": "px", "value": number(value) }),
        ReaderLengthV1::Percent(value) => json!({ "unit": "percent", "value": number(value) }),
    }
}

fn color(color: &ReaderColorV1) -> Value {
    json!({
        "space": color.space.tag_name(),
        "component0": number(f64::from(color.components[0])),
        "component1": number(f64::from(color.components[1])),
        "component2": number(f64::from(color.components[2])),
        "alpha": number(f64::from(color.alpha)),
        "none": {
            "component0": color.none.component_0,
            "component1": color.none.component_1,
            "component2": color.none.component_2,
            "alpha": color.none.alpha,
        },
    })
}

fn point(point: DevicePoint) -> Value {
    json!({ "x": number(point.x), "y": number(point.y) })
}

fn device_rect(rect: DeviceRect) -> Value {
    Value::Object(rect_fields(rect.x, rect.y, rect.width, rect.height))
}

fn reader_rect(rect: &ReaderRectV1) -> Value {
    Value::Object(rect_fields(rect.x, rect.y, rect.width, rect.height))
}

fn rect_fields(x: f64, y: f64, width: f64, height: f64) -> Map<String, Value> {
    object([
        ("x", number(x)),
        ("y", number(y)),
        ("width", number(width)),
        ("height", number(height)),
    ])
}

fn object<const N: usize>(fields: [(&str, Value); N]) -> Map<String, Value> {
    fields
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

fn insert_number(object: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        object.insert(key.to_owned(), number(value));
    }
}

fn insert_string(object: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        object.insert(key.to_owned(), Value::String(value.to_owned()));
    }
}

fn number(value: f64) -> Value {
    Value::Number(Number::from_f64(value).unwrap_or_else(|| Number::from(0)))
}
