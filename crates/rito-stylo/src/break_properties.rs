use std::borrow::Cow;

use rito_style_contract::PageBreak;
use style::{custom_properties::Name, properties::ComputedValues, Atom};
use style_traits::ToCss;

pub(crate) const REGISTRATION_STYLESHEET: &str = r#"
@property --rito-internal-break-before {
  syntax: "auto | always | page | avoid | left | right | column";
  inherits: false;
  initial-value: auto;
}
@property --rito-internal-break-after {
  syntax: "auto | always | page | avoid | left | right | column";
  inherits: false;
  initial-value: auto;
}
@property --rito-internal-border-collapse-v1 {
  syntax: "separate | collapse";
  inherits: true;
  initial-value: separate;
}
@property --rito-internal-border-spacing-v1 {
  syntax: "<length>+";
  inherits: true;
  initial-value: 0px;
}
@property --rito-internal-ruby-align-v1 {
  syntax: "space-around | start | center | space-between";
  inherits: true;
  initial-value: space-around;
}
@property --rito-internal-text-orientation-v1 {
  syntax: "mixed | upright | sideways";
  inherits: true;
  initial-value: mixed;
}
@property --rito-internal-text-combine-upright-v1 {
  syntax: "none | all";
  inherits: true;
  initial-value: none;
}
@property --rito-internal-text-emphasis-style-v1 {
  syntax: "none | filled-auto | open-auto | filled-dot | open-dot | filled-circle | open-circle | filled-double-circle | open-double-circle | filled-triangle | open-triangle | filled-sesame | open-sesame | <string>";
  inherits: true;
  initial-value: none;
}
@property --rito-internal-text-emphasis-color-v1 {
  syntax: "<color>";
  inherits: true;
  initial-value: currentcolor;
}
@property --rito-internal-text-emphasis-position-v1 {
  syntax: "over-right | over-left | under-right | under-left";
  inherits: true;
  initial-value: over-right;
}
"#;

const BEFORE_CSS_NAME: &str = "--rito-internal-break-before";
const AFTER_CSS_NAME: &str = "--rito-internal-break-after";
// Stylo's Servo profile implements neither table border property, so they
// travel as registered custom properties exactly like the break controls.
const BORDER_COLLAPSE_CSS_NAME: &str = "--rito-internal-border-collapse-v1";
const BORDER_SPACING_CSS_NAME: &str = "--rito-internal-border-spacing-v1";
// `ruby-align` is a Gecko-only longhand in stylo's Servo profile, so it
// travels as a registered custom property like the table borders.
const RUBY_ALIGN_CSS_NAME: &str = "--rito-internal-ruby-align-v1";
// `text-orientation` and `text-combine-upright` are Gecko-only longhands in
// stylo's Servo profile too; their legacy prefixed forms reach them with
// the keyword the browser maps each prefixed value to.
const TEXT_ORIENTATION_CSS_NAME: &str = "--rito-internal-text-orientation-v1";
const TEXT_COMBINE_UPRIGHT_CSS_NAME: &str = "--rito-internal-text-combine-upright-v1";
const TEXT_ORIENTATION_ATOM_NAME: &str = "rito-internal-text-orientation-v1";
const TEXT_COMBINE_UPRIGHT_ATOM_NAME: &str = "rito-internal-text-combine-upright-v1";
const BORDER_COLLAPSE_ATOM_NAME: &str = "rito-internal-border-collapse-v1";
const BORDER_SPACING_ATOM_NAME: &str = "rito-internal-border-spacing-v1";
const RUBY_ALIGN_ATOM_NAME: &str = "rito-internal-ruby-align-v1";
const BEFORE_ATOM_NAME: &str = "rito-internal-break-before";
const AFTER_ATOM_NAME: &str = "rito-internal-break-after";

#[derive(Clone, Copy)]
pub(crate) enum BreakEdge {
    Before,
    After,
}

