use std::collections::BTreeMap;
use std::sync::Arc;

use rito_source::{
    NodeId, SourceArena, SourceAttribute, SourceElement, SourceNode, SourceNodeKind,
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::{
    DocumentNode, ElementAttributes, ElementNode, ImageNode, ParseResult, ParsedXhtmlSource,
    SourceRef, TextNode, XhtmlChapterSummary, XhtmlNodeCounts, XhtmlSummary,
};

pub fn parse_xhtml(source: &str) -> Result<ParseResult, String> {
    let ParsedXhtmlSource {
        source_arena: _,
        mut parsed,
    } = parse_xhtml_with_source(source)?;
    // The compatibility API returns no arena, so do not expose orphaned IDs.
    clear_source_node_ids(&mut parsed.nodes);
    parsed.body_source_node_id = None;
    Ok(parsed)
}

/// Parses XHTML once and retains the exact arena used to derive the semantic
/// tree. This is the production boundary for consumers that require stable
/// source-node identity, including the replacement CSS engine.
pub(crate) fn parse_xhtml_with_source(source: &str) -> Result<ParsedXhtmlSource, String> {
    let source_arena = Arc::new(
        SourceArena::from_xhtml(source).map_err(|error| format!("Invalid XHTML: {error}"))?,
    );
    let parsed = parse_xhtml_from_source(&source_arena);
    Ok(ParsedXhtmlSource {
        source_arena,
        parsed,
    })
}

/// Derives Rito's layout-oriented semantic tree from an existing canonical
/// source arena without parsing XHTML again.
pub(crate) fn parse_xhtml_from_source(source: &SourceArena) -> ParseResult {
    let document = Node::new(source, source.document());
    let body = document
        .descendants()
        .find(|node| has_tag(node, "body"))
        .unwrap_or_else(|| Node::new(source, source.root_element()));

    let mut warnings = Vec::new();
    let nodes = convert_children(body, &mut warnings, false, &[]);

    let author_stylesheets = extract_author_stylesheets(document);
    let stylesheet_hrefs = author_stylesheets
        .iter()
        .filter_map(|source| match source {
            super::AuthorStylesheetSource::External { href, .. } => Some(href.clone()),
            super::AuthorStylesheetSource::Embedded { .. } => None,
        })
        .collect::<Vec<_>>();
    let embedded_stylesheets = author_stylesheets
        .iter()
        .filter_map(|source| match source {
            super::AuthorStylesheetSource::External { .. } => None,
            super::AuthorStylesheetSource::Embedded { css, .. } => Some(css.clone()),
        })
        .collect::<Vec<_>>();
    let body_attributes = extract_attributes(body);
    ParseResult {
        nodes,
        warnings,
        body_attributes,
        body_source_node_id: Some(body.id),
        stylesheet_hrefs: (!stylesheet_hrefs.is_empty()).then_some(stylesheet_hrefs),
        embedded_stylesheets: (!embedded_stylesheets.is_empty()).then_some(embedded_stylesheets),
        author_stylesheets,
    }
}

fn clear_source_node_ids(nodes: &mut [DocumentNode]) {
    for node in nodes {
        match node {
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                element.source_ref.source_node_id = None;
                clear_source_node_ids(&mut element.children);
            }
            DocumentNode::Text(text) => text.source_ref.source_node_id = None,
            DocumentNode::Image(image) => image.source_ref.source_node_id = None,
        }
    }
}

#[derive(Clone, Copy)]
struct Node<'a> {
    source: &'a SourceArena,
    id: NodeId,
}

impl<'a> Node<'a> {
    fn new(source: &'a SourceArena, id: NodeId) -> Self {
        Self { source, id }
    }

