use std::fmt;

use rito_style_contract::{
    AlignmentBaseline, BaselineShift, BaselineSource, BorderRadii, BorderStyle, CssPx,
    FontFamilies, FontSlant, FontWeight, InlineStyleTableV1, LanguageTag, LengthPercentage,
    LengthPercentageOrAuto, LineBreak, LineHeight, NonNegativeCssPx, NonNegativeLengthPercentage,
    NumericError, OverflowWrap, PhysicalSides, TextAlign, TextDecorationLines, TextDecorationStyle,
    TextIndent, TextJustify, TextTransform, TextWrapMode, UnitInterval, WhiteSpaceCollapse,
    WordBreak,
};

/// One leaf or compound field in `InlineFormattingStyleV1`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LegacyInlineFieldV1 {
    FontFamilies,
    FontIsSystem,
    FontIsInitial,
    FontSize,
    FontWeight,
    FontSlant,
    LineHeight,
    TextAlign,
    TextJustify,
    TextTransform,
    WhiteSpaceCollapse,
    TextWrapMode,
    WordBreak,
    LineBreak,
    OverflowWrap,
    LetterSpacing,
    WordSpacing,
    TextIndent,
    Language,
    Direction,
    UnicodeBidi,
    WritingMode,
    Margin,
    Padding,
    Border,
    BorderRadii,
    AlignmentBaseline,
    BaselineSource,
    BaselineShift,
    Foreground,
    Opacity,
    Background,
    TextDecoration,
    TextShadows,
    BoxShadows,
}

impl LegacyInlineFieldV1 {
    pub const ALL: [Self; 35] = [
        Self::FontFamilies,
        Self::FontIsSystem,
        Self::FontIsInitial,
        Self::FontSize,
        Self::FontWeight,
        Self::FontSlant,
        Self::LineHeight,
        Self::TextAlign,
        Self::TextJustify,
        Self::TextTransform,
        Self::WhiteSpaceCollapse,
        Self::TextWrapMode,
        Self::WordBreak,
        Self::LineBreak,
        Self::OverflowWrap,
        Self::LetterSpacing,
        Self::WordSpacing,
        Self::TextIndent,
        Self::Language,
        Self::Direction,
        Self::UnicodeBidi,
        Self::WritingMode,
        Self::Margin,
        Self::Padding,
        Self::Border,
        Self::BorderRadii,
        Self::AlignmentBaseline,
        Self::BaselineSource,
        Self::BaselineShift,
        Self::Foreground,
        Self::Opacity,
        Self::Background,
        Self::TextDecoration,
        Self::TextShadows,
        Self::BoxShadows,
    ];
}

/// Whether one legacy value is eligible for a complete contract style.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LegacyInlineFieldDispositionV1 {
    /// The borrowed map value has one lossless representation in this field.
    /// This does not certify the legacy parser or cascade as standards-correct.
    Exact,
    /// Typed evidence exists, but legacy parsing or provenance changed meaning.
    LegacyPolicy,
    /// The map lacks enough information to construct the contract field.
    Unavailable,
    /// The map contains a missing, malformed, or out-of-range value.
    Invalid,
}

