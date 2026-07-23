use std::borrow::Cow;

const HTML_VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

pub(crate) fn normalize_xhtml_source(source: &str) -> Cow<'_, str> {
    let normalized = normalize_xml_declaration(source);
    let normalized = strip_document_type(normalized);
    let normalized = normalize_legacy_void_elements(normalized);
    let normalized = replace_nbsp(normalized);
    sanitize_character_data(normalized)
}

/// Removes XML document-type declarations before the XML parser sees them.
///
/// Rito does not resolve publication DTDs. Keeping the declaration while
/// enabling internal entities would permit text expansion far beyond the
/// bounded source size and node count. References to DTD-defined entities are
/// intentionally left in place so the strict parser rejects them.
fn strip_document_type(source: Cow<'_, str>) -> Cow<'_, str> {
    let mut ranges = Vec::new();
    let mut cursor = 0;
    while cursor < source.len() {
        let Some(relative_start) = source[cursor..].find('<') else {
            break;
        };
        let start = cursor + relative_start;
        let tail = &source[start..];
        if tail.starts_with("<!--") {
            cursor = find_delimited_end(source.as_ref(), start + 4, "-->");
            continue;
        }
        if tail.starts_with("<![CDATA[") {
            cursor = find_delimited_end(source.as_ref(), start + 9, "]]>");
            continue;
        }
        if tail.starts_with("<?") {
            cursor = find_delimited_end(source.as_ref(), start + 2, "?>");
            continue;
        }
        if is_document_type_start(tail) {
            let end = find_declaration_end(source.as_ref(), start + 2);
            ranges.push(start..end);
            cursor = end;
            continue;
        }
        cursor = start + 1;
    }
    if ranges.is_empty() {
        return source;
    }
    let removed_bytes = ranges.iter().map(|range| range.len()).sum::<usize>();
    let mut output = String::with_capacity(source.len().saturating_sub(removed_bytes));
    let mut copied = 0;
    for range in ranges {
        output.push_str(&source[copied..range.start]);
        copied = range.end;
    }
    output.push_str(&source[copied..]);
    Cow::Owned(output)
}

fn is_document_type_start(tail: &str) -> bool {
    let Some(remainder) = tail.strip_prefix("<!DOCTYPE") else {
        return false;
    };
    remainder
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_whitespace)
}

#[derive(Debug)]
struct ScannedTag {
    end: usize,
    name: String,
    closing: bool,
    self_closing: bool,
}

#[derive(Debug)]
struct VoidCandidate {
    insertion_index: usize,
    closed: bool,
}

#[derive(Debug)]
struct OpenElement {
    name: String,
    candidate_index: Option<usize>,
}

