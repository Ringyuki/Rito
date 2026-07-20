use super::super::{contract::ReaderRectV1, ReaderDisplayListWireError};

pub(in crate::render::commands::reader_wire_v1) fn checked_length<T>(
    length: T,
    context: &'static str,
) -> Result<u32, ReaderDisplayListWireError>
where
    T: TryInto<u32>,
{
    length
        .try_into()
        .map_err(|_| ReaderDisplayListWireError::LengthOverflow(context))
}

pub(super) fn write_length<T>(
    output: &mut Vec<u8>,
    length: T,
    context: &'static str,
) -> Result<(), ReaderDisplayListWireError>
where
    T: TryInto<u32>,
{
    write_u32(output, checked_length(length, context)?);
    Ok(())
}

pub(super) fn write_string(
    output: &mut Vec<u8>,
    value: &str,
) -> Result<(), ReaderDisplayListWireError> {
    write_length(output, value.len(), "string")?;
    output.extend_from_slice(value.as_bytes());
    Ok(())
}

pub(super) fn write_optional_string(
    output: &mut Vec<u8>,
    value: Option<&str>,
) -> Result<(), ReaderDisplayListWireError> {
    write_optional(output, value, write_string)
}

pub(super) fn write_optional<T, F>(
    output: &mut Vec<u8>,
    value: Option<&T>,
    write: F,
) -> Result<(), ReaderDisplayListWireError>
where
    T: ?Sized,
    F: FnOnce(&mut Vec<u8>, &T) -> Result<(), ReaderDisplayListWireError>,
{
    output.push(u8::from(value.is_some()));
    match value {
        Some(value) => write(output, value),
        None => Ok(()),
    }
}

pub(super) fn write_rect(
    output: &mut Vec<u8>,
    rect: &ReaderRectV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_finite_f64(output, rect.x)?;
    write_finite_f64(output, rect.y)?;
    write_finite_f64(output, rect.width)?;
    write_finite_f64(output, rect.height)
}

pub(super) fn write_finite_f32(
    output: &mut Vec<u8>,
    value: f32,
) -> Result<(), ReaderDisplayListWireError> {
    if !value.is_finite() {
        return Err(ReaderDisplayListWireError::NonFiniteNumber);
    }
    output.extend_from_slice(&value.to_le_bytes());
    Ok(())
}

pub(super) fn write_finite_f64(
    output: &mut Vec<u8>,
    value: f64,
) -> Result<(), ReaderDisplayListWireError> {
    if !value.is_finite() {
        return Err(ReaderDisplayListWireError::NonFiniteNumber);
    }
    output.extend_from_slice(&value.to_le_bytes());
    Ok(())
}

pub(super) fn write_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

pub(super) fn write_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

pub(super) fn write_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_le_bytes());
}
