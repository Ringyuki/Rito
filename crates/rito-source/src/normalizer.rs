use std::borrow::Cow;

const HTML_VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

pub(crate) fn normalize_xhtml_source(source: &str) -> Cow<'_, str> {
    let normalized = normalize_xml_declaration(source);
    let normalized = strip_document_type(normalized);
    let normalized = normalize_legacy_void_elements(normalized);
    replace_nbsp(normalized)
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

#[cfg(test)]
#[path = "normalizer_tests.rs"]
mod tests;
