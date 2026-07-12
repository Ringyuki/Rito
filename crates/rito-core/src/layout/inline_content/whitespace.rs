use serde_json::{Map, Value};

use crate::style::StyledNode;

use super::super::{style_values::string_style, text_mapping::TextSourceBasis};

#[derive(Debug, Default)]
pub(in crate::layout) struct WhitespaceCollapseState {
    previous_ended_with_space: bool,
}

pub(super) struct NormalizedText {
    pub(super) text: String,
    pub(super) source_text: String,
    pub(super) source_text_offset: usize,
    pub(super) source_basis: TextSourceBasis,
}

pub(super) fn normalize_text_for_white_space(
    node: &StyledNode,
    style: &Map<String, Value>,
    whitespace: &mut WhitespaceCollapseState,
) -> NormalizedText {
    let content = node.content.as_deref().unwrap_or_default();
    let preserve = matches!(
        string_style(style, "whiteSpace").as_deref(),
        Some("pre" | "pre-wrap")
    );
    let restored_parser_whitespace = preserve && node.source_text.is_some();
    let source_text = if preserve {
        node.source_text.as_deref().unwrap_or(content)
    } else {
        content
    };
    let mut text = source_text;
    let mut source_text_offset = 0;
    let forced_break = content == "\n" && node.source_text.is_none();
    if !preserve && !forced_break && whitespace.previous_ended_with_space && text.starts_with(' ') {
        text = &text[1..];
        source_text_offset = 1;
    }

    if preserve || forced_break {
        whitespace.previous_ended_with_space = false;
    } else if !text.is_empty() {
        whitespace.previous_ended_with_space = text.ends_with(' ');
    }

    NormalizedText {
        text: text.to_owned(),
        source_text: source_text.to_owned(),
        source_text_offset,
        source_basis: if restored_parser_whitespace {
            TextSourceBasis::RestoredParserWhitespace
        } else {
            TextSourceBasis::ParsedText
        },
    }
}

pub(super) fn reset_whitespace_after_atom(whitespace: &mut WhitespaceCollapseState) {
    whitespace.previous_ended_with_space = false;
}
