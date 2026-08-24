use rito_style_contract::{
    FontSlant, LanguageTag, LineBreak, LineHeight, OverflowWrap, TextAlign, TextIndent,
    TextJustify, TextTransform, TextTransformCase, TextWrapMode, WhiteSpaceCollapse, WordBreak,
    INLINE_STYLE_LIST_ITEM_LIMIT_V1,
};
use serde_json::{Map, Value};

use super::{
    exact, invalid, invalid_issue, policy, unavailable, value, LegacyFontFamiliesEvidenceV1,
    LegacyInlineEvidenceV1 as Evidence, LegacyInlineFieldOutcomeV1 as Outcome,
    LegacyInlineFieldReasonV1 as Reason, LegacyInlineFieldV1 as Field,
};

pub(super) fn project<'a>(style: &'a Map<String, Value>, field: Field) -> Outcome<'a> {
    match field {
        Field::FontFamilies => font_families(style),
        Field::FontIsSystem | Field::FontIsInitial => {
            unavailable(field, Reason::LegacyProvenanceLost, None)
        }
        Field::FontSize => font_size(style),
        Field::FontWeight => font_weight(style),
        Field::FontSlant => font_slant(style),
        Field::LineHeight => line_height(style),
        Field::TextAlign => text_align(style),
        Field::TextJustify => text_justify(style),
        Field::TextTransform => text_transform(style),
        Field::WhiteSpaceCollapse | Field::TextWrapMode => white_space(style, field),
        Field::WordBreak => word_break(style),
        Field::LineBreak => line_break(style),
        Field::OverflowWrap => overflow_wrap(style),
        Field::LetterSpacing => spacing(style, field, "letterSpacing"),
        Field::WordSpacing => spacing(style, field, "wordSpacing"),
        Field::TextIndent => text_indent(style),
        Field::Language => language(style),
        Field::Direction | Field::UnicodeBidi | Field::WritingMode => {
            unavailable(field, Reason::ContractFieldMissing, None)
        }
        _ => unreachable!("font/text projector received non-text field"),
    }
}

fn font_families(style: &Map<String, Value>) -> Outcome<'_> {
    let raw = match value::string(style, "fontFamily") {
        Ok(value) if !value.trim().is_empty() => value,
        Ok(_) => return invalid(Field::FontFamilies, Reason::UnexpectedJsonShape),
        Err(issue) => return invalid_issue(Field::FontFamilies, issue),
    };
    let item_count = value::font_family_item_count(raw);
    if item_count.is_some_and(|count| count > INLINE_STYLE_LIST_ITEM_LIMIT_V1) {
        return unavailable(
            Field::FontFamilies,
            Reason::ProjectionBudgetExceeded,
            Some(Evidence::FontFamilies(LegacyFontFamiliesEvidenceV1 {
                raw,
                parsed: None,
            })),
        );
    }
    let parsed = item_count.and_then(|_| value::parsed_font_families(raw));
    let has_parsed = parsed.is_some();
    let evidence = Evidence::FontFamilies(LegacyFontFamiliesEvidenceV1 { raw, parsed });
    if has_parsed {
        policy(Field::FontFamilies, Reason::LegacyProvenanceLost, evidence)
    } else {
        unavailable(
            Field::FontFamilies,
            Reason::LegacyParserPolicy,
            Some(evidence),
        )
    }
}

fn font_size(style: &Map<String, Value>) -> Outcome<'_> {
    match value::non_negative_css_px(style, "fontSize") {
        Ok(number) if number.exact_f32 => {
            exact(Field::FontSize, Evidence::NonNegativeCssPx(number.value))
        }
        Ok(number) => policy(
            Field::FontSize,
            Reason::NumericNarrowing,
            Evidence::NonNegativeCssPx(number.value),
        ),
        Err(issue) => invalid_issue(Field::FontSize, issue),
    }
}

