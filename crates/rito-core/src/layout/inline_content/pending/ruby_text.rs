use std::sync::Arc;

use crate::{
    layout::{
        inline_segment::InlineSegment,
        text_work::{TextWorkMeter, TextWorkYield},
    },
    style::{StyledNode, StyledNodeKind},
};

use super::{discard::PendingNodeDiscard, require_unit};

#[derive(Debug)]
pub(super) struct PendingRubyAnnotation {
    frames: Vec<std::vec::IntoIter<StyledNode>>,
    active_text: Option<PendingTextAppend>,
    discard: Option<PendingNodeDiscard>,
    output: String,
}

impl PendingRubyAnnotation {
    pub(super) fn new(nodes: Vec<StyledNode>) -> Self {
        Self {
            frames: vec![nodes.into_iter()],
            active_text: None,
            discard: None,
            output: String::new(),
        }
    }

    pub(super) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<Option<String>, TextWorkYield> {
        loop {
            if let Some(text) = self.active_text.as_mut() {
                if text.advance(&mut self.output, work)? {
                    self.active_text = None;
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
                    return Ok(Some(std::mem::take(&mut self.output)));
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

    pub(super) fn drain_nodes_into(&mut self, output: &mut Vec<StyledNode>) {
        for frame in self.frames.drain(..) {
            output.extend(frame);
        }
        if let Some(discard) = self.discard.as_mut() {
            discard.drain_remaining_into(output);
        }
    }

    fn dispatch_node(&mut self, mut node: StyledNode) {
        if node.node_type == StyledNodeKind::Text {
            if !node.children.is_empty() {
                self.discard = Some(PendingNodeDiscard::new(std::mem::take(&mut node.children)));
            }
            let content = node.content.take().unwrap_or_default();
            if !content.is_empty() {
                self.active_text = Some(PendingTextAppend::new(content));
            }
            return;
        }
        self.frames
            .push(std::mem::take(&mut node.children).into_iter());
    }
}

#[derive(Debug)]
pub(super) struct PendingAnnotationApply {
    annotation: Arc<String>,
    index: usize,
    end: usize,
    active_copy: Option<PendingAnnotationCopy>,
}

impl PendingAnnotationApply {
    pub(super) fn new(annotation: Arc<String>, start: usize, end: usize) -> Self {
        Self {
            annotation,
            index: start,
            end,
            active_copy: None,
        }
    }

    pub(super) fn advance(
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
struct PendingTextAppend {
    source: String,
    cursor: usize,
    scalar: Option<PendingScalar>,
}

impl PendingTextAppend {
    fn new(source: String) -> Self {
        Self {
            source,
            cursor: 0,
            scalar: None,
        }
    }

    fn advance(
        &mut self,
        output: &mut String,
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        while self.cursor < self.source.len() || self.scalar.is_some() {
            self.prepare_scalar();
            charge_scalar(&mut self.scalar, work)?;
            let scalar = self.scalar.take().expect("a paid annotation scalar exists");
            self.cursor += scalar.character.len_utf8();
            output.push(scalar.character);
        }
        Ok(true)
    }

    fn prepare_scalar(&mut self) {
        if self.scalar.is_none() {
            let character = self.source[self.cursor..]
                .chars()
                .next()
                .expect("the annotation cursor precedes its source end");
            self.scalar = Some(PendingScalar::new(character));
        }
    }
}

#[derive(Debug)]
struct PendingAnnotationCopy {
    source: Arc<String>,
    cursor: usize,
    scalar: Option<PendingScalar>,
    output: String,
}

impl PendingAnnotationCopy {
    fn new(source: Arc<String>) -> Self {
        Self {
            output: String::with_capacity(source.len()),
            source,
            cursor: 0,
            scalar: None,
        }
    }

    fn advance(&mut self, work: &mut TextWorkMeter) -> Result<bool, TextWorkYield> {
        while self.cursor < self.source.len() || self.scalar.is_some() {
            if self.scalar.is_none() {
                let character = self.source[self.cursor..]
                    .chars()
                    .next()
                    .expect("the ruby copy cursor precedes its source end");
                self.scalar = Some(PendingScalar::new(character));
            }
            charge_scalar(&mut self.scalar, work)?;
            let scalar = self.scalar.take().expect("a paid ruby copy scalar exists");
            self.cursor += scalar.character.len_utf8();
            self.output.push(scalar.character);
        }
        Ok(true)
    }

    fn finish(self) -> String {
        self.output
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
    let scalar = scalar.as_mut().expect("a pending scalar exists");
    let taken = work.take_utf16_units(scalar.utf16_units_remaining);
    scalar.utf16_units_remaining -= taken;
    (scalar.utf16_units_remaining == 0)
        .then_some(())
        .ok_or(TextWorkYield)
}
