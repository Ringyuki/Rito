use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SelectorTarget {
    pub tag: String,
    pub class_name: Option<String>,
    pub id: Option<String>,
    pub attributes: BTreeMap<String, String>,
    pub previous_sibling: Option<Box<SelectorTarget>>,
    pub sibling_index: Option<usize>,
    pub sibling_count: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Combinator {
    Descendant,
    Child,
    AdjacentSibling,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SelectorPart {
    compound: String,
    combinator: Combinator,
}

pub(crate) fn matches_selector(
    target: &SelectorTarget,
    selector: &str,
    ancestors: &[SelectorTarget],
) -> bool {
    let parts = parse_selector_parts(selector);
    let Some(last_part) = parts.last() else {
        return false;
    };
    if !matches_compound(target, &last_part.compound) {
        return false;
    }
    if parts.len() == 1 {
        return true;
    }
    matches_chain(
        &parts[..parts.len() - 1],
        last_part.combinator,
        target,
        ancestors,
    )
}

pub(crate) fn calculate_specificity(selector: &str) -> [usize; 3] {
    let (base, has_pseudo_element) = strip_pseudo_element_suffix(selector);
    let attr_count = attribute_selectors(base).len();
    let pseudo_count = base.matches(":first-child").count() + base.matches(":last-child").count();
    let without_combinators = base.replace(['>', '+'], " ");
    let without_attrs = strip_attribute_selectors(&without_combinators);
    let stripped = strip_pseudo_classes(&without_attrs);
    let mut ids = 0;
    let mut classes = attr_count + pseudo_count;
    let mut elements = usize::from(has_pseudo_element);

    for token in selector_tokens(&stripped) {
        if token.starts_with('#') {
            ids += 1;
        } else if token.starts_with('.') {
            classes += 1;
        } else {
            elements += 1;
        }
    }

    [ids, classes, elements]
}

pub(crate) fn compare_specificity(left: [usize; 3], right: [usize; 3]) -> std::cmp::Ordering {
    left[0]
        .cmp(&right[0])
        .then_with(|| left[1].cmp(&right[1]))
        .then_with(|| left[2].cmp(&right[2]))
}

fn strip_pseudo_element_suffix(selector: &str) -> (&str, bool) {
    for suffix in ["::before", "::after", ":before", ":after"] {
        if selector
            .to_ascii_lowercase()
            .ends_with(&suffix.to_ascii_lowercase())
        {
            return (&selector[..selector.len() - suffix.len()], true);
        }
    }
    (selector, false)
}

fn parse_selector_parts(selector: &str) -> Vec<SelectorPart> {
    let tokens = bracket_aware_split(selector.trim());
    let mut result = Vec::new();
    let mut next_combinator = Combinator::Descendant;

    for token in tokens {
        match token.as_str() {
            ">" => next_combinator = Combinator::Child,
            "+" => next_combinator = Combinator::AdjacentSibling,
            _ => {
                result.push(SelectorPart {
                    compound: token,
                    combinator: next_combinator,
                });
                next_combinator = Combinator::Descendant;
            }
        }
    }

    result
}

fn bracket_aware_split(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut quote = None;

    for ch in input.chars() {
        if depth > 0 && quote.is_none() && (ch == '"' || ch == '\'') {
            quote = Some(ch);
            current.push(ch);
            continue;
        }
        if quote == Some(ch) {
            quote = None;
            current.push(ch);
            continue;
        }
        if ch == '[' {
            depth += 1;
            current.push(ch);
            continue;
        }
        if ch == ']' {
            depth = depth.saturating_sub(1);
            current.push(ch);
            continue;
        }
        if depth > 0 || quote.is_some() {
            current.push(ch);
            continue;
        }

        if ch == '>' || ch == '+' {
            push_selector_token(&mut tokens, &mut current);
            tokens.push(ch.to_string());
        } else if is_selector_whitespace(ch) {
            push_selector_token(&mut tokens, &mut current);
        } else {
            current.push(ch);
        }
    }
    push_selector_token(&mut tokens, &mut current);
    tokens
}

fn push_selector_token(tokens: &mut Vec<String>, current: &mut String) {
    let token = current.trim();
    if !token.is_empty() {
        tokens.push(token.to_owned());
    }
    current.clear();
}

fn is_selector_whitespace(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\n')
}

fn matches_compound(target: &SelectorTarget, compound: &str) -> bool {
    if compound.contains(":first-child") && target.sibling_index != Some(0) {
        return false;
    }
    if compound.contains(":last-child") {
        let Some(index) = target.sibling_index else {
            return false;
        };
        let Some(count) = target.sibling_count else {
            return false;
        };
        if index != count.saturating_sub(1) {
            return false;
        }
    }

    let without_attrs = strip_pseudo_classes(&strip_attribute_selectors(compound));
    let simple_selector = without_attrs.trim();
    let simple_without_star = simple_selector.strip_prefix('*').unwrap_or(simple_selector);
    let tokens = selector_tokens(simple_without_star);

    if tokens.is_empty()
        && simple_selector != "*"
        && !compound.contains('[')
        && !compound.contains(':')
    {
        return false;
    }

    let node_classes = target
        .class_name
        .as_deref()
        .map(|value| value.split_whitespace().collect::<Vec<_>>())
        .unwrap_or_default();

    for token in tokens {
        if let Some(id) = token.strip_prefix('#') {
            if target.id.as_deref() != Some(id) {
                return false;
            }
        } else if let Some(class_name) = token.strip_prefix('.') {
            if !node_classes.contains(&class_name) {
                return false;
            }
        } else if target.tag != token {
            return false;
        }
    }

    !compound.contains('[') || matches_attribute_selectors(target, compound)
}

fn strip_attribute_selectors(compound: &str) -> String {
    let mut output = String::with_capacity(compound.len());
    let mut depth = 0usize;
    let mut quote = None;

    for ch in compound.chars() {
        if depth > 0 && quote.is_none() && (ch == '"' || ch == '\'') {
            quote = Some(ch);
            continue;
        }
        if quote == Some(ch) {
            quote = None;
            continue;
        }
        if ch == '[' {
            depth += 1;
            continue;
        }
        if ch == ']' && depth > 0 {
            depth -= 1;
            continue;
        }
        if depth == 0 {
            output.push(ch);
        }
    }

    output
}

fn strip_pseudo_classes(value: &str) -> String {
    value.replace(":first-child", "").replace(":last-child", "")
}

fn selector_tokens(value: &str) -> Vec<String> {
    let chars = value.chars().collect::<Vec<_>>();
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < chars.len() {
        let start = chars[index];
        let token_start = if start == '#' || start == '.' {
            let Some(next) = chars.get(index + 1) else {
                index += 1;
                continue;
            };
            if !is_ascii_ident_start(*next) {
                index += 1;
                continue;
            }
            index
        } else if is_ascii_ident_start(start) {
            index
        } else {
            index += 1;
            continue;
        };

        index += if start == '#' || start == '.' { 2 } else { 1 };
        while index < chars.len() && is_ascii_ident_continue(chars[index]) {
            index += 1;
        }
        tokens.push(chars[token_start..index].iter().collect());
    }

    tokens
}

fn is_ascii_ident_start(ch: char) -> bool {
    ch.is_ascii_alphabetic()
}

fn is_ascii_ident_continue(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'
}

fn matches_attribute_selectors(target: &SelectorTarget, compound: &str) -> bool {
    attribute_selectors(compound)
        .into_iter()
        .all(|selector| matches_attr_operator(target, &selector))
}

#[derive(Debug, PartialEq, Eq)]
struct AttributeSelector {
    name: String,
    operator: Option<String>,
    value: Option<String>,
}

fn attribute_selectors(compound: &str) -> Vec<AttributeSelector> {
    let mut selectors = Vec::new();
    let mut rest = compound;
    while let Some(start) = rest.find('[') {
        let after_start = &rest[start + 1..];
        let Some(end) = find_attr_end(after_start) else {
            break;
        };
        if let Some(selector) = parse_attribute_selector(&after_start[..end]) {
            selectors.push(selector);
        }
        rest = &after_start[end + 1..];
    }
    selectors
}

fn find_attr_end(value: &str) -> Option<usize> {
    let mut quote = None;
    for (index, ch) in value.char_indices() {
        if quote.is_none() && (ch == '"' || ch == '\'') {
            quote = Some(ch);
            continue;
        }
        if quote == Some(ch) {
            quote = None;
            continue;
        }
        if quote.is_none() && ch == ']' {
            return Some(index);
        }
    }
    None
}

fn parse_attribute_selector(value: &str) -> Option<AttributeSelector> {
    let trimmed = value.trim();
    let name_end = trimmed
        .char_indices()
        .take_while(|(_, ch)| is_attr_name_char(*ch))
        .map(|(index, ch)| index + ch.len_utf8())
        .last()
        .unwrap_or(0);
    if name_end == 0 {
        return None;
    }

    let name = trimmed[..name_end].to_owned();
    let remainder = trimmed[name_end..].trim_start();
    if remainder.is_empty() {
        return Some(AttributeSelector {
            name,
            operator: None,
            value: None,
        });
    }

    let (operator, after_operator) = parse_attr_operator(remainder)?;
    Some(AttributeSelector {
        name,
        operator: Some(operator.to_owned()),
        value: Some(unquote(after_operator.trim()).to_owned()),
    })
}

fn is_attr_name_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, ':' | '_' | '-')
}