fn normalize_legacy_void_elements(source: Cow<'_, str>) -> Cow<'_, str> {
    let insertions = find_unpaired_void_elements(source.as_ref());
    if insertions.is_empty() {
        return source;
    }
    let mut output = String::with_capacity(source.len() + insertions.len());
    let mut cursor = 0;
    for insertion in insertions {
        output.push_str(&source[cursor..insertion]);
        output.push('/');
        cursor = insertion;
    }
    output.push_str(&source[cursor..]);
    Cow::Owned(output)
}

fn find_unpaired_void_elements(source: &str) -> Vec<usize> {
    let mut candidates = Vec::<VoidCandidate>::new();
    let mut stack = Vec::<OpenElement>::new();
    let mut cursor = 0;
    while cursor < source.len() {
        let Some(relative_start) = source[cursor..].find('<') else {
            break;
        };
        let start = cursor + relative_start;
        if let Some(end) = find_protected_section_end(source, start) {
            cursor = end;
            continue;
        }
        let Some(tag) = scan_tag(source, start) else {
            cursor = start + 1;
            continue;
        };
        if !tag.closing && !tag.self_closing && matches!(tag.name.as_str(), "script" | "style") {
            cursor = find_raw_text_element_end(source, &tag);
            continue;
        }
        update_element_stack(&tag, &mut stack, &mut candidates);
        cursor = tag.end;
    }
    candidates
        .into_iter()
        .filter(|candidate| !candidate.closed)
        .map(|candidate| candidate.insertion_index)
        .collect()
}

fn update_element_stack(
    tag: &ScannedTag,
    stack: &mut Vec<OpenElement>,
    candidates: &mut Vec<VoidCandidate>,
) {
    if tag.self_closing {
        return;
    }
    if tag.closing {
        let Some(open) = stack.last() else {
            return;
        };
        if open.name != tag.name {
            return;
        }
        let candidate_index = open.candidate_index;
        stack.pop();
        if let Some(index) = candidate_index {
            candidates[index].closed = true;
        }
        return;
    }
    let candidate_index = HTML_VOID_ELEMENTS.contains(&tag.name.as_str()).then(|| {
        candidates.push(VoidCandidate {
            insertion_index: tag.end - 1,
            closed: false,
        });
        candidates.len() - 1
    });
    stack.push(OpenElement {
        name: tag.name.clone(),
        candidate_index,
    });
}

fn scan_tag(source: &str, start: usize) -> Option<ScannedTag> {
    let bytes = source.as_bytes();
    let mut cursor = start.checked_add(1)?;
    let closing = bytes.get(cursor) == Some(&b'/');
    if closing {
        cursor += 1;
    }
    let name_start = cursor;
    while let Some(byte) = bytes.get(cursor) {
        if is_tag_name_boundary(*byte) {
            break;
        }
        cursor += 1;
    }
    if cursor == name_start {
        return None;
    }
    let end = find_tag_end(source, cursor)?;
    Some(ScannedTag {
        end,
        name: source[name_start..cursor].to_owned(),
        closing,
        self_closing: is_self_closing_tag(source, end),
    })
}

fn find_tag_end(source: &str, start: usize) -> Option<usize> {
    let mut quote = None;
    for (offset, byte) in source.as_bytes()[start..].iter().enumerate() {
        if let Some(expected) = quote {
            if *byte == expected {
                quote = None;
            }
        } else if matches!(*byte, b'\'' | b'"') {
            quote = Some(*byte);
        } else if *byte == b'>' {
            return Some(start + offset + 1);
        }
    }
    None
}

fn is_tag_name_boundary(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'/' | b'>')
}

fn is_self_closing_tag(source: &str, end: usize) -> bool {
    source.as_bytes()[..end - 1]
        .iter()
        .rev()
        .find(|byte| !byte.is_ascii_whitespace())
        == Some(&b'/')
}

fn find_protected_section_end(source: &str, start: usize) -> Option<usize> {
    let tail = &source[start..];
    if tail.starts_with("<!--") {
        return Some(find_delimited_end(source, start + 4, "-->"));
    }
    if tail.starts_with("<![CDATA[") {
        return Some(find_delimited_end(source, start + 9, "]]>"));
    }
    if tail.starts_with("<?") {
        return Some(find_delimited_end(source, start + 2, "?>"));
    }
    tail.starts_with("<!")
        .then(|| find_declaration_end(source, start + 2))
}

fn find_delimited_end(source: &str, start: usize, delimiter: &str) -> usize {
    source[start..]
        .find(delimiter)
        .map_or(source.len(), |offset| start + offset + delimiter.len())
}

fn find_declaration_end(source: &str, start: usize) -> usize {
    let mut quote = None;
    let mut subset_depth = 0_usize;
    for (offset, byte) in source.as_bytes()[start..].iter().enumerate() {
        if let Some(expected) = quote {
            if *byte == expected {
                quote = None;
            }
        } else if matches!(*byte, b'\'' | b'"') {
            quote = Some(*byte);
        } else if *byte == b'[' {
            subset_depth += 1;
        } else if *byte == b']' {
            subset_depth = subset_depth.saturating_sub(1);
        } else if *byte == b'>' && subset_depth == 0 {
            return start + offset + 1;
        }
    }
    source.len()
}

