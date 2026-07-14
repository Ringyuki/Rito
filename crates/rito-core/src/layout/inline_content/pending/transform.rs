use serde_json::{Map, Value};

use crate::layout::{
    style_values::string_style,
    text_grapheme::PendingGraphemeBoundaryComparator,
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug)]
pub(super) struct PendingTransformLinearity {
    scalar_boundaries_match: bool,
    graphemes: Option<PendingGraphemeBoundaryComparator>,
    result: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TransformMode {
    None,
    Uppercase,
    Lowercase,
    Capitalize,
}

impl PendingTransformLinearity {
    pub(super) fn new() -> Self {
        Self {
            scalar_boundaries_match: true,
            graphemes: None,
            result: None,
        }
    }

    pub(super) const fn result(&self) -> Option<bool> {
        self.result
    }

    pub(super) fn record_scalar(&mut self, character: char, candidate: &str) {
        debug_assert!(
            self.graphemes.is_none() && self.result.is_none(),
            "transform text must be frozen before boundary comparison"
        );
        self.scalar_boundaries_match &= scalar_boundary_matches(character, candidate);
    }

    pub(super) fn advance(
        &mut self,
        logical: &str,
        display: &str,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if self.result.is_some() {
            return Ok(());
        }
        if !self.scalar_boundaries_match {
            self.result = Some(false);
            return Ok(());
        }
        let graphemes = self.graphemes.get_or_insert_with(|| {
            PendingGraphemeBoundaryComparator::new(logical.len(), display.len())
        });
        self.result = Some(graphemes.advance(logical, display, work)?);
        self.graphemes = None;
        Ok(())
    }
}

pub(super) fn transform_mode(style: &Map<String, Value>) -> TransformMode {
    match string_style(style, "textTransform").as_deref() {
        Some("uppercase") => TransformMode::Uppercase,
        Some("lowercase") => TransformMode::Lowercase,
        Some("capitalize") => TransformMode::Capitalize,
        _ => TransformMode::None,
    }
}

pub(super) fn scalar_equals(character: char, candidate: &str) -> bool {
    let mut buffer = [0_u8; 4];
    character.encode_utf8(&mut buffer) == candidate
}

fn scalar_boundary_matches(character: char, candidate: &str) -> bool {
    let mut candidates = candidate.chars();
    matches!(
        (candidates.next(), candidates.next()),
        (Some(mapped_character), None)
            if mapped_character.len_utf16() == character.len_utf16()
    )
}
