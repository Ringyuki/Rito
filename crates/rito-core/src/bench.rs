//! Feature-gated benchmark access to the current style resolver.
//!
//! This module is not part of the production API. It exists so isolated
//! benchmark binaries can time the resolver without also timing pagination.

use std::{collections::BTreeMap, sync::Arc};

use rito_source::{NodeId, SourceArena};
use serde_json::{Map, Value};

use crate::{
    css::{CssColorScheme, CssRuleSummary, CssViewport},
    style::{
        build_chapter_rules, find_matching_stylesheet_keys, resolve_chapter_style_nodes,
        stylesheet_rules_from_texts, ChapterStyleOptions, StyledNode, StyledNodeKind,
    },
    xhtml::{parse_xhtml_from_source, AuthorStylesheetSource, DocumentNode, ElementAttributes},
};

mod legacy_inline_v1;

pub use crate::layout::bounded_work_probe::{
    capture_bounded_pagination_work, AtomicTextOperationProbe, AtomicTextOperationsProbe,
    BoundedPaginationWorkProbe, ChapterStartTimingsProbe, ContinuationStageTimingsProbe,
    ContinuationTimingSemanticsProbe, DurationProbe, LayoutScopeWorkProbe, MeasurementCacheProbe,
    MeasurementCacheSourcesProbe, RustybuzzShapeRunProbe, StyleBackendWorkProbe, TextWorkProbe,
};

pub use legacy_inline_v1::{
    LegacyBorderEdgeGeometryV1, LegacyBorderGeometryV1, LegacyBoxShadowGeometryV1,
    LegacyFontFamiliesEvidenceV1, LegacyInlineEvidenceV1, LegacyInlineFieldDispositionV1,
    LegacyInlineFieldOutcomeV1, LegacyInlineFieldReasonV1, LegacyInlineFieldV1,
    LegacyInlineNodeDispositionV1, LegacyInlineStyleProjectionV1, LegacyTextDecorationGeometryV1,
    LegacyTextShadowGeometryV1,
};

pub const LEGACY_UA_PROFILE_ID: &str = "rito-current-rust-legacy-ua-v1";

pub struct PreparedLegacyStyle {
    source_arena: Arc<SourceArena>,
    nodes: Vec<DocumentNode>,
    rules: Vec<CssRuleSummary>,
    body_attributes: Option<ElementAttributes>,
    body_source_node_id: Option<NodeId>,
    viewport: LegacyStyleViewport,
    element_count: usize,
    author_stylesheet_sequence: Vec<LegacyAuthorStylesheetRecord>,
    source_order_complete: bool,
    source_order_issues: Vec<String>,
    media_environment_compatible: bool,
    media_environment_issues: Vec<String>,
}

pub struct ResolvedLegacyStyle {
    styled_nodes: Vec<StyledNode>,
}