fn find_raw_text_element_end(source: &str, opening_tag: &ScannedTag) -> usize {
    let mut cursor = opening_tag.end;
    while cursor < source.len() {
        let Some(relative_start) = source[cursor..].find('<') else {
            return source.len();
        };
        let start = cursor + relative_start;
        if let Some(tag) = scan_tag(source, start) {
            if tag.closing && tag.name == opening_tag.name {
                return tag.end;
            }
        }
        cursor = start + 1;
    }
    source.len()
}

fn normalize_xml_declaration(source: &str) -> Cow<'_, str> {
    let Some(rest) = source.strip_prefix("<?xml") else {
        return Cow::Borrowed(source);
    };
    let Some(end) = rest.find("?>") else {
        return Cow::Borrowed(source);
    };
    let declaration = &rest[..end];
    if !declaration.contains('\'') {
        return Cow::Borrowed(source);
    }
    let mut output = String::with_capacity(source.len());
    output.push_str("<?xml");
    output.push_str(&declaration.replace('\'', "\""));
    output.push_str("?>");
    output.push_str(&rest[end + 2..]);
    Cow::Owned(output)
}

fn replace_nbsp(source: Cow<'_, str>) -> Cow<'_, str> {
    if !source.contains("&nbsp;") {
        return source;
    }
    Cow::Owned(source.replace("&nbsp;", "&#160;"))
}

/// Repairs character data real publications get wrong the way an HTML
/// parser would, so a stray byte never blanks a chapter:
///
/// - a bare `&` (or one starting a reference this engine cannot resolve)
///   becomes `&amp;` and renders literally, exactly as browsers render an
///   undefined entity reference;
/// - a known HTML named entity becomes its character;
/// - a character reference to an XML-invalid code point, and every raw
///   control character XML forbids, is dropped — browsers keep such bytes
///   in the DOM but render nothing for them.
///
/// Comments, CDATA sections, and processing instructions pass through
/// untouched: `&` is legal there.
fn sanitize_character_data(source: Cow<'_, str>) -> Cow<'_, str> {
    let bytes = source.as_bytes();
    let mut output: Option<String> = None;
    let mut copied = 0;
    let mut cursor = 0;
    let mut edit = |output: &mut Option<String>, start: usize, end: usize, replacement: &str| {
        let buffer = output.get_or_insert_with(|| String::with_capacity(source.len() + 16));
        buffer.push_str(&source[copied..start]);
        buffer.push_str(replacement);
        copied = end;
    };
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'<' => {
                if let Some(end) = find_protected_section_end(source.as_ref(), cursor) {
                    cursor = end;
                } else {
                    cursor += 1;
                }
            }
            b'&' => {
                let (end, replacement) = resolve_ampersand(source.as_ref(), cursor);
                match replacement {
                    AmpersandRepair::Keep => {}
                    AmpersandRepair::Replace(text) => {
                        edit(&mut output, cursor, end, &text);
                    }
                }
                cursor = end;
            }
            byte if byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r') => {
                edit(&mut output, cursor, cursor + 1, "");
                cursor += 1;
            }
            _ => cursor += 1,
        }
    }
    match output {
        Some(mut buffer) => {
            buffer.push_str(&source[copied..]);
            Cow::Owned(buffer)
        }
        None => source,
    }
}

enum AmpersandRepair {
    Keep,
    Replace(String),
}

/// Classifies the reference starting at `&`, returning the byte offset
/// after the consumed input and how to repair it.
fn resolve_ampersand(source: &str, start: usize) -> (usize, AmpersandRepair) {
    let tail = &source[start + 1..];
    let semicolon = tail
        .char_indices()
        .take(40)
        .find(|(_, character)| *character == ';')
        .map(|(offset, _)| offset);
    let Some(semicolon) = semicolon else {
        return (start + 1, AmpersandRepair::Replace("&amp;".to_owned()));
    };
    let name = &tail[..semicolon];
    let end = start + 1 + semicolon + 1;
    if let Some(digits) = name.strip_prefix('#') {
        let code_point = if let Some(hex) = digits.strip_prefix(['x', 'X']) {
            u32::from_str_radix(hex, 16).ok()
        } else {
            digits.parse::<u32>().ok()
        };
        return match code_point.and_then(char::from_u32) {
            Some(character) if is_xml_character(character) => (end, AmpersandRepair::Keep),
            // Numeric reference to a forbidden or unassigned code point:
            // drop it, matching the invisible rendering browsers give it.
            _ => (end, AmpersandRepair::Replace(String::new())),
        };
    }
    if !name.is_empty()
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        if matches!(name, "amp" | "lt" | "gt" | "quot" | "apos") {
            return (end, AmpersandRepair::Keep);
        }
        if let Some(replacement) = html_named_entity(name) {
            return (end, AmpersandRepair::Replace(replacement.to_owned()));
        }
    }
    (start + 1, AmpersandRepair::Replace("&amp;".to_owned()))
}

