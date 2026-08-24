use std::sync::Arc;

use crate::layout::{
    inline_segment::InlineSegment,
    text_work::{TextWorkMeter, TextWorkYield},
};

use super::{
    super::require_unit, admit_inline_collection, charge_scalar, checked_add, PendingScalar,
    SharedRubyAnnotation,
};

#[derive(Debug)]
pub(in crate::layout::inline_content::pending) struct PendingAnnotationApply {
    annotation: SharedRubyAnnotation,
    index: usize,
    end: usize,
    active_copy: Option<PendingAnnotationCopy>,
}

impl PendingAnnotationApply {
    pub(in crate::layout::inline_content::pending) fn new(
        annotation: SharedRubyAnnotation,
        start: usize,
        end: usize,
    ) -> Self {
        Self {
            annotation,
            index: start,
            end,
            active_copy: None,
        }
    }

    pub(in crate::layout::inline_content::pending) fn advance(
        &mut self,
        output: &mut [InlineSegment],
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        loop {
            if let Some(copy) = self.active_copy.as_mut() {
                if !copy.advance(work)? {
                    continue;
                }
                require_unit(work)?;
                let annotation = self
                    .active_copy
                    .take()
                    .expect("a completed ruby annotation copy exists")
                    .finish();
                output[self.index]
                    .as_text_mut()
                    .expect("ruby annotation copies target text segments")
                    .ruby_annotation = Some(annotation);
                self.index += 1;
                continue;
            }
            if self.index == self.end {
                return Ok(true);
            }
            require_unit(work)?;
            if output[self.index].is_atom() {
                self.index += 1;
            } else {
                self.active_copy = Some(PendingAnnotationCopy::new(Arc::clone(&self.annotation)));
            }
        }
    }
}

#[derive(Debug)]
struct PendingAnnotationCopy {
    source: SharedRubyAnnotation,
    cursor: usize,
    scalar: Option<PendingScalar>,
    output: Option<String>,
    output_capacity: usize,
    output_utf16_len: usize,
}

impl PendingAnnotationCopy {
    fn new(source: SharedRubyAnnotation) -> Self {
        Self {
            source,
            cursor: 0,
            scalar: None,
            output: None,
            output_capacity: 0,
            output_utf16_len: 0,
        }
    }

    fn advance(&mut self, work: &mut TextWorkMeter) -> Result<bool, TextWorkYield> {
        self.reserve(work)?;
        while self.cursor < self.source.text().len() || self.scalar.is_some() {
            if self.scalar.is_none() {
                let character = self.source.text()[self.cursor..]
                    .chars()
                    .next()
                    .expect("the ruby copy cursor precedes its source end");
                self.scalar = Some(PendingScalar::new(character));
            }
            charge_scalar(&mut self.scalar, work)?;
            let scalar = self.scalar.take().expect("a paid ruby copy scalar exists");
            checked_add(&mut self.cursor, scalar.character.len_utf8());
            checked_add(&mut self.output_utf16_len, scalar.character.len_utf16());
            self.output
                .as_mut()
                .expect("ruby copy output was reserved")
                .push(scalar.character);
            debug_assert_eq!(
                self.output
                    .as_ref()
                    .expect("ruby copy output exists")
                    .capacity(),
                self.output_capacity,
                "exact ruby copy preflight must prevent buffer growth"
            );
        }
        Ok(true)
    }

    fn reserve(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        if self.output.is_some() {
            return Ok(());
        }
        admit_inline_collection(work, self.source.utf16_len())?;
        let output = String::with_capacity(self.source.text().len());
        self.output_capacity = output.capacity();
        self.output = Some(output);
        Ok(())
    }

    fn finish(self) -> String {
        let output = self.output.expect("ruby copy output was assembled");
        debug_assert_eq!(output.len(), self.source.text().len());
        debug_assert_eq!(self.output_utf16_len, self.source.utf16_len());
        debug_assert_eq!(output.capacity(), self.output_capacity);
        output
    }
}
