use serde_json::{Map, Value};

use crate::layout::{BorderEdgePaint, RunBorderEdge, RunPaint};

use super::super::{
    contract::{
        ReaderBackgroundPaintV1, ReaderBackgroundPositionV1, ReaderBackgroundRepeatV1,
        ReaderBackgroundSizeV1, ReaderBlockBorderV1, ReaderBlockPaintV1, ReaderBlockRadiusV1,
        ReaderBorderBoxV1, ReaderBorderEdgePaintV1, ReaderBorderStyleV1, ReaderBoxShadowV1,
        ReaderFontPaintV1, ReaderFontStyleV1, ReaderHorizontalRulePaintV1, ReaderPagePaintV1,
        ReaderRunBorderEdgeV1, ReaderRunBorderV1, ReaderRunDecorationKindV1, ReaderRunDecorationV1,
        ReaderRunPaintV1, ReaderSpacingV1, ReaderTextShadowV1,
    },
    ReaderDisplayListWireError,
};
use super::{
    color::adapt_color,
    value::{
        adapt_length, ensure_fields, exact_object, field, field_number, field_string,
        optional_bool, optional_number, optional_string,
    },
};

pub(super) fn adapt_page_paint(
    value: &Value,
) -> Result<ReaderPagePaintV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["backgroundColor"], "paintPage.paint")?;
    let background_color =
        optional_string(object, "backgroundColor", "paintPage.paint.backgroundColor")?
            .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("none"))
            .map(|value| adapt_color(value, "paintPage.paint.backgroundColor"))
            .transpose()?;
    Ok(ReaderPagePaintV1 { background_color })
}

pub(super) fn adapt_block_paint(
    value: &Value,
) -> Result<ReaderBlockPaintV1, ReaderDisplayListWireError> {
    let object = exact_object(
        value,
        &["background", "border", "radius", "boxShadow"],
        "paintBlock.paint",
    )?;
    Ok(ReaderBlockPaintV1 {
        background: object.get("background").map(adapt_background).transpose()?,
        border: object.get("border").map(adapt_block_border).transpose()?,
        radius: object.get("radius").map(adapt_block_radius).transpose()?,
        box_shadows: object
            .get("boxShadow")
            .map(adapt_box_shadows)
            .transpose()?
            .unwrap_or_default(),
    })
}

fn adapt_background(value: &Value) -> Result<ReaderBackgroundPaintV1, ReaderDisplayListWireError> {
    let object = exact_object(
        value,
        &["color", "image", "size", "repeat", "position"],
        "paintBlock.background",
    )?;
    let color = optional_string(object, "color", "paintBlock.background.color")?
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("none"))
        .map(|value| adapt_color(value, "paintBlock.background.color"))
        .transpose()?;
    Ok(ReaderBackgroundPaintV1 {
        color,
        image: optional_string(object, "image", "paintBlock.background.image")?.map(str::to_owned),
        size: optional_string(object, "size", "paintBlock.background.size")?
            .map(adapt_background_size)
            .transpose()?,
        repeat: optional_string(object, "repeat", "paintBlock.background.repeat")?
            .map(adapt_background_repeat)
            .transpose()?,
        position: object
            .get("position")
            .map(adapt_background_position)
            .transpose()?,
    })
}

fn adapt_background_size(
    value: &str,
) -> Result<ReaderBackgroundSizeV1, ReaderDisplayListWireError> {
    match value {
        "auto" => Ok(ReaderBackgroundSizeV1::Auto),
        "cover" => Ok(ReaderBackgroundSizeV1::Cover),
        "contain" => Ok(ReaderBackgroundSizeV1::Contain),
        _ => Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
            "paintBlock.background.size",
        )),
    }
}

