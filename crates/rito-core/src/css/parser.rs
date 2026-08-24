use std::collections::BTreeMap;

use serde_json::{json, Map, Number, Value};
use sha2::{Digest, Sha256};

use super::{values::ParsedDeclarations, CssStylesheetSummary, CssSummary};

pub(crate) fn summarize_stylesheet_texts<'a>(
    stylesheets: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> CssSummary {
    let mut stylesheets = stylesheets
        .into_iter()
        .map(|(href, css)| summarize_stylesheet(href.to_owned(), css))
        .collect::<Vec<_>>();

    stylesheets.sort_by(|left, right| left.href.cmp(&right.href));

    CssSummary {
        stylesheet_count: stylesheets.len(),
        full_detail_hash: full_detail_hash(&stylesheets),
        stylesheets,
    }
}

fn summarize_stylesheet(href: String, css: &str) -> CssStylesheetSummary {
    let rules = parse_css_rules(css);
    let font_faces = canonical_font_faces(parse_font_face_rules(css));
    let detail = json!({
        "fontFaces": font_faces.iter().map(font_face_value).collect::<Vec<_>>(),
        "rules": rules.iter().map(rule_value).collect::<Vec<_>>(),
    });
    let mut declaration_key_counts = BTreeMap::new();
    for rule in &rules {
        for key in &rule.declaration_keys {
            *declaration_key_counts.entry(key.clone()).or_default() += 1;
        }
    }

    CssStylesheetSummary {
        href,
        rule_count: rules.len(),
        font_face_count: font_faces.len(),
        declaration_key_counts,
        selector_hash: hash_json(&Value::Array(
            rules
                .iter()
                .map(|rule| Value::String(rule.selector.clone()))
                .collect(),
        )),
        raw_declarations_hash: hash_json(&Value::Array(
            rules
                .iter()
                .map(|rule| Value::String(rule.raw_declarations_hash.clone()))
                .collect(),
        )),
        declaration_value_hash: hash_json(&Value::Array(
            rules
                .iter()
                .map(|rule| Value::String(rule.declarations_hash.clone()))
                .collect(),
        )),
        font_face_hash: hash_json(&Value::Array(
            font_faces.iter().map(font_face_value).collect(),
        )),
        detail_hash: hash_json(&detail),
    }
}

