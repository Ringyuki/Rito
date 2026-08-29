use super::{READER_DISPLAY_LIST_FORMAT_VERSION, READER_DISPLAY_LIST_MAGIC};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum DecodeError {
    Truncated,
    InvalidMagic,
    UnsupportedVersion(u32),
    UnknownOpcode(u16),
    UnknownEnum(u8),
    InvalidBool(u8),
    InvalidOption(u8),
    InvalidColorFlags(u8),
    InvalidUtf8,
    NonFiniteNumber,
    TrailingBytes,
}

pub(super) fn validate(bytes: &[u8]) -> Result<u32, DecodeError> {
    let mut decoder = Decoder { bytes, offset: 0 };
    if decoder.read_exact::<7>()? != *READER_DISPLAY_LIST_MAGIC {
        return Err(DecodeError::InvalidMagic);
    }
    let version = decoder.read_u32()?;
    if version != READER_DISPLAY_LIST_FORMAT_VERSION {
        return Err(DecodeError::UnsupportedVersion(version));
    }
    let command_count = decoder.read_u32()?;
    for _ in 0..command_count {
        decoder.read_command()?;
    }
    if decoder.offset != bytes.len() {
        return Err(DecodeError::TrailingBytes);
    }
    Ok(command_count)
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl Decoder<'_> {
    fn read_command(&mut self) -> Result<(), DecodeError> {
        match self.read_u16()? {
            1 | 2 => Ok(()),
            3 => self.read_f64s(2),
            4 => self.read_finite_f64(),
            5 => self.read_transform(),
            6 => {
                self.read_rect()?;
                if self.read_option()? {
                    self.read_f64s(2)?;
                }
                Ok(())
            }
            7 => {
                self.read_rect()?;
                self.read_optional_color()
            }
            8 => self.read_block(),
            9 | 10 => self.read_text(),
            11 => self.read_image(),
            12 => {
                self.read_rect()?;
                self.read_color()?;
                self.read_enum(1, 10)
            }
            opcode => Err(DecodeError::UnknownOpcode(opcode)),
        }
    }

    fn read_transform(&mut self) -> Result<(), DecodeError> {
        self.read_f64s(4)?;
        let count = self.read_u32()?;
        for _ in 0..count {
            match self.read_u8()? {
                1 => self.read_finite_f64()?,
                2 => self.read_f64s(2)?,
                3 => {
                    self.read_length()?;
                    self.read_length()?;
                }
                value => return Err(DecodeError::UnknownEnum(value)),
            }
        }
        Ok(())
    }

    fn read_block(&mut self) -> Result<(), DecodeError> {
        self.read_rect()?;
        self.read_optional_background()?;
        if self.read_option()? {
            for _ in 0..4 {
                if self.read_option()? {
                    self.read_border_edge()?;
                }
            }
        }
        if self.read_option()? {
            self.read_enum(1, 2)?;
            self.read_finite_f64()?;
        }
        let shadow_count = self.read_u32()?;
        for _ in 0..shadow_count {
            self.read_f64s(4)?;
            self.read_color()?;
            self.read_bool()?;
        }
        if self.read_option()? {
            self.read_f64s(4)?;
        }
        Ok(())
    }

    fn read_optional_background(&mut self) -> Result<(), DecodeError> {
        if !self.read_option()? {
            return Ok(());
        }
        self.read_optional_color()?;
        self.read_optional_string()?;
        if self.read_option()? {
            // Size tag 4 (explicit) is followed by two optional lengths.
            let tag = self.read_u8()?;
            if !(1..=4).contains(&tag) {
                return Err(DecodeError::UnknownEnum(tag));
            }
            if tag == 4 {
                for _ in 0..2 {
                    if self.read_option()? {
                        self.read_length()?;
                    }
                }
            }
        }
        self.read_optional_enum(1, 6)?;
        if self.read_option()? {
            self.read_length()?;
            self.read_length()?;
        }
        Ok(())
    }

    fn read_text(&mut self) -> Result<(), DecodeError> {
        self.read_string()?;
        self.read_rect()?;
        self.read_run_paint()?;
        self.read_optional_f64()?;
        self.read_optional_string()?;
        self.read_optional_string()?;
        if self.read_option()? {
            self.read_exact::<8>()?;
        }
        self.read_optional_string()?;
        Ok(())
    }

    fn read_run_paint(&mut self) -> Result<(), DecodeError> {
        self.read_string()?;
        self.read_f64s(2)?;
        self.read_enum(1, 2)?;
        self.read_color()?;
        self.read_optional_f64()?;
        self.read_optional_f64()?;
        self.read_optional_color()?;
        self.read_optional_f64()?;
        let shadow_count = self.read_u32()?;
        for _ in 0..shadow_count {
            self.read_f64s(3)?;
            self.read_color()?;
        }
        if self.read_option()? {
            self.read_enum(1, 2)?;
            self.read_f64s(2)?;
            self.read_color()?;
        }
        if self.read_option()? {
            self.read_f64s(4)?;
        }
        if self.read_option()? {
            for _ in 0..4 {
                if self.read_option()? {
                    self.read_finite_f64()?;
                    self.read_border_edge()?;
                }
            }
        }
        if self.read_option()? {
            self.read_f64s(2)?;
        }
        self.read_bool()?;
        self.read_bool()?;
        Ok(())
    }

    fn read_image(&mut self) -> Result<(), DecodeError> {
        self.read_string()?;
        self.read_rect()?;
        self.read_optional_string()?;
        self.read_optional_string()?;
        if self.read_option()? {
            self.read_rect()?;
        }
        Ok(())
    }

    fn read_color(&mut self) -> Result<(), DecodeError> {
        self.read_enum(1, 15)?;
        for _ in 0..4 {
            self.read_finite_f32()?;
        }
        let flags = self.read_u8()?;
        if flags & !0x0f != 0 {
            return Err(DecodeError::InvalidColorFlags(flags));
        }
        Ok(())
    }

    fn read_border_edge(&mut self) -> Result<(), DecodeError> {
        self.read_color()?;
        self.read_enum(1, 10)
    }

    fn read_rect(&mut self) -> Result<(), DecodeError> {
        self.read_f64s(4)
    }

    fn read_length(&mut self) -> Result<(), DecodeError> {
        self.read_enum(1, 2)?;
        self.read_finite_f64()
    }

    fn read_optional_color(&mut self) -> Result<(), DecodeError> {
        if self.read_option()? {
            self.read_color()?;
        }
        Ok(())
    }

    fn read_optional_string(&mut self) -> Result<(), DecodeError> {
        if self.read_option()? {
            self.read_string()?;
        }
        Ok(())
    }

    fn read_optional_f64(&mut self) -> Result<(), DecodeError> {
        if self.read_option()? {
            self.read_finite_f64()?;
        }
        Ok(())
    }

    fn read_optional_enum(&mut self, min: u8, max: u8) -> Result<(), DecodeError> {
        if self.read_option()? {
            self.read_enum(min, max)?;
        }
        Ok(())
    }

    fn read_option(&mut self) -> Result<bool, DecodeError> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            value => Err(DecodeError::InvalidOption(value)),
        }
    }

    fn read_bool(&mut self) -> Result<bool, DecodeError> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            value => Err(DecodeError::InvalidBool(value)),
        }
    }

    fn read_enum(&mut self, min: u8, max: u8) -> Result<(), DecodeError> {
        let value = self.read_u8()?;
        if (min..=max).contains(&value) {
            Ok(())
        } else {
            Err(DecodeError::UnknownEnum(value))
        }
    }

    fn read_f64s(&mut self, count: u32) -> Result<(), DecodeError> {
        for _ in 0..count {
            self.read_finite_f64()?;
        }
        Ok(())
    }

    fn read_finite_f32(&mut self) -> Result<(), DecodeError> {
        let value = f32::from_le_bytes(self.read_exact::<4>()?);
        if value.is_finite() {
            Ok(())
        } else {
            Err(DecodeError::NonFiniteNumber)
        }
    }

    fn read_finite_f64(&mut self) -> Result<(), DecodeError> {
        let value = f64::from_le_bytes(self.read_exact::<8>()?);
        if value.is_finite() {
            Ok(())
        } else {
            Err(DecodeError::NonFiniteNumber)
        }
    }

    fn read_string(&mut self) -> Result<String, DecodeError> {
        let length = usize::try_from(self.read_u32()?).map_err(|_| DecodeError::Truncated)?;
        let end = self
            .offset
            .checked_add(length)
            .ok_or(DecodeError::Truncated)?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or(DecodeError::Truncated)?;
        self.offset = end;
        std::str::from_utf8(bytes)
            .map(str::to_owned)
            .map_err(|_| DecodeError::InvalidUtf8)
    }

    fn read_u8(&mut self) -> Result<u8, DecodeError> {
        Ok(self.read_exact::<1>()?[0])
    }

    fn read_u16(&mut self) -> Result<u16, DecodeError> {
        Ok(u16::from_le_bytes(self.read_exact::<2>()?))
    }

    fn read_u32(&mut self) -> Result<u32, DecodeError> {
        Ok(u32::from_le_bytes(self.read_exact::<4>()?))
    }

    fn read_exact<const N: usize>(&mut self) -> Result<[u8; N], DecodeError> {
        let end = self.offset.checked_add(N).ok_or(DecodeError::Truncated)?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or(DecodeError::Truncated)?;
        self.offset = end;
        bytes.try_into().map_err(|_| DecodeError::Truncated)
    }
}
