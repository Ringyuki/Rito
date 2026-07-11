use std::{borrow::Cow, collections::BTreeMap};

use roxmltree::{Document, Node};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::{
    source_normalizer::normalize_xhtml_source, DocumentNode, ElementAttributes, ElementNode,
    ImageNode, ParseResult, SourceRef, TextNode, XhtmlChapterSummary, XhtmlNodeCounts,
    XhtmlSummary,
};

pub fn parse_xhtml(source: &str) -> Result<ParseResult, String> {
    let normalized = normalize_xhtml_source(source);
    let cleaned = strip_doctype(normalized.as_ref());
    let document =
        Document::parse(cleaned.as_ref()).map_err(|error| format!("Invalid XHTML: {error}"))?;
    let body = document
        .descendants()
        .find(|node| has_tag(node, "body"))
        .unwrap_or_else(|| document.root_element());

    let mut warnings = Vec::new();
    let nodes = convert_children(body, &mut warnings, false, &[]);

    let stylesheet_hrefs = extract_stylesheet_hrefs(&document);
    let embedded_stylesheets = extract_embedded_stylesheets(&document);
    Ok(ParseResult {
        nodes,
        warnings,
        body_attributes: extract_attributes(body),
        stylesheet_hrefs: (!stylesheet_hrefs.is_empty()).then_some(stylesheet_hrefs),
        embedded_stylesheets: (!embedded_stylesheets.is_empty()).then_some(embedded_stylesheets),
    })
}

pub(crate) fn summarize_parsed_chapters(
    chapters: impl IntoIterator<Item = (String, String, ParseResult)>,
) -> XhtmlSummary {
    let chapter_summaries: Vec<XhtmlChapterSummary> = chapters
        .into_iter()
        .map(|(idref, href, parsed)| summarize_chapter(idref, href, &parsed))
        .collect();

    XhtmlSummary {
        chapter_count: chapter_summaries.len(),
        full_detail_hash: full_detail_hash(&chapter_summaries),
        chapters: chapter_summaries,
    }
}

fn summarize_chapter(idref: String, href: String, parsed: &ParseResult) -> XhtmlChapterSummary {
    let detail = parse_result_value(parsed);
    let mut state = SummaryState::default();
    for node in &parsed.nodes {
        walk_node(node, 1, &mut state);
    }

    XhtmlChapterSummary {
        idref,
        href,
        attribute_counts: state.attribute_counts,
        body_attributes: parsed.body_attributes.clone(),
        counts: state.counts,
        first_text: crop_text(
            state
                .text_runs
                .first()
                .map(String::as_str)
                .unwrap_or_default(),
        ),
        image_sources: state.image_sources,
        last_text: crop_text(
            state
                .text_runs
                .last()
                .map(String::as_str)
                .unwrap_or_default(),
        ),
        max_depth: state.max_depth,
        stylesheet_hrefs: parsed.stylesheet_hrefs.clone(),
        embedded_stylesheets: parsed.embedded_stylesheets.clone(),
        tag_counts: state.tag_counts,
        text_hash: hash_text(&state.text_runs.concat()),
        top_level_count: parsed.nodes.len(),
        warning_count: parsed.warnings.len(),
        warnings_hash: hash_json(&Value::Array(
            parsed
                .warnings
                .iter()
                .map(|warning| Value::String(warning.clone()))
                .collect(),
        )),
        detail_hash: hash_json(&detail),
    }
}

#[derive(Default)]
struct SummaryState {
    attribute_counts: BTreeMap<String, usize>,
    counts: XhtmlNodeCounts,
    image_sources: Vec<String>,
    max_depth: usize,
    tag_counts: BTreeMap<String, usize>,
    text_runs: Vec<String>,
}

fn walk_node(node: &DocumentNode, depth: usize, state: &mut SummaryState) {
    state.max_depth = state.max_depth.max(depth);
    match node {
        DocumentNode::Block(element) => {
            state.counts.block += 1;
            walk_element(element, depth, state);
        }
        DocumentNode::Inline(element) => {
            state.counts.inline += 1;
            walk_element(element, depth, state);
        }
        DocumentNode::Text(text) => {
            state.counts.text += 1;
            state.text_runs.push(text.content.clone());
        }
        DocumentNode::Image(image) => {
            state.counts.image += 1;
            count_attributes(&image.attributes, state);
            state.image_sources.push(image.src.clone());
        }
    }
}