/// Stable explanation for a field disposition.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LegacyInlineFieldReasonV1 {
    ExactMapValue,
    NumericNarrowing,
    LegacyParserPolicy,
    LegacyShorthandCollapsed,
    LegacyProvenanceLost,
    ContractFieldMissing,
    ColorNotComputed,
    ResolvedStyleMissing,
    ResolvedStyleDuplicate,
    ProjectionBudgetExceeded,
    MapFieldMissing,
    UnexpectedJsonShape,
    UnsupportedKeyword,
    InvalidNumeric(NumericError),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyFontFamiliesEvidenceV1<'a> {
    pub raw: &'a str,
    pub parsed: Option<FontFamilies>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LegacyBorderEdgeGeometryV1<'a> {
    pub resolved_width: NonNegativeCssPx,
    pub style: BorderStyle,
    pub raw_color: &'a str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LegacyBorderGeometryV1<'a> {
    pub top: LegacyBorderEdgeGeometryV1<'a>,
    pub right: LegacyBorderEdgeGeometryV1<'a>,
    pub bottom: LegacyBorderEdgeGeometryV1<'a>,
    pub left: LegacyBorderEdgeGeometryV1<'a>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LegacyTextDecorationGeometryV1<'a> {
    pub lines: TextDecorationLines,
    pub style: TextDecorationStyle,
    pub raw_color: &'a str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LegacyTextShadowGeometryV1<'a> {
    pub offset_x: CssPx,
    pub offset_y: CssPx,
    pub blur_radius: NonNegativeCssPx,
    pub raw_color: &'a str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LegacyBoxShadowGeometryV1<'a> {
    pub offset_x: CssPx,
    pub offset_y: CssPx,
    pub blur_radius: NonNegativeCssPx,
    pub spread_radius: CssPx,
    pub raw_color: &'a str,
    pub inset: bool,
}

/// Typed evidence retained even when the containing field is not exact.
///
/// Evidence on a policy or unavailable outcome is diagnostic only and is
/// never used to assemble or intern an `InlineFormattingStyleV1`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LegacyInlineEvidenceV1<'a> {
    RawString(&'a str),
    FontFamilies(LegacyFontFamiliesEvidenceV1<'a>),
    NonNegativeCssPx(NonNegativeCssPx),
    FontWeight(FontWeight),
    FontSlant(FontSlant),
    LineHeight(LineHeight),
    TextAlign(TextAlign),
    TextJustify(TextJustify),
    TextTransform(TextTransform),
    WhiteSpaceCollapse(WhiteSpaceCollapse),
    TextWrapMode(TextWrapMode),
    WordBreak(WordBreak),
    LineBreak(LineBreak),
    OverflowWrap(OverflowWrap),
    LengthPercentage(LengthPercentage),
    TextIndent(TextIndent),
    Language(Option<LanguageTag>),
    Margins(PhysicalSides<LengthPercentageOrAuto>),
    Padding(PhysicalSides<NonNegativeLengthPercentage>),
    BorderGeometry(LegacyBorderGeometryV1<'a>),
    BorderRadii(BorderRadii),
    AlignmentBaseline(AlignmentBaseline),
    BaselineSource(BaselineSource),
    BaselineShift(BaselineShift),
    UnitInterval(UnitInterval),
    TextDecorationGeometry(LegacyTextDecorationGeometryV1<'a>),
    TextShadowGeometry(Box<[LegacyTextShadowGeometryV1<'a>]>),
    BoxShadowGeometry(Box<[LegacyBoxShadowGeometryV1<'a>]>),
}

/// One lazily produced field-ledger entry.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyInlineFieldOutcomeV1<'a> {
    pub field: LegacyInlineFieldV1,
    pub disposition: LegacyInlineFieldDispositionV1,
    pub reason: LegacyInlineFieldReasonV1,
    pub evidence: Option<LegacyInlineEvidenceV1<'a>>,
}

/// Strict contract table plus a source-element ledger in document order.
pub struct LegacyInlineStyleProjectionV1<'a> {
    pub(super) table: InlineStyleTableV1,
    pub(super) dispositions: Vec<super::LegacyInlineNodeDispositionV1<'a>>,
}

impl fmt::Debug for LegacyInlineStyleProjectionV1<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LegacyInlineStyleProjectionV1")
            .field("node_count", &self.table.node_count())
            .field("style_count", &self.table.style_count())
            .field("disposition_count", &self.dispositions.len())
            .field(
                "contract_projected_element_count",
                &self.contract_projected_element_count(),
            )
            .field(
                "contract_rejected_element_count",
                &self.contract_rejected_element_count(),
            )
            .finish()
    }
}

impl<'a> LegacyInlineStyleProjectionV1<'a> {
    pub fn table(&self) -> &InlineStyleTableV1 {
        &self.table
    }

    pub fn dispositions(&self) -> &[super::LegacyInlineNodeDispositionV1<'a>] {
        &self.dispositions
    }

    pub fn contract_projected_element_count(&self) -> usize {
        self.dispositions
            .iter()
            .filter(|entry| entry.style_id().is_some())
            .count()
    }

    pub fn contract_rejected_element_count(&self) -> usize {
        self.dispositions.len() - self.contract_projected_element_count()
    }

    pub fn is_contract_slice_complete(&self) -> bool {
        self.contract_projected_element_count() == self.dispositions.len()
    }
}
