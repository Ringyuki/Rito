use rito_style_contract::{InlineTextFlowV1, LanguageTag, TextIndent};
use style::properties::ComputedValues;

use crate::dom::DomNode;

use super::{enums, numeric, InlineStyleFieldV1, ProjectionResult};

pub(super) fn project(
    styles: &ComputedValues,
    language: Option<LanguageTag>,
) -> ProjectionResult<InlineTextFlowV1> {
    let text = styles.get_inherited_text();
    let text_indent = &text.text_indent;
    Ok(InlineTextFlowV1 {
        text_align: enums::text_align(text.text_align),
        text_justify: enums::text_justify(text.text_justify),
        text_transform: enums::text_transform(text.text_transform),
        white_space_collapse: enums::white_space_collapse(text.white_space_collapse),
        text_wrap_mode: enums::text_wrap_mode(text.text_wrap_mode),
        word_break: enums::word_break(text.word_break),
        line_break: enums::line_break(text.line_break),
        overflow_wrap: enums::overflow_wrap(text.overflow_wrap),
        letter_spacing: numeric::length_percentage(
            &text.letter_spacing.0,
            InlineStyleFieldV1::LetterSpacing,
        )?,
        word_spacing: numeric::length_percentage(
            &text.word_spacing,
            InlineStyleFieldV1::WordSpacing,
        )?,
        text_indent: TextIndent {
            value: numeric::length_percentage(&text_indent.length, InlineStyleFieldV1::TextIndent)?,
            hanging: text_indent.hanging,
            each_line: text_indent.each_line,
        },
        ruby_align: crate::break_properties::project_ruby_align(styles),
        language,
    })
}

pub(super) fn inherited_language(element: DomNode<'_>) -> Option<LanguageTag> {
    element.inherited_language_tag().cloned()
}
