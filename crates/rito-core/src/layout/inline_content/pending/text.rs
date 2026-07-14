use std::sync::Arc;

use serde_json::{Map, Value};

use super::{
    context::OwnedInlineContext,
    source::admit_source_metadata,
    transform::{scalar_equals, transform_mode, PendingTransformLinearity, TransformMode},
};
use crate::{
    layout::{
        inline_content::WhitespaceCollapseState,
        inline_segment::TextSegment,
        style_values::string_style,
        text_mapping::{TextMappingCandidate, TextSegmentMapping, TextSourceBasis},
        text_work::{AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield},
    },
    style::StyledNode,
};

#[derive(Debug)]
struct PendingScalar {
    character: char,
    utf16_units_remaining: usize,
}

#[derive(Debug)]
pub(super) struct PendingTextSegment {
    source: String,
    cursor: usize,
    scalar: Option<PendingScalar>,
    logical: String,
    display: String,
    transformed: Option<String>,
    logical_utf16_len: usize,
    transformed_utf16_len: usize,
    transform: TransformMode,
    transform_changed: bool,
    contextual_lowercase: bool,
    contextual_lowercase_resolved: bool,
    linearity: PendingTransformLinearity,
    source_metadata_admitted: bool,
    at_word_boundary: bool,
    style: Map<String, Value>,
    href: Option<String>,
    source_path: Option<Vec<usize>>,
    source_text_offset: usize,
    source_basis: TextSourceBasis,
}

impl PendingTextSegment {
    pub(super) fn new(
        mut node: StyledNode,
        context: &OwnedInlineContext,
        whitespace: &mut WhitespaceCollapseState,
    ) -> Option<Self> {
        let content = node.content.take().unwrap_or_default();
        if content.is_empty() {
            return None;
        }
        let style = context.patched_style(std::mem::take(&mut node.style));
        let preserve = matches!(
            string_style(&style, "whiteSpace").as_deref(),
            Some("pre" | "pre-wrap")
        );
        let restored_parser_whitespace = preserve && node.source_text.is_some();
        let forced_break = content == "\n" && node.source_text.is_none();
        let source = if preserve {
            node.source_text.take().unwrap_or(content)
        } else {
            content
        };
        let source_text_offset = usize::from(
            !preserve
                && !forced_break
                && whitespace.previous_ended_with_space()
                && source.starts_with(' '),
        );
        let logical = &source[source_text_offset..];
        update_whitespace(whitespace, logical, preserve, forced_break);
        if logical.is_empty() {
            return None;
        }
        let transform = transform_mode(&style);
        let transformed =
            (transform != TransformMode::None).then(|| String::with_capacity(logical.len()));
        Some(Self {
            cursor: source_text_offset,
            logical: String::with_capacity(logical.len()),
            display: String::with_capacity(logical.len()),
            transformed,
            source,
            scalar: None,
            logical_utf16_len: 0,
            transformed_utf16_len: 0,
            transform,
            transform_changed: false,
            contextual_lowercase: false,
            contextual_lowercase_resolved: false,
            linearity: PendingTransformLinearity::new(),
            source_metadata_admitted: false,
            at_word_boundary: true,
            style,
            href: context.href.clone(),
            source_path: node.source_ref.map(|source| source.node_path),
            source_text_offset,
            source_basis: if restored_parser_whitespace {
                TextSourceBasis::RestoredParserWhitespace
            } else {
                TextSourceBasis::ParsedText
            },
        })
    }

    pub(super) fn advance(&mut self, work: &mut TextWorkMeter) -> Result<bool, TextWorkYield> {
        while self.cursor < self.source.len() || self.scalar.is_some() {
            self.prepare_scalar();
            let scalar = self.scalar.as_mut().expect("a pending scalar exists");
            let taken = work.take_utf16_units(scalar.utf16_units_remaining);
            scalar.utf16_units_remaining -= taken;
            if scalar.utf16_units_remaining > 0 {
                return Err(TextWorkYield);
            }
            self.commit_scalar();
        }
        self.resolve_contextual_lowercase(work)?;
        self.compare_transform_boundaries(work)?;
        admit_source_metadata(
            work,
            &mut self.source_metadata_admitted,
            self.source_path.as_deref(),
            self.logical_utf16_len,
            self.source_text_offset,
        )?;
        Ok(true)
    }

