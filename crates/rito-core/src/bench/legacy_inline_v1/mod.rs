//! Fail-closed projection of the legacy JSON style map into the V1 contract.
//!
//! Node entries borrow their resolved `Map` and project fields lazily. This
//! avoids both cloning an entire map and allocating 35 records per element.

use std::fmt;

use rito_source::{NodeId, SourceNodeKind};
use rito_style_contract::{InlineStyleTableV1, StyleId};
use serde_json::{Map, Value};

use super::{PreparedLegacyStyle, ResolvedLegacyStyle, StyledNode, StyledNodeKind};

mod font_text;
mod fragment;
mod paint;
mod types;
mod value;

pub use types::{
    LegacyBorderEdgeGeometryV1, LegacyBorderGeometryV1, LegacyBoxShadowGeometryV1,
    LegacyFontFamiliesEvidenceV1, LegacyInlineEvidenceV1, LegacyInlineFieldDispositionV1,
    LegacyInlineFieldOutcomeV1, LegacyInlineFieldReasonV1, LegacyInlineFieldV1,
    LegacyInlineStyleProjectionV1, LegacyTextDecorationGeometryV1, LegacyTextShadowGeometryV1,
};

#[derive(Clone, Copy)]
enum MapSlot<'a> {
    Missing,
    Borrowed(&'a Map<String, Value>),
    Duplicate,
}

/// One source element and its borrowed, lazily evaluated field ledger.
pub struct LegacyInlineNodeDispositionV1<'a> {
    pub node_id: NodeId,
    map: MapSlot<'a>,
}

impl fmt::Debug for LegacyInlineNodeDispositionV1<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LegacyInlineNodeDispositionV1")
            .field("node_id", &self.node_id)
            .field("style_id", &self.style_id())
            .finish_non_exhaustive()
    }
}

impl<'a> LegacyInlineNodeDispositionV1<'a> {
    /// No legacy node is assigned while required V1 fields are unavailable.
    pub const fn style_id(&self) -> Option<StyleId> {
        None
    }

    /// Produces one field outcome without retaining or cloning the JSON map.
    pub fn field(&self, field: LegacyInlineFieldV1) -> LegacyInlineFieldOutcomeV1<'a> {
        match self.map {
            MapSlot::Missing => {
                unavailable(field, LegacyInlineFieldReasonV1::ResolvedStyleMissing, None)
            }
            MapSlot::Duplicate => invalid(field, LegacyInlineFieldReasonV1::ResolvedStyleDuplicate),
            MapSlot::Borrowed(style) => project_field(style, field),
        }
    }

    /// Iterates every V1 field in stable contract order.
    pub fn fields(&self) -> impl ExactSizeIterator<Item = LegacyInlineFieldOutcomeV1<'a>> + '_ {
        LegacyInlineFieldV1::ALL
            .into_iter()
            .map(|field| self.field(field))
    }
}

impl PreparedLegacyStyle {
    /// Builds the strict legacy V1 projection over the same dense SourceArena.
    ///
    /// The legacy map has no bidi or font-family provenance and stores colors
    /// as unresolved strings. Those fields remain unavailable, so this method
    /// deliberately leaves every table slot empty instead of inventing values.
    pub fn project_inline_styles_v1<'a>(
        &self,
        resolved: &'a ResolvedLegacyStyle,
    ) -> LegacyInlineStyleProjectionV1<'a> {
        let mut slots = vec![MapSlot::Missing; self.source_arena.len()];
        index_maps(&resolved.styled_nodes, &mut slots);
        let element_count = self
            .source_arena
            .iter()
            .filter(|(_, node)| matches!(node.kind, SourceNodeKind::Element(_)))
            .count();
        let mut dispositions = Vec::with_capacity(element_count);
        for (node_id, node) in self.source_arena.iter() {
            if matches!(node.kind, SourceNodeKind::Element(_)) {
                dispositions.push(LegacyInlineNodeDispositionV1 {
                    node_id,
                    map: slots[node_id.index()],
                });
            }
        }
        drop(slots);
        LegacyInlineStyleProjectionV1 {
            table: InlineStyleTableV1::new(self.source_arena.len()),
            dispositions,
        }
    }
}

