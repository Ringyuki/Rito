use serde_json::{Map, Value};

use super::super::{
    contract::{
        ReaderCornerRadiusV1, ReaderLengthV1, ReaderPointV1, ReaderRectV1, ReaderSizeV1,
        ReaderTransformV1,
    },
    ReaderDisplayListWireError,
};

pub(super) fn adapt_rect(
    value: &Value,
    context: &'static str,
) -> Result<ReaderRectV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["x", "y", "width", "height"], context)?;
    Ok(ReaderRectV1 {
        x: field_number(object, "x", context)?,
        y: field_number(object, "y", context)?,
        width: field_number(object, "width", context)?,
        height: field_number(object, "height", context)?,
    })
}

pub(super) fn adapt_point(
    value: &Value,
    context: &'static str,
) -> Result<ReaderPointV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["x", "y"], context)?;
    Ok(ReaderPointV1 {
        x: field_number(object, "x", context)?,
        y: field_number(object, "y", context)?,
    })
}

pub(super) fn adapt_size(
    value: &Value,
    context: &'static str,
) -> Result<ReaderSizeV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["width", "height"], context)?;
    Ok(ReaderSizeV1 {
        width: field_number(object, "width", context)?,
        height: field_number(object, "height", context)?,
    })
}

pub(super) fn adapt_corner_radius(
    value: &Value,
    context: &'static str,
) -> Result<ReaderCornerRadiusV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["rx", "ry"], context)?;
    Ok(ReaderCornerRadiusV1 {
        rx: field_number(object, "rx", context)?,
        ry: field_number(object, "ry", context)?,
    })
}

pub(super) fn adapt_transforms(
    value: &Value,
) -> Result<Vec<ReaderTransformV1>, ReaderDisplayListWireError> {
    value
        .as_array()
        .ok_or(ReaderDisplayListWireError::InvalidLegacyField(
            "transform.transforms",
        ))?
        .iter()
        .map(adapt_transform)
        .collect()
}

fn adapt_transform(value: &Value) -> Result<ReaderTransformV1, ReaderDisplayListWireError> {
    let object = value
        .as_object()
        .ok_or(ReaderDisplayListWireError::InvalidLegacyField(
            "transform.operation",
        ))?;
    match field_string(object, "kind", "transform.operation")? {
        "rotate" => {
            ensure_fields(object, &["kind", "rad"], "transform.rotate")?;
            Ok(ReaderTransformV1::Rotate {
                radians: field_number(object, "rad", "transform.rotate")?,
            })
        }
        "scale" => {
            ensure_fields(object, &["kind", "sx", "sy"], "transform.scale")?;
            Ok(ReaderTransformV1::Scale {
                sx: field_number(object, "sx", "transform.scale")?,
                sy: field_number(object, "sy", "transform.scale")?,
            })
        }
        "translate" => {
            ensure_fields(object, &["kind", "x", "y"], "transform.translate")?;
            Ok(ReaderTransformV1::Translate {
                x: adapt_length(field(object, "x", "transform.translate")?)?,
                y: adapt_length(field(object, "y", "transform.translate")?)?,
            })
        }
        _ => Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
            "transform.kind",
        )),
    }
}

pub(super) fn adapt_length(value: &Value) -> Result<ReaderLengthV1, ReaderDisplayListWireError> {
    let object = exact_object(value, &["unit", "value"], "length")?;
    let value = field_number(object, "value", "length")?;
    match field_string(object, "unit", "length")? {
        "px" => Ok(ReaderLengthV1::Px(value)),
        "percent" => Ok(ReaderLengthV1::Percent(value)),
        _ => Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
            "length.unit",
        )),
    }
}

pub(super) fn exact_object<'a>(
    value: &'a Value,
    fields: &[&str],
    context: &'static str,
) -> Result<&'a Map<String, Value>, ReaderDisplayListWireError> {
    let object = value
        .as_object()
        .ok_or(ReaderDisplayListWireError::InvalidLegacyField(context))?;
    ensure_fields(object, fields, context)?;
    Ok(object)
}

pub(super) fn ensure_fields(
    object: &Map<String, Value>,
    allowed: &[&str],
    context: &'static str,
) -> Result<(), ReaderDisplayListWireError> {
    if object.keys().all(|key| allowed.contains(&key.as_str())) {
        Ok(())
    } else {
        Err(ReaderDisplayListWireError::UnsupportedLegacyValue(context))
    }
}

pub(super) fn field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<&'a Value, ReaderDisplayListWireError> {
    object
        .get(key)
        .ok_or(ReaderDisplayListWireError::InvalidLegacyField(context))
}

pub(super) fn field_number(
    object: &Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<f64, ReaderDisplayListWireError> {
    finite_number(field(object, key, context)?, context)
}

pub(super) fn optional_number(
    object: &Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<Option<f64>, ReaderDisplayListWireError> {
    object
        .get(key)
        .map(|value| finite_number(value, context))
        .transpose()
}

pub(super) fn finite_number(
    value: &Value,
    context: &'static str,
) -> Result<f64, ReaderDisplayListWireError> {
    let value = value
        .as_f64()
        .ok_or(ReaderDisplayListWireError::InvalidLegacyField(context))?;
    value
        .is_finite()
        .then_some(value)
        .ok_or(ReaderDisplayListWireError::NonFiniteNumber)
}

pub(super) fn field_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<&'a str, ReaderDisplayListWireError> {
    string(field(object, key, context)?, context)
}

pub(super) fn optional_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<Option<&'a str>, ReaderDisplayListWireError> {
    object
        .get(key)
        .map(|value| string(value, context))
        .transpose()
}

pub(super) fn string<'a>(
    value: &'a Value,
    context: &'static str,
) -> Result<&'a str, ReaderDisplayListWireError> {
    value
        .as_str()
        .ok_or(ReaderDisplayListWireError::InvalidLegacyField(context))
}

pub(super) fn optional_bool(
    object: &Map<String, Value>,
    key: &str,
    context: &'static str,
) -> Result<Option<bool>, ReaderDisplayListWireError> {
    object
        .get(key)
        .map(|value| {
            value
                .as_bool()
                .ok_or(ReaderDisplayListWireError::InvalidLegacyField(context))
        })
        .transpose()
}