fn font_weight(style: &Map<String, Value>) -> Outcome<'_> {
    match value::font_weight(style, "fontWeight") {
        Ok(number) if number.exact_f32 => {
            exact(Field::FontWeight, Evidence::FontWeight(number.value))
        }
        Ok(number) => policy(
            Field::FontWeight,
            Reason::NumericNarrowing,
            Evidence::FontWeight(number.value),
        ),
        Err(issue) => invalid_issue(Field::FontWeight, issue),
    }
}

fn font_slant(style: &Map<String, Value>) -> Outcome<'_> {
    let slant = match value::string(style, "fontStyle") {
        Ok("normal") => FontSlant::Normal,
        Ok("italic") => FontSlant::Italic,
        Ok(_) => return invalid_issue(Field::FontSlant, value::ValueIssue::Keyword),
        Err(issue) => return invalid_issue(Field::FontSlant, issue),
    };
    policy(
        Field::FontSlant,
        Reason::LegacyParserPolicy,
        Evidence::FontSlant(slant),
    )
}

fn line_height(style: &Map<String, Value>) -> Outcome<'_> {
    let projected = if style.contains_key("lineHeightPx") {
        value::non_negative_css_px(style, "lineHeightPx")
            .map(|number| LineHeight::Length(number.value))
    } else {
        value::non_negative_number(style, "lineHeight")
            .map(|number| LineHeight::Number(number.value))
    };
    match projected {
        Ok(value) => policy(
            Field::LineHeight,
            Reason::LegacyProvenanceLost,
            Evidence::LineHeight(value),
        ),
        Err(issue) => invalid_issue(Field::LineHeight, issue),
    }
}

fn text_align(style: &Map<String, Value>) -> Outcome<'_> {
    let value = match value::string(style, "textAlign") {
        Ok("left") => TextAlign::Left,
        Ok("right") => TextAlign::Right,
        Ok("center") => TextAlign::Center,
        Ok("justify") => TextAlign::Justify,
        Ok(_) => return invalid_issue(Field::TextAlign, value::ValueIssue::Keyword),
        Err(issue) => return invalid_issue(Field::TextAlign, issue),
    };
    policy(
        Field::TextAlign,
        Reason::LegacyParserPolicy,
        Evidence::TextAlign(value),
    )
}

fn text_justify(style: &Map<String, Value>) -> Outcome<'_> {
    let value = match value::string(style, "textJustify") {
        Ok("auto") => TextJustify::Auto,
        Ok("none") => TextJustify::None,
        Ok("inter-word") => TextJustify::InterWord,
        Ok("inter-character") => TextJustify::InterCharacter,
        Ok(_) => return invalid_issue(Field::TextJustify, value::ValueIssue::Keyword),
        Err(issue) => return invalid_issue(Field::TextJustify, issue),
    };
    if value == TextJustify::InterCharacter {
        policy(
            Field::TextJustify,
            Reason::LegacyParserPolicy,
            Evidence::TextJustify(value),
        )
    } else {
        exact(Field::TextJustify, Evidence::TextJustify(value))
    }
}

fn text_transform(style: &Map<String, Value>) -> Outcome<'_> {
    let case = match value::string(style, "textTransform") {
        Ok("none") => TextTransformCase::None,
        Ok("uppercase") => TextTransformCase::Uppercase,
        Ok("lowercase") => TextTransformCase::Lowercase,
        Ok("capitalize") => TextTransformCase::Capitalize,
        Ok(_) => return invalid_issue(Field::TextTransform, value::ValueIssue::Keyword),
        Err(issue) => return invalid_issue(Field::TextTransform, issue),
    };
    unavailable(
        Field::TextTransform,
        Reason::ContractFieldMissing,
        Some(Evidence::TextTransform(TextTransform {
            case,
            full_width: false,
            full_size_kana: false,
        })),
    )
}

