use super::{GraphemeScanEvent, PendingGraphemeScan};
use crate::layout::text_work::{TextWorkMeter, TextWorkYield};

/// Compares extended-grapheme UTF-16 boundary streams without allocating the
/// eager boundary vectors. Scalar-boundary equality is established while the
/// transformed text is assembled, before this comparator is started.
#[derive(Debug)]
pub(in crate::layout) struct PendingGraphemeBoundaryComparator {
    logical: PendingBoundaryStream,
    display: PendingBoundaryStream,
    logical_event: Option<BoundaryEvent>,
    display_event: Option<BoundaryEvent>,
    complete: bool,
}

#[derive(Debug)]
struct PendingBoundaryStream {
    graphemes: PendingGraphemeScan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BoundaryEvent {
    Grapheme(usize),
    Complete,
}

impl PendingGraphemeBoundaryComparator {
    pub(in crate::layout) fn new(logical_byte_len: usize, display_byte_len: usize) -> Self {
        Self {
            logical: PendingBoundaryStream::new(logical_byte_len),
            display: PendingBoundaryStream::new(display_byte_len),
            logical_event: None,
            display_event: None,
            complete: false,
        }
    }

    pub(in crate::layout) fn advance(
        &mut self,
        logical: &str,
        display: &str,
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        assert!(
            !self.complete,
            "a completed boundary comparison cannot resume"
        );
        loop {
            if self.logical_event.is_none() {
                self.logical_event = Some(self.logical.advance(logical, work)?);
            }
            if self.display_event.is_none() {
                self.display_event = Some(self.display.advance(display, work)?);
            }
            let logical_event = self
                .logical_event
                .take()
                .expect("logical boundary event is ready");
            let display_event = self
                .display_event
                .take()
                .expect("display boundary event is ready");
            if logical_event != display_event {
                self.complete = true;
                return Ok(false);
            }
            if logical_event == BoundaryEvent::Complete {
                self.complete = true;
                return Ok(true);
            }
        }
    }
}

impl PendingBoundaryStream {
    fn new(text_byte_len: usize) -> Self {
        Self {
            graphemes: PendingGraphemeScan::new(text_byte_len),
        }
    }

    fn advance(
        &mut self,
        text: &str,
        work: &mut TextWorkMeter,
    ) -> Result<BoundaryEvent, TextWorkYield> {
        loop {
            match self.graphemes.advance(text, work)? {
                GraphemeScanEvent::Scalar(_) => {}
                GraphemeScanEvent::Boundary { utf16_offset } => {
                    return Ok(BoundaryEvent::Grapheme(utf16_offset));
                }
                GraphemeScanEvent::Complete { .. } => return Ok(BoundaryEvent::Complete),
            }
        }
    }
}
