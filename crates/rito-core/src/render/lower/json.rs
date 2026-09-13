//! The primitive list as JSON: the object shape a `RITODL1` format-2
//! decoder yields, so a JSON transport and the paint-parity instrument hand
//! a renderer the same objects the binary wire does.

use serde_json::{json, Map, Number, Value};

use super::super::commands::contract::{
    ReaderColor, ReaderRect, ReaderTextRun, ReaderTextRunPaint,
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
        } => {
            let mut object = object([
                ("kind", json!("fill-rect")),
                ("rect", device_rect(*rect)),
                ("color", color(fill)),
            ]);
            insert_ground(&mut object, *ground);
            Value::Object(object)
        }
        Primitive::FillPath {
            path: outline,
            rule,
            color: fill,
            ground,
        } => {
            let mut object = object([
                ("kind", json!("fill-path")),
                ("path", path(outline)),
                (
                    "rule",
                    json!(match rule {
                        FillRule::NonZero => "nonzero",
                        FillRule::EvenOdd => "evenodd",
                    }),
                ),
                ("color", color(fill)),
            ]);
            insert_ground(&mut object, *ground);
            Value::Object(object)
        }
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

/// A fill's declared ground: its name, and for a block ground the
/// unsnapped box it covers.
fn insert_ground(object: &mut Map<String, Value>, ground: Ground) {
    let name = match ground {
        Ground::None => "none",
        Ground::Page => "page",
        Ground::Block(_) => "block",
    };
    object.insert("ground".to_owned(), json!(name));
    if let Ground::Block(rect) = ground {
        object.insert("groundRect".to_owned(), device_rect(rect));
    }
}

fn text(kind: &str, command: &ReaderTextRun) -> Value {
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
    if !command.clusters.is_empty() {
        object.insert(
            "clusters".to_owned(),
            Value::Array(
                command
                    .clusters
                    .iter()
                    .map(|cluster| {
                        json!({ "byte": cluster.byte, "x": number(cluster.x), "y": number(cluster.y) })
                    })
                    .collect(),
            ),
        );
    }
    Value::Object(object)
}

fn run_paint(paint: &ReaderTextRunPaint) -> Value {
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
    Value::Object(object)
}

fn color(color: &ReaderColor) -> Value {
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

fn reader_rect(rect: &ReaderRect) -> Value {
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
