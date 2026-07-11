use std::collections::HashMap;

use serde::Serialize;
use serde_json::{Map, Number, Value};

use crate::epub::{EpubError, EpubResult};

use super::{
    checked_u32, runtime_bundle_checksum, validate_safe_i64, validate_safe_u64, wire_error,
    write_u32, write_u32_at, write_u64_at, RUNTIME_BUNDLE_HEADER_BYTES, RUNTIME_BUNDLE_MAGIC,
    RUNTIME_BUNDLE_VERSION, TAG_ARRAY, TAG_F64, TAG_FALSE, TAG_I64, TAG_NULL, TAG_OBJECT,
    TAG_STRING, TAG_TRUE, TAG_U64,
};

pub fn encode_runtime_bundle(value: &impl Serialize) -> EpubResult<Vec<u8>> {
    let value = serde_json::to_value(value)
        .map_err(|error| EpubError::new(format!("runtime bundle serialization failed: {error}")))?;
    let mut encoder = RuntimeBundleEncoder::default();
    let root_index = encoder.encode_value(&value)?;
    let string_section_len = encoder.string_section_len()?;
    let value_section_len = encoder.values.len();
    let string_offset = RUNTIME_BUNDLE_HEADER_BYTES;
    let value_offset = string_offset
        .checked_add(string_section_len)
        .ok_or_else(|| wire_error("runtime bundle string table is too large"))?;
    let byte_length = value_offset
        .checked_add(value_section_len)
        .ok_or_else(|| wire_error("runtime bundle byte length is too large"))?;
    let byte_length_u32 = checked_u32(byte_length, "runtime bundle byte length")?;

    let mut bytes = Vec::with_capacity(byte_length);
    bytes.resize(RUNTIME_BUNDLE_HEADER_BYTES, 0);
    encoder.write_string_section(&mut bytes)?;
    bytes.extend_from_slice(&encoder.values);
    debug_assert_eq!(bytes.len(), byte_length);
    let checksum = runtime_bundle_checksum(&bytes[RUNTIME_BUNDLE_HEADER_BYTES..]);

    bytes[0..8].copy_from_slice(RUNTIME_BUNDLE_MAGIC);
    write_u32_at(&mut bytes, 8, RUNTIME_BUNDLE_VERSION);
    write_u32_at(
        &mut bytes,
        12,
        checked_u32(RUNTIME_BUNDLE_HEADER_BYTES, "runtime bundle header length")?,
    );
    write_u32_at(&mut bytes, 16, byte_length_u32);
    write_u32_at(
        &mut bytes,
        20,
        checked_u32(encoder.strings.len(), "runtime bundle string count")?,
    );
    write_u32_at(&mut bytes, 24, encoder.value_count);
    write_u32_at(
        &mut bytes,
        28,
        checked_u32(string_offset, "runtime bundle string table offset")?,
    );
    write_u32_at(
        &mut bytes,
        32,
        checked_u32(string_section_len, "runtime bundle string table length")?,
    );
    write_u32_at(
        &mut bytes,
        36,
        checked_u32(value_offset, "runtime bundle value table offset")?,
    );
    write_u32_at(
        &mut bytes,
        40,
        checked_u32(value_section_len, "runtime bundle value table length")?,
    );
    write_u32_at(&mut bytes, 44, root_index);
    write_u64_at(&mut bytes, 48, checksum);

    Ok(bytes)
}

#[derive(Default)]
struct RuntimeBundleEncoder {
    strings: Vec<String>,
    string_indexes: HashMap<String, u32>,
    scalar_indexes: HashMap<ScalarValueKey, u32>,
    container_indexes: Vec<u32>,
    values: Vec<u8>,
    value_count: u32,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum ScalarValueKey {
    Null,
    Bool(bool),
    I64(i64),
    U64(u64),
    F64(u64),
    String(u32),
}

impl RuntimeBundleEncoder {
    fn encode_value(&mut self, value: &Value) -> EpubResult<u32> {
        match value {
            Value::Null => self.intern_scalar(ScalarValueKey::Null, TAG_NULL, |_| Ok(())),
            Value::Bool(value) => self.intern_scalar(
                ScalarValueKey::Bool(*value),
                if *value { TAG_TRUE } else { TAG_FALSE },
                |_| Ok(()),
            ),
            Value::Number(number) => self.encode_number(number),
            Value::String(value) => {
                let string_index = self.intern_string(value)?;
                self.intern_scalar(ScalarValueKey::String(string_index), TAG_STRING, |bytes| {
                    write_u32(bytes, string_index);
                    Ok(())
                })
            }
            Value::Array(items) => self.encode_array(items),
            Value::Object(object) => self.encode_object(object),
        }
    }

