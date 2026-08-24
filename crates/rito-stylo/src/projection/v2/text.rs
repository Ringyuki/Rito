#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FontStyleV2 {
    Normal,
    Italic,
    ObliqueDegrees(f32),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TextAlignV2 {
    Start,
    Left,
    Right,
    Center,
    Justify,
    End,
    MozCenter,
    MozLeft,
    MozRight,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TextTransformCaseV2 {
    None,
    Uppercase,
    Lowercase,
    Capitalize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TextTransformV2 {
    pub case: TextTransformCaseV2,
    pub full_width: bool,
    pub full_size_kana: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WhiteSpaceCollapseV2 {
    Collapse,
    Preserve,
    PreserveBreaks,
    BreakSpaces,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TextWrapModeV2 {
    Wrap,
    NoWrap,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WordBreakV2 {
    Normal,
    BreakAll,
    KeepAll,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LineBreakV2 {
    Auto,
    Loose,
    Normal,
    Strict,
    Anywhere,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OverflowWrapV2 {
    Normal,
    BreakWord,
    Anywhere,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnicodeBidiV2 {
    Normal,
    Embed,
    Isolate,
    BidiOverride,
    IsolateOverride,
    Plaintext,
}

pub(super) fn font_style(value: style::values::computed::FontStyle) -> FontStyleV2 {
    use style::values::computed::FontStyle;

    if value == FontStyle::NORMAL {
        FontStyleV2::Normal
    } else if value == FontStyle::ITALIC {
        FontStyleV2::Italic
    } else {
        FontStyleV2::ObliqueDegrees(value.oblique_degrees())
    }
}

pub(super) fn text_align(value: style::values::computed::TextAlign) -> TextAlignV2 {
    use style::values::computed::TextAlign;

    match value {
        TextAlign::Start => TextAlignV2::Start,
        TextAlign::Left => TextAlignV2::Left,
        TextAlign::Right => TextAlignV2::Right,
        TextAlign::Center => TextAlignV2::Center,
        TextAlign::Justify => TextAlignV2::Justify,
        TextAlign::End => TextAlignV2::End,
        TextAlign::MozCenter => TextAlignV2::MozCenter,
        TextAlign::MozLeft => TextAlignV2::MozLeft,
        TextAlign::MozRight => TextAlignV2::MozRight,
    }
}

pub(super) fn text_transform(value: style::values::computed::TextTransform) -> TextTransformV2 {
    use style::values::{computed::TextTransform, specified::text::TextTransformCase};

    let case = match value.case() {
        TextTransformCase::None => TextTransformCaseV2::None,
        TextTransformCase::Uppercase => TextTransformCaseV2::Uppercase,
        TextTransformCase::Lowercase => TextTransformCaseV2::Lowercase,
        TextTransformCase::Capitalize => TextTransformCaseV2::Capitalize,
    };
    TextTransformV2 {
        case,
        full_width: value.contains(TextTransform::FULL_WIDTH),
        full_size_kana: value.contains(TextTransform::FULL_SIZE_KANA),
    }
}

pub(super) fn white_space_collapse(
    value: style::properties::longhands::white_space_collapse::computed_value::T,
) -> WhiteSpaceCollapseV2 {
    use style::properties::longhands::white_space_collapse::computed_value::T;

    match value {
        T::Collapse => WhiteSpaceCollapseV2::Collapse,
        T::Preserve => WhiteSpaceCollapseV2::Preserve,
        T::PreserveBreaks => WhiteSpaceCollapseV2::PreserveBreaks,
        T::BreakSpaces => WhiteSpaceCollapseV2::BreakSpaces,
    }
}

pub(super) fn text_wrap_mode(
    value: style::properties::longhands::text_wrap_mode::computed_value::T,
) -> TextWrapModeV2 {
    use style::properties::longhands::text_wrap_mode::computed_value::T;

    match value {
        T::Wrap => TextWrapModeV2::Wrap,
        T::Nowrap => TextWrapModeV2::NoWrap,
    }
}

pub(super) fn word_break(value: style::values::computed::WordBreak) -> WordBreakV2 {
    use style::values::computed::WordBreak;

    match value {
        WordBreak::Normal => WordBreakV2::Normal,
        WordBreak::BreakAll => WordBreakV2::BreakAll,
        WordBreak::KeepAll => WordBreakV2::KeepAll,
    }
}

pub(super) fn line_break(value: style::values::computed::LineBreak) -> LineBreakV2 {
    use style::values::computed::LineBreak;

    match value {
        LineBreak::Auto => LineBreakV2::Auto,
        LineBreak::Loose => LineBreakV2::Loose,
        LineBreak::Normal => LineBreakV2::Normal,
        LineBreak::Strict => LineBreakV2::Strict,
        LineBreak::Anywhere => LineBreakV2::Anywhere,
    }
}

pub(super) fn overflow_wrap(value: style::values::computed::OverflowWrap) -> OverflowWrapV2 {
    use style::values::computed::OverflowWrap;

    match value {
        OverflowWrap::Normal => OverflowWrapV2::Normal,
        OverflowWrap::BreakWord => OverflowWrapV2::BreakWord,
        OverflowWrap::Anywhere => OverflowWrapV2::Anywhere,
    }
}

pub(super) fn unicode_bidi(
    value: style::properties::longhands::unicode_bidi::computed_value::T,
) -> UnicodeBidiV2 {
    use style::properties::longhands::unicode_bidi::computed_value::T;

    match value {
        T::Normal => UnicodeBidiV2::Normal,
        T::Embed => UnicodeBidiV2::Embed,
        T::Isolate => UnicodeBidiV2::Isolate,
        T::BidiOverride => UnicodeBidiV2::BidiOverride,
        T::IsolateOverride => UnicodeBidiV2::IsolateOverride,
        T::Plaintext => UnicodeBidiV2::Plaintext,
    }
}
