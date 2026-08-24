use std::sync::Arc;

use serde_json::{Map, Value};

use super::{
    context::OwnedInlineContext,
    source::admit_source_metadata,
    transform::{transform_mode, PendingTransformLinearity, TransformMode},
};
use crate::{
    layout::{
        inline_content::WhitespaceCollapseState,
        inline_segment::TextSegment,
        style_values::string_style,
        text_mapping::{TextMappingCandidate, TextSegmentMapping, TextSourceBasis},
        text_work::{TextWorkMeter, TextWorkYield},
    },
    style::StyledNode,
};

mod assembly;
mod preflight;

use assembly::PendingTextAssembly;
use preflight::{PaintPlan, PendingTransformPreflight, TransformCounts};

#[derive(Debug)]
pub(super) struct PendingTextSegment {
    source: String,
    transform: TransformMode,
    preflight: PendingTransformPreflight,
    counts: TransformCounts,
    plan: PaintPlan,
    assembly: Option<PendingTextAssembly>,
    logical: Option<String>,
    painted: Option<String>,
    linearity: Option<PendingTransformLinearity>,
    source_metadata_admitted: bool,
    phase: TextPhase,
    style: Map<String, Value>,
    href: Option<String>,
    source_path: Option<Vec<usize>>,
    source_text_offset: usize,
    source_basis: TextSourceBasis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextPhase {
    Preflight,
    Assembly,
    Compare,
    SourceAdmission,
    Complete,
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
        Some(Self {
            preflight: PendingTransformPreflight::new(source_text_offset),
            counts: TransformCounts::default(),
            plan: PaintPlan::IdentityFallback,
            assembly: None,
            logical: None,
            painted: None,
            linearity: None,
            source_metadata_admitted: false,
            phase: TextPhase::Preflight,
            source,
            transform,
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
        loop {
            match self.phase {
                TextPhase::Preflight => self.advance_preflight(work)?,
                TextPhase::Assembly => self.advance_assembly(work)?,
                TextPhase::Compare => self.advance_comparison(work)?,
                TextPhase::SourceAdmission => self.advance_source_admission(work)?,
                TextPhase::Complete => return Ok(true),
            }
        }
    }

    pub(super) fn finish(mut self) -> TextSegment {
        debug_assert_eq!(self.phase, TextPhase::Complete);
        debug_assert!(self.source_path.is_none() || self.source_metadata_admitted);
        let logical = self.logical.take().expect("logical text was assembled");
        let painted = self.painted.take().expect("painted text was assembled");
        let transform_is_linear = self
            .linearity
            .as_ref()
            .and_then(PendingTransformLinearity::result)
            .unwrap_or(true);
        let mapping = TextSegmentMapping::Candidate(TextMappingCandidate::new_prevalidated(
            logical,
            self.source_path.clone(),
            self.source_text_offset,
            self.source_basis,
            transform_is_linear,
        ));
        let source_text = self.source_path.is_some().then(|| Arc::from(self.source));
        TextSegment {
            text: painted,
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

    fn advance_preflight(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        let Some(counts) = self.preflight.advance(&self.source, self.transform, work)? else {
            return Ok(());
        };
        self.counts = counts;
        self.plan = counts.paint_plan(self.transform);
        self.linearity = Some(PendingTransformLinearity::new(
            counts.effective_scalar_boundaries(self.plan),
        ));
        self.assembly = Some(PendingTextAssembly::new(
            counts,
            self.plan,
            self.transform,
            self.source_text_offset,
        ));
        self.phase = TextPhase::Assembly;
        Ok(())
    }

    fn advance_assembly(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        let Some(assembled) = self
            .assembly
            .as_mut()
            .expect("text assembly was initialized")
            .advance(&self.source, work)?
        else {
            return Ok(());
        };
        self.logical = Some(assembled.logical);
        self.painted = Some(assembled.painted);
        self.assembly = None;
        self.phase = TextPhase::Compare;
        Ok(())
    }

    fn advance_comparison(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        if self.needs_linearity_check() {
            self.linearity
                .as_mut()
                .expect("transform linearity was initialized")
                .advance(
                    self.logical.as_deref().expect("logical text was assembled"),
                    self.painted.as_deref().expect("painted text was assembled"),
                    work,
                )?;
        }
        self.phase = TextPhase::SourceAdmission;
        Ok(())
    }

    fn advance_source_admission(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        admit_source_metadata(
            work,
            &mut self.source_metadata_admitted,
            self.source_path.as_deref(),
            self.counts.logical_utf16,
            self.source_text_offset,
        )?;
        self.phase = TextPhase::Complete;
        Ok(())
    }

    fn needs_linearity_check(&self) -> bool {
        self.source_basis != TextSourceBasis::RestoredParserWhitespace
            && matches!(
                self.transform,
                TransformMode::Uppercase | TransformMode::Lowercase
            )
            && self.counts.effective_changed(self.plan)
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