fn adapt_background_repeat(
    value: &str,
) -> Result<ReaderBackgroundRepeatV1, ReaderDisplayListWireError> {
    match value {
        "repeat" => Ok(ReaderBackgroundRepeatV1::Repeat),
        "no-repeat" => Ok(ReaderBackgroundRepeatV1::NoRepeat),
        "repeat-x" => Ok(ReaderBackgroundRepeatV1::RepeatX),
        "repeat-y" => Ok(ReaderBackgroundRepeatV1::RepeatY),
        "space" => Ok(ReaderBackgroundRepeatV1::Space),
        "round" => Ok(ReaderBackgroundRepeatV1::Round),
        _ => Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
            "paintBlock.background.repeat",
        )),
    }
}

fn adapt_background_position(
    value: &Value,
) -> Result<ReaderBackgroundPositionV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["x", "y"], "paintBlock.background.position")?;
    Ok(ReaderBackgroundPositionV1 {
        x: adapt_length(field(object, "x", "paintBlock.background.position")?)?,
        y: adapt_length(field(object, "y", "paintBlock.background.position")?)?,
    })
}

fn adapt_block_border(value: &Value) -> Result<ReaderBlockBorderV1, ReaderDisplayListWireError> {
    let object = exact_object(
        value,
        &["top", "right", "bottom", "left"],
        "paintBlock.border",
    )?;
    Ok(ReaderBlockBorderV1 {
        top: optional_edge(object, "top")?,
        right: optional_edge(object, "right")?,
        bottom: optional_edge(object, "bottom")?,
        left: optional_edge(object, "left")?,
    })
}

fn optional_edge(
    object: &Map<String, Value>,
    key: &str,
) -> Result<Option<ReaderBorderEdgePaintV1>, ReaderDisplayListWireError> {
    object.get(key).map(adapt_border_edge).transpose()
}

fn adapt_border_edge(value: &Value) -> Result<ReaderBorderEdgePaintV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["color", "style"], "paintBlock.border.edge")?;
    Ok(ReaderBorderEdgePaintV1 {
        color: adapt_color(
            field_string(object, "color", "paintBlock.border.edge.color")?,
            "paintBlock.border.edge.color",
        )?,
        style: adapt_border_style(field_string(
            object,
            "style",
            "paintBlock.border.edge.style",
        )?)?,
    })
}

fn adapt_block_radius(value: &Value) -> Result<ReaderBlockRadiusV1, ReaderDisplayListWireError> {
    let object = value
        .as_object()
        .ok_or(ReaderDisplayListWireError::InvalidLegacyField(
            "paintBlock.radius",
        ))?;
    ensure_fields(object, &["px", "pct", "corners"], "paintBlock.radius")?;
    match (object.get("px"), object.get("pct"), object.get("corners")) {
        (Some(value), None, None) => Ok(ReaderBlockRadiusV1::Px(super::value::finite_number(
            value,
            "paintBlock.radius.px",
        )?)),
        (None, Some(value), None) => Ok(ReaderBlockRadiusV1::Percent(super::value::finite_number(
            value,
            "paintBlock.radius.pct",
        )?)),
        (None, None, Some(value)) => {
            let entries = value
                .as_array()
                .filter(|entries| entries.len() == 4)
                .ok_or(ReaderDisplayListWireError::InvalidLegacyField(
                    "paintBlock.radius.corners",
                ))?;
            let mut corners = [0.0_f64; 4];
            for (slot, entry) in corners.iter_mut().zip(entries) {
                *slot = super::value::finite_number(entry, "paintBlock.radius.corners")?;
            }
            Ok(ReaderBlockRadiusV1::Corners(corners))
        }
        _ => Err(ReaderDisplayListWireError::InvalidLegacyField(
            "paintBlock.radius",
        )),
    }
}

fn adapt_box_shadows(value: &Value) -> Result<Vec<ReaderBoxShadowV1>, ReaderDisplayListWireError> {
    value
        .as_array()
        .ok_or(ReaderDisplayListWireError::InvalidLegacyField(
            "paintBlock.boxShadow",
        ))?
        .iter()
        .map(adapt_box_shadow)
        .collect()
}

