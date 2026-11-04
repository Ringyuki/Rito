use std::sync::Arc;

use crate::{ComputedColor, LengthPercentage};

/// Inline/base direction used for logical ordering.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Direction {
    /// Left to right.
    LeftToRight,
    /// Right to left.
    RightToLeft,
}

/// Computed writing mode before logical-to-physical geometry conversion.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum WritingMode {
    /// Horizontal lines progressing from top to bottom.
    HorizontalTopToBottom,
    /// Vertical lines progressing from right to left.
    VerticalRightToLeft,
    /// Vertical lines progressing from left to right.
    VerticalLeftToRight,
}

/// Computed `text-orientation` (css-writing-modes-3 §5.1): how the
/// characters of a vertical line stand.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TextOrientation {
    /// Characters whose Unicode vertical orientation is upright stand
    /// upright; the rest lie sideways.
    Mixed,
    /// Every character stands upright.
    Upright,
    /// Every character lies sideways, as in a horizontal line turned a
    /// quarter clockwise.
    Sideways,
}

/// Computed `text-combine-upright` (css-writing-modes-3 §9.1).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TextCombineUpright {
    /// Characters set one by one along the line.
    None,
    /// The element's text sets horizontally within a single advance of
    /// a vertical line.
    All,
}

/// Unicode bidi control for an element.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum UnicodeBidi {
    /// No additional embedding or isolation.
    Normal,
    /// Create an embedding level.
    Embed,
    /// Isolate the element from surrounding bidi content.
    Isolate,
    /// Override the bidi algorithm inside the element.
    BidiOverride,
    /// Combine isolation with directional override.
    IsolateOverride,
    /// Determine direction solely from the element's content.
    Plaintext,
}

/// Computed text alignment, retaining logical and Servo-compatible values.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TextAlign {
    /// Logical line start.
    Start,
    /// Physical left.
    Left,
    /// Physical right.
    Right,
    /// Centered text.
    Center,
    /// Justified text.
    Justify,
    /// Logical line end.
    End,
    /// Servo-compatible centered internal value.
    MozCenter,
    /// Servo-compatible left internal value.
    MozLeft,
    /// Servo-compatible right internal value.
    MozRight,
}

/// Computed `ruby-align`: how ruby annotation and base content
/// distribute across the ruby column's extent.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum RubyAlign {
    /// The initial value: content spreads with one justification share
    /// per glyph, half a share at each edge.
    SpaceAround,
    /// Content packs at the line-start edge.
    Start,
    /// Content packs centered.
    Center,
    /// Content spreads with shares only between glyphs, none at the
    /// edges.
    SpaceBetween,
}

/// Computed `text-emphasis`: the mark every character that takes one
/// receives, the side of its line the marks stand on and their color.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct TextEmphasis {
    /// The mark: a shape keyword's character (its `filled` or `open`
    /// form, the shape `auto` resolving by typographic mode), or the
    /// custom string.
    pub mark: Arc<str>,
    /// The side of the line the marks stand on.
    pub side: LineSide,
    /// Computed mark color with `currentColor` retained symbolically.
    pub color: ComputedColor,
}

/// A line-relative side: `Over` is the ascent side of a horizontal line
/// and the right of a vertical one (`vertical-lr` included), `Under` the
/// other.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LineSide {
    /// The line-over side.
    Over,
    /// The line-under side.
    Under,
}

/// Computed text justification strategy.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TextJustify {
    /// User-agent strategy.
    Auto,
    /// Disable justification opportunities.
    None,
    /// Adjust inter-word spacing.
    InterWord,
    /// Adjust inter-character spacing.
    InterCharacter,
}

/// Case transform component of `text-transform`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TextTransformCase {
    /// Preserve case.
    None,
    /// Convert to uppercase.
    Uppercase,
    /// Convert to lowercase.
    Lowercase,
    /// Capitalize words.
    Capitalize,
}

/// Computed `text-transform` longhand state.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct TextTransform {
    /// The case transformation.
    pub case: TextTransformCase,
    /// Whether full-width mapping is requested.
    pub full_width: bool,
    /// Whether small kana map to full-size kana.
    pub full_size_kana: bool,
}