pub(crate) fn project(styles: &ComputedValues, edge: BreakEdge) -> Option<PageBreak> {
    let name = custom_property_name(edge);
    let value = styles.custom_properties().non_inherited.get(&name)?;
    let value = value.to_css_string();
    let value = value.trim();
    if value.eq_ignore_ascii_case("auto") {
        Some(PageBreak::Auto)
    } else if value.eq_ignore_ascii_case("always") || value.eq_ignore_ascii_case("page") {
        // The reader's fragmentainer is a COLUMN context (the pixel
        // oracle's multicol truth). Measured: Chromium's continuous
        // multicol ignores generic and page forced breaks entirely —
        // followers stay in the same column for `break-after: always`,
        // `break-after: page`, and both legacy aliases; only the
        // `column` keyword breaks. Honoring them sealed a fragmentainer
        // per mid-chapter plate (b2's .illus: one blank page before and
        // one after every interior illustration, chapter drift -6).
        Some(PageBreak::Auto)
    } else if value.eq_ignore_ascii_case("column") {
        Some(PageBreak::Always)
    } else {
        // The retired consumer ignored avoid/left/right. Reject them instead
        // of pretending they have ordinary forced-page semantics.
        None
    }
}

pub(crate) fn rewrite_stylesheet(css: &str) -> Cow<'_, str> {
    rewrite(css, false)
}

pub(crate) fn rewrite_declaration_list(css: &str) -> Cow<'_, str> {
    rewrite(css, true)
}

fn custom_property_name(edge: BreakEdge) -> Name {
    Atom::from(match edge {
        BreakEdge::Before => BEFORE_ATOM_NAME,
        BreakEdge::After => AFTER_ATOM_NAME,
    })
}

fn rewrite(css: &str, declaration_list: bool) -> Cow<'_, str> {
    let bytes = css.as_bytes();
    let mut output = String::new();
    let mut copied_until = 0;
    let mut cursor = 0;
    let mut candidate = declaration_list;
    let mut paren_depth = 0_u32;
    let mut bracket_depth = 0_u32;
    let mut value_brace_depth = 0_u32;
    let mut in_declaration_value = false;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'\'' | b'"' => {
                cursor = quoted_end(bytes, cursor);
                candidate = false;
            }
            b'/' if bytes.get(cursor + 1) == Some(&b'*') => {
                cursor = comment_end(bytes, cursor);
            }
            b'(' => {
                paren_depth = paren_depth.saturating_add(1);
                candidate = false;
                cursor += 1;
            }
            b')' => {
                paren_depth = paren_depth.saturating_sub(1);
                cursor += 1;
            }
            b'[' => {
                bracket_depth = bracket_depth.saturating_add(1);
                candidate = false;
                cursor += 1;
            }
            b']' => {
                bracket_depth = bracket_depth.saturating_sub(1);
                cursor += 1;
            }
            b'{' if paren_depth == 0 && bracket_depth == 0 => {
                if in_declaration_value {
                    value_brace_depth = value_brace_depth.saturating_add(1);
                } else {
                    candidate = true;
                }
                cursor += 1;
            }
            b'}' if value_brace_depth > 0 => {
                value_brace_depth -= 1;
                cursor += 1;
            }
            b'}' if paren_depth == 0 && bracket_depth == 0 => {
                candidate = false;
                in_declaration_value = false;
                cursor += 1;
            }
            b';' if paren_depth == 0 && bracket_depth == 0 && value_brace_depth == 0 => {
                candidate = true;
                in_declaration_value = false;
                cursor += 1;
            }
            byte if candidate && is_name_start(byte) => {
                let end = name_end(bytes, cursor);
                // Only a value the browser's parser accepts for the
                // property may ride a keyword carrier. An invalid value
                // (`ruby-align: inter-character`, `auto` in the corpus)
                // keeps its original name so the declaration drops at
                // parse time exactly like the browser drops it;
                // rewritten, it would win the cascade and reset an
                // earlier valid declaration to the initial.
                let found = carrier(&css[cursor..end]);
                if let Some(CarriedValue::Rewritten(rewrite)) = found.as_ref().map(|c| &c.value) {
                    let declaration = declaration_value(css, end);
                    let carried = declaration
                        .as_ref()
                        .and_then(|declaration| rewrite(&css[declaration.value.clone()]));
                    if let (Some(declaration), Some(carried)) = (declaration, carried) {
                        output.push_str(&css[copied_until..cursor]);
                        let priority = if declaration.important {
                            " !important"
                        } else {
                            ""
                        };
                        let written: Vec<String> = carried
                            .iter()
                            .map(|(name, value)| format!("{name}: {value}{priority}"))
                            .collect();
                        output.push_str(&written.join("; "));
                        copied_until = declaration.end;
                        candidate = false;
                        cursor = declaration.end;
                        continue;
                    }
                }
                let carried = found.and_then(|carrier| {
                    let keywords = match carrier.value {
                        CarriedValue::AsWritten => return Some((carrier.name, None)),
                        CarriedValue::Keyword(keywords) => keywords,
                        CarriedValue::Rewritten(_) => return None,
                    };
                    let (range, keyword) = declaration_keyword(css, end)?;
                    let stored = stored_keyword(keywords, &keyword)?;
                    let rewritten =
                        (!stored.eq_ignore_ascii_case(&keyword)).then_some((range, stored));
                    Some((carrier.name, rewritten))
                });
                if next_significant_byte(bytes, end) == Some(b':') {
                    in_declaration_value = true;
                    if let Some((name, value)) = carried {
                        output.push_str(&css[copied_until..cursor]);
                        output.push_str(name);
                        copied_until = end;
                        if let Some((range, stored)) = value {
                            output.push_str(&css[end..range.start]);
                            output.push_str(stored);
                            copied_until = range.end;
                        }
                    }
                }
                candidate = false;
                cursor = end;
            }
            byte if byte.is_ascii_whitespace() && candidate => cursor += 1,
            _ => {
                candidate = false;
                cursor += 1;
            }
        }
    }
    if output.is_empty() {
        Cow::Borrowed(css)
    } else {
        output.push_str(&css[copied_until..]);
        Cow::Owned(output)
    }
}