pub struct ChapterCssSelection {
    pub external_stylesheets: Vec<(String, String)>,
    pub embedded_stylesheets: Vec<String>,
    pub embedded_stylesheet_count: usize,
    pub author_stylesheet_sequence: Vec<LegacyAuthorStylesheetRecord>,
    pub source_order_complete: bool,
    pub source_order_issues: Vec<String>,
    pub media_environment_compatible: bool,
    pub media_environment_issues: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct LegacySourceStyle {
    pub node_id: NodeId,
    pub node_kind: StyledNodeKind,
    pub tag: Option<String>,
    pub id: Option<String>,
    pub style: Map<String, Value>,
}

#[derive(Debug, Clone)]
pub struct LegacyElementScopeRecord {
    pub node_id: NodeId,
    pub node_kind: StyledNodeKind,
    pub tag: String,
    pub id: Option<String>,
    pub source_path: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyTopologyDisposition {
    PrincipalElement,
    RootStyleCarrier,
    HardBreakToken,
    Suppressed,
    SuppressedByAncestor,
    Incomplete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyTopologyDisplayOutside {
    Inline,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyTopologyDisplayInside {
    Flow,
    FlowRoot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LegacyTopologyDisplay {
    pub outside: LegacyTopologyDisplayOutside,
    pub inside: LegacyTopologyDisplayInside,
    pub is_list_item: bool,
}

#[derive(Debug, Clone)]
pub struct LegacyTopologyObservation {
    pub node_id: NodeId,
    pub semantic_parent_node_id: Option<NodeId>,
    pub semantic_ordinal: Option<usize>,
    pub canonical_parent_node_id: Option<NodeId>,
    pub canonical_ordinal: Option<usize>,
    pub disposition: LegacyTopologyDisposition,
    pub semantic_kind: Option<StyledNodeKind>,
    pub effective_display: Option<LegacyTopologyDisplay>,
    pub root_attributes_consumed: Option<bool>,
    pub suppressed_ancestor_node_id: Option<NodeId>,
}

#[derive(Debug, Clone)]
pub struct LegacyTopologySnapshot {
    pub records: Vec<LegacyTopologyObservation>,
    pub semantic_duplicate_count: usize,
    pub participating_duplicate_count: usize,
}

#[derive(Debug, Clone)]
pub struct LegacyAuthorStylesheetRecord {
    pub source_node_id: Option<NodeId>,
    pub source_kind: &'static str,
    pub source_id: String,
    pub css: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyColorScheme {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LegacyStyleViewport {
    pub width_css_px: f64,
    pub height_css_px: f64,
    pub device_pixel_ratio: f64,
    pub color_scheme: LegacyColorScheme,
}

impl LegacyStyleViewport {
    pub fn new(width_css_px: f64, height_css_px: f64) -> Self {
        Self {
            width_css_px,
            height_css_px,
            device_pixel_ratio: 1.0,
            color_scheme: LegacyColorScheme::Light,
        }
    }

    fn css_viewport(self) -> CssViewport {
        CssViewport {
            width: self.width_css_px,
            height: self.height_css_px,
            device_pixel_ratio: self.device_pixel_ratio,
            color_scheme: match self.color_scheme {
                LegacyColorScheme::Light => CssColorScheme::Light,
                LegacyColorScheme::Dark => CssColorScheme::Dark,
            },
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LegacyStyleProjection {
    pub styled_node_count: usize,
    pub style_property_count: usize,
    pub digest: u64,
}

impl PreparedLegacyStyle {
    pub fn compile(
        xhtml: &str,
        stylesheets: &[(String, String)],
        viewport_width: f64,
        viewport_height: f64,
    ) -> Result<Self, String> {
        let source = Arc::new(
            SourceArena::from_xhtml(xhtml).map_err(|error| format!("Invalid XHTML: {error}"))?,
        );
        Ok(Self::compile_from_source(
            source,
            stylesheets,
            viewport_width,
            viewport_height,
        ))
    }

    pub fn compile_from_source(
        source: Arc<SourceArena>,
        stylesheets: &[(String, String)],
        viewport_width: f64,
        viewport_height: f64,
    ) -> Self {
        Self::compile_from_source_with_viewport(
            source,
            stylesheets,
            LegacyStyleViewport::new(viewport_width, viewport_height),
        )
    }

    pub fn compile_from_source_with_viewport(
        source: Arc<SourceArena>,
        stylesheets: &[(String, String)],
        viewport: LegacyStyleViewport,
    ) -> Self {
        let parsed = parse_xhtml_from_source(&source);
        let stylesheet_rules = stylesheet_rules_from_texts(
            stylesheets
                .iter()
                .map(|(href, css)| (href.as_str(), css.as_str())),
        );
        let rules = build_chapter_rules(&stylesheet_rules, &parsed.author_stylesheets, 16.0);
        let author_selection = select_author_stylesheets(stylesheets, &parsed.author_stylesheets);
        let element_count = count_elements(&parsed.nodes);
        Self {
            source_arena: source,
            nodes: parsed.nodes,
            rules,
            body_attributes: parsed.body_attributes,
            body_source_node_id: parsed.body_source_node_id,
            viewport,
            element_count,
            author_stylesheet_sequence: author_selection.records,
            source_order_complete: author_selection.complete,
            source_order_issues: author_selection.issues,
            media_environment_compatible: author_selection.media_environment_compatible,
            media_environment_issues: author_selection.media_environment_issues,
        }
    }

    pub fn element_count(&self) -> usize {
        self.element_count
    }

    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }

    pub fn author_stylesheet_sequence(&self) -> &[LegacyAuthorStylesheetRecord] {
        &self.author_stylesheet_sequence
    }

    pub fn viewport(&self) -> LegacyStyleViewport {
        self.viewport
    }

    pub fn source_order_complete(&self) -> bool {
        self.source_order_complete
    }

    pub fn source_order_issues(&self) -> &[String] {
        &self.source_order_issues
    }

    pub fn media_environment_compatible(&self) -> bool {
        self.media_environment_compatible
    }

    pub fn media_environment_issues(&self) -> &[String] {
        &self.media_environment_issues
    }

    pub fn topology_observations(&self, resolved: &ResolvedLegacyStyle) -> LegacyTopologySnapshot {
        legacy_topology_observations(
            &self.source_arena,
            &self.nodes,
            &resolved.styled_nodes,
            self.body_source_node_id,
        )
    }

    /// Source-backed semantic elements before cascade can suppress them.
    ///
    /// This benchmark-only scope is deliberately captured from the parsed
    /// semantic tree rather than the resolved style tree, so `display:none`
    /// cannot silently disappear from a differential identity gate.
    pub fn source_element_scope(&self) -> Vec<LegacyElementScopeRecord> {
        let mut output = Vec::new();
        collect_source_element_scope(&self.nodes, &mut output);
        output
    }

    pub fn resolve(&self) -> ResolvedLegacyStyle {
        let resolved = resolve_chapter_style_nodes(
            &self.nodes,
            &self.rules,
            self.body_attributes.as_ref(),
            Some(self.viewport.css_viewport()),
            ChapterStyleOptions {
                root_font_size: 16.0,
                line_height_override: None,
                line_height_force: false,
                font_family_override: None,
                font_family_force: false,
            },
        );
        ResolvedLegacyStyle {
            styled_nodes: resolved.styled_nodes,
        }
    }
}

impl ResolvedLegacyStyle {
    pub fn project(&self) -> LegacyStyleProjection {
        let mut state = ProjectionState::default();
        project_nodes(&self.styled_nodes, &mut state);
        LegacyStyleProjection {
            styled_node_count: state.styled_node_count,
            style_property_count: state.style_property_count,
            digest: state.digest,
        }
    }

    pub fn style_for_id(&self, id: &str) -> Option<&Map<String, Value>> {
        find_style_for_id(&self.styled_nodes, id)
    }

    pub fn source_element_styles(&self) -> Vec<LegacySourceStyle> {
        let mut output = Vec::new();
        collect_source_element_styles(&self.styled_nodes, &mut output);
        output
    }
}

pub fn select_chapter_css(
    xhtml: &str,
    stylesheets: &[(String, String)],
) -> Result<ChapterCssSelection, String> {
    let source = Arc::new(
        SourceArena::from_xhtml(xhtml).map_err(|error| format!("Invalid XHTML: {error}"))?,
    );
    Ok(select_chapter_css_from_source(source, stylesheets))
}

pub fn select_chapter_css_from_source(
    source: Arc<SourceArena>,
    stylesheets: &[(String, String)],
) -> ChapterCssSelection {
    let parsed = parse_xhtml_from_source(&source);
    let selection = select_author_stylesheets(stylesheets, &parsed.author_stylesheets);
    let external_stylesheets = selection
        .records
        .iter()
        .filter(|record| record.source_kind == "external")
        .map(|record| (record.source_id.clone(), record.css.clone()))
        .collect::<Vec<_>>();
    let embedded_stylesheets = selection
        .records
        .iter()
        .filter(|record| record.source_kind == "embedded")
        .map(|record| record.css.clone())
        .collect::<Vec<_>>();
    let embedded_stylesheet_count = embedded_stylesheets.len();
    ChapterCssSelection {
        external_stylesheets,
        embedded_stylesheets,
        embedded_stylesheet_count,
        author_stylesheet_sequence: selection.records,
        source_order_complete: selection.complete,
        source_order_issues: selection.issues,
        media_environment_compatible: selection.media_environment_compatible,
        media_environment_issues: selection.media_environment_issues,
    }
}

pub fn default_ua_stylesheet() -> &'static str {
    crate::style::DEFAULT_UA_STYLESHEET
}

struct AuthorStylesheetSelection {
    records: Vec<LegacyAuthorStylesheetRecord>,
    complete: bool,
    issues: Vec<String>,
    media_environment_compatible: bool,
    media_environment_issues: Vec<String>,
}

fn select_author_stylesheets(
    stylesheets: &[(String, String)],
    sources: &[AuthorStylesheetSource],
) -> AuthorStylesheetSelection {
    let keys = stylesheets
        .iter()
        .map(|(href, _)| href.as_str())
        .collect::<Vec<_>>();
    let has_external_source = sources
        .iter()
        .any(|source| matches!(source, AuthorStylesheetSource::External { .. }));
    let mut selection = AuthorStylesheetSelection {
        records: Vec::new(),
        complete: true,
        issues: Vec::new(),
        media_environment_compatible: true,
        media_environment_issues: Vec::new(),
    };
    if !has_external_source && !stylesheets.is_empty() {
        selection.complete = false;
        selection.issues.push(
            "legacy implicit-all-external fallback has no document source-order occurrence"
                .to_owned(),
        );
        selection
            .records
            .extend(
                stylesheets
                    .iter()
                    .map(|(href, css)| LegacyAuthorStylesheetRecord {
                        source_node_id: None,
                        source_kind: "external",
                        source_id: href.clone(),
                        css: css.clone(),
                    }),
            );
    }
    let mut embedded_index = 0;
    for source in sources {
        match source {
            AuthorStylesheetSource::External {
                source_node_id,
                href,
                selection_issues,
                media_environment_issues,
            } => append_external_stylesheet(
                &mut selection,
                stylesheets,
                &keys,
                *source_node_id,
                href,
                selection_issues,
                media_environment_issues,
            ),
            AuthorStylesheetSource::Embedded {
                source_node_id,
                css,
                selection_issues,
                media_environment_issues,
            } => {
                append_selection_issues(&mut selection, *source_node_id, selection_issues);
                append_media_environment_issues(
                    &mut selection,
                    *source_node_id,
                    media_environment_issues,
                );
                append_media_query_issue(&mut selection, *source_node_id, css);
                append_import_issue(&mut selection, *source_node_id, css);
                selection.records.push(LegacyAuthorStylesheetRecord {
                    source_node_id: Some(*source_node_id),
                    source_kind: "embedded",
                    source_id: embedded_index.to_string(),
                    css: css.clone(),
                });
                embedded_index += 1;
            }
        }
    }
    selection
}

fn append_external_stylesheet(
    selection: &mut AuthorStylesheetSelection,
    stylesheets: &[(String, String)],
    keys: &[&str],
    source_node_id: NodeId,
    href: &str,
    source_issues: &[String],
    media_environment_issues: &[String],
) {
    append_selection_issues(selection, source_node_id, source_issues);
    append_media_environment_issues(selection, source_node_id, media_environment_issues);
    let matching_keys = find_matching_stylesheet_keys(keys, href);
    if matching_keys.len() != 1 {
        selection.complete = false;
        selection.issues.push(format!(
            "stylesheet link node {} resolved to {} publication entries",
            source_node_id.index(),
            matching_keys.len()
        ));
        return;
    }
    let Some((resolved_href, css)) = stylesheets
        .iter()
        .find(|(candidate, _)| candidate == matching_keys[0])
    else {
        selection.complete = false;
        selection.issues.push(format!(
            "stylesheet link node {} lost its resolved publication entry",
            source_node_id.index()
        ));
        return;
    };
    append_media_query_issue(selection, source_node_id, css);
    append_import_issue(selection, source_node_id, css);
    selection.records.push(LegacyAuthorStylesheetRecord {
        source_node_id: Some(source_node_id),
        source_kind: "external",
        source_id: resolved_href.clone(),
        css: css.clone(),
    });
}

fn append_selection_issues(
    selection: &mut AuthorStylesheetSelection,
    source_node_id: NodeId,
    source_issues: &[String],
) {
    if source_issues.is_empty() {
        return;
    }
    selection.complete = false;
    selection.issues.extend(
        source_issues
            .iter()
            .map(|issue| format!("stylesheet source node {}: {issue}", source_node_id.index())),
    );
}

fn append_media_environment_issues(
    selection: &mut AuthorStylesheetSelection,
    source_node_id: NodeId,
    source_issues: &[String],
) {
    if source_issues.is_empty() {
        return;
    }
    selection.complete = false;
    selection.media_environment_compatible = false;
    selection.media_environment_issues.extend(
        source_issues
            .iter()
            .map(|issue| format!("stylesheet source node {}: {issue}", source_node_id.index())),
    );
}

fn append_media_query_issue(
    selection: &mut AuthorStylesheetSelection,
    source_node_id: NodeId,
    css: &str,
) {
    if !contains_at_rule(css, b"media") {
        return;
    }
    selection.media_environment_compatible = false;
    selection.media_environment_issues.push(format!(
        "stylesheet source node {}: @media environment evaluation is not capability-equivalent",
        source_node_id.index()
    ));
}

fn append_import_issue(
    selection: &mut AuthorStylesheetSelection,
    source_node_id: NodeId,
    css: &str,
) {
    if !contains_at_rule(css, b"import") {
        return;
    }
    selection.complete = false;
    selection.issues.push(format!(
        "stylesheet source node {}: @import dependency graph is not expanded",
        source_node_id.index()
    ));
}

fn contains_at_rule(css: &str, expected_name: &[u8]) -> bool {
    let bytes = css.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"/*") {
            index = skip_css_comment(bytes, index + 2);
            continue;
        }
        if matches!(bytes[index], b'\'' | b'"') {
            index = skip_css_string(bytes, index + 1, bytes[index]);
            continue;
        }
        if bytes[index] == b'@' {
            let start = index + 1;
            index = start;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'-' | b'_'))
            {
                index += 1;
            }
            if bytes[start..index].eq_ignore_ascii_case(expected_name)
                || bytes.get(index) == Some(&b'\\')
            {
                return true;
            }
            continue;
        }
        index += 1;
    }
    false
}

fn skip_css_comment(bytes: &[u8], mut index: usize) -> usize {
    while index + 1 < bytes.len() {
        if bytes[index..].starts_with(b"*/") {
            return index + 2;
        }
        index += 1;
    }
    bytes.len()
}

fn skip_css_string(bytes: &[u8], mut index: usize, quote: u8) -> usize {
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = (index + 2).min(bytes.len());
        } else if bytes[index] == quote {
            return index + 1;
        } else {
            index += 1;
        }
    }
    bytes.len()
}

#[derive(Default)]
struct ProjectionState {
    styled_node_count: usize,
    style_property_count: usize,
    digest: u64,
}

fn count_elements(nodes: &[DocumentNode]) -> usize {
    nodes
        .iter()
        .map(|node| match node {
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                1 + count_elements(&element.children)
            }
            DocumentNode::Image(_) => 1,
            DocumentNode::Text(_) => 0,
        })
        .sum()
}

fn project_nodes(nodes: &[StyledNode], state: &mut ProjectionState) {
    for node in nodes {
        state.styled_node_count += 1;
        state.style_property_count += node.style.len();
        hash_bytes(
            &mut state.digest,
            node.tag.as_deref().unwrap_or("#text").as_bytes(),
        );
        for key in ["display", "fontSize", "fontWeight", "lineHeight", "color"] {
            if let Some(value) = node.style.get(key) {
                hash_bytes(&mut state.digest, key.as_bytes());
                hash_bytes(&mut state.digest, value.to_string().as_bytes());
            }
        }
        project_nodes(&node.children, state);
    }
}

fn find_style_for_id<'a>(nodes: &'a [StyledNode], id: &str) -> Option<&'a Map<String, Value>> {
    for node in nodes {
        if node.id.as_deref() == Some(id) {
            return Some(&node.style);
        }
        if let Some(style) = find_style_for_id(&node.children, id) {
            return Some(style);
        }
    }
    None
}

