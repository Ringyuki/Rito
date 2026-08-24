use crate::layout::text_work::{TextWorkMeter, TextWorkYield};

use super::super::{charge_scalar, checked_add, PendingScalar};

#[derive(Debug)]
pub(super) struct PendingTextScan {
    source: String,
    cursor: usize,
    scalar: Option<PendingScalar>,
}

impl PendingTextScan {
    pub(super) fn new(source: String) -> Self {
        Self {
            source,
            cursor: 0,
            scalar: None,
        }
    }

    pub(super) fn advance(
        &mut self,
        byte_len: &mut usize,
        utf16_len: &mut usize,
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        while self.cursor < self.source.len() || self.scalar.is_some() {
            self.prepare_scalar();
            charge_scalar(&mut self.scalar, work)?;
            let scalar = self.scalar.take().expect("a paid ruby scan scalar exists");
            checked_add(&mut self.cursor, scalar.character.len_utf8());
            checked_add(byte_len, scalar.character.len_utf8());
            checked_add(utf16_len, scalar.character.len_utf16());
        }
        Ok(true)
    }

    #[cfg(test)]
    pub(super) fn is_complete(&self) -> bool {
        self.cursor == self.source.len() && self.scalar.is_none()
    }

    pub(super) fn finish(self) -> String {
        self.source
    }

    fn prepare_scalar(&mut self) {
        if self.scalar.is_some() {
            return;
        }
        let character = self.source[self.cursor..]
            .chars()
            .next()
            .expect("the ruby scan cursor precedes its source end");
        self.scalar = Some(PendingScalar::new(character));
    }
}
