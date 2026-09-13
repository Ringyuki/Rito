//! Fixture JSON to typed display commands. Every field the fixture shape
//! carries is accepted; a shape the typed list cannot express fails the
//! fixture instead of dropping it.

use serde_json::{Map, Value};

use super::super::{
    contract::{
        ReaderBackgroundPaint, ReaderBackgroundPosition, ReaderBackgroundRepeat,
        ReaderBackgroundSize, ReaderBlockBorder, ReaderBlockPaint, ReaderBlockRadius,
        ReaderBorderBox, ReaderBorderEdgePaint, ReaderBorderStyle, ReaderBoxShadow,
        ReaderCornerRadius, ReaderFontPaint, ReaderFontStyle, ReaderHorizontalRulePaint,
        ReaderLength, ReaderPagePaint, ReaderPoint, ReaderRect, ReaderRunBorder,
        ReaderRunBorderEdge, ReaderRunDecoration, ReaderRunDecorationKind, ReaderRunPaint,
        ReaderSize, ReaderSpacing, ReaderTextShadow, ReaderTransform,
    },
    DisplayCommand, DisplayTextCommand,
};
use super::color::parse_color;
use crate::render::RunPaint;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FixtureError {
    InvalidField(&'static str),
    UnsupportedValue(&'static str),
    InvalidColor(&'static str),
    NonFiniteNumber,
}

pub(crate) fn parse_display_command(value: &Value) -> Result<DisplayCommand, FixtureError> {
    let object = value
        .as_object()
        .ok_or(FixtureError::InvalidField("command"))?;
    let kind = field_string(object, "kind", "command.kind")?;
    Ok(match kind {
        "pushState" => DisplayCommand::PushState,
        "popState" => DisplayCommand::PopState,
        "translate" => DisplayCommand::Translate {
            dx: field_number(object, "dx", "translate.dx")?,
            dy: field_number(object, "dy", "translate.dy")?,
        },
        "opacity" => DisplayCommand::Opacity {
            value: field_number(object, "value", "opacity.value")?,
        },
        "transform" => DisplayCommand::Transform {
            origin: parse_point(
                field(object, "origin", "transform.origin")?,
                "transform.origin",
            )?,
            box_size: parse_size(field(object, "box", "transform.box")?, "transform.box")?,
            transforms: parse_transforms(field(object, "transforms", "transform.transforms")?)?,
        },
        "clipRect" => DisplayCommand::ClipRect {
            rect: parse_rect(field(object, "rect", "clipRect.rect")?, "clipRect.rect")?,
            radius: object
                .get("radius")
                .map(|value| parse_corner_radius(value, "clipRect.radius"))
                .transpose()?,
        },
        "paintPage" => DisplayCommand::PaintPage {
            rect: parse_rect(field(object, "rect", "paintPage.rect")?, "paintPage.rect")?,
            paint: parse_page_paint(field(object, "paint", "paintPage.paint")?)?,
        },
        "paintBlock" => DisplayCommand::PaintBlock {
            rect: parse_rect(field(object, "rect", "paintBlock.rect")?, "paintBlock.rect")?,
            paint: parse_block_paint(field(object, "paint", "paintBlock.paint")?)?,
            border_box: object.get("borderBox").map(parse_border_box).transpose()?,
        },
        "paintText" => DisplayCommand::PaintText(parse_text(object)?),
        "paintRuby" => DisplayCommand::PaintRuby(parse_text(object)?),
        "paintImage" => DisplayCommand::PaintImage {
            src: field_string(object, "src", "paintImage.src")?.to_owned(),
            rect: parse_rect(field(object, "rect", "paintImage.rect")?, "paintImage.rect")?,
            alt: optional_string(object, "alt", "paintImage.alt")?.map(str::to_owned),
            href: optional_string(object, "href", "paintImage.href")?.map(str::to_owned),
            source_rect: object
                .get("sourceRect")
                .map(|value| parse_rect(value, "paintImage.sourceRect"))
                .transpose()?,
        },
        "paintHorizontalRule" => DisplayCommand::PaintHorizontalRule {
            rect: parse_rect(
                field(object, "rect", "paintHorizontalRule.rect")?,
                "paintHorizontalRule.rect",
            )?,
            paint: parse_horizontal_rule_paint(field(
                object,
                "paint",
                "paintHorizontalRule.paint",
            )?)?,
        },
        _ => return Err(FixtureError::UnsupportedValue("command.kind")),
    })
}

fn parse_text(object: &Map<String, Value>) -> Result<DisplayTextCommand, FixtureError> {
    Ok(DisplayTextCommand {
        text: field_string(object, "text", "text.text")?.to_owned(),
        rect: parse_rect(field(object, "rect", "text.rect")?, "text.rect")?,
        paint: parse_run_paint(field(object, "paint", "text.paint")?)?,
        line_height_px: optional_number(object, "lineHeightPx", "text.lineHeightPx")?,
        href: optional_string(object, "href", "text.href")?.map(str::to_owned),
        source_text: optional_string(object, "sourceText", "text.sourceText")?.map(str::to_owned),
        source_text_offset: object
            .get("sourceTextOffset")
            .map(|value| {
                value
                    .as_u64()
                    .ok_or(FixtureError::InvalidField("text.sourceTextOffset"))
            })
            .transpose()?,
        clusters: match object.get("clusters") {
            None => Vec::new(),
            Some(clusters) => clusters
                .as_array()
                .ok_or(FixtureError::InvalidField("text.clusters"))?
                .iter()
                .map(|cluster| {
                    let entries = cluster
                        .as_array()
                        .filter(|entries| entries.len() == 3)
                        .ok_or(FixtureError::InvalidField("text.clusters"))?;
                    let byte = entries[0]
                        .as_u64()
                        .and_then(|byte| u32::try_from(byte).ok())
                        .ok_or(FixtureError::InvalidField("text.clusters.byte"))?;
                    Ok((
                        byte,
                        finite_number(&entries[1], "text.clusters.x")?,
                        finite_number(&entries[2], "text.clusters.y")?,
                    ))
                })
                .collect::<Result<Vec<_>, _>>()?,
        },
    })
}

/// A run's paint from the fixture's `paint` object; every field but the
/// font family and colour is optional and defaults like the wire.
fn parse_run_paint(value: &Value) -> Result<RunPaint, FixtureError> {
    let object = value
        .as_object()
        .ok_or(FixtureError::InvalidField("text.paint"))?;
    let defaults = ReaderRunPaint::default();
    let font = object.get("font").and_then(Value::as_object);
    let font_string = |key: &str| font.and_then(|font| font.get(key)).and_then(Value::as_str);
    let font_number = |key: &str| font.and_then(|font| font.get(key)).and_then(Value::as_f64);
    let color = |key: &str, context: &'static str| -> Result<Option<_>, FixtureError> {
        optional_string(object, key, context)?
            .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("none"))
            .map(|value| parse_color(value, context))
            .transpose()
    };
    Ok(RunPaint::new(ReaderRunPaint {
        font: ReaderFontPaint {
            family: font_string("family")
                .map(str::to_owned)
                .unwrap_or(defaults.font.family),
            size_px: font_number("sizePx").unwrap_or(defaults.font.size_px),
            weight: font_number("weight").unwrap_or(defaults.font.weight),
            style: match font_string("style") {
                Some(style) if style.eq_ignore_ascii_case("italic") => ReaderFontStyle::Italic,
                Some(style) if style.eq_ignore_ascii_case("oblique") => ReaderFontStyle::Italic,
                _ => ReaderFontStyle::Normal,
            },
        },
        color: color("color", "text.paint.color")?.unwrap_or(defaults.color),
        word_spacing_px: optional_number(object, "wordSpacingPx", "text.paint.wordSpacingPx")?,
        letter_spacing_px: optional_number(
            object,
            "letterSpacingPx",
            "text.paint.letterSpacingPx",
        )?,
        background_color: color("backgroundColor", "text.paint.backgroundColor")?,
        background_radius: optional_number(
            object,
            "backgroundRadius",
            "text.paint.backgroundRadius",
        )?,
        text_shadows: object
            .get("textShadow")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .map(|value| {
                        let shadow = exact_object(
                            value,
                            &["offsetX", "offsetY", "blur", "color"],
                            "text.paint.textShadow",
                        )?;
                        Ok(ReaderTextShadow {
                            offset_x: optional_number(shadow, "offsetX", "textShadow.offsetX")?
                                .unwrap_or(0.0),
                            offset_y: optional_number(shadow, "offsetY", "textShadow.offsetY")?
                                .unwrap_or(0.0),
                            blur: optional_number(shadow, "blur", "textShadow.blur")?
                                .unwrap_or(0.0),
                            color: optional_string(shadow, "color", "textShadow.color")?
                                .map(|value| parse_color(value, "textShadow.color"))
                                .transpose()?
                                .unwrap_or(defaults.color),
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?
            .unwrap_or_default(),
        decoration: object
            .get("decoration")
            .map(|value| {
                let decoration = exact_object(
                    value,
                    &["kind", "y", "thickness", "color"],
                    "text.paint.decoration",
                )?;
                Ok(ReaderRunDecoration {
                    kind: match field_string(decoration, "kind", "decoration.kind")? {
                        "underline" => ReaderRunDecorationKind::Underline,
                        "line-through" => ReaderRunDecorationKind::LineThrough,
                        _ => return Err(FixtureError::UnsupportedValue("decoration.kind")),
                    },
                    y: field_number(decoration, "y", "decoration.y")?,
                    thickness: field_number(decoration, "thickness", "decoration.thickness")?,
                    color: parse_color(
                        field_string(decoration, "color", "decoration.color")?,
                        "decoration.color",
                    )?,
                })
            })
            .transpose()?,
        padding: object
            .get("padding")
            .map(|value| {
                let padding = exact_object(
                    value,
                    &["top", "right", "bottom", "left"],
                    "text.paint.padding",
                )?;
                Ok(ReaderSpacing {
                    top: optional_number(padding, "top", "padding.top")?.unwrap_or(0.0),
                    right: optional_number(padding, "right", "padding.right")?.unwrap_or(0.0),
                    bottom: optional_number(padding, "bottom", "padding.bottom")?.unwrap_or(0.0),
                    left: optional_number(padding, "left", "padding.left")?.unwrap_or(0.0),
                })
            })
            .transpose()?,
        border: object
            .get("border")
            .map(|value| {
                let border = exact_object(
                    value,
                    &["top", "bottom", "start", "end"],
                    "text.paint.border",
                )?;
                let edge = |key: &str| -> Result<Option<ReaderRunBorderEdge>, FixtureError> {
                    border
                        .get(key)
                        .map(|value| {
                            let edge = exact_object(value, &["widthPx", "paint"], "border.edge")?;
                            let paint = exact_object(
                                field(edge, "paint", "border.edge.paint")?,
                                &["color", "style"],
                                "border.edge.paint",
                            )?;
                            Ok(ReaderRunBorderEdge {
                                width_px: field_number(edge, "widthPx", "border.edge.widthPx")?,
                                paint: ReaderBorderEdgePaint {
                                    color: parse_color(
                                        field_string(paint, "color", "border.edge.color")?,
                                        "border.edge.color",
                                    )?,
                                    style: parse_border_style(field_string(
                                        paint,
                                        "style",
                                        "border.edge.style",
                                    )?)?,
                                },
                            })
                        })
                        .transpose()
                };
                Ok(ReaderRunBorder {
                    top: edge("top")?,
                    bottom: edge("bottom")?,
                    start: edge("start")?,
                    end: edge("end")?,
                })
            })
            .transpose()?,
        box_offsets: object
            .get("box")
            .and_then(Value::as_object)
            .and_then(|offsets| {
                Some((
                    optional_number(offsets, "topPx", "box.topPx").ok()??,
                    optional_number(offsets, "bottomPx", "box.bottomPx").ok()??,
                ))
            }),
        box_start: optional_bool(object, "boxStart", "text.paint.boxStart")?.unwrap_or(true),
        box_end: optional_bool(object, "boxEnd", "text.paint.boxEnd")?.unwrap_or(true),
    }))
}

fn parse_page_paint(value: &Value) -> Result<ReaderPagePaint, FixtureError> {
    let object = exact_object(value, &["backgroundColor"], "paintPage.paint")?;
    let background_color =
        optional_string(object, "backgroundColor", "paintPage.paint.backgroundColor")?
            .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("none"))
            .map(|value| parse_color(value, "paintPage.paint.backgroundColor"))
            .transpose()?;
    Ok(ReaderPagePaint { background_color })
}

fn parse_block_paint(value: &Value) -> Result<ReaderBlockPaint, FixtureError> {
    let object = exact_object(
        value,
        &["background", "border", "radius", "boxShadow"],
        "paintBlock.paint",
    )?;
    Ok(ReaderBlockPaint {
        background: object.get("background").map(parse_background).transpose()?,
        border: object.get("border").map(parse_block_border).transpose()?,
        radius: object.get("radius").map(parse_block_radius).transpose()?,
        box_shadows: object
            .get("boxShadow")
            .map(parse_box_shadows)
            .transpose()?
            .unwrap_or_default(),
    })
}

fn parse_background(value: &Value) -> Result<ReaderBackgroundPaint, FixtureError> {
    let object = exact_object(
        value,
        &["color", "image", "size", "repeat", "position"],
        "paintBlock.background",
    )?;
    let color = optional_string(object, "color", "paintBlock.background.color")?
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("none"))
        .map(|value| parse_color(value, "paintBlock.background.color"))
        .transpose()?;
    Ok(ReaderBackgroundPaint {
        color,
        image: optional_string(object, "image", "paintBlock.background.image")?.map(str::to_owned),
        size: object.get("size").map(parse_background_size).transpose()?,
        repeat: optional_string(object, "repeat", "paintBlock.background.repeat")?
            .map(parse_background_repeat)
            .transpose()?,
        position: object
            .get("position")
            .map(parse_background_position)
            .transpose()?,
    })
}

fn parse_background_size(value: &Value) -> Result<ReaderBackgroundSize, FixtureError> {
    // Keyword sizes travel as strings; explicit sizes (`auto 40%`,
    // `100% 100%`) travel as `{x, y}` where each axis is `"auto"` or a
    // `{unit, value}` length.
    if let Some(keyword) = value.as_str() {
        return match keyword {
            "auto" => Ok(ReaderBackgroundSize::Auto),
            "cover" => Ok(ReaderBackgroundSize::Cover),
            "contain" => Ok(ReaderBackgroundSize::Contain),
            _ => Err(FixtureError::UnsupportedValue("paintBlock.background.size")),
        };
    }
    let object = exact_object(value, &["x", "y"], "paintBlock.background.size")?;
    let axis = |key| -> Result<_, FixtureError> {
        let value = field(object, key, "paintBlock.background.size")?;
        if value.as_str() == Some("auto") {
            return Ok(None);
        }
        parse_length(value).map(Some)
    };
    Ok(ReaderBackgroundSize::Explicit {
        x: axis("x")?,
        y: axis("y")?,
    })
}

fn parse_background_repeat(value: &str) -> Result<ReaderBackgroundRepeat, FixtureError> {
    match value {
        "repeat" => Ok(ReaderBackgroundRepeat::Repeat),
        "no-repeat" => Ok(ReaderBackgroundRepeat::NoRepeat),
        "repeat-x" => Ok(ReaderBackgroundRepeat::RepeatX),
        "repeat-y" => Ok(ReaderBackgroundRepeat::RepeatY),
        "space" => Ok(ReaderBackgroundRepeat::Space),
        "round" => Ok(ReaderBackgroundRepeat::Round),
        _ => Err(FixtureError::UnsupportedValue(
            "paintBlock.background.repeat",
        )),
    }
}

fn parse_background_position(value: &Value) -> Result<ReaderBackgroundPosition, FixtureError> {
    let object = exact_object(value, &["x", "y"], "paintBlock.background.position")?;
    Ok(ReaderBackgroundPosition {
        x: parse_length(field(object, "x", "paintBlock.background.position")?)?,
        y: parse_length(field(object, "y", "paintBlock.background.position")?)?,
    })
}

fn parse_block_border(value: &Value) -> Result<ReaderBlockBorder, FixtureError> {
    let object = exact_object(
        value,
        &["top", "right", "bottom", "left"],
        "paintBlock.border",
    )?;
    let edge = |key: &str| object.get(key).map(parse_border_edge).transpose();
    Ok(ReaderBlockBorder {
        top: edge("top")?,
        right: edge("right")?,
        bottom: edge("bottom")?,
        left: edge("left")?,
    })
}

fn parse_border_edge(value: &Value) -> Result<ReaderBorderEdgePaint, FixtureError> {
    // Fixtures may spell an edge's width beside its paint; the width
    // travels in borderBox, so the field is simply accepted.
    let object = exact_object(
        value,
        &["color", "style", "width"],
        "paintBlock.border.edge",
    )?;
    Ok(ReaderBorderEdgePaint {
        color: parse_color(
            field_string(object, "color", "paintBlock.border.edge.color")?,
            "paintBlock.border.edge.color",
        )?,
        style: parse_border_style(field_string(
            object,
            "style",
            "paintBlock.border.edge.style",
        )?)?,
    })
}

fn parse_block_radius(value: &Value) -> Result<ReaderBlockRadius, FixtureError> {
    let object = value
        .as_object()
        .ok_or(FixtureError::InvalidField("paintBlock.radius"))?;
    ensure_fields(object, &["px", "pct", "corners"], "paintBlock.radius")?;
    match (object.get("px"), object.get("pct"), object.get("corners")) {
        (Some(value), None, None) => Ok(ReaderBlockRadius::Px(finite_number(
            value,
            "paintBlock.radius.px",
        )?)),
        (None, Some(value), None) => Ok(ReaderBlockRadius::Percent(finite_number(
            value,
            "paintBlock.radius.pct",
        )?)),
        (None, None, Some(value)) => {
            let entries = value
                .as_array()
                .filter(|entries| entries.len() == 4)
                .ok_or(FixtureError::InvalidField("paintBlock.radius.corners"))?;
            let mut corners = [0.0_f64; 4];
            for (slot, entry) in corners.iter_mut().zip(entries) {
                *slot = finite_number(entry, "paintBlock.radius.corners")?;
            }
            Ok(ReaderBlockRadius::Corners(corners))
        }
        _ => Err(FixtureError::InvalidField("paintBlock.radius")),
    }
}

fn parse_box_shadows(value: &Value) -> Result<Vec<ReaderBoxShadow>, FixtureError> {
    value
        .as_array()
        .ok_or(FixtureError::InvalidField("paintBlock.boxShadow"))?
        .iter()
        .map(|value| {
            let object = exact_object(
                value,
                &["offsetX", "offsetY", "blur", "spread", "color", "inset"],
                "paintBlock.boxShadow.item",
            )?;
            Ok(ReaderBoxShadow {
                offset_x: field_number(object, "offsetX", "paintBlock.boxShadow.offsetX")?,
                offset_y: field_number(object, "offsetY", "paintBlock.boxShadow.offsetY")?,
                blur: optional_number(object, "blur", "paintBlock.boxShadow.blur")?.unwrap_or(0.0),
                spread: optional_number(object, "spread", "paintBlock.boxShadow.spread")?
                    .unwrap_or(0.0),
                color: optional_string(object, "color", "paintBlock.boxShadow.color")?
                    .map(|value| parse_color(value, "paintBlock.boxShadow.color"))
                    .transpose()?
                    .unwrap_or(ReaderRunPaint::default().color),
                inset: optional_bool(object, "inset", "paintBlock.boxShadow.inset")?
                    .unwrap_or(false),
            })
        })
        .collect()
}

fn parse_border_box(value: &Value) -> Result<ReaderBorderBox, FixtureError> {
    let object = exact_object(
        value,
        &["topWidth", "rightWidth", "bottomWidth", "leftWidth"],
        "paintBlock.borderBox",
    )?;
    let width = |key: &str, context: &'static str| -> Result<f64, FixtureError> {
        Ok(optional_number(object, key, context)?.unwrap_or(0.0))
    };
    Ok(ReaderBorderBox {
        top_width: width("topWidth", "paintBlock.borderBox.topWidth")?,
        right_width: width("rightWidth", "paintBlock.borderBox.rightWidth")?,
        bottom_width: width("bottomWidth", "paintBlock.borderBox.bottomWidth")?,
        left_width: width("leftWidth", "paintBlock.borderBox.leftWidth")?,
    })
}

fn parse_horizontal_rule_paint(value: &Value) -> Result<ReaderHorizontalRulePaint, FixtureError> {
    let object = exact_object(
        value,
        &["color", "style", "width"],
        "paintHorizontalRule.paint",
    )?;
    Ok(ReaderHorizontalRulePaint {
        color: parse_color(
            field_string(object, "color", "paintHorizontalRule.paint.color")?,
            "paintHorizontalRule.paint.color",
        )?,
        style: parse_border_style(field_string(
            object,
            "style",
            "paintHorizontalRule.paint.style",
        )?)?,
    })
}

fn parse_border_style(value: &str) -> Result<ReaderBorderStyle, FixtureError> {
    match value {
        "none" => Ok(ReaderBorderStyle::None),
        "hidden" => Ok(ReaderBorderStyle::Hidden),
        "dotted" => Ok(ReaderBorderStyle::Dotted),
        "dashed" => Ok(ReaderBorderStyle::Dashed),
        "solid" => Ok(ReaderBorderStyle::Solid),
        "double" => Ok(ReaderBorderStyle::Double),
        "groove" => Ok(ReaderBorderStyle::Groove),
        "ridge" => Ok(ReaderBorderStyle::Ridge),
        "inset" => Ok(ReaderBorderStyle::Inset),
        "outset" => Ok(ReaderBorderStyle::Outset),
        _ => Err(FixtureError::UnsupportedValue("border.style")),
    }
}

fn parse_rect(value: &Value, context: &'static str) -> Result<ReaderRect, FixtureError> {
    let object = exact_object(value, &["x", "y", "width", "height"], context)?;
    Ok(ReaderRect {
        x: field_number(object, "x", context)?,
        y: field_number(object, "y", context)?,
        width: field_number(object, "width", context)?,
        height: field_number(object, "height", context)?,
    })
}

fn parse_point(value: &Value, context: &'static str) -> Result<ReaderPoint, FixtureError> {
    let object = exact_object(value, &["x", "y"], context)?;
    Ok(ReaderPoint {
        x: field_number(object, "x", context)?,
        y: field_number(object, "y", context)?,
    })
}

fn parse_size(value: &Value, context: &'static str) -> Result<ReaderSize, FixtureError> {
    let object = exact_object(value, &["width", "height"], context)?;
    Ok(ReaderSize {
        width: field_number(object, "width", context)?,
        height: field_number(object, "height", context)?,
    })
}

fn parse_corner_radius(
    value: &Value,
    context: &'static str,
) -> Result<ReaderCornerRadius, FixtureError> {
    let object = exact_object(value, &["rx", "ry"], context)?;
    Ok(ReaderCornerRadius {
        rx: field_number(object, "rx", context)?,
        ry: field_number(object, "ry", context)?,
    })
}

fn parse_transforms(value: &Value) -> Result<Vec<ReaderTransform>, FixtureError> {
    value
        .as_array()
        .ok_or(FixtureError::InvalidField("transform.transforms"))?
        .iter()
        .map(|value| {
            let object = value
                .as_object()
                .ok_or(FixtureError::InvalidField("transform.operation"))?;
            match field_string(object, "kind", "transform.operation")? {
                "rotate" => {
                    ensure_fields(object, &["kind", "rad"], "transform.rotate")?;
                    Ok(ReaderTransform::Rotate {
                        radians: field_number(object, "rad", "transform.rotate")?,
                    })
                }
                "scale" => {
                    ensure_fields(object, &["kind", "sx", "sy"], "transform.scale")?;
                    Ok(ReaderTransform::Scale {
                        sx: field_number(object, "sx", "transform.scale")?,
                        sy: field_number(object, "sy", "transform.scale")?,
                    })
                }
                "translate" => {
                    ensure_fields(object, &["kind", "x", "y"], "transform.translate")?;
                    Ok(ReaderTransform::Translate {
                        x: parse_length(field(object, "x", "transform.translate")?)?,
                        y: parse_length(field(object, "y", "transform.translate")?)?,
                    })
                }
                _ => Err(FixtureError::UnsupportedValue("transform.kind")),
            }
        })
        .collect()
}

fn parse_length(value: &Value) -> Result<ReaderLength, FixtureError> {
    let object = exact_object(value, &["unit", "value"], "length")?;
    let value = field_number(object, "value", "length")?;
    match field_string(object, "unit", "length")? {
        "px" => Ok(ReaderLength::Px(value)),
        "percent" => Ok(ReaderLength::Percent(value)),
        _ => Err(FixtureError::UnsupportedValue("length.unit")),
    }
}

fn exact_object<'a>(
    value: &'a Value,
    fields: &[&str],
    context: &'static str,
) -> Result<&'a Map<String, Value>, FixtureError> {
    let object = value
        .as_object()
        .ok_or(FixtureError::InvalidField(context))?;
    ensure_fields(object, fields, context)?;
    Ok(object)
}