fn collect_source_element_styles(nodes: &[StyledNode], output: &mut Vec<LegacySourceStyle>) {
    for node in nodes {
        if node.node_type != StyledNodeKind::Text {
            if let Some(node_id) = node
                .source_ref
                .as_ref()
                .and_then(|source_ref| source_ref.source_node_id)
            {
                output.push(LegacySourceStyle {
                    node_id,
                    node_kind: node.node_type,
                    tag: node.tag.clone(),
                    id: node.id.clone(),
                    style: node.style.clone(),
                });
            }
        }
        collect_source_element_styles(&node.children, output);
    }
}

fn collect_source_element_scope(
    nodes: &[DocumentNode],
    output: &mut Vec<LegacyElementScopeRecord>,
) {
    for node in nodes {
        match node {
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                if let Some(node_id) = element.source_ref.source_node_id {
                    output.push(LegacyElementScopeRecord {
                        node_id,
                        node_kind: match node {
                            DocumentNode::Block(_) => StyledNodeKind::Block,
                            DocumentNode::Inline(_) => StyledNodeKind::Inline,
                            _ => unreachable!("matched element node"),
                        },
                        tag: element.tag.clone(),
                        id: element
                            .attributes
                            .as_ref()
                            .and_then(|attributes| attributes.id.clone()),
                        source_path: element.source_ref.node_path.clone(),
                    });
                }
                collect_source_element_scope(&element.children, output);
            }
            DocumentNode::Image(image) => {
                if let Some(node_id) = image.source_ref.source_node_id {
                    output.push(LegacyElementScopeRecord {
                        node_id,
                        node_kind: StyledNodeKind::Image,
                        tag: "img".to_owned(),
                        id: image
                            .attributes
                            .as_ref()
                            .and_then(|attributes| attributes.id.clone()),
                        source_path: image.source_ref.node_path.clone(),
                    });
                }
            }
            DocumentNode::Text(_) => {}
        }
    }
}

