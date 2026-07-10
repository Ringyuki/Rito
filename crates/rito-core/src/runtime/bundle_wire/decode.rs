use serde_json::{Map, Number, Value};

use crate::epub::EpubResult;

use super::{
    checked_end, read_u32, read_u32_bounded, read_u64, read_u64_bounded, runtime_bundle_checksum,
    usize_from_u32, validate_safe_i64, validate_safe_u64, wire_error, DecodedRuntimeBundle,
    RUNTIME_BUNDLE_HEADER_BYTES, RUNTIME_BUNDLE_MAGIC, RUNTIME_BUNDLE_VERSION, TAG_ARRAY, TAG_F64,
    TAG_FALSE, TAG_I64, TAG_NULL, TAG_OBJECT, TAG_STRING, TAG_TRUE, TAG_U64,
};

pub fn decode_runtime_bundle(bytes: &[u8]) -> EpubResult<DecodedRuntimeBundle> {
    let header = RuntimeBundleHeader::read(bytes)?;
    let actual_checksum = runtime_bundle_checksum(&bytes[RUNTIME_BUNDLE_HEADER_BYTES..]);
    if actual_checksum != header.checksum {
        return Err(wire_error("RITORB1 checksum mismatch"));
    }
    let strings = decode_string_table(
        bytes,
        header.string_offset,
        header.string_length,
        header.string_count,
    )?;
    let values = decode_value_table(
        bytes,
        header.value_offset,
        header.value_length,
        header.value_count,
        &strings,
    )?;
    let payload = values
        .get(usize_from_u32(header.root_index))
        .ok_or_else(|| wire_error("RITORB1 root value index is out of bounds"))?
        .clone();
    Ok(DecodedRuntimeBundle {
        protocol_version: header.version,
        string_count: strings.len(),
        value_count: values.len(),
        byte_length: bytes.len(),
        checksum: header.checksum,
        payload,
    })
}

fn decode_string_table(
    bytes: &[u8],
    offset: usize,
    length: usize,
    count: u32,
) -> EpubResult<Vec<String>> {
    let end = checked_end(offset, length, bytes.len(), "RITORB1 string table")?;
    let mut cursor = offset;
    let capacity = validate_count_fits_remaining(count, cursor, end, 4, "RITORB1 string count")?;
    let mut strings = Vec::with_capacity(capacity);
    for _ in 0..count {
        let byte_length = read_u32_cursor(bytes, &mut cursor, end, "RITORB1 string length")?;
        let string_end = checked_end(cursor, usize_from_u32(byte_length), end, "RITORB1 string")?;
        let value = std::str::from_utf8(&bytes[cursor..string_end])
            .map_err(|error| wire_error(format!("RITORB1 string is not UTF-8: {error}")))?
            .to_owned();
        cursor = string_end;
        strings.push(value);
    }
    if cursor != end {
        return Err(wire_error("RITORB1 string table has trailing bytes"));
    }
    Ok(strings)
}

fn decode_value_table(
    bytes: &[u8],
    offset: usize,
    length: usize,
    count: u32,
    strings: &[String],
) -> EpubResult<Vec<Value>> {
    let end = checked_end(offset, length, bytes.len(), "RITORB1 value table")?;
    let mut cursor = offset;
    let capacity = validate_count_fits_remaining(count, cursor, end, 1, "RITORB1 value count")?;
    let mut values = Vec::with_capacity(capacity);
    for _ in 0..count {
        let tag = read_u8_cursor(bytes, &mut cursor, end, "RITORB1 value tag")?;
        let value = match tag {
            TAG_NULL => Value::Null,
            TAG_FALSE => Value::Bool(false),
            TAG_TRUE => Value::Bool(true),
            TAG_I64 => Value::Number(Number::from(validate_safe_i64(read_i64_cursor(
                bytes,
                &mut cursor,
                end,
                "RITORB1 i64",
            )?)?)),
            TAG_U64 => Value::Number(Number::from(validate_safe_u64(read_u64_cursor(
                bytes,
                &mut cursor,
                end,
                "RITORB1 u64",
            )?)?)),
            TAG_F64 => number_from_f64(read_f64_cursor(bytes, &mut cursor, end, "RITORB1 f64")?)?,
            TAG_STRING => {
                let index = read_u32_cursor(bytes, &mut cursor, end, "RITORB1 string index")?;
                Value::String(read_string(strings, index)?.to_owned())
            }
            TAG_ARRAY => read_array_value(bytes, &mut cursor, end, &values)?,
            TAG_OBJECT => read_object_value(bytes, &mut cursor, end, &values, strings)?,
            _ => return Err(wire_error(format!("unsupported RITORB1 value tag: {tag}"))),
        };
        values.push(value);
    }
    if cursor != end {
        return Err(wire_error("RITORB1 value table has trailing bytes"));
    }
    Ok(values)
}