/// White-space collapsing behavior.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum WhiteSpaceCollapse {
    /// Collapse segment breaks and spaces.
    Collapse,
    /// Preserve segment breaks and spaces.
    Preserve,
    /// Preserve breaks while collapsing other spaces.
    PreserveBreaks,
    /// Preserve spaces with `break-spaces` behavior.
    BreakSpaces,
}

/// Whether text may wrap.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TextWrapMode {
    /// Permit wrapping.
    Wrap,
    /// Suppress wrapping.
    NoWrap,
}

/// Word-breaking behavior.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum WordBreak {
    /// Normal Unicode word breaking.
    Normal,
    /// Permit breaks between any characters where required.
    BreakAll,
    /// Suppress breaks within CJK words.
    KeepAll,
}

/// Line-breaking strictness.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LineBreak {
    /// User-agent-selected behavior.
    Auto,
    /// Loose line-breaking rules.
    Loose,
    /// Normal line-breaking rules.
    Normal,
    /// Strict line-breaking rules.
    Strict,
    /// Permit a break around every typographic character unit.
    Anywhere,
}

/// Emergency wrapping behavior for otherwise unbreakable text.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum OverflowWrap {
    /// Break only at normal opportunities.
    Normal,
    /// Allow emergency breaks without adding min-content opportunities.
    BreakWord,
    /// Allow emergency breaks and include them in min-content sizing.
    Anywhere,
}

/// A computed `text-indent` value and its behavioral flags.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct TextIndent {
    /// Indentation resolved against the containing block's inline size.
    pub value: LengthPercentage,
    /// Apply the indentation to every line except the first.
    pub hanging: bool,
    /// Apply indentation after forced line breaks as well as the first line.
    pub each_line: bool,
}

/// An inherited language tag supplied by the source semantics layer.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct LanguageTag(Arc<str>);

impl LanguageTag {
    /// Wraps an already parsed language tag using ASCII case canonicalization.
    ///
    /// This does not perform full BCP-47 validation or preferred-subtag
    /// replacement; it only removes case-only interning differences.
    pub fn new(tag: impl Into<String>) -> Self {
        let mut tag = tag.into();
        tag.make_ascii_lowercase();
        Self(Arc::from(tag))
    }

    /// Returns the tag text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Reports whether the source language was explicitly reset to empty.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn storage_identity(&self) -> usize {
        self.0.as_ptr() as usize
    }
}

#[cfg(test)]
mod tests {
    use super::LanguageTag;

    #[test]
    fn language_tag_canonicalizes_ascii_case() {
        assert_eq!(LanguageTag::new("ZH-Hant-TW").as_str(), "zh-hant-tw");
    }
}

/// Text shaping, transformation, spacing, and line-breaking inputs.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct InlineTextFlow {
    /// Alignment applied when inline content is placed into a line box.
    pub text_align: TextAlign,
    /// Justification strategy.
    pub text_justify: TextJustify,
    /// Unicode-aware text transformation request.
    pub text_transform: TextTransform,
    /// White-space collapsing behavior.
    pub white_space_collapse: WhiteSpaceCollapse,
    /// Wrapping mode.
    pub text_wrap_mode: TextWrapMode,
    /// Word-breaking behavior.
    pub word_break: WordBreak,
    /// CJK line-breaking strictness.
    pub line_break: LineBreak,
    /// Emergency wrapping behavior.
    pub overflow_wrap: OverflowWrap,
    /// Letter spacing; percentages resolve against this element's font size.
    pub letter_spacing: LengthPercentage,
    /// Word spacing; percentages resolve against this element's font size.
    pub word_spacing: LengthPercentage,
    /// First-line indentation semantics.
    pub text_indent: TextIndent,
    /// Ruby annotation/base distribution.
    pub ruby_align: RubyAlign,
    /// Emphasis marks, absent for computed `none`.
    pub text_emphasis: Option<TextEmphasis>,
    /// Inherited source language, or `None` when unspecified.
    pub language: Option<LanguageTag>,
}
