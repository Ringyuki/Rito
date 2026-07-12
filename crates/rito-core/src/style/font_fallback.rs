use std::collections::BTreeSet;

use serde_json::Value;

use super::StyledNode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FontGenericRole {
    Serif,
    SansSerif,
    Monospace,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct FontFallbackFace<'a> {
    pub(crate) alias: &'a str,
    pub(crate) role: FontGenericRole,
    pub(crate) language: &'a str,
}

#[derive(Debug)]
pub(crate) struct FontFallbackPolicy<'a> {
    pub(crate) faces: Vec<FontFallbackFace<'a>>,
    pub(crate) package_language: &'a str,
    pub(crate) available_publication_families: BTreeSet<String>,
}

impl FontFallbackPolicy<'_> {
    pub(crate) fn set_available_publication_families(&mut self, families: BTreeSet<String>) {
        self.available_publication_families = families;
    }
}

pub(crate) fn rewrite_font_families(nodes: &mut [StyledNode], policy: &FontFallbackPolicy<'_>) {
    for node in nodes {
        rewrite_node_font_family(node, policy);
        rewrite_font_families(&mut node.children, policy);
    }
}

fn rewrite_node_font_family(node: &mut StyledNode, policy: &FontFallbackPolicy<'_>) {
    let Some(Value::String(family)) = node.style.get("fontFamily") else {
        return;
    };
    let language = node
        .style
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("und");
    let rewritten = rewrite_family_list(family, language, policy);
    if rewritten != *family {
        node.style
            .insert("fontFamily".to_owned(), Value::String(rewritten));
    }
}

fn rewrite_family_list(
    family: &str,
    element_language: &str,
    policy: &FontFallbackPolicy<'_>,
) -> String {
    let mut parts = parse_family_list(family)
        .into_iter()
        .filter(|part| retain_original_family(part, policy))
        .collect::<Vec<_>>();
    let first_generic = parts
        .iter()
        .enumerate()
        .find_map(|(index, part)| generic_kind(part).map(|kind| (index, kind)));
    let (index, role, append_generic) = match first_generic {
        Some((_, GenericKind::Unmapped)) => return serialize_family_parts(&parts),
        Some((index, GenericKind::Mapped(role))) => (index, role, false),
        None => (parts.len(), FontGenericRole::Serif, true),
    };
    let aliases = ordered_aliases(policy, role, element_language);
    if aliases.is_empty() {
        if append_generic && parts.is_empty() {
            parts.push(FamilyPart::injected("serif"));
        }
        return serialize_family_parts(&parts);
    }
    if chain_precedes(&parts, index, &aliases) {
        return serialize_family_parts(&parts);
    }
    parts.splice(index..index, aliases.into_iter().map(FamilyPart::injected));
    if append_generic {
        parts.push(FamilyPart::injected("serif"));
    }
    serialize_family_parts(&parts)
}

fn retain_original_family(part: &FamilyPart, policy: &FontFallbackPolicy<'_>) -> bool {
    generic_kind(part).is_some()
        || (!part.quoted && policy.faces.iter().any(|face| face.alias == part.value))
        || policy
            .available_publication_families
            .contains(&part.value.to_ascii_lowercase())
}

fn serialize_family_parts(parts: &[FamilyPart]) -> String {
    parts
        .iter()
        .map(|part| part.raw.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

fn ordered_aliases<'a>(
    policy: &'a FontFallbackPolicy<'a>,
    role: FontGenericRole,
    element_language: &str,
) -> Vec<&'a str> {
    let language = effective_language(element_language, policy.package_language);
    let mut aliases = Vec::new();
    let mut included = BTreeSet::new();
    for candidate in language_parents(&language)
        .into_iter()
        .chain(std::iter::once("und"))
    {
        append_language_aliases(policy, role, candidate, &mut aliases, &mut included);
    }
    for face in policy.faces.iter().filter(|face| face.role == role) {
        if included.insert(face.alias) {
            aliases.push(face.alias);
        }
    }
    aliases
}

