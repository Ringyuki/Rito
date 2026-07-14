use super::require_unit;
use crate::layout::text_work::{TextWorkMeter, TextWorkYield};

const MONOSPACE: &[u8] = b"monospace";

#[derive(Debug)]
pub(super) struct PendingFamilyParser {
    input: String,
    byte_index: usize,
    scalar_units_remaining: usize,
    current: String,
    trimmed_end: usize,
    quote: Option<char>,
    escaped: bool,
    mono_possible: bool,
    mono_bytes: usize,
    trimmed_mono_possible: bool,
    trimmed_mono_bytes: usize,
    monospace: bool,
    finalize_paid: bool,
}

impl PendingFamilyParser {
    pub(super) fn new(input: String) -> Self {
        Self {
            input,
            byte_index: 0,
            scalar_units_remaining: 0,
            current: String::new(),
            trimmed_end: 0,
            quote: None,
            escaped: false,
            mono_possible: true,
            mono_bytes: 0,
            trimmed_mono_possible: true,
            trimmed_mono_bytes: 0,
            monospace: false,
            finalize_paid: false,
        }
    }

    pub(super) fn from_scanned(family: ParsedFamily) -> Self {
        debug_assert!(!family.input_complete);
        let ParsedFamily {
            input,
            input_byte_index,
            quote,
            escaped,
            mut value,
            is_monospace,
            monospace,
            input_complete: _,
        } = family;
        value.clear();
        Self {
            input,
            byte_index: input_byte_index,
            scalar_units_remaining: 0,
            current: value,
            trimmed_end: 0,
            quote,
            escaped,
            mono_possible: true,
            mono_bytes: 0,
            trimmed_mono_possible: true,
            trimmed_mono_bytes: 0,
            monospace: monospace || is_monospace,
            finalize_paid: false,
        }
    }

    pub(super) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<FamilyParseResult, TextWorkYield> {
        let Some(character) = self.input[self.byte_index..].chars().next() else {
            if !self.finalize_paid {
                require_unit(work)?;
                self.finalize_paid = true;
            }
            if self.escaped {
                self.push_current('\\');
                self.escaped = false;
            }
            return Ok(self.finish_family(true));
        };
        self.pay_scalar(character, work)?;
        self.byte_index = self
            .byte_index
            .checked_add(character.len_utf8())
            .expect("font-family byte offset must fit in usize");
        if self.escaped {
            self.push_current(character);
            self.escaped = false;
            return Ok(FamilyParseResult::Pending);
        }
        if character == '\\' {
            self.escaped = true;
            return Ok(FamilyParseResult::Pending);
        }
        match self.quote {
            Some(active) if character == active => self.quote = None,
            Some(_) => self.push_current(character),
            None if character == '"' || character == '\'' => self.quote = Some(character),
            None if character == ',' => return Ok(self.finish_family(false)),
            None => self.push_current(character),
        }
        Ok(FamilyParseResult::Pending)
    }

    fn pay_scalar(
        &mut self,
        character: char,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if self.scalar_units_remaining == 0 {
            self.scalar_units_remaining = character.len_utf16();
        }
        let taken = work.take_utf16_units(self.scalar_units_remaining);
        self.scalar_units_remaining -= taken;
        if self.scalar_units_remaining == 0 {
            Ok(())
        } else {
            Err(TextWorkYield)
        }
    }

    fn push_current(&mut self, character: char) {
        if self.current.is_empty() && character.is_whitespace() {
            return;
        }
        self.current.push(character);
        let mut encoded = [0; 4];
        for byte in character.encode_utf8(&mut encoded).bytes() {
            self.mono_possible &= MONOSPACE
                .get(self.mono_bytes)
                .is_some_and(|expected| byte.eq_ignore_ascii_case(expected));
            self.mono_bytes = self
                .mono_bytes
                .checked_add(1)
                .expect("font-family byte length must fit in usize");
        }
        if !character.is_whitespace() {
            self.trimmed_end = self.current.len();
            self.trimmed_mono_possible = self.mono_possible;
            self.trimmed_mono_bytes = self.mono_bytes;
        }
    }

    fn finish_family(&mut self, input_complete: bool) -> FamilyParseResult {
        self.current.truncate(self.trimmed_end);
        if self.current.is_empty() {
            return if input_complete {
                FamilyParseResult::Complete {
                    monospace: self.monospace,
                }
            } else {
                self.reset_family();
                FamilyParseResult::Pending
            };
        }
        let family = ParsedFamily {
            input: std::mem::take(&mut self.input),
            input_byte_index: self.byte_index,
            quote: self.quote,
            escaped: self.escaped,
            value: std::mem::take(&mut self.current),
            is_monospace: self.trimmed_mono_possible && self.trimmed_mono_bytes == MONOSPACE.len(),
            monospace: self.monospace,
            input_complete,
        };
        FamilyParseResult::Family(family)
    }

    fn reset_family(&mut self) {
        self.current.clear();
        self.trimmed_end = 0;
        self.mono_possible = true;
        self.mono_bytes = 0;
        self.trimmed_mono_possible = true;
        self.trimmed_mono_bytes = 0;
    }
}

#[derive(Debug)]
pub(super) enum FamilyParseResult {
    Pending,
    Family(ParsedFamily),
    Complete { monospace: bool },
}

#[derive(Debug)]
pub(super) struct ParsedFamily {
    pub(super) input: String,
    pub(super) input_byte_index: usize,
    pub(super) quote: Option<char>,
    pub(super) escaped: bool,
    pub(super) value: String,
    pub(super) is_monospace: bool,
    pub(super) monospace: bool,
    pub(super) input_complete: bool,
}