#[derive(Clone, Copy)]
enum LegacySemanticTopologyKind {
    Principal(StyledNodeKind),
    HardBreak,
}

#[derive(Clone, Copy)]
struct LegacySemanticTopologyRecord {
    canonical_parent_node_id: Option<NodeId>,
    canonical_ordinal: usize,
    kind: LegacySemanticTopologyKind,
}

#[derive(Clone, Copy)]
struct LegacyParticipatingTopologyRecord {
    kind: StyledNodeKind,
    display: LegacyTopologyDisplay,
}

fn legacy_topology_observations(
    source: &SourceArena,
    nodes: &[DocumentNode],
    styled_nodes: &[StyledNode],
    selected_body: Option<NodeId>,
) -> LegacyTopologySnapshot {
    let mut semantic = BTreeMap::new();
    let mut semantic_duplicate_count = 0;
    collect_legacy_semantic_topology(
        nodes,
        source,
        None,
        &mut semantic,
        &mut semantic_duplicate_count,
    );
    let mut participating = BTreeMap::new();
    let mut participating_duplicate_count = 0;
    collect_participating_source_elements(
        styled_nodes,
        source,
        &mut participating,
        &mut participating_duplicate_count,
    );
    let selected_html = source
        .node(source.root_element())
        .and_then(|node| node.as_element())
        .is_some_and(|element| element.name.local_name == "html")
        .then_some(source.root_element());
    let mut records = source
        .iter()
        .filter_map(|(node_id, node)| {
            node.as_element()?;
            if Some(node_id) == selected_html && Some(node_id) == selected_body {
                return Some(incomplete_topology(node_id));
            }
            if Some(node_id) == selected_html {
                return Some(root_style_carrier(node_id, false));
            }
            if Some(node_id) == selected_body {
                return Some(root_style_carrier(node_id, true));
            }
            let Some(record) = semantic.get(&node_id) else {
                return Some(incomplete_topology(node_id));
            };
            let suppressed_ancestor_node_id = first_suppressed_semantic_ancestor(
                record.canonical_parent_node_id,
                &semantic,
                &participating,
            );
            let disposition = if participating.contains_key(&node_id) {
                match record.kind {
                    LegacySemanticTopologyKind::Principal(_) => {
                        LegacyTopologyDisposition::PrincipalElement
                    }
                    LegacySemanticTopologyKind::HardBreak => {
                        LegacyTopologyDisposition::HardBreakToken
                    }
                }
            } else if suppressed_ancestor_node_id.is_some() {
                LegacyTopologyDisposition::SuppressedByAncestor
            } else {
                LegacyTopologyDisposition::Suppressed
            };
            let semantic_kind = match record.kind {
                LegacySemanticTopologyKind::Principal(kind) => participating
                    .get(&node_id)
                    .map_or(Some(kind), |record| Some(record.kind)),
                LegacySemanticTopologyKind::HardBreak => None,
            };
            let effective_display =
                matches!(disposition, LegacyTopologyDisposition::PrincipalElement)
                    .then(|| participating.get(&node_id).map(|record| record.display))
                    .flatten();
            Some(LegacyTopologyObservation {
                node_id,
                semantic_parent_node_id: record.canonical_parent_node_id,
                semantic_ordinal: Some(record.canonical_ordinal),
                canonical_parent_node_id: matches!(
                    disposition,
                    LegacyTopologyDisposition::PrincipalElement
                        | LegacyTopologyDisposition::HardBreakToken
                )
                .then_some(record.canonical_parent_node_id)
                .flatten(),
                canonical_ordinal: matches!(
                    disposition,
                    LegacyTopologyDisposition::PrincipalElement
                        | LegacyTopologyDisposition::HardBreakToken
                )
                .then_some(record.canonical_ordinal),
                disposition,
                semantic_kind,
                effective_display,
                root_attributes_consumed: None,
                suppressed_ancestor_node_id,
            })
        })
        .collect::<Vec<_>>();
    assign_legacy_canonical_ordinals(&mut records);
    LegacyTopologySnapshot {
        records,
        semantic_duplicate_count,
        participating_duplicate_count,
    }
}