fn read_array_value(
    bytes: &[u8],
    cursor: &mut usize,
    end: usize,
    values: &[Value],
) -> EpubResult<Value> {
    let count = read_u32_cursor(bytes, cursor, end, "RITORB1 array length")?;
    let capacity = validate_count_fits_remaining(count, *cursor, end, 4, "RITORB1 array length")?;
    let mut items = Vec::with_capacity(capacity);
    for _ in 0..count {
        let index = read_u32_cursor(bytes, cursor, end, "RITORB1 array index")?;
        items.push(read_value(values, index)?.clone());
    }
    Ok(Value::Array(items))
}

fn read_object_value(
    bytes: &[u8],
    cursor: &mut usize,
    end: usize,
    values: &[Value],
    strings: &[String],
) -> EpubResult<Value> {
    let count = read_u32_cursor(bytes, cursor, end, "RITORB1 object length")?;
    validate_count_fits_remaining(count, *cursor, end, 8, "RITORB1 object length")?;
    let mut object = Map::new();
    for _ in 0..count {
        let key_index = read_u32_cursor(bytes, cursor, end, "RITORB1 object key index")?;
        let value_index = read_u32_cursor(bytes, cursor, end, "RITORB1 object value index")?;
        object.insert(
            read_string(strings, key_index)?.to_owned(),
            read_value(values, value_index)?.clone(),
        );
    }
    Ok(Value::Object(object))
}

#[derive(Debug)]
struct RuntimeBundleHeader {
    version: u32,
    string_count: u32,
    value_count: u32,
    string_offset: usize,
    string_length: usize,
    value_offset: usize,
    value_length: usize,
    root_index: u32,
    checksum: u64,
}

impl RuntimeBundleHeader {
    fn read(bytes: &[u8]) -> EpubResult<Self> {
        if bytes.len() < RUNTIME_BUNDLE_HEADER_BYTES {
            return Err(wire_error("RITORB1 payload is shorter than its header"));
        }
        if &bytes[0..8] != RUNTIME_BUNDLE_MAGIC {
            return Err(wire_error("invalid RITORB1 magic"));
        }
        let version = read_u32(bytes, 8, "RITORB1 version")?;
        if version != RUNTIME_BUNDLE_VERSION {
            return Err(wire_error(format!(
                "unsupported RITORB1 version: {version}"
            )));
        }
        let header_bytes = read_u32(bytes, 12, "RITORB1 header length")?;
        if usize_from_u32(header_bytes) != RUNTIME_BUNDLE_HEADER_BYTES {
            return Err(wire_error("RITORB1 header length mismatch"));
        }
        let byte_length = usize_from_u32(read_u32(bytes, 16, "RITORB1 byte length")?);
        if byte_length != bytes.len() {
            return Err(wire_error("RITORB1 byte length mismatch"));
        }
        let header = Self {
            version,
            string_count: read_u32(bytes, 20, "RITORB1 string count")?,
            value_count: read_u32(bytes, 24, "RITORB1 value count")?,
            string_offset: usize_from_u32(read_u32(bytes, 28, "RITORB1 string offset")?),
            string_length: usize_from_u32(read_u32(bytes, 32, "RITORB1 string length")?),
            value_offset: usize_from_u32(read_u32(bytes, 36, "RITORB1 value offset")?),
            value_length: usize_from_u32(read_u32(bytes, 40, "RITORB1 value length")?),
            root_index: read_u32(bytes, 44, "RITORB1 root index")?,
            checksum: read_u64(bytes, 48, "RITORB1 checksum")?,
        };
        header.validate_ranges(bytes.len())?;
        Ok(header)
    }

