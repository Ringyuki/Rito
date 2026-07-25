use std::borrow::Cow;

use rito_style_contract::PageBreakV1;
use style::{custom_properties::Name, properties::ComputedValues, Atom};
use style_traits::ToCss;

pub(crate) const REGISTRATION_STYLESHEET: &str = r#"
@property --rito-internal-break-before-v1 {
  syntax: "auto | always | page | avoid | left | right";
  inherits: false;
  initial-value: auto;
}
@property --rito-internal-break-after-v1 {
  syntax: "auto | always | page | avoid | left | right";
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
"#;

const BEFORE_CSS_NAME: &str = "--rito-internal-break-before-v1";
const AFTER_CSS_NAME: &str = "--rito-internal-break-after-v1";
// Stylo's Servo profile implements neither table border property, so they
// travel as registered custom properties exactly like the break controls.
const BORDER_COLLAPSE_CSS_NAME: &str = "--rito-internal-border-collapse-v1";
const BORDER_SPACING_CSS_NAME: &str = "--rito-internal-border-spacing-v1";
const BORDER_COLLAPSE_ATOM_NAME: &str = "rito-internal-border-collapse-v1";
const BORDER_SPACING_ATOM_NAME: &str = "rito-internal-border-spacing-v1";
const BEFORE_ATOM_NAME: &str = "rito-internal-break-before-v1";
const AFTER_ATOM_NAME: &str = "rito-internal-break-after-v1";

#[derive(Clone, Copy)]
pub(crate) enum BreakEdge {
    Before,
    After,
}

pub(crate) fn project(styles: &ComputedValues, edge: BreakEdge) -> Option<PageBreakV1> {
    let name = custom_property_name(edge);
    let value = styles.custom_properties().non_inherited.get(&name)?;
    let value = value.to_css_string();
    let value = value.trim();
    if value.eq_ignore_ascii_case("auto") {
        Some(PageBreakV1::Auto)
    } else if value.eq_ignore_ascii_case("always") || value.eq_ignore_ascii_case("page") {
        Some(PageBreakV1::Always)
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
                let replacement = replacement_name(&css[cursor..end]);
                if next_significant_byte(bytes, end) == Some(b':') {
                    in_declaration_value = true;
                    if let Some(replacement) = replacement {
                        output.push_str(&css[copied_until..cursor]);
                        output.push_str(replacement);
                        copied_until = end;
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

fn replacement_name(name: &str) -> Option<&'static str> {
    if name.eq_ignore_ascii_case("break-before") || name.eq_ignore_ascii_case("page-break-before") {
        Some(BEFORE_CSS_NAME)
    } else if name.eq_ignore_ascii_case("break-after")
        || name.eq_ignore_ascii_case("page-break-after")
    {
        Some(AFTER_CSS_NAME)
    } else if name.eq_ignore_ascii_case("border-collapse") {
        Some(BORDER_COLLAPSE_CSS_NAME)
    } else if name.eq_ignore_ascii_case("border-spacing") {
        Some(BORDER_SPACING_CSS_NAME)
    } else {
        None
    }
}

/// The used table cell separation: `border-collapse: collapse` removes it,
/// otherwise `border-spacing`'s one or two lengths apply horizontally and
/// vertically. Values that are not plain pixel lengths resolve to zero,
/// the CSS initial.
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