/// The keywords the browser's parser accepts for one property name, each
/// with the keyword the carrier stores for it.
type KeywordMap = &'static [(&'static str, &'static str)];

const RUBY_ALIGN_KEYWORDS: KeywordMap = &[
    ("space-around", "space-around"),
    ("start", "start"),
    ("center", "center"),
    ("space-between", "space-between"),
];
const TEXT_ORIENTATION_KEYWORDS: KeywordMap = &[
    ("mixed", "mixed"),
    ("upright", "upright"),
    ("sideways", "sideways"),
    ("sideways-right", "sideways"),
];
// Blink's `-webkit-text-orientation` grammar: `vertical-right` is the
// legacy name of `mixed`, `sideways-right` of `sideways`.
const WEBKIT_TEXT_ORIENTATION_KEYWORDS: KeywordMap = &[
    ("sideways", "sideways"),
    ("sideways-right", "sideways"),
    ("upright", "upright"),
    ("vertical-right", "mixed"),
];
const TEXT_COMBINE_UPRIGHT_KEYWORDS: KeywordMap = &[("none", "none"), ("all", "all")];
// Blink's `-webkit-text-combine`: `horizontal` is `text-combine-upright:
// all`.
const WEBKIT_TEXT_COMBINE_KEYWORDS: KeywordMap = &[("none", "none"), ("horizontal", "all")];

/// Where a declaration stylo's Servo profile would drop travels instead.
struct Carrier {
    /// The property it is renamed to.
    name: &'static str,
    /// What its value becomes.
    value: CarriedValue,
}

/// How a carried declaration's value travels.
enum CarriedValue {
    /// As written; its projection reads it.
    AsWritten,
    /// One of these keywords, as the carrier stores it.
    Keyword(KeywordMap),
    /// Checked and rewritten whole: the declarations it becomes, or none
    /// when the browser's grammar rejects it.
    Rewritten(fn(&str) -> Option<crate::text_emphasis::Carried>),
}