    fn validate_ranges(&self, byte_length: usize) -> EpubResult<()> {
        if self.string_offset != RUNTIME_BUNDLE_HEADER_BYTES {
            return Err(wire_error(
                "RITORB1 string table offset is not after the header",
            ));
        }
        let string_end = checked_end(
            self.string_offset,
            self.string_length,
            byte_length,
            "RITORB1 string table",
        )?;
        if self.value_offset != string_end {
            return Err(wire_error("RITORB1 table ranges are not sorted"));
        }
        let value_end = checked_end(
            self.value_offset,
            self.value_length,
            byte_length,
            "RITORB1 value table",
        )?;
        if value_end != byte_length {
            return Err(wire_error(
                "RITORB1 value table does not end at payload boundary",
            ));
        }
        Ok(())
    }
}

fn number_from_f64(value: f64) -> EpubResult<Value> {
    Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| wire_error("RITORB1 f64 is not finite"))
}

fn validate_count_fits_remaining(
    count: u32,
    cursor: usize,
    end: usize,
    minimum_bytes_per_item: usize,
    label: &str,
) -> EpubResult<usize> {
    let remaining = end
        .checked_sub(cursor)
        .ok_or_else(|| wire_error(format!("{label} starts after its section boundary")))?;
    let count = usize_from_u32(count);
    if count > remaining / minimum_bytes_per_item {
        return Err(wire_error(format!(
            "{label} exceeds the remaining section bytes"
        )));
    }
    Ok(count)
}

fn read_string(strings: &[String], index: u32) -> EpubResult<&str> {
    strings
        .get(usize_from_u32(index))
        .map(String::as_str)
        .ok_or_else(|| wire_error("RITORB1 string index is out of bounds"))
}

fn read_value(values: &[Value], index: u32) -> EpubResult<&Value> {
    values
        .get(usize_from_u32(index))
        .ok_or_else(|| wire_error("RITORB1 value index is out of bounds"))
}

fn read_u8_cursor(bytes: &[u8], cursor: &mut usize, end: usize, label: &str) -> EpubResult<u8> {
    let next = checked_end(*cursor, 1, end, label)?;
    let value = bytes[*cursor];
    *cursor = next;
    Ok(value)
}

fn read_u32_cursor(bytes: &[u8], cursor: &mut usize, end: usize, label: &str) -> EpubResult<u32> {
    let value = read_u32_bounded(bytes, *cursor, end, label)?;
    *cursor += 4;
    Ok(value)
}

fn read_i64_cursor(bytes: &[u8], cursor: &mut usize, end: usize, label: &str) -> EpubResult<i64> {
    let next = checked_end(*cursor, 8, end, label)?;
    let value = i64::from_le_bytes(bytes[*cursor..next].try_into().expect("slice length"));
    *cursor = next;
    Ok(value)
}

fn read_u64_cursor(bytes: &[u8], cursor: &mut usize, end: usize, label: &str) -> EpubResult<u64> {
    let value = read_u64_bounded(bytes, *cursor, end, label)?;
    *cursor += 8;
    Ok(value)
}

fn read_f64_cursor(bytes: &[u8], cursor: &mut usize, end: usize, label: &str) -> EpubResult<f64> {
    let next = checked_end(*cursor, 8, end, label)?;
    let value = f64::from_le_bytes(bytes[*cursor..next].try_into().expect("slice length"));
    *cursor = next;
    Ok(value)
}