fn assign_legacy_canonical_ordinals(records: &mut [LegacyTopologyObservation]) {
    let mut next_ordinal_by_parent = BTreeMap::<Option<NodeId>, usize>::new();
    for record in records {
        if !matches!(
            record.disposition,
            LegacyTopologyDisposition::PrincipalElement | LegacyTopologyDisposition::HardBreakToken
        ) {
            continue;
        }
        let next_ordinal = next_ordinal_by_parent
            .entry(record.canonical_parent_node_id)
            .or_default();
        record.canonical_ordinal = Some(*next_ordinal);
        *next_ordinal += 1;
    }
}

fn collect_legacy_semantic_topology(
    nodes: &[DocumentNode],
    source: &SourceArena,
    canonical_parent_node_id: Option<NodeId>,
    output: &mut BTreeMap<NodeId, LegacySemanticTopologyRecord>,
    duplicate_count: &mut usize,
) {
    let mut canonical_ordinal = 0;
    for node in nodes {
        let Some(node_id) = document_node_source_element_id(node, source) else {
            continue;
        };
        let kind = match node {
            DocumentNode::Block(_) => LegacySemanticTopologyKind::Principal(StyledNodeKind::Block),
            DocumentNode::Inline(_) => {
                LegacySemanticTopologyKind::Principal(StyledNodeKind::Inline)
            }
            DocumentNode::Image(_) => LegacySemanticTopologyKind::Principal(StyledNodeKind::Image),
            DocumentNode::Text(_) => LegacySemanticTopologyKind::HardBreak,
        };
        if output
            .insert(
                node_id,
                LegacySemanticTopologyRecord {
                    canonical_parent_node_id,
                    canonical_ordinal,
                    kind,
                },
            )
            .is_some()
        {
            *duplicate_count += 1;
        }
        canonical_ordinal += 1;
        if let DocumentNode::Block(element) | DocumentNode::Inline(element) = node {
            collect_legacy_semantic_topology(
                &element.children,
                source,
                Some(node_id),
                output,
                duplicate_count,
            );
        }
    }
}