#[derive(Debug, Clone)]
pub(crate) struct CssRuleSummary {
    pub(crate) selector: String,
    pub(crate) origin: String,
    pub(crate) declaration_keys: Vec<String>,
    pub(crate) declarations: Map<String, Value>,
    pub(crate) raw_declarations: String,
    pub(crate) declarations_hash: String,
    pub(crate) raw_declarations_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FontFaceRule {
    pub(crate) family: String,
    pub(crate) src: String,
    pub(crate) style: Option<String>,
    pub(crate) weight: Option<String>,
}

pub(crate) fn parse_css_rules(css: &str) -> Vec<CssRuleSummary> {
    parse_css_rules_with_root_font_size(css, 16.0)
}

pub(crate) fn parse_css_rules_with_root_font_size(
    css: &str,
    root_font_size: f64,
) -> Vec<CssRuleSummary> {
    let cleaned = strip_comments(css);
    extract_rule_blocks(&cleaned)
        .into_iter()
        .flat_map(|block| {
            let ParsedDeclarations {
                keys,
                values: raw_declarations,
            } = super::values::parse_declarations_with_font_size(
                &block.body,
                root_font_size,
                root_font_size,
            );
            let has_pseudo = has_pseudo_element(&block.selector);
            let has_viewport = has_viewport_units(&block.body);
            if keys.is_empty() && !has_pseudo && !has_viewport {
                return Vec::new();
            }
            let declarations = round_json_object(&raw_declarations);
            let declarations_hash = hash_json(&Value::Object(declarations.clone()));

            block
                .selector
                .split(',')
                .map(str::trim)
                .filter(|selector| !selector.is_empty())
                .map(|selector| CssRuleSummary {
                    selector: selector.to_owned(),
                    origin: "author".to_owned(),
                    declaration_keys: keys.iter().cloned().collect(),
                    declarations: declarations.clone(),
                    raw_declarations: block.body.clone(),
                    declarations_hash: declarations_hash.clone(),
                    raw_declarations_hash: hash_text(&block.body),
                })
                .collect()
        })
        .collect()
}

fn round_json_object(object: &Map<String, Value>) -> Map<String, Value> {
    object
        .iter()
        .map(|(key, value)| (key.clone(), round_json_value(value)))
        .collect()
}

fn round_json_value(value: &Value) -> Value {
    match value {
        Value::Number(number) => number
            .as_f64()
            .map(rounded_number_value)
            .unwrap_or_else(|| value.clone()),
        Value::Array(values) => Value::Array(values.iter().map(round_json_value).collect()),
        Value::Object(object) => Value::Object(round_json_object(object)),
        _ => value.clone(),
    }
}

fn rounded_number_value(value: f64) -> Value {
    let rounded = (value * 1000.0).round() / 1000.0;
    if rounded.fract().abs() < f64::EPSILON {
        Value::Number(Number::from(rounded as i64))
    } else {
        Value::Number(Number::from_f64(rounded).unwrap_or_else(|| Number::from(0)))
    }
}

fn parse_font_face_rules(css: &str) -> Vec<FontFaceRule> {
    let cleaned = strip_comments(css);
    let mut rules = Vec::new();
    let mut index = 0;

    while index < cleaned.len() {
        index = skip_whitespace(&cleaned, index);
        if index >= cleaned.len() {
            break;
        }

        if cleaned[index..].starts_with('@') {
            let keyword = cleaned[index..]
                .chars()
                .take(11)
                .collect::<String>()
                .to_lowercase();
            if keyword.starts_with("@font-face") {
                let Some(brace_start) = cleaned[index..].find('{').map(|offset| index + offset)
                else {
                    break;
                };
                let Some(brace_end) = find_closing_brace(&cleaned, brace_start) else {
                    break;
                };
                if let Some(rule) = parse_font_face_body(cleaned[brace_start + 1..brace_end].trim())
                {
                    rules.push(rule);
                }
                index = brace_end + 1;
                continue;
            }
            index = skip_at_rule(&cleaned, index);
            continue;
        }

        let Some(brace_start) = cleaned[index..].find('{').map(|offset| index + offset) else {
            break;
        };
        let Some(brace_end) = find_closing_brace(&cleaned, brace_start) else {
            break;
        };
        index = brace_end + 1;
    }

    rules
}

fn canonical_font_faces(mut rules: Vec<FontFaceRule>) -> Vec<FontFaceRule> {
    rules.sort_by(|left, right| {
        left.family
            .cmp(&right.family)
            .then_with(|| left.src.cmp(&right.src))
    });
    rules
}

fn parse_font_face_body(body: &str) -> Option<FontFaceRule> {
    let mut family = None;
    let mut src = None;
    let mut style = None;
    let mut weight = None;

    for declaration in body.split(';') {
        let Some((property, value)) = declaration.split_once(':') else {
            continue;
        };
        let property = property.trim().to_ascii_lowercase();
        let value = value.trim();

        match property.as_str() {
            "font-family" => family = Some(unquote(value)),
            "src" => src = extract_url(value),
            "font-style" if !value.is_empty() => style = Some(value.to_owned()),
            "font-weight" if !value.is_empty() => weight = Some(value.to_owned()),
            _ => {}
        }
    }

    Some(FontFaceRule {
        family: family?,
        src: src?,
        style,
        weight,
    })
}

#[derive(Debug)]
struct RuleBlock {
    selector: String,
    body: String,
}

fn extract_rule_blocks(css: &str) -> Vec<RuleBlock> {
    let mut blocks = Vec::new();
    let mut index = 0;

    while index < css.len() {
        if css[index..].starts_with('@') {
            index = skip_at_rule(css, index);
            continue;
        }

        let Some(brace_start) = css[index..].find('{').map(|offset| index + offset) else {
            break;
        };
        let Some(brace_end) = find_closing_brace(css, brace_start) else {
            break;
        };
        let selector = css[index..brace_start].trim();
        if !selector.is_empty() {
            blocks.push(RuleBlock {
                selector: selector.to_owned(),
                body: css[brace_start + 1..brace_end].trim().to_owned(),
            });
        }
        index = brace_end + 1;
    }

    blocks
}

fn strip_comments(css: &str) -> String {
    let mut output = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find("*/") else {
            rest = "";
            break;
        };
        rest = &after_start[end + 2..];
    }
    output.push_str(rest);
    output
}

fn skip_at_rule(css: &str, start: usize) -> usize {
    let Some(brace_start) = css[start..].find('{').map(|offset| start + offset) else {
        return css[start..]
            .find(';')
            .map(|offset| start + offset + 1)
            .unwrap_or(css.len());
    };
    let semicolon = css[start..].find(';').map(|offset| start + offset);
    if let Some(semicolon) = semicolon {
        if semicolon < brace_start {
            return semicolon + 1;
        }
    }
    find_closing_brace(css, brace_start)
        .map(|index| index + 1)
        .unwrap_or(css.len())
}

fn find_closing_brace(css: &str, brace_start: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (offset, ch) in css[brace_start..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(brace_start + offset);
                }
            }
            _ => {}
        }
    }
    None
}

fn skip_whitespace(value: &str, mut index: usize) -> usize {
    while index < value.len()
        && value[index..]
            .chars()
            .next()
            .is_some_and(char::is_whitespace)
    {
        index += value[index..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1);
    }
    index
}

fn has_pseudo_element(selector: &str) -> bool {
    let selector = selector.to_ascii_lowercase();
    selector.contains(":before")
        || selector.contains("::before")
        || selector.contains(":after")
        || selector.contains("::after")
}

