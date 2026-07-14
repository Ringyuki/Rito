use unicode_segmentation::{GraphemeCursor, GraphemeIncomplete};

use crate::layout::text_work::{TextWorkMeter, TextWorkYield};

mod comparator;

pub(super) use comparator::PendingGraphemeBoundaryComparator;

#[derive(Debug)]
pub(super) struct PendingGraphemeScan {
    cursor: GraphemeCursor,
    source_byte_cursor: usize,
    source_utf16_cursor: usize,
    previous_scalar: Option<ScalarChunk>,
    pending_source: Option<PendingCharge>,
    ready_source: Option<ReadySource>,
    pending_context: Option<PendingCharge>,
    grapheme_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GraphemeScanEvent {
    Scalar(char),
    Boundary { utf16_offset: usize },
    Complete { grapheme_count: usize },
}

#[derive(Debug)]
struct ReadySource {
    scalar: ScalarChunk,
    utf16_start: usize,
    reported: bool,
    window_context_remaining: usize,
}

#[derive(Debug)]
struct PendingCharge {
    scalar: ScalarChunk,
    utf16_units_remaining: usize,
}

#[derive(Debug, Clone, Copy)]
struct ScalarChunk {
    character: char,
    start: usize,
    end: usize,
    utf16_len: usize,
}

impl PendingGraphemeScan {
    pub(super) fn new(text_byte_len: usize) -> Self {
        Self {
            cursor: GraphemeCursor::new(0, text_byte_len, true),
            source_byte_cursor: 0,
            source_utf16_cursor: 0,
            previous_scalar: None,
            pending_source: None,
            ready_source: None,
            pending_context: None,
            grapheme_count: 0,
        }
    }

    pub(super) fn advance(
        &mut self,
        text: &str,
        work: &mut TextWorkMeter,
    ) -> Result<GraphemeScanEvent, TextWorkYield> {
        loop {
            if self.pending_context.is_some() {
                self.advance_context(text, work)?;
                continue;
            }
            if self.ready_source.is_some() {
                if let Some(event) = self.advance_ready_source(text, work)? {
                    return Ok(event);
                }
                continue;
            }
            if self.source_byte_cursor == text.len() {
                debug_assert_eq!(self.cursor.cur_cursor(), text.len());
                return Ok(GraphemeScanEvent::Complete {
                    grapheme_count: self.grapheme_count,
                });
            }
            if self.pending_source.is_none() {
                self.pending_source = Some(PendingCharge::at(text, self.source_byte_cursor));
            }
            self.pending_source
                .as_mut()
                .expect("source charge is initialized")
                .advance(work)?;
            let source = self
                .pending_source
                .take()
                .expect("source scalar is fully charged")
                .scalar;
            self.source_byte_cursor = source.end;
            let utf16_start = self.source_utf16_cursor;
            self.source_utf16_cursor += source.utf16_len;
            self.ready_source = Some(ReadySource {
                scalar: source,
                utf16_start,
                reported: false,
                window_context_remaining: self
                    .previous_scalar
                    .map_or(0, |previous| previous.utf16_len),
            });
        }
    }

    fn advance_context(
        &mut self,
        text: &str,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        self.pending_context
            .as_mut()
            .expect("pre-context charge is initialized")
            .advance(work)?;
        let context = self
            .pending_context
            .take()
            .expect("pre-context scalar is fully charged")
            .scalar;
        debug_assert_eq!(text[context.start..context.end].chars().count(), 1);
        self.cursor
            .provide_context(&text[context.start..context.end], context.start);
        Ok(())
    }

    fn advance_ready_source(
        &mut self,
        text: &str,
        work: &mut TextWorkMeter,
    ) -> Result<Option<GraphemeScanEvent>, TextWorkYield> {
        let ready = self
            .ready_source
            .as_mut()
            .expect("ready source scalar is initialized");
        if !ready.reported {
            ready.reported = true;
            return Ok(Some(GraphemeScanEvent::Scalar(ready.scalar.character)));
        }
        let taken = work.take_utf16_units(ready.window_context_remaining);
        ready.window_context_remaining -= taken;
        if ready.window_context_remaining != 0 {
            return Err(TextWorkYield);
        }

        let current = ready.scalar;
        let window_start = self
            .previous_scalar
            .map_or(current.start, |previous| previous.start);
        debug_assert!((1..=2).contains(&text[window_start..current.end].chars().count()));
        match self
            .cursor
            .next_boundary(&text[window_start..current.end], window_start)
        {
            Ok(Some(boundary)) => {
                self.grapheme_count += 1;
                let utf16_offset = match boundary {
                    boundary if boundary == current.start => ready.utf16_start,
                    boundary if boundary == current.end => ready.utf16_start + current.utf16_len,
                    _ => unreachable!("a two-scalar forward window has no other boundary"),
                };
                if self.cursor.cur_cursor() == current.end {
                    self.finish_ready_source();
                } else {
                    debug_assert_eq!(boundary, current.start);
                    debug_assert_eq!(self.cursor.cur_cursor(), current.start);
                }
                return Ok(Some(GraphemeScanEvent::Boundary { utf16_offset }));
            }
            Ok(None) => {
                debug_assert_eq!(self.cursor.cur_cursor(), text.len());
                self.finish_ready_source();
            }
            Err(GraphemeIncomplete::NextChunk) => {
                debug_assert_eq!(self.cursor.cur_cursor(), current.end);
                self.finish_ready_source();
            }
            Err(GraphemeIncomplete::PreContext(offset)) => {
                debug_assert!(offset > 0 && offset <= window_start);
                self.pending_context = Some(PendingCharge::ending_at(text, offset));
            }
            Err(GraphemeIncomplete::PrevChunk | GraphemeIncomplete::InvalidOffset) => {
                unreachable!("forward scalar chunks must be valid for the grapheme cursor")
            }
        }
        Ok(None)
    }

    fn finish_ready_source(&mut self) {
        let ready = self
            .ready_source
            .take()
            .expect("ready source scalar is initialized");
        self.previous_scalar = Some(ready.scalar);
    }
}

impl PendingCharge {
    fn at(text: &str, start: usize) -> Self {
        let character = text[start..]
            .chars()
            .next()
            .expect("source cursor precedes text end");
        Self::new(character, start)
    }

    fn ending_at(text: &str, end: usize) -> Self {
        let (start, character) = text[..end]
            .char_indices()
            .next_back()
            .expect("requested pre-context has a preceding scalar");
        let charge = Self::new(character, start);
        debug_assert_eq!(charge.scalar.end, end);
        charge
    }

    fn new(character: char, start: usize) -> Self {
        let scalar = ScalarChunk {
            character,
            start,
            end: start + character.len_utf8(),
            utf16_len: character.len_utf16(),
        };
        Self {
            scalar,
            utf16_units_remaining: scalar.utf16_len,
        }
    }

    fn advance(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        let taken = work.take_utf16_units(self.utf16_units_remaining);
        self.utf16_units_remaining -= taken;
        if self.utf16_units_remaining == 0 {
            Ok(())
        } else {
            Err(TextWorkYield)
        }
    }
}

#[cfg(test)]
#[path = "text_grapheme_tests.rs"]
mod tests;
