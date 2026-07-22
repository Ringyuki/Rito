pub const NAME: &str = "style";
pub const OWNS: &str = "Cascade, inheritance, computed style, and paint-ready style aggregates";

mod backend;
mod font_fallback;
mod inheritance;
mod stylo_materialize;
pub(crate) use stylo_materialize::{absolute_color, serialize_font_families};
mod stylo_sources;
mod tree;

use serde::{Deserialize, Serialize};
#[cfg(feature = "legacy-css-diagnostics")]
use serde_json::{json, Number};
use serde_json::{Map, Value};
#[cfg(feature = "legacy-css-diagnostics")]
use sha2::{Digest, Sha256};

#[cfg(feature = "legacy-css-diagnostics")]
use std::sync::Arc;

#[cfg(feature = "legacy-css-diagnostics")]
use crate::{
    css::{
        parse_css_declarations_with_viewport, parse_css_rules, parse_css_rules_with_root_font_size,
        CssRuleSummary, CssViewport,
    },
    xhtml::{
        AuthorStylesheetSource, DocumentNode, ElementAttributes, ElementNode, ImageNode, SourceRef,
    },
};

#[cfg(feature = "legacy-css-diagnostics")]
pub(crate) use backend::resolve_prepared_chapter_style_with_legacy_compatibility;
#[cfg(test)]
pub(crate) use backend::StyleBackendError;
pub(crate) use backend::{resolve_prepared_chapter_style, PreparedStyleChapterInput};
#[cfg(any(test, feature = "bench-internals"))]
pub(crate) use backend::{style_backend_metrics, StyleBackendMetrics};
pub(crate) use font_fallback::{
    rewrite_font_families, FontFallbackFace, FontFallbackPolicy, FontGenericRole,
};
pub(crate) use inheritance::inheritable_style;
pub(crate) use stylo_sources::StyleCapabilityReport;
pub use tree::{StyledNode, StyledNodeKind};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleSummary {
    pub selector_matches: SelectorMatchSummary,
    pub computed_styles: ComputedStyleSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectorMatchSummary {
    pub chapter_count: usize,
    pub total_element_count: usize,
    pub total_matched_element_count: usize,
    pub total_match_count: usize,
    pub chapters: Vec<SelectorMatchChapterSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectorMatchChapterSummary {
    pub idref: String,
    pub href: String,
    pub element_count: usize,
    pub matched_element_count: usize,
    pub match_count: usize,
    pub selector_match_hash: String,
    pub cascade_match_hash: String,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedStyleSummary {
    pub chapter_count: usize,
    pub total_styled_node_count: usize,
    pub chapters: Vec<ComputedStyleChapterSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedStyleChapterSummary {
    pub idref: String,
    pub href: String,
    pub styled_node_count: usize,
    pub style_hash: String,
    pub samples: Vec<ComputedStyleNodeSample>,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedStyleNodeSample {
    #[serde(rename = "type")]
    pub node_type: String,
    pub tag: Option<String>,
    pub path: Option<Vec<usize>>,
    pub style: Map<String, Value>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ChapterStyleOptions<'a> {
    pub root_font_size: f64,
    pub line_height_override: Option<f64>,
    pub line_height_force: bool,
    pub font_family_override: Option<&'a str>,
    pub font_family_force: bool,
}

pub(crate) const DEFAULT_UA_STYLESHEET: &str = r#"
h1 { font-size: 2em; font-weight: bold; margin-top: 0.67em; margin-bottom: 0.67em; }
h2 { font-size: 1.5em; font-weight: bold; margin-top: 0.83em; margin-bottom: 0.83em; }
h3 { font-size: 1.17em; font-weight: bold; margin-top: 1em; margin-bottom: 1em; }
h4 { font-size: 1em; font-weight: bold; margin-top: 1.33em; margin-bottom: 1.33em; }
h5 { font-size: 0.83em; font-weight: bold; margin-top: 1.67em; margin-bottom: 1.67em; }
h6 { font-size: 0.67em; font-weight: bold; margin-top: 2.33em; margin-bottom: 2.33em; }

p { margin-top: 1em; margin-bottom: 1em; }
blockquote { margin-top: 1em; margin-bottom: 1em; margin-left: 40px; margin-right: 40px; }
pre { font-family: monospace; white-space: pre; margin-top: 1em; margin-bottom: 1em; }
code { font-family: monospace; }
em, i { font-style: italic; }
strong, b { font-weight: bold; }
center { text-align: center; }

ul { margin-top: 1em; margin-bottom: 1em; padding-left: 40px; list-style-type: disc; }
ol { margin-top: 1em; margin-bottom: 1em; padding-left: 40px; list-style-type: decimal; }
li { display: list-item; margin-top: 0; margin-bottom: 0; }
dl { margin-top: 1em; margin-bottom: 1em; }
dt { font-weight: bold; }
dd { margin-left: 40px; }

hr { margin-top: 0.5em; margin-bottom: 0.5em; }
th { font-weight: bold; }
sup { vertical-align: super; font-size: smaller; }
sub { vertical-align: sub; font-size: smaller; }
"#;

#[cfg(feature = "legacy-css-diagnostics")]
mod legacy {
    use super::*;

    mod pseudo {
        include!("style/pseudo.rs");
    }
    mod selector {
        include!("style/selector.rs");
    }

    use pseudo::inject_pseudo_elements;
    use selector::{matches_selector, SelectorTarget};

    pub(crate) struct ParsedStyleChapterInput<'a> {
        pub idref: &'a str,
        pub href: &'a str,
        pub nodes: &'a [DocumentNode],
        pub body_attributes: Option<&'a ElementAttributes>,
        pub author_stylesheets: &'a [AuthorStylesheetSource],
    }

    pub(crate) type StylesheetRuleMap = Vec<(String, Vec<CssRuleSummary>)>;

    pub(crate) fn summarize_style_from_parsed_chapters<'a>(
        stylesheet_rules: &StylesheetRuleMap,
        chapters: impl IntoIterator<Item = ParsedStyleChapterInput<'a>>,
        viewport: Option<CssViewport>,
        options: ChapterStyleOptions<'_>,
    ) -> StyleSummary {
        let chapters = chapters
            .into_iter()
            .map(|chapter| {
                summarize_style_for_parsed_chapter(chapter, stylesheet_rules, viewport, options)
            })
            .collect::<Vec<_>>();
        let selector_chapters = chapters
            .iter()
            .map(|chapter| chapter.selector_matches.clone())
            .collect::<Vec<_>>();
        let computed_chapters = chapters
            .iter()
            .map(|chapter| chapter.computed_styles.clone())
            .collect::<Vec<_>>();

        StyleSummary {
            selector_matches: SelectorMatchSummary {
                chapter_count: selector_chapters.len(),
                total_element_count: selector_chapters
                    .iter()
                    .map(|chapter| chapter.element_count)
                    .sum(),
                total_matched_element_count: selector_chapters
                    .iter()
                    .map(|chapter| chapter.matched_element_count)
                    .sum(),
                total_match_count: selector_chapters
                    .iter()
                    .map(|chapter| chapter.match_count)
                    .sum(),
                full_detail_hash: selector_full_detail_hash(&selector_chapters),
                chapters: selector_chapters,
            },
            computed_styles: ComputedStyleSummary {
                chapter_count: computed_chapters.len(),
                total_styled_node_count: computed_chapters
                    .iter()
                    .map(|chapter| chapter.styled_node_count)
                    .sum(),
                full_detail_hash: computed_full_detail_hash(&computed_chapters),
                chapters: computed_chapters,
            },
        }
    }

    pub(crate) fn stylesheet_rules_from_texts<'a>(
        stylesheets: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> StylesheetRuleMap {
        stylesheets
            .into_iter()
            .map(|(href, css)| (href.to_owned(), parse_css_rules(css)))
            .collect()
    }

    #[derive(Debug)]
    struct ChapterStyleSummary {
        selector_matches: SelectorMatchChapterSummary,
        computed_styles: ComputedStyleChapterSummary,
    }

    fn summarize_style_for_parsed_chapter(
        chapter: ParsedStyleChapterInput<'_>,
        stylesheet_rules: &StylesheetRuleMap,
        viewport: Option<CssViewport>,
        options: ChapterStyleOptions<'_>,
    ) -> ChapterStyleSummary {
        let rules = build_chapter_rules(
            stylesheet_rules,
            chapter.author_stylesheets,
            options.root_font_size,
        );
        let root = compute_chapter_root_styles(
            &rules,
            chapter.body_attributes,
            viewport,
            options.root_font_size,
        );
        let selector_detail =
            collect_selector_matches_with_ancestors(chapter.nodes, &rules, &root.ancestors);
        let computed_detail = collect_computed_chapter_style_summary(
            chapter.nodes,
            &rules,
            chapter.body_attributes,
            viewport,
            options,
        );

        ChapterStyleSummary {
            selector_matches: SelectorMatchChapterSummary {
                idref: chapter.idref.to_owned(),
                href: chapter.href.to_owned(),
                element_count: selector_detail.element_count,
                matched_element_count: selector_detail.elements.len(),
                match_count: selector_detail
                    .elements
                    .iter()
                    .map(|element| element.matched_selectors.len())
                    .sum(),
                cascade_match_hash: cascade_match_hash(&selector_detail.elements),
                selector_match_hash: selector_match_hash(&selector_detail.elements),
                detail_hash: hash_json(&selector_match_detail_value(&selector_detail)),
            },
            computed_styles: ComputedStyleChapterSummary {
                idref: chapter.idref.to_owned(),
                href: chapter.href.to_owned(),
                styled_node_count: computed_detail.nodes.len(),
                style_hash: computed_style_hash(&computed_detail.nodes),
                samples: computed_detail
                    .nodes
                    .iter()
                    .take(8)
                    .map(computed_style_node_sample)
                    .collect(),
                detail_hash: hash_json(&computed_style_detail_value(&computed_detail)),
            },
        }
    }

    pub(crate) fn build_chapter_rules(
        stylesheet_rules: &StylesheetRuleMap,
        author_stylesheets: &[AuthorStylesheetSource],
        root_font_size: f64,
    ) -> Vec<CssRuleSummary> {
        let has_external_source = author_stylesheets
            .iter()
            .any(|source| matches!(source, AuthorStylesheetSource::External { .. }));
        let mut rules = if has_external_source {
            Vec::new()
        } else {
            // Preserve the historical implicit-all-external policy when a chapter
            // contains no linked stylesheet occurrence.
            stylesheet_rules
                .iter()
                .flat_map(|(_, rules)| rules.iter().cloned())
                .collect()
        };
        for source in author_stylesheets {
            match source {
                AuthorStylesheetSource::External { href, .. } => {
                    rules.extend(filter_rules_by_chapter_hrefs(
                        stylesheet_rules,
                        std::slice::from_ref(href),
                    ));
                }
                AuthorStylesheetSource::Embedded { css, .. } => {
                    rules.extend(parse_css_rules_with_root_font_size(css, root_font_size));
                }
            }
        }
        rules
    }

    pub(crate) fn filter_rules_by_chapter_hrefs(
        stylesheet_rules: &StylesheetRuleMap,
        link_hrefs: &[String],
    ) -> Vec<CssRuleSummary> {
        let keys = stylesheet_rules
            .iter()
            .map(|(href, _)| href.as_str())
            .collect::<Vec<_>>();
        let mut rules = Vec::new();
        for link_href in link_hrefs {
            let matching_keys = find_matching_stylesheet_keys(&keys, link_href);
            if matching_keys.len() != 1 {
                continue;
            }
            if let Some((_, matching_rules)) = stylesheet_rules
                .iter()
                .find(|(href, _)| href == matching_keys[0])
            {
                rules.extend(matching_rules.iter().cloned());
            }
        }
        rules
    }

    pub(crate) fn find_matching_stylesheet_keys<'a>(
        keys: &[&'a str],
        link_href: &str,
    ) -> Vec<&'a str> {
        let link = normalize_stylesheet_href(link_href);
        let without_parents = link.trim_start_matches("../");
        let exact = keys
            .iter()
            .copied()
            .filter(|key| {
                let normalized_key = normalize_stylesheet_href(key);
                normalized_key == link || normalized_key == without_parents
            })
            .collect::<Vec<_>>();
        if !exact.is_empty() {
            return exact;
        }
        keys.iter()
            .copied()
            .filter(|key| {
                let normalized_key = normalize_stylesheet_href(key);
                normalized_key.ends_with(&format!("/{without_parents}"))
                    || without_parents.ends_with(&format!("/{normalized_key}"))
            })
            .collect()
    }

    fn normalize_stylesheet_href(href: &str) -> String {
        let clean = href.split(['?', '#']).next().unwrap_or(href);
        let Some(decoded) = decode_uri_component(clean) else {
            return String::new();
        };
        let mut parts: Vec<&str> = Vec::new();
        let normalized_slashes = decoded.replace('\\', "/");
        for part in normalized_slashes.split('/') {
            if part.is_empty() || part == "." {
                continue;
            }
            if part == ".." && parts.last().is_some_and(|last| *last != "..") {
                parts.pop();
            } else {
                parts.push(part);
            }
        }
        parts.join("/")
    }

    fn decode_uri_component(value: &str) -> Option<String> {
        let bytes = value.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] != b'%' {
                decoded.push(bytes[index]);
                index += 1;
                continue;
            }
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        }
        String::from_utf8(decoded).ok()
    }

    fn hex_value(value: u8) -> Option<u8> {
        match value {
            b'0'..=b'9' => Some(value - b'0'),
            b'a'..=b'f' => Some(value - b'a' + 10),
            b'A'..=b'F' => Some(value - b'A' + 10),
            _ => None,
        }
    }

    #[derive(Debug)]
    struct SelectorMatchDetail {
        element_count: usize,
        elements: Vec<MatchedElementDetail>,
    }

    #[derive(Debug)]
    struct MatchedElementDetail {
        path: Vec<usize>,
        tag: String,
        id: Option<String>,
        class_name: Option<String>,
        matched_selectors: Vec<String>,
        cascade_selectors: Vec<String>,
    }

    fn collect_selector_matches_with_ancestors(
        nodes: &[DocumentNode],
        rules: &[CssRuleSummary],
        ancestors: &[SelectorTarget],
    ) -> SelectorMatchDetail {
        let mut state = SelectorMatchState::default();
        walk_sibling_nodes(nodes, rules, ancestors, &mut state);
        SelectorMatchDetail {
            element_count: state.element_count,
            elements: state.elements,
        }
    }

    #[derive(Default)]
    struct SelectorMatchState {
        element_count: usize,
        elements: Vec<MatchedElementDetail>,
    }

    fn walk_sibling_nodes(
        nodes: &[DocumentNode],
        rules: &[CssRuleSummary],
        ancestors: &[SelectorTarget],
        state: &mut SelectorMatchState,
    ) {
        let sibling_count = nodes.iter().filter(|node| is_element_node(node)).count();
        let mut sibling_index = 0;
        let mut previous_sibling = None;

        for node in nodes {
            if !is_element_node(node) {
                continue;
            }

            let mut target = selector_target_for_node(node);
            target.sibling_index = Some(sibling_index);
            target.sibling_count = Some(sibling_count);
            target.previous_sibling = previous_sibling.clone();
            state.element_count += 1;

            let matched_rules = rules
                .iter()
                .filter(|rule| matches_selector(&target, &rule.selector, ancestors))
                .collect::<Vec<_>>();
            if !matched_rules.is_empty() {
                state.elements.push(MatchedElementDetail {
                    path: source_path_for_node(node),
                    tag: target.tag.clone(),
                    id: target.id.clone(),
                    class_name: target.class_name.clone(),
                    matched_selectors: matched_rules
                        .iter()
                        .map(|rule| rule.selector.clone())
                        .collect(),
                    cascade_selectors: cascade_selectors(&matched_rules),
                });
            }

            if let Some(children) = children_for_node(node) {
                let mut next_ancestors = Vec::with_capacity(ancestors.len() + 1);
                next_ancestors.push(target.clone());
                next_ancestors.extend_from_slice(ancestors);
                walk_sibling_nodes(children, rules, &next_ancestors, state);
            }

            previous_sibling = Some(Arc::new(target));
            sibling_index += 1;
        }
    }

    fn is_element_node(node: &DocumentNode) -> bool {
        matches!(
            node,
            DocumentNode::Block(_) | DocumentNode::Inline(_) | DocumentNode::Image(_)
        )
    }

    fn children_for_node(node: &DocumentNode) -> Option<&[DocumentNode]> {
        match node {
            DocumentNode::Block(element) | DocumentNode::Inline(element) => Some(&element.children),
            DocumentNode::Image(_) | DocumentNode::Text(_) => None,
        }
    }

    fn selector_target_for_node(node: &DocumentNode) -> SelectorTarget {
        match node {
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                element_selector_target(element)
            }
            DocumentNode::Image(image) => image_selector_target(image),
            DocumentNode::Text(_) => unreachable!("text nodes are not selector targets"),
        }
    }

    fn element_selector_target(element: &ElementNode) -> SelectorTarget {
        selector_target(element.tag.clone(), element.attributes.as_ref())
    }

    fn image_selector_target(image: &ImageNode) -> SelectorTarget {
        selector_target("img".to_owned(), image.attributes.as_ref())
    }

    fn selector_target(tag: String, attributes: Option<&ElementAttributes>) -> SelectorTarget {
        SelectorTarget {
            tag,
            class_name: attributes
                .and_then(|attributes| non_empty_attribute(attributes.class.as_ref())),
            id: attributes.and_then(|attributes| non_empty_attribute(attributes.id.as_ref())),
            attributes: attributes
                .and_then(|attributes| attributes.all_attributes.clone())
                .unwrap_or_default(),
            previous_sibling: None,
            sibling_index: None,
            sibling_count: None,
        }
    }

    fn source_path_for_node(node: &DocumentNode) -> Vec<usize> {
        match node {
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                element.source_ref.node_path.clone()
            }
            DocumentNode::Image(image) => image.source_ref.node_path.clone(),
            DocumentNode::Text(text) => text.source_ref.node_path.clone(),
        }
    }

    fn selector_match_detail_value(detail: &SelectorMatchDetail) -> Value {
        json!({
            "elementCount": detail.element_count,
            "elements": detail.elements.iter().map(matched_element_value).collect::<Vec<_>>(),
        })
    }

    fn matched_element_value(element: &MatchedElementDetail) -> Value {
        json!({
            "className": element.class_name,
            "cascadeSelectors": element.cascade_selectors,
            "id": element.id,
            "matchedSelectors": element.matched_selectors,
            "path": element.path,
            "tag": element.tag,
        })
    }

    fn selector_match_hash(elements: &[MatchedElementDetail]) -> String {
        hash_json(&Value::Array(
            elements
                .iter()
                .map(|element| {
                    json!({
                        "matchedSelectors": element.matched_selectors,
                        "path": element.path,
                    })
                })
                .collect(),
        ))
    }

    fn cascade_match_hash(elements: &[MatchedElementDetail]) -> String {
        hash_json(&Value::Array(
            elements
                .iter()
                .map(|element| {
                    json!({
                        "cascadeSelectors": element.cascade_selectors,
                        "path": element.path,
                    })
                })
                .collect(),
        ))
    }

    fn cascade_selectors(rules: &[&CssRuleSummary]) -> Vec<String> {
        let mut rules = rules.to_vec();
        rules.sort_by(|left, right| {
            selector::compare_specificity(
                selector::calculate_specificity(&left.selector),
                selector::calculate_specificity(&right.selector),
            )
        });
        rules.iter().map(|rule| rule.selector.clone()).collect()
    }

    #[derive(Debug)]
    struct ComputedStyleDetail {
        nodes: Vec<StyledNodeDetail>,
    }

    #[derive(Debug)]
    struct StyledNodeDetail {
        node_type: String,
        tag: Option<String>,
        path: Option<Vec<usize>>,
        style: Map<String, Value>,
    }

    #[derive(Clone)]
    struct CascadeRule {
        selector: String,
        raw_declarations: String,
        specificity: [usize; 3],
        origin_rank: usize,
    }

    #[derive(Clone, Copy)]
    pub(super) struct CssResolutionContext {
        root_font_size: f64,
        viewport: Option<CssViewport>,
    }

    fn collect_computed_chapter_style_summary(
        nodes: &[DocumentNode],
        rules: &[CssRuleSummary],
        body_attributes: Option<&ElementAttributes>,
        viewport: Option<CssViewport>,
        options: ChapterStyleOptions<'_>,
    ) -> ComputedStyleDetail {
        let styled = resolve_chapter_style_nodes(nodes, rules, body_attributes, viewport, options);
        let mut details = Vec::new();
        for node in &styled.styled_nodes {
            flatten_styled_node(node, &mut details);
        }
        ComputedStyleDetail { nodes: details }
    }

    #[cfg(test)]
    pub(crate) fn resolve_style_nodes(
        nodes: &[DocumentNode],
        rules: &[CssRuleSummary],
    ) -> Vec<StyledNode> {
        resolve_style_nodes_with_viewport(nodes, rules, None)
    }

    #[cfg(test)]
    fn resolve_style_nodes_with_viewport(
        nodes: &[DocumentNode],
        rules: &[CssRuleSummary],
        viewport: Option<CssViewport>,
    ) -> Vec<StyledNode> {
        let cascade_rules = cascade_rules(rules);
        resolve_nodes_with_siblings(
            nodes,
            inheritable_style(&default_style()),
            &cascade_rules,
            &[],
            16.0,
            viewport,
        )
    }

    pub(crate) struct ResolvedChapterStyle {
        pub styled_nodes: Vec<StyledNode>,
        pub page_paint: Option<Value>,
    }

    pub(crate) fn resolve_chapter_style_nodes(
        nodes: &[DocumentNode],
        rules: &[CssRuleSummary],
        body_attributes: Option<&ElementAttributes>,
        viewport: Option<CssViewport>,
        options: ChapterStyleOptions<'_>,
    ) -> ResolvedChapterStyle {
        let root =
            compute_chapter_root_styles(rules, body_attributes, viewport, options.root_font_size);
        let body_style = apply_typography_overrides(root.body_style, options);
        let cascade_rules = cascade_rules(rules);
        let mut styled_nodes = resolve_nodes_with_siblings(
            nodes,
            inheritable_style(&body_style),
            &cascade_rules,
            &root.ancestors,
            root.html_font_size,
            viewport,
        );
        if options.line_height_force || options.font_family_force {
            force_typography_on_tree(&mut styled_nodes, options);
        }
        ResolvedChapterStyle {
            styled_nodes,
            page_paint: page_paint_from_body_style(&body_style),
        }
    }

    struct ChapterRootStyles {
        html_font_size: f64,
        body_style: Map<String, Value>,
        ancestors: Vec<SelectorTarget>,
    }

    fn compute_chapter_root_styles(
        rules: &[CssRuleSummary],
        body_attributes: Option<&ElementAttributes>,
        viewport: Option<CssViewport>,
        initial_root_font_size: f64,
    ) -> ChapterRootStyles {
        let mut initial_style = default_style();
        insert_number(&mut initial_style, "fontSize", initial_root_font_size);
        let body = DocumentNode::Block(ElementNode {
            tag: "body".to_owned(),
            attributes: body_attributes.cloned(),
            children: Vec::new(),
            source_ref: SourceRef {
                node_path: vec![0],
                source_node_id: None,
            },
        });
        let html = DocumentNode::Block(ElementNode {
            tag: "html".to_owned(),
            attributes: None,
            children: vec![body],
            source_ref: SourceRef {
                node_path: Vec::new(),
                source_node_id: None,
            },
        });
        let cascade_rules = cascade_rules(rules);
        let resolved = resolve_nodes_with_siblings(
            &[html],
            inheritable_style(&initial_style),
            &cascade_rules,
            &[],
            initial_root_font_size,
            viewport,
        );
        let resolved_html = resolved.first();
        let resolved_body = resolved_html.and_then(|html| html.children.first());
        let html_font_size = resolved_html
            .and_then(|html| number_from_style(&html.style, "fontSize"))
            .unwrap_or(initial_root_font_size);
        let mut body_style = resolved_body
            .map(|body| body.style.clone())
            .unwrap_or(initial_style);
        if body_style
            .get("backgroundColor")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            if let Some(bgcolor) = read_body_presentational_attr(body_attributes, "bgcolor") {
                insert_string(&mut body_style, "backgroundColor", bgcolor);
            }
        }
        ChapterRootStyles {
            html_font_size,
            body_style,
            ancestors: vec![
                selector_target("body".to_owned(), body_attributes),
                selector_target("html".to_owned(), None),
            ],
        }
    }

    fn apply_typography_overrides(
        mut style: Map<String, Value>,
        options: ChapterStyleOptions<'_>,
    ) -> Map<String, Value> {
        if let Some(line_height) = options.line_height_override {
            insert_number(&mut style, "lineHeight", line_height);
            style.remove("lineHeightPx");
        }
        if let Some(font_family) = options.font_family_override {
            insert_string(&mut style, "fontFamily", font_family);
        }
        style
    }

    fn force_typography_on_tree(nodes: &mut [StyledNode], options: ChapterStyleOptions<'_>) {
        for node in nodes {
            if options.line_height_force {
                if let Some(line_height) = options.line_height_override {
                    insert_number(&mut node.style, "lineHeight", line_height);
                    node.style.remove("lineHeightPx");
                }
            }
            if options.font_family_force {
                if let Some(font_family) = options.font_family_override {
                    insert_string(&mut node.style, "fontFamily", font_family);
                }
            }
            force_typography_on_tree(&mut node.children, options);
        }
    }

    fn non_empty_attribute(value: Option<&String>) -> Option<String> {
        value.filter(|value| !value.is_empty()).cloned()
    }

    fn page_paint_from_body_style(style: &Map<String, Value>) -> Option<Value> {
        let background_color = style.get("backgroundColor").and_then(Value::as_str)?;
        (!background_color.is_empty()).then(|| json!({ "backgroundColor": background_color }))
    }

    fn read_body_presentational_attr<'a>(
        attributes: Option<&'a ElementAttributes>,
        name: &str,
    ) -> Option<&'a str> {
        attributes?
            .all_attributes
            .as_ref()?
            .iter()
            .find(|(key, value)| key.eq_ignore_ascii_case(name) && !value.trim().is_empty())
            .map(|(_, value)| value.as_str())
    }

    fn cascade_rules(rules: &[CssRuleSummary]) -> Vec<CascadeRule> {
        let mut result = default_ua_rules()
            .into_iter()
            .map(|rule| CascadeRule::from_owned(rule, 0))
            .collect::<Vec<_>>();
        result.extend(
            rules
                .iter()
                .map(|rule| CascadeRule::from_summary(rule, origin_rank(&rule.origin))),
        );
        result
    }

    impl CascadeRule {
        fn from_owned(rule: CssRuleSummary, origin_rank: usize) -> Self {
            Self {
                specificity: selector::calculate_specificity(&rule.selector),
                selector: rule.selector,
                raw_declarations: rule.raw_declarations,
                origin_rank,
            }
        }

        fn from_summary(rule: &CssRuleSummary, origin_rank: usize) -> Self {
            Self {
                selector: rule.selector.clone(),
                raw_declarations: rule.raw_declarations.clone(),
                specificity: selector::calculate_specificity(&rule.selector),
                origin_rank,
            }
        }
    }

    fn origin_rank(origin: &str) -> usize {
        match origin {
            "ua" => 0,
            "inline" => 2,
            _ => 1,
        }
    }

    fn default_ua_rules() -> Vec<CssRuleSummary> {
        parse_css_rules(DEFAULT_UA_STYLESHEET)
            .into_iter()
            .map(|mut rule| {
                rule.origin = "ua".to_owned();
                rule
            })
            .collect()
    }

    fn resolve_nodes_with_siblings(
        nodes: &[DocumentNode],
        parent_style: Map<String, Value>,
        rules: &[CascadeRule],
        ancestors: &[SelectorTarget],
        root_font_size: f64,
        viewport: Option<CssViewport>,
    ) -> Vec<StyledNode> {
        let sibling_count = nodes.iter().filter(|node| is_element_node(node)).count();
        let mut sibling_index = 0;
        let mut previous_sibling = None;
        let mut output = Vec::new();

        for node in nodes {
            let sibling_info = if is_element_node(node) {
                let info = SiblingInfo {
                    sibling_index,
                    sibling_count,
                    previous_sibling: previous_sibling.clone(),
                };
                sibling_index += 1;
                Some(info)
            } else {
                None
            };

            let resolved = resolve_node(
                node,
                &parent_style,
                rules,
                ancestors,
                sibling_info.clone(),
                root_font_size,
                viewport,
            );
            if let Some(info) = sibling_info {
                let mut target = selector_target_for_node(node);
                target.sibling_index = Some(info.sibling_index);
                target.sibling_count = Some(info.sibling_count);
                target.previous_sibling = info.previous_sibling;
                previous_sibling = Some(Arc::new(target));
            }
            if let Some(resolved) = resolved {
                output.push(resolved);
            }
        }

        output
    }

    #[derive(Clone)]
    struct SiblingInfo {
        sibling_index: usize,
        sibling_count: usize,
        previous_sibling: Option<Arc<SelectorTarget>>,
    }

    fn resolve_node(
        node: &DocumentNode,
        parent_style: &Map<String, Value>,
        rules: &[CascadeRule],
        ancestors: &[SelectorTarget],
        sibling_info: Option<SiblingInfo>,
        root_font_size: f64,
        viewport: Option<CssViewport>,
    ) -> Option<StyledNode> {
        match node {
            DocumentNode::Text(text) => Some(StyledNode::text(
                text.content.clone(),
                text.source_text.clone(),
                parent_style.clone(),
                text.source_ref.clone(),
            )),
            DocumentNode::Block(element) | DocumentNode::Inline(element) => resolve_element_node(
                node,
                element,
                parent_style,
                rules,
                ancestors,
                sibling_info,
                CssResolutionContext {
                    root_font_size,
                    viewport,
                },
            ),
            DocumentNode::Image(image) => {
                let mut target = image_selector_target(image);
                apply_sibling_info(&mut target, sibling_info);
                let style = apply_language(
                    apply_cascade(
                        parent_style,
                        &target,
                        image
                            .attributes
                            .as_ref()
                            .and_then(|attributes| attributes.style.as_deref()),
                        rules,
                        ancestors,
                        root_font_size,
                        viewport,
                    ),
                    image.attributes.as_ref(),
                );
                if is_display_none(&style) {
                    return None;
                }
                Some(StyledNode {
                    node_type: StyledNodeKind::Image,
                    tag: None,
                    content: None,
                    source_text: None,
                    src: Some(image.src.clone()),
                    alt: Some(image.alt.clone()),
                    id: image
                        .attributes
                        .as_ref()
                        .and_then(|attributes| attributes.id.clone()),
                    href: image
                        .attributes
                        .as_ref()
                        .and_then(|attributes| attributes.href.clone()),
                    colspan: None,
                    rowspan: None,
                    style,
                    children: Vec::new(),
                    source_ref: Some(image.source_ref.clone()),
                })
            }
        }
    }

    fn resolve_element_node(
        node: &DocumentNode,
        element: &ElementNode,
        parent_style: &Map<String, Value>,
        rules: &[CascadeRule],
        ancestors: &[SelectorTarget],
        sibling_info: Option<SiblingInfo>,
        context: CssResolutionContext,
    ) -> Option<StyledNode> {
        let mut target = element_selector_target(element);
        apply_sibling_info(&mut target, sibling_info);
        let style = apply_language(
            apply_cascade(
                parent_style,
                &target,
                element
                    .attributes
                    .as_ref()
                    .and_then(|attributes| attributes.style.as_deref()),
                rules,
                ancestors,
                context.root_font_size,
                context.viewport,
            ),
            element.attributes.as_ref(),
        );
        if is_display_none(&style) {
            return None;
        }

        let host_kind = node_kind(node);
        let host_is_inline = matches!(host_kind, StyledNodeKind::Inline);
        let host_target = target.clone();
        let mut next_ancestors = Vec::with_capacity(ancestors.len() + 1);
        next_ancestors.push(target);
        next_ancestors.extend_from_slice(ancestors);
        let child_root_font_size = if element.tag == "html" {
            number_from_style(&style, "fontSize").unwrap_or(context.root_font_size)
        } else {
            context.root_font_size
        };
        let resolved_children = resolve_nodes_with_siblings(
            &element.children,
            inheritable_style(&style),
            rules,
            &next_ancestors,
            child_root_font_size,
            context.viewport,
        );
        let children = inject_pseudo_elements(
            resolved_children,
            &style,
            &host_target,
            rules,
            ancestors,
            host_is_inline,
            CssResolutionContext {
                root_font_size: child_root_font_size,
                viewport: context.viewport,
            },
        );

        Some(StyledNode {
            node_type: host_kind,
            tag: Some(element.tag.clone()),
            content: None,
            source_text: None,
            src: None,
            alt: None,
            id: element
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.id.clone()),
            href: element
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.href.clone()),
            colspan: element
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.colspan),
            rowspan: element
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.rowspan),
            style,
            children,
            source_ref: Some(element.source_ref.clone()),
        })
    }

    fn node_kind(node: &DocumentNode) -> StyledNodeKind {
        match node {
            DocumentNode::Block(_) => StyledNodeKind::Block,
            DocumentNode::Inline(_) => StyledNodeKind::Inline,
            DocumentNode::Image(_) => StyledNodeKind::Image,
            DocumentNode::Text(_) => StyledNodeKind::Text,
        }
    }

    fn apply_sibling_info(target: &mut SelectorTarget, sibling_info: Option<SiblingInfo>) {
        if let Some(info) = sibling_info {
            target.sibling_index = Some(info.sibling_index);
            target.sibling_count = Some(info.sibling_count);
            target.previous_sibling = info.previous_sibling;
        }
    }

    fn apply_cascade(
        parent_style: &Map<String, Value>,
        target: &SelectorTarget,
        inline_css: Option<&str>,
        rules: &[CascadeRule],
        ancestors: &[SelectorTarget],
        root_font_size: f64,
        viewport: Option<CssViewport>,
    ) -> Map<String, Value> {
        let mut style = apply_runtime_element_defaults(parent_style.clone(), &target.tag);
        let mut matches = rules
            .iter()
            .filter(|rule| matches_selector(target, &rule.selector, ancestors))
            .cloned()
            .collect::<Vec<_>>();
        if let Some(inline_css) = inline_css {
            matches.push(CascadeRule {
                selector: "<inline>".to_owned(),
                raw_declarations: inline_css.to_owned(),
                specificity: [usize::MAX, 0, 0],
                origin_rank: 2,
            });
        }
        matches.sort_by(compare_cascade_rules);
        let parent_font_size = number_from_style(parent_style, "fontSize").unwrap_or(16.0);
        let resolved_font_size =
            resolve_final_font_size(&style, &matches, parent_font_size, root_font_size, viewport);
        for rule in matches {
            let declarations = parse_css_declarations_with_viewport(
                &rule.raw_declarations,
                resolved_font_size,
                root_font_size,
                viewport,
            );
            let clears_line_height_px = clears_line_height_px(&rule.raw_declarations);
            merge_style(&mut style, &declarations);
            if clears_line_height_px {
                style.remove("lineHeightPx");
            }
            insert_number(&mut style, "fontSize", resolved_font_size);
        }
        style
    }

    fn apply_language(
        mut style: Map<String, Value>,
        attributes: Option<&ElementAttributes>,
    ) -> Map<String, Value> {
        if let Some(language) = attributes.and_then(|attributes| attributes.language.as_deref()) {
            insert_string(&mut style, "language", &language.to_ascii_lowercase());
        }
        style
    }

    fn clears_line_height_px(raw_declarations: &str) -> bool {
        let mut clears = false;
        for declaration in raw_declarations.split(';') {
            let Some((property, raw_value)) = declaration.split_once(':') else {
                continue;
            };
            if property.trim().eq_ignore_ascii_case("line-height") {
                let value = strip_important(raw_value.trim());
                clears = is_unitless_number(value);
            }
        }
        clears
    }

    fn strip_important(value: &str) -> &str {
        value
            .strip_suffix("!important")
            .or_else(|| value.strip_suffix("! important"))
            .map(str::trim_end)
            .unwrap_or(value)
    }

    fn is_unitless_number(value: &str) -> bool {
        !value.is_empty()
            && value
                .chars()
                .all(|character| character.is_ascii_digit() || character == '.')
            && value.parse::<f64>().is_ok()
    }

    fn resolve_final_font_size(
        style: &Map<String, Value>,
        matches: &[CascadeRule],
        parent_font_size: f64,
        root_font_size: f64,
        viewport: Option<CssViewport>,
    ) -> f64 {
        let mut resolved_font_size =
            number_from_style(style, "fontSize").unwrap_or(parent_font_size);
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
        resolved_font_size
    }

    fn number_from_style(style: &Map<String, Value>, key: &str) -> Option<f64> {
        style.get(key).and_then(Value::as_f64)
    }

    fn compare_cascade_rules(left: &CascadeRule, right: &CascadeRule) -> std::cmp::Ordering {
        left.origin_rank
            .cmp(&right.origin_rank)
            .then_with(|| selector::compare_specificity(left.specificity, right.specificity))
    }

    fn merge_style(style: &mut Map<String, Value>, declarations: &Map<String, Value>) {
        for (key, value) in declarations {
            style.insert(key.clone(), value.clone());
        }
    }

    fn flatten_styled_node(node: &StyledNode, output: &mut Vec<StyledNodeDetail>) {
        output.push(StyledNodeDetail {
            node_type: styled_node_kind_name(node.node_type).to_owned(),
            tag: node.tag.clone(),
            path: node
                .source_ref
                .as_ref()
                .map(|source| source.node_path.clone()),
            style: summarize_style_map(&node.style),
        });
        for child in &node.children {
            flatten_styled_node(child, output);
        }
    }

    fn styled_node_kind_name(kind: StyledNodeKind) -> &'static str {
        match kind {
            StyledNodeKind::Block => "block",
            StyledNodeKind::Inline => "inline",
            StyledNodeKind::Text => "text",
            StyledNodeKind::Image => "image",
        }
    }

    fn summarize_style_map(style: &Map<String, Value>) -> Map<String, Value> {
        let mut output = Map::new();
        for key in COMPUTED_STYLE_KEYS {
            if let Some(value) = style.get(*key) {
                output.insert((*key).to_owned(), round_json_value(value));
            }
        }
        output
    }

    fn round_json_value(value: &Value) -> Value {
        match value {
            Value::Number(number) => number
                .as_f64()
                .map(rounded_number_value)
                .unwrap_or_else(|| value.clone()),
            Value::Array(values) => Value::Array(values.iter().map(round_json_value).collect()),
            Value::Object(object) => Value::Object(
                object
                    .iter()
                    .map(|(key, value)| (key.clone(), round_json_value(value)))
                    .collect(),
            ),
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

    fn default_style() -> Map<String, Value> {
        let mut style = Map::new();
        insert_string(&mut style, "backgroundColor", "");
        insert_border(&mut style, "borderBottom", 0.0, "#000000", "none");
        insert_border(&mut style, "borderLeft", 0.0, "#000000", "none");
        insert_number(&mut style, "borderRadius", 0.0);
        insert_border(&mut style, "borderRight", 0.0, "#000000", "none");
        insert_border(&mut style, "borderTop", 0.0, "#000000", "none");
        insert_string(&mut style, "boxSizing", "content-box");
        insert_string(&mut style, "clear", "none");
        insert_string(&mut style, "color", "#000000");
        insert_string(&mut style, "display", "block");
        insert_string(&mut style, "float", "none");
        insert_string(&mut style, "fontFamily", "serif");
        insert_number(&mut style, "fontSize", 16.0);
        insert_string(&mut style, "fontStyle", "normal");
        insert_number(&mut style, "fontWeight", 400.0);
        insert_number(&mut style, "height", 0.0);
        insert_string(&mut style, "language", "und");
        insert_number(&mut style, "letterSpacing", 0.0);
        insert_string(&mut style, "lineBreak", "auto");
        insert_number(&mut style, "lineHeight", 1.2);
        insert_string(&mut style, "listStyleType", "none");
        insert_number(&mut style, "marginBottom", 0.0);
        insert_number(&mut style, "marginLeft", 0.0);
        insert_bool(&mut style, "marginLeftAuto", false);
        insert_number(&mut style, "marginRight", 0.0);
        insert_bool(&mut style, "marginRightAuto", false);
        insert_number(&mut style, "marginTop", 0.0);
        insert_string(&mut style, "objectFit", "fill");
        insert_number(&mut style, "opacity", 1.0);
        insert_number(&mut style, "paddingBottom", 0.0);
        insert_number(&mut style, "paddingLeft", 0.0);
        insert_number(&mut style, "paddingRight", 0.0);
        insert_number(&mut style, "paddingTop", 0.0);
        insert_string(&mut style, "position", "static");
        insert_number(&mut style, "top", 0.0);
        insert_number(&mut style, "right", 0.0);
        insert_number(&mut style, "bottom", 0.0);
        insert_number(&mut style, "left", 0.0);
        insert_string(&mut style, "textAlign", "left");
        insert_string(&mut style, "textDecoration", "none");
        insert_number(&mut style, "textIndent", 0.0);
        insert_string(&mut style, "textJustify", "auto");
        insert_string(&mut style, "textTransform", "none");
        insert_string(&mut style, "verticalAlign", "baseline");
        insert_string(&mut style, "whiteSpace", "normal");
        insert_number(&mut style, "width", 0.0);
        insert_string(&mut style, "wordBreak", "normal");
        insert_number(&mut style, "wordSpacing", 0.0);
        style
    }

    pub(crate) fn inheritable_style(style: &Map<String, Value>) -> Map<String, Value> {
        let mut inherited = style.clone();
        merge_style(&mut inherited, &non_inherited_defaults());
        for key in NON_INHERITED_AUXILIARY_KEYS {
            inherited.remove(*key);
        }
        inherited
    }

    const NON_INHERITED_AUXILIARY_KEYS: &[&str] = &[
        "backgroundImage",
        "backgroundPosition",
        "backgroundRepeat",
        "backgroundSize",
        "borderRadiusPct",
        "marginBottomPct",
        "marginLeftPct",
        "marginRightPct",
        "marginTopPct",
        "maxWidthPct",
        "paddingBottomPct",
        "paddingLeftPct",
        "paddingRightPct",
        "paddingTopPct",
        "widthPct",
    ];

    fn non_inherited_defaults() -> Map<String, Value> {
        let mut defaults = Map::new();
        insert_string(&mut defaults, "backgroundColor", "");
        insert_border(&mut defaults, "borderBottom", 0.0, "#000000", "none");
        insert_border(&mut defaults, "borderLeft", 0.0, "#000000", "none");
        insert_number(&mut defaults, "borderRadius", 0.0);
        insert_border(&mut defaults, "borderRight", 0.0, "#000000", "none");
        insert_border(&mut defaults, "borderTop", 0.0, "#000000", "none");
        insert_string(&mut defaults, "boxSizing", "content-box");
        insert_string(&mut defaults, "clear", "none");
        insert_string(&mut defaults, "display", "block");
        insert_string(&mut defaults, "float", "none");
        insert_number(&mut defaults, "height", 0.0);
        insert_number(&mut defaults, "maxWidth", 0.0);
        insert_number(&mut defaults, "marginBottom", 0.0);
        insert_number(&mut defaults, "marginLeft", 0.0);
        insert_bool(&mut defaults, "marginLeftAuto", false);
        insert_number(&mut defaults, "marginRight", 0.0);
        insert_bool(&mut defaults, "marginRightAuto", false);
        insert_number(&mut defaults, "marginTop", 0.0);
        insert_string(&mut defaults, "objectFit", "fill");
        insert_number(&mut defaults, "opacity", 1.0);
        insert_string(&mut defaults, "overflow", "visible");
        insert_number(&mut defaults, "paddingBottom", 0.0);
        insert_number(&mut defaults, "paddingLeft", 0.0);
        insert_number(&mut defaults, "paddingRight", 0.0);
        insert_number(&mut defaults, "paddingTop", 0.0);
        insert_string(&mut defaults, "position", "static");
        insert_number(&mut defaults, "top", 0.0);
        insert_number(&mut defaults, "right", 0.0);
        insert_number(&mut defaults, "bottom", 0.0);
        insert_number(&mut defaults, "left", 0.0);
        insert_string(&mut defaults, "pageBreakAfter", "auto");
        insert_string(&mut defaults, "pageBreakBefore", "auto");
        insert_array(&mut defaults, "boxShadow", Vec::new());
        insert_array(&mut defaults, "transform", Vec::new());
        insert_string(&mut defaults, "verticalAlign", "baseline");
        insert_number(&mut defaults, "width", 0.0);
        defaults
    }

    fn apply_runtime_element_defaults(
        mut style: Map<String, Value>,
        tag: &str,
    ) -> Map<String, Value> {
        if tag == "img" {
            insert_string(&mut style, "objectFit", "contain");
            insert_string(&mut style, "boxSizing", "border-box");
        }
        style
    }

    fn is_display_none(style: &Map<String, Value>) -> bool {
        style.get("display").and_then(Value::as_str) == Some("none")
    }

    fn computed_style_hash(nodes: &[StyledNodeDetail]) -> String {
        hash_json(&Value::Array(
            nodes
                .iter()
                .map(|node| {
                    json!({
                        "path": node.path,
                        "style": node.style,
                    })
                })
                .collect(),
        ))
    }

    fn computed_style_detail_value(detail: &ComputedStyleDetail) -> Value {
        json!({
            "nodes": detail.nodes.iter().map(styled_node_detail_value).collect::<Vec<_>>(),
        })
    }

    fn styled_node_detail_value(node: &StyledNodeDetail) -> Value {
        json!({
            "path": node.path,
            "style": node.style,
            "tag": node.tag,
            "type": node.node_type,
        })
    }

    fn computed_style_node_sample(node: &StyledNodeDetail) -> ComputedStyleNodeSample {
        ComputedStyleNodeSample {
            node_type: node.node_type.clone(),
            tag: node.tag.clone(),
            path: node.path.clone(),
            style: node.style.clone(),
        }
    }

    fn computed_full_detail_hash(chapters: &[ComputedStyleChapterSummary]) -> String {
        hash_json(&Value::Array(
            chapters
                .iter()
                .map(|chapter| {
                    json!({
                        "detailHash": chapter.detail_hash,
                        "href": chapter.href,
                        "idref": chapter.idref,
                    })
                })
                .collect(),
        ))
    }

    fn insert_border(
        style: &mut Map<String, Value>,
        key: &str,
        width: f64,
        color: &str,
        kind: &str,
    ) {
        style.insert(
            key.to_owned(),
            Value::Object(Map::from_iter([
                ("color".to_owned(), Value::String(color.to_owned())),
                ("style".to_owned(), Value::String(kind.to_owned())),
                ("width".to_owned(), number_value(width)),
            ])),
        );
    }

    fn insert_string(style: &mut Map<String, Value>, key: &str, value: &str) {
        style.insert(key.to_owned(), Value::String(value.to_owned()));
    }

    fn insert_number(style: &mut Map<String, Value>, key: &str, value: f64) {
        style.insert(key.to_owned(), number_value(value));
    }

    fn insert_array(style: &mut Map<String, Value>, key: &str, values: Vec<Value>) {
        style.insert(key.to_owned(), Value::Array(values));
    }

    fn insert_bool(style: &mut Map<String, Value>, key: &str, value: bool) {
        style.insert(key.to_owned(), Value::Bool(value));
    }

    fn number_value(value: f64) -> Value {
        if value.is_finite()
            && value.fract() == 0.0
            && value >= i64::MIN as f64
            && value <= i64::MAX as f64
        {
            Value::Number(Number::from(value as i64))
        } else {
            Value::Number(Number::from_f64(value).unwrap_or_else(|| Number::from(0)))
        }
    }

    const COMPUTED_STYLE_KEYS: &[&str] = &[
        "backgroundColor",
        "borderBottom",
        "borderLeft",
        "borderRadius",
        "borderRight",
        "borderTop",
        "boxSizing",
        "clear",
        "color",
        "display",
        "float",
        "fontFamily",
        "fontSize",
        "fontStyle",
        "fontWeight",
        "height",
        "letterSpacing",
        "lineHeight",
        "lineHeightPx",
        "listStyleType",
        "marginBottom",
        "marginLeft",
        "marginLeftAuto",
        "marginRight",
        "marginRightAuto",
        "marginTop",
        "objectFit",
        "paddingBottom",
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "textAlign",
        "textDecoration",
        "textIndent",
        "verticalAlign",
        "width",
        "wordBreak",
        "wordSpacing",
    ];

    pub(crate) const DEFAULT_UA_STYLESHEET: &str = r#"
h1 { font-size: 2em; font-weight: bold; margin-top: 0.67em; margin-bottom: 0.67em; }
h2 { font-size: 1.5em; font-weight: bold; margin-top: 0.83em; margin-bottom: 0.83em; }
h3 { font-size: 1.17em; font-weight: bold; margin-top: 1em; margin-bottom: 1em; }
h4 { font-size: 1em; font-weight: bold; margin-top: 1.33em; margin-bottom: 1.33em; }
h5 { font-size: 0.83em; font-weight: bold; margin-top: 1.67em; margin-bottom: 1.67em; }
h6 { font-size: 0.67em; font-weight: bold; margin-top: 2.33em; margin-bottom: 2.33em; }

p { margin-top: 1em; margin-bottom: 1em; }
blockquote { margin-top: 1em; margin-bottom: 1em; margin-left: 40px; margin-right: 40px; }
pre { font-family: monospace; white-space: pre; margin-top: 1em; margin-bottom: 1em; }
code { font-family: monospace; }
em, i { font-style: italic; }
strong, b { font-weight: bold; }
center { text-align: center; }

ul { margin-top: 1em; margin-bottom: 1em; padding-left: 40px; list-style-type: disc; }
ol { margin-top: 1em; margin-bottom: 1em; padding-left: 40px; list-style-type: decimal; }
li { margin-top: 0; margin-bottom: 0; }
dl { margin-top: 1em; margin-bottom: 1em; }
dt { font-weight: bold; }
dd { margin-left: 40px; }

hr { margin-top: 0.5em; margin-bottom: 0.5em; }
th { font-weight: bold; }
sup { vertical-align: super; font-size: smaller; }
sub { vertical-align: sub; font-size: smaller; }
"#;

    fn selector_full_detail_hash(chapters: &[SelectorMatchChapterSummary]) -> String {
        hash_json(&Value::Array(
            chapters
                .iter()
                .map(|chapter| {
                    json!({
                        "detailHash": chapter.detail_hash,
                        "href": chapter.href,
                        "idref": chapter.idref,
                    })
                })
                .collect(),
        ))
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

    fn stable_json_object(object: &serde_json::Map<String, Value>, depth: usize) -> String {
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
        use rito_source::SourceArena;
        use serde_json::{json, Map, Value};

        use crate::{
            css::parse_css_rules,
            xhtml::{parse_xhtml, parse_xhtml_from_source},
        };

        use super::{
            build_chapter_rules, inheritable_style, insert_number, resolve_chapter_style_nodes,
            resolve_style_nodes, stylesheet_rules_from_texts, ChapterStyleOptions,
        };

        fn chapter_options() -> ChapterStyleOptions<'static> {
            ChapterStyleOptions {
                root_font_size: 16.0,
                line_height_override: None,
                line_height_force: false,
                font_family_override: None,
                font_family_force: false,
            }
        }

        #[test]
        fn inheritable_style_removes_non_inherited_percentage_helpers() {
            let mut style = Map::new();
            insert_number(&mut style, "fontSize", 16.0);
            insert_number(&mut style, "lineHeight", 1.2);
            style.insert("wordBreak".to_owned(), json!("keep-all"));
            style.insert("marginTopPct".to_owned(), json!(20));
            style.insert("widthPct".to_owned(), json!(100));
            style.insert("position".to_owned(), json!("relative"));
            style.insert("top".to_owned(), json!(10));
            style.insert("right".to_owned(), json!(20));
            style.insert("bottom".to_owned(), json!(30));
            style.insert("left".to_owned(), json!(40));
            style.insert(
                "transform".to_owned(),
                Value::Array(vec![json!({ "kind": "rotate", "angle": 5 })]),
            );

            let inherited = inheritable_style(&style);

            assert!(!inherited.contains_key("marginTopPct"));
            assert!(!inherited.contains_key("widthPct"));
            assert_eq!(inherited.get("marginTop"), Some(&json!(0)));
            assert_eq!(inherited.get("transform"), Some(&Value::Array(Vec::new())));
            assert_eq!(inherited.get("wordBreak"), Some(&json!("keep-all")));
            assert_eq!(inherited.get("position"), Some(&json!("static")));
            assert_eq!(inherited.get("top"), Some(&json!(0)));
            assert_eq!(inherited.get("right"), Some(&json!(0)));
            assert_eq!(inherited.get("bottom"), Some(&json!(0)));
            assert_eq!(inherited.get("left"), Some(&json!(0)));
        }

        #[test]
        fn relative_insets_do_not_inherit_from_parent_elements() {
            let parsed = parse_xhtml(
            r#"<html><body><div style="position: relative; top: 10px; right: 20px; bottom: 30px; left: 40px"><p style="position: relative; right: 6px; bottom: 5px">Child</p></div></body></html>"#,
        )
        .expect("xhtml parses");
            let styled = resolve_style_nodes(&parsed.nodes, &[]);
            let parent = styled
                .iter()
                .find(|node| node.tag.as_deref() == Some("div"))
                .expect("parent is styled");
            let child = parent
                .children
                .iter()
                .find(|node| node.tag.as_deref() == Some("p"))
                .expect("child is styled");

            assert_eq!(parent.style.get("top"), Some(&json!(10)));
            assert_eq!(parent.style.get("left"), Some(&json!(40)));
            assert_eq!(child.style.get("position"), Some(&json!("relative")));
            assert_eq!(child.style.get("top"), Some(&json!(0)));
            assert_eq!(child.style.get("right"), Some(&json!(6)));
            assert_eq!(child.style.get("bottom"), Some(&json!(5)));
            assert_eq!(child.style.get("left"), Some(&json!(0)));
        }

        #[test]
        fn resolved_style_nodes_retain_canonical_source_node_ids() {
            let source = SourceArena::from_xhtml(
            r#"<html><body><section><p id="target"><span>text</span></p></section></body></html>"#,
        )
        .expect("xhtml parses");
            let target_id = source
                .find_element_by_id("target")
                .expect("canonical target id");
            let parsed = parse_xhtml_from_source(&source);

            let styled = resolve_style_nodes(&parsed.nodes, &[]);
            let paragraph = styled
                .iter()
                .flat_map(|section| &section.children)
                .find(|node| node.id.as_deref() == Some("target"))
                .expect("paragraph is styled");

            assert_eq!(
                paragraph
                    .source_ref
                    .as_ref()
                    .and_then(|source_ref| source_ref.source_node_id),
                Some(target_id)
            );
        }

        #[test]
        fn resolved_style_carries_line_breaking_inputs() {
            let parsed = parse_xhtml(
            r#"<html><body><p lang="ja" style="white-space: pre-wrap; line-break: strict; word-break: keep-all; text-justify: inter-character">本文</p></body></html>"#,
        )
        .expect("xhtml parses");
            let styled = resolve_style_nodes(&parsed.nodes, &[]);
            let paragraph = styled
                .iter()
                .find(|node| node.tag.as_deref() == Some("p"))
                .expect("paragraph is styled");

            assert_eq!(paragraph.style.get("language"), Some(&json!("ja")));
            assert_eq!(paragraph.style.get("whiteSpace"), Some(&json!("pre-wrap")));
            assert_eq!(paragraph.style.get("lineBreak"), Some(&json!("strict")));
            assert_eq!(paragraph.style.get("wordBreak"), Some(&json!("keep-all")));
            assert_eq!(
                paragraph.style.get("textJustify"),
                Some(&json!("inter-character"))
            );
        }

        #[test]
        fn non_plain_unitless_line_height_keeps_absolute_px_like_ts_handler() {
            let parsed =
                parse_xhtml(r#"<html><body><p style="line-height: -1">本文</p></body></html>"#)
                    .expect("xhtml parses");
            let styled = resolve_style_nodes(&parsed.nodes, &[]);
            let paragraph = styled
                .iter()
                .find(|node| node.tag.as_deref() == Some("p"))
                .expect("paragraph is styled");

            assert_eq!(paragraph.style.get("lineHeight"), Some(&json!(-1)));
            assert_eq!(paragraph.style.get("lineHeightPx"), Some(&json!(-16)));
        }

        #[test]
        fn chapter_body_style_applies_presentational_class_and_inline_attrs() {
            let parsed = parse_xhtml(
            r##"<html><body class="cover" bgcolor="#000000" style="background-color: #333333; color: #123456"><p>本文</p></body></html>"##,
        )
        .expect("xhtml parses");
            let rules =
                parse_css_rules("body.cover { background-color: #1EDCF0; color: #abcdef; }");

            let resolved = resolve_chapter_style_nodes(
                &parsed.nodes,
                &rules,
                parsed.body_attributes.as_ref(),
                None,
                chapter_options(),
            );
            let paragraph = resolved
                .styled_nodes
                .iter()
                .find(|node| node.tag.as_deref() == Some("p"))
                .expect("paragraph is styled");

            assert_eq!(
                resolved.page_paint,
                Some(json!({ "backgroundColor": "#333333" }))
            );
            assert_eq!(paragraph.style.get("color"), Some(&json!("#123456")));
        }

        #[test]
        fn chapter_rules_preserve_source_order_fallback_and_ambiguous_href_semantics() {
            let stylesheets = stylesheet_rules_from_texts([
                ("Styles/A/main.css", ".a { color: red; }"),
                ("Styles/B/main.css", ".b { color: blue; }"),
                ("Styles/only.css", ".only { color: green; }"),
            ]);

            let all = build_chapter_rules(&stylesheets, &[], 18.0);
            assert_eq!(
                all.iter()
                    .map(|rule| rule.selector.as_str())
                    .collect::<Vec<_>>(),
                [".a", ".b", ".only"]
            );
            let ambiguous = parse_xhtml(
                r#"<html><head><link rel="stylesheet" href="../main.css"/></head><body/></html>"#,
            )
            .expect("ambiguous source parses");
            assert!(
                build_chapter_rules(&stylesheets, &ambiguous.author_stylesheets, 18.0).is_empty()
            );

            let ordered = parse_xhtml(
                r#"<html><head>
            <style>.first { color: black; }</style>
            <link rel="stylesheet" href="../Styles/only.css?cache=1"/>
            <style>.last { margin-left: 1rem; }</style>
            </head><body/></html>"#,
            )
            .expect("ordered source parses");
            let selected = build_chapter_rules(&stylesheets, &ordered.author_stylesheets, 18.0);
            assert_eq!(
                selected
                    .iter()
                    .map(|rule| rule.selector.as_str())
                    .collect::<Vec<_>>(),
                [".first", ".only", ".last"]
            );
            assert_eq!(selected[2].declarations.get("marginLeft"), Some(&json!(18)));
        }

        #[test]
        fn chapter_root_cascade_uses_html_rem_body_attributes_and_wrapper_ancestors_once() {
            let parsed = parse_xhtml(
            r#"<html><body id="reader" class="night" data-mode="on" style="font-family: Inline"><p>Text</p></body></html>"#,
        )
        .expect("xhtml parses");
            let rules = parse_css_rules(
                r#"
            html { font-size: 20px; }
            body { font-size: 2em; }
            body#reader.night[data-mode="on"] { color: #123456; }
            html body p { font-size: 0.5em; margin-left: 1rem; }
            "#,
            );

            let resolved = resolve_chapter_style_nodes(
                &parsed.nodes,
                &rules,
                parsed.body_attributes.as_ref(),
                None,
                chapter_options(),
            );
            let paragraph = resolved
                .styled_nodes
                .iter()
                .find(|node| node.tag.as_deref() == Some("p"))
                .expect("paragraph is styled");

            assert_eq!(paragraph.style.get("fontSize"), Some(&json!(20)));
            assert_eq!(paragraph.style.get("marginLeft"), Some(&json!(20)));
            assert_eq!(paragraph.style.get("color"), Some(&json!("#123456")));
            assert_eq!(paragraph.style.get("fontFamily"), Some(&json!("Inline")));
        }

        #[test]
        fn forced_typography_overrides_element_rules() {
            let parsed = parse_xhtml(
            r#"<html><body><p style="font-family: Book; line-height: 2">Text</p></body></html>"#,
        )
        .expect("xhtml parses");
            let options = ChapterStyleOptions {
                root_font_size: 16.0,
                line_height_override: Some(1.6),
                line_height_force: true,
                font_family_override: Some("Reader"),
                font_family_force: true,
            };
            let resolved = resolve_chapter_style_nodes(
                &parsed.nodes,
                &[],
                parsed.body_attributes.as_ref(),
                None,
                options,
            );
            let paragraph = resolved
                .styled_nodes
                .iter()
                .find(|node| node.tag.as_deref() == Some("p"))
                .expect("paragraph is styled");

            assert_eq!(paragraph.style.get("lineHeight"), Some(&json!(1.6)));
            assert!(!paragraph.style.contains_key("lineHeightPx"));
            assert_eq!(paragraph.style.get("fontFamily"), Some(&json!("Reader")));
        }

        #[test]
        fn pseudo_elements_inject_content_and_wrap_inline_runs_like_ts() {
            let parsed = parse_xhtml(
                r#"<html><body><p class="note">Body</p><p class="empty">Skip</p></body></html>"#,
            )
            .expect("xhtml parses");
            let rules = parse_css_rules(
                r#"
            .note::before { content: "\41 " "B"; display: block; color: #aa0000; }
            .note::after { content: "Z"; font-weight: bold; }
            .empty::before { content: none; }
            "#,
            );
            let styled = resolve_style_nodes(&parsed.nodes, &rules);
            let paragraph = styled
                .iter()
                .find(|node| node.tag.as_deref() == Some("p") && node.id.is_none())
                .expect("paragraph is styled");

            assert_eq!(paragraph.children.len(), 3);
            assert_eq!(
                paragraph.children[0].node_type,
                super::StyledNodeKind::Block
            );
            assert_eq!(
                paragraph.children[0].children[0].content.as_deref(),
                Some("AB")
            );
            assert_eq!(
                paragraph.children[0].style.get("color"),
                Some(&json!("#aa0000"))
            );
            assert_eq!(
                paragraph.children[1].node_type,
                super::StyledNodeKind::Block
            );
            assert_eq!(paragraph.children[1].tag, None);
            assert_eq!(
                paragraph.children[1].children[0].content.as_deref(),
                Some("Body")
            );
            assert_eq!(
                paragraph.children[2].node_type,
                super::StyledNodeKind::Inline
            );
            assert_eq!(
                paragraph.children[2].children[0].content.as_deref(),
                Some("Z")
            );
            assert_eq!(
                paragraph.children[2].style.get("fontWeight"),
                Some(&json!(700))
            );
        }

        #[test]
        fn inline_host_demotes_block_pseudo_element() {
            let parsed =
                parse_xhtml(r#"<html><body><p><span class="badge">Body</span></p></body></html>"#)
                    .expect("xhtml parses");
            let rules = parse_css_rules(r#".badge::before { content: "X"; display: block; }"#);
            let styled = resolve_style_nodes(&parsed.nodes, &rules);
            let paragraph = styled
                .iter()
                .find(|node| node.tag.as_deref() == Some("p"))
                .expect("paragraph is styled");
            let span = paragraph
                .children
                .iter()
                .find(|node| node.tag.as_deref() == Some("span"))
                .expect("span is styled");

            assert_eq!(span.children[0].node_type, super::StyledNodeKind::Inline);
            assert_eq!(
                span.children[0].style.get("display"),
                Some(&json!("inline"))
            );
            assert_eq!(span.children[0].children[0].content.as_deref(), Some("X"));
        }
    }
}

#[cfg(feature = "bench-internals")]
pub(crate) use legacy::find_matching_stylesheet_keys;
#[cfg(feature = "legacy-css-diagnostics")]
pub(crate) use legacy::{
    build_chapter_rules, resolve_chapter_style_nodes, stylesheet_rules_from_texts,
    summarize_style_from_parsed_chapters, ParsedStyleChapterInput, StylesheetRuleMap,
};