    fn record(self) -> &'a SourceNode {
        self.source
            .node(self.id)
            .expect("source node id must belong to its arena")
    }

    fn element(self) -> Option<&'a SourceElement> {
        self.record().as_element()
    }

    fn is_element(self) -> bool {
        self.element().is_some()
    }

    fn is_text(self) -> bool {
        matches!(self.record().kind, SourceNodeKind::Text(_))
    }

    fn text(self) -> Option<&'a str> {
        self.record().as_text()
    }

    fn tag_name(self) -> &'a str {
        &self
            .element()
            .expect("element node required")
            .name
            .local_name
    }

    fn attribute(self, local_name: &str) -> Option<&'a str> {
        self.element()?.attribute(local_name)
    }

    fn attribute_ns(self, namespace: &str, local_name: &str) -> Option<&'a str> {
        self.element()?.attribute_ns(Some(namespace), local_name)
    }

    fn attributes(self) -> std::slice::Iter<'a, SourceAttribute> {
        let attributes: &'a [SourceAttribute] = self
            .element()
            .map_or(&[], |element| element.attributes.as_ref());
        attributes.iter()
    }

    fn children(self) -> impl Iterator<Item = Self> + 'a {
        self.source
            .children(self.id)
            .map(|(id, _)| Self::new(self.source, id))
    }

    fn descendants(self) -> impl Iterator<Item = Self> + 'a {
        self.source
            .descendants(self.id)
            .map(|(id, _)| Self::new(self.source, id))
    }
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
    parent: Node<'_>,
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
    node: Node<'_>,
    warnings: &mut Vec<String>,
    preserve_whitespace: bool,
    node_path: Vec<usize>,
) -> Option<DocumentNode> {
    if node.is_text() {
        return convert_text_node(
            node.text().unwrap_or_default(),
            preserve_whitespace,
            node_path,
            node.id,
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
    source_node_id: NodeId,
) -> Option<DocumentNode> {
    if !preserve_whitespace {
        if is_whitespace_only(raw) {
            return (!raw.is_empty()).then(|| {
                text_node_with_source(
                    " ".to_owned(),
                    (raw != " ").then(|| raw.to_owned()),
                    node_path,
                    source_node_id,
                )
            });
        }
        let content = collapse_whitespace(raw);
        let source_text = (content != raw).then(|| raw.to_owned());
        return Some(text_node_with_source(
            content,
            source_text,
            node_path,
            source_node_id,
        ));
    }

    (!raw.is_empty()).then(|| text_node(raw.to_owned(), node_path, source_node_id))
}

fn convert_element(
    element: Node<'_>,
    warnings: &mut Vec<String>,
    preserve_whitespace: bool,
    node_path: Vec<usize>,
) -> Option<DocumentNode> {
    let tag = element.tag_name();
    let source_ref = SourceRef {
        node_path: node_path.clone(),
        source_node_id: Some(element.id),
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
        TagClassification::Inline if tag == "br" => {
            Some(text_node("\n".to_owned(), node_path, element.id))
        }
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
    element: Node<'_>,
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
            // `width` and `height` on `<svg>` are presentation attributes
            // that map to the CSS properties (SVG 2 §7.2), and they are
            // what sizes the SVG-wrapped image idiom: `width="100%"` fits
            // the flow and the intrinsic ratio gives the height. Dropping
            // them left the page at the raster's own pixel height.
            attributes: svg_presentation_attributes(element),
            source_ref,
            // SVG 2 §8.6: the viewport sizes from width/height, and the
            // content fits per preserveAspectRatio — the default
            // `xMidYMid meet` letterboxes; only `none` stretches with the
            // viewport.
            svg_contain: element
                .attribute("preserveAspectRatio")
                .map(|value| !value.trim().eq_ignore_ascii_case("none"))
                .unwrap_or(true),
            svg_viewport: svg_intrinsic_viewport(element),
        })
    })
}

/// The SVG's intrinsic dimensions: the `viewBox` size when present, else
/// absolute (unit-less or px) `width`/`height` attributes. Percentages
/// carry no intrinsic size.
fn svg_intrinsic_viewport(element: Node<'_>) -> Option<(f64, f64)> {
    if let Some(view_box) = element.attribute("viewBox") {
        let numbers: Vec<f64> = view_box
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<f64>().ok())
            .collect();
        if let [_, _, width, height] = numbers.as_slice() {
            if *width > 0.0 && *height > 0.0 {
                return Some((*width, *height));
            }
        }
    }
    let absolute = |name: &str| -> Option<f64> {
        let value = element.attribute(name)?.trim();
        let value = value.strip_suffix("px").unwrap_or(value);
        let parsed = value.parse::<f64>().ok()?;
        (parsed > 0.0).then_some(parsed)
    };
    match (absolute("width"), absolute("height")) {
        (Some(width), Some(height)) => Some((width, height)),
        _ => None,
    }
}

/// The `<svg>` element's attributes with its geometry presentation
/// attributes folded into the inline style, so the CSS sizing that follows
/// sees the width and height the author declared on the SVG.
fn svg_presentation_attributes(element: Node<'_>) -> Option<ElementAttributes> {
    let mut declarations = String::new();
    for property in ["width", "height"] {
        let Some(value) = element.attribute(property).map(str::trim) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        // A bare number on an SVG geometry attribute is a user-unit length.
        let value = if value.chars().all(|c| c.is_ascii_digit() || c == '.') {
            format!("{value}px")
        } else {
            value.to_owned()
        };
        declarations.push_str(&format!("{property}:{value};"));
    }
    let mut attributes = extract_attributes(element).unwrap_or(ElementAttributes {
        all_attributes: None,
        class: None,
        colspan: None,
        href: None,
        id: None,
        language: None,
        rowspan: None,
        style: None,
    });
    if !declarations.is_empty() {
        attributes.style = Some(match attributes.style {
            // The inline style wins over a presentation attribute, so the
            // author's own declarations come last.
            Some(style) => format!("{declarations}{style}"),
            None => declarations,
        });
    }
    has_any_attribute(&attributes).then_some(attributes)
}

