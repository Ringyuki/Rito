use super::{invalid, overflow, MAX_COLLECTION_ITEMS, MAX_STRING_BYTES, MAX_WIRE_BYTES};
use crate::runtime::reader_v1::ReaderErrorV1;

pub(crate) struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    pub(crate) fn message(magic: [u8; 8], version: u32) -> Self {
        let mut writer = Self { bytes: Vec::new() };
        writer.raw(&magic);
        writer.u32(version);
        writer.u64(0);
        writer
    }

    pub(crate) fn finish_message(mut self) -> Result<Vec<u8>, ReaderErrorV1> {
        let total =
            u64::try_from(self.bytes.len()).map_err(|_| overflow("wire message byte length"))?;
        if total > MAX_WIRE_BYTES {
            return Err(overflow("wire message byte limit"));
        }
        self.patch_u64(12, total);
        Ok(self.bytes)
    }

    pub(crate) fn record(
        &mut self,
        encode: impl FnOnce(&mut Self) -> Result<(), ReaderErrorV1>,
    ) -> Result<(), ReaderErrorV1> {
        let length_offset = self.bytes.len();
        self.u64(0);
        let payload_offset = self.bytes.len();
        encode(self)?;
        let payload_length = self
            .bytes
            .len()
            .checked_sub(payload_offset)
            .and_then(|value| u64::try_from(value).ok())
            .ok_or_else(|| overflow("record byte length"))?;
        self.patch_u64(length_offset, payload_length);
        Ok(())
    }

    pub(crate) fn count(&mut self, value: usize, field: &str) -> Result<(), ReaderErrorV1> {
        let value = u32::try_from(value).map_err(|_| overflow(field))?;
        if value > MAX_COLLECTION_ITEMS {
            return Err(overflow(field));
        }
        self.u32(value);
        Ok(())
    }

    pub(crate) fn string(&mut self, value: &str, field: &str) -> Result<(), ReaderErrorV1> {
        let length = u32::try_from(value.len()).map_err(|_| overflow(field))?;
        if length > MAX_STRING_BYTES {
            return Err(overflow(field));
        }
        self.u32(length);
        self.raw(value.as_bytes());
        Ok(())
    }

    pub(crate) fn blob(&mut self, value: &[u8], field: &str) -> Result<(), ReaderErrorV1> {
        let length = u64::try_from(value.len()).map_err(|_| overflow(field))?;
        if length > MAX_WIRE_BYTES {
            return Err(overflow(field));
        }
        self.u64(length);
        self.raw(value);
        Ok(())
    }

    pub(crate) fn fixed_bytes(&mut self, value: &[u8], field: &str) -> Result<(), ReaderErrorV1> {
        let length = u32::try_from(value.len()).map_err(|_| overflow(field))?;
        self.u32(length);
        self.raw(value);
        Ok(())
    }

    pub(crate) fn option<T: ?Sized>(
        &mut self,
        value: Option<&T>,
        encode: impl FnOnce(&mut Self, &T) -> Result<(), ReaderErrorV1>,
    ) -> Result<(), ReaderErrorV1> {
        match value {
            Some(value) => {
                self.u8(1);
                encode(self, value)
            }
            None => {
                self.u8(0);
                Ok(())
            }
        }
    }

    pub(crate) fn bool(&mut self, value: bool) {
        self.u8(u8::from(value));
    }

    pub(crate) fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    pub(crate) fn u16(&mut self, value: u16) {
        self.raw(&value.to_le_bytes());
    }

    pub(crate) fn u32(&mut self, value: u32) {
        self.raw(&value.to_le_bytes());
    }

    pub(crate) fn u64(&mut self, value: u64) {
        self.raw(&value.to_le_bytes());
    }

    pub(crate) fn f64(&mut self, value: f64, field: &str) -> Result<(), ReaderErrorV1> {
        if !value.is_finite() {
            return Err(invalid(format!("{field} must be finite")));
        }
        self.u64(value.to_bits());
        Ok(())
    }

    fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }

    fn patch_u64(&mut self, offset: usize, value: u64) {
        self.bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }
}
