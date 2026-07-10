use std::collections::BTreeMap;

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
    let string_section = encoder.string_section()?;
    let value_section = encoder.values;
    let string_offset = RUNTIME_BUNDLE_HEADER_BYTES;
    let value_offset = string_offset + string_section.len();
    let byte_length = value_offset + value_section.len();
    let byte_length_u32 = checked_u32(byte_length, "runtime bundle byte length")?;

    let mut bytes = vec![0; RUNTIME_BUNDLE_HEADER_BYTES];
    bytes.extend_from_slice(&string_section);
    bytes.extend_from_slice(&value_section);
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
        checked_u32(string_section.len(), "runtime bundle string table length")?,
    );
    write_u32_at(
        &mut bytes,
        36,
        checked_u32(value_offset, "runtime bundle value table offset")?,
    );
    write_u32_at(
        &mut bytes,
        40,
        checked_u32(value_section.len(), "runtime bundle value table length")?,
    );
    write_u32_at(&mut bytes, 44, root_index);
    write_u64_at(&mut bytes, 48, checksum);

    Ok(bytes)
}

#[derive(Default)]
struct RuntimeBundleEncoder {
    strings: Vec<String>,
    string_indexes: BTreeMap<String, u32>,
    scalar_indexes: BTreeMap<ScalarValueKey, u32>,
    values: Vec<u8>,
    value_count: u32,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
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
        let mut indexes = Vec::with_capacity(items.len());
        for item in items {
            indexes.push(self.encode_value(item)?);
        }
        self.push_record(TAG_ARRAY, |bytes| {
            write_u32(bytes, checked_u32(indexes.len(), "RITORB1 array length")?);
            for index in indexes {
                write_u32(bytes, index);
            }
            Ok(())
        })
    }

    fn encode_object(&mut self, object: &Map<String, Value>) -> EpubResult<u32> {
        let mut entries = Vec::with_capacity(object.len());
        for (key, value) in object {
            let key_index = self.intern_string(key)?;
            let value_index = self.encode_value(value)?;
            entries.push((key_index, value_index));
        }
        self.push_record(TAG_OBJECT, |bytes| {
            write_u32(bytes, checked_u32(entries.len(), "RITORB1 object length")?);
            for (key_index, value_index) in entries {
                write_u32(bytes, key_index);
                write_u32(bytes, value_index);
            }
            Ok(())
        })
    }

    fn push_record(
        &mut self,
        tag: u8,
        write_payload: impl FnOnce(&mut Vec<u8>) -> EpubResult<()>,
    ) -> EpubResult<u32> {
        let index = self.value_count;
        self.value_count = self
            .value_count
            .checked_add(1)
            .ok_or_else(|| wire_error("RITORB1 value table is too large"))?;
        self.values.push(tag);
        write_payload(&mut self.values)?;
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

    fn string_section(&self) -> EpubResult<Vec<u8>> {
        let mut bytes = Vec::new();
        for value in &self.strings {
            let utf8 = value.as_bytes();
            write_u32(
                &mut bytes,
                checked_u32(utf8.len(), "RITORB1 string length")?,
            );
            bytes.extend_from_slice(utf8);
        }
        Ok(bytes)
    }
}