fn adapt_box_shadow(value: &Value) -> Result<ReaderBoxShadowV1, ReaderDisplayListWireError> {
    let object = exact_object(
        value,
        &["offsetX", "offsetY", "blur", "spread", "color", "inset"],
        "paintBlock.boxShadow.item",
    )?;
    Ok(ReaderBoxShadowV1 {
        offset_x: field_number(object, "offsetX", "paintBlock.boxShadow.offsetX")?,
        offset_y: field_number(object, "offsetY", "paintBlock.boxShadow.offsetY")?,
        blur: optional_number(object, "blur", "paintBlock.boxShadow.blur")?.unwrap_or(0.0),
        spread: optional_number(object, "spread", "paintBlock.boxShadow.spread")?.unwrap_or(0.0),
        color: optional_string(object, "color", "paintBlock.boxShadow.color")?
            .map(|value| adapt_color(value, "paintBlock.boxShadow.color"))
            .transpose()?
            .unwrap_or_else(opaque_black),
        inset: optional_bool(object, "inset", "paintBlock.boxShadow.inset")?.unwrap_or(false),
    })
}

pub(super) fn adapt_border_box(
    value: &Value,
) -> Result<ReaderBorderBoxV1, ReaderDisplayListWireError> {
    let object = exact_object(
        value,
        &["topWidth", "rightWidth", "bottomWidth", "leftWidth"],
        "paintBlock.borderBox",
    )?;
    Ok(ReaderBorderBoxV1 {
        top_width: optional_number(object, "topWidth", "paintBlock.borderBox.topWidth")?
            .unwrap_or(0.0),
        right_width: optional_number(object, "rightWidth", "paintBlock.borderBox.rightWidth")?
            .unwrap_or(0.0),
        bottom_width: optional_number(object, "bottomWidth", "paintBlock.borderBox.bottomWidth")?
            .unwrap_or(0.0),
        left_width: optional_number(object, "leftWidth", "paintBlock.borderBox.leftWidth")?
            .unwrap_or(0.0),
    })
}

pub(super) fn adapt_run_paint(
    paint: &RunPaint,
) -> Result<ReaderRunPaintV1, ReaderDisplayListWireError> {
    let measure = paint.measure();
    Ok(ReaderRunPaintV1 {
        font: ReaderFontPaintV1 {
            family: measure.font.family.clone(),
            size_px: finite(measure.font.size_px)?,
            weight: finite(measure.font.weight)?,
            style: match measure.font.style.as_str() {
                "normal" => ReaderFontStyleV1::Normal,
                "italic" => ReaderFontStyleV1::Italic,
                _ => {
                    return Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
                        "text.paint.font.style",
                    ))
                }
            },
        },
        color: adapt_color(paint.color(), "text.paint.color")?,
        word_spacing_px: finite_optional(measure.word_spacing_px)?,
        letter_spacing_px: finite_optional(measure.letter_spacing_px)?,
        background_color: paint
            .background_color()
            .map(|value| adapt_color(value, "text.paint.backgroundColor"))
            .transpose()?,
        background_radius: finite_optional(paint.background_radius())?,
        text_shadows: paint
            .text_shadows()
            .iter()
            .map(|shadow| {
                Ok(ReaderTextShadowV1 {
                    offset_x: finite(shadow.offset_x)?,
                    offset_y: finite(shadow.offset_y)?,
                    blur: finite(shadow.blur)?,
                    color: adapt_color(&shadow.color, "text.paint.textShadow.color")?,
                })
            })
            .collect::<Result<Vec<_>, ReaderDisplayListWireError>>()?,
        decoration: paint
            .decoration()
            .map(|decoration| {
                Ok(ReaderRunDecorationV1 {
                    kind: match decoration.kind.as_str() {
                        "underline" => ReaderRunDecorationKindV1::Underline,
                        "line-through" => ReaderRunDecorationKindV1::LineThrough,
                        _ => {
                            return Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
                                "text.paint.decoration.kind",
                            ))
                        }
                    },
                    y: finite(decoration.y)?,
                    thickness: finite(decoration.thickness)?,
                    color: adapt_color(&decoration.color, "text.paint.decoration.color")?,
                })
            })
            .transpose()?,
        padding: paint.padding().map(|spacing| ReaderSpacingV1 {
            top: spacing.top,
            right: spacing.right,
            bottom: spacing.bottom,
            left: spacing.left,
        }),
        border: paint.border().map(adapt_run_border).transpose()?,
    })
}

