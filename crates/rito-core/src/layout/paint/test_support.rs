use std::sync::Arc;

use serde_json::{Map, Value};

use super::{
    BorderEdgePaint, BorderLineStyle, FontPaint, FontPaintStyle, MeasurePaint, RunBorder,
    RunBorderEdge, RunDecoration, RunDecorationKind, RunPaint, RunPaintData, RunSpacing,
    TextShadowPaint,
};

impl RunPaint {
    pub(crate) fn from_test_wire_value(value: Value) -> Self {
        let object = value.as_object().cloned().unwrap_or_default();
        let defaults = RunPaintData::default();
        Self::new(RunPaintData {
            measure: test_measure(&object),
            color: string_field(&object, "color").unwrap_or(defaults.color),
            background_color: string_field(&object, "backgroundColor"),
            background_radius: number_field(&object, "backgroundRadius"),
            text_shadows: test_shadows(&object),
            decoration: object.get("decoration").and_then(test_decoration),
            padding: object.get("padding").and_then(test_spacing),
            border: object.get("border").and_then(test_border),
            box_offsets: None,
        })
    }
}

fn test_measure(object: &Map<String, Value>) -> MeasurePaint {
    let font = object.get("font").and_then(Value::as_object);
    let defaults = FontPaint::default();
    MeasurePaint {
        font: FontPaint {
            style: font
                .and_then(|value| string_field(value, "style"))
                .map(|value| FontPaintStyle::from_legacy(&value))
                .unwrap_or(defaults.style),
            weight: font
                .and_then(|value| number_field(value, "weight"))
                .unwrap_or(defaults.weight),
            size_px: font
                .and_then(|value| number_field(value, "sizePx"))
                .unwrap_or(defaults.size_px),
            family: font
                .and_then(|value| string_field(value, "family"))
                .unwrap_or(defaults.family),
        },
        word_spacing_px: number_field(object, "wordSpacingPx"),
        letter_spacing_px: number_field(object, "letterSpacingPx"),
    }
}

fn test_shadows(object: &Map<String, Value>) -> Arc<[TextShadowPaint]> {
    object
        .get("textShadow")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_object)
                .map(|value| TextShadowPaint {
                    offset_x: number_field(value, "offsetX").unwrap_or(0.0),
                    offset_y: number_field(value, "offsetY").unwrap_or(0.0),
                    blur: number_field(value, "blur").unwrap_or(0.0),
                    color: string_field(value, "color").unwrap_or_else(|| "#000000".to_owned()),
                })
                .collect::<Vec<_>>()
        })
        .map(Arc::from)
        .unwrap_or_else(|| Arc::from([]))
}

fn test_decoration(value: &Value) -> Option<RunDecoration> {
    let object = value.as_object()?;
    Some(RunDecoration {
        kind: RunDecorationKind::from_wire(&string_field(object, "kind")?)?,
        y: number_field(object, "y")?,
        thickness: number_field(object, "thickness")?,
        color: string_field(object, "color")?,
    })
}

fn test_spacing(value: &Value) -> Option<RunSpacing> {
    let object = value.as_object()?;
    Some(RunSpacing {
        top: number_field(object, "top").unwrap_or(0.0),
        right: number_field(object, "right").unwrap_or(0.0),
        bottom: number_field(object, "bottom").unwrap_or(0.0),
        left: number_field(object, "left").unwrap_or(0.0),
    })
}

fn test_border(value: &Value) -> Option<RunBorder> {
    let object = value.as_object()?;
    Some(RunBorder {
        top: object.get("top").and_then(test_border_edge),
        bottom: object.get("bottom").and_then(test_border_edge),
        start: object.get("start").and_then(test_border_edge),
        end: object.get("end").and_then(test_border_edge),
    })
}

fn test_border_edge(value: &Value) -> Option<RunBorderEdge> {
    let object = value.as_object()?;
    let paint = object.get("paint")?.as_object()?;
    Some(RunBorderEdge {
        width_px: number_field(object, "widthPx")?,
        paint: BorderEdgePaint {
            color: string_field(paint, "color")?,
            style: BorderLineStyle::from_legacy(&string_field(paint, "style")?)?,
        },
    })
}

fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key)?.as_str().map(str::to_owned)
}

fn number_field(object: &Map<String, Value>, key: &str) -> Option<f64> {
    object.get(key)?.as_f64()
}