/// XML 1.0 `Char` production.
fn is_xml_character(character: char) -> bool {
    matches!(character,
        '\u{9}' | '\u{A}' | '\u{D}'
        | '\u{20}'..='\u{D7FF}'
        | '\u{E000}'..='\u{FFFD}'
        | '\u{10000}'..='\u{10FFFF}')
}

/// The HTML named entities observed in real publications. An entity not
/// listed here renders literally through the `&amp;` repair, which is also
/// what browsers do for names HTML never defined.
fn html_named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "hellip" => "\u{2026}",
        "mdash" => "\u{2014}",
        "ndash" => "\u{2013}",
        "ldquo" => "\u{201C}",
        "rdquo" => "\u{201D}",
        "lsquo" => "\u{2018}",
        "rsquo" => "\u{2019}",
        "sbquo" => "\u{201A}",
        "bdquo" => "\u{201E}",
        "laquo" => "\u{AB}",
        "raquo" => "\u{BB}",
        "middot" => "\u{B7}",
        "bull" => "\u{2022}",
        "dagger" => "\u{2020}",
        "Dagger" => "\u{2021}",
        "permil" => "\u{2030}",
        "prime" => "\u{2032}",
        "Prime" => "\u{2033}",
        "copy" => "\u{A9}",
        "reg" => "\u{AE}",
        "trade" => "\u{2122}",
        "deg" => "\u{B0}",
        "plusmn" => "\u{B1}",
        "times" => "\u{D7}",
        "divide" => "\u{F7}",
        "minus" => "\u{2212}",
        "sect" => "\u{A7}",
        "para" => "\u{B6}",
        "micro" => "\u{B5}",
        "cent" => "\u{A2}",
        "pound" => "\u{A3}",
        "yen" => "\u{A5}",
        "euro" => "\u{20AC}",
        "curren" => "\u{A4}",
        "iexcl" => "\u{A1}",
        "iquest" => "\u{BF}",
        "frac14" => "\u{BC}",
        "frac12" => "\u{BD}",
        "frac34" => "\u{BE}",
        "sup1" => "\u{B9}",
        "sup2" => "\u{B2}",
        "sup3" => "\u{B3}",
        "ordf" => "\u{AA}",
        "ordm" => "\u{BA}",
        "shy" => "\u{AD}",
        "emsp" => "\u{2003}",
        "ensp" => "\u{2002}",
        "thinsp" => "\u{2009}",
        "zwnj" => "\u{200C}",
        "zwj" => "\u{200D}",
        "lrm" => "\u{200E}",
        "rlm" => "\u{200F}",
        "larr" => "\u{2190}",
        "uarr" => "\u{2191}",
        "rarr" => "\u{2192}",
        "darr" => "\u{2193}",
        "harr" => "\u{2194}",
        "infin" => "\u{221E}",
        "ne" => "\u{2260}",
        "le" => "\u{2264}",
        "ge" => "\u{2265}",
        "asymp" => "\u{2248}",
        "equiv" => "\u{2261}",
        "loz" => "\u{25CA}",
        "spades" => "\u{2660}",
        "clubs" => "\u{2663}",
        "hearts" => "\u{2665}",
        "diams" => "\u{2666}",
        "oline" => "\u{203E}",
        "frasl" => "\u{2044}",
        "szlig" => "\u{DF}",
        "star" => "\u{2606}",
        _ => return None,
    })
}

#[cfg(test)]
#[path = "normalizer_tests.rs"]
mod tests;