fn walk_element(element: &ElementNode, depth: usize, state: &mut SummaryState) {
    *state.tag_counts.entry(element.tag.clone()).or_default() += 1;
    count_attributes(&element.attributes, state);
    for child in &element.children {
        walk_node(child, depth + 1, state);
    }
}

fn count_attributes(attributes: &Option<ElementAttributes>, state: &mut SummaryState) {
    if attributes.is_none() {
        return;
    }

    for key in [
        "allAttributes",
        "class",
        "colspan",
        "href",
        "id",
        "language",
        "rowspan",
        "style",
    ] {
        *state.attribute_counts.entry(key.to_owned()).or_default() += 1;
    }
}

fn convert_children(
    parent: Node<'_, '_>,
    warnings: &mut Vec<String>,
    preserve_whitespace: bool,
    parent_path: &[usize],
) -> Vec<DocumentNode> {
    let mut result = Vec::new();
    let mut emitted_index = 0;

    for child in parent.children() {
        let mut child_path = parent_path.to_vec();
        child_path.push(emitted_index);
        let Some(node) = convert_node(child, warnings, preserve_whitespace, child_path) else {
            continue;
        };

        if let DocumentNode::Inline(inline) = &node {
            if inline
                .children
                .iter()
                .any(|child| matches!(child, DocumentNode::Block(_)))
            {
                for child in &inline.children {
                    result.push(merge_unwrapped_child(child, inline));
                    emitted_index += 1;
                }
                continue;
            }
        }

        result.push(node);
        emitted_index += 1;
    }

    result
}

fn convert_node(
    node: Node<'_, '_>,
    warnings: &mut Vec<String>,
    preserve_whitespace: bool,
    node_path: Vec<usize>,
) -> Option<DocumentNode> {
    if node.is_text() {
        return convert_text_node(
            node.text().unwrap_or_default(),
            preserve_whitespace,
            node_path,
        );
    }

    if node.is_element() {
        return convert_element(node, warnings, preserve_whitespace, node_path);
    }

    None
}

fn convert_text_node(
    raw: &str,
    preserve_whitespace: bool,
    node_path: Vec<usize>,
) -> Option<DocumentNode> {
    if !preserve_whitespace {
        if is_whitespace_only(raw) {
            return (!raw.is_empty()).then(|| {
                text_node_with_source(
                    " ".to_owned(),
                    (raw != " ").then(|| raw.to_owned()),
                    node_path,
                )
            });
        }
        let content = collapse_whitespace(raw);
        let source_text = (content != raw).then(|| raw.to_owned());
        return Some(text_node_with_source(content, source_text, node_path));
    }

    (!raw.is_empty()).then(|| text_node(raw.to_owned(), node_path))
}

fn convert_element(
    element: Node<'_, '_>,
    warnings: &mut Vec<String>,
    preserve_whitespace: bool,
    node_path: Vec<usize>,
) -> Option<DocumentNode> {
    let tag = element.tag_name().name();
    let source_ref = SourceRef {
        node_path: node_path.clone(),
    };

    if tag == "svg" {
        return convert_svg_image(element, warnings, source_ref);
    }

    match classify_tag(tag) {
        TagClassification::Ignored => {
            warnings.push(format!(
                "Unsupported element <{}> skipped",
                warning_tag(tag)
            ));
            None
        }
        TagClassification::Block => Some(DocumentNode::Block(ElementNode {
            tag: tag.to_owned(),
            attributes: extract_attributes(element),
            children: convert_children(
                element,
                warnings,
                preserve_whitespace || tag == "pre",
                &node_path,
            ),
            source_ref,
        })),
        TagClassification::Inline if tag == "br" => Some(text_node("\n".to_owned(), node_path)),
        TagClassification::Inline if tag == "img" => {
            image_node_from_element(element, source_ref, image_src(element, "src")?)
        }
        TagClassification::Inline => Some(DocumentNode::Inline(ElementNode {
            tag: tag.to_owned(),
            attributes: extract_attributes(element),
            children: convert_children(
                element,
                warnings,
                preserve_whitespace || tag == "pre",
                &node_path,
            ),
            source_ref,
        })),
    }
}