fn ensure_fields(
    object: &Map<String, Value>,
    allowed: &[&str],
    context: &'static str,
) -> Result<(), FixtureError> {
    if object.keys().all(|key| allowed.contains(&key.as_str())) {
        Ok(())
    } else {
        Err(FixtureError::UnsupportedValue(context))
    }
}

fn field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<&'a Value, FixtureError> {
    object.get(key).ok_or(FixtureError::InvalidField(context))
}

fn field_number(
    object: &Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<f64, FixtureError> {
    finite_number(field(object, key, context)?, context)
}

fn optional_number(
    object: &Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<Option<f64>, FixtureError> {
    object
        .get(key)
        .map(|value| finite_number(value, context))
        .transpose()
}

fn finite_number(value: &Value, context: &'static str) -> Result<f64, FixtureError> {
    let value = value.as_f64().ok_or(FixtureError::InvalidField(context))?;
    value
        .is_finite()
        .then_some(value)
        .ok_or(FixtureError::NonFiniteNumber)
}

fn field_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<&'a str, FixtureError> {
    field(object, key, context)?
        .as_str()
        .ok_or(FixtureError::InvalidField(context))
}

fn optional_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<Option<&'a str>, FixtureError> {
    object
        .get(key)
        .map(|value| value.as_str().ok_or(FixtureError::InvalidField(context)))
        .transpose()
}

fn optional_bool(
    object: &Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<Option<bool>, FixtureError> {
    object
        .get(key)
        .map(|value| value.as_bool().ok_or(FixtureError::InvalidField(context)))
        .transpose()
}