fn carrier(name: &str) -> Option<Carrier> {
    let is = |candidate: &str| name.eq_ignore_ascii_case(candidate);
    let renamed = |name| Carrier {
        name,
        value: CarriedValue::AsWritten,
    };
    let keyword = |name, keywords| Carrier {
        name,
        value: CarriedValue::Keyword(keywords),
    };
    let rewritten = |name, rewrite| Carrier {
        name,
        value: CarriedValue::Rewritten(rewrite),
    };
    use crate::text_emphasis as emphasis;
    Some(if is("break-before") || is("page-break-before") {
        renamed(BEFORE_CSS_NAME)
    } else if is("break-after") || is("page-break-after") {
        renamed(AFTER_CSS_NAME)
    } else if is("border-collapse") {
        renamed(BORDER_COLLAPSE_CSS_NAME)
    } else if is("border-spacing") {
        renamed(BORDER_SPACING_CSS_NAME)
    } else if is("ruby-align") {
        keyword(RUBY_ALIGN_CSS_NAME, RUBY_ALIGN_KEYWORDS)
    } else if is("-webkit-writing-mode") || is("-epub-writing-mode") {
        // Blink parses both prefixed forms as aliases of `writing-mode`
        // (same value grammar); vertical EPUB books commonly declare ONLY
        // the prefixed forms, which stylo's servo profile drops as
        // unknown properties.
        renamed("writing-mode")
    } else if is("text-orientation") {
        keyword(TEXT_ORIENTATION_CSS_NAME, TEXT_ORIENTATION_KEYWORDS)
    } else if is("-webkit-text-orientation") || is("-epub-text-orientation") {
        keyword(TEXT_ORIENTATION_CSS_NAME, WEBKIT_TEXT_ORIENTATION_KEYWORDS)
    } else if is("text-combine-upright") {
        keyword(TEXT_COMBINE_UPRIGHT_CSS_NAME, TEXT_COMBINE_UPRIGHT_KEYWORDS)
    } else if is("-webkit-text-combine") || is("-epub-text-combine") {
        keyword(TEXT_COMBINE_UPRIGHT_CSS_NAME, WEBKIT_TEXT_COMBINE_KEYWORDS)
    } else if is("text-emphasis-style")
        || is("-webkit-text-emphasis-style")
        || is("-epub-text-emphasis-style")
    {
        rewritten(emphasis::STYLE_CSS_NAME, emphasis::carry_style)
    } else if is("text-emphasis-color")
        || is("-webkit-text-emphasis-color")
        || is("-epub-text-emphasis-color")
    {
        rewritten(emphasis::COLOR_CSS_NAME, emphasis::carry_color)
    } else if is("text-emphasis-position") || is("-webkit-text-emphasis-position") {
        // Blink has no `-epub-` spelling of the position.
        rewritten(emphasis::POSITION_CSS_NAME, emphasis::carry_position)
    } else if is("text-emphasis") || is("-webkit-text-emphasis") || is("-epub-text-emphasis") {
        rewritten(emphasis::STYLE_CSS_NAME, emphasis::carry_shorthand)
    } else {
        return None;
    })
}

/// The keyword `keywords` stores for `value`: its own mapping, or the
/// value itself when it is a CSS-wide keyword, which every property
/// accepts.
fn stored_keyword(keywords: KeywordMap, value: &str) -> Option<&'static str> {
    const CSS_WIDE: [&str; 5] = ["inherit", "initial", "unset", "revert", "revert-layer"];
    if let Some(wide) = CSS_WIDE
        .iter()
        .find(|wide| wide.eq_ignore_ascii_case(value))
    {
        return Some(wide);
    }
    keywords
        .iter()
        .find(|(accepted, _)| accepted.eq_ignore_ascii_case(value))
        .map(|(_, stored)| *stored)
}

/// The single keyword a declaration's value is, with its byte range,
/// when the value following `after_name` (the byte after the property
/// name) is exactly one identifier, ignoring comments and a trailing
/// `!important`.
fn declaration_keyword(css: &str, after_name: usize) -> Option<(std::ops::Range<usize>, String)> {
    let bytes = css.as_bytes();
    let skip = |mut cursor: usize| loop {
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) == Some(&b'*') {
            cursor = comment_end(bytes, cursor);
            continue;
        }
        break cursor;
    };
    let mut cursor = skip(after_name);
    if bytes.get(cursor) != Some(&b':') {
        return None;
    }
    cursor = skip(cursor + 1);
    if !bytes.get(cursor).copied().is_some_and(is_name_start) {
        return None;
    }
    let start = cursor;
    cursor = name_end(bytes, cursor);
    let range = start..cursor;
    cursor = skip(cursor);
    if bytes.get(cursor) == Some(&b'!') {
        cursor = skip(cursor + 1);
        let end = name_end(bytes, cursor);
        if !css[cursor..end].eq_ignore_ascii_case("important") {
            return None;
        }
        cursor = skip(end);
    }
    matches!(bytes.get(cursor), None | Some(b';' | b'}')).then(|| {
        let keyword = css[range.clone()].to_owned();
        (range, keyword)
    })
}

