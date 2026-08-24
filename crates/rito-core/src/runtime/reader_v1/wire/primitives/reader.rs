use super::{invalid, MAX_COLLECTION_ITEMS, MAX_STRING_BYTES, MAX_WIRE_BYTES};
use crate::runtime::reader_v1::ReaderErrorV1;

const INITIAL_COLLECTION_CAPACITY: usize = 4_096;

pub(crate) struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    pub(crate) const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    pub(crate) fn message(
        bytes: &'a [u8],
        expected_magic: [u8; 8],
        expected_version: u32,
    ) -> Result<Self, ReaderErrorV1> {
        let actual_length = u64::try_from(bytes.len())
            .map_err(|_| invalid("wire message length is not representable"))?;
        if actual_length > MAX_WIRE_BYTES {
            return Err(invalid("wire message exceeds the byte limit"));
        }
        let mut reader = Self::new(bytes);
        if reader.take(8)? != expected_magic {
            return Err(invalid("wire message magic is invalid"));
        }
        let version = reader.u32()?;
        if version != expected_version {
            return Err(invalid(format!("unsupported wire version: {version}")));
        }
        let declared_length = reader.u64()?;
        if declared_length != actual_length {
            return Err(invalid("wire message total length does not match input"));
        }
        Ok(reader)
    }

    pub(crate) fn record<T>(
        &mut self,
        field: &str,
        decode: impl FnOnce(&mut Self) -> Result<T, ReaderErrorV1>,
    ) -> Result<T, ReaderErrorV1> {
        let length = self.u64()?;
        if length > MAX_WIRE_BYTES {
            return Err(invalid(format!("{field} exceeds the record byte limit")));
        }
        let length = usize::try_from(length)
            .map_err(|_| invalid(format!("{field} length is not addressable")))?;
        let payload = self.take(length)?;
        let mut record = Self::new(payload);
        let value = decode(&mut record)?;
        record.finish(field)?;
        Ok(value)
    }

    pub(crate) fn count(&mut self, field: &str) -> Result<u32, ReaderErrorV1> {
        let count = self.u32()?;
        if count > MAX_COLLECTION_ITEMS {
            return Err(invalid(format!("{field} exceeds the item limit")));
        }
        Ok(count)
    }

    pub(crate) fn collection<T>(
        &mut self,
        field: &str,
        mut decode: impl FnMut(&mut Self) -> Result<T, ReaderErrorV1>,
    ) -> Result<Vec<T>, ReaderErrorV1> {
        let count = self.count(field)?;
        let initial = usize::try_from(count)
            .unwrap_or(INITIAL_COLLECTION_CAPACITY)
            .min(INITIAL_COLLECTION_CAPACITY);
        let mut values = Vec::with_capacity(initial);
        for _ in 0..count {
            values.push(decode(self)?);
        }
        Ok(values)
    }

    pub(crate) fn string(&mut self, field: &str) -> Result<String, ReaderErrorV1> {
        let length = self.u32()?;
        if length > MAX_STRING_BYTES {
            return Err(invalid(format!("{field} exceeds the string byte limit")));
        }
        let length = usize::try_from(length)
            .map_err(|_| invalid(format!("{field} length is not addressable")))?;
        let bytes = self.take(length)?;
        let value = std::str::from_utf8(bytes)
            .map_err(|_| invalid(format!("{field} is not valid UTF-8")))?;
        Ok(value.to_owned())
    }

    pub(crate) fn blob(&mut self, field: &str) -> Result<Vec<u8>, ReaderErrorV1> {
        Ok(self.blob_slice(field)?.to_vec())
    }

    pub(crate) fn blob_slice(&mut self, field: &str) -> Result<&'a [u8], ReaderErrorV1> {
        self.blob_slice_with_limit(field, MAX_WIRE_BYTES)
    }

    pub(crate) fn blob_slice_with_limit(
        &mut self,
        field: &str,
        max_bytes: u64,
    ) -> Result<&'a [u8], ReaderErrorV1> {
        let length = self.u64()?;
        if length > max_bytes {
            return Err(invalid(format!("{field} exceeds its operation byte limit")));
        }
        let length = usize::try_from(length)
            .map_err(|_| invalid(format!("{field} length is not addressable")))?;
        self.take(length)
    }

    pub(crate) fn fixed_bytes<const N: usize>(
        &mut self,
        field: &str,
    ) -> Result<[u8; N], ReaderErrorV1> {
        let length = self.u32()?;
        let expected = u32::try_from(N).map_err(|_| invalid("fixed byte width is invalid"))?;
        if length != expected {
            return Err(invalid(format!("{field} must contain {expected} bytes")));
        }
        self.take(N)?
            .try_into()
            .map_err(|_| invalid(format!("{field} is truncated")))
    }

    pub(crate) fn option<T>(
        &mut self,
        field: &str,
        decode: impl FnOnce(&mut Self) -> Result<T, ReaderErrorV1>,
    ) -> Result<Option<T>, ReaderErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => decode(self).map(Some),
            tag => Err(invalid(format!("unknown {field} option tag: {tag}"))),
        }
    }

    pub(crate) fn bool(&mut self, field: &str) -> Result<bool, ReaderErrorV1> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            tag => Err(invalid(format!("unknown {field} boolean tag: {tag}"))),
        }
    }

    pub(crate) fn u8(&mut self) -> Result<u8, ReaderErrorV1> {
        Ok(self.take(1)?[0])
    }

    pub(crate) fn u16(&mut self) -> Result<u16, ReaderErrorV1> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().expect("width checked"),
        ))
    }

    pub(crate) fn u32(&mut self) -> Result<u32, ReaderErrorV1> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("width checked"),
        ))
    }

    pub(crate) fn u64(&mut self) -> Result<u64, ReaderErrorV1> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().expect("width checked"),
        ))
    }

    pub(crate) fn f64(&mut self, field: &str) -> Result<f64, ReaderErrorV1> {
        let value = f64::from_bits(self.u64()?);
        if !value.is_finite() {
            return Err(invalid(format!("{field} must be finite")));
        }
        Ok(value)
    }

    pub(crate) fn finish(&self, field: &str) -> Result<(), ReaderErrorV1> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(invalid(format!("{field} contains trailing bytes")))
        }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], ReaderErrorV1> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| invalid("wire offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| invalid("wire message is truncated"))?;
        self.offset = end;
        Ok(value)
    }
}