fn append_language_aliases<'a>(
    policy: &'a FontFallbackPolicy<'a>,
    role: FontGenericRole,
    language: &str,
    aliases: &mut Vec<&'a str>,
    included: &mut BTreeSet<&'a str>,
) {
    for face in policy
        .faces
        .iter()
        .filter(|face| face.role == role && face.language == language)
    {
        if included.insert(face.alias) {
            aliases.push(face.alias);
        }
    }
}

fn effective_language(element: &str, package: &str) -> String {
    normalize_language(element)
        .filter(|language| language != "und")
        .or_else(|| normalize_language(package))
        .unwrap_or_else(|| "und".to_owned())
}

fn normalize_language(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 63
        || !value.is_ascii()
        || value.split('-').any(|subtag| {
            subtag.is_empty()
                || subtag.len() > 8
                || !subtag.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
    {
        return None;
    }
    Some(value.to_ascii_lowercase())
}

fn language_parents(language: &str) -> Vec<&str> {
    if language == "und" {
        return Vec::new();
    }
    let mut parents = vec![language];
    let mut end = language.len();
    while let Some(index) = language[..end].rfind('-') {
        end = index;
        parents.push(&language[..end]);
    }
    parents
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FamilyPart {
    raw: String,
    value: String,
    quoted: bool,
}

impl FamilyPart {
    fn injected(value: &str) -> Self {
        Self {
            raw: value.to_owned(),
            value: value.to_owned(),
            quoted: false,
        }
    }
}

fn parse_family_list(input: &str) -> Vec<FamilyPart> {
    split_family_parts(input)
        .into_iter()
        .filter_map(parse_family_part)
        .collect()
}

fn split_family_parts(input: &str) -> Vec<&str> {
    let mut output = Vec::new();
    let mut start = 0;
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in input.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        match quote {
            Some(active) if active == character => quote = None,
            Some(_) => {}
            None if matches!(character, '\'' | '"') => quote = Some(character),
            None if character == ',' => {
                output.push(&input[start..index]);
                start = index + character.len_utf8();
            }
            None => {}
        }
    }
    output.push(&input[start..]);
    output
}

fn parse_family_part(raw: &str) -> Option<FamilyPart> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let quoted = quoted_family_value(raw);
    Some(FamilyPart {
        raw: raw.to_owned(),
        value: quoted.clone().unwrap_or_else(|| raw.to_owned()),
        quoted: quoted.is_some(),
    })
}

fn quoted_family_value(raw: &str) -> Option<String> {
    let quote = raw.chars().next()?;
    if !matches!(quote, '\'' | '"') {
        return None;
    }
    let mut escaped = false;
    let mut value = String::new();
    let mut characters = raw[quote.len_utf8()..].chars();
    while let Some(character) = characters.next() {
        if escaped {
            value.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == quote {
            return characters.as_str().trim().is_empty().then_some(value);
        } else {
            value.push(character);
        }
    }
    None
}

fn generic_role(part: &FamilyPart) -> Option<FontGenericRole> {
    if part.quoted {
        return None;
    }
    match part.value.to_ascii_lowercase().as_str() {
        "serif" | "ui-serif" | "fangsong" => Some(FontGenericRole::Serif),
        "sans-serif" | "system-ui" | "ui-sans-serif" | "ui-rounded" => {
            Some(FontGenericRole::SansSerif)
        }
        "monospace" | "ui-monospace" => Some(FontGenericRole::Monospace),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy)]
enum GenericKind {
    Mapped(FontGenericRole),
    Unmapped,
}

fn generic_kind(part: &FamilyPart) -> Option<GenericKind> {
    generic_role(part).map(GenericKind::Mapped).or_else(|| {
        (!part.quoted
            && matches!(
                part.value.to_ascii_lowercase().as_str(),
                "cursive" | "fantasy" | "emoji" | "math"
            ))
        .then_some(GenericKind::Unmapped)
    })
}

fn chain_precedes(parts: &[FamilyPart], generic_index: usize, aliases: &[&str]) -> bool {
    generic_index >= aliases.len()
        && parts[generic_index - aliases.len()..generic_index]
            .iter()
            .zip(aliases)
            .all(|(part, alias)| !part.quoted && part.value == *alias)
}

#[cfg(test)]
mod tests;