/// A declaration's value: its text (a trailing `!important` left out),
/// whether it is important, and the byte that ends it (its `;` or `}`,
/// or the end of the text).
struct DeclarationValue {
    value: std::ops::Range<usize>,
    important: bool,
    end: usize,
}

/// The value following `after_name` (the byte after a property name),
/// scanned to the top-level `;` or `}` that ends it.
fn declaration_value(css: &str, after_name: usize) -> Option<DeclarationValue> {
    let bytes = css.as_bytes();
    let mut cursor = after_name;
    loop {
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) == Some(&b'*') {
            cursor = comment_end(bytes, cursor);
            continue;
        }
        break;
    }
    if bytes.get(cursor) != Some(&b':') {
        return None;
    }
    let start = cursor + 1;
    cursor = start;
    let mut depth = 0_u32;
    let mut bang = None;
    while let Some(&byte) = bytes.get(cursor) {
        match byte {
            b'\'' | b'"' => {
                cursor = quoted_end(bytes, cursor);
                continue;
            }
            b'/' if bytes.get(cursor + 1) == Some(&b'*') => {
                cursor = comment_end(bytes, cursor);
                continue;
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' => depth = depth.saturating_sub(1),
            b'}' if depth > 0 => depth -= 1,
            b';' | b'}' if depth == 0 => break,
            b'!' if depth == 0 => bang = Some(cursor),
            _ => {}
        }
        cursor += 1;
    }
    let end = cursor;
    let important = bang.is_some_and(|bang| {
        let after = &css[bang + 1..end];
        let word = after.trim_start();
        let word_start = end - after.len() + (after.len() - word.len());
        let word_end = name_end(bytes, word_start);
        css[word_start..word_end].eq_ignore_ascii_case("important")
            && css[word_end..end].trim().is_empty()
    });
    let value_end = match bang {
        Some(bang) if important => bang,
        _ => end,
    };
    Some(DeclarationValue {
        value: start..value_end,
        important,
        end,
    })
}

/// The used table cell separation: `border-collapse: collapse` removes it,
/// otherwise `border-spacing`'s one or two lengths apply horizontally and
/// vertically. Values that are not plain pixel lengths resolve to zero,
/// the CSS initial.
/// Whether the box computes `border-collapse: collapse` (read through the
/// same registered custom-property channel as the spacing).
pub(crate) fn project_border_collapse(styles: &ComputedValues) -> bool {
    let custom = styles.custom_properties();
    custom
        .inherited
        .get(&Atom::from(BORDER_COLLAPSE_ATOM_NAME))
        .or_else(|| {
            custom
                .non_inherited
                .get(&Atom::from(BORDER_COLLAPSE_ATOM_NAME))
        })
        .map(|value| value.to_css_string())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("collapse"))
}

pub(crate) fn project_border_spacing(styles: &ComputedValues) -> (f32, f32) {
    let custom = styles.custom_properties();
    let read = |name: &str| -> Option<String> {
        custom
            .inherited
            .get(&Atom::from(name))
            .or_else(|| custom.non_inherited.get(&Atom::from(name)))
            .map(|value| value.to_css_string())
    };
    let collapsed = read(BORDER_COLLAPSE_ATOM_NAME)
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("collapse"));
    if collapsed {
        return (0.0, 0.0);
    }
    let Some(value) = read(BORDER_SPACING_ATOM_NAME) else {
        return (0.0, 0.0);
    };
    let mut lengths = value.split_whitespace().map(parse_px);
    let horizontal = lengths.next().flatten().unwrap_or(0.0);
    let vertical = lengths.next().flatten().unwrap_or(horizontal);
    (horizontal, vertical)
}

