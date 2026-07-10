use serde_json::{Map, Value};

use crate::css::{parse_css_declarations_with_viewport, CssViewport};

use super::{
    inheritable_style, insert_number, insert_string, is_display_none, matches_selector,
    merge_style, number_from_style, selector, CascadeRule, CssResolutionContext, SelectorTarget,
    StyledNode, StyledNodeKind,
};

#[derive(Clone)]
struct MatchedPseudoRule {
    raw_declarations: String,
    specificity: [usize; 3],
}

pub(super) fn inject_pseudo_elements(
    children: Vec<StyledNode>,
    parent_style: &Map<String, Value>,
    target: &SelectorTarget,
    rules: &[CascadeRule],
    ancestors: &[SelectorTarget],
    host_is_inline: bool,
    context: CssResolutionContext,
) -> Vec<StyledNode> {
    let mut before = build_pseudo_node(
        "before",
        target,
        parent_style,
        rules,
        ancestors,
        context.root_font_size,
        context.viewport,
    );
    let mut after = build_pseudo_node(
        "after",
        target,
        parent_style,
        rules,
        ancestors,
        context.root_font_size,
        context.viewport,
    );
    if before.is_none() && after.is_none() {
        return children;
    }
    if host_is_inline {
        demote_block_pseudo(&mut before);
        demote_block_pseudo(&mut after);
    }

    let has_block_pseudo = [before.as_ref(), after.as_ref()]
        .into_iter()
        .flatten()
        .any(is_block_style_node);
    let mut output = Vec::new();
    if let Some(node) = before {
        output.push(node);
    }
    if has_block_pseudo && !children.is_empty() {
        output.extend(wrap_inline_runs(children, parent_style));
    } else {
        output.extend(children);
    }
    if let Some(node) = after {
        output.push(node);
    }
    output
}

fn build_pseudo_node(
    pseudo: &str,
    target: &SelectorTarget,
    parent_style: &Map<String, Value>,
    rules: &[CascadeRule],
    ancestors: &[SelectorTarget],
    root_font_size: f64,
    viewport: Option<CssViewport>,
) -> Option<StyledNode> {
    let mut matches = Vec::new();
    let mut content_text: Option<Option<String>> = None;
    let mut content_specificity = [0, 0, 0];

    for rule in rules {
        if extract_pseudo_element(&rule.selector).as_deref() != Some(pseudo) {
            continue;
        }
        let base = strip_pseudo_element(&rule.selector);
        if !base.is_empty() && !matches_selector(target, &base, ancestors) {
            continue;
        }
        if let Some(parsed) = parse_content_value(&rule.raw_declarations) {
            if selector::compare_specificity(rule.specificity, content_specificity)
                != std::cmp::Ordering::Less
            {
                content_text = Some(parsed);
                content_specificity = rule.specificity;
            }
        }
        matches.push(MatchedPseudoRule {
            raw_declarations: rule.raw_declarations.clone(),
            specificity: rule.specificity,
        });
    }

    let content = content_text.flatten()?;
    if matches.is_empty() {
        return None;
    }
    matches
        .sort_by(|left, right| selector::compare_specificity(left.specificity, right.specificity));
    let style = resolve_pseudo_style(&matches, parent_style, root_font_size, viewport);
    if is_display_none(&style) {
        return None;
    }
    let node_type = if style.get("display").and_then(Value::as_str) == Some("block") {
        StyledNodeKind::Block
    } else {
        StyledNodeKind::Inline
    };
    Some(StyledNode {
        node_type,
        tag: None,
        content: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: style.clone(),
        children: vec![synthetic_text_node(content, style)],
        source_ref: None,
    })
}

fn resolve_pseudo_style(
    matches: &[MatchedPseudoRule],
    parent_style: &Map<String, Value>,
    root_font_size: f64,
    viewport: Option<CssViewport>,
) -> Map<String, Value> {
    let parent_font_size = number_from_style(parent_style, "fontSize").unwrap_or(16.0);
    let mut style = inheritable_style(parent_style);
    insert_string(&mut style, "display", "inline");
    let mut resolved_font_size = number_from_style(&style, "fontSize").unwrap_or(parent_font_size);
    for rule in matches {
        let declarations = parse_css_declarations_with_viewport(
            &rule.raw_declarations,
            parent_font_size,
            root_font_size,
            viewport,
        );
        if let Some(font_size) = number_from_style(&declarations, "fontSize") {
            resolved_font_size = font_size;
        }
    }
    insert_number(&mut style, "fontSize", resolved_font_size);
    for rule in matches {
        let declarations = parse_css_declarations_with_viewport(
            &rule.raw_declarations,
            resolved_font_size,
            root_font_size,
            viewport,
        );
        merge_style(&mut style, &declarations);
        insert_number(&mut style, "fontSize", resolved_font_size);
    }
    style
}

fn synthetic_text_node(content: String, style: Map<String, Value>) -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Text,
        tag: None,
        content: Some(content),
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style,
        children: Vec::new(),
        source_ref: None,
    }
}