    fn encode_number(&mut self, number: &Number) -> EpubResult<u32> {
        if let Some(value) = number.as_u64() {
            let value = validate_safe_u64(value)?;
            return self.intern_scalar(ScalarValueKey::U64(value), TAG_U64, |bytes| {
                bytes.extend_from_slice(&value.to_le_bytes());
                Ok(())
            });
        }
        if let Some(value) = number.as_i64() {
            let value = validate_safe_i64(value)?;
            return self.intern_scalar(ScalarValueKey::I64(value), TAG_I64, |bytes| {
                bytes.extend_from_slice(&value.to_le_bytes());
                Ok(())
            });
        }
        let value = number
            .as_f64()
            .ok_or_else(|| wire_error("RITORB1 cannot encode non-finite number"))?;
        self.intern_scalar(ScalarValueKey::F64(value.to_bits()), TAG_F64, |bytes| {
            bytes.extend_from_slice(&value.to_le_bytes());
            Ok(())
        })
    }

    fn encode_array(&mut self, items: &[Value]) -> EpubResult<u32> {
        let start = self.container_indexes.len();
        for item in items {
            let index = self.encode_value(item)?;
            self.container_indexes.push(index);
        }
        self.push_container_record(TAG_ARRAY, start, 1, "RITORB1 array length")
    }

    fn encode_object(&mut self, object: &Map<String, Value>) -> EpubResult<u32> {
        let start = self.container_indexes.len();
        for (key, value) in object {
            let key_index = self.intern_string(key)?;
            let value_index = self.encode_value(value)?;
            self.container_indexes.push(key_index);
            self.container_indexes.push(value_index);
        }
        self.push_container_record(TAG_OBJECT, start, 2, "RITORB1 object length")
    }

    fn push_container_record(
        &mut self,
        tag: u8,
        start: usize,
        indexes_per_entry: usize,
        length_label: &str,
    ) -> EpubResult<u32> {
        let index_count = self.container_indexes.len() - start;
        debug_assert_eq!(index_count % indexes_per_entry, 0);
        let entry_count = checked_u32(index_count / indexes_per_entry, length_label)?;
        let index = self.begin_record(tag)?;
        write_u32(&mut self.values, entry_count);
        for position in start..self.container_indexes.len() {
            write_u32(&mut self.values, self.container_indexes[position]);
        }
        self.container_indexes.truncate(start);
        Ok(index)
    }

    fn push_record(
        &mut self,
        tag: u8,
        write_payload: impl FnOnce(&mut Vec<u8>) -> EpubResult<()>,
    ) -> EpubResult<u32> {
        let index = self.begin_record(tag)?;
        write_payload(&mut self.values)?;
        Ok(index)
    }

    fn begin_record(&mut self, tag: u8) -> EpubResult<u32> {
        let index = self.value_count;
        self.value_count = self
            .value_count
            .checked_add(1)
            .ok_or_else(|| wire_error("RITORB1 value table is too large"))?;
        self.values.push(tag);
        Ok(index)
    }

    fn intern_scalar(
        &mut self,
        key: ScalarValueKey,
        tag: u8,
        write_payload: impl FnOnce(&mut Vec<u8>) -> EpubResult<()>,
    ) -> EpubResult<u32> {
        if let Some(index) = self.scalar_indexes.get(&key) {
            return Ok(*index);
        }
        let index = self.push_record(tag, write_payload)?;
        self.scalar_indexes.insert(key, index);
        Ok(index)
    }

    fn intern_string(&mut self, value: &str) -> EpubResult<u32> {
        if let Some(index) = self.string_indexes.get(value) {
            return Ok(*index);
        }
        let index = checked_u32(self.strings.len(), "RITORB1 string table length")?;
        self.strings.push(value.to_owned());
        self.string_indexes.insert(value.to_owned(), index);
        Ok(index)
    }

    fn string_section_len(&self) -> EpubResult<usize> {
        let mut byte_length = 0_usize;
        for value in &self.strings {
            let utf8_len = value.len();
            checked_u32(utf8_len, "RITORB1 string length")?;
            byte_length = byte_length
                .checked_add(4)
                .and_then(|length| length.checked_add(utf8_len))
                .ok_or_else(|| wire_error("RITORB1 string table is too large"))?;
        }
        Ok(byte_length)
    }

    fn write_string_section(&self, bytes: &mut Vec<u8>) -> EpubResult<()> {
        for value in &self.strings {
            let utf8 = value.as_bytes();
            write_u32(bytes, checked_u32(utf8.len(), "RITORB1 string length")?);
            bytes.extend_from_slice(utf8);
        }
        Ok(())
    }
}
