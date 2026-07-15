use std::sync::Arc;

use crate::layout::text_work::{
    AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield,
};

mod apply;
mod extract;

pub(in crate::layout::inline_content::pending) use apply::PendingAnnotationApply;
pub(in crate::layout::inline_content::pending) use extract::{
    PendingRubyAnnotation, PendingRubyAnnotationCleanup,
};

pub(super) type SharedRubyAnnotation = Arc<RubyAnnotation>;

#[derive(Debug)]
pub(super) struct RubyAnnotation {
    text: String,
    utf16_len: usize,
    #[cfg(test)]
    release_probe: Option<Arc<()>>,
}

impl RubyAnnotation {
    pub(super) fn new(text: String, utf16_len: usize) -> Self {
        debug_assert!(!text.is_empty());
        Self {
            text,
            utf16_len,
            #[cfg(test)]
            release_probe: None,
        }
    }

    pub(super) fn text(&self) -> &str {
        &self.text
    }

    pub(super) const fn utf16_len(&self) -> usize {
        self.utf16_len
    }
}

#[derive(Debug)]
struct PendingScalar {
    character: char,
    utf16_units_remaining: usize,
}

impl PendingScalar {
    fn new(character: char) -> Self {
        Self {
            character,
            utf16_units_remaining: character.len_utf16(),
        }
    }
}

fn charge_scalar(
    scalar: &mut Option<PendingScalar>,
    work: &mut TextWorkMeter,
) -> Result<(), TextWorkYield> {
    let scalar = scalar.as_mut().expect("a pending ruby scalar exists");
    let taken = work.take_utf16_units(scalar.utf16_units_remaining);
    scalar.utf16_units_remaining -= taken;
    (scalar.utf16_units_remaining == 0)
        .then_some(())
        .ok_or(TextWorkYield)
}

pub(super) fn admit_inline_collection(
    work: &mut TextWorkMeter,
    utf16_units: usize,
) -> Result<(), TextWorkYield> {
    if matches!(
        work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, utf16_units),
        TextWorkPermitResult::Yield
    ) {
        Err(TextWorkYield)
    } else {
        Ok(())
    }
}

fn checked_add(target: &mut usize, value: usize) {
    *target = target
        .checked_add(value)
        .expect("ruby annotation sizes must fit in usize");
}