/// The used `ruby-align`. Only browser-valid values were rewritten onto
/// the registered property, so anything unreadable here is the initial.
pub(crate) fn project_ruby_align(styles: &ComputedValues) -> rito_style_contract::RubyAlign {
    use rito_style_contract::RubyAlign;
    let custom = styles.custom_properties();
    let Some(value) = custom
        .inherited
        .get(&Atom::from(RUBY_ALIGN_ATOM_NAME))
        .map(|value| value.to_css_string())
    else {
        return RubyAlign::SpaceAround;
    };
    match value.trim() {
        "start" => RubyAlign::Start,
        "center" => RubyAlign::Center,
        "space-between" => RubyAlign::SpaceBetween,
        _ => RubyAlign::SpaceAround,
    }
}

/// The used `text-orientation`, read off its carrier.
pub(crate) fn project_text_orientation(
    styles: &ComputedValues,
) -> rito_style_contract::TextOrientation {
    use rito_style_contract::TextOrientation;
    match inherited_keyword(styles, TEXT_ORIENTATION_ATOM_NAME).as_deref() {
        Some("upright") => TextOrientation::Upright,
        Some("sideways") => TextOrientation::Sideways,
        _ => TextOrientation::Mixed,
    }
}

/// The used `text-combine-upright`, read off its carrier.
pub(crate) fn project_text_combine_upright(
    styles: &ComputedValues,
) -> rito_style_contract::TextCombineUpright {
    use rito_style_contract::TextCombineUpright;
    match inherited_keyword(styles, TEXT_COMBINE_UPRIGHT_ATOM_NAME).as_deref() {
        Some("all") => TextCombineUpright::All,
        _ => TextCombineUpright::None,
    }
}

/// An inherited registered keyword property's computed value, lowercased.
fn inherited_keyword(styles: &ComputedValues, atom_name: &str) -> Option<String> {
    styles
        .custom_properties()
        .inherited
        .get(&Atom::from(atom_name))
        .map(|value| value.to_css_string().trim().to_ascii_lowercase())
}

fn parse_px(token: &str) -> Option<f32> {
    let token = token.trim();
    let digits = token.strip_suffix("px").unwrap_or(token);
    digits.parse::<f32>().ok().filter(|value| *value >= 0.0)
}

fn is_name_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'-')
}

fn is_name(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
}

fn name_end(bytes: &[u8], mut cursor: usize) -> usize {
    while bytes.get(cursor).is_some_and(|byte| is_name(*byte)) {
        cursor += 1;
    }
    cursor
}

fn next_significant_byte(bytes: &[u8], mut cursor: usize) -> Option<u8> {
    loop {
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) == Some(&b'*') {
            cursor = comment_end(bytes, cursor);
            continue;
        }
        return bytes.get(cursor).copied();
    }
}

fn quoted_end(bytes: &[u8], start: usize) -> usize {
    let quote = bytes[start];
    let mut cursor = start + 1;
    while cursor < bytes.len() {
        if bytes[cursor] == b'\\' {
            cursor = (cursor + 2).min(bytes.len());
        } else if bytes[cursor] == quote {
            return cursor + 1;
        } else {
            cursor += 1;
        }
    }
    cursor
}

fn comment_end(bytes: &[u8], start: usize) -> usize {
    let mut cursor = start + 2;
    while cursor + 1 < bytes.len() {
        if bytes[cursor] == b'*' && bytes[cursor + 1] == b'/' {
            return cursor + 2;
        }
        cursor += 1;
    }
    bytes.len()
}

#[cfg(test)]
mod tests {
    use super::{rewrite_declaration_list, rewrite_stylesheet, AFTER_CSS_NAME, BEFORE_CSS_NAME};