fn convert_svg_image(
    element: Node<'_, '_>,
    warnings: &mut Vec<String>,
    source_ref: SourceRef,
) -> Option<DocumentNode> {
    let Some(image) = element.descendants().find(|node| has_tag(node, "image")) else {
        warnings.push("Unsupported element <SVG> skipped".to_owned());
        return None;
    };
    let Some(src) = svg_image_href(image) else {
        warnings.push("Unsupported element <SVG> skipped".to_owned());
        return None;
    };
    (!src.is_empty()).then(|| {
        DocumentNode::Image(ImageNode {
            src,
            alt: String::new(),
            attributes: None,
            source_ref,
        })
    })
}

fn image_node_from_element(
    element: Node<'_, '_>,
    source_ref: SourceRef,
    src: String,
) -> Option<DocumentNode> {
    (!src.is_empty()).then(|| {
        DocumentNode::Image(ImageNode {
            src,
            alt: image_alt(element),
            attributes: extract_attributes(element),
            source_ref,
        })
    })
}

fn image_src(element: Node<'_, '_>, name: &str) -> Option<String> {
    element
        .attribute(name)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn svg_image_href(element: Node<'_, '_>) -> Option<String> {
    element
        .attribute((XLINK_NAMESPACE, "href"))
        .or_else(|| element.attribute("href"))
        .or_else(|| element.attribute("xlink:href"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn image_alt(element: Node<'_, '_>) -> String {
    element
        .attribute("alt")
        .or_else(|| element.attribute("aria-label"))
        .unwrap_or_default()
        .to_owned()
}

fn merge_unwrapped_child(child: &DocumentNode, inline: &ElementNode) -> DocumentNode {
    let DocumentNode::Block(block) = child else {
        return child.clone();
    };

    let merged = merge_anchor_attrs(
        block.attributes.clone(),
        inline
            .attributes
            .as_ref()
            .and_then(|attrs| attrs.href.clone()),
        inline
            .attributes
            .as_ref()
            .and_then(|attrs| attrs.style.clone()),
    );

    DocumentNode::Block(ElementNode {
        attributes: merged,
        ..block.clone()
    })
}

fn merge_anchor_attrs(
    attributes: Option<ElementAttributes>,
    href: Option<String>,
    anchor_style: Option<String>,
) -> Option<ElementAttributes> {
    if href.is_none() && anchor_style.is_none() {
        return attributes;
    }

    let mut result = attributes.unwrap_or_else(empty_attributes);
    if result.href.is_none() {
        result.href = href;
    }
    if let Some(style) = anchor_style {
        result.style = Some(match result.style {
            Some(existing) => format!("{style}; {existing}"),
            None => style,
        });
    }
    Some(result)
}

fn extract_attributes(element: Node<'_, '_>) -> Option<ElementAttributes> {
    let all_attributes = collect_all_attributes(element);
    let attributes = ElementAttributes {
        all_attributes,
        class: attr(element, "class"),
        colspan: table_span(element, "colspan"),
        href: (element.tag_name().name() == "a")
            .then(|| attr(element, "href"))
            .flatten(),
        id: attr(element, "id"),
        language: language_attr(element),
        rowspan: table_span(element, "rowspan"),
        style: attr(element, "style"),
    };

    has_any_attribute(&attributes).then_some(attributes)
}

fn collect_all_attributes(element: Node<'_, '_>) -> Option<BTreeMap<String, String>> {
    let mut map = BTreeMap::new();
    for attribute in element.attributes() {
        map.insert(
            attribute_name(attribute.name(), attribute.namespace()),
            attribute.value().to_owned(),
        );
    }
    (!map.is_empty()).then_some(map)
}

fn attribute_name(name: &str, namespace: Option<&str>) -> String {
    let prefix = match namespace {
        Some(EPUB_OPS_NAMESPACE) => Some("epub"),
        Some(XML_NAMESPACE) => Some("xml"),
        Some(XLINK_NAMESPACE) => Some("xlink"),
        _ => None,
    };

    match prefix {
        Some(prefix) => format!("{prefix}:{name}"),
        None => name.to_owned(),
    }
}

fn attr(element: Node<'_, '_>, name: &str) -> Option<String> {
    element.attribute(name).map(ToOwned::to_owned)
}

fn language_attr(element: Node<'_, '_>) -> Option<String> {
    element
        .attributes()
        .find(|attribute| {
            attribute.name() == "lang"
                || attribute.name() == "xml:lang"
                || (attribute.name() == "lang" && attribute.namespace() == Some(XML_NAMESPACE))
        })
        .map(|attribute| attribute.value().to_owned())
}

fn table_span(element: Node<'_, '_>, name: &str) -> Option<u32> {
    let tag = element.tag_name().name();
    if tag != "td" && tag != "th" {
        return None;
    }

    element
        .attribute(name)
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 1)
}

fn has_any_attribute(attributes: &ElementAttributes) -> bool {
    attributes.all_attributes.is_some()
        || attributes.class.is_some()
        || attributes.colspan.is_some()
        || attributes.href.is_some()
        || attributes.id.is_some()
        || attributes.language.is_some()
        || attributes.rowspan.is_some()
        || attributes.style.is_some()
}

fn extract_stylesheet_hrefs(document: &Document<'_>) -> Vec<String> {
    document
        .descendants()
        .filter(|node| {
            has_tag(node, "link")
                && node.attribute("rel").is_some_and(|rel| {
                    rel.split_whitespace()
                        .any(|token| token.eq_ignore_ascii_case("stylesheet"))
                })
        })
        .filter_map(|node| node.attribute("href").map(ToOwned::to_owned))
        .collect()
}

fn extract_embedded_stylesheets(document: &Document<'_>) -> Vec<String> {
    document
        .descendants()
        .filter(|node| has_tag(node, "style"))
        .filter_map(|node| {
            let css = node
                .descendants()
                .filter(|descendant| descendant.is_text())
                .filter_map(|descendant| descendant.text())
                .collect::<String>();
            let css = css.trim();
            (!css.is_empty()).then(|| css.to_owned())
        })
        .collect()
}

fn text_node(content: String, node_path: Vec<usize>) -> DocumentNode {
    text_node_with_source(content, None, node_path)
}

fn text_node_with_source(
    content: String,
    source_text: Option<String>,
    node_path: Vec<usize>,
) -> DocumentNode {
    DocumentNode::Text(TextNode {
        content,
        source_text,
        source_ref: SourceRef { node_path },
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TagClassification {
    Block,
    Inline,
    Ignored,
}

fn classify_tag(tag: &str) -> TagClassification {
    if BLOCK_TAGS.contains(&tag) {
        TagClassification::Block
    } else if IGNORED_TAGS.contains(&tag) {
        TagClassification::Ignored
    } else {
        TagClassification::Inline
    }
}

fn warning_tag(tag: &str) -> &str {
    if tag == "svg" {
        "SVG"
    } else {
        tag
    }
}

const BLOCK_TAGS: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "details",
    "dialog",
    "dd",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hgroup",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
];

const IGNORED_TAGS: &[&str] = &[
    "audio", "canvas", "embed", "iframe", "map", "math", "noscript", "object", "picture", "script",
    "style", "svg", "template", "video",
];

const EPUB_OPS_NAMESPACE: &str = "http://www.idpf.org/2007/ops";
const XML_NAMESPACE: &str = "http://www.w3.org/XML/1998/namespace";
const XLINK_NAMESPACE: &str = "http://www.w3.org/1999/xlink";

fn strip_doctype(source: &str) -> Cow<'_, str> {
    let Some(start) = source.find("<!DOCTYPE") else {
        return Cow::Borrowed(source);
    };
    let tail = &source[start..];
    let Some(end) = doctype_end(tail) else {
        return Cow::Borrowed(source);
    };

    let mut output = String::with_capacity(source.len().saturating_sub(end));
    output.push_str(&source[..start]);
    output.push_str(&source[start + end..]);
    Cow::Owned(output)
}

fn doctype_end(value: &str) -> Option<usize> {
    value
        .find("]>")
        .map(|index| index + 2)
        .or_else(|| value.find('>').map(|index| index + 1))
}

fn collapse_whitespace(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_whitespace = false;
    for ch in value.chars() {
        if is_html_whitespace(ch) {
            if !in_whitespace {
                output.push(' ');
                in_whitespace = true;
            }
        } else {
            output.push(ch);
            in_whitespace = false;
        }
    }
    output
}

fn is_whitespace_only(value: &str) -> bool {
    value.chars().all(is_html_whitespace)
}

fn is_html_whitespace(ch: char) -> bool {
    matches!(ch, '\t' | '\n' | '\u{000C}' | '\r' | ' ')
}

fn has_tag(node: &Node<'_, '_>, local_name: &str) -> bool {
    node.is_element() && node.tag_name().name() == local_name
}

fn empty_attributes() -> ElementAttributes {
    ElementAttributes {
        all_attributes: None,
        class: None,
        colspan: None,
        href: None,
        id: None,
        language: None,
        rowspan: None,
        style: None,
    }
}

fn parse_result_value(parsed: &ParseResult) -> Value {
    json!({
        "bodyAttributes": attributes_value(&parsed.body_attributes),
        "nodes": parsed.nodes.iter().map(node_value).collect::<Vec<_>>(),
        "embeddedStylesheets": parsed.embedded_stylesheets,
        "stylesheetHrefs": parsed.stylesheet_hrefs,
        "warnings": parsed.warnings,
    })
}

fn node_value(node: &DocumentNode) -> Value {
    match node {
        DocumentNode::Text(text) => json!({
            "content": text.content,
            "sourceRef": source_ref_value(&text.source_ref),
            "type": "text",
        }),
        DocumentNode::Image(image) => json!({
            "alt": image.alt,
            "attributes": attributes_value(&image.attributes),
            "sourceRef": source_ref_value(&image.source_ref),
            "src": image.src,
            "type": "image",
        }),
        DocumentNode::Block(element) => element_value("block", element),
        DocumentNode::Inline(element) => element_value("inline", element),
    }
}

fn element_value(kind: &str, element: &ElementNode) -> Value {
    json!({
        "attributes": attributes_value(&element.attributes),
        "children": element.children.iter().map(node_value).collect::<Vec<_>>(),
        "sourceRef": source_ref_value(&element.source_ref),
        "tag": element.tag,
        "type": kind,
    })
}

fn attributes_value(attributes: &Option<ElementAttributes>) -> Value {
    let Some(attributes) = attributes else {
        return Value::Null;
    };

    json!({
        "allAttributes": attributes.all_attributes,
        "class": attributes.class,
        "colspan": attributes.colspan,
        "href": attributes.href,
        "id": attributes.id,
        "language": attributes.language,
        "rowspan": attributes.rowspan,
        "style": attributes.style,
    })
}

fn source_ref_value(source_ref: &SourceRef) -> Value {
    json!({ "nodePath": source_ref.node_path })
}

fn full_detail_hash(chapters: &[XhtmlChapterSummary]) -> String {
    let details = chapters
        .iter()
        .map(|chapter| {
            json!({
                "detailHash": chapter.detail_hash,
                "href": chapter.href,
                "idref": chapter.idref,
            })
        })
        .collect::<Vec<_>>();
    hash_json(&Value::Array(details))
}

fn hash_text(text: &str) -> String {
    short_sha256(text.as_bytes())
}

fn hash_json(value: &Value) -> String {
    let text = format!("{}\n", stable_json(value, 0));
    hash_text(&text)
}

fn short_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
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

fn crop_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_xhtml;

    #[test]
    fn parses_body_nodes_and_stylesheet_links() {
        let parsed = parse_xhtml(
            r#"<?xml version='1.0' encoding='utf-8'?>
            <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "xhtml11.dtd">
            <html><head><link href="../style.css" rel="stylesheet"/></head>
            <body class="body"><p>Hello <span class="x">world</span></p></body></html>"#,
        )
        .expect("xhtml");

        assert_eq!(
            parsed.stylesheet_hrefs,
            Some(vec!["../style.css".to_owned()])
        );
        assert!(parsed.embedded_stylesheets.is_none());
        assert_eq!(parsed.nodes.len(), 1);
        assert_eq!(
            parsed
                .body_attributes
                .and_then(|attributes| attributes.class),
            Some("body".to_owned())
        );
    }

    #[test]
    fn preserves_embedded_stylesheet_order_and_missing_link_semantics() {
        let parsed = parse_xhtml(
            r#"<html><head>
            <style> body { font-size: 14px; } </style>
            <style><![CDATA[p { color: red; }]]></style>
            </head><body><p>Text</p></body></html>"#,
        )
        .expect("xhtml");

        assert!(parsed.stylesheet_hrefs.is_none());
        assert_eq!(
            parsed.embedded_stylesheets,
            Some(vec![
                "body { font-size: 14px; }".to_owned(),
                "p { color: red; }".to_owned(),
            ])
        );
    }

    #[test]
    fn converts_svg_image_to_image_node() {
        let parsed = parse_xhtml(
            r#"<html xmlns:xlink="http://www.w3.org/1999/xlink"><body><svg><image xlink:href="../Images/cover.jpg" aria-label="Cover"/></svg></body></html>"#,
        )
        .expect("xhtml");

        assert!(parsed.warnings.is_empty());
        let super::DocumentNode::Image(image) = &parsed.nodes[0] else {
            panic!("expected image");
        };
        assert_eq!(image.src, "../Images/cover.jpg");
        assert_eq!(image.alt, "");
        assert!(image.attributes.is_none());
    }

    #[test]
    fn preserves_known_namespace_attribute_prefixes() {
        let parsed = parse_xhtml(
            r#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><aside epub:type="footnote" xml:lang="ja" id="n1"></aside></body></html>"#,
        )
        .expect("xhtml");

        let super::DocumentNode::Block(block) = &parsed.nodes[0] else {
            panic!("expected block");
        };
        let attributes = block.attributes.as_ref().expect("attributes");
        let all_attributes = attributes.all_attributes.as_ref().expect("all attributes");

        assert_eq!(
            all_attributes.get("epub:type"),
            Some(&"footnote".to_owned())
        );
        assert_eq!(all_attributes.get("xml:lang"), Some(&"ja".to_owned()));
        assert_eq!(attributes.language, Some("ja".to_owned()));
    }

    #[test]
    fn retains_original_text_when_default_whitespace_normalization_changes_it() {
        let parsed = parse_xhtml("<html><body><p>a   \n  b</p><pre>c   \n  d</pre></body></html>")
            .expect("xhtml");

        let super::DocumentNode::Block(paragraph) = &parsed.nodes[0] else {
            panic!("expected paragraph");
        };
        let super::DocumentNode::Text(text) = &paragraph.children[0] else {
            panic!("expected paragraph text");
        };
        assert_eq!(text.content, "a b");
        assert_eq!(text.source_text.as_deref(), Some("a   \n  b"));

        let super::DocumentNode::Block(pre) = &parsed.nodes[1] else {
            panic!("expected pre");
        };
        let super::DocumentNode::Text(text) = &pre.children[0] else {
            panic!("expected pre text");
        };
        assert_eq!(text.content, "c   \n  d");
        assert_eq!(text.source_text, None);
    }

    #[test]
    fn parses_legacy_html_void_elements_without_relaxing_xml_structure() {
        let parsed =
            parse_xhtml(r#"<html><body><p>Before<br>After<img src="cover.jpg"></p></body></html>"#)
                .expect("legacy void elements are normalized");

        let super::DocumentNode::Block(paragraph) = &parsed.nodes[0] else {
            panic!("expected paragraph");
        };
        assert!(matches!(
            paragraph.children.as_slice(),
            [
                super::DocumentNode::Text(before),
                super::DocumentNode::Text(line_break),
                super::DocumentNode::Text(after),
                super::DocumentNode::Image(image)
            ] if before.content == "Before"
                && line_break.content == "\n"
                && after.content == "After"
                && image.src == "cover.jpg"
        ));
        assert!(parse_xhtml("<html><body><p><strong>text</p></body></html>").is_err());
    }
}