fn index_maps<'a>(nodes: &'a [StyledNode], slots: &mut [MapSlot<'a>]) {
    for node in nodes {
        if node.node_type != StyledNodeKind::Text {
            if let Some(node_id) = node
                .source_ref
                .as_ref()
                .and_then(|source_ref| source_ref.source_node_id)
            {
                if let Some(slot) = slots.get_mut(node_id.index()) {
                    *slot = match *slot {
                        MapSlot::Missing => MapSlot::Borrowed(&node.style),
                        MapSlot::Borrowed(_) | MapSlot::Duplicate => MapSlot::Duplicate,
                    };
                }
            }
        }
        index_maps(&node.children, slots);
    }
}

fn project_field<'a>(
    style: &'a Map<String, Value>,
    field: LegacyInlineFieldV1,
) -> LegacyInlineFieldOutcomeV1<'a> {
    use LegacyInlineFieldV1 as Field;

    match field {
        Field::FontFamilies
        | Field::FontIsSystem
        | Field::FontIsInitial
        | Field::FontSize
        | Field::FontWeight
        | Field::FontSlant
        | Field::LineHeight
        | Field::TextAlign
        | Field::TextJustify
        | Field::TextTransform
        | Field::WhiteSpaceCollapse
        | Field::TextWrapMode
        | Field::WordBreak
        | Field::LineBreak
        | Field::OverflowWrap
        | Field::LetterSpacing
        | Field::WordSpacing
        | Field::TextIndent
        | Field::Language
        | Field::Direction
        | Field::UnicodeBidi
        | Field::WritingMode => font_text::project(style, field),
        Field::Margin
        | Field::Padding
        | Field::Border
        | Field::BorderRadii
        | Field::AlignmentBaseline
        | Field::BaselineSource
        | Field::BaselineShift => fragment::project(style, field),
        Field::Foreground
        | Field::Opacity
        | Field::Background
        | Field::TextDecoration
        | Field::TextShadows
        | Field::BoxShadows => paint::project(style, field),
    }
}

fn exact<'a>(
    field: LegacyInlineFieldV1,
    evidence: LegacyInlineEvidenceV1<'a>,
) -> LegacyInlineFieldOutcomeV1<'a> {
    outcome(
        field,
        LegacyInlineFieldDispositionV1::Exact,
        LegacyInlineFieldReasonV1::ExactMapValue,
        Some(evidence),
    )
}

fn policy<'a>(
    field: LegacyInlineFieldV1,
    reason: LegacyInlineFieldReasonV1,
    evidence: LegacyInlineEvidenceV1<'a>,
) -> LegacyInlineFieldOutcomeV1<'a> {
    outcome(
        field,
        LegacyInlineFieldDispositionV1::LegacyPolicy,
        reason,
        Some(evidence),
    )
}

fn unavailable<'a>(
    field: LegacyInlineFieldV1,
    reason: LegacyInlineFieldReasonV1,
    evidence: Option<LegacyInlineEvidenceV1<'a>>,
) -> LegacyInlineFieldOutcomeV1<'a> {
    outcome(
        field,
        LegacyInlineFieldDispositionV1::Unavailable,
        reason,
        evidence,
    )
}

fn invalid(
    field: LegacyInlineFieldV1,
    reason: LegacyInlineFieldReasonV1,
) -> LegacyInlineFieldOutcomeV1<'static> {
    outcome(field, LegacyInlineFieldDispositionV1::Invalid, reason, None)
}

fn outcome<'a>(
    field: LegacyInlineFieldV1,
    disposition: LegacyInlineFieldDispositionV1,
    reason: LegacyInlineFieldReasonV1,
    evidence: Option<LegacyInlineEvidenceV1<'a>>,
) -> LegacyInlineFieldOutcomeV1<'a> {
    debug_assert!(disposition != LegacyInlineFieldDispositionV1::Exact || evidence.is_some());
    LegacyInlineFieldOutcomeV1 {
        field,
        disposition,
        reason,
        evidence,
    }
}

fn invalid_issue(
    field: LegacyInlineFieldV1,
    issue: value::ValueIssue,
) -> LegacyInlineFieldOutcomeV1<'static> {
    let reason = match issue {
        value::ValueIssue::Missing => LegacyInlineFieldReasonV1::MapFieldMissing,
        value::ValueIssue::Shape => LegacyInlineFieldReasonV1::UnexpectedJsonShape,
        value::ValueIssue::Keyword => LegacyInlineFieldReasonV1::UnsupportedKeyword,
        value::ValueIssue::Numeric(error) => LegacyInlineFieldReasonV1::InvalidNumeric(error),
    };
    invalid(field, reason)
}

#[cfg(test)]
mod tests;