fn document_node_source_element_id(node: &DocumentNode, source: &SourceArena) -> Option<NodeId> {
    let node_id = match node {
        DocumentNode::Block(element) | DocumentNode::Inline(element) => {
            element.source_ref.source_node_id
        }
        DocumentNode::Image(image) => image.source_ref.source_node_id,
        DocumentNode::Text(text) => text.source_ref.source_node_id,
    }?;
    source.node(node_id)?.as_element().map(|_| node_id)
}

fn collect_participating_source_elements(
    nodes: &[StyledNode],
    source: &SourceArena,
    output: &mut BTreeMap<NodeId, LegacyParticipatingTopologyRecord>,
    duplicate_count: &mut usize,
) {
    for node in nodes {
        if let Some(node_id) = node
            .source_ref
            .as_ref()
            .and_then(|source_ref| source_ref.source_node_id)
        {
            if source
                .node(node_id)
                .is_some_and(|node| node.as_element().is_some())
                && output
                    .insert(
                        node_id,
                        LegacyParticipatingTopologyRecord {
                            kind: node.node_type,
                            display: legacy_topology_display(node),
                        },
                    )
                    .is_some()
            {
                *duplicate_count += 1;
            }
        }
        collect_participating_source_elements(&node.children, source, output, duplicate_count);
    }
}

fn legacy_topology_display(node: &StyledNode) -> LegacyTopologyDisplay {
    if node.style.get("display").and_then(Value::as_str) == Some("inline-block") {
        return LegacyTopologyDisplay {
            outside: LegacyTopologyDisplayOutside::Inline,
            inside: LegacyTopologyDisplayInside::FlowRoot,
            is_list_item: false,
        };
    }
    let outside = match node.node_type {
        StyledNodeKind::Block => LegacyTopologyDisplayOutside::Block,
        StyledNodeKind::Inline | StyledNodeKind::Text | StyledNodeKind::Image => {
            LegacyTopologyDisplayOutside::Inline
        }
    };
    LegacyTopologyDisplay {
        outside,
        inside: LegacyTopologyDisplayInside::Flow,
        is_list_item: false,
    }
}

fn first_suppressed_semantic_ancestor(
    mut parent: Option<NodeId>,
    semantic: &BTreeMap<NodeId, LegacySemanticTopologyRecord>,
    participating: &BTreeMap<NodeId, LegacyParticipatingTopologyRecord>,
) -> Option<NodeId> {
    let mut suppression_root = None;
    while let Some(node_id) = parent {
        if !participating.contains_key(&node_id) {
            suppression_root = Some(node_id);
        } else if suppression_root.is_some() {
            break;
        }
        parent = semantic
            .get(&node_id)
            .and_then(|record| record.canonical_parent_node_id);
    }
    suppression_root
}

fn root_style_carrier(
    node_id: NodeId,
    root_attributes_consumed: bool,
) -> LegacyTopologyObservation {
    LegacyTopologyObservation {
        node_id,
        semantic_parent_node_id: None,
        semantic_ordinal: None,
        canonical_parent_node_id: None,
        canonical_ordinal: None,
        disposition: LegacyTopologyDisposition::RootStyleCarrier,
        semantic_kind: None,
        effective_display: None,
        root_attributes_consumed: Some(root_attributes_consumed),
        suppressed_ancestor_node_id: None,
    }
}

