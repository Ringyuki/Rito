use std::borrow::Cow;

const HTML_VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

pub(super) fn normalize_xhtml_source(source: &str) -> Cow<'_, str> {
    let normalized = normalize_xml_declaration(source);
    let normalized = normalize_legacy_void_elements(normalized);
    replace_nbsp(normalized)
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
mod tests {
    use super::normalize_xhtml_source;

    #[test]
    fn self_closes_unpaired_legacy_void_elements() {
        let source =
            r#"<head><meta charset="utf-8"></head><body><p>one<br>two</p><hr><img src="x"></body>"#;
        assert_eq!(
            normalize_xhtml_source(source),
            r#"<head><meta charset="utf-8"/></head><body><p>one<br/>two</p><hr/><img src="x"/></body>"#
        );
    }

    #[test]
    fn self_closes_void_elements_before_parent_closing_tags() {
        let source = "<p><span><br></span></p>";
        assert_eq!(normalize_xhtml_source(source), "<p><span><br/></span></p>");
    }

    #[test]
    fn preserves_xml_tag_name_case_like_the_reference_normalizer() {
        let source = r#"<BR><SCRIPT>const sample = "<br>";</SCRIPT>"#;
        assert_eq!(
            normalize_xhtml_source(source),
            r#"<BR><SCRIPT>const sample = "<br/>";</SCRIPT>"#
        );
    }

    #[test]
    fn preserves_self_closed_and_explicitly_closed_void_elements() {
        let source = "<p>one<br/>two<br />three<br></br></p>";
        assert_eq!(normalize_xhtml_source(source), source);
    }

    #[test]
    fn ignores_markup_in_protected_and_raw_text_sections() {
        let source = concat!(
            "<!DOCTYPE html [<!ENTITY sample \"<br>\">]>",
            "<?sample <br>?>",
            "<!-- <br> -->",
            "<![CDATA[<br>]]>",
            "<script>const sample = '<br>';</script>",
            "<style>x::after { content: '<br>'; }</style>",
            "<p title=\"<br>\">actual<br>break</p>"
        );
        assert_eq!(
            normalize_xhtml_source(source),
            source.replace("actual<br>break", "actual<br/>break")
        );
    }

    #[test]
    fn preserves_malformed_non_void_markup_for_strict_parser_errors() {
        let source = "<html><body><p><strong>text</p></body></html>";
        assert_eq!(normalize_xhtml_source(source), source);
    }
}