fn has_viewport_units(body: &str) -> bool {
    body.to_ascii_lowercase().contains("vh") || body.to_ascii_lowercase().contains("vw")
}

fn unquote(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        value[1..value.len() - 1].to_owned()
    } else {
        value.to_owned()
    }
}

fn extract_url(value: &str) -> Option<String> {
    let start = value.find("url(")? + 4;
    let rest = &value[start..];
    let end = rest.find(')')?;
    Some(unquote(rest[..end].trim()))
}

fn rule_value(rule: &CssRuleSummary) -> Value {
    json!({
        "declarationKeys": rule.declaration_keys,
        "declarations": rule.declarations,
        "declarationsHash": rule.declarations_hash,
        "origin": rule.origin,
        "rawDeclarationsHash": rule.raw_declarations_hash,
        "selector": rule.selector,
    })
}

fn font_face_value(rule: &FontFaceRule) -> Value {
    json!({
        "family": rule.family,
        "src": rule.src,
        "style": rule.style,
        "weight": rule.weight,
    })
}

fn full_detail_hash(stylesheets: &[CssStylesheetSummary]) -> String {
    let details = stylesheets
        .iter()
        .map(|stylesheet| {
            json!({
                "detailHash": stylesheet.detail_hash,
                "href": stylesheet.href,
            })
        })
        .collect::<Vec<_>>();
    hash_json(&Value::Array(details))
}

fn hash_json(value: &Value) -> String {
    let text = format!("{}\n", stable_json(value, 0));
    hash_text(&text)
}

fn hash_text(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn stable_json(value: &Value, depth: usize) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => value.to_string(),
        Value::Array(values) => stable_json_array(values, depth),
        Value::Object(object) => stable_json_object(object, depth),
    }
}

fn stable_json_array(values: &[Value], depth: usize) -> String {
    if values.is_empty() {
        return "[]".to_owned();
    }

    let next_depth = depth + 1;
    let indent = spaces(next_depth);
    let closing = spaces(depth);
    let entries = values
        .iter()
        .map(|value| format!("{indent}{}", stable_json(value, next_depth)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("[\n{entries}\n{closing}]")
}

fn stable_json_object(object: &Map<String, Value>, depth: usize) -> String {
    if object.is_empty() {
        return "{}".to_owned();
    }

    let next_depth = depth + 1;
    let indent = spaces(next_depth);
    let closing = spaces(depth);
    let entries = object
        .iter()
        .map(|(key, value)| format!("{indent}{key:?}: {}", stable_json(value, next_depth)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("{{\n{entries}\n{closing}}}")
}

fn spaces(depth: usize) -> String {
    "  ".repeat(depth)
}

#[cfg(test)]
mod tests {
    use super::{parse_css_rules, parse_font_face_rules, summarize_stylesheet_texts};

    #[test]
    fn parses_grouped_rules_into_selector_summaries() {
        let rules = parse_css_rules(".a, p { margin: 0 auto; line-height: 120%; unknown: 1 }");

        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].selector, ".a");
        assert_eq!(rules[1].selector, "p");
        assert!(rules[0]
            .declaration_keys
            .contains(&"marginLeftAuto".to_owned()));
        assert!(rules[0]
            .declaration_keys
            .contains(&"lineHeightPx".to_owned()));
    }

    #[test]
    fn parses_font_face_rules() {
        let faces = parse_font_face_rules(
            r#"@font-face { font-family: "Title"; src: url("../Fonts/title.ttf"); font-weight: 700; }"#,
        );

        assert_eq!(faces.len(), 1);
        assert_eq!(faces[0].family, "Title");
        assert_eq!(faces[0].src, "../Fonts/title.ttf");
        assert_eq!(faces[0].weight.as_deref(), Some("700"));
    }

    #[test]
    fn font_face_parser_preserves_source_order() {
        let faces = parse_font_face_rules(
            r#"
            @font-face { font-family: "Zulu"; src: url("zulu.ttf"); }
            @font-face { font-family: "Alpha"; src: url("alpha.ttf"); }
            "#,
        );

        assert_eq!(
            faces
                .iter()
                .map(|face| face.family.as_str())
                .collect::<Vec<_>>(),
            vec!["Zulu", "Alpha"]
        );
    }

    #[test]
    fn stylesheet_summary_canonicalizes_font_face_hash_order() {
        let zulu_first = summarize_stylesheet_texts([(
            "book.css",
            r#"
            @font-face { font-family: "Zulu"; src: url("zulu.ttf"); }
            @font-face { font-family: "Alpha"; src: url("alpha.ttf"); }
            "#,
        )]);
        let alpha_first = summarize_stylesheet_texts([(
            "book.css",
            r#"
            @font-face { font-family: "Alpha"; src: url("alpha.ttf"); }
            @font-face { font-family: "Zulu"; src: url("zulu.ttf"); }
            "#,
        )]);

        assert_eq!(
            zulu_first.stylesheets[0].font_face_hash,
            alpha_first.stylesheets[0].font_face_hash
        );
    }
}