fn incomplete_topology(node_id: NodeId) -> LegacyTopologyObservation {
    LegacyTopologyObservation {
        node_id,
        semantic_parent_node_id: None,
        semantic_ordinal: None,
        canonical_parent_node_id: None,
        canonical_ordinal: None,
        disposition: LegacyTopologyDisposition::Incomplete,
        semantic_kind: None,
        effective_display: None,
        root_attributes_consumed: None,
        suppressed_ancestor_node_id: None,
    }
}

fn hash_bytes(digest: &mut u64, bytes: &[u8]) {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    if *digest == 0 {
        *digest = FNV_OFFSET;
    }
    for byte in bytes {
        *digest ^= u64::from(*byte);
        *digest = digest.wrapping_mul(FNV_PRIME);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use rito_source::SourceArena;

    use super::{
        default_ua_stylesheet, select_chapter_css_from_source, LegacyColorScheme,
        LegacyStyleViewport, LegacyTopologyDisposition, PreparedLegacyStyle,
    };

    #[test]
    fn benchmark_projection_uses_the_callers_source_node_ids() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html><body><section><p id="target">text</p></section></body></html>"#,
            )
            .expect("source arena"),
        );
        let target_id = source.find_element_by_id("target").expect("target id");
        let prepared =
            PreparedLegacyStyle::compile_from_source(Arc::clone(&source), &[], 1_280.0, 720.0);

        let records = prepared.resolve().source_element_styles();
        let target = records
            .iter()
            .find(|record| record.id.as_deref() == Some("target"))
            .expect("target style");
        assert_eq!(target.node_id, target_id);
        assert!(default_ua_stylesheet().contains("h1 { font-size: 2em"));
    }

    #[test]
    fn benchmark_scope_keeps_elements_that_cascade_will_suppress() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html><body><section><p id="kept">yes</p><p id="hidden" style="display:none">no</p></section></body></html>"#,
            )
            .expect("source arena"),
        );
        let prepared =
            PreparedLegacyStyle::compile_from_source(Arc::clone(&source), &[], 1_280.0, 720.0);

        let scope = prepared.source_element_scope();
        let resolved = prepared.resolve().source_element_styles();

        assert!(scope
            .iter()
            .any(|record| record.id.as_deref() == Some("hidden")));
        assert!(!resolved
            .iter()
            .any(|record| record.id.as_deref() == Some("hidden")));
    }

    #[test]
    fn benchmark_topology_observes_root_break_and_suppression_events() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html class="root"><head><title>x</title></head><body class="page"><p id="kept">x</p><div id="hidden" style="display:none"><span id="child"><em id="grandchild">y</em></span></div><br id="break" style="display:none"/></body></html>"#,
            )
            .expect("source arena"),
        );
        let prepared =
            PreparedLegacyStyle::compile_from_source(Arc::clone(&source), &[], 1_280.0, 720.0);
        let resolved = prepared.resolve();
        let snapshot = prepared.topology_observations(&resolved);
        let observations = &snapshot.records;
        let source_element_count = source
            .iter()
            .filter(|(_, node)| node.as_element().is_some())
            .count();
        assert_eq!(observations.len(), source_element_count);
        assert_eq!(snapshot.semantic_duplicate_count, 0);
        assert_eq!(snapshot.participating_duplicate_count, 0);

        let disposition = |id: &str| {
            let node_id = source.find_element_by_id(id).expect("source id");
            observations
                .iter()
                .find(|record| record.node_id == node_id)
                .expect("topology observation")
                .disposition
        };
        assert_eq!(
            disposition("kept"),
            LegacyTopologyDisposition::PrincipalElement
        );
        assert_eq!(disposition("hidden"), LegacyTopologyDisposition::Suppressed);
        assert_eq!(
            disposition("child"),
            LegacyTopologyDisposition::SuppressedByAncestor
        );
        assert_eq!(
            disposition("grandchild"),
            LegacyTopologyDisposition::SuppressedByAncestor
        );
        let hidden_node_id = source
            .find_element_by_id("hidden")
            .expect("hidden source id");
        for id in ["child", "grandchild"] {
            let node_id = source.find_element_by_id(id).expect("descendant source id");
            let observation = observations
                .iter()
                .find(|record| record.node_id == node_id)
                .expect("descendant topology observation");
            assert_eq!(
                observation.suppressed_ancestor_node_id,
                Some(hidden_node_id),
                "suppression must name the element with own display:none"
            );
        }
        assert_eq!(
            disposition("break"),
            LegacyTopologyDisposition::HardBreakToken,
            "legacy parser converts br before its own display can cascade"
        );

        let root_carriers = observations
            .iter()
            .filter(|record| record.disposition == LegacyTopologyDisposition::RootStyleCarrier)
            .collect::<Vec<_>>();
        assert_eq!(root_carriers.len(), 2);
        assert!(root_carriers
            .iter()
            .any(|record| record.root_attributes_consumed == Some(false)));
        assert!(root_carriers
            .iter()
            .any(|record| record.root_attributes_consumed == Some(true)));
    }

    #[test]
    fn benchmark_topology_reindexes_survivors_after_a_suppressed_sibling() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html><body><div><span id="hidden" style="display:none">x</span><span id="visible">y</span></div></body></html>"#,
            )
            .expect("source arena"),
        );
        let prepared =
            PreparedLegacyStyle::compile_from_source(Arc::clone(&source), &[], 1_280.0, 720.0);
        let resolved = prepared.resolve();
        let snapshot = prepared.topology_observations(&resolved);
        let visible_id = source
            .find_element_by_id("visible")
            .expect("visible source id");
        let visible = snapshot
            .records
            .iter()
            .find(|record| record.node_id == visible_id)
            .expect("visible topology observation");

        assert_eq!(
            visible.disposition,
            LegacyTopologyDisposition::PrincipalElement
        );
        assert_eq!(visible.semantic_ordinal, Some(1));
        assert_eq!(visible.canonical_ordinal, Some(0));
    }

    #[test]
    fn benchmark_records_the_author_sequence_it_actually_selects() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html><head><link rel="stylesheet" href="../Styles/main.css"/><style>p{color:red}</style></head><body><p>x</p></body></html>"#,
            )
            .expect("source arena"),
        );
        let stylesheets = vec![
            ("Styles/main.css".to_owned(), "p{font-size:20px}".to_owned()),
            (
                "Styles/unused.css".to_owned(),
                "p{font-size:30px}".to_owned(),
            ),
        ];
        let prepared = PreparedLegacyStyle::compile_from_source(
            Arc::clone(&source),
            &stylesheets,
            1_280.0,
            720.0,
        );

        let sequence = prepared.author_stylesheet_sequence();
        assert_eq!(sequence.len(), 2);
        assert!(sequence[0].source_node_id.is_some());
        assert_eq!(sequence[0].source_kind, "external");
        assert_eq!(sequence[0].source_id, "Styles/main.css");
        assert_eq!(sequence[0].css, "p{font-size:20px}");
        assert_eq!(sequence[1].source_kind, "embedded");
        assert_eq!(sequence[1].source_id, "0");
        assert_eq!(sequence[1].css, "p{color:red}");
    }

    #[test]
    fn benchmark_selection_keeps_interleaved_source_order_and_full_viewport() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html><head><style>.a{color:red}</style><link rel="stylesheet" href="main.css"/><style>.c{color:blue}</style></head><body/></html>"#,
            )
            .expect("source arena"),
        );
        let stylesheets = vec![("main.css".to_owned(), ".b{color:green}".to_owned())];
        let selection = select_chapter_css_from_source(Arc::clone(&source), &stylesheets);

        assert!(selection.source_order_complete);
        assert!(selection.source_order_issues.is_empty());
        assert_eq!(
            selection
                .author_stylesheet_sequence
                .iter()
                .map(|record| record.source_kind)
                .collect::<Vec<_>>(),
            ["embedded", "external", "embedded"]
        );
        assert!(selection
            .author_stylesheet_sequence
            .iter()
            .all(|record| record.source_node_id.is_some()));

        let viewport = LegacyStyleViewport {
            width_css_px: 800.0,
            height_css_px: 600.0,
            device_pixel_ratio: 2.0,
            color_scheme: LegacyColorScheme::Dark,
        };
        let prepared =
            PreparedLegacyStyle::compile_from_source_with_viewport(source, &stylesheets, viewport);
        assert_eq!(prepared.viewport(), viewport);
    }

    #[test]
    fn benchmark_selection_fails_closed_for_unmodeled_stylesheet_applicability() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html><head><link rel="alternate stylesheet" href="main.css" media="print"/><style disabled="disabled">p{color:red}</style></head><body/></html>"#,
            )
            .expect("source arena"),
        );
        let stylesheets = vec![("main.css".to_owned(), "p{color:green}".to_owned())];
        let selection = select_chapter_css_from_source(source, &stylesheets);

        assert!(!selection.source_order_complete);
        assert!(!selection.media_environment_compatible);
        assert_eq!(selection.author_stylesheet_sequence.len(), 2);
        assert!(selection
            .source_order_issues
            .iter()
            .any(|issue| issue.contains("alternate stylesheet")));
        assert!(selection
            .media_environment_issues
            .iter()
            .any(|issue| issue.contains("media applicability")));
        assert!(selection
            .source_order_issues
            .iter()
            .any(|issue| issue.contains("disabled state")));
    }

    #[test]
    fn benchmark_selection_fails_closed_for_unexpanded_imports() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html><head><style>/* @import 'ignored.css'; */ @import url('base.css'); p{color:red}</style></head><body/></html>"#,
            )
            .expect("source arena"),
        );
        let selection = select_chapter_css_from_source(source, &[]);

        assert!(!selection.source_order_complete);
        assert!(selection.media_environment_compatible);
        assert!(selection
            .source_order_issues
            .iter()
            .any(|issue| issue.contains("@import dependency graph")));
    }

    #[test]
    fn benchmark_selection_fails_closed_for_media_queries() {
        let source = Arc::new(
            SourceArena::from_xhtml(
                r#"<html><head><style>@media (prefers-color-scheme: dark) { p{color:white} }</style></head><body/></html>"#,
            )
            .expect("source arena"),
        );
        let selection = select_chapter_css_from_source(source, &[]);

        assert!(selection.source_order_complete);
        assert!(!selection.media_environment_compatible);
        assert!(selection
            .media_environment_issues
            .iter()
            .any(|issue| issue.contains("@media environment")));
    }
}