    #[test]
    fn rewrites_standard_and_legacy_aliases_without_touching_values() {
        let css = "p { break-before: page; page-break-after /*x*/ : always !important; \
                   background: url(break-before:page); content: 'break-after: page' }";
        let rewritten = rewrite_stylesheet(css);
        assert!(rewritten.contains(&format!("{BEFORE_CSS_NAME}: page")));
        assert!(rewritten.contains(&format!("{AFTER_CSS_NAME} /*x*/ : always !important")));
        assert!(rewritten.contains("url(break-before:page)"));
        assert!(rewritten.contains("'break-after: page'"));
    }

    #[test]
    fn rewrites_inline_declaration_list_at_offset_zero() {
        assert_eq!(
            rewrite_declaration_list("PAGE-BREAK-BEFORE: always; color: red"),
            format!("{BEFORE_CSS_NAME}: always; color: red")
        );
    }

    #[test]
    fn rewrites_ruby_align_only_for_values_the_browser_accepts() {
        let css = "ruby { ruby-align: center } rt { ruby-align: SPACE-BETWEEN !important } \
                   .a { ruby-align: inter-character } .b { ruby-align: auto; color: red }";
        let rewritten = rewrite_stylesheet(css);
        assert!(rewritten.contains("--rito-internal-ruby-align-v1: center"));
        assert!(rewritten.contains("--rito-internal-ruby-align-v1: SPACE-BETWEEN !important"));
        // Invalid values keep their original name and die in the style
        // system's unknown-property parse, exactly like the browser.
        assert!(rewritten.contains("ruby-align: inter-character"));
        assert!(rewritten.contains("ruby-align: auto"));
    }

    #[test]
    fn ruby_align_value_scan_handles_comments_and_important() {
        assert_eq!(
            rewrite_declaration_list("ruby-align /*x*/ : /*y*/ center /*z*/ ! important"),
            "--rito-internal-ruby-align-v1 /*x*/ : /*y*/ center /*z*/ ! important"
        );
        assert_eq!(
            rewrite_declaration_list("ruby-align: centered"),
            "ruby-align: centered"
        );
    }

    #[test]
    fn prefixed_writing_mode_aliases_reach_the_standard_property() {
        let css = ".vrtl { -webkit-writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; }";
        let rewritten = rewrite_stylesheet(css);
        assert_eq!(
            rewritten.as_ref(),
            ".vrtl { writing-mode: vertical-rl; writing-mode: vertical-rl; }"
        );
    }

    #[test]
    fn vertical_text_properties_ride_their_carriers_with_the_browser_keyword() {
        let css = ".a { text-orientation: upright } .b { -epub-text-orientation: vertical-right } \
                   .c { -webkit-text-orientation: sideways-right } \
                   .d { -webkit-text-combine: horizontal; -epub-text-combine: none } \
                   .e { text-combine-upright: all !important } .f { text-combine-upright: inherit }";
        assert_eq!(
            rewrite_stylesheet(css),
            ".a { --rito-internal-text-orientation-v1: upright } \
             .b { --rito-internal-text-orientation-v1: mixed } \
             .c { --rito-internal-text-orientation-v1: sideways } \
             .d { --rito-internal-text-combine-upright-v1: all; \
             --rito-internal-text-combine-upright-v1: none } \
             .e { --rito-internal-text-combine-upright-v1: all !important } \
             .f { --rito-internal-text-combine-upright-v1: inherit }"
        );
    }

    #[test]
    fn vertical_text_values_another_grammar_owns_keep_their_name() {
        // Each spelling accepts only its own grammar, as the browser's
        // parser does: the declaration drops instead of carrying.
        for css in [
            "text-combine-upright: horizontal",
            "-webkit-text-combine: all",
            "text-combine-upright: digits 2",
            "text-orientation: vertical-right",
            "-webkit-text-orientation: mixed",
        ] {
            assert_eq!(rewrite_declaration_list(css), css);
        }
    }

    #[test]
    fn does_not_rewrite_names_inside_custom_property_token_blocks() {
        let css = "p { --tokens: { break-after: page; nested: { break-before: page } }; \
                   page-break-after: always; }";
        let rewritten = rewrite_stylesheet(css);
        assert!(
            rewritten.contains("--tokens: { break-after: page; nested: { break-before: page } }")
        );
        assert!(rewritten.contains(&format!("{AFTER_CSS_NAME}: always")));
    }
}
