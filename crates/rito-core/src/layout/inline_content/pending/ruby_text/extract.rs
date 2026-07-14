use std::sync::Arc;

use crate::{
    layout::text_work::{TextWorkMeter, TextWorkYield},
    style::{StyledNode, StyledNodeKind},
};

use super::{
    super::{discard::PendingNodeDiscard, require_unit},
    admit_inline_collection, charge_scalar, checked_add, PendingScalar, RubyAnnotation,
    SharedRubyAnnotation,
};

#[derive(Debug)]
pub(in crate::layout::inline_content::pending) struct PendingRubyAnnotation {
    frames: Vec<std::vec::IntoIter<StyledNode>>,
    active_text: Option<PendingTextScan>,
    discard: Option<PendingNodeDiscard>,
    parts: Vec<String>,
    byte_len: usize,
    utf16_len: usize,
    phase: ExtractionPhase,
    output: Option<String>,
    output_capacity: usize,
    output_utf16_len: usize,
    part_index: usize,
    part_cursor: usize,
    scalar: Option<PendingScalar>,
    completed: Option<RubyAnnotation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExtractionPhase {
    Scan,
    Reserve,
    Assemble,
    Seal,
}

impl PendingRubyAnnotation {
    pub(in crate::layout::inline_content::pending) fn new(nodes: Vec<StyledNode>) -> Self {
        Self {
            frames: vec![nodes.into_iter()],
            active_text: None,
            discard: None,
            parts: Vec::new(),
            byte_len: 0,
            utf16_len: 0,
            phase: ExtractionPhase::Scan,
            output: None,
            output_capacity: 0,
            output_utf16_len: 0,
            part_index: 0,
            part_cursor: 0,
            scalar: None,
            completed: None,
        }
    }

    /// Completes the extraction or yields. `None` is a completed empty
    /// annotation, never an in-progress value.
    pub(in crate::layout::inline_content::pending) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<Option<SharedRubyAnnotation>, TextWorkYield> {
        loop {
            match self.phase {
                ExtractionPhase::Scan => {
                    if self.advance_scan(work)? {
                        if self.byte_len == 0 {
                            return Ok(None);
                        }
                        self.phase = ExtractionPhase::Reserve;
                    }
                }
                ExtractionPhase::Reserve => {
                    admit_inline_collection(work, self.utf16_len)?;
                    let output = String::with_capacity(self.byte_len);
                    self.output_capacity = output.capacity();
                    self.output = Some(output);
                    self.phase = ExtractionPhase::Assemble;
                }
                ExtractionPhase::Assemble => {
                    if self.advance_assembly(work)? {
                        self.completed = Some(self.finish_output());
                        self.phase = ExtractionPhase::Seal;
                    }
                }
                ExtractionPhase::Seal => {
                    admit_inline_collection(work, 0)?;
                    let annotation = self
                        .completed
                        .take()
                        .expect("a completed ruby annotation is ready to seal");
                    return Ok(Some(Arc::new(annotation)));
                }
            }
        }
    }

    pub(in crate::layout::inline_content::pending) fn drain_nodes_into(
        &mut self,
        output: &mut Vec<StyledNode>,
    ) {
        for frame in self.frames.drain(..) {
            output.extend(frame);
        }
        if let Some(discard) = self.discard.as_mut() {
            discard.drain_remaining_into(output);
        }
    }

    fn advance_scan(&mut self, work: &mut TextWorkMeter) -> Result<bool, TextWorkYield> {
        loop {
            if let Some(text) = self.active_text.as_mut() {
                if text.advance(&mut self.byte_len, &mut self.utf16_len, work)? {
                    let text = self
                        .active_text
                        .take()
                        .expect("a completed ruby text scan exists")
                        .finish();
                    self.parts.push(text);
                }
                continue;
            }
            if let Some(discard) = self.discard.as_mut() {
                if discard.advance(work)? {
                    self.discard = None;
                }
                continue;
            }
            if self
                .frames
                .last()
                .is_some_and(|frame| frame.as_slice().is_empty())
            {
                require_unit(work)?;
                self.frames.pop();
                if self.frames.is_empty() {
                    return Ok(true);
                }
                continue;
            }
            require_unit(work)?;
            let node = self
                .frames
                .last_mut()
                .and_then(Iterator::next)
                .expect("a paid ruby annotation node exists");
            self.dispatch_node(node);
        }
    }

    fn dispatch_node(&mut self, mut node: StyledNode) {
        if node.node_type == StyledNodeKind::Text {
            if !node.children.is_empty() {
                self.discard = Some(PendingNodeDiscard::new(std::mem::take(&mut node.children)));
            }
            let content = node.content.take().unwrap_or_default();
            if !content.is_empty() {
                self.active_text = Some(PendingTextScan::new(content));
            }
            return;
        }
        self.frames
            .push(std::mem::take(&mut node.children).into_iter());
    }

    fn advance_assembly(&mut self, work: &mut TextWorkMeter) -> Result<bool, TextWorkYield> {
        while self.part_index < self.parts.len() || self.scalar.is_some() {
            self.prepare_assembly_scalar();
            charge_scalar(&mut self.scalar, work)?;
            let scalar = self
                .scalar
                .take()
                .expect("a paid ruby assembly scalar exists");
            checked_add(&mut self.part_cursor, scalar.character.len_utf8());
            checked_add(&mut self.output_utf16_len, scalar.character.len_utf16());
            self.output
                .as_mut()
                .expect("ruby output was reserved")
                .push(scalar.character);
            debug_assert_eq!(
                self.output.as_ref().expect("ruby output exists").capacity(),
                self.output_capacity,
                "exact ruby preflight must prevent output growth"
            );
            if self.part_cursor == self.parts[self.part_index].len() {
                self.part_index += 1;
                self.part_cursor = 0;
            }
        }
        Ok(true)
    }

    fn prepare_assembly_scalar(&mut self) {
        if self.scalar.is_some() {
            return;
        }
        let character = self.parts[self.part_index][self.part_cursor..]
            .chars()
            .next()
            .expect("the ruby assembly cursor precedes its part end");
        self.scalar = Some(PendingScalar::new(character));
    }

    fn finish_output(&mut self) -> RubyAnnotation {
        let output = self.output.take().expect("ruby output was assembled");
        debug_assert_eq!(output.len(), self.byte_len);
        debug_assert_eq!(self.output_utf16_len, self.utf16_len);
        debug_assert_eq!(output.capacity(), self.output_capacity);
        RubyAnnotation::new(output, self.utf16_len)
    }
}

#[derive(Debug)]
struct PendingTextScan {
    source: String,
    cursor: usize,
    scalar: Option<PendingScalar>,
}

impl PendingTextScan {
    fn new(source: String) -> Self {
        Self {
            source,
            cursor: 0,
            scalar: None,
        }
    }

    fn advance(
        &mut self,
        byte_len: &mut usize,
        utf16_len: &mut usize,
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        while self.cursor < self.source.len() || self.scalar.is_some() {
            if self.scalar.is_none() {
                let character = self.source[self.cursor..]
                    .chars()
                    .next()
                    .expect("the ruby scan cursor precedes its source end");
                self.scalar = Some(PendingScalar::new(character));
            }
            charge_scalar(&mut self.scalar, work)?;
            let scalar = self.scalar.take().expect("a paid ruby scan scalar exists");
            checked_add(&mut self.cursor, scalar.character.len_utf8());
            checked_add(byte_len, scalar.character.len_utf8());
            checked_add(utf16_len, scalar.character.len_utf16());
        }
        Ok(true)
    }

    fn finish(self) -> String {
        self.source
    }
}
