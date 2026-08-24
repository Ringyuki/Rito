use std::{borrow::Cow, collections::BTreeMap};

use super::Utf16Text;

/// Incrementally assembles the indexes carried by an owned [`Utf16Text`].
///
/// Callers meter each scalar before `push`. String/newline storage is reserved
/// exactly by the context preflight; individual B-tree node allocations remain
/// indivisible allocator work. Finishing never scans the completed text again.
#[derive(Debug)]
pub(crate) struct OwnedUtf16TextBuilder {
    text: String,
    len: usize,
    boundaries: BTreeMap<usize, usize>,
    newlines: Vec<usize>,
}

impl OwnedUtf16TextBuilder {
    pub(crate) fn with_capacities(text_bytes: usize, newline_count: usize) -> Self {
        Self {
            text: String::with_capacity(text_bytes),
            len: 0,
            boundaries: BTreeMap::from([(0, 0)]),
            newlines: Vec::with_capacity(newline_count),
        }
    }

    pub(crate) fn push(&mut self, character: char) {
        if character == '\n' {
            self.newlines.push(self.len);
        }
        self.text.push(character);
        self.len = self
            .len
            .checked_add(character.len_utf16())
            .expect("preflighted UTF-16 text length must fit in usize");
        self.boundaries.insert(self.len, self.text.len());
    }

    pub(crate) const fn utf16_len(&self) -> usize {
        self.len
    }

    pub(crate) fn finish(self) -> Utf16Text<'static> {
        Utf16Text {
            text: Cow::Owned(self.text),
            len: self.len,
            boundaries: self.boundaries,
            newlines: self.newlines,
        }
    }
}
