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

pub(super) enum ScalarMapping {
    Identity(std::option::IntoIter<char>),
    Uppercase(std::char::ToUppercase),
    Lowercase(std::char::ToLowercase),
}

impl PendingTransformLinearity {
    pub(super) fn new(scalar_boundaries_match: bool) -> Self {
        Self {
            scalar_boundaries_match,
            graphemes: None,
            result: None,
        }
    }

    pub(super) const fn result(&self) -> Option<bool> {
        self.result
    }

    pub(super) fn advance(
        &mut self,
        logical: &str,
        painted: &str,
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
            PendingGraphemeBoundaryComparator::new(logical.len(), painted.len())
        });
        self.result = Some(graphemes.advance(logical, painted, work)?);
        self.graphemes = None;
        Ok(())
    }
}

impl ScalarMapping {
    pub(super) fn new(mode: TransformMode, character: char, at_word_boundary: bool) -> Self {
        match mode {
            TransformMode::Uppercase => Self::Uppercase(character.to_uppercase()),
            TransformMode::Lowercase => Self::Lowercase(character.to_lowercase()),
            TransformMode::Capitalize => {
                let mapped = if at_word_boundary && character.is_ascii_alphanumeric() {
                    character.to_ascii_uppercase()
                } else {
                    character
                };
                Self::Identity(Some(mapped).into_iter())
            }
            TransformMode::None => Self::Identity(Some(character).into_iter()),
        }
    }
}

impl Iterator for ScalarMapping {
    type Item = char;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::Identity(mapping) => mapping.next(),
            Self::Uppercase(mapping) => mapping.next(),
            Self::Lowercase(mapping) => mapping.next(),
        }
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

pub(super) const fn next_word_boundary(character: char) -> bool {
    !character.is_ascii_alphanumeric() && character != '_'
}