    pub(super) fn finish(mut self) -> TextSegment {
        debug_assert!(self.source_path.is_none() || self.source_metadata_admitted);
        let use_transformed = self.transformed_utf16_len == self.logical_utf16_len;
        let text = if use_transformed {
            self.transformed.take().unwrap_or(self.display)
        } else {
            self.display
        };
        let transform_is_linear = self.linearity.result().unwrap_or(true);
        let mapping = TextSegmentMapping::Candidate(TextMappingCandidate::new_prevalidated(
            self.logical,
            self.source_path.clone(),
            self.source_text_offset,
            self.source_basis,
            transform_is_linear,
        ));
        let source_text = self.source_path.is_some().then(|| Arc::from(self.source));
        TextSegment {
            text,
            mapping,
            style: self.style,
            href: self.href,
            source_path: self.source_path,
            source_text,
            source_text_offset: (self.source_text_offset > 0).then_some(self.source_text_offset),
            ruby_annotation: None,
            inline_margin_left: None,
            inline_margin_right: None,
            border_start: false,
            border_end: false,
        }
    }

    fn prepare_scalar(&mut self) {
        if self.scalar.is_some() {
            return;
        }
        let character = self.source[self.cursor..]
            .chars()
            .next()
            .expect("the source cursor lies before a scalar");
        self.scalar = Some(PendingScalar {
            character,
            utf16_units_remaining: character.len_utf16(),
        });
    }

    fn commit_scalar(&mut self) {
        let scalar = self.scalar.take().expect("a paid scalar exists");
        self.cursor += scalar.character.len_utf8();
        self.logical_utf16_len += scalar.character.len_utf16();
        self.logical.push(scalar.character);
        self.display.push(scalar.character);
        self.contextual_lowercase |=
            self.transform == TransformMode::Lowercase && scalar.character == 'Σ';
        self.push_transformed(scalar.character);
    }

    fn resolve_contextual_lowercase(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if !self.contextual_lowercase || self.contextual_lowercase_resolved {
            return Ok(());
        }
        // `str::to_lowercase` applies Unicode Final_Sigma using surrounding
        // cased and case-ignorable scalars. Keep that rare contextual rule as
        // one explicitly paid atomic residual rather than silently changing
        // the eager transform semantics.
        if matches!(
            work.try_permit_atomic(
                AtomicTextOperationKind::InlineCollection,
                self.logical_utf16_len,
            ),
            TextWorkPermitResult::Yield
        ) {
            return Err(TextWorkYield);
        }
        let transformed = self.logical.to_lowercase();
        self.transform_changed = transformed != self.logical;
        self.transformed_utf16_len = transformed.encode_utf16().count();
        self.transformed = Some(transformed);
        self.contextual_lowercase_resolved = true;
        Ok(())
    }

    fn push_transformed(&mut self, character: char) {
        let Some(output) = self.transformed.as_mut() else {
            self.transformed_utf16_len += character.len_utf16();
            return;
        };
        let start = output.len();
        match self.transform {
            TransformMode::Uppercase => output.extend(character.to_uppercase()),
            TransformMode::Lowercase => output.extend(character.to_lowercase()),
            TransformMode::Capitalize => {
                let transformed = if self.at_word_boundary && character.is_ascii_alphanumeric() {
                    character.to_ascii_uppercase()
                } else {
                    character
                };
                output.push(transformed);
                self.at_word_boundary = !character.is_ascii_alphanumeric() && character != '_';
            }
            TransformMode::None => unreachable!("identity transforms have no second buffer"),
        }
        let mapped = &output[start..];
        self.transform_changed |= !scalar_equals(character, mapped);
        // The eager scalar-boundary vectors are equal exactly when every
        // per-source-scalar case mapping remains one scalar of the same UTF-16
        // width. Contextual Final_Sigma only changes that scalar's value.
        self.linearity.record_scalar(character, mapped);
        self.transformed_utf16_len += mapped.encode_utf16().count();
    }

    fn needs_linearity_check(&self) -> bool {
        self.source_basis != TextSourceBasis::RestoredParserWhitespace
            && matches!(
                self.transform,
                TransformMode::Uppercase | TransformMode::Lowercase
            )
            && self.transform_changed
            && self.transformed_utf16_len == self.logical_utf16_len
    }

    fn compare_transform_boundaries(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if !self.needs_linearity_check() {
            return Ok(());
        }
        let transformed = self
            .transformed
            .as_deref()
            .expect("changed equal-length transforms retain their display text");
        self.linearity.advance(&self.logical, transformed, work)
    }
}

fn update_whitespace(
    whitespace: &mut WhitespaceCollapseState,
    logical: &str,
    preserve: bool,
    forced_break: bool,
) {
    if preserve || forced_break {
        whitespace.set_previous_ended_with_space(false);
    } else if !logical.is_empty() {
        whitespace.set_previous_ended_with_space(logical.ends_with(' '));
    }
}