fn image_node_from_element(
    element: Node<'_>,
    source_ref: SourceRef,
    src: String,
) -> Option<DocumentNode> {
    (!src.is_empty()).then(|| {
        DocumentNode::Image(ImageNode {
            src,
            alt: image_alt(element),
            attributes: extract_attributes(element),
            source_ref,
            svg_contain: false,
            svg_viewport: None,
        })
    })
}

fn image_src(element: Node<'_>, name: &str) -> Option<String> {
    element
        .attribute(name)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn svg_image_href(element: Node<'_>) -> Option<String> {
    element
        .attribute_ns(XLINK_NAMESPACE, "href")
        .or_else(|| element.attribute("href"))
        .or_else(|| element.attribute("xlink:href"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn image_alt(element: Node<'_>) -> String {
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

fn extract_attributes(element: Node<'_>) -> Option<ElementAttributes> {
    let all_attributes = collect_all_attributes(element);
    let attributes = ElementAttributes {
        all_attributes,
        class: attr(element, "class"),
        colspan: table_span(element, "colspan"),
        href: (element.tag_name() == "a")
            .then(|| attr(element, "href"))
            .flatten(),
        id: attr(element, "id"),
        language: language_attr(element),
        rowspan: table_span(element, "rowspan"),
        style: attr(element, "style"),
    };

    has_any_attribute(&attributes).then_some(attributes)
}

fn collect_all_attributes(element: Node<'_>) -> Option<BTreeMap<String, String>> {
    let mut map = BTreeMap::new();
    for attribute in element.attributes() {
        map.insert(
            attribute_name(
                &attribute.name.local_name,
                attribute.name.namespace.as_deref(),
            ),
            attribute.value.clone(),
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

fn attr(element: Node<'_>, name: &str) -> Option<String> {
    element.attribute(name).map(ToOwned::to_owned)
}

fn language_attr(element: Node<'_>) -> Option<String> {
    element
        .attributes()
        .find(|attribute| {
            attribute.name.local_name == "lang"
                && (attribute.name.namespace.is_none()
                    || attribute.name.namespace.as_deref() == Some(XML_NAMESPACE))
        })
        .map(|attribute| attribute.value.clone())
}

fn table_span(element: Node<'_>, name: &str) -> Option<u32> {
    let tag = element.tag_name();
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

fn extract_author_stylesheets(document: Node<'_>) -> Vec<super::AuthorStylesheetSource> {
    document
        .descendants()
        .filter_map(|node| {
            if has_tag(&node, "link")
                && node.attribute("rel").is_some_and(|rel| {
                    rel.split_whitespace()
                        .any(|token| token.eq_ignore_ascii_case("stylesheet"))
                })
            {
                return node.attribute("href").map(|href| {
                    super::AuthorStylesheetSource::External {
                        source_node_id: node.id,
                        href: href.to_owned(),
                        selection_issues: stylesheet_selection_issues(node, true),
                        media_environment_issues: stylesheet_media_environment_issues(node, true),
                    }
                });
            }
            if !has_tag(&node, "style") {
                return None;
            }
            let css = node
                .descendants()
                .filter(|descendant| descendant.is_text())
                .filter_map(|descendant| descendant.text())
                .collect::<String>();
            let css = css.trim();
            (!css.is_empty()).then(|| super::AuthorStylesheetSource::Embedded {
                source_node_id: node.id,
                css: css.to_owned(),
                selection_issues: stylesheet_selection_issues(node, false),
                media_environment_issues: stylesheet_media_environment_issues(node, false),
            })
        })
        .collect()
}

fn stylesheet_selection_issues(node: Node<'_>, is_link: bool) -> Vec<String> {
    let mut issues = Vec::new();
    let kind = if is_link { "link" } else { "style" };
    if is_link
        && node.attribute("rel").is_some_and(|rel| {
            rel.split_whitespace()
                .any(|token| token.eq_ignore_ascii_case("alternate"))
        })
    {
        issues.push("alternate stylesheet activation is not modeled".to_owned());
    }
    if node.attribute("disabled").is_some() {
        issues.push(format!("{kind} disabled state is not modeled"));
    }
    if let Some(content_type) = node.attribute("type").map(str::trim) {
        if !content_type.is_empty() && !content_type.eq_ignore_ascii_case("text/css") {
            issues.push(format!("{kind} stylesheet type is not CSS: {content_type}"));
        }
    }
    if !is_link && node.attribute("scoped").is_some() {
        issues.push("scoped style applicability is not modeled".to_owned());
    }
    issues
}

fn stylesheet_media_environment_issues(node: Node<'_>, is_link: bool) -> Vec<String> {
    let kind = if is_link { "link" } else { "style" };
    node.attribute("media")
        .map(str::trim)
        .filter(|media| !media.is_empty() && !media.eq_ignore_ascii_case("all"))
        .map(|media| {
            vec![format!(
                "{kind} media applicability is not modeled: {media}"
            )]
        })
        .unwrap_or_default()
}

fn text_node(content: String, node_path: Vec<usize>, source_node_id: NodeId) -> DocumentNode {
    text_node_with_source(content, None, node_path, source_node_id)
}

fn text_node_with_source(
    content: String,
    source_text: Option<String>,
    node_path: Vec<usize>,
    source_node_id: NodeId,
) -> DocumentNode {
    DocumentNode::Text(TextNode {
        content,
        source_text,
        source_ref: SourceRef {
            node_path,
            source_node_id: Some(source_node_id),
        },
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TagClassification {
    Block,
    Inline,
    Ignored,
}

pub(super) fn classify_tag(tag: &str) -> TagClassification {
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

fn has_tag(node: &Node<'_>, local_name: &str) -> bool {
    node.is_element() && node.tag_name() == local_name
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
    use std::sync::Arc;

    use rito_source::SourceArena;

    use super::{parse_xhtml, parse_xhtml_from_source, parse_xhtml_with_source, DocumentNode};
    use crate::xhtml::AuthorStylesheetSource;

    #[test]
    fn derives_semantic_nodes_from_the_callers_exact_source_arena() {
        let source = Arc::new(
            SourceArena::from_xhtml("<html><body><p id='target'>shared</p></body></html>")
                .expect("source arena"),
        );
        let paragraph_id = source.find_element_by_id("target").expect("paragraph id");
        let text_id = source.children(paragraph_id).next().expect("text child").0;
        let parsed = parse_xhtml_from_source(&source);
        let DocumentNode::Block(paragraph) = &parsed.nodes[0] else {
            panic!("expected paragraph");
        };
        assert_eq!(paragraph.source_ref.source_node_id, Some(paragraph_id));
        let DocumentNode::Text(text) = &paragraph.children[0] else {
            panic!("expected text");
        };
        assert_eq!(text.source_ref.source_node_id, Some(text_id));
    }

    #[test]
    fn owned_parse_keeps_the_arena_that_owns_projected_node_ids() {
        let parsed_source =
            parse_xhtml_with_source("<html><body><p id='target'>shared</p></body></html>")
                .expect("owned XHTML parse");
        let paragraph_id = parsed_source
            .source_arena
            .find_element_by_id("target")
            .expect("paragraph id");
        let DocumentNode::Block(paragraph) = &parsed_source.parsed.nodes[0] else {
            panic!("expected paragraph");
        };
        assert_eq!(paragraph.source_ref.source_node_id, Some(paragraph_id));

        let compatibility =
            parse_xhtml("<html><body><p id='target'>shared</p></body></html>").expect("XHTML");
        let DocumentNode::Block(paragraph) = &compatibility.nodes[0] else {
            panic!("expected paragraph");
        };
        assert_eq!(paragraph.source_ref.source_node_id, None);
    }

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
    fn preserves_link_and_style_occurrences_in_one_document_order_ledger() {
        let parsed = parse_xhtml(
            r#"<html><head>
            <link rel="stylesheet" href="a.css"/>
            <style>.b { color: blue; }</style>
            <link rel="stylesheet" href="c.css"/>
            <style>.d { color: black; }</style>
            </head><body/></html>"#,
        )
        .expect("xhtml");

        let kinds = parsed
            .author_stylesheets
            .iter()
            .map(|source| match source {
                AuthorStylesheetSource::External { href, .. } => format!("link:{href}"),
                AuthorStylesheetSource::Embedded { css, .. } => format!("style:{css}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            kinds,
            [
                "link:a.css",
                "style:.b { color: blue; }",
                "link:c.css",
                "style:.d { color: black; }",
            ]
        );
        let node_ids = parsed
            .author_stylesheets
            .iter()
            .map(|source| match source {
                AuthorStylesheetSource::External { source_node_id, .. }
                | AuthorStylesheetSource::Embedded { source_node_id, .. } => source_node_id.index(),
            })
            .collect::<Vec<_>>();
        assert!(node_ids.windows(2).all(|pair| pair[0] < pair[1]));
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