fn adapt_run_border(
    border: &crate::layout::RunBorder,
) -> Result<ReaderRunBorderV1, ReaderDisplayListWireError> {
    Ok(ReaderRunBorderV1 {
        top: border.top.as_ref().map(adapt_run_border_edge).transpose()?,
        bottom: border
            .bottom
            .as_ref()
            .map(adapt_run_border_edge)
            .transpose()?,
        start: border
            .start
            .as_ref()
            .map(adapt_run_border_edge)
            .transpose()?,
        end: border.end.as_ref().map(adapt_run_border_edge).transpose()?,
    })
}

fn adapt_run_border_edge(
    edge: &RunBorderEdge,
) -> Result<ReaderRunBorderEdgeV1, ReaderDisplayListWireError> {
    Ok(ReaderRunBorderEdgeV1 {
        width_px: finite(edge.width_px)?,
        paint: adapt_typed_border_edge(&edge.paint)?,
    })
}

fn adapt_typed_border_edge(
    edge: &BorderEdgePaint,
) -> Result<ReaderBorderEdgePaintV1, ReaderDisplayListWireError> {
    Ok(ReaderBorderEdgePaintV1 {
        color: adapt_color(&edge.color, "text.paint.border.color")?,
        style: adapt_border_style(edge.style.as_str())?,
    })
}

pub(super) fn adapt_horizontal_rule_paint(
    value: &Value,
) -> Result<ReaderHorizontalRulePaintV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["color", "style"], "paintHorizontalRule.paint")?;
    Ok(ReaderHorizontalRulePaintV1 {
        color: adapt_color(
            field_string(object, "color", "paintHorizontalRule.paint.color")?,
            "paintHorizontalRule.paint.color",
        )?,
        style: adapt_border_style(field_string(
            object,
            "style",
            "paintHorizontalRule.paint.style",
        )?)?,
    })
}

fn adapt_border_style(value: &str) -> Result<ReaderBorderStyleV1, ReaderDisplayListWireError> {
    match value {
        "none" => Ok(ReaderBorderStyleV1::None),
        "hidden" => Ok(ReaderBorderStyleV1::Hidden),
        "dotted" => Ok(ReaderBorderStyleV1::Dotted),
        "dashed" => Ok(ReaderBorderStyleV1::Dashed),
        "solid" => Ok(ReaderBorderStyleV1::Solid),
        "double" => Ok(ReaderBorderStyleV1::Double),
        "groove" => Ok(ReaderBorderStyleV1::Groove),
        "ridge" => Ok(ReaderBorderStyleV1::Ridge),
        "inset" => Ok(ReaderBorderStyleV1::Inset),
        "outset" => Ok(ReaderBorderStyleV1::Outset),
        _ => Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
            "border.style",
        )),
    }
}

fn finite(value: f64) -> Result<f64, ReaderDisplayListWireError> {
    value
        .is_finite()
        .then_some(value)
        .ok_or(ReaderDisplayListWireError::NonFiniteNumber)
}

fn finite_optional(value: Option<f64>) -> Result<Option<f64>, ReaderDisplayListWireError> {
    value.map(finite).transpose()
}

fn opaque_black() -> super::super::contract::ReaderColorV1 {
    adapt_color("#000000", "default black").expect("static color is valid")
}
