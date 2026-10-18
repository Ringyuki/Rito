//! A run's text as a slice of a string its runs share: the painter cuts
//! every run of a paragraph out of the paragraph's text, and neither the
//! cut nor the copies on the way to the wire copy a byte of it.

use std::fmt;
use std::ops::{Deref, Range};
use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct SharedText {
    text: Arc<str>,
    start: u32,
    end: u32,
}

impl SharedText {
    /// The part `range` of `text`. A range outside it, or off a character
    /// boundary, reads as empty.
    pub(crate) fn slice(text: &Arc<str>, range: Range<usize>) -> Self {
        let range = if text.get(range.clone()).is_some() {
            range
        } else {
            0..0
        };
        Self {
            text: Arc::clone(text),
            start: range.start as u32,
            end: range.end as u32,
        }
    }

    /// The part `range` of this text, in its own bytes.
    pub(crate) fn sub(&self, range: Range<usize>) -> Self {
        let start = self.start as usize;
        Self::slice(&self.text, start + range.start..start + range.end)
    }
}

impl Deref for SharedText {
    type Target = str;

    fn deref(&self) -> &str {
        &self.text[self.start as usize..self.end as usize]
    }
}

impl PartialEq for SharedText {
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}

impl PartialEq<&str> for SharedText {
    fn eq(&self, other: &&str) -> bool {
        **self == **other
    }
}

impl fmt::Debug for SharedText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&**self, formatter)
    }
}

impl fmt::Display for SharedText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&**self, formatter)
    }
}

impl From<&str> for SharedText {
    fn from(text: &str) -> Self {
        let text: Arc<str> = Arc::from(text);
        let end = text.len() as u32;
        Self {
            text,
            start: 0,
            end,
        }
    }
}

impl From<String> for SharedText {
    fn from(text: String) -> Self {
        Self::from(text.as_str())
    }
}