fn parse_attr_operator(value: &str) -> Option<(&str, &str)> {
    for operator in ["~=", "|=", "^=", "$=", "*=", "="] {
        if let Some(rest) = value.strip_prefix(operator) {
            return Some((operator, rest));
        }
    }
    None
}

fn unquote(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

fn matches_attr_operator(target: &SelectorTarget, selector: &AttributeSelector) -> bool {
    let actual = target.attributes.get(&selector.name).map(String::as_str);
    match (
        actual,
        selector.operator.as_deref(),
        selector.value.as_deref(),
    ) {
        (Some(_), None, _) => true,
        (None, Some(_), _) => false,
        (Some(actual), Some("="), Some(expected)) => actual == expected,
        (Some(actual), Some("~="), Some(expected)) => {
            actual.split_whitespace().any(|v| v == expected)
        }
        (Some(actual), Some("|="), Some(expected)) => {
            actual == expected || actual.starts_with(&format!("{expected}-"))
        }
        (Some(actual), Some("^="), Some(expected)) => actual.starts_with(expected),
        (Some(actual), Some("$="), Some(expected)) => actual.ends_with(expected),
        (Some(actual), Some("*="), Some(expected)) => actual.contains(expected),
        _ => false,
    }
}

fn matches_chain(
    parts: &[SelectorPart],
    innermost_combinator: Combinator,
    matched_node: &SelectorTarget,
    ancestors: &[SelectorTarget],
) -> bool {
    let mut ancestor_index = 0;
    let mut current_combinator = innermost_combinator;
    let mut current_node = matched_node.clone();

    for part in parts.iter().rev() {
        match current_combinator {
            Combinator::AdjacentSibling => {
                let Some(previous) = current_node.previous_sibling.as_deref() else {
                    return false;
                };
                if !matches_compound(previous, &part.compound) {
                    return false;
                }
                current_node = previous.clone();
            }
            Combinator::Child => {
                let Some(ancestor) = ancestors.get(ancestor_index) else {
                    return false;
                };
                if !matches_compound(ancestor, &part.compound) {
                    return false;
                }
                current_node = ancestor.clone();
                ancestor_index += 1;
            }
            Combinator::Descendant => {
                let mut found = None;
                while ancestor_index < ancestors.len() {
                    let ancestor = &ancestors[ancestor_index];
                    ancestor_index += 1;
                    if matches_compound(ancestor, &part.compound) {
                        found = Some(ancestor.clone());
                        break;
                    }
                }
                let Some(ancestor) = found else {
                    return false;
                };
                current_node = ancestor;
            }
        }
        current_combinator = part.combinator;
    }

    true
}

#[cfg(test)]
mod tests {
    use super::{matches_selector, SelectorTarget};
    use std::collections::BTreeMap;

    #[test]
    fn matches_compound_child_descendant_and_adjacent_selectors() {
        let previous = target("h1", None, None);
        let mut paragraph = target("p", Some("intro lead"), Some("p1"));
        paragraph.previous_sibling = Some(Box::new(previous));
        paragraph.sibling_index = Some(1);
        paragraph.sibling_count = Some(3);
        let ancestor = target("section", Some("chapter"), None);

        assert!(matches_selector(
            &paragraph,
            "section.chapter > p.intro",
            &[ancestor]
        ));
        assert!(matches_selector(&paragraph, "h1 + p#p1", &[]));
        assert!(!matches_selector(&paragraph, "p:first-child", &[]));
    }

    #[test]
    fn matches_attribute_operators() {
        let mut attrs = BTreeMap::new();
        attrs.insert("epub:type".to_owned(), "noteref footnote".to_owned());
        attrs.insert("lang".to_owned(), "zh-Hant".to_owned());
        attrs.insert("href".to_owned(), "../Text/chapter.xhtml#fn1".to_owned());
        let target = SelectorTarget {
            attributes: attrs,
            ..target("a", None, None)
        };

        assert!(matches_selector(&target, r#"a[epub:type~="noteref"]"#, &[]));
        assert!(matches_selector(&target, "a[lang|=zh]", &[]));
        assert!(matches_selector(&target, r##"a[href$="#fn1"]"##, &[]));
        assert!(!matches_selector(&target, r#"a[href^="http"]"#, &[]));
    }

    #[test]
    fn calculates_specificity_for_supported_selector_subset() {
        assert_eq!(super::calculate_specificity("p"), [0, 0, 1]);
        assert_eq!(
            super::calculate_specificity(r#"section#main.note[epub:type~="bodymatter"] p::before"#),
            [1, 2, 3]
        );
        assert!(super::compare_specificity(
            super::calculate_specificity("p.note"),
            super::calculate_specificity("#id")
        )
        .is_lt());
    }

    fn target(tag: &str, class_name: Option<&str>, id: Option<&str>) -> SelectorTarget {
        SelectorTarget {
            tag: tag.to_owned(),
            class_name: class_name.map(ToOwned::to_owned),
            id: id.map(ToOwned::to_owned),
            attributes: BTreeMap::new(),
            previous_sibling: None,
            sibling_index: None,
            sibling_count: None,
        }
    }
}