fn demote_block_pseudo(node: &mut Option<StyledNode>) {
    let Some(node) = node else {
        return;
    };
    if node.style.get("display").and_then(Value::as_str) == Some("block") {
        node.node_type = StyledNodeKind::Inline;
        insert_string(&mut node.style, "display", "inline");
    }
}

fn is_block_style_node(node: &StyledNode) -> bool {
    node.node_type == StyledNodeKind::Block
        && node.style.get("display").and_then(Value::as_str) != Some("inline-block")
}

fn wrap_inline_runs(
    children: Vec<StyledNode>,
    parent_style: &Map<String, Value>,
) -> Vec<StyledNode> {
    let mut output = Vec::new();
    let mut inline_run = Vec::new();
    for child in children {
        if is_block_style_node(&child) {
            flush_inline_run(&mut output, &mut inline_run, parent_style);
            output.push(child);
        } else {
            inline_run.push(child);
        }
    }
    flush_inline_run(&mut output, &mut inline_run, parent_style);
    output
}

fn flush_inline_run(
    output: &mut Vec<StyledNode>,
    inline_run: &mut Vec<StyledNode>,
    parent_style: &Map<String, Value>,
) {
    if inline_run.is_empty() {
        return;
    }
    output.push(StyledNode {
        node_type: StyledNodeKind::Block,
        tag: None,
        content: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: inheritable_style(parent_style),
        children: std::mem::take(inline_run),
        source_ref: None,
    });
}

fn extract_pseudo_element(selector: &str) -> Option<String> {
    for suffix in ["::before", ":before", "::after", ":after"] {
        if selector.to_ascii_lowercase().ends_with(suffix) {
            return Some(suffix.trim_start_matches(':').to_owned());
        }
    }
    None
}

fn strip_pseudo_element(selector: &str) -> String {
    for suffix in ["::before", ":before", "::after", ":after"] {
        if selector.to_ascii_lowercase().ends_with(suffix) {
            return selector[..selector.len() - suffix.len()].trim().to_owned();
        }
    }
    selector.trim().to_owned()
}

fn parse_content_value(raw_declarations: &str) -> Option<Option<String>> {
    for declaration in split_content_declarations(raw_declarations) {
        let Some((property, value)) = declaration.split_once(':') else {
            continue;
        };
        if !property.trim().eq_ignore_ascii_case("content") {
            continue;
        }
        let value = strip_content_important(value);
        if value == "none" || value == "normal" {
            return Some(None);
        }
        return extract_content_strings(value).map(Some);
    }
    None
}

fn split_content_declarations(input: &str) -> Vec<&str> {
    let mut output = Vec::new();
    let mut quote = None;
    let mut escaped = false;
    let mut start = 0;
    for (index, character) in input.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' && quote.is_some() {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            }
            continue;
        }
        match character {
            '"' | '\'' => quote = Some(character),
            ';' => {
                let item = input[start..index].trim();
                if !item.is_empty() {
                    output.push(item);
                }
                start = index + character.len_utf8();
            }
            _ => {}
        }
    }
    let item = input[start..].trim();
    if !item.is_empty() {
        output.push(item);
    }
    output
}

fn strip_content_important(value: &str) -> &str {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.ends_with("!important") {
        trimmed[..trimmed.len() - "!important".len()].trim_end()
    } else {
        trimmed
    }
}

fn extract_content_strings(value: &str) -> Option<String> {
    let mut result = String::new();
    let mut found = false;
    let mut chars = value.char_indices().peekable();
    while let Some((_, character)) = chars.next() {
        if !matches!(character, '"' | '\'') {
            continue;
        }
        found = true;
        let quote = character;
        let mut raw = String::new();
        let mut escaped = false;
        for (_, ch) in chars.by_ref() {
            if escaped {
                raw.push('\\');
                raw.push(ch);
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == quote {
                break;
            }
            raw.push(ch);
        }
        result.push_str(&resolve_unicode_escapes(&raw));
    }
    found.then_some(result)
}

fn resolve_unicode_escapes(raw: &str) -> String {
    let mut output = String::new();
    let mut chars = raw.char_indices().peekable();
    while let Some((_, character)) = chars.next() {
        if character != '\\' {
            output.push(character);
            continue;
        }
        let mut hex = String::new();
        while let Some((_, next)) = chars.peek().copied() {
            if hex.len() >= 6 || !next.is_ascii_hexdigit() {
                break;
            }
            hex.push(next);
            chars.next();
        }
        if hex.is_empty() {
            output.push('\\');
            continue;
        }
        if matches!(chars.peek(), Some((_, next)) if next.is_whitespace()) {
            chars.next();
        }
        if let Ok(codepoint) = u32::from_str_radix(&hex, 16) {
            if let Some(ch) = char::from_u32(codepoint) {
                output.push(ch);
            }
        }
    }
    output
}
