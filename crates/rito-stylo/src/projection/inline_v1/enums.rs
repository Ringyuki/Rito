use rito_style_contract::{
    Direction, InlineBidiV1, LineBreak, OverflowWrap, TextAlign, TextJustify, TextTransform,
    TextWrapMode, UnicodeBidi, WhiteSpaceCollapse, WordBreak, WritingMode,
};
use style::properties::ComputedValues;

pub(super) fn bidi(styles: &ComputedValues) -> InlineBidiV1 {
    let inherited_box = styles.get_inherited_box();
    InlineBidiV1 {
        direction: direction(inherited_box.direction),
        unicode_bidi: unicode_bidi(styles.get_text().unicode_bidi),
        writing_mode: writing_mode(inherited_box.writing_mode),
    }
}

fn direction(value: style::properties::longhands::direction::computed_value::T) -> Direction {
    use style::properties::longhands::direction::computed_value::T;

    match value {
        T::Ltr => Direction::LeftToRight,
        T::Rtl => Direction::RightToLeft,
    }
}

fn unicode_bidi(
    value: style::properties::longhands::unicode_bidi::computed_value::T,
) -> UnicodeBidi {
    use style::properties::longhands::unicode_bidi::computed_value::T;

    match value {
        T::Normal => UnicodeBidi::Normal,
        T::Embed => UnicodeBidi::Embed,
        T::Isolate => UnicodeBidi::Isolate,
        T::BidiOverride => UnicodeBidi::BidiOverride,
        T::IsolateOverride => UnicodeBidi::IsolateOverride,
        T::Plaintext => UnicodeBidi::Plaintext,
    }
}

fn writing_mode(value: style::logical_geometry::WritingModeProperty) -> WritingMode {
    use style::logical_geometry::WritingModeProperty;

    match value {
        WritingModeProperty::HorizontalTb => WritingMode::HorizontalTopToBottom,
        WritingModeProperty::VerticalRl => WritingMode::VerticalRightToLeft,
        WritingModeProperty::VerticalLr => WritingMode::VerticalLeftToRight,
    }
}

pub(super) fn text_align(value: style::values::computed::TextAlign) -> TextAlign {
    use style::values::computed::TextAlign;

    match value {
        TextAlign::Start => rito_style_contract::TextAlign::Start,
        TextAlign::Left => rito_style_contract::TextAlign::Left,
        TextAlign::Right => rito_style_contract::TextAlign::Right,
        TextAlign::Center => rito_style_contract::TextAlign::Center,
        TextAlign::Justify => rito_style_contract::TextAlign::Justify,
        TextAlign::End => rito_style_contract::TextAlign::End,
        TextAlign::MozCenter => rito_style_contract::TextAlign::MozCenter,
        TextAlign::MozLeft => rito_style_contract::TextAlign::MozLeft,
        TextAlign::MozRight => rito_style_contract::TextAlign::MozRight,
    }
}

pub(super) fn text_justify(value: style::values::computed::TextJustify) -> TextJustify {
    use style::values::computed::TextJustify;

    match value {
        TextJustify::Auto => rito_style_contract::TextJustify::Auto,
        TextJustify::None => rito_style_contract::TextJustify::None,
        TextJustify::InterWord => rito_style_contract::TextJustify::InterWord,
        TextJustify::InterCharacter => rito_style_contract::TextJustify::InterCharacter,
    }
}

pub(super) fn text_transform(value: style::values::computed::TextTransform) -> TextTransform {
    use style::values::{computed::TextTransform, specified::text::TextTransformCase};

    let case = match value.case() {
        TextTransformCase::None => rito_style_contract::TextTransformCase::None,
        TextTransformCase::Uppercase => rito_style_contract::TextTransformCase::Uppercase,
        TextTransformCase::Lowercase => rito_style_contract::TextTransformCase::Lowercase,
        TextTransformCase::Capitalize => rito_style_contract::TextTransformCase::Capitalize,
    };
    rito_style_contract::TextTransform {
        case,
        full_width: value.contains(TextTransform::FULL_WIDTH),
        full_size_kana: value.contains(TextTransform::FULL_SIZE_KANA),
    }
}

pub(super) fn white_space_collapse(
    value: style::properties::longhands::white_space_collapse::computed_value::T,
) -> WhiteSpaceCollapse {
    use style::properties::longhands::white_space_collapse::computed_value::T;

    match value {
        T::Collapse => WhiteSpaceCollapse::Collapse,
        T::Preserve => WhiteSpaceCollapse::Preserve,
        T::PreserveBreaks => WhiteSpaceCollapse::PreserveBreaks,
        T::BreakSpaces => WhiteSpaceCollapse::BreakSpaces,
    }
}

pub(super) fn text_wrap_mode(
    value: style::properties::longhands::text_wrap_mode::computed_value::T,
) -> TextWrapMode {
    use style::properties::longhands::text_wrap_mode::computed_value::T;

    match value {
        T::Wrap => TextWrapMode::Wrap,
        T::Nowrap => TextWrapMode::NoWrap,
    }
}

pub(super) fn word_break(value: style::values::computed::WordBreak) -> WordBreak {
    use style::values::computed::WordBreak;

    match value {
        WordBreak::Normal => rito_style_contract::WordBreak::Normal,
        WordBreak::BreakAll => rito_style_contract::WordBreak::BreakAll,
        WordBreak::KeepAll => rito_style_contract::WordBreak::KeepAll,
    }
}

pub(super) fn line_break(value: style::values::computed::LineBreak) -> LineBreak {
    use style::values::computed::LineBreak;

    match value {
        LineBreak::Auto => rito_style_contract::LineBreak::Auto,
        LineBreak::Loose => rito_style_contract::LineBreak::Loose,
        LineBreak::Normal => rito_style_contract::LineBreak::Normal,
        LineBreak::Strict => rito_style_contract::LineBreak::Strict,
        LineBreak::Anywhere => rito_style_contract::LineBreak::Anywhere,
    }
}

pub(super) fn overflow_wrap(value: style::values::computed::OverflowWrap) -> OverflowWrap {
    use style::values::computed::OverflowWrap;

    match value {
        OverflowWrap::Normal => rito_style_contract::OverflowWrap::Normal,
        OverflowWrap::BreakWord => rito_style_contract::OverflowWrap::BreakWord,
        OverflowWrap::Anywhere => rito_style_contract::OverflowWrap::Anywhere,
    }
}