fn white_space(style: &Map<String, Value>, field: Field) -> Outcome<'_> {
    let (collapse, wrap) = match value::string(style, "whiteSpace") {
        Ok("normal") => (WhiteSpaceCollapse::Collapse, TextWrapMode::Wrap),
        Ok("pre") => (WhiteSpaceCollapse::Preserve, TextWrapMode::NoWrap),
        Ok("pre-wrap") => (WhiteSpaceCollapse::Preserve, TextWrapMode::Wrap),
        Ok("nowrap") => (WhiteSpaceCollapse::Collapse, TextWrapMode::NoWrap),
        Ok(_) => return invalid_issue(field, value::ValueIssue::Keyword),
        Err(issue) => return invalid_issue(field, issue),
    };
    let evidence = match field {
        Field::WhiteSpaceCollapse => Evidence::WhiteSpaceCollapse(collapse),
        Field::TextWrapMode => Evidence::TextWrapMode(wrap),
        _ => unreachable!(),
    };
    policy(field, Reason::LegacyShorthandCollapsed, evidence)
}

fn word_break(style: &Map<String, Value>) -> Outcome<'_> {
    let (value, lossy) = match value::string(style, "wordBreak") {
        Ok("normal") => (WordBreak::Normal, false),
        Ok("break-all") => (WordBreak::BreakAll, false),
        Ok("keep-all") => (WordBreak::KeepAll, false),
        Ok("break-word") => (WordBreak::Normal, true),
        Ok(_) => return invalid_issue(Field::WordBreak, value::ValueIssue::Keyword),
        Err(issue) => return invalid_issue(Field::WordBreak, issue),
    };
    if lossy {
        policy(
            Field::WordBreak,
            Reason::LegacyShorthandCollapsed,
            Evidence::WordBreak(value),
        )
    } else {
        exact(Field::WordBreak, Evidence::WordBreak(value))
    }
}

fn line_break(style: &Map<String, Value>) -> Outcome<'_> {
    let value = match value::string(style, "lineBreak") {
        Ok("auto") => LineBreak::Auto,
        Ok("normal") => LineBreak::Normal,
        Ok("strict") => LineBreak::Strict,
        Ok(_) => return invalid_issue(Field::LineBreak, value::ValueIssue::Keyword),
        Err(issue) => return invalid_issue(Field::LineBreak, issue),
    };
    policy(
        Field::LineBreak,
        Reason::LegacyParserPolicy,
        Evidence::LineBreak(value),
    )
}

fn overflow_wrap(style: &Map<String, Value>) -> Outcome<'_> {
    match value::string(style, "wordBreak") {
        Ok("break-word") => policy(
            Field::OverflowWrap,
            Reason::LegacyShorthandCollapsed,
            Evidence::OverflowWrap(OverflowWrap::BreakWord),
        ),
        Ok(_) => unavailable(Field::OverflowWrap, Reason::ContractFieldMissing, None),
        Err(issue) => invalid_issue(Field::OverflowWrap, issue),
    }
}

fn spacing<'a>(style: &'a Map<String, Value>, field: Field, key: &str) -> Outcome<'a> {
    match value::length_percentage(style, key, None) {
        Ok(value) => policy(
            field,
            Reason::LegacyProvenanceLost,
            Evidence::LengthPercentage(value.value),
        ),
        Err(issue) => invalid_issue(field, issue),
    }
}

fn text_indent(style: &Map<String, Value>) -> Outcome<'_> {
    match value::length_percentage(style, "textIndent", None) {
        Ok(value) => unavailable(
            Field::TextIndent,
            Reason::ContractFieldMissing,
            Some(Evidence::TextIndent(TextIndent {
                value: value.value,
                hanging: false,
                each_line: false,
            })),
        ),
        Err(issue) => invalid_issue(Field::TextIndent, issue),
    }
}

fn language(style: &Map<String, Value>) -> Outcome<'_> {
    match value::string(style, "language") {
        Ok("und") => policy(
            Field::Language,
            Reason::LegacyProvenanceLost,
            Evidence::Language(None),
        ),
        Ok("") => exact(Field::Language, Evidence::Language(None)),
        Ok(value) => exact(
            Field::Language,
            Evidence::Language(Some(LanguageTag::new(value))),
        ),
        Err(issue) => invalid_issue(Field::Language, issue),
    }
}
